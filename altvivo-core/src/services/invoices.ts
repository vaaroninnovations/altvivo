import type { BillingProfile, Invoice, InvoiceKind, InvoiceLine, Plan, PrismaClient } from '@prisma/client';
import type { Config } from '../config.js';
import { systemActor, withAudit, type Tx } from '../lib/audit.js';
import { sha256Hex } from '../lib/crypto.js';
import { HttpError, unavailable } from '../lib/errors.js';
import type { ObjectStorage } from '../lib/storage.js';
import { renderInvoicePdf } from '../lib/invoice-pdf.js';

export type InvoiceWithLines = Invoice & { lines: InvoiceLine[] };

export interface Owner {
  userId: string | null;
  orgId: string | null;
}

export interface DraftLine {
  description: string;
  sacCode: string;
  appId?: string | null;
  planCode?: string | null;
  quantity: number;
  unitPriceMinor: bigint;
  discountMinor?: bigint;
  gstRateBp: number;
  periodStart?: Date | null;
  periodEnd?: Date | null;
}

export interface DraftInput {
  kind: InvoiceKind;
  owner: Owner;
  profile: BillingProfile;
  currency: 'INR' | 'USD';
  lines: DraftLine[];
  subscriptionId?: string | null;
  relatedInvoiceId?: string | null;
  poNumber?: string | null;
  notes?: string | null;
  validUntil?: Date | null;
  dueDate?: Date | null;
  createdBy?: string | null;
}

export function assertInvoicing(cfg: Config): void {
  if (!cfg.invoicingEnabled) {
    throw unavailable('INVOICING_NOT_CONFIGURED', 'Billing is not available yet: seller GST details are not configured');
  }
}

/** Currency follows the bill-to country: Indian customers pay INR (Razorpay), others USD (Stripe). */
export const currencyFor = (profile: Pick<BillingProfile, 'country'>): 'INR' | 'USD' => (profile.country === 'IN' ? 'INR' : 'USD');

/** GST treatment + place of supply (IGST Act s.12: location of the recipient). */
export function taxPlacement(sellerStateCode: string, p: Pick<BillingProfile, 'country' | 'stateCode'>) {
  if (p.country !== 'IN') return { taxTreatment: 'EXPORT' as const, placeOfSupply: '96' };
  if (!p.stateCode) throw new HttpError(409, 'BILLING_PROFILE_INCOMPLETE', 'Add your state to the billing profile');
  return p.stateCode === sellerStateCode
    ? { taxTreatment: 'INTRA_STATE' as const, placeOfSupply: p.stateCode }
    : { taxTreatment: 'INTER_STATE' as const, placeOfSupply: p.stateCode };
}

export function formatAddress(p: Pick<BillingProfile, 'addressLine1' | 'addressLine2' | 'city' | 'state' | 'postalCode' | 'country'>): string {
  return [p.addressLine1, p.addressLine2, `${p.city}${p.state ? `, ${p.state}` : ''} ${p.postalCode}`.trim(), p.country]
    .filter(Boolean)
    .join('\n')
    .slice(0, 600);
}

export const planUnitPrice = (plan: Plan, currency: 'INR' | 'USD'): bigint => BigInt(currency === 'INR' ? plan.priceInrPaise : plan.priceUsdCents);

export function addInterval(start: Date, interval: Plan['interval'], times = 1): Date {
  const d = new Date(start.getTime());
  if (interval === 'YEAR') d.setUTCFullYear(d.getUTCFullYear() + times);
  else d.setUTCMonth(d.getUTCMonth() + times);
  return d;
}

/** The single line a plan purchase is invoiced with. */
export function planLine(plan: Plan, seats: number, currency: 'INR' | 'USD', apps: string[], period?: { start: Date; end: Date }): DraftLine {
  const term = plan.interval === 'YEAR' ? '12 months' : '1 month';
  const perSeat = plan.pricingModel === 'PER_SEAT';
  return {
    description: `${plan.name} - ${apps.join(' + ')} licence, ${perSeat ? `${seats} seats x ` : ''}${term}`.slice(0, 500),
    sacCode: plan.sacCode,
    planCode: plan.planCode,
    appId: apps.length === 1 ? apps[0]! : null,
    quantity: perSeat ? seats : 1,
    unitPriceMinor: planUnitPrice(plan, currency),
    gstRateBp: plan.gstRateBp,
    periodStart: period?.start ?? null,
    periodEnd: period?.end ?? null,
  };
}

