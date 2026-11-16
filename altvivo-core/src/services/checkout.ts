import type { BillingProfile, Invoice, Plan, Prisma, Subscription } from '@prisma/client';
import type { Deps } from '../deps.js';
import { audit, systemActor, withAudit, type AuditActor, type Tx } from '../lib/audit.js';
import { HttpError, conflict } from '../lib/errors.js';
import { templates } from '../lib/mailer.js';
import { affectedUsers } from './access.js';
import type { StripeSubscription } from './billing.js';
import { mapStripeStatus } from './billing.js';
import { ledgerEntryExists, postLedger } from './credits.js';
import { USAGE_PURCHASE, USAGE_REFUND, isUsageLine } from './usage.js';
import {
  addInterval,
  createDraft,
  draftFrom,
  ensurePdf,
  fullCreditNote,
  issue,
  linesOf,
  lockInvoice,
  planLine,
  type InvoiceWithLines,
  type Owner,
} from './invoices.js';

export type PaymentProviderId = 'RAZORPAY' | 'STRIPE';

export interface CapturedPayment {
  provider: PaymentProviderId;
  providerPaymentId: string;
  providerOrderId: string | null;
  amountMinor: bigint;
  currency: string;
  method: string | null;
  feeMinor: bigint | null;
}

export type FinalizeResult =
  | { status: 'activated' | 'already_processed'; invoiceId: string; subscriptionId: string | null; owner: Owner }
  | { status: 'amount_mismatch' | 'duplicate_payment'; invoiceId: string; subscriptionId: null; owner: Owner };

const ownerWhere = (o: Owner) => (o.orgId ? { orgId: o.orgId } : { userId: o.userId! });
const ownerOf = (i: Pick<Invoice, 'userId' | 'orgId'>): Owner => ({ userId: i.userId, orgId: i.orgId });

async function planApps(tx: Tx, planCode: string): Promise<string[]> {
  const rows = await tx.planEntitlement.findMany({ where: { planCode, accessLevel: 'FULL' }, orderBy: { appId: 'asc' } });
  return rows.map((r) => r.appId);
}

/** Paid-for terms of the same plan stack: a renewal bought early starts when the current one ends. */
async function termStart(tx: Tx, owner: Owner, planCode: string, now: Date): Promise<Date> {
  const latest = await tx.subscription.findFirst({
    where: { ...ownerWhere(owner), planCode, status: { in: ['ACTIVE', 'PAST_DUE'] }, currentPeriodEnd: { gt: now } },
    orderBy: { currentPeriodEnd: 'desc' },
    select: { currentPeriodEnd: true },
  });
  return latest ? latest.currentPeriodEnd : now;
}

async function grantPlanCredits(tx: Tx, owner: Owner, plan: Plan, referenceId: string): Promise<void> {
  const amount = plan.monthlyCredits * (plan.interval === 'YEAR' ? 12 : 1);
  if (amount <= 0) return;
  if (await ledgerEntryExists(tx, owner, 'PLAN_CREDIT_GRANT', referenceId)) return;
  await postLedger(tx, { userId: owner.userId, orgId: owner.orgId, appId: null, actionType: 'PLAN_CREDIT_GRANT', delta: amount, referenceId });
}

async function syncSeats(tx: Tx, orgId: string | null, seats: number): Promise<void> {
  if (!orgId) return;
  const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { seatLimit: true } });
  if (seats > org.seatLimit) await tx.organization.update({ where: { id: orgId }, data: { seatLimit: seats } });
}

const taxOf = (i: Invoice) => i.cgstMinor + i.sgstMinor + i.igstMinor;

// ====================================================== checkout start =====

export interface StartCheckout {
  plan: Plan;
  seats: number;
  owner: Owner;
  profile: BillingProfile;
  buyer: { id: string; email: string; name: string };
}

export type CheckoutResponse =
  | { provider: 'RAZORPAY'; invoiceId: string; currency: 'INR'; amountMinor: number; razorpay: Record<string, unknown> }
  | { provider: 'STRIPE'; invoiceId: string; currency: 'USD'; amountMinor: number; checkoutUrl: string };

