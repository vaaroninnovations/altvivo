import { createHmac } from 'node:crypto';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { authenticator } from 'otplib';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { AMAZE_TOKEN, Browser, XPRISM_TOKEN, createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
const PASSWORD = 'correct horse battery staple';

const json = (r: { body: string }) => JSON.parse(r.body);
const totpAt = (secret: string, offsetSteps: number) =>
  authenticator.clone({ epoch: Date.now() + offsetSteps * 30_000 }).generate(secret);
const linkToken = (text: string) => decodeURIComponent(/token=([^\s&"]+)/.exec(text)![1]!);

async function register(b: Browser, email: string, extra: Record<string, unknown> = {}) {
  await b.csrf();
  return b.request('POST', '/v1/auth/register', { email, password: PASSWORD, fullName: 'Dr Test Person', turnstileToken: 'ok', ...extra });
}

async function verifyEmail(b: Browser, email: string) {
  const mail = ctx.mailer.lastTo(email)!;
  const r = await b.request('GET', `/v1/auth/verify-email?token=${encodeURIComponent(linkToken(mail.text))}`);
  expect(r.statusCode).toBe(303);
  await b.request('POST', '/v1/auth/refresh');
}

async function enrolMfa(b: Browser) {
  const e = json(await b.request('POST', '/v1/api/mfa/enroll'));
  const a = await b.request('POST', '/v1/api/mfa/activate', { code: authenticator.generate(e.secret) });
  expect(a.statusCode).toBe(200);
  return { secret: e.secret as string, recoveryCodes: json(a).recoveryCodes as string[] };
}

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.app.close();
  await ctx.deps.prisma.$disconnect();
});

describe('JWKS & tokens', () => {
  it('publishes the RS256 signing key', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/.well-known/jwks.json' });
    expect(r.statusCode).toBe(200);
    const jwks = json(r);
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig', kid: ctx.deps.tokens.currentKid });
    expect(jwks.keys[0].d).toBeUndefined();
  });
});

describe('registration, cookies and claims', () => {
  const b = () => new Browser(ctx.app);

  it('rejects state-changing requests without a valid CSRF token', async () => {
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'a@b.co', password: 'x', turnstileToken: 'ok' },
      headers: { origin: 'https://altvivo.bio' },
    });
    expect(r.statusCode).toBe(403);
    expect(json(r).error.code).toBe('CSRF_FAILED');
  });

  it('rejects foreign origins', async () => {
    const br = b();
    await br.csrf();
    const r = await br.request('POST', '/v1/auth/login', { email: 'a@b.co', password: 'x', turnstileToken: 'ok' }, { origin: 'https://evil.example' });
    expect(json(r).error.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('requires Turnstile and a strong password', async () => {
    const br = b();
    expect(json(await register(br, 'weak@uni.edu', { turnstileToken: 'nope' })).error.code).toBe('TURNSTILE_FAILED');
    expect(json(await register(br, 'weak@uni.edu', { password: 'short' })).error.code).toBe('WEAK_PASSWORD');
  });

  it('registers, sets spec-compliant cookies and mints RS256 claims', async () => {
    const br = b();
    const r = await register(br, 'researcher@uni.edu');
    expect(r.statusCode).toBe(201);
    const setCookies = ([] as string[]).concat(r.headers['set-cookie'] as string[]);
    const at = setCookies.find((c) => c.startsWith('altvivo_at='))!;
    const rt = setCookies.find((c) => c.startsWith('altvivo_rt='))!;
    expect(at).toMatch(/Domain=\.altvivo\.bio/);
    expect(at).toMatch(/Path=\//);
    expect(at).toMatch(/HttpOnly/);
    expect(at).toMatch(/Secure/);
    expect(at).toMatch(/SameSite=Lax/);
    expect(at).toMatch(/Max-Age=900/);
    expect(rt).toMatch(/Path=\/v1\/auth\/refresh/);
    expect(rt).toMatch(/SameSite=Strict/);
    expect(rt).toMatch(/Max-Age=604800/);

    const jwks = createLocalJWKSet(json(await ctx.app.inject({ method: 'GET', url: '/.well-known/jwks.json' })));
    const { payload, protectedHeader } = await jwtVerify(br.get('altvivo_at')!, jwks, { issuer: 'https://api.altvivo.bio' });
    expect(protectedHeader.alg).toBe('RS256');
    expect(payload).toMatchObject({ email: 'researcher@uni.edu', name: 'Dr Test Person', role: 'RESEARCHER', tier: 'NONE', org_id: null });
    expect(payload.exp! - payload.iat!).toBe(900);
    // Strict paid access: every app is present and inactive until a paid grant exists.
    const none = { active: false, level: 'none', source: null, plan: null, expires_at: null };
    expect(payload.entitlements).toEqual({ xprism: none, amaze: none });
    expect(ctx.mailer.lastTo('researcher@uni.edu')?.subject).toMatch(/Verify/);
  });

  it('email verification auto-joins a whitelisted institution but grants no free access', async () => {
    const org = await ctx.deps.prisma.organization.create({
      data: { name: 'Uni of Testing', kind: 'UNIVERSITY', domainWhitelist: ['testing.ac.in'], seatLimit: 5, billingCountry: 'IN' },
    });
    const br = b();
    await register(br, 'student@testing.ac.in', { role: 'STUDENT' });
    await verifyEmail(br, 'student@testing.ac.in');
    const me = json(await br.request('GET', '/v1/api/me'));
    expect(me.user.emailVerified).toBe(true);
    expect(me.organization.id).toBe(org.id);
    expect(me.user.tier).toBe('NONE');
    expect(me.user.entitlements.xprism).toEqual({ active: false, level: 'none', source: null, plan: null, expiresAt: null });
  });

  it('a suspended or full institution is not joined', async () => {
    await ctx.deps.prisma.organization.create({ data: { name: 'Suspended College', domainWhitelist: ['closed.ac.in'], seatLimit: 5, billingCountry: 'IN', status: 'SUSPENDED' } });
    const full = await ctx.deps.prisma.organization.create({ data: { name: 'Tiny Lab', domainWhitelist: ['tiny.ac.in'], seatLimit: 1, billingCountry: 'IN' } });
    for (const email of ['a@closed.ac.in', 'first@tiny.ac.in', 'second@tiny.ac.in']) {
      const br = b();
      await register(br, email);
      await verifyEmail(br, email);
    }
    const users = await ctx.deps.prisma.user.findMany({ where: { email: { in: ['a@closed.ac.in', 'first@tiny.ac.in', 'second@tiny.ac.in'] } } });
    const byEmail = Object.fromEntries(users.map((u) => [u.email, u.orgId]));
    expect(byEmail['a@closed.ac.in']).toBeNull();
    expect(byEmail['first@tiny.ac.in']).toBe(full.id);
    expect(byEmail['second@tiny.ac.in']).toBeNull();
    expect(await ctx.deps.prisma.auditLog.count({ where: { eventType: 'ORG.SEAT_LIMIT_REACHED', resourceId: full.id } })).toBe(1);
  });

  it('refuses duplicate emails', async () => {
    expect(json(await register(b(), 'researcher@uni.edu')).error.code).toBe('EMAIL_IN_USE');
  });
});

describe('login, lockout and rate limits', () => {
  it('signs in and out', async () => {
    const br = new Browser(ctx.app);
    await register(br, 'login@uni.edu');
    const fresh = new Browser(ctx.app);
    await fresh.csrf();
    const r = await fresh.request('POST', '/v1/auth/login', { email: 'LOGIN@uni.edu', password: PASSWORD, turnstileToken: 'ok' });
    expect(r.statusCode).toBe(200);
    expect(json(r).status).toBe('authenticated');
    const access = fresh.get('altvivo_at')!;
    expect((await fresh.request('POST', '/v1/auth/logout')).statusCode).toBe(204);
    // The revoked access token is rejected immediately, not after 15 minutes.
    const after = await ctx.app.inject({ method: 'GET', url: '/v1/api/me', headers: { authorization: `Bearer ${access}` } });
    expect(json(after).error.code).toBe('SESSION_REVOKED');
    expect(await ctx.deps.redis.get(`revoked:sid:${(await ctx.deps.tokens.verify(access)).sid}`)).toBe('1');
  });

  it('gives identical errors for unknown email and wrong password, then locks the account', async () => {
    const br = new Browser(ctx.app);
    await register(br, 'lockme@uni.edu');
    const tries = async (email: string, password: string) => {
      const x = new Browser(ctx.app);
      await x.csrf();
      return x.request('POST', '/v1/auth/login', { email, password, turnstileToken: 'ok' });
    };
    const unknown = json(await tries('nobody@uni.edu', PASSWORD));
    const wrong = json(await tries('lockme@uni.edu', 'wrong password!!'));
    expect(unknown).toEqual(wrong);
    for (let i = 0; i < 3; i++) await tries('lockme@uni.edu', 'wrong password!!');
    // Locked now: even the right password is refused.
    expect((await tries('lockme@uni.edu', PASSWORD)).statusCode).toBe(401);
    const user = await ctx.deps.prisma.user.findUniqueOrThrow({ where: { email: 'lockme@uni.edu' } });
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(ctx.mailer.lastTo('lockme@uni.edu')?.subject).toMatch(/security notice/i);
  });

  it('limits credential endpoints to 5 requests / minute / IP', async () => {
    const br = new Browser(ctx.app, '198.51.100.77');
    await br.csrf();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await br.request('POST', '/v1/auth/login', { email: 'x@uni.edu', password: 'whatever!!', turnstileToken: 'ok' })).statusCode);
    }
    expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true);
    expect(codes[5]).toBe(429);
  });
});

