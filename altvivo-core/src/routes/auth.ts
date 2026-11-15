import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@prisma/client';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { audit, withAudit, type Tx } from '../lib/audit.js';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from '../lib/cookies.js';
import { hmacHex, openSecret, randomToken, sealSecret, sha256Hex } from '../lib/crypto.js';
import { HttpError, badRequest, conflict, unauthorized } from '../lib/errors.js';
import type { AccessClaims } from '../lib/jwt.js';
import { templates } from '../lib/mailer.js';
import { safeRedirect } from '../lib/net.js';
import { assertPasswordPolicy, hashPassword, needsRehash, verifyPassword } from '../lib/password.js';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUri,
  verifyTotp,
} from '../lib/totp.js';
import { actorOf, clientOf, parse, requireUser } from '../plugins/security.js';
import { toApiEntitlements } from '../services/access.js';
import { MFA_REQUIRED_ROLES } from '../services/sessions.js';

const email = z.string().trim().toLowerCase().email().max(254);
const turnstileToken = z.string().min(1).max(2048);

const RegisterBody = z.object({
  email,
  password: z.string().max(128).optional(),
  fullName: z.string().trim().min(2).max(200),
  affiliation: z.string().trim().max(300).optional(),
  role: z.enum(['STUDENT', 'RESEARCHER', 'PI']).default('RESEARCHER'),
  turnstileToken,
  oauthPendingId: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/).optional(),
});

const LoginBody = z.object({ email, password: z.string().min(1).max(128), turnstileToken });

const MfaVerifyBody = z
  .object({
    challengeId: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/),
    code: z.string().regex(/^\d{6}$/).optional(),
    recoveryCode: z.string().min(10).max(20).optional(),
  })
  .refine((b) => !!b.code !== !!b.recoveryCode, 'Provide exactly one of code or recoveryCode');

const ForgotBody = z.object({ email, turnstileToken });
const ResetBody = z.object({ token: z.string().min(20).max(128), password: z.string().max(128) });
const CodeBody = z.object({ code: z.string().regex(/^\d{6}$/) });
const DisableMfaBody = z.object({ code: z.string().regex(/^\d{6}$/), password: z.string().min(1).max(128) });

const MFA_CHALLENGE_TTL = 300;
const MFA_MAX_ATTEMPTS = 5;
const EMAIL_VERIFY_TTL_MS = 24 * 3600 * 1000;
const PASSWORD_RESET_TTL_MS = 3600 * 1000;

interface MfaChallenge {
  userId: string;
  attempts: number;
  method: string;
  redirect?: string;
}

interface PendingOAuth {
  provider: 'GOOGLE' | 'ORCID';
  subject: string;
  name: string;
  email: string | null;
  emailVerified: boolean;
  orcidId: string | null;
}

export const publicUser = (c: AccessClaims) => ({
  id: c.sub,
  email: c.email,
  name: c.name,
  role: c.role,
  orgId: c.org_id,
  tier: c.tier,
  emailVerified: c.email_verified,
  entitlements: toApiEntitlements(c.entitlements),
  creditsRemaining: c.credits_remaining,
  mfa: c.mfa,
  mfaEnrollmentRequired: c.mfa_enrollment_required === true,
  accessTokenExpiresAt: new Date(c.exp * 1000).toISOString(),
});

export function authTokenHash(d: Deps, token: string): string {
  return hmacHex(d.cfg.REFRESH_TOKEN_PEPPER, `auth:${token}`);
}

export async function createMfaChallenge(d: Deps, userId: string, method: string, redirect?: string): Promise<string> {
  const id = randomToken(24);
  const value: MfaChallenge = { userId, attempts: 0, method, ...(redirect ? { redirect } : {}) };
  await d.redis.set(`mfa:challenge:${id}`, JSON.stringify(value), 'EX', MFA_CHALLENGE_TTL);
  return id;
}

export async function sendVerificationEmail(d: Deps, user: Pick<User, 'id' | 'email' | 'fullName'>): Promise<void> {
  const token = randomToken(32);
  await d.prisma.authToken.updateMany({
    where: { userId: user.id, purpose: 'EMAIL_VERIFY', consumedAt: null },
    data: { consumedAt: new Date() },
  });
  await d.prisma.authToken.create({
    data: {
      userId: user.id,
      purpose: 'EMAIL_VERIFY',
      tokenHash: authTokenHash(d, token),
      expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_MS),
    },
  });
  const link = `${d.cfg.PUBLIC_API_URL}/v1/auth/verify-email?token=${encodeURIComponent(token)}`;
  await d.mailer.send({ to: user.email, ...templates.verifyEmail(user.fullName, link) });
}

