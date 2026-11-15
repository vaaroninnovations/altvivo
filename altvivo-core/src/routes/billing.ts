import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { BillingProvider, Invoice, Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { audit, systemActor, withAudit, type AuditActor } from '../lib/audit.js';
import { sha256Hex } from '../lib/crypto.js';
import { HttpError, badRequest, conflict, forbidden, notFound, pgCode, unauthorized } from '../lib/errors.js';
import type { AccessClaims } from '../lib/jwt.js';
import { templates } from '../lib/mailer.js';
import { actorOf, parse, requireUser } from '../plugins/security.js';
import { toRazorpayPayment } from '../services/billing.js';
import {
  applyRefund,
  createProforma,
  finalizeOneTime,
  recordFailedPayment,
  recordStripeInvoicePaid,
  startCheckout,
  syncStripeSubscription,
} from '../services/checkout.js';
import { assertInvoicing, ensurePdf, toApiInvoice } from '../services/invoices.js';
import { publicUser } from './auth.js';

const ORG_BILLING_ROLES = new Set(['INSTITUTE_ADMIN', 'SUPERADMIN']);

export const ProfileFields = z
  .object({
    legalName: z.string().trim().min(2).max(200),
    gstin: z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Not a valid GSTIN').nullable().optional(),
    email: z.string().trim().toLowerCase().email().max(254),
    phone: z.string().trim().regex(/^\+?[0-9][0-9 ()-]{5,19}$/).nullable().optional(),
    addressLine1: z.string().trim().min(3).max(200),
    addressLine2: z.string().trim().max(200).nullable().optional(),
    city: z.string().trim().min(2).max(100),
    state: z.string().trim().max(100).nullable().optional(),
    stateCode: z.string().regex(/^[0-9]{2}$/).nullable().optional(),
    postalCode: z.string().trim().min(3).max(12),
    country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  })
  .superRefine((b, ctx) => {
    if (b.country === 'IN') {
      if (!b.stateCode) ctx.addIssue({ code: 'custom', path: ['stateCode'], message: 'GST state code is required in India' });
      if (!/^[1-9][0-9]{5}$/.test(b.postalCode)) ctx.addIssue({ code: 'custom', path: ['postalCode'], message: 'Enter a 6-digit PIN code' });
      if (b.gstin && b.stateCode && b.gstin.slice(0, 2) !== b.stateCode) {
        ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'GSTIN state does not match the selected state' });
      }
    } else if (b.gstin) ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'GSTIN applies to Indian addresses only' });
  });

const Scope = z.object({ scope: z.enum(['personal', 'organization']).default('personal') });
const CheckoutBody = z.object({ planCode: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/), seats: z.number().int().min(1).max(100000).optional() });
const ConfirmBody = z.object({
  orderId: z.string().regex(/^order_[A-Za-z0-9]{6,40}$/),
  paymentId: z.string().regex(/^pay_[A-Za-z0-9]{6,40}$/),
  signature: z.string().regex(/^[0-9a-f]{64}$/),
});
const QuoteBody = z.object({
  planCode: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  seats: z.number().int().min(1).max(100000),
  poNumber: z.string().trim().max(64).optional(),
});
const UuidParam = z.object({ id: z.string().uuid() });

const profileOut = (p: Prisma.BillingProfileGetPayload<object> | null) =>
  p && {
    legalName: p.legalName, gstin: p.gstin, email: p.email, phone: p.phone, addressLine1: p.addressLine1, addressLine2: p.addressLine2,
    city: p.city, state: p.state, stateCode: p.stateCode, postalCode: p.postalCode, country: p.country, updatedAt: p.updatedAt,
  };

/** Personal documents, or the institution's for its administrators. */
function canSee(claims: AccessClaims, owner: { userId: string | null; orgId: string | null }): boolean {
  if (owner.userId && owner.userId === claims.sub) return true;
  return !!owner.orgId && owner.orgId === claims.org_id && ORG_BILLING_ROLES.has(claims.role);
}