describe('refresh-token rotation and reuse detection', () => {
  it('rotates, tolerates a parallel replay, and kills the family on real reuse', async () => {
    const br = new Browser(ctx.app);
    await register(br, 'rotate@uni.edu');
    const first = br.get('altvivo_rt')!;
    const r1 = await br.request('POST', '/v1/auth/refresh');
    expect(r1.statusCode).toBe(200);
    const second = br.get('altvivo_rt')!;
    expect(second).not.toBe(first);

    // Another tab presents the just-rotated token inside the grace window.
    const tab = new Browser(ctx.app, br.ip);
    tab.cookies.set('altvivo_rt', { value: first, path: '/v1/auth/refresh' });
    tab.cookies.set('altvivo_csrf', br.cookies.get('altvivo_csrf')!);
    const grace = await tab.request('POST', '/v1/auth/refresh');
    expect(grace.statusCode).toBe(200);
    expect(tab.get('altvivo_rt')).toBe(first); // no new refresh token issued

    // Same replay well after rotation => compromise => whole family revoked.
    await ctx.deps.prisma.refreshToken.updateMany({ where: { usedAt: { not: null }, session: { user: { email: 'rotate@uni.edu' } } }, data: { usedAt: new Date(Date.now() - 60_000) } });
    const reuse = await tab.request('POST', '/v1/auth/refresh');
    expect(json(reuse).error.code).toBe('SESSION_REVOKED');
    // The legitimate holder of the newest token is signed out too.
    expect((await br.request('POST', '/v1/auth/refresh')).statusCode).toBe(401);
    const events = await ctx.deps.prisma.auditLog.count({ where: { eventType: 'SECURITY.REFRESH_TOKEN_REUSE' } });
    expect(events).toBe(1);
  });

  it('bounce refresh redirects back to an allow-listed spoke only', async () => {
    const br = new Browser(ctx.app);
    await register(br, 'bounce@uni.edu');
    const ok = await br.request('GET', '/v1/auth/refresh/bounce?next=https%3A%2F%2Fxprism.altvivo.bio%2Flab%2F7');
    expect(ok.statusCode).toBe(303);
    expect(ok.headers.location).toBe('https://xprism.altvivo.bio/lab/7');
    const evil = await br.request('GET', '/v1/auth/refresh/bounce?next=https%3A%2F%2Fevil.example%2F');
    expect(evil.headers.location).toBe('https://altvivo.bio/workspace');
    // Without a refresh cookie the bounce goes to the portal login, keeping the target.
    const anon = await new Browser(ctx.app).request('GET', '/v1/auth/refresh/bounce?next=https%3A%2F%2Fxprism.altvivo.bio%2Flab%2F7');
    expect(anon.headers.location).toBe('https://altvivo.bio/login?redirect=https%3A%2F%2Fxprism.altvivo.bio%2Flab%2F7');
  });

  it('logout-all revokes every session of the user', async () => {
    const a = new Browser(ctx.app);
    await register(a, 'multi@uni.edu');
    const other = new Browser(ctx.app);
    await other.csrf();
    await other.request('POST', '/v1/auth/login', { email: 'multi@uni.edu', password: PASSWORD, turnstileToken: 'ok' });
    const r = await a.request('POST', '/v1/auth/logout-all');
    expect(json(r).sessionsRevoked).toBe(2);
    expect((await other.request('GET', '/v1/api/me')).statusCode).toBe(401);
    expect((await other.request('POST', '/v1/auth/refresh')).statusCode).toBe(401);
  });
});

