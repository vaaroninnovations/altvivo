import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AMAZE_TOKEN, Browser, RAZORPAY_KEY_SECRET, XPRISM_TOKEN, createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
const PASSWORD = 'correct horse battery staple';
const json = (r: { body: string }) => JSON.parse(r.body);
const linkToken = (text: string) => decodeURIComponent(/token=([^\s&"]+)/.exec(text)![1]!);
/** Addresses no other test file uses, so per-IP rate limits cannot collide. */
let nextIp = 0;
const browser = () => new Browser(ctx.app, `198.51.101.${++nextIp}`);

async function verifiedUser(email: string) {
  const b = browser();
  await b.csrf();
  expect((await b.request('POST', '/v1/auth/register', { email, password: PASSWORD, fullName: 'Dr Per Use', turnstileToken: 'ok' })).statusCode).toBe(201);
  const mail = ctx.mailer.sent.filter((m) => m.to === email && /verify/i.test(m.subject)).at(-1)!;
  await b.request('GET', `/v1/auth/verify-email?token=${encodeURIComponent(linkToken(mail.text))}`);
  await b.request('POST', '/v1/auth/refresh');
  const user = await ctx.deps.prisma.user.findUniqueOrThrow({ where: { email } });
  return { b, id: user.id };
}

const svc = (token: string, url: string, payload: unknown) =>
  ctx.app.inject({ method: 'POST', url, payload: payload as never, headers: { authorization: `Bearer ${token}`, 'x-real-ip': '172.18.0.9' } });
const usage = (userId: string, referenceId: string, units?: number) => svc(AMAZE_TOKEN, '/v1/internal/usage', { userId, referenceId, ...(units ? { units } : {}) });
const amaze = async (b: Browser) => json(await b.request('GET', '/v1/api/workspace')).apps.find((a: { appId: string }) => a.appId === 'amaze').entitlement;
const KARNATAKA = { legalName: 'Dr Per Use', email: 'billing@lab.ac.in', addressLine1: '1 Campus Road', city: 'Bengaluru', state: 'Karnataka', stateCode: '29', postalCode: '560012', country: 'IN' };

async function pay(b: Browser, r: { razorpay: { orderId: string }; amountMinor: number }, paymentId: string) {
  ctx.razorpay.payments.set(paymentId, {
    id: paymentId, orderId: r.razorpay.orderId, status: 'captured', amount: r.amountMinor, currency: 'INR', method: 'upi', fee: 100, amountRefunded: 0, errorCode: null, errorDescription: null,
  });
  const signature = createHmac('sha256', RAZORPAY_KEY_SECRET).update(`${r.razorpay.orderId}|${paymentId}`).digest('hex');
  return b.request('POST', '/v1/api/billing/razorpay/confirm', { orderId: r.razorpay.orderId, paymentId, signature });
}

let buyer: Awaited<ReturnType<typeof verifiedUser>>;

beforeAll(async () => {
  ctx = await createTestContext();
  buyer = await verifiedUser('payg@lab.edu');
});

afterAll(async () => {
  await ctx.app.close();
  await ctx.deps.prisma.$disconnect();
});

describe('aMaze pay per use', () => {
  it('publishes the price of one analysis', async () => {
    const r = json(await ctx.app.inject({ method: 'GET', url: '/v1/public/plans' }));
    expect(r.payPerUse).toEqual([{ appId: 'amaze', name: 'aMaze', amountMinor: 2000, gstRateBp: 1800, purchasable: true }]);
  });

  it('is closed, and nothing can be charged, before any analyses are bought', async () => {
    expect((await amaze(buyer.b)).active).toBe(false);
    const r = await usage(buyer.id, 'video-0');
    expect(r.statusCode).toBe(402);
    expect(json(r).error).toMatchObject({ code: 'INSUFFICIENT_CREDITS' });
  });

  it('sells analyses on a GST invoice: quantity x Rs 20 + 18 %', async () => {
    expect(json(await buyer.b.request('POST', '/v1/api/billing/usage/checkout', { appId: 'amaze', quantity: 3 })).error.code).toBe('BILLING_PROFILE_REQUIRED');
    expect((await buyer.b.request('PUT', '/v1/api/billing/profile', KARNATAKA)).statusCode).toBe(200);
    expect((await buyer.b.request('POST', '/v1/api/billing/usage/checkout', { appId: 'xprism', quantity: 3 })).statusCode).toBe(404);
    expect((await buyer.b.request('POST', '/v1/api/billing/usage/checkout', { appId: 'amaze', quantity: 0 })).statusCode).toBe(400);

    const r = json(await buyer.b.request('POST', '/v1/api/billing/usage/checkout', { appId: 'amaze', quantity: 3 }));
    expect(r).toMatchObject({ provider: 'RAZORPAY', currency: 'INR', amountMinor: 7080 }); // 3 x 20.00 + 18 % GST
    expect(r.razorpay.notes).toMatchObject({ invoice_id: r.invoiceId, pay_per_use: 'amaze' });

    const done = await pay(buyer.b, r, 'pay_USAGE00001');
    expect(done.statusCode).toBe(200);
    expect(json(done)).toMatchObject({ status: 'active', subscriptionId: null });
    expect(json(done).user.entitlements.amaze).toMatchObject({ active: true, source: 'payg', expiresAt: null });
    expect(json(done).user.creditsRemaining).toBe(3);

    const inv = await ctx.deps.prisma.invoice.findUniqueOrThrow({ where: { id: r.invoiceId }, include: { lines: true } });
    expect(inv).toMatchObject({ status: 'PAID', kind: 'TAX_INVOICE', totalMinor: 7080n, subscriptionId: null });
    expect(inv.lines[0]).toMatchObject({ appId: 'amaze', planCode: null, quantity: 3, unitPriceMinor: 2000n });
    expect(inv.number).toMatch(/^AV\//);
    // The same payment reported again (webhook after the browser) adds nothing.
    expect((await pay(buyer.b, r, 'pay_USAGE00001')).statusCode).toBe(200);
    expect(json(await buyer.b.request('GET', '/v1/auth/session')).user.creditsRemaining).toBe(3);
  });

  it('opens aMaze only, through the gate, while analyses remain', async () => {
    const gate = (app: string) =>
      ctx.app.inject({
        method: 'GET', url: `/v1/auth/verify?app=${app}`,
        headers: { cookie: `altvivo_at=${buyer.b.get('altvivo_at')}`, 'x-forwarded-host': `${app}.altvivo.bio`, 'x-forwarded-uri': '/', 'x-forwarded-method': 'GET', accept: 'application/json' },
      });
    const ok = await gate('amaze');
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['x-altvivo-plan']).toBe('payg');
    expect((await gate('xprism')).statusCode).toBe(403);
  });

  it('takes one analysis per video, once per video, and closes at zero', async () => {
    expect(json(await usage(buyer.id, 'video-1'))).toEqual({ charged: true, mode: 'payg', units: 1, balance: 2 });
    // A retry of the same video is not charged twice.
    expect(json(await usage(buyer.id, 'video-1'))).toEqual({ charged: false, mode: 'payg', duplicate: true, balance: 2 });
    // Only aMaze's own service may report aMaze usage.
    expect((await svc(XPRISM_TOKEN, '/v1/internal/usage', { userId: buyer.id, referenceId: 'video-9' })).statusCode).toBe(402);
    expect((await ctx.app.inject({ method: 'POST', url: '/v1/internal/usage', payload: { userId: buyer.id, referenceId: 'video-9' } })).statusCode).toBe(401);

    const tooMany = await usage(buyer.id, 'batch-1', 5);
    expect(tooMany.statusCode).toBe(402);
    expect(json(await usage(buyer.id, 'batch-2', 2))).toMatchObject({ charged: true, units: 2, balance: 0 });

    // Claims are refreshed at zero: the app is locked again.
    await buyer.b.request('POST', '/v1/auth/refresh');
    expect((await amaze(buyer.b)).active).toBe(false);
    expect((await usage(buyer.id, 'video-3')).statusCode).toBe(402);
    const ledger = await ctx.deps.prisma.creditLedger.findMany({ where: { userId: buyer.id }, orderBy: { createdAt: 'asc' }, select: { actionType: true, delta: true, balanceAfter: true } });
    expect(ledger).toEqual([
      { actionType: 'USAGE_PURCHASE', delta: 3, balanceAfter: 3 },
      { actionType: 'USAGE', delta: -1, balanceAfter: 2 },
      { actionType: 'USAGE', delta: -2, balanceAfter: 0 },
    ]);
  });

  it('never charges someone who holds a subscription, licence or free month', async () => {
    const sub = await verifiedUser('subscriber@lab.edu');
    await ctx.deps.prisma.user.update({ where: { id: sub.id }, data: { role: 'RESEARCHER' } });
    const root = await verifiedUser('root-usage@altvivo.bio');
    await ctx.deps.prisma.user.update({ where: { id: root.id }, data: { role: 'SUPERADMIN' } });
    await ctx.deps.prisma.appEntitlement.create({
      data: { appId: 'amaze', source: 'MANUAL', userId: sub.id, grantedBy: root.id, reason: 'Annual subscription paid offline', expiresAt: new Date(Date.now() + 300 * 864e5) },
    });
    await ctx.deps.prisma.$executeRaw`INSERT INTO credit_ledger (user_id, action_type, delta, reference_id) VALUES (${sub.id}::uuid, 'USAGE_PURCHASE', 4, 'test-pack')`;
    expect(await amaze(sub.b)).toMatchObject({ active: true, source: 'manual' });
    expect(json(await usage(sub.id, 'video-1'))).toEqual({ charged: false, mode: 'manual', balance: 4 });
  });

  it('withdraws unused analyses when the purchase is refunded in full', async () => {
    const u = await verifiedUser('refund@lab.edu');
    await u.b.request('PUT', '/v1/api/billing/profile', KARNATAKA);
    const r = json(await u.b.request('POST', '/v1/api/billing/usage/checkout', { appId: 'amaze', quantity: 10 }));
    expect(r.amountMinor).toBe(23600);
    await pay(u.b, r, 'pay_USAGE00002');
    expect(json(await usage(u.id, 'video-1', 4))).toMatchObject({ balance: 6 });

    const { applyRefund } = await import('../src/services/checkout.js');
    expect(await applyRefund(ctx.deps, 'RAZORPAY', 'pay_USAGE00002', 23600n)).toBe('full');
    await u.b.request('POST', '/v1/auth/refresh');
    expect(json(await u.b.request('GET', '/v1/auth/session')).user.creditsRemaining).toBe(0);
    expect((await amaze(u.b)).active).toBe(false);
    expect(await ctx.deps.prisma.invoice.count({ where: { relatedInvoiceId: r.invoiceId, kind: 'CREDIT_NOTE' } })).toBe(1);
  });
});
