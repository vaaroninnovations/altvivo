import type { FastifyBaseLogger } from 'fastify';
import type { UserRole } from '@prisma/client';
import type { Deps } from '../deps.js';
import { systemActor, withAudit } from '../lib/audit.js';
import { randomToken } from '../lib/crypto.js';
import { templates } from '../lib/mailer.js';
import { affectedUsers } from '../services/access.js';

const LOCK_KEY = 'jobs:maintenance:lock';
const DRAFT_TTL_DAYS = 7;
const REMINDER_DAYS = 7;
const TRIAL_REMINDER_DAYS = 5;

/**
 * Hourly housekeeping, run by whichever replica wins a Redis lock:
 *   - delete refresh tokens / auth tokens long past expiry; expire sessions
 *   - EXPIRE prepaid (ONE_TIME) terms past their period end and refresh the
 *     holders' claims (access already stopped at period end via expires_at)
 *   - delete checkout DRAFT invoices abandoned for a week (no payment)
 *   - renewal reminders 7 days before a prepaid term ends (once per term)
 *   - a reminder 5 days before a free month ends (once per request)
 * Security-relevant history stays in audit_logs.
 */
export async function runMaintenance(d: Deps, log: FastifyBaseLogger): Promise<void> {
  const owner = randomToken(12);
  const got = await d.redis.set(LOCK_KEY, owner, 'EX', 300, 'NX');
  if (got !== 'OK') return;
  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const [rt, at, sessions] = await Promise.all([
      d.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
      d.prisma.authToken.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
      d.prisma.authSession.updateMany({ where: { expiresAt: { lt: now }, revokedAt: null }, data: { revokedAt: now, revokeReason: 'expired' } }),
    ]);

    // Prepaid terms that ran out.
    const ended = await d.prisma.subscription.findMany({
      where: { billingMode: 'ONE_TIME', status: { in: ['ACTIVE', 'PAST_DUE'] }, currentPeriodEnd: { lte: now } },
      select: { id: true, userId: true, orgId: true },
      take: 1000,
    });
    if (ended.length) {
      await withAudit(d.prisma, systemActor(), (tx) =>
        tx.subscription.updateMany({ where: { id: { in: ended.map((s) => s.id) } }, data: { status: 'EXPIRED', endedAt: now } }),
      );
      const users = new Set<string>();
      for (const s of ended) for (const u of await affectedUsers(d.prisma, s)) users.add(u);
      await d.revocations.markClaimsStale([...users]);
    }

    // Abandoned checkout drafts (never paid: a draft with a payment is never deleted).
    const drafts = await d.prisma.invoice.findMany({
      where: { status: 'DRAFT', kind: 'TAX_INVOICE', createdAt: { lt: new Date(now.getTime() - DRAFT_TTL_DAYS * 86_400_000) }, payments: { none: {} } },
      select: { id: true },
      take: 500,
    });
    if (drafts.length) {
      await withAudit(d.prisma, systemActor(), (tx) => tx.invoice.deleteMany({ where: { id: { in: drafts.map((x) => x.id) }, status: 'DRAFT' } }));
    }

    // Renewal reminders for prepaid terms ending within REMINDER_DAYS.
    const soon = await d.prisma.subscription.findMany({
      where: {
        billingMode: 'ONE_TIME',
        status: 'ACTIVE',
        currentPeriodEnd: { gt: now, lte: new Date(now.getTime() + REMINDER_DAYS * 86_400_000) },
      },
      include: { plan: { select: { name: true } }, user: { select: { email: true, fullName: true } }, organization: { select: { billingProfile: { select: { email: true, legalName: true } } } } },
      take: 500,
    });
    let reminders = 0;
    for (const s of soon) {
      // Already renewed (a later term starts when this one ends)?
      const renewed = await d.prisma.subscription.count({
        where: { id: { not: s.id }, planCode: s.planCode, status: 'ACTIVE', currentPeriodEnd: { gt: s.currentPeriodEnd }, ...(s.orgId ? { orgId: s.orgId } : { userId: s.userId }) },
      });
      if (renewed) continue;
      const to = s.user?.email ?? s.organization?.billingProfile?.email;
      const name = s.user?.fullName ?? s.organization?.billingProfile?.legalName ?? 'there';
      if (!to) continue;
      const key = `jobs:renewal-reminder:${s.id}`;
      if ((await d.redis.set(key, '1', 'EX', 30 * 86_400, 'NX')) !== 'OK') continue;
      const endsOn = s.currentPeriodEnd.toISOString().slice(0, 10);
      await d.mailer
        .send({ to, ...templates.renewalReminder(name, s.plan.name, endsOn, `${d.cfg.webOrigin}/pricing?renew=${s.planCode}`) })
        .then(() => (reminders += 1))
        .catch(async (err) => {
          await d.redis.del(key);
          log.warn({ err, subscription: s.id }, 'renewal reminder failed');
        });
    }

    // Free months about to end: one reminder, unless the person already holds a paid licence.
    const trialsEnding = await d.prisma.trialRequest.findMany({
      where: { status: 'ACTIVE', endsAt: { gt: now, lte: new Date(now.getTime() + TRIAL_REMINDER_DAYS * 86_400_000) }, userId: { not: null } },
      take: 500,
    });
    let trialReminders = 0;
    const vipIds = new Set(
      trialsEnding.length
        ? (await d.prisma.user.findMany({ where: { id: { in: trialsEnding.map((t) => t.userId!) }, role: { in: [...d.cfg.vipRoles] as UserRole[] } }, select: { id: true } })).map((u) => u.id)
        : [],
    );
    for (const t of trialsEnding) {
      // VIP roles keep access when the month ends, so there is nothing to remind them of.
      if (vipIds.has(t.userId!)) continue;
      const paid = await d.prisma.subscription.count({ where: { userId: t.userId, status: { in: ['ACTIVE', 'PAST_DUE'] }, currentPeriodEnd: { gt: t.endsAt! } } });
      if (paid) continue;
      const key = `jobs:trial-reminder:${t.id}`;
      if ((await d.redis.set(key, '1', 'EX', 30 * 86_400, 'NX')) !== 'OK') continue;
      await d.mailer
        .send({ to: t.email, ...templates.trialEnding(t.name, t.endsAt!.toISOString().slice(0, 10), `${d.cfg.webOrigin}/pricing`) })
        .then(() => (trialReminders += 1))
        .catch(async (err) => {
          await d.redis.del(key);
          log.warn({ err, trial: t.id }, 'free month reminder failed');
        });
    }

    log.info(
      { trialReminders, refreshTokens: rt.count, authTokens: at.count, sessionsExpired: sessions.count, termsExpired: ended.length, draftsDeleted: drafts.length, reminders },
      'maintenance complete',
    );
  } finally {
    if ((await d.redis.get(LOCK_KEY)) === owner) await d.redis.del(LOCK_KEY);
  }
}

export function scheduleMaintenance(d: Deps, log: FastifyBaseLogger): NodeJS.Timeout {
  const tick = () => runMaintenance(d, log).catch((err) => log.error({ err }, 'maintenance failed'));
  setTimeout(tick, 60_000).unref();
  const t = setInterval(tick, 3600_000);
  t.unref();
  return t;
}