describe('TOTP MFA', () => {
  it('enrols, challenges at login, blocks code replay and accepts a recovery code once', async () => {
    const br = new Browser(ctx.app);
    await register(br, 'mfa@uni.edu');
    const { secret, recoveryCodes } = await enrolMfa(br);
    expect(recoveryCodes).toHaveLength(10);
    const user = await ctx.deps.prisma.user.findUniqueOrThrow({ where: { email: 'mfa@uni.edu' } });
    expect(user.mfaSecret).toMatch(/^v1\./);
    expect(user.mfaSecret).not.toContain(secret);

    const login = async () => {
      const x = new Browser(ctx.app);
      await x.csrf();
      const r = json(await x.request('POST', '/v1/auth/login', { email: 'mfa@uni.edu', password: PASSWORD, turnstileToken: 'ok' }));
      expect(r.status).toBe('mfa_required');
      expect(x.get('altvivo_at')).toBeUndefined();
      return { x, challengeId: r.challengeId as string };
    };
    const { x, challengeId } = await login();
    const code = totpAt(secret, 1);
    expect((await x.request('POST', '/v1/auth/mfa/verify', { challengeId, code })).statusCode).toBe(200);
    expect(json(await x.request('GET', '/v1/api/me')).user.mfa).toBe(true);

    const second = await login();
    expect(json(await second.x.request('POST', '/v1/auth/mfa/verify', { challengeId: second.challengeId, code })).error.code).toBe('MFA_CODE_INVALID');
    expect((await second.x.request('POST', '/v1/auth/mfa/verify', { challengeId: second.challengeId, recoveryCode: recoveryCodes[0] })).statusCode).toBe(200);

    const third = await login();
    expect((await third.x.request('POST', '/v1/auth/mfa/verify', { challengeId: third.challengeId, recoveryCode: recoveryCodes[0] })).statusCode).toBe(401);
  });
});