/**
 * Creates a DRAFT with seller / buyer snapshots. Line amounts and totals are
 * computed by database triggers, so the returned row carries the real total.
 */
export async function createDraft(tx: Tx, cfg: Config, i: DraftInput): Promise<InvoiceWithLines> {
  assertInvoicing(cfg);
  const { taxTreatment, placeOfSupply } = taxPlacement(cfg.SELLER_STATE_CODE, i.profile);
  const inv = await tx.invoice.create({
    data: {
      kind: i.kind,
      userId: i.owner.userId,
      orgId: i.owner.orgId,
      subscriptionId: i.subscriptionId ?? null,
      relatedInvoiceId: i.relatedInvoiceId ?? null,
      currency: i.currency,
      taxTreatment,
      sellerLegalName: cfg.SELLER_LEGAL_NAME,
      sellerGstin: cfg.SELLER_GSTIN,
      sellerAddress: cfg.SELLER_ADDRESS.slice(0, 600),
      sellerStateCode: cfg.SELLER_STATE_CODE,
      buyerName: i.profile.legalName,
      buyerEmail: i.profile.email,
      buyerGstin: i.profile.gstin,
      buyerAddress: formatAddress(i.profile),
      buyerStateCode: i.profile.country === 'IN' ? i.profile.stateCode : null,
      buyerCountry: i.profile.country,
      placeOfSupply,
      poNumber: i.poNumber ?? null,
      notes: i.notes ?? null,
      validUntil: i.validUntil ?? null,
      dueDate: i.dueDate ?? null,
      createdBy: i.createdBy ?? null,
    },
  });
  await tx.invoiceLine.createMany({
    data: i.lines.map((l, idx) => ({
      invoiceId: inv.id,
      position: idx + 1,
      description: l.description,
      sacCode: l.sacCode,
      appId: l.appId ?? null,
      planCode: l.planCode ?? null,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      discountMinor: l.discountMinor ?? 0n,
      gstRateBp: l.gstRateBp,
      periodStart: l.periodStart ?? null,
      periodEnd: l.periodEnd ?? null,
    })),
  });
  return tx.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: { lines: { orderBy: { position: 'asc' } } } });
}

/** Issue (gapless number assigned by the database) and optionally settle. */
export async function issue(tx: Tx, id: string, opts: { paidAt?: Date } = {}): Promise<InvoiceWithLines> {
  await tx.invoice.update({ where: { id }, data: { status: 'ISSUED' } });
  if (opts.paidAt) await tx.invoice.update({ where: { id }, data: { status: 'PAID', paidAt: opts.paidAt } });
  return tx.invoice.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { position: 'asc' } } } });
}

