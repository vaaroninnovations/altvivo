import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MailMessage, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { audit, systemActor, withAudit } from '../lib/audit.js';
import { safeEqual } from '../lib/crypto.js';
import { HttpError, badRequest, conflict, notFound, pgCode, unauthorized } from '../lib/errors.js';
import { templates } from '../lib/mailer.js';
import { actorOf, parse, requireUser } from '../plugins/security.js';
import { deliverToInbox, mailCounts, threadForInbound, toMailSummary } from '../services/mailbox.js';
import { activateTrial } from '../services/trials.js';
import { signature, totpCode } from './admin.js';
import { assertTotp } from './auth.js';

const UuidParam = z.object({ id: z.string().uuid() });
const email = z.string().trim().toLowerCase().email().max(254);
const recipients = (min: number) =>
  z
    .array(email)
    .min(min)
    .max(20)
    .transform((list) => [...new Set(list)]);

const ComposeBody = z.object({
  to: recipients(0).default([]),
  cc: recipients(0).default([]),
  subject: z.string().trim().max(300).default(''),
  body: z.string().max(20000).default(''),
  /** Message being answered: the new mail joins its conversation. */
  inReplyTo: z.string().uuid().optional(),
  /** Existing draft to update (and, when sending, to turn into the sent message). */
  draftId: z.string().uuid().optional(),
  /** true = save to Drafts without sending. */
  draft: z.boolean().default(false),
});

const PatchBody = z
  .object({ isRead: z.boolean().optional(), isStarred: z.boolean().optional(), folder: z.enum(['TRASH', 'RESTORE']).optional() })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');

const BulkBody = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  action: z.enum(['read', 'unread', 'star', 'unstar', 'trash', 'restore', 'delete']),
});

const ListQuery = z.object({
  folder: z.enum(['INBOX', 'SENT', 'DRAFT', 'TRASH', 'STARRED']).default('INBOX'),
  q: z.string().trim().max(100).optional(),
  unread: z.enum(['1']).optional(),
  cursor: z.string().uuid().optional(),
});

const InboundBody = z.object({
  from: email,
  fromName: z.string().trim().max(200).optional(),
  to: z.array(email).max(20).default([]),
  subject: z.string().trim().max(300).default('(no subject)'),
  text: z.string().trim().min(1).max(20000),
});

const ApproveBody = z.object({ totpCode, days: z.number().int().min(1).max(90).optional(), note: z.string().trim().max(500).optional() });
const DeclineBody = z.object({ reason: z.string().trim().min(5).max(500), notify: z.boolean().default(true) });

const PAGE = 50;