/**
 * The DRAFT tax invoice is the checkout record: the database computes its
 * GST total, the provider is asked for exactly that amount, and the
 * provider metadata carries only the invoice id.
 */
export async function startCheckout(d: Deps, actor: AuditActor, s: StartCheckout): Promise<CheckoutResponse> {
  if (s.profile.country !== 'IN' && !d.cfg.USD_BILLING_ENABLED) {
    throw conflict('INDIA_BILLING_ONLY', 'We bill in Indian rupees to billing addresses in India. For other countries, please contact sales@altvivo.bio');
  }
  const currency = s.profile.country === 'IN' ? 'INR' : 'USD';
  const provider: PaymentProviderId = currency === 'INR' ? 'RAZORPAY' : 'STRIPE';
  if (!d.billing[provider].enabled) throw conflict('PROVIDER_UNAVAILABLE', `Online payment in ${currency} is not available yet - contact sales@altvivo.bio`);
  const recurring = provider === 'STRIPE' && !!s.plan.stripePriceId && s.plan.pricingModel === 'FLAT';

  const draft = await withAudit(d.prisma, actor, async (tx) => {
    const apps = await planApps(tx, s.plan.planCode);
    const inv = await createDraft(tx, d.cfg, {
      kind: 'TAX_INVOICE',
      owner: s.owner,
      profile: s.profile,
      currency,
      lines: [planLine(s.plan, s.seats, currency, apps)],
      createdBy: s.buyer.id,
    });
    await audit(tx, 'BILLING.CHECKOUT_STARTED', inv.id, {
      provider, plan: s.plan.planCode, seats: s.seats, total_minor: inv.totalMinor.toString(), currency, recurring,
    });
    return inv;
  });

  const metadata = { invoice_id: draft.id, user_id: s.buyer.id, plan_code: s.plan.planCode };
  if (provider === 'RAZORPAY') {
    const order = await d.billing.RAZORPAY.createOrder({ amountMinor: draft.totalMinor, receipt: `inv_${draft.id.replaceAll('-', '').slice(0, 32)}`, notes: metadata });
    return {
      provider,
      invoiceId: draft.id,
      currency: 'INR',
      amountMinor: Number(draft.totalMinor),
      razorpay: {
        keyId: d.billing.RAZORPAY.keyId,
        orderId: order.id,
        amount: order.amount,
        currency: 'INR',
        name: 'AltVivo',
        description: s.plan.name,
        prefill: { name: s.profile.legalName, email: s.profile.email, ...(s.profile.phone ? { contact: s.profile.phone } : {}) },
        notes: metadata,
      },
    };
  }
  const session = await d.billing.STRIPE.createCheckout(
    {
      mode: recurring ? 'subscription' : 'payment',
      priceId: s.plan.stripePriceId,
      amountMinor: draft.totalMinor,
      productName: draft.lines[0]!.description,
      customerEmail: s.profile.email,
      metadata,
      successUrl: `${d.cfg.webOrigin}/workspace/billing?status=success&invoice=${draft.id}`,
      cancelUrl: `${d.cfg.webOrigin}/workspace/upgrade?status=cancelled${draft.lines[0]?.appId ? `&app=${draft.lines[0].appId}` : ''}`,
    },
    `checkout:${draft.id}`,
  );
  return { provider, invoiceId: draft.id, currency: 'USD', amountMinor: Number(draft.totalMinor), checkoutUrl: session.url };
}

// =================================================== one-time payments =====

/**
 * Activates a prepaid term from a captured payment on a checkout draft.
 * Idempotent (provider payment id is unique) and serialised by a row lock
 * on the invoice, so the webhook and the browser confirmation can race.
 */
