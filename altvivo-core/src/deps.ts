import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { BlockList } from 'node:net';
import type { Config } from './config.js';
import type { CookieManager } from './lib/cookies.js';
import type { CsrfService } from './lib/csrf.js';
import type { TokenService } from './lib/jwt.js';
import type { Mailer } from './lib/mailer.js';
import type { RateLimiter, RevocationStore } from './lib/redis.js';
import type { ObjectStorage } from './lib/storage.js';
import type { TurnstileVerifier } from './lib/turnstile.js';
import type { BillingGateways } from './services/billing.js';
import type { OAuthProviders } from './services/oauth.js';
import type { SessionService } from './services/sessions.js';

/** Everything route handlers need, injected so tests can swap externals. */
export interface Deps {
  cfg: Config;
  prisma: PrismaClient;
  redis: Redis;
  tokens: TokenService;
  cookies: CookieManager;
  csrf: CsrfService;
  limiter: RateLimiter;
  revocations: RevocationStore;
  turnstile: TurnstileVerifier;
  mailer: Mailer;
  storage: ObjectStorage;
  sessions: SessionService;
  oauth: OAuthProviders;
  billing: BillingGateways;
  trustedProxies: BlockList;
}
