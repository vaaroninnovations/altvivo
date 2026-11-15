import type { SubscriptionStatus } from '@prisma/client';
import type { Config } from '../config.js';
import { hmacHex, safeEqual } from '../lib/crypto.js';

/** Pinned so object shapes (e.g. current_period_end) never shift under us. */
export const STRIPE_API_VERSION = '2024-06-20';

function flatten(obj: Record<string, unknown>, prefix = ''): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      v.forEach((item, i) =>
        out.push(...(typeof item === 'object' ? flatten(item as Record<string, unknown>, `${key}[${i}]`) : [[`${key}[${i}]`, String(item)] as [string, string]])),
      );
    } else if (typeof v === 'object') out.push(...flatten(v as Record<string, unknown>, key));
    else out.push([key, String(v)]);
  }
  return out;
}

// ============================================================== Stripe ======

export interface StripeCheckoutInput {
  /** subscription = recurring Stripe price; payment = one prepaid term. */
  mode: 'subscription' | 'payment';
  priceId?: string | null;
  /** For mode=payment: the exact invoice total (cents). */
  amountMinor?: bigint;
  productName: string;
  customerEmail: string;
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
}

export interface StripeSubscription {
  id: string;
  status: string;
  customerId: string | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  priceId: string | null;
  metadata: Record<string, string>;
}

export class StripeGateway {
  constructor(private readonly secretKey: string, private readonly webhookSecret: string) {}

  get enabled() {
    return !!this.secretKey && !!this.webhookSecret;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, params?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Stripe-Version': STRIPE_API_VERSION,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: params ? new URLSearchParams(flatten(params)) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json()) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(`Stripe ${path} failed (${res.status}): ${data.error?.message ?? 'unknown error'}`);
    return data;
  }

  async createCheckout(i: StripeCheckoutInput, idempotencyKey: string): Promise<{ url: string; id: string }> {
    const lineItem =
      i.mode === 'subscription'
        ? { price: i.priceId, quantity: 1 }
        : { price_data: { currency: 'usd', unit_amount: i.amountMinor!.toString(), product_data: { name: i.productName } }, quantity: 1 };
    const session = await this.call<{ id: string; url: string }>(
      'POST',
      '/checkout/sessions',
      {
        mode: i.mode,
        line_items: [lineItem],
        customer_email: i.customerEmail,
        client_reference_id: i.metadata.invoice_id,
        success_url: i.successUrl,
        cancel_url: i.cancelUrl,
        billing_address_collection: 'auto',
        metadata: i.metadata,
        ...(i.mode === 'subscription' ? { subscription_data: { metadata: i.metadata } } : { payment_intent_data: { metadata: i.metadata } }),
      },
      idempotencyKey,
    );
    return { url: session.url, id: session.id };
  }

  async getSubscription(id: string): Promise<StripeSubscription> {
    const s = await this.call<{
      id: string; status: string; customer: string | null; current_period_start: number; current_period_end: number;
      cancel_at_period_end: boolean; canceled_at: number | null; metadata: Record<string, string>; items: { data: { price: { id: string } }[] };
    }>('GET', `/subscriptions/${encodeURIComponent(id)}`);
    return {
      id: s.id,
      status: s.status,
      customerId: s.customer,
      currentPeriodStart: new Date(s.current_period_start * 1000),
      currentPeriodEnd: new Date(s.current_period_end * 1000),
      cancelAtPeriodEnd: s.cancel_at_period_end,
      canceledAt: s.canceled_at ? new Date(s.canceled_at * 1000) : null,
      priceId: s.items.data[0]?.price.id ?? null,
      metadata: s.metadata ?? {},
    };
  }

  async cancelAtPeriodEnd(id: string): Promise<void> {
    await this.call('POST', `/subscriptions/${encodeURIComponent(id)}`, { cancel_at_period_end: 'true' });
  }

  /** Stripe-Signature: t=<ts>,v1=<hex>[,v1=...]; HMAC-SHA256 over "<t>.<raw body>". */
  verifyWebhook(raw: Buffer, header: string | undefined, toleranceSeconds = 300): boolean {
    if (!header || !this.webhookSecret) return false;
    const parts = header.split(',').map((p) => p.split('=') as [string, string]);
    const t = parts.find(([k]) => k === 't')?.[1];
    const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
    if (!t || !/^\d+$/.test(t) || !sigs.length) return false;
    if (Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > toleranceSeconds) return false;
    const expected = hmacHex(this.webhookSecret, `${t}.${raw.toString('utf8')}`);
    return sigs.some((s) => safeEqual(s, expected));
  }
}

