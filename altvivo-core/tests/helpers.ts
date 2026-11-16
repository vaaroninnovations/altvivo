import { PrismaClient } from '@prisma/client';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import RedisMock from 'ioredis-mock';
import { inject } from 'vitest';
import { loadConfig, type Config } from '../src/config.js';
import { createDeps } from '../src/container.js';
import type { Deps } from '../src/deps.js';
import type { MailMessage, Mailer } from '../src/lib/mailer.js';
import type { ObjectStorage, PresignPutInput } from '../src/lib/storage.js';
import type { TurnstileVerifier } from '../src/lib/turnstile.js';
import { RazorpayGateway, StripeGateway, type RazorpayPayment, type StripeCheckoutInput, type StripeSubscription } from '../src/services/billing.js';
import type { AuthorizationParams, OAuthIdentity, OAuthProvider } from '../src/services/oauth.js';
import { buildApp } from '../src/server.js';

export const XPRISM_TOKEN = 'x'.repeat(48);
export const AMAZE_TOKEN = 'z'.repeat(48);
export const STRIPE_WHSEC = 'whsec_test_secret_0123456789';
export const RAZORPAY_WHSEC = 'rzp_webhook_secret_0123456789';

export class CapturingMailer implements Mailer {
  sent: MailMessage[] = [];
  async send(msg: MailMessage) {
    this.sent.push(msg);
  }
  lastTo(to: string) {
    return [...this.sent].reverse().find((m) => m.to === to);
  }
}

export class FakeTurnstile implements TurnstileVerifier {
  async verify(token: string | undefined) {
    return token === 'ok';
  }
}

export class FakeStorage implements ObjectStorage {
  objects = new Map<string, Buffer>();
  removed: string[] = [];
  async presignPut(i: PresignPutInput) {
    return { url: `https://r2.test/${i.bucket}/${i.key}?sig=1`, headers: { 'Content-Type': i.contentType } };
  }
  async presignGet(bucket: string, key: string) {
    return `https://r2.test/${bucket}/${key}?get=1`;
  }
  async head(_b: string, key: string) {
    const o = this.objects.get(key);
    return o ? { size: o.length, contentType: undefined } : null;
  }
  async readHead(_b: string, key: string, n: number) {
    return (this.objects.get(key) ?? Buffer.alloc(0)).subarray(0, n);
  }
  async remove(_b: string, key: string) {
    this.removed.push(key);
    this.objects.delete(key);
  }
  async put(_b: string, key: string, body: Buffer) {
    this.objects.set(key, body);
  }
}

export class FakeOAuth implements OAuthProvider {
  enabled = true;
  next: OAuthIdentity | null = null;
  authorizationUrl(p: AuthorizationParams) {
    return `https://idp.test/authorize?state=${p.state}&nonce=${p.nonce}`;
  }
  async exchange(code: string) {
    if (code !== 'good-code' || !this.next) throw new Error('bad code');
    return this.next;
  }
}

export class FakeStripe extends StripeGateway {
  subs = new Map<string, StripeSubscription>();
  checkouts: StripeCheckoutInput[] = [];
  cancelled: string[] = [];
  override async getSubscription(id: string) {
    const s = this.subs.get(id);
    if (!s) throw new Error('no such subscription');
    return s;
  }
  override async createCheckout(i: StripeCheckoutInput) {
    this.checkouts.push(i);
    return { url: `https://checkout.stripe.test/c/${this.checkouts.length}`, id: `cs_test_${this.checkouts.length}` };
  }
  override async cancelAtPeriodEnd(id: string) {
    this.cancelled.push(id);
  }
}

export const RAZORPAY_KEY_SECRET = 'rzp_key_secret_0123456789';

export class FakeRazorpay extends RazorpayGateway {
  orders = new Map<string, { id: string; amount: number; currency: string; status: string; notes: Record<string, string> }>();
  payments = new Map<string, RazorpayPayment>();
  captured: string[] = [];
  override async createOrder(i: { amountMinor: bigint; receipt: string; notes: Record<string, string> }) {
    const o = { id: `order_T${String(this.orders.size + 1).padStart(10, '0')}`, amount: Number(i.amountMinor), currency: 'INR', status: 'created', notes: i.notes };
    this.orders.set(o.id, o);
    return o;
  }
  override async getOrder(id: string) {
    const o = this.orders.get(id);
    if (!o) throw new Error('no such order');
    return o;
  }
  override async getPayment(id: string) {
    const p = this.payments.get(id);
    if (!p) throw new Error('no such payment');
    return p;
  }
  override async capturePayment(id: string) {
    const p = this.payments.get(id)!;
    this.captured.push(id);
    const next = { ...p, status: 'captured' as const };
    this.payments.set(id, next);
    return next;
  }
}

/** Seller identity for GST invoices (synthetic GSTIN with a valid checksum). */
export const SELLER_ENV = {
  SELLER_LEGAL_NAME: 'AltVivo Test Private Limited',
  SELLER_GSTIN: '29AAACA1234B1ZE',
  SELLER_PAN: 'AAACA1234B',
  SELLER_ADDRESS: '12 Test Road, Bengaluru, Karnataka 560001',
  SELLER_STATE_CODE: '29',
  SELLER_LUT_REFERENCE: 'AD290000000000X',
  SELLER_BANK_NAME: 'Test Bank',
  SELLER_BANK_ACCOUNT_NAME: 'AltVivo Test Private Limited',
  SELLER_BANK_ACCOUNT_NUMBER: '000111222333',
  SELLER_BANK_IFSC: 'TEST0000001',
};