describe('SUPERADMIN spoke switchboard', () => {
  let admin: Browser;
  let secret: string;

  it('forces MFA enrolment before any admin access', async () => {
    admin = new Browser(ctx.app);
    await register(admin, 'founder@altvivo.bio');
    await ctx.deps.prisma.user.update({ where: { email: 'founder@altvivo.bio' }, data: { role: 'SUPERADMIN', emailVerifiedAt: new Date() } });
    await admin.csrf();
    await admin.request('POST', '/v1/auth/login', { email: 'founder@altvivo.bio', password: PASSWORD, turnstileToken: 'ok' });
    expect(json(await admin.request('GET', '/v1/api/admin/apps')).error.code).toBe('MFA_ENROLLMENT_REQUIRED');
    ({ secret } = await enrolMfa(admin));
    const apps = json(await admin.request('GET', '/v1/api/admin/apps')).apps;
    expect(apps.map((a: { appId: string }) => a.appId)).toEqual(['xprism', 'amaze']);
  });

  it('non-admins are refused', async () => {
    const br = new Browser(ctx.app);
    await register(br, 'pi@uni.edu', { role: 'PI' });
    expect((await br.request('GET', '/v1/api/admin/apps')).statusCode).toBe(403);
  });

  it('flips aMaze to BETA with an e-signature and busts the registry cache', async () => {
    await ctx.app.inject({ method: 'GET', url: '/v1/public/apps' }); // warm cache
    const unsigned = await admin.request('PATCH', '/v1/api/admin/apps/amaze', { status: 'BETA', reason: 'Beta label test', totpCode: '000000' });
    expect(json(unsigned).error.code).toBe('MFA_CODE_INVALID');
    const r = await admin.request('PATCH', '/v1/api/admin/apps/amaze', { status: 'BETA', reason: 'Beta label test', totpCode: totpAt(secret, 1) });
    expect(r.statusCode).toBe(200);
    const pub = json(await ctx.app.inject({ method: 'GET', url: '/v1/public/apps' })).apps;
    expect(pub.find((a: { appId: string }) => a.appId === 'amaze').status).toBe('BETA');
    const ev = await ctx.deps.prisma.auditLog.findFirst({ where: { eventType: 'ADMIN.APP_REGISTRY_CHANGE', resourceId: 'amaze' } });
    expect(ev?.metadata).toMatchObject({ reason: 'Beta label test', signature: { meaning: 'approved', method: 'totp' }, to: { status: 'BETA' } });
    expect(ev?.actorId).toBeTruthy();
    // The retired "coming soon" status can no longer be chosen, through the API or in the database.
    const soon = await admin.request('PATCH', '/v1/api/admin/apps/amaze', { status: 'COMING_SOON', reason: 'Retired status test', totpCode: '000000' });
    expect(soon.statusCode).toBe(400);
    await expect(ctx.deps.prisma.appRegistry.update({ where: { appId: 'amaze' }, data: { status: 'COMING_SOON' } })).rejects.toThrow();
    // Restore for later tests.
    await admin.request('PATCH', '/v1/api/admin/apps/amaze', { status: 'LIVE', reason: 'Test cleanup step', totpCode: totpAt(secret, -1) });
    expect(json(await ctx.app.inject({ method: 'GET', url: '/v1/public/apps' })).apps.find((a: { appId: string }) => a.appId === 'amaze').status).toBe('LIVE');
  });
});

