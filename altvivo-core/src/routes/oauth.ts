import type { FastifyInstance } from 'fastify';
import type { User } from '@prisma/client';
import type { Deps } from '../deps.js';
import { audit, withAudit } from '../lib/audit.js';
import { OAUTH_STATE_COOKIE } from '../lib/cookies.js';
import { randomToken, safeEqual } from '../lib/crypto.js';
import { notFound } from '../lib/errors.js';
import { safeRedirect } from '../lib/net.js';
import { actorOf } from '../plugins/security.js';
import type { OAuthIdentity, OAuthProviderId } from '../services/oauth.js';
import { autoJoinOrganization, clearUnprovenSignInMethods, completeLogin, createMfaChallenge } from './auth.js';

interface StoredState {
  provider: OAuthProviderId;
  nonce: string;
  codeVerifier: string;
  next: string;
}

const PROVIDERS = new Set<OAuthProviderId>(['google', 'orcid']);

export default async function oauthRoutes(app: FastifyInstance, d: Deps) {
  const redirectUri = (p: OAuthProviderId) => `${d.cfg.PUBLIC_API_URL}/v1/auth/oauth/${p}/callback`;
  const loginUrl = (params: Record<string, string>) => `${d.cfg.webOrigin}/login?${new URLSearchParams(params)}`;

  app.get<{ Params: { provider: string }; Querystring: { next?: string } }>(
    '/v1/auth/oauth/:provider/start',
    { config: { rateLimit: 'auth' } },
    async (req, reply) => {
      const id = req.params.provider as OAuthProviderId;
      if (!PROVIDERS.has(id) || !d.oauth[id].enabled) throw notFound('OAUTH_PROVIDER_UNAVAILABLE', 'Sign-in provider not available');
      const state = randomToken(24);
      const stored: StoredState = {
        provider: id,
        nonce: randomToken(24),
        codeVerifier: randomToken(48),
        next: safeRedirect(req.query.next, d.cfg.allowedOriginSet, `${d.cfg.webOrigin}/workspace`),
      };
      await d.redis.set(`oauth:state:${state}`, JSON.stringify(stored), 'EX', 600);
      // Binds the flow to this browser: a callback URL replayed in another
      // browser (login CSRF) has no matching cookie.
      d.cookies.setOAuthState(reply, state);
      return reply.redirect(
        d.oauth[id].authorizationUrl({ state, nonce: stored.nonce, codeVerifier: stored.codeVerifier, redirectUri: redirectUri(id) }),
        302,
      );
    },
  );

  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string; error?: string } }>(
    '/v1/auth/oauth/:provider/callback',
    { config: { rateLimit: 'session' } },
    async (req, reply) => {
      const id = req.params.provider as OAuthProviderId;
      d.cookies.clearOAuthState(reply);
      const fail = (reason: string) => reply.redirect(loginUrl({ error: reason }), 303);
      if (!PROVIDERS.has(id) || !d.oauth[id].enabled) return fail('oauth_unavailable');
      if (req.query.error) return fail('oauth_denied');
      const { code, state } = req.query;
      const cookieState = req.cookies[OAUTH_STATE_COOKIE];
      if (!code || !state || !cookieState || !safeEqual(state, cookieState)) return fail('oauth_state');
      const raw = await d.redis.getdel(`oauth:state:${state}`);
      if (!raw) return fail('oauth_expired');
      const stored = JSON.parse(raw) as StoredState;
      if (stored.provider !== id) return fail('oauth_state');

      let identity: OAuthIdentity;
      try {
        identity = await d.oauth[id].exchange(code, { state, nonce: stored.nonce, codeVerifier: stored.codeVerifier, redirectUri: redirectUri(id) });
      } catch (err) {
        req.log.warn({ err, provider: id }, 'oauth exchange failed');
        return fail('oauth_failed');
      }

      const user = await resolveUser(identity);
      if (user === 'pending') {
        const pendingId = randomToken(24);
        await d.redis.set(
          `oauth:pending:${pendingId}`,
          JSON.stringify({ provider: identity.provider, subject: identity.subject, name: identity.name, email: identity.email, emailVerified: identity.emailVerified, orcidId: identity.orcidId }),
          'EX',
          1800,
        );
        return reply.redirect(`${d.cfg.webOrigin}/register?${new URLSearchParams({ oauth: pendingId, next: stored.next })}`, 303);
      }
      if (user.disabledAt) return fail('account_disabled');

      await d.prisma.oAuthAccount.updateMany({
        where: { provider: identity.provider, providerAccountId: identity.subject },
        data: { lastUsedAt: new Date() },
      });
      if (user.mfaEnabled) {
        const challengeId = await createMfaChallenge(d, user.id, `oauth:${id}`, stored.next);
        return reply.redirect(`${d.cfg.webOrigin}/login/mfa?${new URLSearchParams({ challenge: challengeId })}`, 303);
      }
      await completeLogin(d, req, reply, user, false, `oauth:${id}`);
      return reply.redirect(stored.next, 303);

      async function resolveUser(identity: OAuthIdentity): Promise<User | 'pending'> {
        const linked = await d.prisma.oAuthAccount.findUnique({
          where: { provider_providerAccountId: { provider: identity.provider, providerAccountId: identity.subject } },
          include: { user: true },
        });
        if (linked) return linked.user;

        const actor = actorOf(req);
        if (identity.orcidId) {
          const byOrcid = await d.prisma.user.findUnique({ where: { orcidId: identity.orcidId } });
          if (byOrcid) {
            await withAudit(d.prisma, { ...actor, actorId: byOrcid.id, actorType: 'USER' }, async (tx) => {
              await tx.oAuthAccount.create({ data: { userId: byOrcid.id, provider: identity.provider, providerAccountId: identity.subject } });
              await audit(tx, 'AUTH.OAUTH_LINKED', byOrcid.id, { provider: identity.provider });
            });
            return byOrcid;
          }
        }

        if (identity.email && identity.emailVerified) {
          const byEmail = await d.prisma.user.findUnique({ where: { email: identity.email } });
          if (byEmail) {
            await withAudit(d.prisma, { ...actor, actorId: byEmail.id, actorType: 'USER' }, async (tx) => {
              const preVerified = byEmail.emailVerifiedAt !== null;
              // Same guard for identities: an ORCID linked to an unverified
              // address was not linked by the mailbox owner.
              const unlinked = preVerified ? 0 : await clearUnprovenSignInMethods(tx, byEmail.id);
              if (unlinked) await audit(tx, 'AUTH.OAUTH_UNLINKED', byEmail.id, { reason: 'unverified_account_claimed', count: unlinked });
              await tx.user.update({
                where: { id: byEmail.id },
                // Pre-registration takeover guard: if the address was never
                // verified, whoever set that password did not prove ownership.
                data: preVerified ? {} : { emailVerifiedAt: new Date(), passwordHash: null },
              });
              await tx.oAuthAccount.create({
                data: { userId: byEmail.id, provider: identity.provider, providerAccountId: identity.subject, email: identity.email },
              });
              if (!preVerified) await autoJoinOrganization(d, tx, byEmail.id, byEmail.email);
              await audit(tx, 'AUTH.OAUTH_LINKED', byEmail.id, { provider: identity.provider, cleared_unverified_password: !preVerified && !!byEmail.passwordHash });
            });
            if (!byEmail.emailVerifiedAt) await d.sessions.revokeAll(byEmail.id, 'oauth_claimed_unverified_account', actor);
            return d.prisma.user.findUniqueOrThrow({ where: { id: byEmail.id } });
          }
          return withAudit(d.prisma, actor, async (tx) => {
            const u = await tx.user.create({
              data: { email: identity.email!, fullName: identity.name.slice(0, 200), role: 'RESEARCHER', emailVerifiedAt: new Date() },
            });
            await tx.oAuthAccount.create({
              data: { userId: u.id, provider: identity.provider, providerAccountId: identity.subject, email: identity.email },
            });
            await autoJoinOrganization(d, tx, u.id, u.email);
            await audit(tx, 'AUTH.REGISTER', u.id, { method: `oauth:${identity.provider.toLowerCase()}` });
            return tx.user.findUniqueOrThrow({ where: { id: u.id } });
          });
        }
        // No verified email from the provider (ORCID): finish sign-up on the web.
        return 'pending';
      }
    },
  );

  /** Lets the registration page prefill a pending ORCID/Google sign-up. */
  app.get<{ Params: { id: string } }>('/v1/auth/oauth/pending/:id', { config: { rateLimit: 'auth' } }, async (req) => {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(req.params.id)) throw notFound();
    const raw = await d.redis.get(`oauth:pending:${req.params.id}`);
    if (!raw) throw notFound('OAUTH_PENDING_EXPIRED', 'Sign-up expired, please start again');
    const p = JSON.parse(raw) as { provider: string; name: string; email: string | null; orcidId: string | null };
    return { provider: p.provider, name: p.name, email: p.email, orcidId: p.orcidId };
  });
}