export async function finalizeOneTime(d: Deps, invoiceId: string, p: CapturedPayment): Promise<FinalizeResult> {
  const result = await withAudit(d.prisma, systemActor(), async (tx): Promise<FinalizeResult> => {
    const inv = await lockInvoice(tx, invoiceId);
    if (!inv || inv.kind !== 'TAX_INVOICE') throw new Error(`payment ${p.providerPaymentId} references unknown invoice ${invoiceId}`);
    const owner = ownerOf(inv);
    const existing = await tx.payment.findUnique({ where: { provider_providerPaymentId: { provider: p.provider, providerPaymentId: p.providerPaymentId } } });
    if (existing) return { status: 'already_processed', invoiceId, subscriptionId: existing.subscriptionId, owner };

    const base = {
      provider: p.provider,
      status: 'CAPTURED' as const,
      ...ownerWhere(owner),
      currency: p.currency,
      amountMinor: p.amountMinor,
      method: p.method,
      providerOrderId: p.providerOrderId,
      providerPaymentId: p.providerPaymentId,
      feeMinor: p.feeMinor,
      capturedAt: new Date(),
    };
    if (inv.status !== 'DRAFT') {
      await tx.payment.create({ data: { ...base, invoiceId, description: `Duplicate payment for ${inv.number}`, metadata: { duplicate: true } } });
      await audit(tx, 'BILLING.DUPLICATE_PAYMENT', invoiceId, { provider: p.provider, payment: p.providerPaymentId, action: 'refund required' });
      return { status: 'duplicate_payment', invoiceId, subscriptionId: null, owner };
    }
    if (p.amountMinor !== inv.totalMinor || p.currency !== inv.currency) {
      await tx.payment.create({
        data: { ...base, description: 'Payment amount does not match the invoice', metadata: { mismatch: true, expected_minor: inv.totalMinor.toString(), expected_currency: inv.currency } },
      });
      await audit(tx, 'SECURITY.PAYMENT_AMOUNT_MISMATCH', invoiceId, {
        provider: p.provider, payment: p.providerPaymentId, paid: `${p.amountMinor} ${p.currency}`, expected: `${inv.totalMinor} ${inv.currency}`,
      });
      return { status: 'amount_mismatch', invoiceId, subscriptionId: null, owner };
    }

    const line = inv.lines[0]!;
    const now = new Date();
    if (isUsageLine(line)) {
      // Pay per use: the paid analyses become credits of the buyer (their institution's pool when they belong to one).
      const issued = await issue(tx, invoiceId, { paidAt: now });
      await tx.payment.create({ data: { ...base, invoiceId, taxMinor: taxOf(issued), description: `${line.description.split(' - ')[0]} - ${issued.number}`, metadata: { pay_per_use: line.appId, analyses: line.quantity } } });
      const buyer = await tx.user.findUniqueOrThrow({ where: { id: owner.userId! }, select: { orgId: true } });
      const entry = await postLedger(tx, { userId: owner.userId, orgId: buyer.orgId, appId: line.appId, actionType: USAGE_PURCHASE, delta: line.quantity, referenceId: `invoice:${issued.number}` });
      await audit(tx, 'BILLING.PAYMENT_CAPTURED', invoiceId, {
        provider: p.provider, payment: p.providerPaymentId, invoice: issued.number, pay_per_use: line.appId, analyses: line.quantity,
        balance: entry.balanceAfter, total_minor: issued.totalMinor.toString(), currency: issued.currency,
      });
      return { status: 'activated', invoiceId, subscriptionId: null, owner };
    }
    const plan = await tx.plan.findUniqueOrThrow({ where: { planCode: line.planCode! } });
    const seats = plan.pricingModel === 'PER_SEAT' ? line.quantity : 1;
    const start = await termStart(tx, owner, plan.planCode, now);
    const end = addInterval(start, plan.interval);
    const sub = await tx.subscription.create({
      data: {
        ...ownerWhere(owner),
        provider: p.provider,
        billingMode: 'ONE_TIME',
        planCode: plan.planCode,
        status: 'ACTIVE',
        currency: inv.currency,
        seats,
        unitAmountMinor: line.unitPriceMinor,
        currentPeriodStart: start,
        currentPeriodEnd: end,
      },
    });
    await tx.invoiceLine.update({ where: { id: line.id }, data: { periodStart: start, periodEnd: end } });
    await tx.invoice.update({ where: { id: invoiceId }, data: { subscriptionId: sub.id } });
    const issued = await issue(tx, invoiceId, { paidAt: now });
    await tx.payment.create({
      data: { ...base, subscriptionId: sub.id, invoiceId, planCode: plan.planCode, taxMinor: taxOf(issued), description: `${plan.name} - ${issued.number}` },
    });
    await syncSeats(tx, owner.orgId, seats);
    await grantPlanCredits(tx, owner, plan, `invoice:${issued.number}`);
    await audit(tx, 'BILLING.PAYMENT_CAPTURED', sub.id, {
      provider: p.provider, payment: p.providerPaymentId, invoice: issued.number, plan: plan.planCode, seats,
      period_start: start.toISOString(), period_end: end.toISOString(), total_minor: issued.totalMinor.toString(), currency: issued.currency,
    });
    return { status: 'activated', invoiceId, subscriptionId: sub.id, owner };
  });
  if (result.status === 'activated') await afterPaid(d, invoiceId, result.owner);
  return result;
}