async function requireTurnstile(d: Deps, req: FastifyRequest, token: string): Promise<void> {
  if (!(await d.turnstile.verify(token, req.clientIp))) {
    throw badRequest('TURNSTILE_FAILED', 'Human verification failed, please retry');
  }
}

function loadMfaSecret(d: Deps, user: Pick<User, 'id' | 'mfaSecret'>): string {
  if (!user.mfaSecret) throw new HttpError(409, 'MFA_NOT_ENABLED', 'Two-factor authentication is not enabled');
  return openSecret(d.cfg.mfaKey, user.mfaSecret, user.id);
}

/** Verifies a TOTP code for the signed-in user (used as an e-signature for admin actions too). */
export async function assertTotp(d: Deps, userId: string, code: string | undefined): Promise<void> {
  const user = await d.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, mfaSecret: true } });
  const secret = loadMfaSecret(d, user);
  if (!code || !(await verifyTotp(d.redis, user.id, secret, code))) {
    throw new HttpError(401, 'MFA_CODE_INVALID', 'Invalid or already-used authentication code');
  }
}

/** Domain-whitelisted institutions: auto-join on verified email, seat permitting. */
export async function autoJoinOrganization(d: Deps, tx: Tx, userId: string, userEmail: string) {
  const domain = userEmail.split('@')[1]?.toLowerCase();
  if (!domain) return;
  const org = await tx.organization.findFirst({ where: { domainWhitelist: { has: domain }, status: 'ACTIVE' } });
  if (!org) return;
  const current = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { orgId: true } });
  if (current.orgId) return;
  // The users_seat_limit trigger is authoritative (it locks the organization
  // row); this pre-check only avoids a failed statement in the common case.
  const members = await tx.user.count({ where: { orgId: org.id, disabledAt: null } });
  if (members >= org.seatLimit) {
    await audit(tx, 'ORG.SEAT_LIMIT_REACHED', org.id, { user_id: userId, seat_limit: org.seatLimit });
    return;
  }
  await tx.user.update({ where: { id: userId }, data: { orgId: org.id } });
  await audit(tx, 'ORG.AUTO_JOIN', org.id, { user_id: userId, domain });
}

/**
 * Pre-account-takeover guard. Before an address is verified, anyone can
 * register it and attach a password or an ORCID / Google identity. When the
 * mailbox owner later claims the account (password reset, Google with a
 * verified email), every sign-in method set up before that proof is removed.
 */
export async function clearUnprovenSignInMethods(tx: Tx, userId: string): Promise<number> {
  const { count } = await tx.oAuthAccount.deleteMany({ where: { userId } });
  await tx.user.update({ where: { id: userId }, data: { orcidId: null } });
  return count;
}

export async function completeLogin(
  d: Deps,
  req: FastifyRequest,
  reply: FastifyReply,
  user: Pick<User, 'id'>,
  mfaVerified: boolean,
  method: string,
) {
  const claims = await d.sessions.login(reply, user, {
    mfaVerified,
    client: clientOf(req),
    method,
    actor: { ...actorOf(req), actorId: user.id, actorType: 'USER' },
  });
  return { status: 'authenticated' as const, user: publicUser(claims) };
}

