import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { audit, withAudit } from '../lib/audit.js';
import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { templates } from '../lib/mailer.js';
import { assertPasswordPolicy, hashPassword, verifyPassword } from '../lib/password.js';
import { actorOf, parse, requireUser } from '../plugins/security.js';
import { buildEntitlements, loadAccess, toApiEntitlements } from '../services/access.js';
import { listApps } from '../services/registry.js';
import { MFA_REQUIRED_ROLES } from '../services/sessions.js';
import { publicUser } from './auth.js';

const ProfileBody = z
  .object({
    fullName: z.string().trim().min(2).max(200).optional(),
    affiliation: z.string().trim().max(300).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

const PasswordBody = z.object({ currentPassword: z.string().max(128).optional(), newPassword: z.string().max(128) });
const AppIdParam = z.object({ appId: z.string().regex(/^[a-z][a-z0-9]{1,31}$/) });
const UuidParam = z.object({ id: z.string().uuid() });

export default async function meRoutes(app: FastifyInstance, d: Deps) {
  const auth = requireUser(d);
  const opts = { config: { rateLimit: 'api' as const }, preHandler: auth };

  app.get('/v1/api/me', opts, async (req) => {
    const claims = req.auth!;
    const user = await d.prisma.user.findUniqueOrThrow({
      where: { id: claims.sub },
      include: { organization: { select: { id: true, name: true, kind: true, status: true, seatLimit: true, domainWhitelist: true } } },
    });
    return {
      user: publicUser(claims),
      profile: {
        fullName: user.fullName,
        affiliation: user.affiliation,
        orcidId: user.orcidId,
        hasPassword: user.passwordHash !== null,
        mfaEnabled: user.mfaEnabled,
        emailVerified: user.emailVerifiedAt !== null,
        createdAt: user.createdAt,
      },
      organization: user.organization,
    };
  });

  /** Everything the /workspace App Launcher renders, in one round trip. */
  app.get('/v1/api/workspace', opts, async (req) => {
    const claims = req.auth!;
    const user = await d.prisma.user.findUniqueOrThrow({ where: { id: claims.sub }, select: { role: true, mfaEnabled: true, disabledAt: true } });
    const [apps, rows, waitlist, files, activity, credits] = await Promise.all([
      listApps(d.prisma, d.redis),
      loadAccess(d.prisma, claims.sub),
      d.prisma.appWaitlist.findMany({ where: { OR: [{ userId: claims.sub }, { email: claims.email }] }, select: { appId: true } }),
      d.prisma.workspaceFile.findMany({
        where: { ownerId: claims.sub, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, sourceApp: true, fileName: true, fileType: true, sizeBytes: true, createdAt: true },
      }),
      d.prisma.auditLog.findMany({
        where: { actorId: claims.sub, appId: { in: ['xprism', 'amaze'] } },
        orderBy: { id: 'desc' },
        take: 20,
        select: { id: true, timestamp: true, appId: true, eventType: true, resourceId: true, metadata: true },
      }),
      d.prisma.$queryRaw<{ balance: number }[]>`SELECT credit_balance_for_user(${claims.sub}::uuid) AS balance`,
    ]);
    // Live view (not the possibly 15-minute-old token) so a purchase shows at once.
    const { entitlements } = buildEntitlements(rows, {
      role: user.role,
      vipRoles: d.cfg.vipRoles,
      vipEligible: user.disabledAt === null && (!MFA_REQUIRED_ROLES.has(user.role) || (user.mfaEnabled && claims.mfa)),
    });
    const api = toApiEntitlements(entitlements);
    const listed = new Set(waitlist.map((w) => w.appId));
    return {
      user: publicUser(claims),
      creditsRemaining: Number(credits[0]?.balance ?? 0),
      apps: apps.map((a) => ({
        ...a,
        entitlement: api[a.appId] ?? { active: false, level: 'none', source: null, plan: null, expiresAt: null },
        upgradeUrl: `${d.cfg.webOrigin}/workspace/upgrade?app=${a.appId}&reason=subscription_required`,
        onWaitlist: listed.has(a.appId),
      })),
      recentFiles: files.map((f) => ({ ...f, sizeBytes: Number(f.sizeBytes) })),
      recentActivity: activity.map((a) => ({ ...a, id: a.id.toString() })),
    };
  });

  app.patch('/v1/api/me', opts, async (req, reply) => {
    const body = parse(ProfileBody, req.body);
    const claims = req.auth!;
    await withAudit(d.prisma, actorOf(req), (tx) =>
      tx.user.update({
        where: { id: claims.sub },
        data: {
          ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
          ...(body.affiliation !== undefined ? { affiliation: body.affiliation } : {}),
        },
      }),
    );
    const fresh = await d.sessions.reissueAccess(reply, claims.sub, claims.sid);
    return { user: publicUser(fresh) };
  });

  app.post('/v1/api/me/password', { config: { rateLimit: 'auth' }, preHandler: auth }, async (req, reply) => {
    const body = parse(PasswordBody, req.body);
    const claims = req.auth!;
    const user = await d.prisma.user.findUniqueOrThrow({ where: { id: claims.sub } });
    if (user.passwordHash) {
      if (!body.currentPassword || !(await verifyPassword(user.passwordHash, body.currentPassword))) {
        throw unauthorized('INVALID_CREDENTIALS', 'Current password is incorrect');
      }
    }
    assertPasswordPolicy(body.newPassword, user.email, user.fullName);
    const passwordHash = await hashPassword(body.newPassword);
    await withAudit(d.prisma, actorOf(req), async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: new Date() } });
      await audit(tx, 'AUTH.PASSWORD_CHANGED', user.id, { had_password: user.passwordHash !== null });
    });
    const revoked = await d.sessions.revokeAll(user.id, 'password_changed', actorOf(req), claims.sid);
    await d.mailer.send({ to: user.email, ...templates.securityAlert(user.fullName, 'Your password was changed') }).catch(() => undefined);
    return reply.send({ status: 'changed', otherSessionsRevoked: revoked });
  });

  app.get('/v1/api/sessions', opts, async (req) => {
    const claims = req.auth!;
    const sessions = await d.prisma.authSession.findMany({
      where: { userId: claims.sub, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true, createdAt: true, lastUsedAt: true, ipAddress: true, userAgent: true, mfaVerified: true },
    });
    return { sessions: sessions.map((s) => ({ ...s, current: s.id === claims.sid })) };
  });

  app.delete('/v1/api/sessions/:id', opts, async (req, reply) => {
    const { id } = parse(UuidParam, req.params);
    const claims = req.auth!;
    const s = await d.prisma.authSession.findUnique({ where: { id }, select: { userId: true } });
    if (!s || s.userId !== claims.sub) throw notFound();
    await d.sessions.revokeSession(id, 'user_revoked', actorOf(req));
    if (id === claims.sid) d.cookies.clearSession(reply);
    return reply.code(204).send();
  });

  // ------------------------------------------- early-access toggles --------
  app.post('/v1/api/waitlist/:appId', opts, async (req, reply) => {
    const { appId } = parse(AppIdParam, req.params);
    const claims = req.auth!;
    const appRow = await d.prisma.appRegistry.findUnique({ where: { appId }, select: { status: true } });
    if (!appRow) throw notFound('UNKNOWN_APP', 'Unknown application');
    if (appRow.status === 'LIVE') throw badRequest('APP_ALREADY_LIVE', 'This application is already available');
    await withAudit(d.prisma, actorOf(req), async (tx) => {
      await tx.appWaitlist.upsert({
        where: { email_appId: { email: claims.email, appId } },
        create: { email: claims.email, appId, userId: claims.sub, source: 'workspace' },
        update: { userId: claims.sub },
      });
      await audit(tx, 'WAITLIST.JOIN', appId, { source: 'workspace' });
    });
    return reply.code(201).send({ appId, onWaitlist: true });
  });

  app.delete('/v1/api/waitlist/:appId', opts, async (req) => {
    const { appId } = parse(AppIdParam, req.params);
    const claims = req.auth!;
    await withAudit(d.prisma, actorOf(req), async (tx) => {
      const res = await tx.appWaitlist.deleteMany({ where: { appId, OR: [{ userId: claims.sub }, { email: claims.email }] } });
      if (res.count) await audit(tx, 'WAITLIST.LEAVE', appId, {});
    });
    return { appId, onWaitlist: false };
  });

  app.get<{ Querystring: { limit?: string } }>('/v1/api/credits/ledger', opts, async (req) => {
    const claims = req.auth!;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
    const user = await d.prisma.user.findUniqueOrThrow({ where: { id: claims.sub }, select: { orgId: true } });
    const account = await d.prisma.creditAccount.findFirst({ where: user.orgId ? { orgId: user.orgId } : { userId: claims.sub } });
    if (!account) return { balance: 0, entries: [] };
    const entries = await d.prisma.creditLedger.findMany({
      where: { accountId: account.id, ...(user.orgId && claims.role !== 'INSTITUTE_ADMIN' && claims.role !== 'PI' ? { userId: claims.sub } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, appId: true, actionType: true, delta: true, balanceAfter: true, referenceId: true, createdAt: true, userId: true },
    });
    return { balance: account.balance, pool: user.orgId ? 'organization' : 'personal', entries };
  });

  // -------------------------------------------------------- vault ---------
  app.get<{ Querystring: { app?: string; limit?: string } }>('/v1/api/vault/files', opts, async (req) => {
    const claims = req.auth!;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
    const files = await d.prisma.workspaceFile.findMany({
      where: { ownerId: claims.sub, deletedAt: null, ...(req.query.app ? { sourceApp: req.query.app } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, sourceApp: true, fileName: true, fileType: true, sizeBytes: true, sha256Hash: true, createdAt: true },
    });
    return { files: files.map((f) => ({ ...f, sizeBytes: Number(f.sizeBytes) })) };
  });

  app.get('/v1/api/vault/files/:id/download', opts, async (req) => {
    const { id } = parse(UuidParam, req.params);
    const claims = req.auth!;
    const file = await d.prisma.workspaceFile.findUnique({ where: { id } });
    if (!file || file.deletedAt || file.ownerId !== claims.sub) throw notFound();
    const url = await d.storage.presignGet(d.cfg.R2_BUCKET_VAULT, file.r2ObjectKey, d.cfg.R2_PRESIGN_TTL_SECONDS, file.fileName);
    await withAudit(d.prisma, actorOf(req), (tx) => audit(tx, 'VAULT.DOWNLOAD', file.id, { source_app: file.sourceApp }));
    return { url, expiresInSeconds: d.cfg.R2_PRESIGN_TTL_SECONDS, sha256: file.sha256Hash };
  });

  app.delete('/v1/api/vault/files/:id', opts, async (req, reply) => {
    const { id } = parse(UuidParam, req.params);
    const claims = req.auth!;
    const file = await d.prisma.workspaceFile.findUnique({ where: { id }, select: { ownerId: true, deletedAt: true } });
    if (!file || file.deletedAt) throw notFound();
    if (file.ownerId !== claims.sub) throw forbidden();
    // Soft delete only: the record (and its hash) is retained for audit.
    await withAudit(d.prisma, actorOf(req), (tx) => tx.workspaceFile.update({ where: { id }, data: { deletedAt: new Date() } }));
    return reply.code(204).send();
  });
}
