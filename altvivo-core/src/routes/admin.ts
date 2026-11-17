import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { audit, withAudit } from '../lib/audit.js';
import { HttpError, badRequest, conflict, notFound, pgCode } from '../lib/errors.js';
import { templates } from '../lib/mailer.js';
import { actorOf, parse, requireUser } from '../plugins/security.js';
import { invalidateRegistry, toPublicApp } from '../services/registry.js';
import { assertTotp } from './auth.js';

export const totpCode = z.string().regex(/^\d{6}$/);
export const reason = z.string().trim().min(5).max(500);
export const SignedBody = z.object({ totpCode, reason });
const AppIdParam = z.object({ appId: z.string().regex(/^[a-z][a-z0-9]{1,31}$/) });
const UuidParam = z.object({ id: z.string().uuid() });

/** E-signature (21 CFR 11.200): who signed, meaning, method - recorded with every privileged change. */
export const signature = (claims: { sub: string; name: string }) => ({ signer_id: claims.sub, signer_name: claims.name, meaning: 'approved', method: 'totp' });

const AppPatchBody = z
  .object({
    status: z.enum(['LIVE', 'BETA', 'MAINTENANCE']).optional(),
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$/).optional(),
    requiresCredits: z.boolean().optional(),
    reason,
    totpCode,
  })
  .refine((b) => b.status || b.version || b.requiresCredits !== undefined, 'Nothing to change');

const PlanPatchBody = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).optional(),
    priceInrPaise: z.number().int().min(0).max(2_000_000_000).optional(),
    priceUsdCents: z.number().int().min(0).max(2_000_000_000).optional(),
    minSeats: z.number().int().min(1).max(100000).optional(),
    maxSeats: z.number().int().min(1).max(100000).nullable().optional(),
    monthlyCredits: z.number().int().min(0).max(10_000_000).optional(),
    features: z.array(z.string().trim().min(1).max(160)).max(12).optional(),
    highlighted: z.boolean().optional(),
    active: z.boolean().optional(),
    isPublic: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(32000).optional(),
    stripePriceId: z.string().regex(/^price_[A-Za-z0-9]{6,64}$/).nullable().optional(),
    reason,
    totpCode,
  })
  .refine((b) => Object.keys(b).some((k) => k !== 'reason' && k !== 'totpCode'), 'Nothing to change');