describe('SUPERADMIN creates users', () => {
  it('creates an account with a signed request and the invitee sets their own password', async () => {
    const admin = new Browser(ctx.app);
    await register(admin, 'creator@altvivo.bio');
    await ctx.deps.prisma.user.update({ where: { email: 'creator@altvivo.bio' }, data: { role: 'SUPERADMIN', emailVerifiedAt: new Date() } });
    await admin.csrf();
    await admin.request('POST', '/v1/auth/login', { email: 'creator@altvivo.bio', password: PASSWORD, turnstileToken: 'ok' });
    const { secret } = await enrolMfa(admin);
    const body = { email: 'Invitee@Lab.org', fullName: 'Dr Invited Person', role: 'PI', reason: 'Onboarding new PI' };

    expect(json(await admin.request('POST', '/v1/api/admin/users', { ...body, totpCode: '000000' })).error.code).toBe('MFA_CODE_INVALID');
    const r = await admin.request('POST', '/v1/api/admin/users', { ...body, totpCode: totpAt(secret, 1) });
    expect(r.statusCode).toBe(201);
    const created = json(r);
    expect(created).toMatchObject({ emailSent: true, setupLinkExpiresInDays: 7 });
    const user = await ctx.deps.prisma.user.findUniqueOrThrow({ where: { email: 'invitee@lab.org' } });
    expect(user).toMatchObject({ id: created.userId, role: 'PI', passwordHash: null, emailVerifiedAt: null });
    const ev = await ctx.deps.prisma.auditLog.findFirst({ where: { eventType: 'ADMIN.USER_CREATED', resourceId: user.id } });
    expect(ev?.metadata).toMatchObject({ reason: 'Onboarding new PI', role: 'PI', signature: { method: 'totp' } });

    // Same address again is refused.
    const dup = await admin.request('POST', '/v1/api/admin/users', { ...body, totpCode: totpAt(secret, -1) });
    expect(dup.statusCode).toBe(409);

    // The emailed link sets the password and verifies the address.
    const mail = ctx.mailer.lastTo('invitee@lab.org')!;
    expect(mail).toMatchObject({ sender: 'hello' });
    expect(mail.subject).toContain('account is ready');
    const invitee = new Browser(ctx.app);
    await invitee.csrf();
    expect((await invitee.request('POST', '/v1/auth/reset-password', { token: linkToken(mail.text), password: PASSWORD })).statusCode).toBe(204);
    expect((await ctx.deps.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).not.toBeNull();
    const login = await invitee.request('POST', '/v1/auth/login', { email: 'invitee@lab.org', password: PASSWORD, turnstileToken: 'ok' });
    expect(login.statusCode).toBe(200);
  });
});

describe('retired apps and waitlist', () => {
  it('lists only XPRISM and aMaze and has no waitlist endpoints', async () => {
    const pub = json(await ctx.app.inject({ method: 'GET', url: '/v1/public/apps' })).apps;
    expect(pub.map((a: { appId: string }) => a.appId)).toEqual(['xprism', 'amaze']);
    const br = new Browser(ctx.app);
    await register(br, 'toggle@uni.edu');
    expect((await br.request('POST', '/v1/public/waitlist', { email: 'early@lab.org', appId: 'xprism', turnstileToken: 'ok' })).statusCode).toBe(404);
    expect((await br.request('POST', '/v1/api/waitlist/xprism')).statusCode).toBe(404);
    const ws = json(await br.request('GET', '/v1/api/workspace'));
    expect(ws.apps.map((a: { appId: string }) => a.appId)).toEqual(['xprism', 'amaze']);
    expect(ws.apps[0]).not.toHaveProperty('onWaitlist');
    expect(ws.apps.find((a: { appId: string }) => a.appId === 'xprism').upgradeUrl).toBe('https://altvivo.bio/workspace/upgrade?app=xprism&reason=subscription_required');
  });
});

describe('internal spoke API', () => {
  let userId: string;
  const svc = (token: string, method: 'GET' | 'POST', url: string, payload?: unknown) =>
    ctx.app.inject({ method, url, payload: payload as never, headers: { authorization: `Bearer ${token}` } });

  beforeAll(async () => {
    const br = new Browser(ctx.app);
    await register(br, 'spokeuser@uni.edu');
    await verifyEmail(br, 'spokeuser@uni.edu');
    userId = (await ctx.deps.prisma.user.findUniqueOrThrow({ where: { email: 'spokeuser@uni.edu' } })).id;
  });

  it('requires a valid service token', async () => {
    expect((await svc('nope', 'GET', '/v1/internal/registry')).statusCode).toBe(401);
    expect((await svc(XPRISM_TOKEN, 'GET', '/v1/internal/registry')).statusCode).toBe(200);
  });

  it('refuses spoke actions for users without a paid licence, then allows them with one', async () => {
    const before = await svc(XPRISM_TOKEN, 'POST', '/v1/internal/vault/upload-url', { userId, fileName: 'a.pdf', fileType: 'PDF', sizeBytes: 10, sha256: 'a'.repeat(64) });
    expect(json(before).error.code).toBe('NOT_ENTITLED');
    expect(json(await svc(XPRISM_TOKEN, 'GET', `/v1/internal/users/${userId}/entitlements`)).entitlements.xprism.active).toBe(false);
    // Offline licence recorded by a SUPERADMIN (the grant trigger requires one).
    const admin = await ctx.deps.prisma.user.create({ data: { email: 'licensor@altvivo.bio', fullName: 'Licensor', role: 'SUPERADMIN', emailVerifiedAt: new Date() } });
    for (const appId of ['xprism', 'amaze']) {
      await ctx.deps.prisma.appEntitlement.create({
        data: { appId, source: 'MANUAL', userId, grantedBy: admin.id, reason: 'Test licence for spoke API', expiresAt: new Date(Date.now() + 864e5) },
      });
    }
    const after = json(await svc(XPRISM_TOKEN, 'GET', `/v1/internal/users/${userId}/entitlements`));
    expect(after.entitlements.xprism).toMatchObject({ active: true, source: 'manual', level: 'full' });
    expect(after.tier).toBe('INDIVIDUAL');
  });

  it('debits credits atomically, refuses overdraft, refunds once', async () => {
    const insufficient = await svc(AMAZE_TOKEN, 'POST', '/v1/internal/credits/debit', { userId, amount: 10, actionType: 'TRACKING_JOB', referenceId: 'job-1' });
    expect(insufficient.statusCode).toBe(402);
    await ctx.deps.prisma.$executeRaw`INSERT INTO credit_ledger (user_id, action_type, delta, reference_id) VALUES (${userId}::uuid, 'PURCHASE', 100, 'test-grant')`;
    const ok = json(await svc(AMAZE_TOKEN, 'POST', '/v1/internal/credits/debit', { userId, amount: 30, actionType: 'TRACKING_JOB', referenceId: 'job-1' }));
    expect(ok.balance).toBe(70);
    const dup = await svc(AMAZE_TOKEN, 'POST', '/v1/internal/credits/debit', { userId, amount: 30, actionType: 'TRACKING_JOB', referenceId: 'job-1' });
    expect(dup.statusCode).toBe(409);
    expect(json(await svc(AMAZE_TOKEN, 'POST', '/v1/internal/credits/refund', { userId, amount: 30, referenceId: 'job-1' })).balance).toBe(100);
    expect((await svc(AMAZE_TOKEN, 'POST', '/v1/internal/credits/refund', { userId, amount: 30, referenceId: 'job-1' })).statusCode).toBe(409);
    // XPRISM is not a credit-consuming app.
    expect(json(await svc(XPRISM_TOKEN, 'POST', '/v1/internal/credits/debit', { userId, amount: 1, actionType: 'RUN', referenceId: 'r' })).error.code).toBe('CREDITS_NOT_REQUIRED');
  });

  it('vault upload: presign, then magic-byte validation on completion', async () => {
    const pdf = Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n', 'latin1');
    const sha = createHmac('sha256', '').update('x').digest('hex');
    const up = json(await svc(XPRISM_TOKEN, 'POST', '/v1/internal/vault/upload-url', { userId, fileName: 'Organ Bath Report.pdf', fileType: 'PDF', sizeBytes: pdf.length, sha256: sha }));
    expect(up.method).toBe('PUT');
    expect(up.objectKey).toMatch(new RegExp(`^vault/${userId}/xprism/`));
    ctx.storage.objects.set(up.objectKey, pdf);
    const done = await svc(XPRISM_TOKEN, 'POST', '/v1/internal/vault/complete', { objectKey: up.objectKey });
    expect(done.statusCode).toBe(201);

    const html = Buffer.from('<html><script>alert(1)</script>');
    const bad = json(await svc(XPRISM_TOKEN, 'POST', '/v1/internal/vault/upload-url', { userId, fileName: 'evil.pdf', fileType: 'PDF', sizeBytes: html.length, sha256: sha }));
    ctx.storage.objects.set(bad.objectKey, html);
    const rejected = await svc(XPRISM_TOKEN, 'POST', '/v1/internal/vault/complete', { objectKey: bad.objectKey });
    expect(json(rejected).error.code).toBe('CONTENT_TYPE_MISMATCH');
    expect(ctx.storage.removed).toContain(bad.objectKey);

    const mismatch = await svc(XPRISM_TOKEN, 'POST', '/v1/internal/vault/upload-url', { userId, fileName: 'data.exe', fileType: 'CSV', sizeBytes: 10, sha256: sha });
    expect(json(mismatch).error.code).toBe('EXTENSION_MISMATCH');
  });
});

describe('OAuth', () => {
  async function oauthLogin(provider: 'google' | 'orcid') {
    const br = new Browser(ctx.app);
    const start = await br.request('GET', `/v1/auth/oauth/${provider}/start?next=${encodeURIComponent('https://amaze.altvivo.bio/projects')}`);
    expect(start.statusCode).toBe(302);
    const state = new URL(start.headers.location as string).searchParams.get('state')!;
    const cb = await br.request('GET', `/v1/auth/oauth/${provider}/callback?code=good-code&state=${state}`);
    return { br, cb };
  }

  it('rejects a callback without the browser-bound state cookie', async () => {
    const br = new Browser(ctx.app);
    const start = await br.request('GET', '/v1/auth/oauth/google/start');
    const state = new URL(start.headers.location as string).searchParams.get('state')!;
    const attacker = new Browser(ctx.app);
    const cb = await attacker.request('GET', `/v1/auth/oauth/google/callback?code=good-code&state=${state}`);
    expect(cb.headers.location).toContain('error=oauth_state');
  });

  it('Google sign-in claims an unverified pre-registered account and clears its password', async () => {
    await register(new Browser(ctx.app), 'victim@gmail.com');
    ctx.google.next = { provider: 'GOOGLE', subject: 'g-123', email: 'victim@gmail.com', emailVerified: true, name: 'Victim', orcidId: null };
    const { br, cb } = await oauthLogin('google');
    expect(cb.headers.location).toBe('https://amaze.altvivo.bio/projects');
    expect(br.get('altvivo_at')).toBeTruthy();
    const u = await ctx.deps.prisma.user.findUniqueOrThrow({ where: { email: 'victim@gmail.com' } });
    expect(u.passwordHash).toBeNull();
    expect(u.emailVerifiedAt).not.toBeNull();
  });

  it('ORCID without email goes through web registration', async () => {
    ctx.orcid.next = { provider: 'ORCID', subject: '0000-0002-1825-0097', email: null, emailVerified: false, name: 'Josiah Carberry', orcidId: '0000-0002-1825-0097' };
    const { br, cb } = await oauthLogin('orcid');
    const loc = new URL(cb.headers.location as string);
    expect(loc.pathname).toBe('/register');
    const pendingId = loc.searchParams.get('oauth')!;
    expect(json(await br.request('GET', `/v1/auth/oauth/pending/${pendingId}`)).name).toBe('Josiah Carberry');
    await br.csrf();
    const r = await br.request('POST', '/v1/auth/register', { email: 'carberry@brown.edu', fullName: 'Josiah Carberry', turnstileToken: 'ok', oauthPendingId: pendingId });
    expect(r.statusCode).toBe(201);
    expect((await ctx.deps.prisma.user.findUniqueOrThrow({ where: { email: 'carberry@brown.edu' } })).orcidId).toBe('0000-0002-1825-0097');
    // Second ORCID login is linked directly.
    const again = await oauthLogin('orcid');
    expect(again.cb.headers.location).toBe('https://amaze.altvivo.bio/projects');
  });

  describe('pre-account takeover through an ORCID-linked registration', () => {
    let n = 0;
    /** Attacker signs in with their own ORCID and registers the victim's address (no password). */
    async function attackerRegisters(victim: string) {
      n += 1;
      const orcid = `0000-0003-0000-00${String(n).padStart(2, '0')}`;
      ctx.orcid.next = { provider: 'ORCID', subject: orcid, email: null, emailVerified: false, name: 'Mallory', orcidId: orcid };
      const { br, cb } = await oauthLogin('orcid');
      const pendingId = new URL(cb.headers.location as string).searchParams.get('oauth')!;
      await br.csrf();
      const r = await br.request('POST', '/v1/auth/register', { email: victim, fullName: 'Mallory Attacker', turnstileToken: 'ok', oauthPendingId: pendingId });
      expect(r.statusCode).toBe(201);
      return { attacker: br, orcid };
    }
    async function attackerOrcidLogin(orcid: string) {
      ctx.orcid.next = { provider: 'ORCID', subject: orcid, email: null, emailVerified: false, name: 'Mallory', orcidId: orcid };
      return (await oauthLogin('orcid')).cb.headers.location as string;
    }

    it('a password reset by the mailbox owner removes the attacker ORCID link', async () => {
      const victim = 'takeover-reset@uni.edu';
      const { orcid } = await attackerRegisters(victim);
      const owner = new Browser(ctx.app);
      await owner.csrf();
      await owner.request('POST', '/v1/auth/forgot-password', { email: victim, turnstileToken: 'ok' });
      const reset = await owner.request('POST', '/v1/auth/reset-password', { token: linkToken(ctx.mailer.lastTo(victim)!.text), password: PASSWORD });
      expect(reset.statusCode).toBe(204);

      const u = await ctx.deps.prisma.user.findUniqueOrThrow({ where: { email: victim }, include: { oauthAccounts: true } });
      expect(u.emailVerifiedAt).not.toBeNull();
      expect(u.orcidId).toBeNull();
      expect(u.oauthAccounts).toHaveLength(0);
      // The attacker's ORCID no longer opens the account: it starts a fresh sign-up.
      expect(new URL(await attackerOrcidLogin(orcid)).pathname).toBe('/register');
    });

    it('a Google claim by the mailbox owner removes the attacker ORCID link', async () => {
      const victim = 'takeover-google@gmail.com';
      const { orcid } = await attackerRegisters(victim);
      ctx.google.next = { provider: 'GOOGLE', subject: 'g-takeover', email: victim, emailVerified: true, name: 'Victim', orcidId: null };
      expect((await oauthLogin('google')).cb.headers.location).toBe('https://amaze.altvivo.bio/projects');

      const u = await ctx.deps.prisma.user.findUniqueOrThrow({ where: { email: victim }, include: { oauthAccounts: true } });
      expect(u.orcidId).toBeNull();
      expect(u.oauthAccounts.map((a) => a.provider)).toEqual(['GOOGLE']);
      expect(new URL(await attackerOrcidLogin(orcid)).pathname).toBe('/register');
    });

    it('an unsolicited verification link opened elsewhere does not verify the account', async () => {
      const victim = 'takeover-verify@uni.edu';
      await attackerRegisters(victim);
      const link = `/v1/auth/verify-email?token=${encodeURIComponent(linkToken(ctx.mailer.lastTo(victim)!.text))}`;

      // Victim's browser, not signed in: asked to sign in, nothing verified.
      const r = await new Browser(ctx.app).request('GET', link);
      expect(r.statusCode).toBe(303);
      const loc = new URL(r.headers.location as string);
      expect(loc.pathname).toBe('/login');
      expect(loc.searchParams.get('verify_signin')).toBe('1');
      // A browser signed in to some other account is refused too.
      const other = new Browser(ctx.app);
      await register(other, 'bystander@uni.edu');
      expect((await other.request('GET', link)).headers.location).toContain('verify_error=wrong_account');

      const u = await ctx.deps.prisma.user.findUniqueOrThrow({ where: { email: victim } });
      expect(u.emailVerifiedAt).toBeNull();
    });
  });
});

describe('audit trail integrity after the whole suite', () => {
  it('hash chain verifies and contains the security events', async () => {
    const c = new pg.Client({ connectionString: inject('appDatabaseUrl') });
    await c.connect();
    const { rows } = await c.query('SELECT ok, rows_checked, reason FROM audit_verify_chain()');
    const { rows: types } = await c.query('SELECT DISTINCT event_type FROM audit_logs');
    await c.end();
    expect(rows[0]).toMatchObject({ ok: true, reason: 'ok' });
    const names = types.map((t) => t.event_type);
    for (const e of ['AUTH.REGISTER', 'AUTH.LOGIN', 'AUTH.LOGIN_FAILED', 'AUTH.LOGOUT', 'AUTH.MFA_ENABLED', 'SECURITY.ACCOUNT_LOCKED', 'SECURITY.REFRESH_TOKEN_REUSE', 'ADMIN.APP_REGISTRY_CHANGE', 'DB.APP_ENTITLEMENTS.INSERT', 'VAULT.UPLOAD_REJECTED', 'ORG.AUTO_JOIN', 'AUTH.OAUTH_LINKED']) {
      expect(names).toContain(e);
    }
  });
});
