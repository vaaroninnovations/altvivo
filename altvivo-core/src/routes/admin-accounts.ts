import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { audit, withAudit } from '../lib/audit.js';
import { HttpError, badRequest, conflict, notFound, pgCode } from '../lib/errors.js';
import { templates } from '../lib/mailer.js';
import { actorOf, parse, requireUser } from '../plugins/security.js';
import { affectedUsers, buildEntitlements, loadAccess, toApiEntitlements } from '../services/access.js';
import { createProforma, recordOfflinePayment } from '../services/checkout.js';
import { assertInvoicing, draftFrom, fullCreditNote, issue, lockInvoice, toApiInvoice } from '../services/invoices.js';
import { MFA_REQUIRED_ROLES } from '../services/sessions.js';
import { reason, signature, SignedBody, totpCode } from './admin.js';
import { assertTotp } from './auth.js';
import { ProfileFields, pdfLink } from './billing.js';

const UuidParam = z.object({ id: z.string().uuid() });
const domain = z.string().trim().toLowerCase().regex(/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);
const ROLES = ['STUDENT', 'RESEARCHER', 'PI', 'INSTITUTE_ADMIN', 'ADVISORY_BOARD', 'SUPERADMIN'] as const;

const UserPatchBody = z
  .object({
    role: z.enum(ROLES).optional(),
    orgId: z.string().uuid().nullable().optional(),
    disabled: z.boolean().optional(),
    reason,
    totpCode,
  })
  .refine((b) => b.role || b.orgId !== undefined || b.disabled !== undefined, 'Nothing to change');

const LicenceBody = z
  .object({
    appId: z.string().regex(/^[a-z][a-z0-9]{1,31}$/),
    userId: z.string().uuid().optional(),
    orgId: z.string().uuid().optional(),
    startsAt: z.coerce.date().optional(),
    expiresAt: z.coerce.date(),
    reason,
    reference: z.string().trim().max(120).optional(),
    totpCode,
  })
  .refine((b) => !!b.userId !== !!b.orgId, 'Grant to exactly one user or organization')
  .refine((b) => b.expiresAt > (b.startsAt ?? new Date()), 'Expiry must be after the start');

const LicencePatch = z
  .object({ expiresAt: z.coerce.date().optional(), reason: reason.optional(), reference: z.string().trim().max(120).nullable().optional(), totpCode })
  .refine((b) => b.expiresAt || b.reason || b.reference !== undefined, 'Nothing to change');

