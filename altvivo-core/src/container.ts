import { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import type { Deps } from './deps.js';
import { CookieManager } from './lib/cookies.js';
import { CsrfService } from './lib/csrf.js';
import { TokenService } from './lib/jwt.js';
import { SmtpMailer, type Mailer } from './lib/mailer.js';
import { buildTrustedProxies } from './lib/net.js';
import { RateLimiter, RevocationStore, createRedis } from './lib/redis.js';
import { R2Storage, type ObjectStorage } from './lib/storage.js';
import { CloudflareTurnstile, type TurnstileVerifier } from './lib/turnstile.js';
import { createBillingGateways, type BillingGateways } from './services/billing.js';
import { createOAuthProviders, type OAuthProviders } from './services/oauth.js';
import { SessionService } from './services/sessions.js';

export interface Overrides {
  prisma?: PrismaClient;
  redis?: Deps['redis'];
  turnstile?: TurnstileVerifier;
  mailer?: Mailer;
  storage?: ObjectStorage;
  oauth?: OAuthProviders;
  billing?: BillingGateways;
}

/** Wires production implementations; tests pass overrides for externals. */
export async function createDeps(cfg: Config, o: Overrides = {}): Promise<Deps> {
  const prisma = o.prisma ?? new PrismaClient({ datasourceUrl: cfg.DATABASE_URL });
  const redis = o.redis ?? createRedis(cfg);
  const tokens = await TokenService.create(cfg);
  const cookies = new CookieManager(cfg);
  const revocations = new RevocationStore(redis, cfg.ACCESS_TOKEN_TTL_SECONDS);
  const mailer = o.mailer ?? new SmtpMailer(cfg);
  return {
    cfg,
    prisma,
    redis,
    tokens,
    cookies,
    csrf: new CsrfService(cfg.CSRF_SECRET),
    limiter: new RateLimiter(redis),
    revocations,
    turnstile: o.turnstile ?? new CloudflareTurnstile(cfg.TURNSTILE_SECRET_KEY, cfg.TURNSTILE_ALLOWED_HOSTNAMES),
    mailer,
    storage: o.storage ?? new R2Storage(cfg),
    sessions: new SessionService(cfg, prisma, tokens, cookies, revocations, mailer),
    oauth: o.oauth ?? createOAuthProviders(cfg),
    billing: o.billing ?? createBillingGateways(cfg),
    trustedProxies: buildTrustedProxies(cfg.TRUSTED_PROXY_CIDRS),
  };
}