/** A failed attempt is recorded for the customer's billing history; the draft stays open for a retry. */
export async function recordFailedPayment(d: Deps, invoiceId: string, p: CapturedPayment & { failureCode: string | null; failureReason: string | null }): Promise<void> {
  await withAudit(d.prisma, systemActor(), async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) return;
    const exists = await tx.payment.findUnique({ where: { provider_providerPaymentId: { provider: p.provider, providerPaymentId: p.providerPaymentId } } });
    if (exists) return;
    await tx.payment.create({
      data: {
        provider: p.provider,
        status: 'FAILED',
        ...ownerWhere(ownerOf(inv)),
        invoiceId: inv.status === 'DRAFT' ? null : inv.id,
        currency: p.currency,
        amountMinor: p.amountMinor,
        method: p.method,
        providerOrderId: p.providerOrderId,
        providerPaymentId: p.providerPaymentId,
        description: 'Payment attempt failed',
        failureCode: p.failureCode?.slice(0, 64) ?? null,
        failureReason: p.failureReason?.slice(0, 500) ?? null,
        metadata: { checkout_invoice_id: invoiceId },
      },
    });
    await audit(tx, 'BILLING.PAYMENT_FAILED', invoiceId, { provider: p.provider, payment: p.providerPaymentId, code: p.failureCode });
  });
}

// ============================================== Stripe recurring plans =====

export interface StripeInvoicePaid {
  id: string;
  subscriptionId: string;
  amountPaid: bigint;
  currency: string;
  paymentIntent: string | null;
  billingReason: string | null;
}