const OrgFields = z.object({
  name: z.string().trim().min(2).max(300),
  kind: z.enum(['UNIVERSITY', 'COLLEGE', 'RESEARCH_INSTITUTE', 'HOSPITAL', 'COMPANY', 'GOVERNMENT', 'OTHER']).default('COLLEGE'),
  domainWhitelist: z.array(domain).max(50).default([]),
  seatLimit: z.number().int().min(1).max(100000),
  billingCountry: z.string().regex(/^[A-Z]{2}$/),
  contactName: z.string().trim().max(200).nullable().optional(),
  contactEmail: z.string().trim().toLowerCase().email().max(254).nullable().optional(),
  contactPhone: z.string().trim().regex(/^\+?[0-9][0-9 ()-]{5,19}$/).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
const OrgCreate = OrgFields.extend({ totpCode });
const OrgPatch = OrgFields.partial().extend({ status: z.enum(['ACTIVE', 'SUSPENDED']).optional(), reason, totpCode });

const ProformaBody = z.object({
  planCode: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  seats: z.number().int().min(1).max(100000),
  poNumber: z.string().trim().max(64).optional(),
  notes: z.string().trim().max(2000).optional(),
  discountMinor: z.number().int().min(0).optional(),
  validDays: z.number().int().min(1).max(180).optional(),
});
const OfflineBody = z.object({
  amountMinor: z.number().int().positive(),
  method: z.enum(['neft', 'rtgs', 'imps', 'cheque', 'upi', 'wire']),
  reference: z.string().trim().min(4).max(120),
  paidAt: z.coerce.date(),
  totpCode,
});
const CreditBody = z.union([
  z.object({ mode: z.literal('full'), reason, totpCode }),
  z.object({
    mode: z.literal('partial'),
    description: z.string().trim().min(3).max(400),
    taxableMinor: z.number().int().positive(),
    reason,
    totpCode,
  }),
]);

export default async function adminAccountRoutes(app: FastifyInstance, d: Deps) {
  const superadmin = requireUser(d, { roles: ['SUPERADMIN'], mfa: true });
  const opts = { config: { rateLimit: 'api' as const }, preHandler: superadmin };

  const stale = async (owner: { userId?: string | null; orgId?: string | null }) =>
    d.revocations.markClaimsStale(await affectedUsers(d.prisma, owner));

  // =============================================================== users ===
  app.get<{ Querystring: { q?: string; role?: string; orgId?: string; cursor?: string; limit?: string } }>('/v1/api/admin/users', opts, async (req) => {
    const q = (req.query.q ?? '').trim().slice(0, 100);
    const role = z.enum(ROLES).optional().parse(req.query.role || undefined);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
    const where: Prisma.UserWhereInput = {
      ...(q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { fullName: { contains: q, mode: 'insensitive' } }] } : {}),
      ...(role ? { role } : {}),
      ...(req.query.orgId && z.string().uuid().safeParse(req.query.orgId).success ? { orgId: req.query.orgId } : {}),
    };
    const rows = await d.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(req.query.cursor && z.string().uuid().safeParse(req.query.cursor).success ? { cursor: { id: req.query.cursor }, skip: 1 } : {}),
      select: {
        id: true, email: true, fullName: true, affiliation: true, role: true, orgId: true, mfaEnabled: true, emailVerifiedAt: true,
        lastLoginAt: true, disabledAt: true, disabledReason: true, createdAt: true, organization: { select: { name: true } },
      },
    });
    return { users: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
  });

  app.get('/v1/api/admin/users/:id', opts, async (req) => {
    const { id } = parse(UuidParam, req.params);
    const user = await d.prisma.user.findUnique({
      where: { id },
      select: {
        id: true, email: true, fullName: true, affiliation: true, orcidId: true, role: true, orgId: true, mfaEnabled: true,
        emailVerifiedAt: true, lastLoginAt: true, lockedUntil: true, disabledAt: true, disabledReason: true, createdAt: true,
        organization: { select: { id: true, name: true, status: true } },
      },
    });
    if (!user) throw notFound();
    const [rows, sessions, subscriptions, licences, invoices] = await Promise.all([
      loadAccess(d.prisma, id),
      d.prisma.authSession.count({ where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } } }),
      d.prisma.subscription.findMany({ where: { userId: id }, orderBy: { currentPeriodEnd: 'desc' }, take: 50 }),
      d.prisma.appEntitlement.findMany({ where: { source: 'MANUAL', OR: [{ userId: id }, ...(user.orgId ? [{ orgId: user.orgId }] : [])] }, orderBy: { grantedAt: 'desc' } }),
      d.prisma.invoice.findMany({ where: { userId: id, status: { not: 'DRAFT' } }, orderBy: { issuedAt: 'desc' }, take: 50 }),
    ]);
    const { entitlements, tier } = buildEntitlements(rows, {
      role: user.role, vipRoles: d.cfg.vipRoles, vipEligible: user.disabledAt === null && (!MFA_REQUIRED_ROLES.has(user.role) || user.mfaEnabled),
    });
    return {
      user,
      access: { tier, entitlements: toApiEntitlements(entitlements) },
      activeSessions: sessions,
      subscriptions: subscriptions.map((s) => ({ ...s, unitAmountMinor: Number(s.unitAmountMinor) })),
      licences,
      invoices: invoices.map(toApiInvoice),
    };
  });

  app.patch('/v1/api/admin/users/:id', opts, async (req) => {
    const { id } = parse(UuidParam, req.params);
    const body = parse(UserPatchBody, req.body);
    const claims = req.auth!;
    if (id === claims.sub && (body.disabled || (body.role && body.role !== 'SUPERADMIN'))) {
      throw badRequest('SELF_LOCKOUT', 'You cannot disable or demote your own account');
    }
    await assertTotp(d, claims.sub, body.totpCode);
    const target = await d.prisma.user.findUnique({ where: { id } });
    if (!target) throw notFound();
    if (body.orgId && !(await d.prisma.organization.findUnique({ where: { id: body.orgId }, select: { id: true } }))) {
      throw notFound('UNKNOWN_ORG', 'Unknown organisation');
    }
    try {
      await withAudit(d.prisma, actorOf(req), async (tx) => {
        await tx.user.update({
          where: { id },
          data: {
            ...(body.role ? { role: body.role } : {}),
            ...(body.orgId !== undefined ? { orgId: body.orgId } : {}),
            ...(body.disabled !== undefined ? { disabledAt: body.disabled ? new Date() : null, disabledReason: body.disabled ? body.reason : null } : {}),
          },
        });
        await audit(tx, 'ADMIN.USER_CHANGE', id, {
          signature: signature(claims), reason: body.reason, changes: { role: body.role, orgId: body.orgId, disabled: body.disabled },
        });
      });
    } catch (err) {
      if (pgCode(err) === '23514') throw conflict('SEAT_LIMIT', 'That organisation has no free seats');
      throw err;
    }
    // Role, org or status changes alter token claims: end the user's sessions.
    await d.sessions.revokeAll(id, 'admin_change', actorOf(req));
    return { status: 'updated' };
  });

  /** Lost authenticator: clear TOTP so the user re-enrols at next sign-in (identity verified out of band). */
  app.post('/v1/api/admin/users/:id/mfa-reset', opts, async (req) => {
    const { id } = parse(UuidParam, req.params);
    const body = parse(SignedBody, req.body);
    const claims = req.auth!;
    if (id === claims.sub) throw badRequest('SELF_MFA_RESET', 'Ask another SUPERADMIN to reset your own MFA');
    await assertTotp(d, claims.sub, body.totpCode);
    const user = await d.prisma.user.findUnique({ where: { id }, select: { email: true, fullName: true, mfaEnabled: true } });
    if (!user) throw notFound();
    await withAudit(d.prisma, actorOf(req), async (tx) => {
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: id } });
      await tx.user.update({ where: { id }, data: { mfaEnabled: false, mfaSecret: null, mfaEnrolledAt: null } });
      await audit(tx, 'ADMIN.MFA_RESET', id, { signature: signature(claims), reason: body.reason, was_enabled: user.mfaEnabled });
    });
    await d.sessions.revokeAll(id, 'mfa_reset', actorOf(req));
    await d.mailer.send({ to: user.email, ...templates.securityAlert(user.fullName, 'Two-factor authentication was reset by an administrator') }).catch(() => undefined);
    return { status: 'mfa_reset' };
  });

  app.post('/v1/api/admin/users/:id/logout-all', opts, async (req) => {
    const { id } = parse(UuidParam, req.params);
    const { reason: why } = parse(z.object({ reason }), req.body);
    if (!(await d.prisma.user.findUnique({ where: { id }, select: { id: true } }))) throw notFound();
    const count = await d.sessions.revokeAll(id, 'admin_logout', actorOf(req));
    await withAudit(d.prisma, actorOf(req), (tx) => audit(tx, 'ADMIN.FORCE_LOGOUT', id, { reason: why, sessions: count }));
    return { sessionsRevoked: count };
  });

  // ============================================================ licences ===
  app.get<{ Querystring: { userId?: string; orgId?: string; appId?: string; active?: string } }>('/v1/api/admin/licences', opts, async (req) => {
    const uuid = (v?: string) => (v && z.string().uuid().safeParse(v).success ? v : undefined);
    const now = new Date();
    const rows = await d.prisma.appEntitlement.findMany({
      where: {
        source: 'MANUAL',
        ...(uuid(req.query.userId) ? { userId: req.query.userId } : {}),
        ...(uuid(req.query.orgId) ? { orgId: req.query.orgId } : {}),
        ...(req.query.appId ? { appId: req.query.appId } : {}),
        ...(req.query.active === '1' ? { revokedAt: null, startsAt: { lte: now }, expiresAt: { gt: now } } : {}),
      },
      orderBy: { grantedAt: 'desc' },
      take: 500,
      include: { user: { select: { email: true, fullName: true } }, organization: { select: { name: true } } },
    });
    return { licences: rows };
  });

  /** Manual licence for offline NEFT / RTGS / PO sales: custom start and expiry, always audited. */
  app.post('/v1/api/admin/licences', opts, async (req, reply) => {
    const body = parse(LicenceBody, req.body);
    const claims = req.auth!;
    await assertTotp(d, claims.sub, body.totpCode);
    const appRow = await d.prisma.appRegistry.findUnique({ where: { appId: body.appId }, select: { appId: true } });
    if (!appRow) throw notFound('UNKNOWN_APP', 'Unknown application');
    if (body.userId && !(await d.prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } }))) throw notFound('UNKNOWN_USER', 'Unknown user');
    if (body.orgId && !(await d.prisma.organization.findUnique({ where: { id: body.orgId }, select: { id: true } }))) throw notFound('UNKNOWN_ORG', 'Unknown organisation');
    const licence = await withAudit(d.prisma, actorOf(req), async (tx) => {
      const l = await tx.appEntitlement.create({
        data: {
          appId: body.appId, source: 'MANUAL', userId: body.userId ?? null, orgId: body.orgId ?? null, grantedBy: claims.sub,
          startsAt: body.startsAt ?? new Date(), expiresAt: body.expiresAt, reason: body.reason, reference: body.reference ?? null,
        },
      });
      await audit(tx, 'ADMIN.LICENCE_GRANTED', l.id, { signature: signature(claims), reason: body.reason, app_id: body.appId, user_id: body.userId, org_id: body.orgId, expires_at: body.expiresAt.toISOString() });
      return l;
    });
    await stale(licence);
    return reply.code(201).send({ licence });
  });

  app.patch('/v1/api/admin/licences/:id', opts, async (req) => {
    const { id } = parse(UuidParam, req.params);
    const body = parse(LicencePatch, req.body);
    const claims = req.auth!;
    await assertTotp(d, claims.sub, body.totpCode);
    const before = await d.prisma.appEntitlement.findUnique({ where: { id } });
    if (!before || before.source !== 'MANUAL') throw notFound();
    if (before.revokedAt) throw conflict('LICENCE_REVOKED', 'Revoked licences cannot change; grant a new one');
    if (body.expiresAt && body.expiresAt <= before.startsAt) throw badRequest('EXPIRY_BEFORE_START', 'Expiry must be after the start');
    const licence = await withAudit(d.prisma, actorOf(req), async (tx) => {
      const l = await tx.appEntitlement.update({
        where: { id },
        data: { ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}), ...(body.reason ? { reason: body.reason } : {}), ...(body.reference !== undefined ? { reference: body.reference } : {}) },
      });
      await audit(tx, 'ADMIN.LICENCE_CHANGED', id, { signature: signature(claims), reason: body.reason ?? null, from_expiry: before.expiresAt, to_expiry: l.expiresAt });
      return l;
    });
    await stale(licence);
    return { licence };
  });

  app.post('/v1/api/admin/licences/:id/revoke', opts, async (req) => {
    const { id } = parse(UuidParam, req.params);
    const body = parse(SignedBody, req.body);
    const claims = req.auth!;
    await assertTotp(d, claims.sub, body.totpCode);
    const before = await d.prisma.appEntitlement.findUnique({ where: { id } });
    if (!before || before.source !== 'MANUAL') throw notFound();
    if (before.revokedAt) throw conflict('LICENCE_REVOKED', 'Already revoked');
    const licence = await withAudit(d.prisma, actorOf(req), async (tx) => {
      const l = await tx.appEntitlement.update({ where: { id }, data: { revokedAt: new Date(), revokedBy: claims.sub, revokeReason: body.reason } });
      await audit(tx, 'ADMIN.LICENCE_REVOKED', id, { signature: signature(claims), reason: body.reason });
      return l;
    });
    await stale(licence);
    return { licence };
  });

  // ======================================================= organizations ===
  app.get<{ Querystring: { q?: string } }>('/v1/api/admin/organizations', opts, async (req) => {
    const q = (req.query.q ?? '').trim().slice(0, 100);
    const now = new Date();
    const orgs = await d.prisma.organization.findMany({
      where: q ? { name: { contains: q, mode: 'insensitive' } } : {},
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        _count: { select: { members: { where: { disabledAt: null } } } },
        entitlements: { where: { source: 'MANUAL', revokedAt: null, expiresAt: { gt: now } }, select: { appId: true, expiresAt: true } },
        subscriptions: { where: { status: { in: ['ACTIVE', 'PAST_DUE'] }, currentPeriodEnd: { gt: now } }, select: { planCode: true, seats: true, currentPeriodEnd: true } },
      },
    });
    return {
      organizations: orgs.map(({ _count, ...o }) => ({ ...o, seatsUsed: _count.members })),
    };
  });

  app.get('/v1/api/admin/organizations/:id', opts, async (req) => {
    const { id } = parse(UuidParam, req.params);
    const org = await d.prisma.organization.findUnique({
      where: { id },
      include: {
        billingProfile: true,
        members: { select: { id: true, email: true, fullName: true, role: true, emailVerifiedAt: true, disabledAt: true, lastLoginAt: true }, orderBy: { fullName: 'asc' } },
        entitlements: { where: { source: 'MANUAL' }, orderBy: { grantedAt: 'desc' } },
        subscriptions: { orderBy: { currentPeriodEnd: 'desc' } },
        invoices: { where: { status: { not: 'DRAFT' } }, orderBy: { issuedAt: 'desc' }, take: 100 },
      },
    });
    if (!org) throw notFound();
    return {
      organization: {
        ...org,
        subscriptions: org.subscriptions.map((s) => ({ ...s, unitAmountMinor: Number(s.unitAmountMinor) })),
        invoices: org.invoices.map(toApiInvoice),
        seatsUsed: org.members.filter((m) => !m.disabledAt).length,
      },
    };
  });

  app.post('/v1/api/admin/organizations', opts, async (req, reply) => {
    const body = parse(OrgCreate, req.body);
    const claims = req.auth!;
    await assertTotp(d, claims.sub, body.totpCode);
    const { totpCode: _t, ...data } = body;
    const org = await withAudit(d.prisma, actorOf(req), async (tx) => {
      const o = await tx.organization.create({ data });
      await audit(tx, 'ADMIN.ORG_CREATED', o.id, { signature: signature(claims), name: o.name });
      return o;
    });
    return reply.code(201).send({ organization: org });
  });

  app.patch('/v1/api/admin/organizations/:id', opts, async (req) => {
    const { id } = parse(UuidParam, req.params);
    const body = parse(OrgPatch, req.body);
    const claims = req.auth!;
    await assertTotp(d, claims.sub, body.totpCode);
    const { totpCode: _t, reason: why, ...data } = body;
    if (!(await d.prisma.organization.findUnique({ where: { id }, select: { id: true } }))) throw notFound();
    try {
      const org = await withAudit(d.prisma, actorOf(req), async (tx) => {
        const o = await tx.organization.update({ where: { id }, data });
        await audit(tx, 'ADMIN.ORG_CHANGED', id, { signature: signature(claims), reason: why, changes: Object.keys(data) });
        return o;
      });
      if (data.status) await stale({ orgId: id });
      return { organization: org };
    } catch (err) {
      if (pgCode(err) === '23514') throw conflict('SEAT_LIMIT', 'Seat limit is below the number of active members; remove members first');
      throw err;
    }
  });

  app.put('/v1/api/admin/organizations/:id/billing-profile', opts, async (req) => {
    const { id } = parse(UuidParam, req.params);
    const body = parse(ProfileFields, req.body);
    if (!(await d.prisma.organization.findUnique({ where: { id }, select: { id: true } }))) throw notFound();
    const data = { ...body, gstin: body.gstin ?? null, phone: body.phone ?? null, addressLine2: body.addressLine2 ?? null, state: body.state ?? null, stateCode: body.country === 'IN' ? body.stateCode! : null };
    try {
      const profile = await withAudit(d.prisma, actorOf(req), (tx) =>
        tx.billingProfile.upsert({ where: { orgId: id }, create: { ...data, orgId: id }, update: data }),
      );
      return { profile };
    } catch (err) {
      if (pgCode(err) === '23514') throw badRequest('INVALID_BILLING_PROFILE', 'The GSTIN, state or PIN code is not valid');
      throw err;
    }
  });

  app.post('/v1/api/admin/organizations/:id/members', opts, async (req, reply) => {
    const { id } = parse(UuidParam, req.params);
    const { email, role } = parse(z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(['STUDENT', 'RESEARCHER', 'PI', 'INSTITUTE_ADMIN']).optional() }), req.body);
    const user = await d.prisma.user.findUnique({ where: { email } });
    if (!user) throw notFound('UNKNOWN_USER', 'No AltVivo account uses that email; ask them to register first');
    if (user.orgId && user.orgId !== id) throw conflict('IN_OTHER_ORG', 'That user belongs to another institution');
    try {
      await withAudit(d.prisma, actorOf(req), async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { orgId: id, ...(role ? { role } : {}) } });
        await audit(tx, 'ADMIN.ORG_MEMBER_ADDED', id, { user_id: user.id, role: role ?? null });
      });
    } catch (err) {
      if (pgCode(err) === '23514') throw conflict('SEAT_LIMIT', 'The institution has no free seats');
      throw err;
    }
    await d.sessions.revokeAll(user.id, 'org_change', actorOf(req));
    return reply.code(201).send({ status: 'added', userId: user.id });
  });

  app.delete<{ Params: { id: string; userId: string } }>('/v1/api/admin/organizations/:id/members/:userId', opts, async (req, reply) => {
    const { id, userId } = parse(z.object({ id: z.string().uuid(), userId: z.string().uuid() }), req.params);
    const res = await withAudit(d.prisma, actorOf(req), async (tx) => {
      const r = await tx.user.updateMany({ where: { id: userId, orgId: id }, data: { orgId: null } });
      if (r.count) await audit(tx, 'ADMIN.ORG_MEMBER_REMOVED', id, { user_id: userId });
      return r;
    });
    if (!res.count) throw notFound();
    await d.sessions.revokeAll(userId, 'org_change', actorOf(req));
    return reply.code(204).send();
  });

  app.post('/v1/api/admin/organizations/:id/proformas', opts, async (req, reply) => {
    const { id } = parse(UuidParam, req.params);
    const body = parse(ProformaBody, req.body);
    assertInvoicing(d.cfg);
    const [org, plan] = await Promise.all([
      d.prisma.organization.findUnique({ where: { id }, include: { billingProfile: true } }),
      d.prisma.plan.findUnique({ where: { planCode: body.planCode } }),
    ]);
    if (!org) throw notFound('UNKNOWN_ORG', 'Unknown organisation');
    if (!plan) throw notFound('UNKNOWN_PLAN', 'Unknown plan');
    if (!org.billingProfile) throw new HttpError(409, 'BILLING_PROFILE_REQUIRED', 'Add the institution billing details first');
    const pf = await withAudit(d.prisma, actorOf(req), (tx) =>
      createProforma(tx, d, {
        orgId: id, profile: org.billingProfile!, plan, seats: body.seats, poNumber: body.poNumber ?? null, notes: body.notes ?? null,
        discountMinor: BigInt(body.discountMinor ?? 0), validDays: body.validDays ?? d.cfg.PROFORMA_VALIDITY_DAYS, createdBy: req.auth!.sub,
      }),
    );
    const pdf = await pdfLink(d, pf, actorOf(req));
    return reply.code(201).send({ invoice: toApiInvoice(pf), pdf });
  });

  // ============================================================ invoices ===
  app.get<{ Querystring: { kind?: string; status?: string; orgId?: string; userId?: string; q?: string; cursor?: string } }>('/v1/api/admin/invoices', opts, async (req) => {
    const kind = z.enum(['PROFORMA', 'TAX_INVOICE', 'CREDIT_NOTE']).optional().parse(req.query.kind || undefined);
    const status = z.enum(['DRAFT', 'ISSUED', 'PAID', 'CANCELLED']).optional().parse(req.query.status || undefined);
    const uuid = (v?: string) => (v && z.string().uuid().safeParse(v).success ? v : undefined);
    const q = (req.query.q ?? '').trim().slice(0, 100);
    const rows = await d.prisma.invoice.findMany({
      where: {
        status: status ?? { not: 'DRAFT' },
        ...(kind ? { kind } : {}),
        ...(uuid(req.query.orgId) ? { orgId: req.query.orgId } : {}),
        ...(uuid(req.query.userId) ? { userId: req.query.userId } : {}),
        ...(q ? { OR: [{ number: { contains: q.toUpperCase() } }, { buyerName: { contains: q, mode: 'insensitive' } }, { buyerEmail: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
      take: 101,
      ...(uuid(req.query.cursor) ? { cursor: { id: req.query.cursor! }, skip: 1 } : {}),
    });
    return { invoices: rows.slice(0, 100).map(toApiInvoice), nextCursor: rows.length > 100 ? rows[99]!.id : null };
  });

  app.get('/v1/api/admin/invoices/:id', opts, async (req) => {
    const { id } = parse(UuidParam, req.params);
    const inv = await d.prisma.invoice.findUnique({
      where: { id },
      include: { lines: { orderBy: { position: 'asc' } }, payments: true, derived: { select: { id: true, kind: true, number: true, status: true } }, relatedInvoice: { select: { id: true, kind: true, number: true } } },
    });
    if (!inv) throw notFound();
    const big = (v: bigint) => Number(v);
    return {
      invoice: {
        ...toApiInvoice(inv),
        seller: { legalName: inv.sellerLegalName, gstin: inv.sellerGstin, address: inv.sellerAddress, stateCode: inv.sellerStateCode },
        buyer: { name: inv.buyerName, email: inv.buyerEmail, gstin: inv.buyerGstin, address: inv.buyerAddress, stateCode: inv.buyerStateCode, country: inv.buyerCountry },
        placeOfSupply: inv.placeOfSupply,
        cgstMinor: big(inv.cgstMinor), sgstMinor: big(inv.sgstMinor), igstMinor: big(inv.igstMinor),
        cancelReason: inv.cancelReason, cancelledAt: inv.cancelledAt, notes: inv.notes,
        lines: inv.lines.map((l) => ({ ...l, unitPriceMinor: big(l.unitPriceMinor), discountMinor: big(l.discountMinor), taxableMinor: big(l.taxableMinor), cgstMinor: big(l.cgstMinor), sgstMinor: big(l.sgstMinor), igstMinor: big(l.igstMinor), totalMinor: big(l.totalMinor) })),
        payments: inv.payments.map((p) => ({ ...p, amountMinor: big(p.amountMinor), taxMinor: big(p.taxMinor), refundedMinor: big(p.refundedMinor), feeMinor: p.feeMinor === null ? null : big(p.feeMinor) })),
        derived: inv.derived,
        related: inv.relatedInvoice,
      },
    };
  });

  app.get('/v1/api/admin/invoices/:id/pdf', opts, async (req) => {
    const { id } = parse(UuidParam, req.params);
    const inv = await d.prisma.invoice.findUnique({ where: { id } });
    if (!inv || inv.status === 'DRAFT') throw notFound();
    return pdfLink(d, inv, actorOf(req));
  });

  /** NEFT / RTGS / cheque received against a proforma: tax invoice + institutional licence. */
  app.post('/v1/api/admin/invoices/:id/record-payment', opts, async (req, reply) => {
    const { id } = parse(UuidParam, req.params);
    const body = parse(OfflineBody, req.body);
    const claims = req.auth!;
    await assertTotp(d, claims.sub, body.totpCode);
    const r = await recordOfflinePayment(d, actorOf(req), {
      proformaId: id, amountMinor: BigInt(body.amountMinor), method: body.method, reference: body.reference, paidAt: body.paidAt, adminId: claims.sub,
    });
    return reply.code(201).send(r);
  });

  /** Cancel an unpaid issued document (wrong customer, superseded quotation). Paid invoices need a credit note. */
  app.post('/v1/api/admin/invoices/:id/cancel', opts, async (req) => {
    const { id } = parse(UuidParam, req.params);
    const body = parse(SignedBody, req.body);
    const claims = req.auth!;
    await assertTotp(d, claims.sub, body.totpCode);
    const inv = await withAudit(d.prisma, actorOf(req), async (tx) => {
      const cur = await lockInvoice(tx, id);
      if (!cur || cur.status === 'DRAFT') throw notFound();
      if (cur.status !== 'ISSUED') throw conflict('NOT_CANCELLABLE', cur.status === 'PAID' ? 'Paid invoices are reversed with a credit note' : 'Already cancelled');
      if (await tx.payment.count({ where: { invoiceId: id, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] } } })) {
        throw conflict('HAS_PAYMENTS', 'Money was received against this document; issue a credit note instead');
      }
      const u = await tx.invoice.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: body.reason } });
      await audit(tx, 'ADMIN.INVOICE_CANCELLED', id, { signature: signature(claims), reason: body.reason, number: cur.number });
      return u;
    });
    return { invoice: toApiInvoice(inv) };
  });

  app.post('/v1/api/admin/invoices/:id/credit-note', opts, async (req, reply) => {
    const { id } = parse(UuidParam, req.params);
    const body = parse(CreditBody, req.body);
    const claims = req.auth!;
    await assertTotp(d, claims.sub, body.totpCode);
    try {
      const cn = await withAudit(d.prisma, actorOf(req), async (tx) => {
        const inv = await lockInvoice(tx, id);
        if (!inv || inv.kind !== 'TAX_INVOICE' || (inv.status !== 'ISSUED' && inv.status !== 'PAID')) throw notFound('UNKNOWN_INVOICE', 'Only issued tax invoices can be credited');
        let note;
        if (body.mode === 'full') {
          note = await fullCreditNote(tx, inv, body.reason, claims.sub);
        } else {
          const ref = inv.lines[0]!;
          const draft = await draftFrom(tx, inv, {
            kind: 'CREDIT_NOTE',
            relatedInvoiceId: inv.id,
            lines: [{ description: body.description, sacCode: ref.sacCode, appId: ref.appId, planCode: ref.planCode, quantity: 1, unitPriceMinor: BigInt(body.taxableMinor), gstRateBp: ref.gstRateBp }],
            notes: body.reason,
            createdBy: claims.sub,
          });
          note = await issue(tx, draft.id);
        }
        await audit(tx, 'ADMIN.CREDIT_NOTE_ISSUED', note.id, { signature: signature(claims), reason: body.reason, invoice: inv.number, credit_note: note.number, total_minor: note.totalMinor.toString() });
        return note;
      });
      const pdf = await pdfLink(d, cn, actorOf(req));
      return reply.code(201).send({ creditNote: toApiInvoice(cn), pdf });
    } catch (err) {
      if (pgCode(err) === '23514') throw conflict('CREDIT_EXCEEDS_INVOICE', 'Credit notes would exceed the invoice total');
      throw err;
    }
  });

  // ============================================================ payments ===
  app.get<{ Querystring: { status?: string; provider?: string; cursor?: string } }>('/v1/api/admin/payments', opts, async (req) => {
    const status = z.enum(['CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED']).optional().parse(req.query.status || undefined);
    const provider = z.enum(['RAZORPAY', 'STRIPE', 'BANK_TRANSFER']).optional().parse(req.query.provider || undefined);
    const rows = await d.prisma.payment.findMany({
      where: { ...(status ? { status } : {}), ...(provider ? { provider } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 101,
      ...(req.query.cursor && z.string().uuid().safeParse(req.query.cursor).success ? { cursor: { id: req.query.cursor }, skip: 1 } : {}),
      include: { user: { select: { email: true } }, organization: { select: { name: true } }, invoice: { select: { number: true } } },
    });
    return {
      payments: rows.slice(0, 100).map((p) => ({ ...p, amountMinor: Number(p.amountMinor), taxMinor: Number(p.taxMinor), refundedMinor: Number(p.refundedMinor), feeMinor: p.feeMinor === null ? null : Number(p.feeMinor) })),
      nextCursor: rows.length > 100 ? rows[99]!.id : null,
    };
  });
}
