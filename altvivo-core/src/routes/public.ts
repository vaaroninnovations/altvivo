import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { audit, withAudit } from '../lib/audit.js';
import { ACCESS_COOKIE } from '../lib/cookies.js';
import { hmacHex } from '../lib/crypto.js';
import { badRequest, tooMany } from '../lib/errors.js';
import { templates } from '../lib/mailer.js';
import { userAgent } from '../lib/net.js';
import { actorOf, parse } from '../plugins/security.js';
import { listApps } from '../services/registry.js';

const WaitlistBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  appId: z.string().regex(/^[a-z][a-z0-9]{1,31}$/),
  turnstileToken: z.string().min(1).max(2048),
  source: z.enum(['web', 'coming-soon', 'topbar']).default('web'),
});

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

  /** Price list for /pricing. Amounts exclude GST; Indian customers pay INR via Razorpay, others USD via Stripe. */
  app.get<{ Querystring: { currency?: string } }>('/v1/public/plans', async (req, reply) => {
    const currency = detectCurrency(req, req.query.currency);
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

  /** Anonymous early-access sign-up (landing page modal, coming-soon pages). */
  app.post('/v1/public/waitlist', { config: { rateLimit: 'auth' } }, async (req, reply) => {
    const body = parse(WaitlistBody, req.body);
    if (!(await d.turnstile.verify(body.turnstileToken, req.clientIp))) {
      throw badRequest('TURNSTILE_FAILED', 'Human verification failed, please retry');
    }
    const appRow = await d.prisma.appRegistry.findUnique({ where: { appId: body.appId }, select: { status: true } });
    if (!appRow) throw badRequest('UNKNOWN_APP', 'Unknown application');
    if (appRow.status === 'LIVE') throw badRequest('APP_ALREADY_LIVE', 'This application is already available');
    const existingUser = await d.prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
    await withAudit(d.prisma, actorOf(req), async (tx) => {
      const res = await tx.appWaitlist.createMany({
        data: [{ email: body.email, appId: body.appId, source: body.source, userId: existingUser?.id ?? null }],
        skipDuplicates: true,
      });
      if (res.count) await audit(tx, 'WAITLIST.JOIN', body.appId, { source: body.source, anonymous: true });
    });
    // Same answer for new and repeat sign-ups (no enumeration of who is listed).
    return reply.code(202).send({ status: 'on_waitlist', appId: body.appId });
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
      await audit(tx, 'CONTACT.RECEIVED', m.id, { category: body.category, app_id: appId });
      return m;
    });
    await d.mailer
      .send({ to: d.cfg.SUPPORT_EMAIL, replyTo: body.email, ...templates.contactNotification({ ...body, institution: body.institution ?? null, appId, id: msg.id }) })
      .catch((err) => req.log.warn({ err }, 'contact notification failed'));
    await d.mailer.send({ to: body.email, ...templates.contactAcknowledgement(body.name, body.subject) }).catch(() => undefined);
    return reply.code(201).send({ status: 'received', reference: msg.id });
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