/** Recurring USD subscription: one zero-rated export tax invoice per paid Stripe invoice. */
export async function recordStripeInvoicePaid(d: Deps, si: StripeInvoicePaid, remote: StripeSubscription): Promise<FinalizeResult> {
  const plan = remote.priceId ? await d.prisma.plan.findUnique({ where: { stripePriceId: remote.priceId } }) : null;
  if (!plan) throw new Error(`no plan mapped to Stripe price ${remote.priceId}`);
  const paymentId = si.paymentIntent ?? si.id;
  const result = await withAudit(d.prisma, systemActor(), async (tx): Promise<FinalizeResult> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stripe-sub:${remote.id}`}))`;
    let sub = await tx.subscription.findUnique({ where: { provider_externalSubId: { provider: 'STRIPE', externalSubId: remote.id } } });
    const draftId = remote.metadata.invoice_id;
    const userId = sub?.userId ?? remote.metadata.user_id;
    if (!userId || !(await tx.user.findUnique({ where: { id: userId }, select: { id: true } }))) {
      throw new Error(`Stripe subscription ${remote.id} carries no valid user_id`);
    }
    const owner: Owner = { userId, orgId: null };
    const existing = await tx.payment.findUnique({ where: { provider_providerPaymentId: { provider: 'STRIPE', providerPaymentId: paymentId } } });
    if (existing) return { status: 'already_processed', invoiceId: existing.invoiceId ?? '', subscriptionId: existing.subscriptionId, owner };

    const fields = {
      status: mapStripeStatus(remote.status),
      currentPeriodStart: remote.currentPeriodStart,
      currentPeriodEnd: remote.currentPeriodEnd,
      cancelAtPeriodEnd: remote.cancelAtPeriodEnd,
      externalCustomerId: remote.customerId,
      planCode: plan.planCode,
    };
    sub = sub
      ? await tx.subscription.update({ where: { id: sub.id }, data: fields })
      : await tx.subscription.create({
          data: { ...fields, userId, provider: 'STRIPE', billingMode: 'RECURRING', externalSubId: remote.id, currency: 'USD', seats: 1, unitAmountMinor: si.amountPaid },
        });

    const apps = await planApps(tx, plan.planCode);
    const line = { ...planLine(plan, 1, 'USD', apps, { start: remote.currentPeriodStart, end: remote.currentPeriodEnd }), unitPriceMinor: si.amountPaid };
    let inv: InvoiceWithLines | null = draftId ? await lockInvoice(tx, draftId) : null;
    if (inv && (inv.status !== 'DRAFT' || inv.userId !== userId || si.billingReason !== 'subscription_create')) inv = null;
    if (inv) {
      // Bill exactly what Stripe collected (exports are zero-rated, so price = total).
      await tx.invoiceLine.deleteMany({ where: { invoiceId: inv.id } });
      await tx.invoiceLine.create({ data: { ...line, invoiceId: inv.id, position: 1, discountMinor: 0n, appId: line.appId ?? null, planCode: line.planCode ?? null } });
      await tx.invoice.update({ where: { id: inv.id }, data: { subscriptionId: sub.id } });
    } else {
      const previous = await tx.invoice.findFirst({ where: { subscriptionId: sub.id, kind: 'TAX_INVOICE', status: { in: ['ISSUED', 'PAID'] } }, orderBy: { issuedAt: 'desc' } });
      const profile = await tx.billingProfile.findUnique({ where: { userId } });
      if (previous) inv = await draftFrom(tx, previous, { kind: 'TAX_INVOICE', subscriptionId: sub.id, lines: [line] });
      else if (profile) inv = await createDraft(tx, d.cfg, { kind: 'TAX_INVOICE', owner, profile, currency: 'USD', lines: [line], subscriptionId: sub.id });
      else throw new Error(`no billing details to invoice Stripe subscription ${remote.id}`);
    }
    const issued = await issue(tx, inv.id, { paidAt: new Date() });
    await tx.payment.create({
      data: {
        provider: 'STRIPE', status: 'CAPTURED', userId, subscriptionId: sub.id, invoiceId: issued.id, planCode: plan.planCode,
        currency: 'USD', amountMinor: si.amountPaid, taxMinor: taxOf(issued), method: 'card', providerOrderId: si.id,
        providerPaymentId: paymentId, description: `${plan.name} - ${issued.number}`, capturedAt: new Date(),
      },
    });
    await grantPlanCredits(tx, owner, plan, `invoice:${issued.number}`);
    await audit(tx, 'BILLING.PAYMENT_CAPTURED', sub.id, { provider: 'STRIPE', invoice: issued.number, stripe_invoice: si.id, reason: si.billingReason });
    return { status: 'activated', invoiceId: issued.id, subscriptionId: sub.id, owner };
  });
  if (result.status === 'activated') await afterPaid(d, result.invoiceId, result.owner);
  return result;
}

/** Status / cancellation changes of a recurring subscription. */
export async function syncStripeSubscription(d: Deps, remote: StripeSubscription): Promise<void> {
  const sub = await d.prisma.subscription.findUnique({ where: { provider_externalSubId: { provider: 'STRIPE', externalSubId: remote.id } } });
  if (!sub) return; // created by the first invoice.paid
  const status = mapStripeStatus(remote.status);
  await withAudit(d.prisma, systemActor(), async (tx) => {
    await tx.subscription.update({
      where: { id: sub.id },
      data: {
        status: status === 'PENDING' ? sub.status : status,
        currentPeriodStart: remote.currentPeriodStart,
        currentPeriodEnd: remote.currentPeriodEnd,
        cancelAtPeriodEnd: remote.cancelAtPeriodEnd,
        ...(status === 'CANCELED' ? { canceledAt: remote.canceledAt ?? new Date() } : {}),
      },
    });
    await audit(tx, 'BILLING.SUBSCRIPTION_SYNCED', sub.id, { provider: 'STRIPE', status, cancel_at_period_end: remote.cancelAtPeriodEnd });
  });
  await d.revocations.markClaimsStale(await affectedUsers(d.prisma, sub));
}

