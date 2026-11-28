import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMaintenance } from '../src/jobs/maintenance.js';
import { Browser, createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
const PASSWORD = 'correct horse battery staple';
const json = (r: { body: string }) => JSON.parse(r.body);
/** Addresses from a range no other test file uses, so per-IP rate limits cannot collide. */
let nextIp = 0;
const browser = () => new Browser(ctx.app, `203.0.113.${++nextIp}`);
const linkToken = (text: string) => decodeURIComponent(/token=([^\s&"]+)/.exec(text)![1]!);

async function register(b: Browser, email: string) {
  await b.csrf();
  const r = await b.request('POST', '/v1/auth/register', { email, password: PASSWORD, fullName: 'Dr Auto Trial', affiliation: 'Test College', turnstileToken: 'ok' });
  expect(r.statusCode).toBe(201);
}

async function verify(b: Browser, email: string) {
  const mail = ctx.mailer.sent.filter((m) => m.to === email && /verify/i.test(m.subject)).at(-1)!;
  await b.request('GET', `/v1/auth/verify-email?token=${encodeURIComponent(linkToken(mail.text))}`);
  await b.request('POST', '/v1/auth/refresh');
}

const xprism = (ws: { apps: { appId: string; entitlement: { active: boolean; source?: string | null; expiresAt?: string | null } }[] }) => ws.apps.find((a) => a.appId === 'xprism')!.entitlement;

beforeAll(async () => {
  ctx = await createTestContext({ TRIAL_AUTO_GRANT: 'true' });
  // The automatic grant is made in the name of the longest-standing SUPERADMIN.
  const b = browser();
  await register(b, 'root-auto@altvivo.bio');
  await verify(b, 'root-auto@altvivo.bio');
  await ctx.deps.prisma.user.update({ where: { email: 'root-auto@altvivo.bio' }, data: { role: 'SUPERADMIN' } });
});

afterAll(async () => {
  await ctx.app.close();
  await ctx.deps.prisma.$disconnect();
});

describe('automatic free month', () => {
  it('starts the free month when a new account verifies its address, with no request or review', async () => {
    const b = browser();
    await register(b, 'auto.person@lab.edu');
    // Nothing before the address is proven.
    expect(xprism(json(await b.request('GET', '/v1/api/workspace'))).active).toBe(false);
    expect(await ctx.deps.prisma.trialRequest.count({ where: { email: 'auto.person@lab.edu' } })).toBe(0);

    await verify(b, 'auto.person@lab.edu');
    const ws = json(await b.request('GET', '/v1/api/workspace'));
    expect(xprism(ws)).toMatchObject({ active: true, source: 'trial' });
    expect(ws.trial).toMatchObject({ status: 'ACTIVE', days: 30, appIds: ['xprism', 'amaze'] });
    expect(json(await b.request('GET', '/v1/auth/session')).user.tier).toBe('TRIAL');

    const row = await ctx.deps.prisma.trialRequest.findFirstOrThrow({ where: { email: 'auto.person@lab.edu' } });
    expect(row).toMatchObject({ status: 'ACTIVE', institution: 'Test College' });
    expect((await ctx.deps.prisma.user.findUniqueOrThrow({ where: { id: row.decidedBy! } })).role).toBe('SUPERADMIN');
    expect(ctx.mailer.lastTo('auto.person@lab.edu')!.subject).toMatch(/free month .* has started/i);
    // Nothing for a SuperAdmin to review.
    expect(ctx.mailer.sent.some((m) => m.to === 'support@altvivo.bio' && m.subject.includes('Dr Auto Trial'))).toBe(false);
    expect(await ctx.deps.prisma.auditLog.count({ where: { eventType: 'TRIAL.AUTO_APPROVED', resourceId: row.id } })).toBe(1);
  });

  it('gives one free month per address: signing in again does not start another', async () => {
    const b = browser();
    await b.csrf();
    const r = await b.request('POST', '/v1/auth/login', { email: 'auto.person@lab.edu', password: PASSWORD, turnstileToken: 'ok' });
    expect(r.statusCode).toBe(200);
    expect(await ctx.deps.prisma.trialRequest.count({ where: { email: 'auto.person@lab.edu' } })).toBe(1);
    const user = await ctx.deps.prisma.user.findUniqueOrThrow({ where: { email: 'auto.person@lab.edu' } });
    expect(await ctx.deps.prisma.appEntitlement.count({ where: { userId: user.id, appId: 'xprism' } })).toBe(1);
  });

  it('approves a request that was still waiting from the old form', async () => {
    await ctx.deps.prisma.trialRequest.create({
      data: { name: 'Dr Waiting', email: 'waited@lab.edu', institution: 'Old Form College', useCase: 'Sent before requests were automatic.', appIds: ['xprism'] },
    });
    const b = browser();
    await register(b, 'waited@lab.edu');
    await verify(b, 'waited@lab.edu');
    expect(xprism(json(await b.request('GET', '/v1/api/workspace')))).toMatchObject({ active: true, source: 'trial' });
    const rows = await ctx.deps.prisma.trialRequest.findMany({ where: { email: 'waited@lab.edu' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'ACTIVE', institution: 'Old Form College' });
  });

  it('starts with one click from a signed-in session, and only for a verified address', async () => {
    const b = browser();
    await register(b, 'click@lab.edu');
    await b.csrf();
    expect((await b.request('POST', '/v1/api/free-month/start')).statusCode).toBe(403);
    await verify(b, 'click@lab.edu');
    // Already started by the verification itself: the click reports it, without a second month.
    const r = await b.request('POST', '/v1/api/free-month/start');
    expect(r.statusCode).toBe(200);
    expect(json(r)).toMatchObject({ started: false, trial: { status: 'ACTIVE' } });
  });

  it('answers the old request endpoint with the month already running', async () => {
    const b = browser();
    await register(b, 'late@lab.edu');
    await verify(b, 'late@lab.edu');
    const user = await ctx.deps.prisma.user.findUniqueOrThrow({ where: { email: 'late@lab.edu' } });
    expect(await ctx.deps.prisma.trialRequest.count({ where: { userId: user.id, status: 'ACTIVE' } })).toBe(1);
    await b.csrf();
    const again = await b.request('POST', '/v1/public/trial-request', { name: 'Dr Late', email: 'late@lab.edu', institution: 'Test College', useCase: 'Asking again after sign-up.' });
    expect(again.statusCode).toBe(200);
    expect(json(again)).toMatchObject({ status: 'already_requested', trial: { status: 'ACTIVE' } });
  });
  it('gives Advisory Board members no free month: their access is open-ended from the start', async () => {
    const b = browser();
    await register(b, 'advisor.auto@pharma.edu');
    await ctx.deps.prisma.user.update({ where: { email: 'advisor.auto@pharma.edu' }, data: { role: 'ADVISORY_BOARD' } });
    await verify(b, 'advisor.auto@pharma.edu');
    expect(await ctx.deps.prisma.trialRequest.count({ where: { email: 'advisor.auto@pharma.edu' } })).toBe(0);
    expect(xprism(json(await b.request('GET', '/v1/api/workspace')))).toMatchObject({ active: true, source: 'vip', expiresAt: null });
    expect(json(await b.request('GET', '/v1/auth/session')).user.tier).toBe('VIP');
    expect(ctx.mailer.sent.some((m) => m.to === 'advisor.auto@pharma.edu' && /free month/i.test(m.subject))).toBe(false);
  });

  it('shows no end date and sends no reminder to a member made Advisory Board during their free month', async () => {
    const b = browser();
    await register(b, 'advisor.later@pharma.edu');
    await verify(b, 'advisor.later@pharma.edu');
    expect(xprism(json(await b.request('GET', '/v1/api/workspace')))).toMatchObject({ source: 'trial' });
    await ctx.deps.prisma.user.update({ where: { email: 'advisor.later@pharma.edu' }, data: { role: 'ADVISORY_BOARD' } });
    await b.request('POST', '/v1/auth/refresh');
    expect(xprism(json(await b.request('GET', '/v1/api/workspace')))).toMatchObject({ active: true, source: 'vip', expiresAt: null });

    // Month ends in two days: an ordinary member is reminded, the advisor is not.
    const soon = new Date(Date.now() + 2 * 86_400_000);
    await ctx.deps.prisma.trialRequest.updateMany({ where: { email: { in: ['advisor.later@pharma.edu', 'auto.person@lab.edu'] } }, data: { endsAt: soon } });
    const log = { info: () => undefined, warn: () => undefined, error: () => undefined } as never;
    await runMaintenance(ctx.deps, log);
    expect(ctx.mailer.sent.some((m) => m.to === 'auto.person@lab.edu' && /free month on AltVivo ends on/.test(m.subject))).toBe(true);
    expect(ctx.mailer.sent.filter((m) => m.to === 'advisor.later@pharma.edu' && /free month on AltVivo ends on/.test(m.subject))).toHaveLength(0);
  });
});
