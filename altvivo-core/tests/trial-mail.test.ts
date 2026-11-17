import { authenticator } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemActor, withAudit } from '../src/lib/audit.js';
import { extendTrialsToAllApps, trialReference } from '../src/services/trials.js';
import { Browser, createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
const PASSWORD = 'correct horse battery staple';
const INBOUND_TOKEN = 'i'.repeat(40);
const json = (r: { body: string }) => JSON.parse(r.body);
/** Each browser gets its own address from a range the other test files never use, so per-IP rate limits cannot collide. */
let nextIp = 0;
const browser = () => new Browser(ctx.app, `198.51.100.${++nextIp}`);
const linkToken = (text: string) => decodeURIComponent(/token=([^\s&"]+)/.exec(text)![1]!);

async function register(b: Browser, email: string) {
  await b.csrf();
  const r = await b.request('POST', '/v1/auth/register', { email, password: PASSWORD, fullName: 'Dr Trial Person', turnstileToken: 'ok' });
  expect(r.statusCode).toBe(201);
}

async function verify(b: Browser, email: string) {
  const mail = ctx.mailer.sent.filter((m) => m.to === email && /verify/i.test(m.subject)).at(-1)!;
  await b.request('GET', `/v1/auth/verify-email?token=${encodeURIComponent(linkToken(mail.text))}`);
  await b.request('POST', '/v1/auth/refresh');
}

async function verifiedUser(email: string) {
  const b = browser();
  await register(b, email);
  await verify(b, email);
  const user = await ctx.deps.prisma.user.findUniqueOrThrow({ where: { email } });
  return { b, id: user.id };
}

async function superadmin(email: string) {
  const { id } = await verifiedUser(email);
  await ctx.deps.prisma.user.update({ where: { id }, data: { role: 'SUPERADMIN' } });
  const b = browser();
  await b.csrf();
  await b.request('POST', '/v1/auth/login', { email, password: PASSWORD, turnstileToken: 'ok' });
  const e = json(await b.request('POST', '/v1/api/mfa/enroll'));
  expect((await b.request('POST', '/v1/api/mfa/activate', { code: authenticator.generate(e.secret) })).statusCode).toBe(200);
  const sign = async () => {
    const step = Math.floor(Date.now() / 30_000);
    await ctx.deps.redis.del(`mfa:used:${id}:${step - 1}`, `mfa:used:${id}:${step}`, `mfa:used:${id}:${step + 1}`);
    return authenticator.generate(e.secret as string);
  };
  return { b, id, sign };
}

const requestTrial = async (b: Browser, body: Record<string, unknown>) => {
  await b.csrf();
  return b.request('POST', '/v1/public/trial-request', { name: 'Dr Trial Person', institution: 'Test College of Pharmacy', useCase: 'Teaching B.Pharm practicals this semester.', ...body });
};

let admin: Awaited<ReturnType<typeof superadmin>>;

beforeAll(async () => {
  ctx = await createTestContext({ MAIL_INBOUND_TOKEN: INBOUND_TOKEN });
  admin = await superadmin('root-trial@altvivo.bio');
});

afterAll(async () => {
  await ctx.app.close();
  await ctx.deps.prisma.$disconnect();
});

describe('one month free', () => {
  it('advertises the offer', async () => {
    const r = json(await browser().request('GET', '/v1/public/trial-offer'));
    expect(r.days).toBe(30);
    expect(r.apps.map((a: { appId: string }) => a.appId)).toEqual(['xprism', 'amaze']);
  });

  it('validates the form and ignores bots', async () => {
    const b = browser();
    expect((await requestTrial(b, { email: 'not-an-email' })).statusCode).toBe(400);
    expect((await requestTrial(b, { email: 'short@lab.edu', useCase: 'x' })).statusCode).toBe(400);
    const bot = await requestTrial(b, { email: 'bot@spam.test', website: 'https://spam.test' });
    expect(bot.statusCode).toBe(201);
    expect(await ctx.deps.prisma.trialRequest.count({ where: { email: 'bot@spam.test' } })).toBe(0);
  });

  it('stores a request, files it in the admin inbox and answers a repeat the same way', async () => {
    const b = browser();
    const first = await requestTrial(b, { email: 'New.Person@Lab.edu', apps: ['xprism'] });
    expect(first.statusCode).toBe(201);
    expect(json(first)).toEqual({ status: 'received' });
    const row = await ctx.deps.prisma.trialRequest.findFirstOrThrow({ where: { email: 'new.person@lab.edu' } });
    // Ticking one app on an older form still asks for every open application.
    expect(row).toMatchObject({ status: 'PENDING', appIds: ['xprism', 'amaze'], days: 30, userId: null });
    expect(ctx.mailer.lastTo('new.person@lab.edu')!.subject).toMatch(/one month free/i);
    expect(ctx.mailer.lastTo('support@altvivo.bio')!.subject).toMatch(/free month/i);
    const inbox = await ctx.deps.prisma.mailMessage.findFirstOrThrow({ where: { trialRequestId: row.id } });
    expect(inbox).toMatchObject({ folder: 'INBOX', isRead: false, source: 'trial', fromEmail: 'new.person@lab.edu' });

    const again = await requestTrial(browser(), { email: 'new.person@lab.edu' });
    expect(again.statusCode).toBe(201);
    expect(json(again)).toEqual({ status: 'received' });
    expect(await ctx.deps.prisma.trialRequest.count({ where: { email: 'new.person@lab.edu' } })).toBe(1);
  });

  it('is reserved for a SUPERADMIN with a TOTP signature', async () => {
    const row = await ctx.deps.prisma.trialRequest.findFirstOrThrow({ where: { email: 'new.person@lab.edu' } });
    const { b } = await verifiedUser('plain-user@lab.edu');
    expect((await b.request('GET', '/v1/api/admin/trials')).statusCode).toBe(403);
    expect((await b.request('GET', '/v1/api/admin/mail')).statusCode).toBe(403);
    const bad = await admin.b.request('POST', `/v1/api/admin/trials/${row.id}/approve`, { totpCode: '000000' });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    expect((await ctx.deps.prisma.trialRequest.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PENDING');
  });

  it('approves before the account exists and starts the month when the address is verified', async () => {
    const row = await ctx.deps.prisma.trialRequest.findFirstOrThrow({ where: { email: 'new.person@lab.edu' } });
    const r = await admin.b.request('POST', `/v1/api/admin/trials/${row.id}/approve`, { totpCode: await admin.sign() });
    expect(r.statusCode).toBe(200);
    expect(json(r).request).toMatchObject({ status: 'APPROVED', startsAt: null, endsAt: null });
    const mail = ctx.mailer.lastTo('new.person@lab.edu')!;
    expect(mail.subject).toMatch(/approved/);
    expect(mail.text).toContain('/register?');

    const b = browser();
    await register(b, 'new.person@lab.edu');
    // Not verified yet: nothing is granted.
    expect(json(await b.request('GET', '/v1/api/workspace')).apps.find((a: { appId: string }) => a.appId === 'xprism').entitlement.active).toBe(false);
    await verify(b, 'new.person@lab.edu');

    const ws = json(await b.request('GET', '/v1/api/workspace'));
    const x = ws.apps.find((a: { appId: string }) => a.appId === 'xprism');
    expect(x.entitlement).toMatchObject({ active: true, source: 'trial', level: 'full' });
    const left = (new Date(x.entitlement.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(left).toBeGreaterThan(29.9);
    expect(left).toBeLessThanOrEqual(30);
    // Every open application, not only the one that was ticked.
    expect(ws.apps.find((a: { appId: string }) => a.appId === 'amaze').entitlement).toMatchObject({ active: true, source: 'trial' });
    expect(ws.trial).toMatchObject({ status: 'ACTIVE', ended: false, appIds: ['xprism', 'amaze'] });
    const session = json(await b.request('GET', '/v1/auth/session'));
    expect(session.user.tier).toBe('TRIAL');
    expect(session.user.entitlements.xprism.source).toBe('trial');

    // The forward-auth gate lets the trial through and labels it.
    const gate = await ctx.app.inject({
      method: 'GET', url: '/v1/auth/verify?app=xprism',
      headers: { cookie: `altvivo_at=${b.get('altvivo_at')}`, 'x-forwarded-host': 'xprism.altvivo.bio', 'x-forwarded-uri': '/', 'x-forwarded-method': 'GET', accept: 'text/html' },
    });
    expect(gate.statusCode).toBe(200);
    expect(gate.headers['x-altvivo-access']).toBe('trial');
    const amaze = await ctx.app.inject({
      method: 'GET', url: '/v1/auth/verify?app=amaze',
      headers: { cookie: `altvivo_at=${b.get('altvivo_at')}`, 'x-forwarded-host': 'amaze.altvivo.bio', 'x-forwarded-uri': '/', 'x-forwarded-method': 'GET', accept: 'application/json' },
    });
    expect(amaze.statusCode).toBe(200);
  });

  it('extends free months that started with fewer applications to every app', async () => {
    const { id: userId } = await verifiedUser('older-trial@lab.edu');
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + 20 * 86_400_000);
    const old = await withAudit(ctx.deps.prisma, systemActor(), async (tx) => {
      const r = await tx.trialRequest.create({
        data: {
          name: 'Dr Older Trial', email: 'older-trial@lab.edu', institution: 'Test College', useCase: 'Started before every app was included.',
          appIds: ['xprism'], status: 'ACTIVE', days: 30, userId, decidedBy: admin.id, decidedAt: startsAt, startsAt, endsAt,
        },
      });
      await tx.appEntitlement.create({
        data: { appId: 'xprism', source: 'MANUAL', userId, grantedBy: admin.id, startsAt, expiresAt: endsAt, reason: 'old free month', reference: trialReference(r.id) },
      });
      return r;
    });
    const pending = await ctx.deps.prisma.trialRequest.create({
      data: { name: 'Dr Waiting', email: 'waiting@lab.edu', institution: 'Test College', useCase: 'Asked for one app only.', appIds: ['amaze'] },
    });

    const first = await withAudit(ctx.deps.prisma, systemActor(), (tx) => extendTrialsToAllApps(tx));
    expect(first.users).toContain(userId);
    const amaze = await ctx.deps.prisma.appEntitlement.findFirstOrThrow({ where: { userId, appId: 'amaze', reference: trialReference(old.id) } });
    expect(amaze.expiresAt?.getTime()).toBe(endsAt.getTime());
    expect((await ctx.deps.prisma.trialRequest.findUniqueOrThrow({ where: { id: old.id } })).appIds.sort()).toEqual(['amaze', 'xprism']);
    expect((await ctx.deps.prisma.trialRequest.findUniqueOrThrow({ where: { id: pending.id } })).appIds.sort()).toEqual(['amaze', 'xprism']);

    // Running it again changes nothing.
    const again = await withAudit(ctx.deps.prisma, systemActor(), (tx) => extendTrialsToAllApps(tx));
    expect(again).toEqual({ users: [], licences: 0, requests: 0 });
  });

  it('starts at once for a verified account and allows only one free month per address', async () => {
    const { b, id } = await verifiedUser('existing@lab.edu');
    const mine = await requestTrial(b, { email: 'someone-else@lab.edu' });
    expect(mine.statusCode).toBe(201);
    // Signed in: the request is for the account, whatever was typed.
    expect(json(mine).trial).toMatchObject({ status: 'PENDING', appIds: ['xprism', 'amaze'] });
    const row = await ctx.deps.prisma.trialRequest.findFirstOrThrow({ where: { email: 'existing@lab.edu' } });
    expect(row.userId).toBe(id);

    const list = json(await admin.b.request('GET', '/v1/api/admin/trials?status=PENDING'));
    expect(list.requests.find((r: { id: string }) => r.id === row.id).account).toMatchObject({ id, emailVerified: true });

    const r = await admin.b.request('POST', `/v1/api/admin/trials/${row.id}/approve`, { totpCode: await admin.sign(), days: 14 });
    expect(json(r).request).toMatchObject({ status: 'ACTIVE', days: 14 });
    expect(ctx.mailer.lastTo('existing@lab.edu')!.subject).toMatch(/active/);
    const licences = await ctx.deps.prisma.appEntitlement.findMany({ where: { userId: id, source: 'MANUAL' } });
    expect(licences.map((l) => l.appId).sort()).toEqual(['amaze', 'xprism']);
    expect(licences.every((l) => l.reference?.startsWith('TRIAL-') && l.grantedBy === admin.id)).toBe(true);

    // Claims are refreshed: the next refresh carries the trial.
    await b.request('POST', '/v1/auth/refresh');
    expect(json(await b.request('GET', '/v1/auth/session')).user.entitlements.amaze).toMatchObject({ active: true, source: 'trial' });

    const second = await requestTrial(b, { email: 'existing@lab.edu' });
    expect(second.statusCode).toBe(200);
    expect(json(second)).toMatchObject({ status: 'already_requested', trial: { status: 'ACTIVE' } });
    const twice = await admin.b.request('POST', `/v1/api/admin/trials/${row.id}/approve`, { totpCode: await admin.sign() });
    expect(twice.statusCode).toBe(409);
    expect((await admin.b.request('POST', `/v1/api/admin/trials/${row.id}/decline`, { reason: 'Changed our mind' })).statusCode).toBe(409);

    const dash = json(await admin.b.request('GET', '/v1/api/admin/dashboard'));
    expect(dash.freeMonth.active).toBeGreaterThanOrEqual(2);
  });

  it('declines with a note and lets the person ask again', async () => {
    await requestTrial(browser(), { email: 'declined@lab.edu' });
    const row = await ctx.deps.prisma.trialRequest.findFirstOrThrow({ where: { email: 'declined@lab.edu' } });
    const r = await admin.b.request('POST', `/v1/api/admin/trials/${row.id}/decline`, { reason: 'Not an academic address' });
    expect(json(r).request).toMatchObject({ status: 'DECLINED', decisionNote: 'Not an academic address' });
    expect(ctx.mailer.lastTo('declined@lab.edu')!.subject).toMatch(/about your request/i);
    await requestTrial(browser(), { email: 'declined@lab.edu' });
    expect(await ctx.deps.prisma.trialRequest.count({ where: { email: 'declined@lab.edu' } })).toBe(2);
  });
});

describe('SuperAdmin mailbox', () => {
  let contactMailId: string;

  it('receives contact enquiries, lists them with counts and marks them read when opened', async () => {
    const b = browser();
    await b.csrf();
    const sent = await b.request('POST', '/v1/public/contact', { name: 'Asha Rao', email: 'asha@college.edu', category: 'sales', subject: 'Quote for 60 seats', message: 'Please send a quotation for sixty seats.' });
    expect(sent.statusCode).toBe(201);

    const list = json(await admin.b.request('GET', '/v1/api/admin/mail?folder=INBOX&q=sixty'));
    expect(list.messages).toHaveLength(1);
    expect(list.messages[0]).toMatchObject({ fromEmail: 'asha@college.edu', subject: 'Quote for 60 seats', isRead: false, source: 'contact' });
    expect(list.messages[0].body).toBeUndefined();
    expect(list.counts.unread).toBeGreaterThanOrEqual(1);
    contactMailId = list.messages[0].id;

    const before = list.counts.unread;
    const opened = json(await admin.b.request('GET', `/v1/api/admin/mail/${contactMailId}`));
    expect(opened.message).toMatchObject({ isRead: true, body: 'Please send a quotation for sixty seats.' });
    expect(opened.message.contactMessage).toMatchObject({ category: 'sales', status: 'NEW' });
    expect(opened.counts.unread).toBe(before - 1);
    expect(json(await admin.b.request('GET', '/v1/api/admin/mail?unread=1&q=sixty')).messages).toHaveLength(0);
  });

  it('sends a reply into the same conversation and moves the enquiry on', async () => {
    const r = await admin.b.request('POST', '/v1/api/admin/mail', {
      to: ['Asha@College.edu'], cc: ['sales@altvivo.bio'], subject: 'Re: Quote for 60 seats', body: 'Dear Asha,\n\nYour proforma is attached.', inReplyTo: contactMailId,
    });
    expect(r.statusCode).toBe(201);
    const sent = json(r).message;
    expect(sent).toMatchObject({ folder: 'SENT', toEmails: ['asha@college.edu'], ccEmails: ['sales@altvivo.bio'], inReplyTo: contactMailId });
    const delivered = ctx.mailer.lastTo('asha@college.edu')!;
    expect(delivered).toMatchObject({ subject: 'Re: Quote for 60 seats', cc: ['sales@altvivo.bio'], replyTo: 'support@altvivo.bio' });
    expect(delivered.html).toContain('Dear Asha,');

    const thread = json(await admin.b.request('GET', `/v1/api/admin/mail/${sent.id}`)).thread;
    expect(thread.map((m: { folder: string }) => m.folder)).toEqual(['INBOX', 'SENT']);
    const contact = await ctx.deps.prisma.contactMessage.findFirstOrThrow({ where: { email: 'asha@college.edu' } });
    expect(contact.status).toBe('IN_PROGRESS');
    expect(await ctx.deps.prisma.auditLog.count({ where: { eventType: 'ADMIN.MAIL_SENT', resourceId: sent.id } })).toBe(1);

    // The customer's answer (forwarded by the mail provider) joins the conversation.
    const noAuth = await ctx.app.inject({ method: 'POST', url: '/v1/webhooks/mail/inbound', payload: { from: 'asha@college.edu', subject: 'RE: Quote for 60 seats', text: 'Thank you!' } });
    expect(noAuth.statusCode).toBe(401);
    const inbound = await ctx.app.inject({
      method: 'POST', url: '/v1/webhooks/mail/inbound', headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
      payload: { from: 'asha@college.edu', fromName: 'Asha Rao', subject: 'RE: Quote for 60 seats', text: 'Thank you!' },
    });
    expect(inbound.statusCode).toBe(201);
    const reply = await ctx.deps.prisma.mailMessage.findUniqueOrThrow({ where: { id: json(inbound).id } });
    expect(reply).toMatchObject({ folder: 'INBOX', threadId: sent.threadId, inReplyTo: sent.id, source: 'inbound' });
  });

  it('requires a recipient, subject and text to send', async () => {
    expect((await admin.b.request('POST', '/v1/api/admin/mail', { subject: 'Hello', body: 'Hi' })).statusCode).toBe(400);
    expect((await admin.b.request('POST', '/v1/api/admin/mail', { to: ['a@b.edu'], body: 'Hi' })).statusCode).toBe(400);
    expect((await admin.b.request('POST', '/v1/api/admin/mail', { to: ['not-an-address'], subject: 'Hello', body: 'Hi' })).statusCode).toBe(400);
  });

  it('keeps drafts, sends them later, and saves a failed send as a draft', async () => {
    const d1 = json(await admin.b.request('POST', '/v1/api/admin/mail', { draft: true, subject: 'Welcome', body: 'Half written' }));
    expect(d1.message).toMatchObject({ folder: 'DRAFT', toEmails: [] });
    const d2 = json(await admin.b.request('POST', '/v1/api/admin/mail', { draft: true, draftId: d1.message.id, to: ['dean@uni.edu'], subject: 'Welcome', body: 'Finished text' }));
    expect(d2.message.id).toBe(d1.message.id);
    expect(d2.counts.drafts).toBe(1);

    const original = ctx.mailer.send.bind(ctx.mailer);
    ctx.mailer.send = async () => {
      throw new Error('smtp down');
    };
    const failed = await admin.b.request('POST', '/v1/api/admin/mail', { draftId: d1.message.id, to: ['dean@uni.edu'], subject: 'Welcome', body: 'Finished text' });
    ctx.mailer.send = original;
    expect(failed.statusCode).toBe(502);
    expect(json(failed).error).toMatchObject({ code: 'MAIL_SEND_FAILED', details: { draftId: d1.message.id } });
    expect((await ctx.deps.prisma.mailMessage.findUniqueOrThrow({ where: { id: d1.message.id } })).deliveryError).toBe('smtp down');

    const ok = await admin.b.request('POST', '/v1/api/admin/mail', { draftId: d1.message.id, to: ['dean@uni.edu'], subject: 'Welcome', body: 'Finished text' });
    expect(ok.statusCode).toBe(201);
    expect(json(ok).message).toMatchObject({ id: d1.message.id, folder: 'SENT', deliveryError: null });
    expect(json(ok).counts.drafts).toBe(0);
    expect(ctx.mailer.lastTo('dean@uni.edu')!.text).toBe('Finished text');
  });

  it('stars, trashes, restores and permanently deletes', async () => {
    const starred = json(await admin.b.request('PATCH', `/v1/api/admin/mail/${contactMailId}`, { isStarred: true, isRead: false }));
    expect(starred.message).toMatchObject({ isStarred: true, isRead: false });
    expect(json(await admin.b.request('GET', '/v1/api/admin/mail?folder=STARRED')).messages.map((m: { id: string }) => m.id)).toContain(contactMailId);

    // Not in Trash yet: cannot be deleted for good.
    expect((await admin.b.request('DELETE', `/v1/api/admin/mail/${contactMailId}`)).statusCode).toBe(409);
    const trashed = json(await admin.b.request('POST', '/v1/api/admin/mail/bulk', { ids: [contactMailId], action: 'trash' }));
    expect(trashed.changed).toBe(1);
    expect(json(await admin.b.request('GET', '/v1/api/admin/mail?folder=TRASH')).messages[0]).toMatchObject({ id: contactMailId, trashedFrom: 'INBOX' });
    expect(json(await admin.b.request('GET', '/v1/api/admin/mail?folder=STARRED')).messages.map((m: { id: string }) => m.id)).not.toContain(contactMailId);

    const restored = json(await admin.b.request('PATCH', `/v1/api/admin/mail/${contactMailId}`, { folder: 'RESTORE' }));
    expect(restored.message).toMatchObject({ folder: 'INBOX', trashedFrom: null });

    await admin.b.request('PATCH', `/v1/api/admin/mail/${contactMailId}`, { folder: 'TRASH' });
    expect((await admin.b.request('DELETE', `/v1/api/admin/mail/${contactMailId}`)).statusCode).toBe(204);
    expect(await ctx.deps.prisma.mailMessage.findUnique({ where: { id: contactMailId } })).toBeNull();
    // The enquiry itself is kept.
    expect(await ctx.deps.prisma.contactMessage.count({ where: { email: 'asha@college.edu' } })).toBe(1);

    const all = json(await admin.b.request('GET', '/v1/api/admin/mail?folder=INBOX')).messages.map((m: { id: string }) => m.id);
    await admin.b.request('POST', '/v1/api/admin/mail/bulk', { ids: all, action: 'trash' });
    const emptied = json(await admin.b.request('POST', '/v1/api/admin/mail/trash/empty'));
    expect(emptied.deleted).toBe(all.length);
    expect(emptied.counts).toMatchObject({ inbox: 0, trash: 0 });
  });
});