/** No trials exist on AltVivo: anything not yet paid is PENDING, never active. */
export const mapStripeStatus = (s: string): SubscriptionStatus => {
  switch (s) {
    case 'active':
      return 'ACTIVE';
    case 'past_due':
    case 'unpaid':
    case 'paused':
      return 'PAST_DUE';
    case 'canceled':
    case 'incomplete_expired':
      return 'CANCELED';
    default:
      return 'PENDING'; // incomplete, trialing
  }
};

// ============================================================ Razorpay ======

export interface RazorpayPayment {
  id: string;
  orderId: string | null;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  amount: number;
  currency: string;
  method: string | null;
  fee: number | null;
  amountRefunded: number;
  errorCode: string | null;
  errorDescription: string | null;
}

export class RazorpayGateway {
  constructor(readonly keyId: string, private readonly keySecret: string, private readonly webhookSecret: string) {}

  get enabled() {
    return !!this.keyId && !!this.keySecret && !!this.webhookSecret;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json()) as T & { error?: { description?: string } };
    if (!res.ok) throw new Error(`Razorpay ${path} failed (${res.status}): ${data.error?.description ?? 'unknown error'}`);
    return data;
  }

  /** One prepaid term. `receipt` is idempotent per draft invoice on Razorpay's side. */
  async createOrder(i: { amountMinor: bigint; receipt: string; notes: Record<string, string> }): Promise<{ id: string; amount: number; currency: string }> {
    const amount = Number(i.amountMinor);
    if (!Number.isSafeInteger(amount) || amount < 100) throw new Error('order amount out of range');
    return this.call('POST', '/orders', { amount, currency: 'INR', receipt: i.receipt.slice(0, 40), notes: i.notes, payment_capture: 1 });
  }

  async getOrder(id: string): Promise<{ id: string; amount: number; currency: string; status: string; notes: Record<string, string> }> {
    const o = await this.call<{ id: string; amount: number; currency: string; status: string; notes: Record<string, string> | unknown[] }>(
      'GET',
      `/orders/${encodeURIComponent(id)}`,
    );
    return { ...o, notes: Array.isArray(o.notes) ? {} : o.notes };
  }

  async getPayment(id: string): Promise<RazorpayPayment> {
    const p = await this.call<{
      id: string; order_id: string | null; status: RazorpayPayment['status']; amount: number; currency: string; method: string | null;
      fee: number | null; amount_refunded: number; error_code: string | null; error_description: string | null;
    }>('GET', `/payments/${encodeURIComponent(id)}`);
    return toRazorpayPayment(p);
  }

  async capturePayment(id: string, amount: number): Promise<RazorpayPayment> {
    const p = await this.call<Parameters<typeof toRazorpayPayment>[0]>('POST', `/payments/${encodeURIComponent(id)}/capture`, { amount, currency: 'INR' });
    return toRazorpayPayment(p);
  }

  /** Checkout handler signature: HMAC-SHA256(order_id + "|" + payment_id, key_secret). */
  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
    if (!this.keySecret || !/^[0-9a-f]{64}$/.test(signature)) return false;
    return safeEqual(signature, hmacHex(this.keySecret, `${orderId}|${paymentId}`));
  }

  /** X-Razorpay-Signature: hex HMAC-SHA256 of the raw body with the webhook secret. */
  verifyWebhook(raw: Buffer, signature: string | undefined): boolean {
    if (!signature || !this.webhookSecret) return false;
    return safeEqual(signature, hmacHex(this.webhookSecret, raw));
  }
}

export function toRazorpayPayment(p: {
  id: string; order_id?: string | null; status: RazorpayPayment['status']; amount: number; currency: string; method?: string | null;
  fee?: number | null; amount_refunded?: number; error_code?: string | null; error_description?: string | null;
}): RazorpayPayment {
  return {
    id: p.id,
    orderId: p.order_id ?? null,
    status: p.status,
    amount: p.amount,
    currency: p.currency,
    method: p.method && /^[a-z_]{2,32}$/.test(p.method) ? p.method : null,
    fee: p.fee ?? null,
    amountRefunded: p.amount_refunded ?? 0,
    errorCode: p.error_code ?? null,
    errorDescription: p.error_description ?? null,
  };
}

export interface BillingGateways {
  STRIPE: StripeGateway;
  RAZORPAY: RazorpayGateway;
}

export function createBillingGateways(cfg: Config): BillingGateways {
  return {
    STRIPE: new StripeGateway(cfg.STRIPE_SECRET_KEY, cfg.STRIPE_WEBHOOK_SECRET),
    RAZORPAY: new RazorpayGateway(cfg.RAZORPAY_KEY_ID, cfg.RAZORPAY_KEY_SECRET, cfg.RAZORPAY_WEBHOOK_SECRET),
  };
}
