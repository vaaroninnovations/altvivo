import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { RevocationStore } from '../lib/redis.js';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { ACCESS_COOKIE } from '../lib/cookies.js';
import { HttpError, forbidden, unauthorized } from '../lib/errors.js';
import type { AccessClaims } from '../lib/jwt.js';
import { parse, requireUser } from '../plugins/security.js';
import { isEntitled } from '../services/access.js';
import { appIndex, type PublicApp } from '../services/registry.js';

const APP_ID = /^[a-z][a-z0-9]{1,31}$/;
const AppTokenBody = z.object({ app: z.string().regex(APP_ID) });

const header = (req: FastifyRequest, name: string): string | undefined => {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};

/** Header values copied to the spoke: never let CR/LF or non-ASCII through. */
const headerSafe = (v: string) => v.replace(/[^\x20-\x7E]/g, '');

/**
 * The URL the visitor asked for, rebuilt from Caddy's X-Forwarded-* headers.
 * The host must be the app's own host, so the gate can never be turned into
 * an open redirect; anything unexpected falls back to the app's home page.
 */
function originalUrl(req: FastifyRequest, app: PublicApp): string {
  const home = new URL(app.url);
  const host = header(req, 'x-forwarded-host')?.toLowerCase();
  const uri = header(req, 'x-forwarded-uri') ?? '/';
  if (host !== home.host || !uri.startsWith('/') || uri.startsWith('//') || uri.length > 2048 || /[\r\n]/.test(uri)) {
    return `${home.origin}/`;
  }
  return `${home.origin}${uri}`;
}

/** Top-level page loads get redirects; XHR / fetch / assets get JSON status codes. */
function isNavigation(req: FastifyRequest): boolean {
  const method = (header(req, 'x-forwarded-method') ?? req.method).toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (header(req, 'sec-fetch-mode') === 'navigate') return true;
  return (header(req, 'accept') ?? '').includes('text/html');
}

export default async function gateRoutes(app: FastifyInstance, d: Deps) {
  const web = d.cfg.webOrigin;
  const api = d.cfg.PUBLIC_API_URL.replace(/\/$/, '');

  /**
   * Caddy forward_auth (layer 1 of the paid gate), called for every request
   * to a paid spoke. Answers from the access token and Redis only (plus a
   * 5-second memo of app statuses), never from per-user database queries.
   * Contract: altvivo-infra/CONTRACTS.md section 2.
   */
  app.get<{ Querystring: { app?: string } }>('/v1/auth/verify', { config: { rateLimit: 'none' }, logLevel: 'warn' }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const appId = req.query.app ?? '';
    if (!APP_ID.test(appId)) return reply.code(400).send({ error: 'bad_request' });
    const target = (await appIndex(d.prisma, d.redis)).get(appId);
    if (!target) return reply.code(404).send({ error: 'unknown_app' });

    const original = originalUrl(req, target);
    const nav = isNavigation(req);
    const deny = (status: number, error: string, location: string, extra: Record<string, string> = {}) =>
      nav ? reply.redirect(location, 302) : reply.code(status).send({ error, redirect: location, ...extra });

    const loginUrl = `${web}/login?redirect=${encodeURIComponent(original)}`;
    const bounceUrl = `${api}/v1/auth/refresh/bounce?next=${encodeURIComponent(original)}`;
    const expired = () => deny(401, 'session_expired', bounceUrl, { refreshUrl: `${api}/v1/auth/refresh` });

    const token = req.cookies[ACCESS_COOKIE];
    if (!token) return deny(401, 'unauthenticated', loginUrl);
    let claims: AccessClaims;
    try {
      claims = await d.tokens.verify(token);
    } catch (err) {
      return (err as { code?: string }).code === 'ERR_JWT_EXPIRED' ? expired() : deny(401, 'unauthenticated', loginUrl);
    }
    let state: 'ok' | 'revoked' | 'stale';
    try {
      state = await d.revocations.tokenState(claims.sid, claims.sub, claims.iat, RevocationStore.mintedAt(claims));
    } catch {
      // Fail closed: without the revocation list a signed-out session could pass.
      return reply.code(503).send({ error: 'unavailable' });
    }
    if (state === 'revoked') return deny(401, 'unauthenticated', loginUrl);
    if (state === 'stale') return expired();

    const ent = typeof claims.entitlements?.[appId] === 'object' ? claims.entitlements[appId] : undefined;
    const vip = ent?.source === 'vip' && isEntitled(ent);
    if (target.status === 'MAINTENANCE' && !vip) {
      return deny(503, 'maintenance', `${web}/maintenance?app=${appId}`);
    }
    if (!isEntitled(ent)) {
      const reason = ent?.active && ent.expires_at !== null && ent.expires_at * 1000 <= Date.now() ? 'subscription_expired' : 'subscription_required';
      return deny(403, reason, `${web}/workspace/upgrade?app=${appId}&reason=${reason}`);
    }

    reply
      .header('X-AltVivo-User-Id', claims.sub)
      .header('X-AltVivo-Email', headerSafe(claims.email))
      .header('X-AltVivo-Role', claims.role)
      .header('X-AltVivo-Access', vip ? 'vip' : ent!.source === 'trial' ? 'trial' : 'paid')
      .header('X-AltVivo-Plan', headerSafe(ent!.plan ?? ent!.source ?? 'paid'));
    return reply.code(200).send();
  });

  /**
   * Audience-scoped token for an app's own backend (e.g. aMaze's tracking
   * service). Only the app's own origin may ask, only for a user who holds
   * that app right now, and the token carries nothing but that entitlement.
   */
  app.post('/v1/auth/app-token', { config: { rateLimit: 'session' }, preHandler: requireUser(d) }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { app: appId } = parse(AppTokenBody, req.body);
    const target = (await appIndex(d.prisma, d.redis)).get(appId);
    if (!target) throw new HttpError(404, 'UNKNOWN_APP', 'Unknown application');
    if (req.headers.origin !== new URL(target.url).origin) {
      throw forbidden('ORIGIN_NOT_ALLOWED', `App tokens for ${appId} can only be requested from ${new URL(target.url).origin}`);
    }
    if (req.authStale) throw unauthorized('SESSION_STALE', 'Your access changed - refresh the session and retry');
    const claims = req.auth!;
    const ent = claims.entitlements[appId];
    if (!isEntitled(ent) || (target.status === 'MAINTENANCE' && ent?.source !== 'vip')) {
      throw new HttpError(403, 'SUBSCRIPTION_REQUIRED', `An active ${target.name} licence is required`, {
        upgradeUrl: `${d.cfg.webOrigin}/workspace/upgrade?app=${appId}&reason=subscription_required`,
      });
    }
    const { token, expiresAt } = await d.tokens.signAppToken(claims.sub, appId, ent!, d.cfg.APP_TOKEN_TTL_SECONDS);
    reply.header('Cache-Control', 'no-store');
    return { token, expiresAt: expiresAt.toISOString() };
  });
}
