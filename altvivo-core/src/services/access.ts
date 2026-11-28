import type { AppStatus, PlanKind, Prisma, PrismaClient, UserRole } from '@prisma/client';
import type { AccessTier, EntitlementClaim, EntitlementSource } from '../lib/jwt.js';

/** One row of the SQL function user_access_claims() (db/migrations/20261115000000_*). */
export interface AccessRow {
  app_id: string;
  app_status: AppStatus;
  active: boolean;
  source: Exclude<EntitlementSource, 'vip'> | null;
  plan_code: string | null;
  plan_kind: PlanKind | null;
  expires_at: Date | null;
}

type Db = PrismaClient | Prisma.TransactionClient;

export async function loadAccess(db: Db, userId: string): Promise<AccessRow[]> {
  return db.$queryRaw<AccessRow[]>`
    SELECT app_id, app_status, active, source, plan_code, plan_kind, expires_at
      FROM user_access_claims(${userId}::uuid)`;
}

/** Apps a VIP may open without a grant. */
const VIP_OPEN: ReadonlySet<AppStatus> = new Set(['LIVE', 'BETA', 'MAINTENANCE']);

const NONE: EntitlementClaim = { active: false, level: 'none', source: null, plan: null, expires_at: null };

const TIER_BY_SOURCE: Record<EntitlementSource, AccessTier> = {
  vip: 'VIP',
  trial: 'TRIAL',
  payg: 'INDIVIDUAL',
  institution: 'INSTITUTIONAL',
  bundle: 'BUNDLE',
  individual: 'INDIVIDUAL',
  manual: 'INDIVIDUAL',
};
const TIER_ORDER: readonly AccessTier[] = ['NONE', 'TRIAL', 'INDIVIDUAL', 'BUNDLE', 'INSTITUTIONAL', 'VIP'];

export interface BuildOptions {
  role: UserRole;
  vipRoles: ReadonlySet<string>;
  /** False while an MFA-mandatory role has not enrolled: no VIP bypass until it has. */
  vipEligible: boolean;
}

/**
 * JWT `entitlements` + `tier`. Paid grants come from the database; the VIP
 * bypass (SUPERADMIN, ADVISORY_BOARD) is applied here so it is configurable
 * per deployment (PAID_GATE_VIP_ROLES) and never stored as a fake grant.
 */
export function buildEntitlements(rows: readonly AccessRow[], o: BuildOptions): { entitlements: Record<string, EntitlementClaim>; tier: AccessTier } {
  const vip = o.vipEligible && o.vipRoles.has(o.role);
  const entitlements: Record<string, EntitlementClaim> = {};
  let tier: AccessTier = 'NONE';
  for (const r of rows) {
    let e: EntitlementClaim = NONE;
    // VIP first: an honorary pass never expires, so a free month or a paid
    // licence held alongside it must not put an end date on the account.
    if (vip && VIP_OPEN.has(r.app_status)) {
      e = { active: true, level: 'full', source: 'vip', plan: null, expires_at: null };
    } else if (r.active) {
      e = {
        active: true,
        level: 'full',
        source: r.source,
        plan: r.plan_code,
        expires_at: r.expires_at ? Math.floor(r.expires_at.getTime() / 1000) : null,
      };
    }
    entitlements[r.app_id] = e;
    if (e.source) {
      const t = TIER_BY_SOURCE[e.source];
      if (TIER_ORDER.indexOf(t) > TIER_ORDER.indexOf(tier)) tier = t;
    }
  }
  if (vip) tier = 'VIP';
  return { entitlements, tier };
}

/** Access in force right now (claims can be up to one access-token lifetime old). */
export function isEntitled(e: EntitlementClaim | undefined, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return !!e && e.active === true && (e.expires_at === null || e.expires_at > nowSeconds);
}

/** Shape returned by the session endpoints (camel-cased, ISO dates). */
export interface ApiEntitlement {
  active: boolean;
  level: 'full' | 'none';
  source: EntitlementSource | null;
  plan: string | null;
  expiresAt: string | null;
}

export function toApiEntitlements(ents: Record<string, EntitlementClaim>): Record<string, ApiEntitlement> {
  return Object.fromEntries(
    Object.entries(ents).map(([app, e]) => [
      app,
      { active: e.active, level: e.level, source: e.source, plan: e.plan, expiresAt: e.expires_at ? new Date(e.expires_at * 1000).toISOString() : null },
    ]),
  );
}

/** Every user whose claims depend on a grant held by `owner`. */
export async function affectedUsers(db: Db, owner: { userId?: string | null; orgId?: string | null }): Promise<string[]> {
  if (owner.userId) return [owner.userId];
  if (!owner.orgId) return [];
  const members = await db.user.findMany({ where: { orgId: owner.orgId }, select: { id: true } });
  return members.map((m) => m.id);
}