export default async function adminMailRoutes(app: FastifyInstance, d: Deps) {
  const superadmin = requireUser(d, { roles: ['SUPERADMIN'], mfa: true });
  const opts = { config: { rateLimit: 'api' as const }, preHandler: superadmin };
  const sender = /<([^>]+)>/.exec(d.cfg.SMTP_FROM)?.[1] ?? d.cfg.SUPPORT_EMAIL;

  // =============================================================== mailbox ==
  app.get('/v1/api/admin/mail', opts, async (req) => {
    const f = parse(ListQuery, req.query);
    const where: Prisma.MailMessageWhereInput = {
      ...(f.folder === 'STARRED' ? { isStarred: true, folder: { not: 'TRASH' } } : { folder: f.folder }),
      ...(f.unread ? { isRead: false } : {}),
      ...(f.q
        ? {
            OR: [
              { subject: { contains: f.q, mode: 'insensitive' } },
              { body: { contains: f.q, mode: 'insensitive' } },
              { fromName: { contains: f.q, mode: 'insensitive' } },
              { fromEmail: { contains: f.q, mode: 'insensitive' } },
              { toEmails: { has: f.q.toLowerCase() } },
            ],
          }
        : {}),
    };
    const [rows, counts] = await Promise.all([
      d.prisma.mailMessage.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: PAGE + 1,
        ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
      }),
      mailCounts(d.prisma),
    ]);
    return { messages: rows.slice(0, PAGE).map(toMailSummary), nextCursor: rows.length > PAGE ? rows[PAGE - 1]!.id : null, counts, sender };
  });

  /** One message with its conversation; opening an inbox message marks it read. */
  app.get('/v1/api/admin/mail/:id', opts, async (req) => {
    const { id } = parse(UuidParam, req.params);
    let message = await d.prisma.mailMessage.findUnique({
      where: { id },
      include: {
        contactMessage: { select: { id: true, category: true, status: true, institution: true, userId: true } },
        trialRequest: { select: { id: true, status: true, institution: true, appIds: true, days: true } },
      },
    });
    if (!message) throw notFound();
    if (message.folder === 'INBOX' && !message.isRead) {
      await d.prisma.mailMessage.update({ where: { id }, data: { isRead: true } });
      message = { ...message, isRead: true };
    }
    const thread = await d.prisma.mailMessage.findMany({
      where: { threadId: message.threadId, OR: [{ folder: { in: ['INBOX', 'SENT'] } }, { id }] },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return { message, thread, counts: await mailCounts(d.prisma) };
  });

  /** Compose: send now, or save / update a draft. Replies join the conversation of `inReplyTo`. */
  app.post('/v1/api/admin/mail', opts, async (req, reply) => {
    const body = parse(ComposeBody, req.body);
    const claims = req.auth!;
    const parent = body.inReplyTo ? await d.prisma.mailMessage.findUnique({ where: { id: body.inReplyTo } }) : null;
    if (body.inReplyTo && !parent) throw notFound('UNKNOWN_MESSAGE', 'The message you are replying to no longer exists');
    const existing = body.draftId ? await d.prisma.mailMessage.findUnique({ where: { id: body.draftId } }) : null;
    if (body.draftId && (!existing || existing.folder !== 'DRAFT')) throw notFound('UNKNOWN_DRAFT', 'That draft no longer exists');

    const fields = {
      fromName: 'AltVivo',
      fromEmail: sender,
      toEmails: body.to,
      ccEmails: body.cc,
      subject: body.subject || '(no subject)',
      body: body.body,
      isRead: true,
      source: 'compose',
      createdBy: claims.sub,
      threadId: parent?.threadId ?? existing?.threadId ?? randomUUID(),
      inReplyTo: parent?.id ?? existing?.inReplyTo ?? null,
      contactMessageId: parent?.contactMessageId ?? existing?.contactMessageId ?? null,
      trialRequestId: parent?.trialRequestId ?? existing?.trialRequestId ?? null,
    };
    const save = (data: Prisma.MailMessageUncheckedCreateInput) =>
      existing ? d.prisma.mailMessage.update({ where: { id: existing.id }, data }) : d.prisma.mailMessage.create({ data });

    if (body.draft) {
      const draft = await save({ ...fields, folder: 'DRAFT', deliveryError: null });
      return reply.code(existing ? 200 : 201).send({ message: draft, counts: await mailCounts(d.prisma) });
    }

    if (!body.to.length) throw badRequest('RECIPIENT_REQUIRED', 'Add at least one recipient');
    if (!body.subject) throw badRequest('SUBJECT_REQUIRED', 'Add a subject');
    if (body.body.trim().length < 1) throw badRequest('BODY_REQUIRED', 'Write a message');
    try {
      await d.mailer.send({ to: body.to.join(', '), ...(body.cc.length ? { cc: body.cc } : {}), replyTo: d.cfg.SUPPORT_EMAIL, ...templates.adminMessage(body.subject, body.body) });
    } catch (err) {
      req.log.warn({ err }, 'mailbox send failed');
      const draft = await save({ ...fields, folder: 'DRAFT', deliveryError: String((err as Error).message ?? err).slice(0, 500) });
      throw new HttpError(502, 'MAIL_SEND_FAILED', 'The mail server did not accept the message. It was saved to Drafts.', { draftId: draft.id });
    }
    const sent = await withAudit(d.prisma, actorOf(req), async (tx) => {
      const data = { ...fields, folder: 'SENT' as const, sentAt: new Date(), deliveryError: null };
      const m = existing ? await tx.mailMessage.update({ where: { id: existing.id }, data }) : await tx.mailMessage.create({ data });
      // Answering an enquiry moves it out of "new" so nobody answers it twice.
      if (m.contactMessageId) {
        await tx.contactMessage.updateMany({ where: { id: m.contactMessageId, status: 'NEW' }, data: { status: 'IN_PROGRESS', handledBy: claims.sub, handledAt: new Date() } });
      }
      await audit(tx, 'ADMIN.MAIL_SENT', m.id, { recipients: body.to.length + body.cc.length, in_reply_to: m.inReplyTo, contact_message_id: m.contactMessageId, trial_request_id: m.trialRequestId });
      return m;
    });
    return reply.code(201).send({ message: sent, counts: await mailCounts(d.prisma) });
  });

  const move = (m: Pick<MailMessage, 'folder' | 'trashedFrom'>, to: 'TRASH' | 'RESTORE'): Prisma.MailMessageUpdateInput | null => {
    if (to === 'TRASH') return m.folder === 'TRASH' ? null : { folder: 'TRASH', trashedFrom: m.folder };
    return m.folder === 'TRASH' ? { folder: m.trashedFrom ?? 'INBOX', trashedFrom: null } : null;
  };

  app.patch('/v1/api/admin/mail/:id', opts, async (req) => {
    const { id } = parse(UuidParam, req.params);
    const body = parse(PatchBody, req.body);
    const before = await d.prisma.mailMessage.findUnique({ where: { id } });
    if (!before) throw notFound();
    const message = await d.prisma.mailMessage.update({
      where: { id },
      data: {
        ...(body.isRead !== undefined ? { isRead: body.isRead } : {}),
        ...(body.isStarred !== undefined ? { isStarred: body.isStarred } : {}),
        ...(body.folder ? (move(before, body.folder) ?? {}) : {}),
      },
    });
    return { message: toMailSummary(message), counts: await mailCounts(d.prisma) };
  });

  app.post('/v1/api/admin/mail/bulk', opts, async (req) => {
    const { ids, action } = parse(BulkBody, req.body);
    const where = { id: { in: ids } };
    let changed = 0;
    if (action === 'read' || action === 'unread') {
      changed = (await d.prisma.mailMessage.updateMany({ where, data: { isRead: action === 'read' } })).count;
    } else if (action === 'star' || action === 'unstar') {
      changed = (await d.prisma.mailMessage.updateMany({ where, data: { isStarred: action === 'star' } })).count;
    } else if (action === 'delete') {
      // Permanent: only what is already in Trash (or an unsent draft).
      changed = await withAudit(d.prisma, actorOf(req), async (tx) => {
        const res = await tx.mailMessage.deleteMany({ where: { ...where, folder: { in: ['TRASH', 'DRAFT'] } } });
        if (res.count) await audit(tx, 'ADMIN.MAIL_DELETED', null, { count: res.count });
        return res.count;
      });
    } else {
      const rows = await d.prisma.mailMessage.findMany({ where, select: { id: true, folder: true, trashedFrom: true } });
      for (const r of rows) {
        const data = move(r, action === 'trash' ? 'TRASH' : 'RESTORE');
        if (!data) continue;
        await d.prisma.mailMessage.update({ where: { id: r.id }, data });
        changed += 1;
      }
    }
    return { changed, counts: await mailCounts(d.prisma) };
  });

  app.post('/v1/api/admin/mail/trash/empty', opts, async (req) => {
    const deleted = await withAudit(d.prisma, actorOf(req), async (tx) => {
      const res = await tx.mailMessage.deleteMany({ where: { folder: 'TRASH' } });
      if (res.count) await audit(tx, 'ADMIN.MAIL_DELETED', null, { count: res.count, emptied_trash: true });
      return res.count;
    });
    return { deleted, counts: await mailCounts(d.prisma) };
  });

  app.delete('/v1/api/admin/mail/:id', opts, async (req, reply) => {
    const { id } = parse(UuidParam, req.params);
    const row = await d.prisma.mailMessage.findUnique({ where: { id }, select: { folder: true } });
    if (!row) throw notFound();
    if (row.folder !== 'TRASH' && row.folder !== 'DRAFT') throw conflict('NOT_IN_TRASH', 'Move the message to Trash first');
    await withAudit(d.prisma, actorOf(req), async (tx) => {
      await tx.mailMessage.delete({ where: { id } });
      await audit(tx, 'ADMIN.MAIL_DELETED', id, { count: 1 });
    });
    return reply.code(204).send();
  });

  /**
   * Replies that people send to the support address, forwarded here by the
   * mail provider (for example a Cloudflare Email Worker) with
   * `Authorization: Bearer MAIL_INBOUND_TOKEN`. Disabled when the token is unset.
   */
  app.post('/v1/webhooks/mail/inbound', { config: { csrf: false, rateLimit: 'webhook' } }, async (req: FastifyRequest, reply) => {
    const expected = d.cfg.MAIL_INBOUND_TOKEN;
    const given = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7).trim() : '';
    if (!expected || !given || !safeEqual(expected, given)) throw unauthorized('WEBHOOK_AUTH_INVALID', 'Invalid token');
    const body = parse(InboundBody, req.body);
    const thread = await threadForInbound(d.prisma, body.from, body.subject);
    const message = await withAudit(d.prisma, systemActor(), async (tx) => {
      const m = await deliverToInbox(tx, { fromName: body.fromName ?? null, fromEmail: body.from, toEmails: body.to, subject: body.subject, body: body.text, source: 'inbound', ...(thread ?? {}) });
      await audit(tx, 'MAIL.INBOUND', m.id, { threaded: !!thread });
      return m;
    });
    return reply.code(201).send({ status: 'received', id: message.id });
  });

  // ==================================================== one month free =====
  app.get<{ Querystring: { status?: string; cursor?: string } }>('/v1/api/admin/trials', opts, async (req) => {
    const status = z.enum(['PENDING', 'APPROVED', 'ACTIVE', 'DECLINED']).optional().parse(req.query.status || undefined);
    const [rows, grouped] = await Promise.all([
      d.prisma.trialRequest.findMany({
        where: status ? { status } : {},
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 101,
        ...(req.query.cursor && z.string().uuid().safeParse(req.query.cursor).success ? { cursor: { id: req.query.cursor }, skip: 1 } : {}),
      }),
      d.prisma.trialRequest.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const page = rows.slice(0, 100);
    const accounts = await d.prisma.user.findMany({
      where: { email: { in: page.map((r) => r.email) } },
      select: { id: true, email: true, emailVerifiedAt: true, role: true, _count: { select: { subscriptions: true } } },
    });
    const byEmail = new Map(accounts.map((a) => [a.email.toLowerCase(), a]));
    const now = Date.now();
    return {
      defaultDays: d.cfg.TRIAL_DAYS,
      counts: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
      requests: page.map((r) => {
        const a = byEmail.get(r.email.toLowerCase());
        return {
          ...r,
          ended: r.status === 'ACTIVE' && !!r.endsAt && r.endsAt.getTime() <= now,
          account: a ? { id: a.id, emailVerified: a.emailVerifiedAt !== null, role: a.role, subscriptions: a._count.subscriptions } : null,
        };
      }),
      nextCursor: rows.length > 100 ? rows[99]!.id : null,
    };
  });

  /**
   * Approve: signed with TOTP because it grants licences. The free month starts
   * now when a verified account owns the address, otherwise when one does.
   */
  app.post('/v1/api/admin/trials/:id/approve', opts, async (req) => {
    const { id } = parse(UuidParam, req.params);
    const body = parse(ApproveBody, req.body);
    const claims = req.auth!;
    await assertTotp(d, claims.sub, body.totpCode);
    const before = await d.prisma.trialRequest.findUnique({ where: { id } });
    if (!before) throw notFound();
    if (before.status !== 'PENDING') throw conflict('ALREADY_DECIDED', 'This request was already decided');
    const account = await d.prisma.user.findUnique({ where: { email: before.email }, select: { id: true, emailVerifiedAt: true, disabledAt: true } });
    if (account?.disabledAt) throw conflict('ACCOUNT_SUSPENDED', 'The account for this address is suspended');
    const days = body.days ?? d.cfg.TRIAL_DAYS;
    let request;
    try {
      request = await withAudit(d.prisma, actorOf(req), async (tx) => {
        const claimed = await tx.trialRequest.updateMany({
          where: { id, status: 'PENDING' },
          data: { status: 'APPROVED', days, decidedBy: claims.sub, decidedAt: new Date(), decisionNote: body.note ?? null, userId: account?.id ?? before.userId },
        });
        if (claimed.count !== 1) throw conflict('ALREADY_DECIDED', 'This request was already decided');
        await audit(tx, 'ADMIN.TRIAL_APPROVED', id, { signature: signature(claims), days, apps: before.appIds, note: body.note ?? null });
        const approved = await tx.trialRequest.findUniqueOrThrow({ where: { id } });
        return account?.emailVerifiedAt ? activateTrial(tx, approved, account.id) : approved;
      });
    } catch (err) {
      if (pgCode(err) === '42501') throw conflict('GRANT_REFUSED', 'The licences could not be granted for this account');
      throw err;
    }
    if (request.status === 'ACTIVE' && account) await d.revocations.markClaimsStale([account.id]);
    const names = (await d.prisma.appRegistry.findMany({ where: { appId: { in: request.appIds } }, orderBy: { sortOrder: 'asc' }, select: { name: true } })).map((a) => a.name);
    const active = request.status === 'ACTIVE';
    const link = active
      ? `${d.cfg.webOrigin}/workspace`
      : account
        ? `${d.cfg.webOrigin}/login?redirect=${encodeURIComponent('/workspace')}`
        : `${d.cfg.webOrigin}/register?${new URLSearchParams({ email: request.email, trial: '1' })}`;
    await d.mailer
      .send({ to: request.email, ...templates.trialApproved(request.name, request.days, names, link, { active, endsOn: request.endsAt?.toISOString().slice(0, 10) ?? null }) })
      .catch((err) => req.log.warn({ err }, 'trial approval email failed'));
    return { request };
  });

  app.post('/v1/api/admin/trials/:id/decline', opts, async (req) => {
    const { id } = parse(UuidParam, req.params);
    const body = parse(DeclineBody, req.body);
    const claims = req.auth!;
    const request = await withAudit(d.prisma, actorOf(req), async (tx) => {
      const claimed = await tx.trialRequest.updateMany({
        where: { id, status: { in: ['PENDING', 'APPROVED'] } },
        data: { status: 'DECLINED', decidedBy: claims.sub, decidedAt: new Date(), decisionNote: body.reason },
      });
      if (claimed.count !== 1) {
        if (!(await tx.trialRequest.findUnique({ where: { id }, select: { id: true } }))) throw notFound();
        throw conflict('ALREADY_DECIDED', 'An active or declined request cannot be declined. Revoke its licences under Manual licences instead.');
      }
      await audit(tx, 'ADMIN.TRIAL_DECLINED', id, { reason: body.reason });
      return tx.trialRequest.findUniqueOrThrow({ where: { id } });
    });
    if (body.notify) {
      await d.mailer
        .send({ to: request.email, ...templates.trialDeclined(request.name, null, `${d.cfg.webOrigin}/pricing`) })
        .catch((err) => req.log.warn({ err }, 'trial decline email failed'));
    }
    return { request };
  });
}