/** Row lock so concurrent finalisers (webhook + browser confirm) serialise. */
export async function lockInvoice(tx: Tx, id: string): Promise<InvoiceWithLines | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM invoices WHERE id = ${id}::uuid FOR UPDATE`;
  if (!rows.length) return null;
  return tx.invoice.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { position: 'asc' } } } });
}

/**
 * New DRAFT reusing another document's seller / buyer snapshot (tax invoice
 * from a proforma, renewal invoice from the previous one, credit note).
 */
export async function draftFrom(
  tx: Tx,
  base: Invoice,
  o: { kind: InvoiceKind; lines: DraftLine[]; relatedInvoiceId?: string | null; subscriptionId?: string | null; notes?: string | null; createdBy?: string | null },
): Promise<InvoiceWithLines> {
  const draft = await tx.invoice.create({
    data: {
      kind: o.kind,
      userId: base.userId,
      orgId: base.orgId,
      subscriptionId: o.subscriptionId ?? base.subscriptionId,
      relatedInvoiceId: o.relatedInvoiceId ?? null,
      currency: base.currency,
      taxTreatment: base.taxTreatment,
      sellerLegalName: base.sellerLegalName,
      sellerGstin: base.sellerGstin,
      sellerAddress: base.sellerAddress,
      sellerStateCode: base.sellerStateCode,
      buyerName: base.buyerName,
      buyerEmail: base.buyerEmail,
      buyerGstin: base.buyerGstin,
      buyerAddress: base.buyerAddress,
      buyerStateCode: base.buyerStateCode,
      buyerCountry: base.buyerCountry,
      placeOfSupply: base.placeOfSupply,
      poNumber: base.poNumber,
      notes: o.notes ?? null,
      createdBy: o.createdBy ?? null,
    },
  });
  await tx.invoiceLine.createMany({
    data: o.lines.map((l, idx) => ({
      invoiceId: draft.id,
      position: idx + 1,
      description: l.description,
      sacCode: l.sacCode,
      appId: l.appId ?? null,
      planCode: l.planCode ?? null,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      discountMinor: l.discountMinor ?? 0n,
      gstRateBp: l.gstRateBp,
      periodStart: l.periodStart ?? null,
      periodEnd: l.periodEnd ?? null,
    })),
  });
  return tx.invoice.findUniqueOrThrow({ where: { id: draft.id }, include: { lines: { orderBy: { position: 'asc' } } } });
}

export const linesOf = (inv: InvoiceWithLines, prefix = ''): DraftLine[] =>
  inv.lines.map((l) => ({
    description: `${prefix}${l.description}`.slice(0, 500),
    sacCode: l.sacCode,
    appId: l.appId,
    planCode: l.planCode,
    quantity: l.quantity,
    unitPriceMinor: l.unitPriceMinor,
    discountMinor: l.discountMinor,
    gstRateBp: l.gstRateBp,
    periodStart: l.periodStart,
    periodEnd: l.periodEnd,
  }));

/** A credit note reversing a whole tax invoice (same lines, same tax). */
export async function fullCreditNote(tx: Tx, original: InvoiceWithLines, reason: string, createdBy: string | null): Promise<InvoiceWithLines> {
  const draft = await draftFrom(tx, original, {
    kind: 'CREDIT_NOTE',
    relatedInvoiceId: original.id,
    lines: linesOf(original, 'Credit: '),
    notes: `Reverses ${original.number}. ${reason}`.slice(0, 2000),
    createdBy,
  });
  return issue(tx, draft.id);
}

export const invoicePdfKey = (inv: Pick<Invoice, 'financialYear' | 'number' | 'id'>) =>
  `invoices/${inv.financialYear}/${inv.number!.replaceAll('/', '-')}-${inv.id.slice(0, 8)}.pdf`;

/**
 * Renders and stores the PDF of an issued document once (the key and SHA-256
 * are written into the invoice and can never change afterwards).
 */
export async function ensurePdf(prisma: PrismaClient, storage: ObjectStorage, cfg: Config, id: string): Promise<{ key: string; sha256: string }> {
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { position: 'asc' } }, relatedInvoice: true } });
  if (inv.status === 'DRAFT') throw new HttpError(409, 'INVOICE_NOT_ISSUED', 'Draft documents have no PDF');
  if (inv.pdfObjectKey && inv.pdfSha256) return { key: inv.pdfObjectKey, sha256: inv.pdfSha256 };
  const pdf = await renderInvoicePdf(inv, inv.relatedInvoice, cfg);
  const key = invoicePdfKey(inv);
  const sha256 = sha256Hex(pdf);
  await storage.put(cfg.R2_BUCKET_VAULT, key, pdf, 'application/pdf');
  try {
    await withAudit(prisma, systemActor(), (tx) => tx.invoice.update({ where: { id }, data: { pdfObjectKey: key, pdfSha256: sha256 } }));
    return { key, sha256 };
  } catch (err) {
    // Another request attached its rendering first: keep that one.
    const again = await prisma.invoice.findUniqueOrThrow({ where: { id }, select: { pdfObjectKey: true, pdfSha256: true } });
    if (again.pdfObjectKey && again.pdfSha256) {
      if (again.pdfObjectKey !== key) await storage.remove(cfg.R2_BUCKET_VAULT, key).catch(() => undefined);
      return { key: again.pdfObjectKey, sha256: again.pdfSha256 };
    }
    throw err;
  }
}

export const toApiInvoice = (i: Invoice) => ({
  id: i.id,
  kind: i.kind,
  status: i.status,
  number: i.number,
  issuedAt: i.issuedAt,
  paidAt: i.paidAt,
  validUntil: i.validUntil,
  currency: i.currency,
  taxTreatment: i.taxTreatment,
  buyerName: i.buyerName,
  poNumber: i.poNumber,
  taxableMinor: Number(i.taxableMinor),
  taxMinor: Number(i.cgstMinor + i.sgstMinor + i.igstMinor),
  totalMinor: Number(i.totalMinor),
  hasPdf: i.pdfObjectKey !== null,
  orgId: i.orgId,
  userId: i.userId,
  relatedInvoiceId: i.relatedInvoiceId,
});
