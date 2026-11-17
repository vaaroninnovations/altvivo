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

/** Apps a running free month holds a licence for: everything a person could open, including apps briefly in maintenance. */
const grantableApps = (tx: Tx) =>
  tx.appRegistry.findMany({ where: { status: { in: ['LIVE', 'BETA', 'MAINTENANCE'] } }, orderBy: { sortOrder: 'asc' }, select: { appId: true } });

/**
 * Brings every free month up to "all applications": running ones get a licence
 * for each open app they lack (ending with the free month), and waiting ones
 * (pending or approved) list every app. Idempotent. Returns the users whose
 * access changed, so their sign-in claims can be refreshed.
 */
export async function extendTrialsToAllApps(tx: Tx): Promise<{ users: string[]; licences: number; requests: number }> {
  const now = new Date();
  const open = await grantableApps(tx);
  const all = open.map((a) => a.appId);
  const users = new Set<string>();
  let licences = 0;
  const running = await tx.trialRequest.findMany({ where: { status: 'ACTIVE', endsAt: { gt: now }, userId: { not: null }, decidedBy: { not: null } } });
  for (const r of running) {
    const have = new Set(
      (await tx.appEntitlement.findMany({ where: { userId: r.userId!, reference: trialReference(r.id) }, select: { appId: true } })).map((e) => e.appId),
    );
    const missing = all.filter((a) => !have.has(a));
    for (const appId of missing) {
      await tx.appEntitlement.create({
        data: {
          appId, source: 'MANUAL', userId: r.userId!, grantedBy: r.decidedBy!, startsAt: now, expiresAt: r.endsAt!,
          reason: `One month free (${r.days} days), request ${r.id}: extended to every application`, reference: trialReference(r.id),
        },
      });
      licences++;
    }
    if (missing.length) {
      users.add(r.userId!);
      await audit(tx, 'TRIAL.EXTENDED', r.id, { user_id: r.userId, apps: missing, ends_at: r.endsAt!.toISOString() });
    }
    if (missing.length || r.appIds.length !== all.length || !all.every((a) => r.appIds.includes(a))) {
      await tx.trialRequest.update({ where: { id: r.id }, data: { appIds: Array.from(new Set([...r.appIds, ...all])) } });
    }
  }
  const waiting = await tx.trialRequest.findMany({ where: { status: { in: ['PENDING', 'APPROVED'] } }, select: { id: true, appIds: true } });
  let requests = 0;
  for (const r of waiting) {
    if (all.every((a) => r.appIds.includes(a))) continue;
    await tx.trialRequest.update({ where: { id: r.id }, data: { appIds: Array.from(new Set([...r.appIds, ...all])) } });
    requests++;
  }
  return { users: [...users], licences, requests };
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
  // A free month covers every application that is open, whatever was ticked on the request.
  const open = await grantableApps(tx);
  for (const { appId } of open) {
    await tx.appEntitlement.create({
      data: {
        appId, source: 'MANUAL', userId, grantedBy: request.decidedBy, startsAt, expiresAt: endsAt,
        reason: `One month free (${request.days} days), request ${request.id}`, reference: trialReference(request.id),
      },
    });
  }
  const updated = await tx.trialRequest.update({ where: { id: request.id }, data: { status: 'ACTIVE', userId, startsAt, endsAt, appIds: open.map((a) => a.appId) } });
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
