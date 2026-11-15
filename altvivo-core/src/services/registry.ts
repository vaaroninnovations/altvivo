import type { AppRegistry, PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { BROADCAST_REGISTRY } from '../lib/redis.js';

export interface PublicApp {
  appId: string;
  name: string;
  tagline: string;
  description: string;
  url: string;
  status: AppRegistry['status'];
  version: string;
  requiresCredits: boolean;
  phase: number;
  sortOrder: number;
  iconKey: string;
  highlights: string[];
}

// Read by spokes / the top bar too (ACL grants spokes %R~core:registry:*).
const CACHE_KEY = 'registry:apps';
const CACHE_TTL = 60;

export const toPublicApp = (a: AppRegistry): PublicApp => ({
  appId: a.appId,
  name: a.name,
  tagline: a.tagline,
  description: a.description,
  url: a.subdomainUrl,
  status: a.status,
  version: a.version,
  requiresCredits: a.requiresCredits,
  phase: a.phase,
  sortOrder: a.sortOrder,
  iconKey: a.iconKey,
  highlights: a.highlights,
});

export async function listApps(prisma: PrismaClient, redis: Redis): Promise<PublicApp[]> {
  const cached = await redis.get(CACHE_KEY).catch(() => null);
  if (cached) return JSON.parse(cached) as PublicApp[];
  const apps = (await prisma.appRegistry.findMany({ orderBy: [{ sortOrder: 'asc' }, { appId: 'asc' }] })).map(toPublicApp);
  await redis.set(CACHE_KEY, JSON.stringify(apps), 'EX', CACHE_TTL).catch(() => undefined);
  return apps;
}

// Per-process memo for /v1/auth/verify, which runs on every asset request to a
// paid spoke: at most one Redis read per MEMO_MS, a DB read only on cache miss.
const MEMO_MS = 5_000;
let memo: { at: number; apps: Map<string, PublicApp> } | null = null;

export async function appIndex(prisma: PrismaClient, redis: Redis): Promise<Map<string, PublicApp>> {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.apps;
  const apps = new Map((await listApps(prisma, redis)).map((a) => [a.appId, a]));
  memo = { at: Date.now(), apps };
  return apps;
}

export async function invalidateRegistry(redis: Redis, change: Record<string, unknown>): Promise<void> {
  memo = null;
  await redis.del(CACHE_KEY).catch(() => 0);
  await redis.publish(BROADCAST_REGISTRY, JSON.stringify({ type: 'registry_changed', ...change, at: new Date().toISOString() })).catch(() => 0);
}