export default async function authRoutes(app: FastifyInstance, d: Deps) {
  /**
   * User id of the browser's live session, or null. An access token past its
   * 15-minute expiry still counts while its session is unrevoked, so a user
   * who registered earlier is not sent round in a login loop.
   */
  const signedInUserId = async (req: FastifyRequest): Promise<string | null> => {
    const token = req.cookies[ACCESS_COOKIE];
    if (!token) return null;
    try {
      const claims = await d.tokens.verify(token, { allowExpiredUpToSeconds: d.cfg.REFRESH_TOKEN_TTL_SECONDS });
      const session = await d.prisma.authSession.findUnique({ where: { id: claims.sid }, select: { userId: true, revokedAt: true, expiresAt: true } });
      if (!session || session.revokedAt || session.expiresAt <= new Date() || session.userId !== claims.sub) return null;
      return claims.sub;
    } catch {
      return null;
    }
  };

  const failLogin = async (req: FastifyRequest, user: User | null, emailAddr: string, reason: string) => {
    await withAudit(d.prisma, { ...actorOf(req), actorId: user?.id ?? null, actorType: user ? 'USER' : 'SYSTEM' }, async (tx) => {
      if (user) {
        const count = user.failedLoginCount + 1;
        const lock = count >= d.cfg.LOGIN_LOCKOUT_THRESHOLD;
        await tx.user.update({
          where: { id: user.id },
          data: lock
            ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + d.cfg.LOGIN_LOCKOUT_MINUTES * 60_000) }
            : { failedLoginCount: count },
        });
        if (lock) {
          await audit(tx, 'SECURITY.ACCOUNT_LOCKED', user.id, { minutes: d.cfg.LOGIN_LOCKOUT_MINUTES });
          await d.mailer
            .send({ to: user.email, ...templates.securityAlert(user.fullName, 'Repeated failed sign-in attempts temporarily locked your account') })
            .catch(() => undefined);
        }
      }
      await audit(tx, 'AUTH.LOGIN_FAILED', user?.id ?? null, { reason, email_sha256: sha256Hex(emailAddr) });
    });
    throw unauthorized('INVALID_CREDENTIALS', 'Incorrect email or password');
  };

  // ------------------------------------------------------------ CSRF -------
  app.get('/v1/auth/csrf', { config: { rateLimit: 'session' } }, async (req, reply) => {
    let token = req.cookies[CSRF_COOKIE];
    if (!d.csrf.isWellFormed(token)) {
      token = d.csrf.issue();
      d.cookies.setCsrf(reply, token);
    }
    return { csrfToken: token };
  });

  // --------------------------------------------------------- register ------
  app.post('/v1/auth/register', { config: { rateLimit: 'auth' } }, async (req, reply) => {
    const body = parse(RegisterBody, req.body);
    await requireTurnstile(d, req, body.turnstileToken);

    let pending: PendingOAuth | null = null;
    if (body.oauthPendingId) {
      const raw = await d.redis.get(`oauth:pending:${body.oauthPendingId}`);
      if (!raw) throw badRequest('OAUTH_PENDING_EXPIRED', 'Your ORCID / Google sign-up expired, please start again');
      pending = JSON.parse(raw) as PendingOAuth;
    }
    if (!pending) {
      if (!body.password) throw badRequest('PASSWORD_REQUIRED', 'A password is required');
      assertPasswordPolicy(body.password, body.email, body.fullName);
    } else if (body.password) {
      assertPasswordPolicy(body.password, body.email, body.fullName);
    }

    const existing = await d.prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
    if (existing) throw conflict('EMAIL_IN_USE', 'An account with this email already exists. Sign in or reset your password.');
    if (pending?.orcidId) {
      const orcidTaken = await d.prisma.user.findUnique({ where: { orcidId: pending.orcidId }, select: { id: true } });
      if (orcidTaken) throw conflict('ORCID_IN_USE', 'This ORCID iD is already linked to an account');
    }

    const passwordHash = body.password ? await hashPassword(body.password) : null;
    const emailVerified = pending?.emailVerified === true && pending.email?.toLowerCase() === body.email;

    const user = await withAudit(d.prisma, actorOf(req), async (tx) => {
      const u = await tx.user.create({
        data: {
          email: body.email,
          passwordHash,
          fullName: body.fullName,
          affiliation: body.affiliation ?? null,
          role: body.role,
          orcidId: pending?.orcidId ?? null,
          emailVerifiedAt: emailVerified ? new Date() : null,
        },
      });
      if (pending) {
        await tx.oAuthAccount.create({
          data: { userId: u.id, provider: pending.provider, providerAccountId: pending.subject, email: pending.email },
        });
      }
      if (emailVerified) await autoJoinOrganization(d, tx, u.id, u.email);
      await audit(tx, 'AUTH.REGISTER', u.id, { method: pending ? `oauth:${pending.provider.toLowerCase()}` : 'password', role: body.role });
      return u;
    });
    if (body.oauthPendingId) await d.redis.del(`oauth:pending:${body.oauthPendingId}`);
    if (!emailVerified) await sendVerificationEmail(d, user).catch((err) => req.log.error({ err }, 'verification email failed'));

    reply.code(201);
    return completeLogin(d, req, reply, user, false, pending ? `oauth:${pending.provider.toLowerCase()}` : 'register');
  });

  // ------------------------------------------------------------ login ------
  app.post('/v1/auth/login', { config: { rateLimit: 'auth' } }, async (req, reply) => {
    const body = parse(LoginBody, req.body);
    await requireTurnstile(d, req, body.turnstileToken);

    const user = await d.prisma.user.findUnique({ where: { email: body.email } });
    const ok = await verifyPassword(user?.passwordHash, body.password);
    if (!user) return failLogin(req, null, body.email, 'unknown_email');
    if (user.lockedUntil && user.lockedUntil > new Date()) return failLogin(req, user, body.email, 'locked');
    if (!ok) return failLogin(req, user, body.email, 'bad_password');
    if (user.disabledAt) return failLogin(req, user, body.email, 'disabled');

    if (user.passwordHash && needsRehash(user.passwordHash)) {
      await d.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.password) } });
    }
    if (user.mfaEnabled) {
      return { status: 'mfa_required' as const, challengeId: await createMfaChallenge(d, user.id, 'password') };
    }
    return completeLogin(d, req, reply, user, false, 'password');
  });

  // ------------------------------------------------------ MFA challenge ----
  app.post('/v1/auth/mfa/verify', { config: { rateLimit: 'auth' } }, async (req, reply) => {
    const body = parse(MfaVerifyBody, req.body);
    const key = `mfa:challenge:${body.challengeId}`;
    const raw = await d.redis.get(key);
    if (!raw) throw unauthorized('MFA_CHALLENGE_EXPIRED', 'Sign-in expired, please start again');
    const challenge = JSON.parse(raw) as MfaChallenge;
    const user = await d.prisma.user.findUnique({ where: { id: challenge.userId } });
    if (!user || user.disabledAt || !user.mfaEnabled) {
      await d.redis.del(key);
      throw unauthorized('MFA_CHALLENGE_EXPIRED', 'Sign-in expired, please start again');
    }

    let ok = false;
    let usedRecovery = false;
    if (body.code) {
      ok = await verifyTotp(d.redis, user.id, loadMfaSecret(d, user), body.code);
    } else if (body.recoveryCode) {
      const res = await d.prisma.mfaRecoveryCode.updateMany({
        where: { userId: user.id, codeHash: hashRecoveryCode(d.cfg.REFRESH_TOKEN_PEPPER, body.recoveryCode), usedAt: null },
        data: { usedAt: new Date() },
      });
      ok = res.count === 1;
      usedRecovery = ok;
    }

    if (!ok) {
      challenge.attempts += 1;
      await withAudit(d.prisma, { ...actorOf(req), actorId: user.id, actorType: 'USER' }, (tx) =>
        audit(tx, 'AUTH.MFA_FAILED', user.id, { attempts: challenge.attempts }),
      );
      if (challenge.attempts >= MFA_MAX_ATTEMPTS) await d.redis.del(key);
      else await d.redis.set(key, JSON.stringify(challenge), 'KEEPTTL');
      throw new HttpError(401, 'MFA_CODE_INVALID', 'Invalid or already-used authentication code');
    }
    await d.redis.del(key);
    if (usedRecovery) {
      await d.mailer
        .send({ to: user.email, ...templates.securityAlert(user.fullName, 'A recovery code was used to sign in') })
        .catch(() => undefined);
    }
    const result = await completeLogin(d, req, reply, user, true, `${challenge.method}+${usedRecovery ? 'recovery' : 'totp'}`);
    return challenge.redirect ? { ...result, redirect: challenge.redirect } : result;
  });

  // ---------------------------------------------------------- refresh ------
  app.post('/v1/auth/refresh', { config: { rateLimit: 'session' } }, async (req, reply) => {
    const r = await d.sessions.rotate(req.cookies[REFRESH_COOKIE], clientOf(req));
    if (r.kind === 'invalid' || r.kind === 'reuse') {
      d.cookies.clearSession(reply);
      throw unauthorized(r.kind === 'reuse' ? 'SESSION_REVOKED' : 'REFRESH_INVALID', 'Please sign in again');
    }
    d.sessions.applyRotation(reply, r);
    return { status: 'refreshed', user: publicUser(r.claims) };
  });

  /**
   * Top-level navigation variant for server-rendered spokes: when a spoke sees
   * an expired `altvivo_at`, it redirects here (same-site, so the Strict
   * refresh cookie is sent), we rotate and bounce back to `next`.
   */
  app.get<{ Querystring: { next?: string } }>('/v1/auth/refresh/bounce', { config: { rateLimit: 'session' } }, async (req, reply) => {
    const next = safeRedirect(req.query.next, d.cfg.allowedOriginSet, `${d.cfg.webOrigin}/workspace`);
    const r = await d.sessions.rotate(req.cookies[REFRESH_COOKIE], clientOf(req));
    if (r.kind === 'invalid' || r.kind === 'reuse') {
      d.cookies.clearSession(reply);
      return reply.redirect(`${d.cfg.webOrigin}/login?redirect=${encodeURIComponent(next)}`, 303);
    }
    d.sessions.applyRotation(reply, r);
    return reply.redirect(next, 303);
  });

  // ----------------------------------------------------------- logout ------
  app.post('/v1/auth/logout', { config: { rateLimit: 'session' } }, async (req, reply) => {
    const token = req.cookies[ACCESS_COOKIE] ?? req.headers.authorization?.replace(/^Bearer /, '');
    if (token) {
      try {
        const claims = await d.tokens.verify(token, { allowExpiredUpToSeconds: d.cfg.REFRESH_TOKEN_TTL_SECONDS });
        await d.sessions.revokeSession(claims.sid, 'logout', { ...actorOf(req), actorId: claims.sub, actorType: 'USER' });
      } catch (err) {
        req.log.debug({ err }, 'logout with unusable access token');
      }
    }
    d.cookies.clearSession(reply);
    return reply.code(204).send();
  });

  app.post(
    '/v1/auth/logout-all',
    { config: { rateLimit: 'session' }, preHandler: requireUser(d, { allowPendingEnrollment: true }) },
    async (req, reply) => {
      const claims = req.auth!;
      const count = await d.sessions.revokeAll(claims.sub, 'logout_all', actorOf(req));
      d.cookies.clearSession(reply);
      return { status: 'signed_out', sessionsRevoked: count };
    },
  );

  app.get('/v1/auth/session', { config: { rateLimit: 'session' }, preHandler: requireUser(d, { allowPendingEnrollment: true }) }, async (req) => {
    // Access changed since this token was minted: make the client refresh so
    // the top bar and spokes never show yesterday's licences.
    if (req.authStale) throw unauthorized('SESSION_STALE', 'Your access changed - refresh the session');
    return { user: publicUser(req.auth!) };
  });

  // ---------------------------------------------------- email verify -------
  app.get<{ Querystring: { token?: string } }>('/v1/auth/verify-email', { config: { rateLimit: 'auth' } }, async (req, reply) => {
    const token = req.query.token ?? '';
    const fail = () => reply.redirect(`${d.cfg.webOrigin}/login?verify_error=1`, 303);
    if (token.length < 20 || token.length > 128) return fail();
    const row = await d.prisma.authToken.findUnique({ where: { tokenHash: authTokenHash(d, token) }, include: { user: true } });
    if (!row || row.purpose !== 'EMAIL_VERIFY' || row.consumedAt || row.expiresAt <= new Date()) return fail();
    if (!row.user.emailVerifiedAt) {
      // Bind verification to the person who registered: the link only counts
      // when opened by a browser signed in to this account. Otherwise a mailbox
      // owner clicking an unsolicited link would verify an account whose
      // password or ORCID belongs to someone else.
      const signedInAs = await signedInUserId(req);
      if (signedInAs !== row.userId) {
        if (signedInAs) return reply.redirect(`${d.cfg.webOrigin}/login?verify_error=wrong_account`, 303);
        const self = `${d.cfg.PUBLIC_API_URL}/v1/auth/verify-email?token=${encodeURIComponent(token)}`;
        return reply.redirect(`${d.cfg.webOrigin}/login?${new URLSearchParams({ redirect: self, verify_signin: '1' })}`, 303);
      }
    }
    await withAudit(d.prisma, { ...actorOf(req), actorId: row.userId, actorType: 'USER' }, async (tx) => {
      const claimed = await tx.authToken.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
      if (claimed.count !== 1) return;
      if (!row.user.emailVerifiedAt) {
        await tx.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
        await autoJoinOrganization(d, tx, row.userId, row.user.email);
      }
      await audit(tx, 'AUTH.EMAIL_VERIFIED', row.userId, {});
    });
    return reply.redirect(`${d.cfg.webOrigin}/workspace?verified=1`, 303);
  });

  app.post(
    '/v1/auth/verify-email/resend',
    { config: { rateLimit: 'auth' }, preHandler: requireUser(d, { allowPendingEnrollment: true }) },
    async (req, reply) => {
      const user = await d.prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub } });
      if (!user.emailVerifiedAt) await sendVerificationEmail(d, user);
      return reply.code(202).send({ status: 'sent' });
    },
  );

  // ------------------------------------------------- password reset --------
  app.post('/v1/auth/forgot-password', { config: { rateLimit: 'auth' } }, async (req, reply) => {
    const body = parse(ForgotBody, req.body);
    await requireTurnstile(d, req, body.turnstileToken);
    const user = await d.prisma.user.findUnique({ where: { email: body.email } });
    if (user && !user.disabledAt) {
      const token = randomToken(32);
      await withAudit(d.prisma, { ...actorOf(req), actorId: user.id, actorType: 'USER' }, async (tx) => {
        await tx.authToken.updateMany({ where: { userId: user.id, purpose: 'PASSWORD_RESET', consumedAt: null }, data: { consumedAt: new Date() } });
        await tx.authToken.create({
          data: { userId: user.id, purpose: 'PASSWORD_RESET', tokenHash: authTokenHash(d, token), expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS) },
        });
        await audit(tx, 'AUTH.PASSWORD_RESET_REQUESTED', user.id, {});
      });
      const link = `${d.cfg.webOrigin}/reset-password?token=${encodeURIComponent(token)}`;
      await d.mailer.send({ to: user.email, ...templates.passwordReset(user.fullName, link) }).catch((err) => req.log.error({ err }, 'reset email failed'));
    }
    // Identical response whether or not the account exists.
    return reply.code(202).send({ status: 'if_account_exists_email_sent' });
  });

  app.post('/v1/auth/reset-password', { config: { rateLimit: 'auth' } }, async (req, reply) => {
    const body = parse(ResetBody, req.body);
    const row = await d.prisma.authToken.findUnique({ where: { tokenHash: authTokenHash(d, body.token) }, include: { user: true } });
    if (!row || row.purpose !== 'PASSWORD_RESET' || row.consumedAt || row.expiresAt <= new Date() || row.user.disabledAt) {
      throw badRequest('RESET_TOKEN_INVALID', 'This reset link is invalid or has expired');
    }
    assertPasswordPolicy(body.password, row.user.email, row.user.fullName);
    const passwordHash = await hashPassword(body.password);
    const actor = { ...actorOf(req), actorId: row.userId, actorType: 'USER' as const };
    await withAudit(d.prisma, actor, async (tx) => {
      const claimed = await tx.authToken.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
      if (claimed.count !== 1) throw badRequest('RESET_TOKEN_INVALID', 'This reset link is invalid or has expired');
      // Claiming an unverified account: drop identities linked before the owner proved the mailbox.
      const unlinked = row.user.emailVerifiedAt ? 0 : await clearUnprovenSignInMethods(tx, row.userId);
      if (unlinked) await audit(tx, 'AUTH.OAUTH_UNLINKED', row.userId, { reason: 'unverified_account_claimed', count: unlinked });
      await tx.user.update({
        where: { id: row.userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
          // Following the emailed link proves mailbox ownership.
          emailVerifiedAt: row.user.emailVerifiedAt ?? new Date(),
        },
      });
      await audit(tx, 'AUTH.PASSWORD_RESET', row.userId, {});
    });
    await d.sessions.revokeAll(row.userId, 'password_reset', actor);
    await d.mailer.send({ to: row.user.email, ...templates.securityAlert(row.user.fullName, 'Your password was changed') }).catch(() => undefined);
    return reply.code(204).send();
  });

  // ------------------------------------------------- TOTP enrolment --------
  const enrolment = requireUser(d, { allowPendingEnrollment: true });

  app.post('/v1/api/mfa/enroll', { config: { rateLimit: 'api' }, preHandler: enrolment }, async (req) => {
    const user = await d.prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub } });
    if (user.mfaEnabled) throw conflict('MFA_ALREADY_ENABLED', 'Two-factor authentication is already enabled');
    const secret = generateTotpSecret();
    await d.redis.set(`mfa:enroll:${user.id}`, sealSecret(d.cfg.mfaKey, secret, `enroll:${user.id}`), 'EX', 600);
    return { otpauthUrl: otpauthUri(user.email, secret), secret, expiresInSeconds: 600 };
  });

  app.post('/v1/api/mfa/activate', { config: { rateLimit: 'auth' }, preHandler: enrolment }, async (req, reply) => {
    const { code } = parse(CodeBody, req.body);
    const claims = req.auth!;
    const sealed = await d.redis.get(`mfa:enroll:${claims.sub}`);
    if (!sealed) throw badRequest('MFA_ENROLLMENT_EXPIRED', 'Enrolment expired, please start again');
    const secret = openSecret(d.cfg.mfaKey, sealed, `enroll:${claims.sub}`);
    if (!(await verifyTotp(d.redis, claims.sub, secret, code))) {
      throw new HttpError(401, 'MFA_CODE_INVALID', 'That code did not match, check your device clock and retry');
    }
    const codes = generateRecoveryCodes();
    await withAudit(d.prisma, actorOf(req), async (tx) => {
      await tx.user.update({
        where: { id: claims.sub },
        data: { mfaSecret: sealSecret(d.cfg.mfaKey, secret, claims.sub), mfaEnabled: true, mfaEnrolledAt: new Date() },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: claims.sub } });
      await tx.mfaRecoveryCode.createMany({
        data: codes.map((c) => ({ userId: claims.sub, codeHash: hashRecoveryCode(d.cfg.REFRESH_TOKEN_PEPPER, c) })),
      });
      await tx.authSession.update({ where: { id: claims.sid }, data: { mfaVerified: true } });
      await audit(tx, 'AUTH.MFA_ENABLED', claims.sub, { session_id: claims.sid });
    });
    await d.redis.del(`mfa:enroll:${claims.sub}`);
    const fresh = await d.sessions.reissueAccess(reply, claims.sub, claims.sid);
    return { status: 'enabled', recoveryCodes: codes, user: publicUser(fresh) };
  });

  app.post('/v1/api/mfa/recovery-codes', { config: { rateLimit: 'auth' }, preHandler: requireUser(d, { mfa: true }) }, async (req) => {
    const { code } = parse(CodeBody, req.body);
    const claims = req.auth!;
    await assertTotp(d, claims.sub, code);
    const codes = generateRecoveryCodes();
    await withAudit(d.prisma, actorOf(req), async (tx) => {
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: claims.sub } });
      await tx.mfaRecoveryCode.createMany({
        data: codes.map((c) => ({ userId: claims.sub, codeHash: hashRecoveryCode(d.cfg.REFRESH_TOKEN_PEPPER, c) })),
      });
      await audit(tx, 'AUTH.MFA_RECOVERY_REGENERATED', claims.sub, {});
    });
    return { recoveryCodes: codes };
  });

  app.post('/v1/api/mfa/disable', { config: { rateLimit: 'auth' }, preHandler: requireUser(d, { mfa: true }) }, async (req, reply) => {
    const body = parse(DisableMfaBody, req.body);
    const claims = req.auth!;
    if (MFA_REQUIRED_ROLES.has(claims.role)) {
      throw new HttpError(403, 'MFA_MANDATORY', 'Two-factor authentication is mandatory for your role');
    }
    const user = await d.prisma.user.findUniqueOrThrow({ where: { id: claims.sub } });
    if (!(await verifyPassword(user.passwordHash, body.password))) throw unauthorized('INVALID_CREDENTIALS', 'Incorrect password');
    await assertTotp(d, claims.sub, body.code);
    await withAudit(d.prisma, actorOf(req), async (tx) => {
      await tx.user.update({ where: { id: claims.sub }, data: { mfaSecret: null, mfaEnabled: false, mfaEnrolledAt: null } });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: claims.sub } });
      await audit(tx, 'AUTH.MFA_DISABLED', claims.sub, {});
    });
    await d.mailer.send({ to: user.email, ...templates.securityAlert(user.fullName, 'Two-factor authentication was turned off') }).catch(() => undefined);
    const fresh = await d.sessions.reissueAccess(reply, claims.sub, claims.sid);
    return { status: 'disabled', user: publicUser(fresh) };
  });

}