export interface TestContext {
  app: FastifyInstance;
  deps: Deps;
  cfg: Config;
  mailer: CapturingMailer;
  storage: FakeStorage;
  google: FakeOAuth;
  orcid: FakeOAuth;
  stripe: FakeStripe;
  razorpay: FakeRazorpay;
}

export async function createTestContext(env: Record<string, string> = {}): Promise<TestContext> {
  const dir = mkdtempSync(path.join(tmpdir(), 'altvivo-keys-'));
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  writeFileSync(path.join(dir, 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  writeFileSync(path.join(dir, 'public.pem'), publicKey.export({ type: 'spki', format: 'pem' }));

  const cfg = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    ALLOWED_ORIGINS: 'https://altvivo.bio,https://xprism.altvivo.bio,https://amaze.altvivo.bio',
    DATABASE_URL: inject('appDatabaseUrl'),
    REDIS_URL: 'redis://localhost:6379',
    JWT_PRIVATE_KEY_FILE: path.join(dir, 'private.pem'),
    JWT_PUBLIC_KEY_FILE: path.join(dir, 'public.pem'),
    MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    CSRF_SECRET: randomBytes(32).toString('hex'),
    REFRESH_TOKEN_PEPPER: randomBytes(32).toString('hex'),
    SPOKE_SERVICE_TOKENS: `xprism:${XPRISM_TOKEN},amaze:${AMAZE_TOKEN}`,
    TURNSTILE_SECRET_KEY: 'test',
    R2_ACCOUNT_ID: 'acct',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    SMTP_HOST: 'smtp.test',
    LOGIN_LOCKOUT_THRESHOLD: '4',
    ...SELLER_ENV,
    ...env,
  });
  const mailer = new CapturingMailer();
  const storage = new FakeStorage();
  const google = new FakeOAuth();
  const orcid = new FakeOAuth();
  const stripe = new FakeStripe('sk_test_x', STRIPE_WHSEC);
  const razorpay = new FakeRazorpay('rzp_test_key', RAZORPAY_KEY_SECRET, RAZORPAY_WHSEC);
  const redis = new RedisMock({ keyPrefix: cfg.REDIS_KEY_PREFIX }) as unknown as Deps['redis'];
  await redis.flushall();
  const deps = await createDeps(cfg, {
    prisma: new PrismaClient({ datasourceUrl: cfg.DATABASE_URL }),
    redis,
    mailer,
    storage,
    turnstile: new FakeTurnstile(),
    oauth: { google, orcid },
    billing: { STRIPE: stripe, RAZORPAY: razorpay },
  });
  const app = await buildApp(deps, { logger: false });
  await app.ready();
  return { app, deps, cfg, mailer, storage, google, orcid, stripe, razorpay };
}

/** A different client address for every Browser, so per-IP rate limits never collide between tests. */
let ipCounter = 0;
function nextTestIp(): string {
  ipCounter += 1;
  return `203.0.${113 + Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

/** Minimal cookie jar for app.inject(), honouring Path for the refresh cookie. */
export class Browser {
  cookies = new Map<string, { value: string; path: string }>();
  constructor(private readonly app: FastifyInstance, readonly ip = nextTestIp()) {}

  absorb(res: LightMyRequestResponse) {
    const raw = res.headers['set-cookie'];
    const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    for (const c of list) {
      const [pair, ...attrs] = c.split(';').map((s) => s.trim());
      const [name, ...v] = pair!.split('=');
      const value = v.join('=');
      const p = attrs.find((a) => a.toLowerCase().startsWith('path='))?.slice(5) ?? '/';
      const expired = attrs.some((a) => /^max-age=0$/i.test(a) || /^expires=thu, 01 jan 1970/i.test(a));
      if (!value || expired) this.cookies.delete(name!);
      else this.cookies.set(name!, { value, path: p });
    }
  }

  cookieHeader(url: string) {
    const p = new URL(url, 'https://api.altvivo.bio').pathname;
    return [...this.cookies.entries()]
      .filter(([, c]) => p === c.path || p.startsWith(c.path.endsWith('/') ? c.path : `${c.path}/`) || c.path === '/')
      .map(([k, c]) => `${k}=${c.value}`)
      .join('; ');
  }

  get(name: string) {
    return this.cookies.get(name)?.value;
  }

  async csrf() {
    if (!this.get('altvivo_csrf')) await this.request('GET', '/v1/auth/csrf');
    return this.get('altvivo_csrf')!;
  }

  async request(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { 'x-real-ip': this.ip, origin: 'https://altvivo.bio', ...headers };
    if (method !== 'GET' && !('x-csrf-token' in headers)) h['x-csrf-token'] = this.get('altvivo_csrf') ?? '';
    const cookie = this.cookieHeader(url);
    if (cookie) h.cookie = cookie;
    const res = await this.app.inject({ method, url, payload: body as never, headers: h });
    this.absorb(res);
    return res;
  }
}