export default async function billingRoutes(app: FastifyInstance, d: Deps) {
  const auth = requireUser(d);
  const opts = { config: { rateLimit: 'api' as const }, preHandler: auth };

  const scopeOwner = (claims: AccessClaims, scope: 'personal' | 'organization') => {
    if (scope === 'personal') return { userId: claims.sub, orgId: null };
    if (!claims.org_id || !ORG_BILLING_ROLES.has(claims.role)) {
      throw forbidden('INSTITUTE_ADMIN_REQUIRED', 'Only your institution administrator manages institutional billing');
    }
    return { userId: null, orgId: claims.org_id };
  };

  // ------------------------------------------------------ billing profile --
  app.get<{ Querystring: { scope?: string } }>('/v1/api/billing/profile', opts, async (req) => {
    const { scope } = parse(Scope, req.query);
    const owner = scopeOwner(req.auth!, scope);
    const p = await d.prisma.billingProfile.findFirst({ where: owner.orgId ? { orgId: owner.orgId } : { userId: owner.userId! } });
    return { scope, profile: profileOut(p) };
  });

  app.put<{ Querystring: { scope?: string } }>('/v1/api/billing/profile', opts, async (req) => {
    const { scope } = parse(Scope, req.query);
    const body = parse(ProfileFields, req.body);
    const owner = scopeOwner(req.auth!, scope);
    const data = { ...body, gstin: body.gstin ?? null, phone: body.phone ?? null, addressLine2: body.addressLine2 ?? null, state: body.state ?? null, stateCode: body.country === 'IN' ? body.stateCode! : null };
    try {
      const p = await withAudit(d.prisma, actorOf(req), (tx) =>
        owner.orgId
          ? tx.billingProfile.upsert({ where: { orgId: owner.orgId }, create: { ...data, orgId: owner.orgId }, update: data })
          : tx.billingProfile.upsert({ where: { userId: owner.userId! }, create: { ...data, userId: owner.userId! }, update: data }),
      );
      return { scope, profile: profileOut(p) };
    } catch (err) {
      if (pgCode(err) === '23514') throw badRequest('INVALID_BILLING_PROFILE', 'The GSTIN, state or PIN code is not valid');
      throw err;
    }
  });

  // ------------------------------------------------------------- checkout --
  app.post('/v1/api/billing/checkout', opts, async (req) => {
    const body = parse(CheckoutBody, req.body);
    const claims = req.auth!;
    if (!claims.email_verified) throw forbidden('EMAIL_NOT_VERIFIED', 'Verify your email address before purchasing');
    assertInvoicing(d.cfg);
    const plan = await d.prisma.plan.findUnique({ where: { planCode: body.planCode } });
    if (!plan || !plan.active || !plan.isPublic) throw notFound('UNKNOWN_PLAN', 'Unknown plan');

    const site = plan.kind === 'SITE_LICENSE';
    const owner = scopeOwner(claims, site ? 'organization' : 'personal');
    const seats = site ? (body.seats ?? plan.minSeats) : 1;
    if (seats < plan.minSeats || (plan.maxSeats !== null && seats > plan.maxSeats)) {
      throw badRequest('SEATS_OUT_OF_RANGE', `This plan is sold for ${plan.minSeats}${plan.maxSeats ? `-${plan.maxSeats}` : '+'} seats`);
    }
    const recurring = await d.prisma.subscription.findFirst({
      where: { ...(owner.orgId ? { orgId: owner.orgId } : { userId: owner.userId! }), planCode: plan.planCode, billingMode: 'RECURRING', status: { in: ['ACTIVE', 'PAST_DUE'] } },
      select: { id: true },
    });
    if (recurring) throw conflict('ALREADY_SUBSCRIBED', 'This plan already renews automatically - manage it from billing');
    const profile = await d.prisma.billingProfile.findFirst({ where: owner.orgId ? { orgId: owner.orgId } : { userId: owner.userId! } });
    if (!profile) throw new HttpError(409, 'BILLING_PROFILE_REQUIRED', 'Add your billing details first (needed for the GST invoice)');
    return startCheckout(d, actorOf(req), { plan, seats, owner, profile, buyer: { id: claims.sub, email: claims.email, name: claims.name } });
  });

  /** Browser callback of Razorpay Checkout: verify, capture if needed, activate, return fresh claims. */
  app.post('/v1/api/billing/razorpay/confirm', opts, async (req, reply) => {
    const body = parse(ConfirmBody, req.body);
    const claims = req.auth!;
    const rzp = d.billing.RAZORPAY;
    if (!rzp.verifyPaymentSignature(body.orderId, body.paymentId, body.signature)) {
      throw unauthorized('PAYMENT_SIGNATURE_INVALID', 'Payment could not be verified');
    }
    let payment = await rzp.getPayment(body.paymentId);
    if (payment.orderId !== body.orderId) throw badRequest('PAYMENT_ORDER_MISMATCH', 'Payment does not belong to this order');
    const order = await rzp.getOrder(body.orderId);
    const invoiceId = order.notes.invoice_id;
    if (!invoiceId) throw notFound('UNKNOWN_ORDER', 'Unknown order');
    const inv = await d.prisma.invoice.findUnique({ where: { id: invoiceId }, select: { userId: true, orgId: true } });
    if (!inv || !canSee(claims, inv)) throw notFound('UNKNOWN_ORDER', 'Unknown order');
    if (payment.status === 'authorized') payment = await rzp.capturePayment(payment.id, payment.amount);
    if (payment.status !== 'captured') throw new HttpError(402, 'PAYMENT_NOT_CAPTURED', 'The payment has not completed');
    const r = await finalizeOneTime(d, invoiceId, {
      provider: 'RAZORPAY', providerPaymentId: payment.id, providerOrderId: payment.orderId, amountMinor: BigInt(payment.amount),
      currency: payment.currency, method: payment.method, feeMinor: payment.fee === null ? null : BigInt(payment.fee),
    });
    if (r.status === 'amount_mismatch' || r.status === 'duplicate_payment') {
      throw new HttpError(409, r.status.toUpperCase(), 'Payment received but could not be applied automatically - our team will contact you');
    }
    const fresh = await d.sessions.reissueAccess(reply, claims.sub, claims.sid);
    return { status: 'active', invoiceId, subscriptionId: r.subscriptionId, user: publicUser(fresh) };
  });

  // -------------------------------------------------------- subscriptions --
  app.get('/v1/api/billing/subscriptions', opts, async (req) => {
    const claims = req.auth!;
    const orgAdmin = !!claims.org_id && ORG_BILLING_ROLES.has(claims.role);
    const subs = await d.prisma.subscription.findMany({
      where: { status: { not: 'PENDING' }, OR: [{ userId: claims.sub }, ...(orgAdmin ? [{ orgId: claims.org_id! }] : [])] },
      include: { plan: { select: { name: true, kind: true, interval: true, pricingModel: true } } },
      orderBy: { currentPeriodEnd: 'desc' },
      take: 100,
    });
    return {
      subscriptions: subs.map((s) => ({
        id: s.id, provider: s.provider, billingMode: s.billingMode, planCode: s.planCode, plan: s.plan, status: s.status,
        currency: s.currency, seats: s.seats, unitAmountMinor: Number(s.unitAmountMinor), currentPeriodStart: s.currentPeriodStart,
        currentPeriodEnd: s.currentPeriodEnd, cancelAtPeriodEnd: s.cancelAtPeriodEnd, scope: s.orgId ? 'organization' : 'personal',
        inForce: (s.status === 'ACTIVE' || s.status === 'PAST_DUE') && s.currentPeriodEnd > new Date(),
      })),
    };
  });

  app.post('/v1/api/billing/subscriptions/:id/cancel', opts, async (req) => {
    const { id } = parse(UuidParam, req.params);
    const sub = await d.prisma.subscription.findUnique({ where: { id } });
    if (!sub || !canSee(req.auth!, sub)) throw notFound();
    if (sub.billingMode !== 'RECURRING' || !sub.externalSubId || sub.provider !== 'STRIPE') {
      throw conflict('NOT_RECURRING', 'Prepaid licences do not renew automatically; access ends on the period end date');
    }
    if (sub.status === 'CANCELED' || sub.cancelAtPeriodEnd) throw conflict('ALREADY_CANCELED', 'Renewal is already cancelled');
    await d.billing.STRIPE.cancelAtPeriodEnd(sub.externalSubId);
    await withAudit(d.prisma, actorOf(req), async (tx) => {
      await tx.subscription.update({ where: { id }, data: { cancelAtPeriodEnd: true } });
      await audit(tx, 'BILLING.CANCEL_REQUESTED', id, { provider: sub.provider });
    });
    return { status: 'cancel_at_period_end', currentPeriodEnd: sub.currentPeriodEnd };
  });

  // ------------------------------------------------------------- invoices --
  app.get('/v1/api/billing/invoices', opts, async (req) => {
    const claims = req.auth!;
    const orgAdmin = !!claims.org_id && ORG_BILLING_ROLES.has(claims.role);
    const rows = await d.prisma.invoice.findMany({
      where: { status: { not: 'DRAFT' }, OR: [{ userId: claims.sub }, ...(orgAdmin ? [{ orgId: claims.org_id! }] : [])] },
      orderBy: { issuedAt: 'desc' },
      take: 200,
    });
    return { invoices: rows.map(toApiInvoice) };
  });

  app.get('/v1/api/billing/invoices/:id/pdf', opts, async (req) => {
    const { id } = parse(UuidParam, req.params);
    const inv = await d.prisma.invoice.findUnique({ where: { id } });
    if (!inv || inv.status === 'DRAFT' || !canSee(req.auth!, inv)) throw notFound();
    return pdfLink(d, inv, actorOf(req));
  });

  app.get('/v1/api/billing/payments', opts, async (req) => {
    const claims = req.auth!;
    const orgAdmin = !!claims.org_id && ORG_BILLING_ROLES.has(claims.role);
    const rows = await d.prisma.payment.findMany({
      where: { OR: [{ userId: claims.sub }, ...(orgAdmin ? [{ orgId: claims.org_id! }] : [])] },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, provider: true, status: true, currency: true, amountMinor: true, refundedMinor: true, method: true, description: true, invoiceId: true, capturedAt: true, createdAt: true },
    });
    return { payments: rows.map((p) => ({ ...p, amountMinor: Number(p.amountMinor), refundedMinor: Number(p.refundedMinor) })) };
  });

  /** Self-service quotation for an institution's procurement office. */
  app.post('/v1/api/billing/quotes', opts, async (req, reply) => {
    const body = parse(QuoteBody, req.body);
    const claims = req.auth!;
    const owner = scopeOwner(claims, 'organization');
    assertInvoicing(d.cfg);
    const plan = await d.prisma.plan.findUnique({ where: { planCode: body.planCode } });
    if (!plan || !plan.active || !plan.isPublic || plan.kind !== 'SITE_LICENSE') throw notFound('UNKNOWN_PLAN', 'Unknown site-licence plan');
    const profile = await d.prisma.billingProfile.findUnique({ where: { orgId: owner.orgId! } });
    if (!profile) throw new HttpError(409, 'BILLING_PROFILE_REQUIRED', 'Add the institution billing details first');
    const pf = await withAudit(d.prisma, actorOf(req), (tx) =>
      createProforma(tx, d, { orgId: owner.orgId!, profile, plan, seats: body.seats, poNumber: body.poNumber ?? null, validDays: d.cfg.PROFORMA_VALIDITY_DAYS, createdBy: claims.sub }),
    );
    const link = await pdfLink(d, pf, actorOf(req));
    await d.mailer
      .send({ to: profile.email, ...templates.proformaIssued(profile.legalName, pf.number!, pf.currency, pf.totalMinor, pf.validUntil!.toISOString().slice(0, 10), `${d.cfg.webOrigin}/workspace/billing?invoice=${pf.id}`) })
      .catch(() => undefined);
    return reply.code(201).send({ invoice: toApiInvoice(pf), pdf: link });
  });

  // ------------------------------------------------------------- webhooks --
  await app.register(async (hooks) => {
    // Signatures are computed over the exact bytes received.
    hooks.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 1_048_576 }, (_req, body, done) => done(null, body));

    const record = async (provider: BillingProvider, externalEventId: string, eventType: string, raw: Buffer) => {
      const payload = JSON.parse(raw.toString('utf8')) as Prisma.InputJsonValue;
      const existing = await d.prisma.billingEvent.findUnique({ where: { provider_externalEventId: { provider, externalEventId } } });
      if (existing?.processedAt) return null;
      return existing ?? (await d.prisma.billingEvent.create({ data: { provider, externalEventId, eventType, payload, payloadSha256: sha256Hex(raw) } }));
    };
    const finish = (eventId: string, error: unknown) =>
      d.prisma.billingEvent.update({
        where: { id: eventId },
        data: error ? { error: String((error as Error).message ?? error).slice(0, 2000) } : { processedAt: new Date(), error: null },
      });
    const run = async (req: FastifyRequest, provider: BillingProvider, eventId: string, type: string, raw: Buffer, handle: () => Promise<void>) => {
      const row = await record(provider, eventId, type, raw);
      if (!row) return { received: true, duplicate: true };
      try {
        await handle();
        await finish(row.id, null);
      } catch (err) {
        req.log.error({ err, eventId, provider }, 'billing webhook processing failed');
        await finish(row.id, err);
        throw new HttpError(500, 'WEBHOOK_FAILED', 'Processing failed; the provider will retry');
      }
      return { received: true };
    };

    hooks.post('/v1/billing/webhooks/stripe', { config: { csrf: false, rateLimit: 'webhook' } }, async (req) => {
      const raw = req.body as Buffer;
      const sig = req.headers['stripe-signature'];
      if (!Buffer.isBuffer(raw) || !d.billing.STRIPE.verifyWebhook(raw, Array.isArray(sig) ? sig[0] : sig)) {
        throw unauthorized('WEBHOOK_SIGNATURE_INVALID', 'Invalid signature');
      }
      const event = JSON.parse(raw.toString('utf8')) as { id: string; type: string; data: { object: Record<string, unknown> } };
      return run(req, 'STRIPE', event.id, event.type, raw, () => handleStripe(event.type, event.data.object));
    });

    hooks.post('/v1/billing/webhooks/razorpay', { config: { csrf: false, rateLimit: 'webhook' } }, async (req) => {
      const raw = req.body as Buffer;
      const sig = req.headers['x-razorpay-signature'];
      if (!Buffer.isBuffer(raw) || !d.billing.RAZORPAY.verifyWebhook(raw, Array.isArray(sig) ? sig[0] : sig)) {
        throw unauthorized('WEBHOOK_SIGNATURE_INVALID', 'Invalid signature');
      }
      const event = JSON.parse(raw.toString('utf8')) as RazorpayEvent;
      const hdrId = req.headers['x-razorpay-event-id'];
      const eventId = (Array.isArray(hdrId) ? hdrId[0] : hdrId) || `${event.event}:${sha256Hex(raw)}`;
      return run(req, 'RAZORPAY', eventId, event.event, raw, () => handleRazorpay(event));
    });
  });

  // ------------------------------------------------------- event handlers --
  async function handleStripe(type: string, o: Record<string, unknown>) {
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    switch (type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const meta = (o.metadata ?? {}) as Record<string, string>;
        if (o.mode === 'payment' && o.payment_status === 'paid' && meta.invoice_id && str(o.payment_intent)) {
          await finalizeOneTime(d, meta.invoice_id, {
            provider: 'STRIPE', providerPaymentId: str(o.payment_intent)!, providerOrderId: str(o.id), amountMinor: BigInt(Number(o.amount_total ?? 0)),
            currency: String(o.currency ?? '').toUpperCase(), method: 'card', feeMinor: null,
          });
        }
        break;
      }
      case 'invoice.paid': {
        const subId = str(o.subscription);
        if (!subId || !str(o.id)) break;
        const remote = await d.billing.STRIPE.getSubscription(subId);
        await recordStripeInvoicePaid(
          d,
          { id: str(o.id)!, subscriptionId: subId, amountPaid: BigInt(Number(o.amount_paid ?? 0)), currency: String(o.currency ?? '').toUpperCase(), paymentIntent: str(o.payment_intent), billingReason: str(o.billing_reason) },
          remote,
        );
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        if (str(o.id)) await syncStripeSubscription(d, await d.billing.STRIPE.getSubscription(str(o.id)!));
        break;
      case 'charge.refunded':
        if (str(o.payment_intent)) await applyRefund(d, 'STRIPE', str(o.payment_intent)!, BigInt(Number(o.amount_refunded ?? 0)));
        break;
      default:
        break; // acknowledged, nothing to do
    }
  }

  interface RazorpayEvent {
    event: string;
    payload: {
      payment?: { entity: Parameters<typeof toRazorpayPayment>[0] & { notes?: Record<string, string> | unknown[] } };
      order?: { entity: { id: string; notes?: Record<string, string> | unknown[] } };
      refund?: { entity: { id: string; payment_id: string; amount: number } };
    };
  }

  async function invoiceForOrder(orderId: string | null, embedded?: Record<string, string> | unknown[]): Promise<string | null> {
    if (embedded && !Array.isArray(embedded) && embedded.invoice_id) return embedded.invoice_id;
    if (!orderId) return null;
    return (await d.billing.RAZORPAY.getOrder(orderId)).notes.invoice_id ?? null;
  }

  async function handleRazorpay(event: RazorpayEvent) {
    const rawPayment = event.payload.payment?.entity;
    switch (event.event) {
      case 'payment.captured':
      case 'order.paid': {
        if (!rawPayment) return;
        const p = toRazorpayPayment(rawPayment);
        if (p.status !== 'captured') return;
        const invoiceId = await invoiceForOrder(p.orderId, event.payload.order?.entity.notes);
        if (!invoiceId) return; // not an AltVivo checkout order
        await finalizeOneTime(d, invoiceId, {
          provider: 'RAZORPAY', providerPaymentId: p.id, providerOrderId: p.orderId, amountMinor: BigInt(p.amount), currency: p.currency,
          method: p.method, feeMinor: p.fee === null ? null : BigInt(p.fee),
        });
        return;
      }
      case 'payment.failed': {
        if (!rawPayment) return;
        const p = toRazorpayPayment(rawPayment);
        const invoiceId = await invoiceForOrder(p.orderId, event.payload.order?.entity.notes);
        if (!invoiceId) return;
        await recordFailedPayment(d, invoiceId, {
          provider: 'RAZORPAY', providerPaymentId: p.id, providerOrderId: p.orderId, amountMinor: BigInt(p.amount), currency: p.currency,
          method: p.method, feeMinor: null, failureCode: p.errorCode, failureReason: p.errorDescription,
        });
        return;
      }
      case 'refund.processed':
      case 'refund.created': {
        const paymentId = event.payload.refund?.entity.payment_id ?? rawPayment?.id;
        if (!paymentId) return;
        const total = rawPayment?.amount_refunded ?? (await d.billing.RAZORPAY.getPayment(paymentId)).amountRefunded;
        await applyRefund(d, 'RAZORPAY', paymentId, BigInt(total));
        return;
      }
      default:
        return;
    }
  }
}

/** Short-lived download link to the stored PDF (rendered on first request if needed). */
export async function pdfLink(d: Deps, inv: Pick<Invoice, 'id' | 'number' | 'kind'>, actor: AuditActor = systemActor()) {
  const { key, sha256 } = await ensurePdf(d.prisma, d.storage, d.cfg, inv.id);
  const ttl = d.cfg.R2_PRESIGN_TTL_SECONDS;
  const name = `AltVivo-${inv.number!.replaceAll('/', '-')}.pdf`;
  const url = await d.storage.presignGet(d.cfg.R2_BUCKET_VAULT, key, ttl, name);
  await withAudit(d.prisma, actor, (tx) => audit(tx, 'BILLING.INVOICE_DOWNLOADED', inv.id, { number: inv.number, kind: inv.kind })).catch(() => undefined);
  return { url, fileName: name, sha256, expiresInSeconds: ttl };
}