// ============================================================ refunds =======

/**
 * Provider-reported refund. A full refund ends the term at once and issues a
 * credit note for the whole invoice; partial refunds are recorded and left
 * for an administrator to document with a credit note of the right amount.
 */
export async function applyRefund(d: Deps, provider: PaymentProviderId, providerPaymentId: string, refundedTotalMinor: bigint): Promise<'full' | 'partial' | 'unknown' | 'unchanged'> {
  const outcome = await withAudit(d.prisma, systemActor(), async (tx) => {
    const pay = await tx.payment.findUnique({ where: { provider_providerPaymentId: { provider, providerPaymentId } } });
    if (!pay) return { kind: 'unknown' as const };
    const refunded = refundedTotalMinor > pay.amountMinor ? pay.amountMinor : refundedTotalMinor;
    if (refunded <= pay.refundedMinor) return { kind: 'unchanged' as const };
    const full = refunded === pay.amountMinor;
    await tx.payment.update({ where: { id: pay.id }, data: { refundedMinor: refunded, refundedAt: new Date(), status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
    let creditNote: string | null = null;
    if (full) {
      if (pay.subscriptionId) {
        await tx.subscription.update({ where: { id: pay.subscriptionId }, data: { status: 'CANCELED', canceledAt: new Date(), endedAt: new Date() } });
      }
      if (pay.invoiceId) {
        const inv = await tx.invoice.findUnique({ where: { id: pay.invoiceId }, include: { lines: { orderBy: { position: 'asc' } } } });
        const credited = await tx.invoice.count({ where: { relatedInvoiceId: pay.invoiceId, kind: 'CREDIT_NOTE', status: 'ISSUED' } });
        if (inv && inv.kind === 'TAX_INVOICE' && inv.status !== 'CANCELLED' && credited === 0) {
          creditNote = (await fullCreditNote(tx, inv, 'Payment refunded in full.', null)).id;
        }
        const line = inv?.lines[0];
        if (inv && line && isUsageLine(line) && pay.userId) {
          // Refunded analyses are withdrawn; those already used cannot be (the balance never goes below zero).
          const buyer = await tx.user.findUniqueOrThrow({ where: { id: pay.userId }, select: { orgId: true } });
          const [{ balance } = { balance: 0 }] = await tx.$queryRaw<{ balance: number }[]>`SELECT credit_balance_for_user(${pay.userId}::uuid) AS balance`;
          const take = Math.min(line.quantity, Number(balance));
          if (take > 0 && !(await ledgerEntryExists(tx, { userId: pay.userId, orgId: buyer.orgId }, USAGE_REFUND, `invoice:${inv.number}`))) {
            await postLedger(tx, { userId: pay.userId, orgId: buyer.orgId, appId: line.appId, actionType: USAGE_REFUND, delta: -take, referenceId: `invoice:${inv.number}` });
          }
        }
      }
    }
    await audit(tx, full ? 'BILLING.REFUND_FULL' : 'BILLING.REFUND_PARTIAL', pay.id, {
      provider, payment: providerPaymentId, refunded_minor: refunded.toString(), credit_note: creditNote,
    });
    return { kind: full ? ('full' as const) : ('partial' as const), owner: { userId: pay.userId, orgId: pay.orgId }, subscriptionId: pay.subscriptionId, creditNote };
  });
  if (outcome.kind === 'full' || outcome.kind === 'partial') {
    await d.revocations.markClaimsStale(await affectedUsers(d.prisma, outcome.owner));
    if (outcome.kind === 'full' && outcome.creditNote) await ensurePdf(d.prisma, d.storage, d.cfg, outcome.creditNote).catch(() => undefined);
    if (outcome.kind === 'full' && outcome.subscriptionId) {
      const sub = await d.prisma.subscription.findUnique({ where: { id: outcome.subscriptionId } });
      if (sub?.billingMode === 'RECURRING' && sub.provider === 'STRIPE' && sub.externalSubId) {
        await d.billing.STRIPE.cancelAtPeriodEnd(sub.externalSubId).catch(() => undefined);
      }
    }
  }
  return outcome.kind;
}

// ============================================ institutional / offline =======

export interface ProformaInput {
  orgId: string;
  profile: BillingProfile;
  plan: Plan;
  seats: number;
  poNumber?: string | null;
  notes?: string | null;
  discountMinor?: bigint;
  validDays: number;
  createdBy: string;
}

/** Issued proforma (PF/...) for academic procurement. Prices from the plan; optional negotiated discount. */
export async function createProforma(tx: Tx, d: Deps, i: ProformaInput): Promise<InvoiceWithLines> {
  if (i.plan.kind !== 'SITE_LICENSE') throw new HttpError(409, 'NOT_A_SITE_LICENCE', 'Proformas are issued for site licences');
  if (i.seats < i.plan.minSeats || (i.plan.maxSeats !== null && i.seats > i.plan.maxSeats)) {
    throw new HttpError(400, 'SEATS_OUT_OF_RANGE', `This licence is sold for ${i.plan.minSeats}${i.plan.maxSeats ? `-${i.plan.maxSeats}` : '+'} seats`);
  }
  if (i.profile.country !== 'IN' && !d.cfg.USD_BILLING_ENABLED) {
    throw conflict('INDIA_BILLING_ONLY', 'We bill in Indian rupees to billing addresses in India. For other countries, please contact sales@altvivo.bio');
  }
  const currency = i.profile.country === 'IN' ? 'INR' : 'USD';
  const apps = await planApps(tx, i.plan.planCode);
  const line = { ...planLine(i.plan, i.seats, currency, apps), discountMinor: i.discountMinor ?? 0n };
  const validUntil = new Date(Date.now() + i.validDays * 86_400_000);
  const draft = await createDraft(tx, d.cfg, {
    kind: 'PROFORMA',
    owner: { userId: null, orgId: i.orgId },
    profile: i.profile,
    currency,
    lines: [line],
    poNumber: i.poNumber ?? null,
    notes: i.notes ?? null,
    validUntil,
    createdBy: i.createdBy,
  });
  const pf = await issue(tx, draft.id);
  await audit(tx, 'BILLING.PROFORMA_ISSUED', pf.id, { number: pf.number, org_id: i.orgId, plan: i.plan.planCode, seats: i.seats, total_minor: pf.totalMinor.toString() });
  return pf;
}

export interface OfflinePayment {
  proformaId: string;
  amountMinor: bigint;
  method: 'neft' | 'rtgs' | 'imps' | 'cheque' | 'upi' | 'wire';
  reference: string;
  paidAt: Date;
  adminId: string;
}

/**
 * NEFT / RTGS / PO settlement of a proforma: records the bank payment, issues
 * the GST tax invoice against the proforma, and grants the institution a
 * manual licence for each app of the plan for one billing interval.
 */
export async function recordOfflinePayment(d: Deps, actor: AuditActor, o: OfflinePayment): Promise<{ taxInvoiceId: string; paymentId: string; orgId: string }> {
  const r = await withAudit(d.prisma, actor, async (tx) => {
    const pf = await lockInvoice(tx, o.proformaId);
    if (!pf || pf.kind !== 'PROFORMA') throw new HttpError(404, 'UNKNOWN_PROFORMA', 'Unknown proforma invoice');
    if (pf.status !== 'ISSUED') throw conflict('PROFORMA_NOT_OPEN', `Proforma ${pf.number} is ${pf.status}`);
    if (!pf.orgId) throw conflict('PROFORMA_WITHOUT_ORG', 'Proforma has no institution');
    if (o.amountMinor !== pf.totalMinor) {
      throw new HttpError(409, 'AMOUNT_MISMATCH', `Received amount must equal the proforma total (${pf.totalMinor} ${pf.currency})`);
    }
    if (o.paidAt.getTime() > Date.now() + 60_000) throw new HttpError(400, 'PAID_AT_IN_FUTURE', 'Payment date cannot be in the future');
    const line = pf.lines[0]!;
    const plan = await tx.plan.findUniqueOrThrow({ where: { planCode: line.planCode! } });
    const apps = await planApps(tx, plan.planCode);
    const now = new Date();
    const latest = await tx.appEntitlement.findFirst({
      where: { orgId: pf.orgId, source: 'MANUAL', revokedAt: null, appId: { in: apps }, expiresAt: { gt: now } },
      orderBy: { expiresAt: 'desc' },
      select: { expiresAt: true },
    });
    const start = latest?.expiresAt ?? now;
    const end = addInterval(start, plan.interval);

    const taxDraft = await draftFrom(tx, pf, {
      kind: 'TAX_INVOICE',
      relatedInvoiceId: pf.id,
      subscriptionId: null,
      lines: linesOf(pf).map((l) => ({ ...l, periodStart: start, periodEnd: end })),
      notes: `Payment received by ${o.method.toUpperCase()} (ref. ${o.reference}).`,
      createdBy: o.adminId,
    });
    const taxInvoice = await issue(tx, taxDraft.id, { paidAt: o.paidAt });
    await tx.invoice.update({ where: { id: pf.id }, data: { status: 'PAID', paidAt: o.paidAt } });
    const pay = await tx.payment.create({
      data: {
        provider: 'BANK_TRANSFER', status: 'CAPTURED', orgId: pf.orgId, invoiceId: taxInvoice.id, planCode: plan.planCode,
        currency: pf.currency, amountMinor: o.amountMinor, taxMinor: taxOf(taxInvoice), method: o.method, reference: o.reference,
        description: `${plan.name} - ${taxInvoice.number} (proforma ${pf.number})`, recordedBy: o.adminId, capturedAt: o.paidAt,
        metadata: { proforma: pf.number } as Prisma.InputJsonValue,
      },
    });
    for (const appId of apps) {
      await tx.appEntitlement.create({
        data: {
          appId, source: 'MANUAL', orgId: pf.orgId, grantedBy: o.adminId, startsAt: start, expiresAt: end,
          reason: `Site licence ${taxInvoice.number} (proforma ${pf.number}), ${line.quantity} seats`, reference: o.reference.slice(0, 120),
        },
      });
    }
    await syncSeats(tx, pf.orgId, plan.pricingModel === 'PER_SEAT' ? line.quantity : 1);
    await grantPlanCredits(tx, { userId: null, orgId: pf.orgId }, plan, `invoice:${taxInvoice.number}`);
    await audit(tx, 'BILLING.OFFLINE_PAYMENT_RECORDED', pay.id, {
      proforma: pf.number, invoice: taxInvoice.number, method: o.method, reference: o.reference, org_id: pf.orgId,
      licence_start: start.toISOString(), licence_end: end.toISOString(),
    });
    return { taxInvoiceId: taxInvoice.id, paymentId: pay.id, orgId: pf.orgId };
  });
  await afterPaid(d, r.taxInvoiceId, { userId: null, orgId: r.orgId });
  return r;
}

// ============================================================ follow-up =====

/** After commit: fresh claims everywhere, the PDF, and the receipt e-mail. Never fails the payment. */
export async function afterPaid(d: Deps, invoiceId: string, owner: Owner): Promise<void> {
  await d.revocations.markClaimsStale(await affectedUsers(d.prisma, owner)).catch(() => undefined);
  try {
    await ensurePdf(d.prisma, d.storage, d.cfg, invoiceId);
    const inv = await d.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    await d.mailer.send({
      to: inv.buyerEmail,
      ...templates.paymentReceipt(inv.buyerName, inv.number!, inv.currency, inv.totalMinor, `${d.cfg.webOrigin}/workspace/billing?invoice=${inv.id}`),
    });
  } catch {
    // The PDF is rendered lazily on first download if this attempt failed.
  }
}

export type { Subscription };
