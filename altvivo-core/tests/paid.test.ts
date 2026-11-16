import { createHmac } from 'node:crypto';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { authenticator } from 'otplib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PLANS } from '../db/seed/seed.js';
import { Browser, RAZORPAY_KEY_SECRET, RAZORPAY_WHSEC, STRIPE_WHSEC, createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
const PASSWORD = 'correct horse battery staple';
const json = (r: { body: string }) => JSON.parse(r.body);
const linkToken = (text: string) => decodeURIComponent(/token=([^\s&"]+)/.exec(text)![1]!);

async function register(b: Browser, email: string, extra: Record<string, unknown> = {}) {
  await b.csrf();
  const r = await b.request('POST', '/v1/auth/register', { email, password: PASSWORD, fullName: 'Dr Paid Person', turnstileToken: 'ok', ...extra });
  expect(r.statusCode).toBe(201);
  return r;
}

async function verifiedUser(email: string, extra: Record<string, unknown> = {}) {
  const b = new Browser(ctx.app);
  await register(b, email, extra);
  const mail = ctx.mailer.lastTo(email)!;
  await b.request('GET', `/v1/auth/verify-email?token=${encodeURIComponent(linkToken(mail.text))}`);
  await b.request('POST', '/v1/auth/refresh');
  const user = await ctx.deps.prisma.user.findUniqueOrThrow({ where: { email } });
  return { b, id: user.id };
}

/** TOTP codes are single-use per 30 s step; tests sign many actions, so clear this user's replay marks first. */
async function code(secret: string, userId: string) {
  const step = Math.floor(Date.now() / 30_000);
  await ctx.deps.redis.del(`mfa:used:${userId}:${step - 1}`, `mfa:used:${userId}:${step}`, `mfa:used:${userId}:${step + 1}`);
  return authenticator.generate(secret);
}

async function mfaUser(email: string, role: 'SUPERADMIN' | 'INSTITUTE_ADMIN') {
  const { id } = await verifiedUser(email);
  await ctx.deps.prisma.user.update({ where: { id }, data: { role } });
  const b = new Browser(ctx.app);
  await b.csrf();
  await b.request('POST', '/v1/auth/login', { email, password: PASSWORD, turnstileToken: 'ok' });
  const e = json(await b.request('POST', '/v1/api/mfa/enroll'));
  const a = await b.request('POST', '/v1/api/mfa/activate', { code: authenticator.generate(e.secret) });
  expect(a.statusCode).toBe(200);
  return { b, id, secret: e.secret as string, sign: () => code(e.secret, id) };
}

const verify = (app: string, token: string | undefined, o: { nav?: boolean; host?: string; uri?: string } = {}) =>
  ctx.app.inject({
    method: 'GET',
    url: `/v1/auth/verify?app=${app}`,
    headers: {
      ...(token ? { cookie: `altvivo_at=${token}` } : {}),
      'x-forwarded-host': o.host ?? `${app}.altvivo.bio`,
      'x-forwarded-uri': o.uri ?? '/lab/1?x=1',
      'x-forwarded-method': 'GET',
      'x-forwarded-proto': 'https',
      accept: o.nav === false ? 'application/json' : 'text/html,application/xhtml+xml',
    },
  });

const rzpHook = (event: string, payload: unknown, id: string) => {
  const raw = JSON.stringify({ event, payload });
  return ctx.app.inject({
    method: 'POST',
    url: '/v1/billing/webhooks/razorpay',
    payload: raw,
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': createHmac('sha256', RAZORPAY_WHSEC).update(raw).digest('hex'), 'x-razorpay-event-id': id },
  });
};
const stripeHook = (type: string, object: unknown, id: string) => {
  const raw = JSON.stringify({ id, type, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  return ctx.app.inject({
    method: 'POST',
    url: '/v1/billing/webhooks/stripe',
    payload: raw,
    headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${createHmac('sha256', STRIPE_WHSEC).update(`${t}.${raw}`).digest('hex')}` },
  });
};
const rzpPayment = (id: string, orderId: string, amount: number, extra: Record<string, unknown> = {}) => ({
  id, orderId, status: 'captured' as const, amount, currency: 'INR', method: 'upi', fee: 354, amountRefunded: 0, errorCode: null, errorDescription: null, ...extra,
});
const rzpEntity = (p: ReturnType<typeof rzpPayment>) => ({
  id: p.id, order_id: p.orderId, status: p.status, amount: p.amount, currency: p.currency, method: p.method, fee: p.fee, amount_refunded: p.amountRefunded,
});

const KARNATAKA = { legalName: 'Dr Paid Person', email: 'billing@uni.ac.in', addressLine1: '1 Campus Road', city: 'Bengaluru', state: 'Karnataka', stateCode: '29', postalCode: '560012', country: 'IN' };
const BOSTON = { legalName: 'Overseas Lab LLC', email: 'ap@lab.example', addressLine1: '1 Main St', city: 'Boston', state: 'MA', postalCode: '02110', country: 'US' };

let admin: Awaited<ReturnType<typeof mfaUser>>;

beforeAll(async () => {
  // The dormant USD / Stripe path is exercised here; production runs INR only.
  ctx = await createTestContext({ USD_BILLING_ENABLED: 'true' });
  // The withdrawn plans (monthly, bundle, site licence) still drive the billing machinery tested here.
  await ctx.deps.prisma.plan.updateMany({ where: { isPublic: false }, data: { isPublic: true } });
  admin = await mfaUser('root@altvivo.bio', 'SUPERADMIN');
});

afterAll(async () => {
  await ctx.app.close();
  await ctx.deps.prisma.$disconnect();
});

// =============================================================== the gate ===
describe('paid gate (Caddy forward_auth)', () => {
  let paid: { b: Browser; id: string };

  beforeAll(async () => {
    paid = await verifiedUser('gate-paid@uni.edu');
    await ctx.deps.prisma.appEntitlement.create({
      data: { appId: 'xprism', source: 'MANUAL', userId: paid.id, grantedBy: admin.id, reason: 'Gate test licence', expiresAt: new Date(Date.now() + 30 * 864e5) },
    });
    await paid.b.request('POST', '/v1/auth/refresh');
  });

  it('sends anonymous visitors to the portal login with the original URL', async () => {
    const nav = await verify('xprism', undefined);
    expect(nav.statusCode).toBe(302);
    expect(nav.headers.location).toBe('https://altvivo.bio/login?redirect=https%3A%2F%2Fxprism.altvivo.bio%2Flab%2F1%3Fx%3D1');
    const xhr = await verify('xprism', undefined, { nav: false });
    expect(xhr.statusCode).toBe(401);
    expect(json(xhr)).toMatchObject({ error: 'unauthenticated' });
    expect(xhr.headers['cache-control']).toBe('no-store');
  });

  it('never redirects off the app host and rejects unknown apps', async () => {
    const spoof = await verify('xprism', undefined, { host: 'evil.example', uri: '//evil.example/x' });
    expect(spoof.headers.location).toBe('https://altvivo.bio/login?redirect=https%3A%2F%2Fxprism.altvivo.bio%2F');
    expect((await verify('nosuch', undefined)).statusCode).toBe(404);
    expect((await verify('../x', undefined)).statusCode).toBe(400);
  });

  it('sends Phase 2 hosts to the coming-soon page', async () => {
    const r = await verify('pharmadme', paid.b.get('altvivo_at'));
    expect(r.headers.location).toBe('https://altvivo.bio/coming-soon?app=pharmadme');
  });

  it('signed in without a licence: upgrade page (navigation) or 403 (API)', async () => {
    const { b } = await verifiedUser('gate-free@uni.edu');
    const nav = await verify('amaze', b.get('altvivo_at'));
    expect(nav.headers.location).toBe('https://altvivo.bio/workspace/upgrade?app=amaze&reason=subscription_required');
    const api = await verify('amaze', b.get('altvivo_at'), { nav: false });
    expect(api.statusCode).toBe(403);
    expect(json(api).error).toBe('subscription_required');
  });

  it('paid users pass with identity headers for the spoke', async () => {
    const r = await verify('xprism', paid.b.get('altvivo_at'));
    expect(r.statusCode).toBe(200);
    expect(r.headers).toMatchObject({
      'x-altvivo-user-id': paid.id, 'x-altvivo-email': 'gate-paid@uni.edu', 'x-altvivo-role': 'RESEARCHER', 'x-altvivo-access': 'paid', 'x-altvivo-plan': 'manual',
    });
    // The same token does not open the other app.
    expect((await verify('amaze', paid.b.get('altvivo_at'))).statusCode).toBe(302);
  });

  it('an access token past expiry bounces through refresh; a lapsed grant says subscription_expired', async () => {
    const claims = await ctx.deps.tokens.verify(paid.b.get('altvivo_at')!);
    const lapsed = await ctx.deps.tokens.sign({ ...claims, entitlements: { ...claims.entitlements, xprism: { ...claims.entitlements.xprism!, expires_at: Math.floor(Date.now() / 1000) - 10 } } });
    expect((await verify('xprism', lapsed.token)).headers.location).toBe('https://altvivo.bio/workspace/upgrade?app=xprism&reason=subscription_expired');

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 20 * 60_000);
    try {
      const r = await verify('xprism', paid.b.get('altvivo_at'));
      expect(r.headers.location).toBe('https://api.altvivo.bio/v1/auth/refresh/bounce?next=https%3A%2F%2Fxprism.altvivo.bio%2Flab%2F1%3Fx%3D1');
      const api = json(await verify('xprism', paid.b.get('altvivo_at'), { nav: false }));
      expect(api).toMatchObject({ error: 'session_expired', refreshUrl: 'https://api.altvivo.bio/v1/auth/refresh' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('revoked sessions are refused at once', async () => {
    const { b } = await verifiedUser('gate-revoke@uni.edu');
    const token = b.get('altvivo_at')!;
    await b.request('POST', '/v1/auth/logout');
    expect((await verify('xprism', token)).headers.location).toMatch(/^https:\/\/altvivo\.bio\/login\?redirect=/);
  });

  it('VIP roles bypass billing; a SUPERADMIN only on an MFA-verified session', async () => {
    const adv = await verifiedUser('advisor@pharma.edu');
    await ctx.deps.prisma.user.update({ where: { id: adv.id }, data: { role: 'ADVISORY_BOARD' } });
    await adv.b.request('POST', '/v1/auth/refresh');
    const ok = await verify('amaze', adv.b.get('altvivo_at'));
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['x-altvivo-access']).toBe('vip');
    expect(ok.headers['x-altvivo-role']).toBe('ADVISORY_BOARD');
    expect((await verify('pharmadme', adv.b.get('altvivo_at'))).headers.location).toContain('/coming-soon');

    expect((await verify('xprism', admin.b.get('altvivo_at'))).statusCode).toBe(200);
    const unenrolled = await verifiedUser('newadmin@altvivo.bio');
    await ctx.deps.prisma.user.update({ where: { id: unenrolled.id }, data: { role: 'SUPERADMIN' } });
    await unenrolled.b.request('POST', '/v1/auth/refresh');
    expect((await verify('xprism', unenrolled.b.get('altvivo_at'))).headers.location).toContain('/workspace/upgrade');
  });

  it('maintenance closes the app to paying users but not to VIPs', async () => {
    const flip = (status: string) =>
      admin.sign().then((totpCode) => admin.b.request('PATCH', '/v1/api/admin/apps/xprism', { status, reason: 'Planned maintenance window', totpCode }));
    expect((await flip('MAINTENANCE')).statusCode).toBe(200);
    // Status changes mark every session stale: the first request refreshes.
    expect((await verify('xprism', paid.b.get('altvivo_at'))).headers.location).toContain('/v1/auth/refresh/bounce');
    await paid.b.request('POST', '/v1/auth/refresh');
    await admin.b.request('POST', '/v1/auth/refresh');
    expect((await verify('xprism', paid.b.get('altvivo_at'))).headers.location).toBe('https://altvivo.bio/coming-soon?app=xprism&state=maintenance');
    expect((await verify('xprism', paid.b.get('altvivo_at'), { nav: false })).statusCode).toBe(503);
    expect((await verify('xprism', admin.b.get('altvivo_at'))).statusCode).toBe(200);
    expect((await flip('LIVE')).statusCode).toBe(200);
    await paid.b.request('POST', '/v1/auth/refresh');
    expect((await verify('xprism', paid.b.get('altvivo_at'))).statusCode).toBe(200);
  });
});

describe('app tokens', () => {
  it('only the app origin, only with a licence, carrying only that entitlement', async () => {
    const { b } = await verifiedUser('tracker@uni.edu');
    const ask = (origin: string) => b.request('POST', '/v1/auth/app-token', { app: 'amaze' }, { origin });
    expect(json(await ask('https://xprism.altvivo.bio')).error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(json(await ask('https://amaze.altvivo.bio')).error.code).toBe('SUBSCRIPTION_REQUIRED');

    const user = await ctx.deps.prisma.user.findUniqueOrThrow({ where: { email: 'tracker@uni.edu' } });
    await ctx.deps.prisma.appEntitlement.create({ data: { appId: 'amaze', source: 'MANUAL', userId: user.id, grantedBy: admin.id, reason: 'Tracking test', expiresAt: new Date(Date.now() + 864e5) } });
    await ctx.deps.revocations.markClaimsStale([user.id]);
    expect(json(await ask('https://amaze.altvivo.bio')).error.code).toBe('SESSION_STALE');
    await new Promise((r) => setTimeout(r, 1100));
    await b.request('POST', '/v1/auth/refresh');
    const r = json(await ask('https://amaze.altvivo.bio'));
    const jwks = createLocalJWKSet(ctx.deps.tokens.jwksDocument());
    const { payload } = await jwtVerify(r.token, jwks, { issuer: 'https://api.altvivo.bio', audience: 'amaze' });
    expect(payload.sub).toBe(user.id);
    expect(Object.keys(payload.entitlements as object)).toEqual(['amaze']);
    expect(payload.email).toBeUndefined();
    expect(payload.exp! - payload.iat!).toBe(300);
    // An app token is not a session token.
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/api/me', headers: { authorization: `Bearer ${r.token}` } })).statusCode).toBe(401);
  });
});

// ============================================================ checkout =====
describe('Razorpay prepaid checkout (INR, GST)', () => {
  let buyer: { b: Browser; id: string };
  let orderId: string;
  let invoiceId: string;

  beforeAll(async () => {
    buyer = await verifiedUser('rzp@uni.ac.in');
  });

  it('needs GST billing details first and validates them', async () => {
    expect(json(await buyer.b.request('POST', '/v1/api/billing/checkout', { planCode: 'xprism_monthly' })).error.code).toBe('BILLING_PROFILE_REQUIRED');
    const bad = await buyer.b.request('PUT', '/v1/api/billing/profile', { ...KARNATAKA, gstin: '27AAACA1234B1ZI' });
    expect(json(bad).error.code).toBe('VALIDATION_FAILED');
    const ok = await buyer.b.request('PUT', '/v1/api/billing/profile', { ...KARNATAKA, gstin: '29AAAPZ5678K1ZR' });
    expect(ok.statusCode).toBe(200);
    expect(json(ok).profile).toMatchObject({ stateCode: '29', gstin: '29AAAPZ5678K1ZR' });
  });

  it('creates an order for the GST-inclusive total computed by the database', async () => {
    const r = json(await buyer.b.request('POST', '/v1/api/billing/checkout', { planCode: 'xprism_monthly' }));
    expect(r.provider).toBe('RAZORPAY');
    expect(r.amountMinor).toBe(176882); // 1,499.00 + 9 % CGST + 9 % SGST
    expect(r.razorpay).toMatchObject({ keyId: 'rzp_test_key', amount: 176882, currency: 'INR', notes: { invoice_id: r.invoiceId } });
    orderId = r.razorpay.orderId;
    invoiceId = r.invoiceId;
    expect((await verify('xprism', buyer.b.get('altvivo_at'))).headers.location).toContain('/workspace/upgrade');
  });

  it('browser confirmation verifies the signature, activates and returns fresh claims', async () => {
    ctx.razorpay.payments.set('pay_TEST000001', rzpPayment('pay_TEST000001', orderId, 176882, { status: 'authorized' }));
    const forged = await buyer.b.request('POST', '/v1/api/billing/razorpay/confirm', { orderId, paymentId: 'pay_TEST000001', signature: 'f'.repeat(64) });
    expect(json(forged).error.code).toBe('PAYMENT_SIGNATURE_INVALID');
    const signature = createHmac('sha256', RAZORPAY_KEY_SECRET).update(`${orderId}|pay_TEST000001`).digest('hex');
    const r = await buyer.b.request('POST', '/v1/api/billing/razorpay/confirm', { orderId, paymentId: 'pay_TEST000001', signature });
    expect(r.statusCode).toBe(200);
    expect(ctx.razorpay.captured).toContain('pay_TEST000001');
    expect(json(r).user.entitlements.xprism).toMatchObject({ active: true, source: 'individual', plan: 'xprism_monthly' });
    expect(json(r).user.tier).toBe('INDIVIDUAL');
    const g = await verify('xprism', buyer.b.get('altvivo_at'));
    expect(g.statusCode).toBe(200);
    expect(g.headers['x-altvivo-plan']).toBe('xprism_monthly');
  });

  it('the webhook for the same payment is idempotent', async () => {
    const p = rzpPayment('pay_TEST000001', orderId, 176882);
    expect((await rzpHook('payment.captured', { payment: { entity: rzpEntity(p) } }, 'evt_rzp_cap_1')).statusCode).toBe(200);
    expect(json(await rzpHook('payment.captured', { payment: { entity: rzpEntity(p) } }, 'evt_rzp_cap_1')).duplicate).toBe(true);
    expect(await ctx.deps.prisma.payment.count({ where: { providerPaymentId: 'pay_TEST000001' } })).toBe(1);
  });

  it('issues a numbered GST tax invoice with a stored PDF', async () => {
    const list = json(await buyer.b.request('GET', '/v1/api/billing/invoices')).invoices;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: invoiceId, kind: 'TAX_INVOICE', status: 'PAID', taxTreatment: 'INTRA_STATE', totalMinor: 176882, taxMinor: 26982, hasPdf: true });
    expect(list[0].number).toMatch(/^AV\/\d{4}-\d{2}\/\d{5}$/);
    const inv = await ctx.deps.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const pdf = ctx.storage.objects.get(inv.pdfObjectKey!)!;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5000);
    const link = json(await buyer.b.request('GET', `/v1/api/billing/invoices/${invoiceId}/pdf`));
    expect(link.url).toContain(inv.pdfObjectKey);
    expect(link.sha256).toBe(inv.pdfSha256);
    expect(ctx.mailer.lastTo('billing@uni.ac.in')?.subject).toContain(list[0].number);
    // Another user cannot see it.
    const other = await verifiedUser('snoop@uni.edu');
    expect((await other.b.request('GET', `/v1/api/billing/invoices/${invoiceId}/pdf`)).statusCode).toBe(404);
  });

  it('renewing early starts the new term when the current one ends', async () => {
    const r = json(await buyer.b.request('POST', '/v1/api/billing/checkout', { planCode: 'xprism_monthly' }));
    const p = rzpPayment('pay_TEST000002', r.razorpay.orderId, 176882);
    ctx.razorpay.payments.set(p.id, p);
    expect((await rzpHook('order.paid', { payment: { entity: rzpEntity(p) }, order: { entity: { id: p.orderId, notes: { invoice_id: r.invoiceId } } } }, 'evt_rzp_2')).statusCode).toBe(200);
    const subs = await ctx.deps.prisma.subscription.findMany({ where: { userId: buyer.id }, orderBy: { currentPeriodStart: 'asc' } });
    expect(subs).toHaveLength(2);
    expect(subs[1]!.currentPeriodStart!.getTime()).toBe(subs[0]!.currentPeriodEnd.getTime());
  });

  it('an amount that does not match the invoice never activates anything', async () => {
    const r = json(await buyer.b.request('POST', '/v1/api/billing/checkout', { planCode: 'amaze_monthly' }));
    const p = rzpPayment('pay_TEST000003', r.razorpay.orderId, 100);
    expect((await rzpHook('payment.captured', { payment: { entity: rzpEntity(p) } }, 'evt_rzp_3')).statusCode).toBe(200);
    expect(await ctx.deps.prisma.subscription.count({ where: { userId: buyer.id, planCode: 'amaze_monthly' } })).toBe(0);
    expect((await ctx.deps.prisma.invoice.findUniqueOrThrow({ where: { id: r.invoiceId } })).status).toBe('DRAFT');
    expect(await ctx.deps.prisma.auditLog.count({ where: { eventType: 'SECURITY.PAYMENT_AMOUNT_MISMATCH', resourceId: r.invoiceId } })).toBe(1);
  });

  it('a failed attempt is recorded and the order can still be paid', async () => {
    const r = json(await buyer.b.request('POST', '/v1/api/billing/checkout', { planCode: 'amaze_annual' }));
    const failed = rzpPayment('pay_TEST000004', r.razorpay.orderId, r.amountMinor, { status: 'failed' });
    await rzpHook('payment.failed', { payment: { entity: { ...rzpEntity(failed), error_code: 'BAD_REQUEST_ERROR', error_description: 'Payment declined by bank' } } }, 'evt_rzp_4');
    expect(await ctx.deps.prisma.payment.findFirst({ where: { providerPaymentId: 'pay_TEST000004' } })).toMatchObject({ status: 'FAILED', failureReason: 'Payment declined by bank' });
    const ok = rzpPayment('pay_TEST000005', r.razorpay.orderId, r.amountMinor);
    expect((await rzpHook('payment.captured', { payment: { entity: rzpEntity(ok) } }, 'evt_rzp_5')).statusCode).toBe(200);
    expect(await ctx.deps.prisma.subscription.count({ where: { userId: buyer.id, planCode: 'amaze_annual', status: 'ACTIVE' } })).toBe(1);
  });

  it('a full refund ends the term at once and issues a credit note', async () => {
    const before = buyer.b.get('altvivo_at');
    const p = rzpPayment('pay_TEST000005', null as unknown as string, 0);
    const amaze = await ctx.deps.prisma.payment.findFirstOrThrow({ where: { providerPaymentId: 'pay_TEST000005' } });
    await rzpHook('refund.processed', { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_TEST000005', amount: Number(amaze.amountMinor) } }, payment: { entity: { ...rzpEntity({ ...p, amount: Number(amaze.amountMinor) }), status: 'refunded', amount_refunded: Number(amaze.amountMinor) } } }, 'evt_rzp_6');
    const pay = await ctx.deps.prisma.payment.findFirstOrThrow({ where: { providerPaymentId: 'pay_TEST000005' } });
    expect(pay.status).toBe('REFUNDED');
    const sub = await ctx.deps.prisma.subscription.findUniqueOrThrow({ where: { id: pay.subscriptionId! } });
    expect(sub.status).toBe('CANCELED');
    const cn = await ctx.deps.prisma.invoice.findFirstOrThrow({ where: { relatedInvoiceId: pay.invoiceId!, kind: 'CREDIT_NOTE' } });
    expect(cn.number).toMatch(/^CN\//);
    expect(cn.totalMinor).toBe(amaze.amountMinor);
    // The old token is stale: the gate makes the browser refresh, then denies.
    expect((await verify('amaze', before)).headers.location).toContain('/v1/auth/refresh/bounce');
    await new Promise((r) => setTimeout(r, 1100));
    await buyer.b.request('POST', '/v1/auth/refresh');
    expect((await verify('amaze', buyer.b.get('altvivo_at'))).headers.location).toContain('/workspace/upgrade');
    expect((await verify('xprism', buyer.b.get('altvivo_at'))).statusCode).toBe(200);
  });
});

describe('Stripe checkout (USD, zero-rated export)', () => {
  let buyer: { b: Browser; id: string };

  beforeAll(async () => {
    buyer = await verifiedUser('stripe@lab.example');
    expect((await buyer.b.request('PUT', '/v1/api/billing/profile', BOSTON)).statusCode).toBe(200);
  });

  it('one-time prepaid term via Checkout mode=payment', async () => {
    const r = json(await buyer.b.request('POST', '/v1/api/billing/checkout', { planCode: 'amaze_annual' }));
    expect(r).toMatchObject({ provider: 'STRIPE', currency: 'USD', amountMinor: 29000 });
    expect(ctx.stripe.checkouts.at(-1)).toMatchObject({ mode: 'payment', amountMinor: 29000n, metadata: { invoice_id: r.invoiceId } });
    const s = { id: 'cs_1', mode: 'payment', payment_status: 'paid', payment_intent: 'pi_one_1', amount_total: 29000, currency: 'usd', metadata: { invoice_id: r.invoiceId } };
    expect((await stripeHook('checkout.session.completed', s, 'evt_s_1')).statusCode).toBe(200);
    const inv = await ctx.deps.prisma.invoice.findUniqueOrThrow({ where: { id: r.invoiceId } });
    expect(inv).toMatchObject({ status: 'PAID', taxTreatment: 'EXPORT', placeOfSupply: '96', currency: 'USD', totalMinor: 29000n, igstMinor: 0n });
    await buyer.b.request('POST', '/v1/auth/refresh');
    expect((await verify('amaze', buyer.b.get('altvivo_at'))).statusCode).toBe(200);
  });

  it('recurring Dual-Suite: invoice per Stripe invoice, renewals, cancellation', async () => {
    await ctx.deps.prisma.plan.update({ where: { planCode: 'suite_monthly' }, data: { stripePriceId: 'price_suite_m' } });
    const r = json(await buyer.b.request('POST', '/v1/api/billing/checkout', { planCode: 'suite_monthly' }));
    expect(ctx.stripe.checkouts.at(-1)).toMatchObject({ mode: 'subscription', priceId: 'price_suite_m' });
    const now = Date.now();
    ctx.stripe.subs.set('sub_S1', {
      id: 'sub_S1', status: 'active', customerId: 'cus_1', currentPeriodStart: new Date(now), currentPeriodEnd: new Date(now + 30 * 864e5),
      cancelAtPeriodEnd: false, canceledAt: null, priceId: 'price_suite_m', metadata: { invoice_id: r.invoiceId, user_id: buyer.id },
    });
    const paid = (id: string, pi: string, reason: string) =>
      stripeHook('invoice.paid', { id, subscription: 'sub_S1', amount_paid: 4500, currency: 'usd', payment_intent: pi, billing_reason: reason }, `evt_${id}`);
    expect((await paid('in_1', 'pi_s1', 'subscription_create')).statusCode).toBe(200);
    await buyer.b.request('POST', '/v1/auth/refresh');
    const me = json(await buyer.b.request('GET', '/v1/api/me')).user;
    expect(me.entitlements.xprism).toMatchObject({ active: true, source: 'bundle', plan: 'suite_monthly' });
    expect(me.tier).toBe('BUNDLE');

    ctx.stripe.subs.set('sub_S1', { ...ctx.stripe.subs.get('sub_S1')!, currentPeriodStart: new Date(now + 30 * 864e5), currentPeriodEnd: new Date(now + 60 * 864e5) });
    expect((await paid('in_2', 'pi_s2', 'subscription_cycle')).statusCode).toBe(200);
    const sub = await ctx.deps.prisma.subscription.findUniqueOrThrow({ where: { provider_externalSubId: { provider: 'STRIPE', externalSubId: 'sub_S1' } } });
    expect(sub).toMatchObject({ billingMode: 'RECURRING', status: 'ACTIVE' });
    const invs = await ctx.deps.prisma.invoice.findMany({ where: { subscriptionId: sub.id, kind: 'TAX_INVOICE' }, orderBy: { issuedAt: 'asc' } });
    expect(invs.map((i) => i.status)).toEqual(['PAID', 'PAID']);
    expect(invs[1]!.buyerName).toBe('Overseas Lab LLC');

    const cancel = json(await buyer.b.request('POST', `/v1/api/billing/subscriptions/${sub.id}/cancel`));
    expect(cancel.status).toBe('cancel_at_period_end');
    expect(ctx.stripe.cancelled).toContain('sub_S1');
    ctx.stripe.subs.set('sub_S1', { ...ctx.stripe.subs.get('sub_S1')!, status: 'canceled', canceledAt: new Date() });
    await stripeHook('customer.subscription.deleted', { id: 'sub_S1' }, 'evt_s_del');
    expect((await ctx.deps.prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe('CANCELED');
  });
});

// ================================================ institutions / admin =====
describe('institutional site licence via proforma and NEFT', () => {
  let orgId: string;
  let member: { b: Browser; id: string };
  let proformaId: string;
  let taxInvoiceId: string;

  it('SUPERADMIN creates the tenant, billing details and a member', async () => {
    const org = json(await admin.b.request('POST', '/v1/api/admin/organizations', {
      name: 'Govt College of Pharmacy', kind: 'COLLEGE', domainWhitelist: ['gcp.ac.in'], seatLimit: 5, billingCountry: 'IN', totpCode: await admin.sign(),
    })).organization;
    orgId = org.id;
    const prof = await admin.b.request('PUT', `/v1/api/admin/organizations/${orgId}/billing-profile`, {
      legalName: 'Govt College of Pharmacy', email: 'principal@gcp.ac.in', addressLine1: 'Subbaiah Circle', city: 'Bengaluru', stateCode: '29', postalCode: '560027', country: 'IN',
    });
    expect(prof.statusCode).toBe(200);
    member = await verifiedUser('student1@gcp.ac.in'); // auto-joins by domain
    expect((await ctx.deps.prisma.user.findUniqueOrThrow({ where: { id: member.id } })).orgId).toBe(orgId);
  });

  it('issues a proforma for 30 seats with a PDF', async () => {
    const r = json(await admin.b.request('POST', `/v1/api/admin/organizations/${orgId}/proformas`, { planCode: 'site_license_annual', seats: 30, poNumber: 'GCP/PO/2026/14' }));
    expect(r.invoice).toMatchObject({ kind: 'PROFORMA', status: 'ISSUED', totalMinor: 8_496_000, poNumber: 'GCP/PO/2026/14' });
    expect(r.invoice.number).toMatch(/^PF\//);
    expect(r.pdf.url).toBeTruthy();
    proformaId = r.invoice.id;
    expect(json(await admin.b.request('POST', `/v1/api/admin/organizations/${orgId}/proformas`, { planCode: 'site_license_annual', seats: 10 })).error.code).toBe('SEATS_OUT_OF_RANGE');
  });

  it('records the NEFT payment: tax invoice, institution licence, seats', async () => {
    const pay = (amountMinor: number) =>
      admin.sign().then((totpCode) => admin.b.request('POST', `/v1/api/admin/invoices/${proformaId}/record-payment`, { amountMinor, method: 'neft', reference: 'UTR SBIN0026111222', paidAt: new Date().toISOString(), totpCode }));
    expect(json(await pay(100)).error.code).toBe('AMOUNT_MISMATCH');
    const r = await pay(8_496_000);
    expect(r.statusCode).toBe(201);
    taxInvoiceId = json(r).taxInvoiceId;
    const tax = await ctx.deps.prisma.invoice.findUniqueOrThrow({ where: { id: taxInvoiceId } });
    expect(tax).toMatchObject({ kind: 'TAX_INVOICE', status: 'PAID', relatedInvoiceId: proformaId, totalMinor: 8_496_000n });
    expect((await ctx.deps.prisma.invoice.findUniqueOrThrow({ where: { id: proformaId } })).status).toBe('PAID');
    expect((await ctx.deps.prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).seatLimit).toBe(30);
    const grants = await ctx.deps.prisma.appEntitlement.findMany({ where: { orgId, source: 'MANUAL' } });
    expect(grants.map((g) => g.appId).sort()).toEqual(['amaze', 'xprism']);
    expect(json(await pay(8_496_000)).error.code).toBe('PROFORMA_NOT_OPEN');

    await new Promise((res) => setTimeout(res, 1100));
    await member.b.request('POST', '/v1/auth/refresh');
    const g = await verify('xprism', member.b.get('altvivo_at'));
    expect(g.statusCode).toBe(200);
    expect(g.headers['x-altvivo-plan']).toBe('institution');
  });

  it('credit notes are capped at the invoice total', async () => {
    const partial = await admin.b.request('POST', `/v1/api/admin/invoices/${taxInvoiceId}/credit-note`, { mode: 'partial', description: 'Seat reduction 30 -> 25', taxableMinor: 1_200_000, reason: 'Seat count corrected', totpCode: await admin.sign() });
    expect(partial.statusCode).toBe(201);
    expect(json(partial).creditNote).toMatchObject({ kind: 'CREDIT_NOTE', totalMinor: 1_416_000 });
    const full = await admin.b.request('POST', `/v1/api/admin/invoices/${taxInvoiceId}/credit-note`, { mode: 'full', reason: 'Whole order cancelled', totpCode: await admin.sign() });
    expect(json(full).error.code).toBe('CREDIT_EXCEEDS_INVOICE');
  });

  it('unpaid proformas can be cancelled; paid ones cannot', async () => {
    const pf = json(await admin.b.request('POST', `/v1/api/admin/organizations/${orgId}/proformas`, { planCode: 'site_license_annual', seats: 40 })).invoice;
    const c = await admin.b.request('POST', `/v1/api/admin/invoices/${pf.id}/cancel`, { reason: 'Superseded by a revised quote', totpCode: await admin.sign() });
    expect(json(c).invoice.status).toBe('CANCELLED');
    expect(json(await admin.b.request('POST', `/v1/api/admin/invoices/${taxInvoiceId}/cancel`, { reason: 'Should not work', totpCode: await admin.sign() })).error.code).toBe('NOT_CANCELLABLE');
  });

  it('institution admins can request a quotation themselves', async () => {
    const ia = await mfaUser('hod@gcp.ac.in', 'INSTITUTE_ADMIN');
    expect((await ctx.deps.prisma.user.findUniqueOrThrow({ where: { id: ia.id } })).orgId).toBe(orgId);
    await ia.b.request('POST', '/v1/auth/refresh');
    const q = await ia.b.request('POST', '/v1/api/billing/quotes', { planCode: 'site_license_annual', seats: 60 });
    expect(q.statusCode).toBe(201);
    expect(json(q).invoice.number).toMatch(/^PF\//);
    expect(json(await member.b.request('POST', '/v1/api/billing/quotes', { planCode: 'site_license_annual', seats: 60 })).error.code).toBe('INSTITUTE_ADMIN_REQUIRED');
    expect(json(await ia.b.request('GET', '/v1/api/billing/invoices')).invoices.length).toBeGreaterThanOrEqual(3);
  });
});

describe('SUPERADMIN licences, pricing, CMS and audit', () => {
  it('refuses non-admins and unsigned changes', async () => {
    const { b } = await verifiedUser('notadmin@uni.edu');
    expect((await b.request('GET', '/v1/api/admin/dashboard')).statusCode).toBe(403);
    const target = await ctx.deps.prisma.user.findUniqueOrThrow({ where: { email: 'notadmin@uni.edu' } });
    const r = await admin.b.request('POST', '/v1/api/admin/licences', { appId: 'xprism', userId: target.id, expiresAt: new Date(Date.now() + 864e5).toISOString(), reason: 'No signature', totpCode: '000000' });
    expect(json(r).error.code).toBe('MFA_CODE_INVALID');
  });

  it('grants, extends and revokes a manual licence with immediate effect', async () => {
    const u = await verifiedUser('manual@uni.edu');
    const grant = await admin.b.request('POST', '/v1/api/admin/licences', {
      appId: 'amaze', userId: u.id, expiresAt: new Date(Date.now() + 90 * 864e5).toISOString(), reason: 'PO 4411 paid by RTGS', reference: 'UTR 9988', totpCode: await admin.sign(),
    });
    expect(grant.statusCode).toBe(201);
    const id = json(grant).licence.id;
    await new Promise((r) => setTimeout(r, 1100));
    await u.b.request('POST', '/v1/auth/refresh');
    expect((await verify('amaze', u.b.get('altvivo_at'))).statusCode).toBe(200);
    const ext = await admin.b.request('PATCH', `/v1/api/admin/licences/${id}`, { expiresAt: new Date(Date.now() + 180 * 864e5).toISOString(), totpCode: await admin.sign() });
    expect(ext.statusCode).toBe(200);
    expect((await admin.b.request('POST', `/v1/api/admin/licences/${id}/revoke`, { reason: 'Payment bounced', totpCode: await admin.sign() })).statusCode).toBe(200);
    expect((await verify('amaze', u.b.get('altvivo_at'))).headers.location).toContain('/v1/auth/refresh/bounce');
    await new Promise((r) => setTimeout(r, 1100));
    await u.b.request('POST', '/v1/auth/refresh');
    expect((await verify('amaze', u.b.get('altvivo_at'))).headers.location).toContain('/workspace/upgrade');
    expect(json(await admin.b.request('PATCH', `/v1/api/admin/licences/${id}`, { reason: 'Too late to edit this', totpCode: await admin.sign() })).error.code).toBe('LICENCE_REVOKED');
    const detail = json(await admin.b.request('GET', `/v1/api/admin/users/${u.id}`));
    expect(detail.licences[0]).toMatchObject({ id, revokeReason: 'Payment bounced' });
  });

  it('edits prices with an e-signature and the pricing page follows', async () => {
    const r = await admin.b.request('PATCH', '/v1/api/admin/plans/xprism_annual', { priceInrPaise: 1_399_000, reason: 'Academic year offer', totpCode: await admin.sign() });
    expect(r.statusCode).toBe(200);
    const plans = json(await ctx.app.inject({ method: 'GET', url: '/v1/public/plans', headers: { 'cf-ipcountry': 'IN' } }));
    expect(plans.currency).toBe('INR');
    expect(plans.plans.find((p: { planCode: string }) => p.planCode === 'xprism_annual').amountMinor).toBe(1_399_000);
    const ev = await ctx.deps.prisma.auditLog.findFirst({ where: { eventType: 'ADMIN.PLAN_CHANGE', resourceId: 'xprism_annual' } });
    expect(ev?.metadata).toMatchObject({ from: { priceInrPaise: 2_000_000 }, to: { priceInrPaise: 1_399_000 }, signature: { method: 'totp' } });
  });

  it('advisory board CMS feeds the public page', async () => {
    const bad = await admin.b.request('POST', '/v1/api/admin/advisory-board', { slug: 'x', fullName: 'X Y', designation: 'Prof', affiliation: 'Uni', bio: 'A long enough biography.', linkedinUrl: 'javascript:alert(1)' });
    expect(json(bad).error.code).toBe('VALIDATION_FAILED');
    const m = await admin.b.request('POST', '/v1/api/admin/advisory-board', {
      slug: 'test-pharmacologist', honorific: 'Prof.', fullName: 'Test Pharmacologist', credentials: 'M.Pharm, PhD', designation: 'Professor of Pharmacology',
      affiliation: 'Test Institute', bio: 'Works on non-animal alternatives in teaching.', specializations: ['Neuropharmacology', '3Rs'], isPublished: true, featured: true,
    });
    expect(m.statusCode).toBe(201);
    const hidden = await admin.b.request('POST', '/v1/api/admin/advisory-board', { slug: 'draft-member', fullName: 'Draft Member', designation: 'Reader', affiliation: 'Uni', bio: 'Not yet published here.' });
    const pub = json(await ctx.app.inject({ method: 'GET', url: '/v1/public/advisory-board' })).members;
    expect(pub.map((x: { slug: string }) => x.slug)).toEqual(['test-pharmacologist']);
    expect(pub[0]).not.toHaveProperty('userId');
    expect(json(await ctx.app.inject({ method: 'GET', url: '/v1/public/advisory-board?featured=1' })).members).toHaveLength(1);
    await admin.b.request('POST', '/v1/api/admin/advisory-board/reorder', { ids: [json(hidden).member.id, json(m).member.id] });
    expect((await admin.b.request('DELETE', `/v1/api/admin/advisory-board/${json(hidden).member.id}`)).statusCode).toBe(204);
  });

  it('dashboard reports revenue, licences and waitlist', async () => {
    const d = json(await admin.b.request('GET', '/v1/api/admin/dashboard'));
    expect(d.revenueLast30Days.find((r: { currency: string }) => r.currency === 'INR').grossMinor).toBeGreaterThan(0);
    expect(d.recurringRevenue.length).toBeGreaterThan(0);
    expect(d.activeLicencesByApp.find((a: { appId: string }) => a.appId === 'xprism').holders).toBeGreaterThan(0);
    expect(d.users.total).toBeGreaterThan(5);
    expect(d.sessions.active).toBeGreaterThan(0);
  });

  it('audit trail is filterable and verifies', async () => {
    const billing = json(await admin.b.request('GET', '/v1/api/admin/audit?eventType=BILLING.&limit=500')).events;
    const types = new Set(billing.map((e: { eventType: string }) => e.eventType));
    for (const t of ['BILLING.CHECKOUT_STARTED', 'BILLING.PAYMENT_CAPTURED', 'BILLING.PROFORMA_ISSUED', 'BILLING.OFFLINE_PAYMENT_RECORDED', 'BILLING.REFUND_FULL']) expect(types).toContain(t);
    const page = json(await admin.b.request('GET', '/v1/api/admin/audit?limit=5'));
    expect(page.events).toHaveLength(5);
    const next = json(await admin.b.request('GET', `/v1/api/admin/audit?limit=5&before=${page.nextBefore}`));
    expect(BigInt(next.events[0].id)).toBeLessThan(BigInt(page.events[4].id));
    expect(json(await admin.b.request('GET', '/v1/api/admin/audit/verify'))).toMatchObject({ ok: true });
  });
});

// ============================================================ public site ==
describe('public endpoints', () => {
  it('sells XPRISM and aMaze as separate yearly plans; the withdrawn plans are hidden by default', async () => {
    const pub = PLANS.filter((p) => p.isPublic !== false);
    expect(pub.map((p) => [p.planCode, p.interval, p.priceInrPaise])).toEqual([['xprism_annual', 'YEAR', 2_000_000], ['amaze_annual', 'YEAR', 1_500_000]]);
    expect(pub[0]!.features).toContain('Up to 100 students per account');
    expect(pub[0]!.features).toContain('Up to 4 teachers per account');
    expect(PLANS.filter((p) => p.isPublic === false).map((p) => p.planCode)).toEqual(['xprism_monthly', 'amaze_monthly', 'suite_monthly', 'suite_annual', 'site_license_annual']);
  });

  it('plans describe kinds, seats, apps and tax', async () => {
    const r = json(await ctx.app.inject({ method: 'GET', url: '/v1/public/plans?currency=USD' }));
    expect(r.provider).toBe('STRIPE');
    const codes = r.plans.map((p: { planCode: string }) => p.planCode);
    expect(codes.sort()).toEqual(['amaze_annual', 'amaze_monthly', 'site_license_annual', 'suite_annual', 'suite_monthly', 'xprism_annual', 'xprism_monthly']);
    const site = r.plans.find((p: { planCode: string }) => p.planCode === 'site_license_annual');
    expect(site).toMatchObject({ kind: 'SITE_LICENSE', pricingModel: 'PER_SEAT', minSeats: 25, apps: ['amaze', 'xprism'], amountMinor: 6000, quoteAvailable: true });
    expect(r.plans.find((p: { planCode: string }) => p.planCode === 'suite_annual')).toMatchObject({ kind: 'BUNDLE' });
  });

  it('contact form: aMaze labels, honeypot, validation', async () => {
    const b = new Browser(ctx.app);
    await b.csrf();
    const send = (body: Record<string, unknown>) => b.request('POST', '/v1/public/contact', body, { origin: 'https://amaze.altvivo.bio' });
    const base = { name: 'Lab Manager', email: 'manager@lab.example', institution: '', category: 'Technical Support & Bug Report', subject: 'Tracking stalls', message: 'The tracker stops at frame 1200 on MP4 files.', app: 'amaze' };
    const r = await send(base);
    expect(r.statusCode).toBe(201);
    const row = await ctx.deps.prisma.contactMessage.findUniqueOrThrow({ where: { id: json(r).reference } });
    expect(row).toMatchObject({ category: 'support', appId: 'amaze', institution: null });
    const note = ctx.mailer.lastTo(ctx.cfg.SUPPORT_EMAIL)!;
    expect(note.replyTo).toBe('manager@lab.example');
    expect(note.subject).toBe('[AltVivo support] Tracking stalls');
    const stored = await ctx.deps.prisma.contactMessage.count();
    expect((await send({ ...base, subject: 'Cheap pills', website: 'https://spam.example' })).statusCode).toBe(201);
    expect(await ctx.deps.prisma.contactMessage.count()).toBe(stored); // honeypot: silently dropped
    expect(json(await send({ ...base, email: 'not-an-email' })).error.code).toBe('VALIDATION_FAILED');
    const inbox = json(await admin.b.request('GET', '/v1/api/admin/contact?status=NEW')).messages;
    expect(inbox.some((m: { id: string }) => m.id === row.id)).toBe(true);
  });

  it('consent decisions are recorded append-only per subject', async () => {
    const b = new Browser(ctx.app);
    await b.csrf();
    const first = json(await b.request('POST', '/v1/public/consent', { policyVersion: '2026-11-15', action: 'ACCEPT_ALL', analytics: false }));
    expect(first.consent).toMatchObject({ necessary: true, functional: true, analytics: true, marketing: true });
    await b.request('POST', '/v1/public/consent', { subjectId: first.subjectId, policyVersion: '2026-11-15', action: 'WITHDRAW', marketing: true });
    const rows = await ctx.deps.prisma.consentRecord.findMany({ where: { subjectId: first.subjectId }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((x) => [x.action, x.marketing])).toEqual([['ACCEPT_ALL', true], ['WITHDRAW', false]]);
    expect(rows[0]!.ipHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
