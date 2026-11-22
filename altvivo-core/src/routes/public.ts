import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { audit, withAudit } from '../lib/audit.js';
import { ACCESS_COOKIE } from '../lib/cookies.js';
import { hmacHex } from '../lib/crypto.js';
import { badRequest, pgCode, tooMany } from '../lib/errors.js';
import { templates } from '../lib/mailer.js';
import { userAgent } from '../lib/net.js';
import { actorOf, parse } from '../plugins/security.js';
import { deliverToInbox } from '../services/mailbox.js';
import { listApps } from '../services/registry.js';
import { claimApprovedTrial, toApiTrial, trialAppIds } from '../services/trials.js';

export const CONTACT_CATEGORIES = ['sales', 'institutional', 'support', 'billing', 'partnership', 'press', 'privacy', 'other'] as const;

/** Labels used by spoke contact forms (e.g. aMaze) mapped to routing categories. */
const CATEGORY_LABELS: Record<string, (typeof CONTACT_CATEGORIES)[number]> = {
  'technical support & bug report': 'support',
  'feature suggestion / enhancement': 'other',
  'academic & laboratory collaboration': 'partnership',
  'institutional deployment / vps setup': 'institutional',
  'commercial inquiries & licensing': 'sales',
  'general feedback': 'other',
};
const contactCategory = z.preprocess((v) => {
  if (typeof v !== 'string' || v.length > 100) return v;
  const key = v.trim().toLowerCase();
  if ((CONTACT_CATEGORIES as readonly string[]).includes(key)) return key;
  return CATEGORY_LABELS[key] ?? 'other';
}, z.enum(CONTACT_CATEGORIES));

const ContactBody = z.object({
  name: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().email().max(254),
  institution: z.string().trim().max(300).optional().nullable(),
  category: contactCategory,
  subject: z.string().trim().min(3).max(200),
  message: z.string().trim().min(10).max(5000),
  app: z.string().regex(/^[a-z][a-z0-9]{1,31}$/).optional().nullable(),
  /** Bots fill every field; humans never see this one. */
  website: z.string().max(500).optional(),
});

const TrialBody = z.object({
  name: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().email().max(254),
  institution: z.string().trim().min(2).max(300),
  designation: z.string().trim().max(120).optional().nullable(),
  /** Applications wanted; omitted = every application that is live. */
  apps: z.array(z.string().regex(/^[a-z][a-z0-9]{1,31}$/)).max(12).optional(),
  useCase: z.string().trim().min(10).max(2000),
  /** Bots fill every field; humans never see this one. */
  website: z.string().max(500).optional(),
});

const ConsentBody = z
  .object({
    subjectId: z.string().uuid().optional(),
    policyVersion: z.string().regex(/^[0-9A-Za-z.-]{1,32}$/),
    action: z.enum(['ACCEPT_ALL', 'REJECT_NON_ESSENTIAL', 'CUSTOM', 'WITHDRAW']),
    functional: z.boolean().default(false),
    analytics: z.boolean().default(false),
    marketing: z.boolean().default(false),
    source: z.enum(['banner', 'preferences', 'account']).default('banner'),
  })
  .transform((b) =>
    b.action === 'ACCEPT_ALL'
      ? { ...b, functional: true, analytics: true, marketing: true }
      : b.action === 'CUSTOM'
        ? b
        : { ...b, functional: false, analytics: false, marketing: false },
  );

export function detectCurrency(req: FastifyRequest, explicit?: string): 'INR' | 'USD' {
  if (explicit === 'INR' || explicit === 'USD') return explicit;
  const country = req.headers['cf-ipcountry'];
  return (Array.isArray(country) ? country[0] : country)?.toUpperCase() === 'IN' ? 'INR' : 'USD';
}

