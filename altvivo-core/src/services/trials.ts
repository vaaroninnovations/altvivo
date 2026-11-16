import type { TrialRequest } from '@prisma/client';
import type { Deps } from '../deps.js';
import { audit, withAudit, type AuditActor, type Tx } from '../lib/audit.js';

/** Reference stamped on every licence of a free month; user_access_claims() reports it as source 'trial'. */
export const trialReference = (requestId: string) => `TRIAL-${requestId.slice(0, 8).toUpperCase()}`;

/** Apps a free month can cover: only what a person could open today. */
export async function trialAppIds(d: Deps): Promise<string[]> {
  const apps = await d.prisma.appRegistry.findMany({ where: { status: { in: ['LIVE', 'BETA'] } }, orderBy: { sortOrder: 'asc' }, select: { appId: true } });
  return apps.map((a) => a.appId);
}

export interface ApiTrial {
  id: string;
  status: TrialRequest['status'];
  days: number;
  appIds: string[];
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  /** True once the free month has run out. */
  ended: boolean;
}

export const toApiTrial = (t: TrialRequest): ApiTrial => ({
  id: t.id,
  status: t.status,
  days: t.days,
  appIds: t.appIds,
  startsAt: t.startsAt?.toISOString() ?? null,
  endsAt: t.endsAt?.toISOString() ?? null,
  createdAt: t.createdAt.toISOString(),
  ended: t.status === 'ACTIVE' && !!t.endsAt && t.endsAt <= new Date(),
});

/** The request that counts for an address: the live one (not declined), else the latest declined one. */
export async function trialForEmail(d: Deps, email: string): Promise<TrialRequest | null> {
  const rows = await d.prisma.trialRequest.findMany({ where: { email }, orderBy: { createdAt: 'desc' }, take: 5 });
  return rows.find((r) => r.status !== 'DECLINED') ?? rows[0] ?? null;
}

/**
 * Grants the licences of an approved request to `userId`, starting now.
 * Runs inside the caller's audited transaction. The licences are MANUAL
 * entitlements granted in the name of the SUPERADMIN who approved the request
 * (the database refuses any other grantor).
 */
export async function activateTrial(tx: Tx, request: TrialRequest, userId: string): Promise<TrialRequest> {
  if (!request.decidedBy) throw new Error('trial request has no approver');
  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + request.days * 86_400_000);
  const open = await tx.appRegistry.findMany({ where: { appId: { in: request.appIds }, status: { in: ['LIVE', 'BETA', 'MAINTENANCE'] } }, select: { appId: true } });
  for (const { appId } of open) {
    await tx.appEntitlement.create({
      data: {
        appId, source: 'MANUAL', userId, grantedBy: request.decidedBy, startsAt, expiresAt: endsAt,
        reason: `One month free (${request.days} days), request ${request.id}`, reference: trialReference(request.id),
      },
    });
  }
  const updated = await tx.trialRequest.update({ where: { id: request.id }, data: { status: 'ACTIVE', userId, startsAt, endsAt } });
  await audit(tx, 'TRIAL.ACTIVATED', request.id, { user_id: userId, apps: open.map((a) => a.appId), days: request.days, ends_at: endsAt.toISOString() });
  return updated;
}

/**
 * Called when an account proves its e-mail address: starts the free month
 * that was approved for that address before the account existed (or before
 * it was verified). Never throws - sign-up must not fail because of it.
 */
export async function claimApprovedTrial(d: Deps, user: { id: string; email: string }, actor: AuditActor, log?: { warn: (o: unknown, m: string) => void }): Promise<boolean> {
  try {
    const request = await d.prisma.trialRequest.findFirst({ where: { email: user.email, status: 'APPROVED' } });
    if (!request) return false;
    await withAudit(d.prisma, { ...actor, actorId: user.id, actorType: 'USER' }, async (tx) => {
      const fresh = await tx.trialRequest.updateMany({ where: { id: request.id, status: 'APPROVED' }, data: { updatedAt: new Date() } });
      if (fresh.count === 1) await activateTrial(tx, request, user.id);
    });
    await d.revocations.markClaimsStale([user.id]);
    return true;
  } catch (err) {
    log?.warn({ err, userId: user.id }, 'approved free month could not be started');
    return false;
  }
}
