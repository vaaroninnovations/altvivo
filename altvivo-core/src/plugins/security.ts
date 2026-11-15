import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { RevocationStore } from '../lib/redis.js';
import type { UserRole } from '@prisma/client';
import { z, type ZodTypeAny } from 'zod';
import type { Deps } from '../deps.js';
import { ACCESS_COOKIE, CSRF_COOKIE } from '../lib/cookies.js';
import { safeEqual } from '../lib/crypto.js';
import { HttpError, badRequest, forbidden, unauthorized } from '../lib/errors.js';
import type { AccessClaims } from '../lib/jwt.js';
import { clientIp, userAgent } from '../lib/net.js';
import type { AuditActor } from '../lib/audit.js';

export type RateBucket = 'auth' | 'session' | 'public' | 'api' | 'webhook' | 'internal' | 'none';

declare module 'fastify' {
  interface FastifyRequest {
    clientIp: string;
    auth?: AccessClaims;
    /** The user's access changed after this token was minted (refresh for fresh entitlements). */
    authStale?: boolean;
    service?: { appId: string };
  }
  interface FastifyContextConfig {
    /** Set false only for endpoints authenticated by something other than cookies. */
    csrf?: boolean;
    rateLimit?: RateBucket;
  }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw badRequest(
      'VALIDATION_FAILED',
      'Request validation failed',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

export const actorOf = (req: FastifyRequest, appId = 'core'): AuditActor => ({
  actorId: req.auth?.sub ?? null,
  ip: req.clientIp,
  userAgent: userAgent(req),
  appId,
  actorType: req.service ? 'SERVICE' : req.auth ? 'USER' : 'SYSTEM',
});

export const clientOf = (req: FastifyRequest) => ({ ip: req.clientIp, userAgent: userAgent(req) });

function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return undefined;
  return h.slice(7).trim() || undefined;
}

export function registerSecurityHooks(app: FastifyInstance, d: Deps): void {
  app.decorateRequest('clientIp', '');

  app.addHook('onRequest', async (req, reply) => {
    req.clientIp = clientIp(req, d.trustedProxies);
    const cfg = req.routeOptions.config ?? {};
    const bucket: RateBucket = cfg.rateLimit ?? 'public';

    // Responses carrying identity must never be cached by intermediaries.
    if (bucket !== 'public' || MUTATING.has(req.method)) reply.header('Cache-Control', 'no-store');

    if (MUTATING.has(req.method) && cfg.csrf !== false) {
      // 1. Origin allow-list (browsers always send Origin on cross-origin POSTs).
      const origin = req.headers.origin;
      if (origin && !d.cfg.allowedOriginSet.has(origin)) throw forbidden('ORIGIN_NOT_ALLOWED', 'Origin not allowed');
      // 2. Signed double-submit token. Bearer-authenticated calls carry no
      //    ambient credentials, so CSRF does not apply to them.
      if (!bearer(req)) {
        const header = req.headers['x-csrf-token'];
        const ok = d.csrf.validate(req.cookies[CSRF_COOKIE], Array.isArray(header) ? header[0] : header);
        if (!ok) throw forbidden('CSRF_FAILED', 'Missing or invalid CSRF token');
      }
    }

    const ipLimits: Partial<Record<RateBucket, number>> = {
      auth: d.cfg.AUTH_RATE_LIMIT_PER_MINUTE,
      session: d.cfg.SESSION_RATE_LIMIT_PER_MINUTE,
      public: d.cfg.PUBLIC_RATE_LIMIT_PER_MINUTE,
      webhook: 600,
    };
    const limit = ipLimits[bucket];
    if (limit !== undefined) {
      const r = await d.limiter.enforce(bucket, req.clientIp, limit, 60, bucket === 'auth');
      reply.header('RateLimit-Limit', limit).header('RateLimit-Remaining', r.remaining);
    }
  });
}

export interface RequireUserOptions {
  roles?: readonly UserRole[];
  /** Session must have passed TOTP. */
  mfa?: boolean;
  /** Allow sessions of MFA-mandatory roles that still need to enrol (enrolment endpoints). */
  allowPendingEnrollment?: boolean;
}

/** Authenticates the end user via `altvivo_at` cookie or Bearer access token. */
export function requireUser(d: Deps, opts: RequireUserOptions = {}): preHandlerAsyncHookHandler {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    const token = bearer(req) ?? req.cookies[ACCESS_COOKIE];
    if (!token) throw unauthorized();
    let claims: AccessClaims;
    try {
      claims = await d.tokens.verify(token);
    } catch {
      throw unauthorized('TOKEN_INVALID', 'Session expired or invalid');
    }
    const state = await d.revocations.tokenState(claims.sid, claims.sub, claims.iat, RevocationStore.mintedAt(claims));
    if (state === 'revoked') throw unauthorized('SESSION_REVOKED', 'Session has been signed out');
    req.authStale = state === 'stale';
    if (claims.mfa_enrollment_required && !opts.allowPendingEnrollment) {
      throw new HttpError(403, 'MFA_ENROLLMENT_REQUIRED', 'Your role requires two-factor authentication. Enrol to continue.');
    }
    if (opts.roles && !opts.roles.includes(claims.role)) throw forbidden();
    if (opts.mfa && !claims.mfa) throw new HttpError(403, 'MFA_REQUIRED', 'Two-factor authentication is required for this action');
    req.auth = claims;

    const r = await d.limiter.enforce('api', claims.sub, d.cfg.API_RATE_LIMIT_PER_MINUTE, 60, false);
    reply.header('RateLimit-Limit', d.cfg.API_RATE_LIMIT_PER_MINUTE).header('RateLimit-Remaining', r.remaining);
  };
}

/** Spoke -> core server-to-server authentication (`Authorization: Bearer <service token>`). */
export function requireService(d: Deps): preHandlerAsyncHookHandler {
  return async function (req: FastifyRequest) {
    const token = bearer(req);
    if (!token) throw unauthorized('SERVICE_AUTH_REQUIRED', 'Service token required');
    let appId: string | undefined;
    for (const [candidate, id] of d.cfg.serviceTokens) {
      if (safeEqual(candidate, token)) appId = id;
    }
    if (!appId) throw unauthorized('SERVICE_AUTH_INVALID', 'Invalid service token');
    req.service = { appId };
    await d.limiter.enforce('internal', appId, 6000, 60, false);
  };
}