export default async function publicRoutes(app: FastifyInstance, d: Deps) {
  app.get('/healthz', { config: { rateLimit: 'none' }, logLevel: 'warn' }, async (_req, reply) => {
    try {
      await d.prisma.$queryRaw`SELECT 1`;
      await d.redis.ping();
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'degraded' });
    }
  });

  app.get('/.well-known/jwks.json', { config: { rateLimit: 'none' } }, async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    reply.header('Access-Control-Allow-Origin', '*');
    return d.tokens.jwksDocument();
  });

  app.get('/v1/public/apps', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    return { apps: await listApps(d.prisma, d.redis) };
  });

  /** Price list for /pricing, in Indian rupees (Razorpay). Amounts exclude GST. USD via Stripe only when USD_BILLING_ENABLED. */
  app.get<{ Querystring: { currency?: string } }>('/v1/public/plans', async (req, reply) => {
    const currency = d.cfg.USD_BILLING_ENABLED ? detectCurrency(req, req.query.currency) : 'INR';
    const provider = currency === 'INR' ? 'RAZORPAY' : 'STRIPE';
    const plans = await d.prisma.plan.findMany({
      where: { active: true, isPublic: true },
      include: { entitlements: { select: { appId: true }, orderBy: { appId: 'asc' } } },
      orderBy: { sortOrder: 'asc' },
    });
    reply.header('Cache-Control', 'public, max-age=60').header('Vary', 'CF-IPCountry');
    return {
      currency,
      provider,
      taxNote: currency === 'INR' ? 'Prices exclude 18% GST, added at checkout.' : 'Prices exclude taxes; exports of services are zero-rated.',
      invoicing: d.cfg.invoicingEnabled,
      /** Apps sold per use: the price of one analysis (one animal / video), before GST. */
      payPerUse: (await listApps(d.prisma, d.redis))
        .filter((a) => a.requiresCredits && (a.status === 'LIVE' || a.status === 'BETA'))
        .map((a) => ({ appId: a.appId, name: a.name, amountMinor: d.cfg.PAY_PER_USE_PRICE_PAISE, gstRateBp: 1800, purchasable: d.cfg.invoicingEnabled && d.billing.RAZORPAY.enabled })),
      plans: plans.map((p) => ({
        planCode: p.planCode,
        name: p.name,
        description: p.description,
        kind: p.kind,
        pricingModel: p.pricingModel,
        interval: p.interval,
        minSeats: p.minSeats,
        maxSeats: p.maxSeats,
        apps: p.entitlements.map((e) => e.appId),
        features: p.features,
        highlighted: p.highlighted,
        gstRateBp: p.gstRateBp,
        amountMinor: currency === 'INR' ? p.priceInrPaise : p.priceUsdCents,
        prices: { INR: p.priceInrPaise, USD: p.priceUsdCents },
        renews: currency === 'USD' && !!p.stripePriceId && p.pricingModel === 'FLAT' ? 'automatically' : 'prepaid',
        purchasable: d.cfg.invoicingEnabled && d.billing[provider].enabled,
        quoteAvailable: p.kind === 'SITE_LICENSE' && d.cfg.invoicingEnabled,
      })),
    };
  });

  /** Published Scientific Advisory Board (homepage section with ?featured=1). */
  app.get<{ Querystring: { featured?: string } }>('/v1/public/advisory-board', async (req, reply) => {
    const featured = req.query.featured === '1' || req.query.featured === 'true';
    const members = await d.prisma.advisoryBoardMember.findMany({
      where: { isPublished: true, ...(featured ? { featured: true } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { fullName: 'asc' }],
      select: {
        slug: true, honorific: true, fullName: true, credentials: true, designation: true, affiliation: true, bio: true,
        photoUrl: true, photoAlt: true, specializations: true, orcidId: true, scholarUrl: true, linkedinUrl: true, websiteUrl: true,
      },
    });
    reply.header('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
    return { members };
  });

  /**
   * Contact / sales / support form (portal and the aMaze contact page).
   * CSRF + Origin are checked by the security hook; 5 per minute per IP and
   * 5 per day per sender address.
   */
  app.post('/v1/public/contact', { config: { rateLimit: 'auth' } }, async (req, reply) => {
    const body = parse(ContactBody, req.body);
    if (body.website) return reply.code(201).send({ status: 'received' });
    const daily = await d.limiter.hit('contact-email', body.email, 5, 86_400).catch(() => ({ allowed: true, retryAfterSeconds: 0 }));
    if (!daily.allowed) throw tooMany(daily.retryAfterSeconds);
    const appId = body.app && (await d.prisma.appRegistry.findUnique({ where: { appId: body.app }, select: { appId: true } })) ? body.app : null;
    const userId = await optionalUserId(req);
    const msg = await withAudit(d.prisma, actorOf(req), async (tx) => {
      const m = await tx.contactMessage.create({
        data: {
          name: body.name, email: body.email, institution: body.institution || null, category: body.category, subject: body.subject,
          message: body.message, appId, userId, ipAddress: req.clientIp, userAgent: userAgent(req),
        },
      });
      // Every enquiry is also filed in the SuperAdmin mailbox, where it can be answered.
      await deliverToInbox(tx, { fromName: body.name, fromEmail: body.email, subject: body.subject, body: body.message, source: 'contact', contactMessageId: m.id, toEmails: [d.cfg.SUPPORT_EMAIL.toLowerCase()] });
      await audit(tx, 'CONTACT.RECEIVED', m.id, { category: body.category, app_id: appId });
      return m;
    });
    await d.mailer
      .send({ to: d.cfg.SUPPORT_EMAIL, replyTo: body.email, ...templates.contactNotification({ ...body, institution: body.institution ?? null, appId, id: msg.id }) })
      .catch((err) => req.log.warn({ err }, 'contact notification failed'));
    await d.mailer.send({ to: body.email, ...templates.contactAcknowledgement(body.name, body.subject) }).catch(() => undefined);
    return reply.code(201).send({ status: 'received', reference: msg.id });
  });

  /** What the "one month free" banner and form advertise. */
  app.get('/v1/public/trial-offer', async (_req, reply) => {
    const apps = await listApps(d.prisma, d.redis);
    reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    return { days: d.cfg.TRIAL_DAYS, apps: apps.filter((a) => a.status === 'LIVE' || a.status === 'BETA').map((a) => ({ appId: a.appId, name: a.name })) };
  });

  /**
   * "One month free" request form. Stored for a SUPERADMIN to approve
   * (/admin/trials) and filed in the admin mailbox. One request per address;
   * a repeat from an anonymous visitor gets the same answer as a first one,
   * so the form cannot be used to learn who has asked before.
   */
  app.post('/v1/public/trial-request', { config: { rateLimit: 'auth' } }, async (req, reply) => {
    const body = parse(TrialBody, req.body);
    if (body.website) return reply.code(201).send({ status: 'received' });
    const userId = await optionalUserId(req);
    const account = userId ? await d.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }) : null;
    // A signed-in person asks for their own account, whatever they typed.
    const emailAddr = account?.email.toLowerCase() ?? body.email;
    const daily = await d.limiter.hit('trial-email', emailAddr, 3, 86_400).catch(() => ({ allowed: true, retryAfterSeconds: 0 }));
    if (!daily.allowed) throw tooMany(daily.retryAfterSeconds);
    // The free month covers every open application; `apps` from older forms is ignored.
    const appIds = await trialAppIds(d);
    if (!appIds.length) throw badRequest('NO_APPLICATION', 'No application is open for a free month right now');

    const duplicate = async () => {
      const existing = await d.prisma.trialRequest.findFirst({ where: { email: emailAddr, status: { not: 'DECLINED' } } });
      return reply.code(account ? 200 : 201).send(account && existing ? { status: 'already_requested', trial: toApiTrial(existing) } : { status: 'received' });
    };
    if (await d.prisma.trialRequest.findFirst({ where: { email: emailAddr, status: { not: 'DECLINED' } }, select: { id: true } })) return duplicate();

    let request;
    try {
      request = await withAudit(d.prisma, actorOf(req), async (tx) => {
        const r = await tx.trialRequest.create({
          data: {
            name: body.name, email: emailAddr, institution: body.institution, designation: body.designation || null, appIds, useCase: body.useCase,
            userId, days: d.cfg.TRIAL_DAYS, ipAddress: req.clientIp, userAgent: userAgent(req),
          },
        });
        await deliverToInbox(tx, {
          fromName: body.name, fromEmail: emailAddr, source: 'trial', trialRequestId: r.id, toEmails: [d.cfg.SUPPORT_EMAIL.toLowerCase()],
          subject: `One month free: ${body.name}, ${body.institution}`,
          body: `${body.designation ? `${body.designation}, ` : ''}${body.institution}\nApplications: ${appIds.join(', ')}\n\n${body.useCase}`,
        });
        await audit(tx, 'TRIAL.REQUESTED', r.id, { apps: appIds, signed_in: !!userId });
        return r;
      });
    } catch (err) {
      if (pgCode(err) === '23505') return duplicate();
      throw err;
    }
    // Automatic free month: a signed-in, verified account starts it right away, no review needed.
    if (account && userId && d.cfg.TRIAL_AUTO_GRANT && (await claimApprovedTrial(d, { id: userId, email: emailAddr }, actorOf(req), req.log))) {
      const started = await d.prisma.trialRequest.findUniqueOrThrow({ where: { id: request.id } });
      return reply.code(201).send({ status: 'received', trial: toApiTrial(started) });
    }
    await d.mailer
      .send({ to: d.cfg.SUPPORT_EMAIL, replyTo: emailAddr, ...templates.trialRequestNotification({ name: body.name, email: emailAddr, institution: body.institution, designation: body.designation || null, apps: appIds, useCase: body.useCase, id: request.id }, `${d.cfg.webOrigin}/admin/trials`) })
      .catch((err) => req.log.warn({ err }, 'trial request notification failed'));
    await d.mailer.send({ to: emailAddr, ...templates.trialRequestReceived(body.name, d.cfg.TRIAL_DAYS) }).catch(() => undefined);
    return reply.code(201).send(account ? { status: 'received', trial: toApiTrial(request) } : { status: 'received' });
  });

  /**
   * Records a cookie-consent decision (append-only evidence). The banner keeps
   * `subjectId` in its own first-party cookie and sends it with every change.
   */
  app.post('/v1/public/consent', { config: { rateLimit: 'session' } }, async (req, reply) => {
    const body = parse(ConsentBody, req.body);
    const subjectId = body.subjectId ?? randomUUID();
    const userId = await optionalUserId(req);
    await d.prisma.consentRecord.create({
      data: {
        subjectId, userId, policyVersion: body.policyVersion, action: body.action, functional: body.functional, analytics: body.analytics,
        marketing: body.marketing, source: body.source, ipHash: hmacHex(d.cfg.REFRESH_TOKEN_PEPPER, `consent-ip:${req.clientIp}`),
        userAgent: userAgent(req),
      },
    });
    return reply.code(201).send({
      subjectId,
      consent: { necessary: true, functional: body.functional, analytics: body.analytics, marketing: body.marketing, policyVersion: body.policyVersion },
    });
  });

  /** Signed-in visitor (if any) for attribution; never required. */
  async function optionalUserId(req: FastifyRequest): Promise<string | null> {
    const token = req.cookies[ACCESS_COOKIE];
    if (!token) return null;
    try {
      const c = await d.tokens.verify(token);
      return (await d.revocations.tokenState(c.sid, c.sub, c.iat)) === 'revoked' ? null : c.sub;
    } catch {
      return null;
    }
  }
}
