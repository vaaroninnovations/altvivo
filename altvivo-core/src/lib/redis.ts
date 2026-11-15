import { Redis } from 'ioredis';
import type { Config } from '../config.js';
import { tooMany, unavailable } from './errors.js';

export function createRedis(cfg: Config): Redis {
  return new Redis(cfg.REDIS_URL, {
    keyPrefix: cfg.REDIS_KEY_PREFIX,
    // The ACL user has no INFO-free ready check issue: INFO is granted.
    enableReadyCheck: true,
    maxRetriesPerRequest: 2,
    connectTimeout: 5000,
    lazyConnect: false,
  });
}

/** Channels are not key-prefixed by ioredis; spokes subscribe to these. */
export const BROADCAST_REGISTRY = 'core:broadcast:registry';
export const BROADCAST_REVOCATION = 'core:broadcast:revocation';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Fixed-window counter: INCR + EXPIRE in one MULTI. */
export class RateLimiter {
  constructor(private readonly redis: Redis) {}

  async hit(bucket: string, id: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const nowSec = Math.floor(Date.now() / 1000);
    const window = Math.floor(nowSec / windowSeconds);
    const key = `rl:${bucket}:${id}:${window}`;
    const res = await this.redis.multi().incr(key).expire(key, windowSeconds + 1).exec();
    const count = Number(res?.[0]?.[1] ?? 0);
    const retryAfterSeconds = (window + 1) * windowSeconds - nowSec;
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterSeconds };
  }

  /**
   * Throws 429 when over the limit. `failClosed` makes a Redis outage block the
   * request (used for credential endpoints) instead of letting it through.
   */
  async enforce(bucket: string, id: string, limit: number, windowSeconds: number, failClosed: boolean): Promise<RateLimitResult> {
    let r: RateLimitResult;
    try {
      r = await this.hit(bucket, id, limit, windowSeconds);
    } catch (err) {
      if (failClosed) throw unavailable('RATE_LIMITER_UNAVAILABLE', 'Temporarily unavailable, please retry');
      return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
    }
    if (!r.allowed) throw tooMany(r.retryAfterSeconds);
    return r;
  }
}

/**
 * Instant revocation readable by spokes (ACL: %R~core:revoked:*).
 *   core:revoked:sid:<sid>   -> "1"         a single session
 *   core:revoked:user:<uid>  -> unix seconds every token issued before it
 * Entries live as long as an access token can (TTL + margin).
 */
export class RevocationStore {
  constructor(private readonly redis: Redis, private readonly ttlSeconds: number) {}

  async revokeSession(sid: string): Promise<void> {
    await this.redis.set(`revoked:sid:${sid}`, '1', 'EX', this.ttlSeconds + 60);
    await this.redis.publish(BROADCAST_REVOCATION, JSON.stringify({ type: 'sid', id: sid })).catch(() => 0);
  }

  async revokeUser(userId: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.redis.set(`revoked:user:${userId}`, String(now), 'EX', this.ttlSeconds + 60);
    await this.redis.publish(BROADCAST_REVOCATION, JSON.stringify({ type: 'user', id: userId, before: now })).catch(() => 0);
  }

  async isRevoked(sid: string, userId: string, iat: number): Promise<boolean> {
    return (await this.tokenState(sid, userId, iat)) === 'revoked';
  }

  /** Millisecond mint time of a token (`iat_ms` claim; whole seconds for older tokens). */
  static mintedAt(c: { iat: number; iat_ms?: number }): number {
    return typeof c.iat_ms === 'number' ? c.iat_ms : c.iat * 1000;
  }

  /**
   * Access changed (purchase, refund, manual licence, plan or seat change):
   * tokens issued before now still work for identity, but the paid gate
   * treats them as expired so the browser refreshes and gets fresh
   * entitlements within one request instead of up to 15 minutes later.
   */
  async markClaimsStale(userIds: readonly string[]): Promise<void> {
    if (!userIds.length) return;
    // Millisecond precision (tokens carry iat_ms): every token minted before
    // the change is stale, the one minted by the following refresh is not.
    const now = String(Date.now());
    const m = this.redis.multi();
    for (const id of userIds) m.set(`stale:user:${id}`, now, 'EX', this.ttlSeconds + 60);
    await m.exec();
  }

  /** `mintedAtMs`: RevocationStore.mintedAt(claims); defaults to iat (seconds) when omitted. */
  async tokenState(sid: string, userId: string, iat: number, mintedAtMs = iat * 1000): Promise<'ok' | 'revoked' | 'stale'> {
    const [s, u, st] = await this.redis.mget(`revoked:sid:${sid}`, `revoked:user:${userId}`, `stale:user:${userId}`);
    if (s) return 'revoked';
    if (u !== null && u !== undefined && iat < Number(u)) return 'revoked';
    if (st !== null && st !== undefined && mintedAtMs < Number(st)) return 'stale';
    return 'ok';
  }
}
