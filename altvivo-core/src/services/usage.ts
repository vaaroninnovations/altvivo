import type { BillingProfile } from '@prisma/client';
import type { Deps } from '../deps.js';
import { audit, withAudit, type AuditActor } from '../lib/audit.js';
import { conflict } from '../lib/errors.js';
import type { CheckoutResponse } from './checkout.js';
import { createDraft, type DraftLine } from './invoices.js';

/**
 * Pay per use. One credit = one animal / video tracked and analysed in an app
 * that is sold per use (app_registry.requires_credits). Credits are bought in
 * advance on a GST tax invoice; the app reports each analysis to
 * POST /v1/internal/usage, which takes one credit unless the person holds a
 * subscription, licence or free month for that app.
 */
export const USAGE_PURCHASE = 'USAGE_PURCHASE';
export const USAGE_CHARGE = 'USAGE';
export const USAGE_REFUND = 'USAGE_PURCHASE_REFUND';

/** An invoice line that sells analyses (no plan; quantity = number of analyses). */
export const isUsageLine = (line: { planCode: string | null; appId: string | null }) => line.planCode === null && line.appId !== null;

export function usageLine(d: Deps, app: { appId: string; name: string }, quantity: number): DraftLine {
  return {
    description: `${app.name} pay per use - ${quantity} ${quantity === 1 ? 'analysis' : 'analyses'} (one animal / video each)`,
    sacCode: '997331',
    appId: app.appId,
    planCode: null,
    quantity,
    unitPriceMinor: BigInt(d.cfg.PAY_PER_USE_PRICE_PAISE),
    gstRateBp: 1800,
  };
}

export interface StartUsageCheckout {
  app: { appId: string; name: string };
  quantity: number;
  profile: BillingProfile;
  buyer: { id: string; email: string; name: string };
}

/** Same flow as a plan purchase: a DRAFT tax invoice priced by the database, paid through Razorpay. */
export async function startUsageCheckout(d: Deps, actor: AuditActor, s: StartUsageCheckout): Promise<CheckoutResponse> {
  if (s.profile.country !== 'IN') {
    throw conflict('INDIA_BILLING_ONLY', 'We bill in Indian rupees to billing addresses in India. For other countries, please contact sales@altvivo.bio');
  }
  if (!d.billing.RAZORPAY.enabled) throw conflict('PROVIDER_UNAVAILABLE', 'Online payment is not available yet - contact sales@altvivo.bio');

  const draft = await withAudit(d.prisma, actor, async (tx) => {
    const inv = await createDraft(tx, d.cfg, {
      kind: 'TAX_INVOICE',
      owner: { userId: s.buyer.id, orgId: null },
      profile: s.profile,
      currency: 'INR',
      lines: [usageLine(d, s.app, s.quantity)],
      createdBy: s.buyer.id,
    });
    await audit(tx, 'BILLING.CHECKOUT_STARTED', inv.id, { provider: 'RAZORPAY', pay_per_use: s.app.appId, quantity: s.quantity, total_minor: inv.totalMinor.toString(), currency: 'INR' });
    return inv;
  });

  const metadata = { invoice_id: draft.id, user_id: s.buyer.id, pay_per_use: s.app.appId };
  const order = await d.billing.RAZORPAY.createOrder({ amountMinor: draft.totalMinor, receipt: `inv_${draft.id.replaceAll('-', '').slice(0, 32)}`, notes: metadata });
  return {
    provider: 'RAZORPAY',
    invoiceId: draft.id,
    currency: 'INR',
    amountMinor: Number(draft.totalMinor),
    razorpay: {
      keyId: d.billing.RAZORPAY.keyId,
      orderId: order.id,
      amount: order.amount,
      currency: 'INR',
      name: 'AltVivo',
      description: draft.lines[0]!.description,
      prefill: { name: s.profile.legalName, email: s.profile.email, ...(s.profile.phone ? { contact: s.profile.phone } : {}) },
      notes: metadata,
    },
  };
}