const url = (re: RegExp, msg: string) => z.string().trim().max(500).regex(re, msg);
const AdvisoryFields = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80),
  honorific: z.string().trim().max(20).nullable().optional(),
  fullName: z.string().trim().min(2).max(200),
  credentials: z.string().trim().max(200).nullable().optional(),
  designation: z.string().trim().min(2).max(200),
  affiliation: z.string().trim().min(2).max(300),
  bio: z.string().trim().min(10).max(5000),
  photoUrl: url(/^https:\/\/[^\s<>"]+$/, 'https URL required').nullable().optional(),
  photoAlt: z.string().trim().max(300).nullable().optional(),
  specializations: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
  orcidId: z.string().regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/).nullable().optional(),
  scholarUrl: url(/^https:\/\/scholar\.google\.[a-z.]{2,10}\/[^\s<>"]*$/, 'Google Scholar URL required').nullable().optional(),
  linkedinUrl: url(/^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/[^\s<>"]*$/, 'LinkedIn URL required').nullable().optional(),
  websiteUrl: url(/^https:\/\/[^\s<>"]+$/, 'https URL required').nullable().optional(),
  sortOrder: z.number().int().min(0).max(32000).default(100),
  isPublished: z.boolean().default(false),
  featured: z.boolean().default(false),
  userId: z.string().uuid().nullable().optional(),
});
const PhotoUpload = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z.number().int().min(1).max(2 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const IMAGE_MAGIC: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

export default async function adminRoutes(app: FastifyInstance, d: Deps) {
  const superadmin = requireUser(d, { roles: ['SUPERADMIN'], mfa: true });
  const opts = { config: { rateLimit: 'api' as const }, preHandler: superadmin };

  // =========================================================== dashboard ===
  app.get('/v1/api/admin/dashboard', opts, async () => {
    const q = d.prisma.$queryRaw.bind(d.prisma);
    const [mrr, byApp, kinds, sessions, revenue, users, proformas, trials, unreadMail] = await Promise.all([
      q<{ currency: string; mrr: bigint; subs: number }[]>`
        SELECT currency, coalesce(sum(mrr_minor), 0)::bigint AS mrr, count(*)::int AS subs FROM revenue_active_subscriptions GROUP BY currency`,
      q<{ app_id: string; holders: number; seats: number }[]>`
        WITH subs AS (
          SELECT pe.app_id, coalesce(s.user_id::text, 'org:' || s.org_id::text) AS holder,
                 CASE WHEN s.org_id IS NULL THEN 1 ELSE s.seats END AS seats
            FROM subscriptions s
            JOIN plan_entitlements pe ON pe.plan_code = s.plan_code
           WHERE s.status IN ('ACTIVE', 'PAST_DUE') AND coalesce(s.current_period_start, s.created_at) <= now() AND s.current_period_end > now()),
        manual AS (
          SELECT e.app_id, coalesce(e.user_id::text, 'org:' || e.org_id::text) AS holder,
                 CASE WHEN e.org_id IS NULL THEN 1 ELSE o.seat_limit END AS seats
            FROM app_entitlements e LEFT JOIN organizations o ON o.id = e.org_id
           WHERE e.source = 'MANUAL' AND e.revoked_at IS NULL AND e.starts_at <= now() AND e.expires_at > now()
             AND coalesce(e.reference, '') NOT LIKE 'TRIAL-%')
        SELECT app_id, count(DISTINCT holder)::int AS holders, coalesce(sum(seats), 0)::int AS seats
          FROM (SELECT * FROM subs UNION ALL SELECT * FROM manual) x GROUP BY app_id`,
      q<{ kind: string; subs: number; seats: number }[]>`
        SELECT plan_kind::text AS kind, count(*)::int AS subs, sum(CASE WHEN org_id IS NULL THEN 1 ELSE seats END)::int AS seats
          FROM revenue_active_subscriptions GROUP BY plan_kind`,
      q<{ active: number; users24h: number }[]>`
        SELECT count(*)::int AS active, count(DISTINCT user_id) FILTER (WHERE last_used_at > now() - interval '24 hours')::int AS users24h
          FROM auth_sessions WHERE revoked_at IS NULL AND expires_at > now()`,
      q<{ currency: string; gross: bigint; tax: bigint; refunded: bigint; payments: number }[]>`
        SELECT currency, coalesce(sum(amount_minor), 0)::bigint AS gross, coalesce(sum(tax_minor), 0)::bigint AS tax,
               coalesce(sum(refunded_minor), 0)::bigint AS refunded, count(*)::int AS payments
          FROM payments WHERE status IN ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED') AND captured_at > now() - interval '30 days'
         GROUP BY currency`,
      q<{ total: number; verified: number; new30: number; disabled: number }[]>`
        SELECT count(*)::int AS total, count(*) FILTER (WHERE email_verified_at IS NOT NULL)::int AS verified,
               count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS new30,
               count(*) FILTER (WHERE disabled_at IS NOT NULL)::int AS disabled
          FROM users`,
      q<{ open: number; currency: string; total: bigint }[]>`
        SELECT count(*)::int AS open, currency, coalesce(sum(total_minor), 0)::bigint AS total
          FROM invoices WHERE kind = 'PROFORMA' AND status = 'ISSUED' AND valid_until >= current_date GROUP BY currency`,
      q<{ pending: number; approved: number; active: number; ended: number; declined: number }[]>`
        SELECT count(*) FILTER (WHERE status = 'PENDING')::int AS pending,
               count(*) FILTER (WHERE status = 'APPROVED')::int AS approved,
               count(*) FILTER (WHERE status = 'ACTIVE' AND ends_at > now())::int AS active,
               count(*) FILTER (WHERE status = 'ACTIVE' AND ends_at <= now())::int AS ended,
               count(*) FILTER (WHERE status = 'DECLINED')::int AS declined
          FROM trial_requests`,
      d.prisma.mailMessage.count({ where: { folder: 'INBOX', isRead: false } }),
    ]);
    const n = (v: bigint) => Number(v);
    return {
      generatedAt: new Date().toISOString(),
      recurringRevenue: mrr.map((r) => ({ currency: r.currency, mrrMinor: n(r.mrr), arrMinor: n(r.mrr) * 12, subscriptions: r.subs })),
      activeLicencesByApp: byApp.map((r) => ({ appId: r.app_id, holders: r.holders, seats: r.seats })),
      activeSubscriptionsByKind: kinds,
      sessions: sessions[0] ?? { active: 0, users24h: 0 },
      revenueLast30Days: revenue.map((r) => ({ currency: r.currency, grossMinor: n(r.gross), taxMinor: n(r.tax), refundedMinor: n(r.refunded), netMinor: n(r.gross - r.tax - r.refunded), payments: r.payments })),
      users: users[0],
      openProformas: proformas.map((p) => ({ currency: p.currency, count: p.open, totalMinor: n(p.total) })),
      /** "One month free" requests: waiting for a decision, approved but not started, running, finished. */
      freeMonth: trials[0] ?? { pending: 0, approved: 0, active: 0, ended: 0, declined: 0 },
      mailbox: { unread: unreadMail },
    };
  });

  // ================================================== spoke switchboard ====
  app.get('/v1/api/admin/apps', opts, async () => {
    const apps = await d.prisma.appRegistry.findMany({ orderBy: [{ sortOrder: 'asc' }] });
    return {
      apps: apps.map((a) => ({
        ...toPublicApp(a),
        statusChangedAt: a.statusChangedAt,
        statusChangedBy: a.statusChangedBy,
      })),
    };
  });

  app.patch('/v1/api/admin/apps/:appId', opts, async (req) => {
    const { appId } = parse(AppIdParam, req.params);
    const body = parse(AppPatchBody, req.body);
    const claims = req.auth!;
    await assertTotp(d, claims.sub, body.totpCode);
    const before = await d.prisma.appRegistry.findUnique({ where: { appId } });
    if (!before) throw notFound('UNKNOWN_APP', 'Unknown application');
    const updated = await withAudit(d.prisma, actorOf(req), async (tx) => {
      const row = await tx.appRegistry.update({
        where: { appId },
        data: {
          ...(body.status ? { status: body.status } : {}),
          ...(body.version ? { version: body.version } : {}),
          ...(body.requiresCredits !== undefined ? { requiresCredits: body.requiresCredits } : {}),
        },
      });
      await audit(tx, 'ADMIN.APP_REGISTRY_CHANGE', appId, {
        signature: signature(claims),
        reason: body.reason,
        from: { status: before.status, version: before.version },
        to: { status: row.status, version: row.version },
      });
      return row;
    });
    await invalidateRegistry(d.redis, { appId, status: updated.status });
    // Every token carries per-app access flags (VIP access depends on status): refresh everyone.
    if (body.status && body.status !== before.status) {
      const ids = await d.prisma.authSession.findMany({ where: { revokedAt: null, expiresAt: { gt: new Date() } }, distinct: ['userId'], select: { userId: true } });
      await d.revocations.markClaimsStale(ids.map((s) => s.userId));
    }
    return { app: toPublicApp(updated) };
  });

  // ============================================================== pricing ===
  app.get('/v1/api/admin/plans', opts, async () => {
    const plans = await d.prisma.plan.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { entitlements: { select: { appId: true } }, _count: { select: { subscriptions: true } } },
    });
    return { plans: plans.map(({ _count, entitlements, ...p }) => ({ ...p, apps: entitlements.map((e) => e.appId), subscriptions: _count.subscriptions })) };
  });

  app.patch<{ Params: { code: string } }>('/v1/api/admin/plans/:code', opts, async (req) => {
    const { code } = parse(z.object({ code: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/) }), req.params);
    const body = parse(PlanPatchBody, req.body);
    const claims = req.auth!;
    await assertTotp(d, claims.sub, body.totpCode);
    const before = await d.prisma.plan.findUnique({ where: { planCode: code } });
    if (!before) throw notFound('UNKNOWN_PLAN', 'Unknown plan');
    const { reason: why, totpCode: _t, ...changes } = body;
    try {
      const plan = await withAudit(d.prisma, actorOf(req), async (tx) => {
        const row = await tx.plan.update({ where: { planCode: code }, data: changes });
        await audit(tx, 'ADMIN.PLAN_CHANGE', code, {
          signature: signature(claims),
          reason: why,
          from: Object.fromEntries(Object.keys(changes).map((k) => [k, (before as Record<string, unknown>)[k]])),
          to: changes,
        });
        return row;
      });
      return { plan };
    } catch (err) {
      if (pgCode(err) === '23514') throw badRequest('INVALID_PLAN', 'Seat range or pricing is inconsistent');
      if (pgCode(err) === '23505') throw conflict('PRICE_ID_IN_USE', 'That Stripe price is linked to another plan');
      throw err;
    }
  });

  // ===================================================== advisory board =====
  app.get('/v1/api/admin/advisory-board', opts, async () => ({
    members: await d.prisma.advisoryBoardMember.findMany({ orderBy: [{ sortOrder: 'asc' }, { fullName: 'asc' }] }),
  }));

  const saveMember = async (fn: () => Promise<unknown>) => {
    try {
      return await fn();
    } catch (err) {
      if (pgCode(err) === '23505') throw conflict('SLUG_TAKEN', 'Another member already uses this slug or account');
      if (pgCode(err) === '23514') throw badRequest('INVALID_MEMBER', 'A link, photo or field is not valid (photos need alt text)');
      throw err;
    }
  };

  app.post('/v1/api/admin/advisory-board', opts, async (req, reply) => {
    const body = parse(AdvisoryFields, req.body);
    const member = await saveMember(() =>
      withAudit(d.prisma, actorOf(req), (tx) => tx.advisoryBoardMember.create({ data: { ...body, createdBy: req.auth!.sub, updatedBy: req.auth!.sub } })),
    );
    return reply.code(201).send({ member });
  });

  app.patch('/v1/api/admin/advisory-board/:id', opts, async (req) => {
    const { id } = parse(UuidParam, req.params);
    const body = parse(AdvisoryFields.partial(), req.body);
    if (!(await d.prisma.advisoryBoardMember.findUnique({ where: { id }, select: { id: true } }))) throw notFound();
    const member = await saveMember(() =>
      withAudit(d.prisma, actorOf(req), (tx) => tx.advisoryBoardMember.update({ where: { id }, data: { ...body, updatedBy: req.auth!.sub } })),
    );
    return { member };
  });

  app.delete('/v1/api/admin/advisory-board/:id', opts, async (req, reply) => {
    const { id } = parse(UuidParam, req.params);
    const res = await withAudit(d.prisma, actorOf(req), (tx) => tx.advisoryBoardMember.deleteMany({ where: { id } }));
    if (!res.count) throw notFound();
    return reply.code(204).send();
  });

  app.post('/v1/api/admin/advisory-board/reorder', opts, async (req) => {
    const { ids } = parse(z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }), req.body);
    if (new Set(ids).size !== ids.length) throw badRequest('DUPLICATE_IDS', 'Each member may appear once');
    await withAudit(d.prisma, actorOf(req), async (tx) => {
      for (const [i, id] of ids.entries()) await tx.advisoryBoardMember.update({ where: { id }, data: { sortOrder: (i + 1) * 10, updatedBy: req.auth!.sub } });
    });
    return { status: 'reordered' };
  });

  /** Portrait upload straight to the public R2 bucket (signed type, size and checksum). */
  app.post('/v1/api/admin/advisory-board/:id/photo-upload', opts, async (req) => {
    const { id } = parse(UuidParam, req.params);
    const body = parse(PhotoUpload, req.body);
    if (!d.cfg.R2_BUCKET_PUBLIC) throw new HttpError(409, 'PUBLIC_BUCKET_NOT_CONFIGURED', 'Set R2_BUCKET_PUBLIC to upload portraits, or paste an https photo URL');
    if (!(await d.prisma.advisoryBoardMember.findUnique({ where: { id }, select: { id: true } }))) throw notFound();
    const ext = body.contentType.split('/')[1]!.replace('jpeg', 'jpg');
    const objectKey = `advisory/${id}/${randomUUID()}.${ext}`;
    const ttl = d.cfg.R2_PRESIGN_TTL_SECONDS;
    const signed = await d.storage.presignPut({ bucket: d.cfg.R2_BUCKET_PUBLIC, key: objectKey, contentType: body.contentType, contentLength: body.sizeBytes, sha256Hex: body.sha256, expiresIn: ttl });
    await d.redis.set(`advisory:photo:${objectKey}`, JSON.stringify({ id, contentType: body.contentType, sizeBytes: body.sizeBytes }), 'EX', ttl + 600);
    return { objectKey, uploadUrl: signed.url, method: 'PUT', headers: signed.headers };
  });

  app.post('/v1/api/admin/advisory-board/:id/photo-complete', opts, async (req) => {
    const { id } = parse(UuidParam, req.params);
    const { objectKey, photoAlt } = parse(z.object({ objectKey: z.string().regex(/^advisory\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/), photoAlt: z.string().trim().min(3).max(300) }), req.body);
    const raw = await d.redis.get(`advisory:photo:${objectKey}`);
    if (!raw) throw notFound('UPLOAD_NOT_FOUND', 'Unknown or expired upload');
    const pending = JSON.parse(raw) as { id: string; contentType: string; sizeBytes: number };
    if (pending.id !== id) throw badRequest('UPLOAD_MISMATCH', 'Upload belongs to another member');
    const head = await d.storage.head(d.cfg.R2_BUCKET_PUBLIC, objectKey);
    const sniff = head ? await d.storage.readHead(d.cfg.R2_BUCKET_PUBLIC, objectKey, 16) : Buffer.alloc(0);
    if (!head || head.size !== pending.sizeBytes || !IMAGE_MAGIC[pending.contentType]!(sniff)) {
      await d.storage.remove(d.cfg.R2_BUCKET_PUBLIC, objectKey).catch(() => undefined);
      throw new HttpError(422, 'INVALID_IMAGE', 'The uploaded file is not the declared image');
    }
    const photoUrl = `${d.cfg.R2_PUBLIC_BASE_URL.replace(/\/$/, '')}/${objectKey}`;
    const member = await withAudit(d.prisma, actorOf(req), (tx) => tx.advisoryBoardMember.update({ where: { id }, data: { photoUrl, photoAlt, updatedBy: req.auth!.sub } }));
    await d.redis.del(`advisory:photo:${objectKey}`);
    return { member };
  });

  // ========================================================= contact inbox ==
  app.get<{ Querystring: { status?: string; cursor?: string } }>('/v1/api/admin/contact', opts, async (req) => {
    const status = z.enum(['NEW', 'IN_PROGRESS', 'CLOSED', 'SPAM']).optional().parse(req.query.status || undefined);
    const rows = await d.prisma.contactMessage.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 101,
      ...(req.query.cursor && z.string().uuid().safeParse(req.query.cursor).success ? { cursor: { id: req.query.cursor }, skip: 1 } : {}),
    });
    return { messages: rows.slice(0, 100), nextCursor: rows.length > 100 ? rows[99]!.id : null };
  });

  app.patch('/v1/api/admin/contact/:id', opts, async (req) => {
    const { id } = parse(UuidParam, req.params);
    const { status } = parse(z.object({ status: z.enum(['IN_PROGRESS', 'CLOSED', 'SPAM']) }), req.body);
    const msg = await withAudit(d.prisma, actorOf(req), async (tx) => {
      const m = await tx.contactMessage.update({ where: { id }, data: { status, handledBy: req.auth!.sub, handledAt: new Date() } });
      await audit(tx, 'ADMIN.CONTACT_STATUS', id, { status });
      return m;
    });
    return { message: msg };
  });

  // ============================================================ audit trail =
  const AuditQuery = z.object({
    eventType: z.string().regex(/^[A-Z][A-Z0-9_.]*$/).max(64).optional(),
    actorId: z.string().uuid().optional(),
    appId: z.string().regex(/^[a-z][a-z0-9]{1,31}$/).optional(),
    resourceId: z.string().max(255).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    before: z.string().regex(/^\d{1,19}$/).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  });

  /** Filterable security & billing trail (eventType matches as a prefix, e.g. "BILLING." or "AUTH.LOGIN"). */
  app.get('/v1/api/admin/audit', opts, async (req) => {
    const f = parse(AuditQuery, req.query);
    const where: Prisma.AuditLogWhereInput = {
      ...(f.eventType ? { eventType: { startsWith: f.eventType } } : {}),
      ...(f.actorId ? { actorId: f.actorId } : {}),
      ...(f.appId ? { appId: f.appId } : {}),
      ...(f.resourceId ? { resourceId: f.resourceId } : {}),
      ...(f.from || f.to ? { timestamp: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
      ...(f.before ? { id: { lt: BigInt(f.before) } } : {}),
    };
    const rows = await d.prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, take: f.limit });
    return {
      events: rows.map((r) => ({ ...r, id: r.id.toString() })),
      nextBefore: rows.length === f.limit ? rows[rows.length - 1]!.id.toString() : null,
    };
  });

  app.get('/v1/api/admin/audit/verify', opts, async (req) => {
    const [v] = await d.prisma.$queryRaw<{ ok: boolean; rows_checked: bigint; first_bad_id: bigint | null; reason: string | null }[]>`
      SELECT ok, rows_checked, first_bad_id, reason FROM audit_verify_chain()`;
    await withAudit(d.prisma, actorOf(req), (tx) => audit(tx, 'ADMIN.AUDIT_VERIFIED', null, { ok: v!.ok, rows_checked: Number(v!.rows_checked) }));
    return { ok: v!.ok, rowsChecked: Number(v!.rows_checked), firstBadId: v!.first_bad_id?.toString() ?? null, reason: v!.reason };
  });
}
