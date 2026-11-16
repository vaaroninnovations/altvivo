import { readFileSync } from 'node:fs';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const csv = z
  .string()
  .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean));

const hex64 = z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['production', 'development', 'test']).default('production'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // CIDRs whose X-Real-IP header we trust (Caddy on the Docker bridge).
  TRUSTED_PROXY_CIDRS: csv.default('172.16.0.0/12,10.0.0.0/8,192.168.0.0/16,127.0.0.1/32,::1/128'),

  PUBLIC_API_URL: z.string().url().default('https://api.altvivo.bio'),
  PUBLIC_WEB_URL: z.string().url().default('https://altvivo.bio'),
  ALLOWED_ORIGINS: csv,
  COOKIE_DOMAIN: z.string().default('.altvivo.bio'),
  COOKIE_SECURE: bool.default('true'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  REDIS_KEY_PREFIX: z.string().default('core:'),

  JWT_ISSUER: z.string().url().default('https://api.altvivo.bio'),
  JWT_KID: z.string().optional(),
  JWT_PRIVATE_KEY_FILE: z.string(),
  JWT_PUBLIC_KEY_FILE: z.string(),
  JWT_PREVIOUS_PUBLIC_KEY_FILE: z.string().optional(),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(3600).default(604800),
  SESSION_ABSOLUTE_TTL_SECONDS: z.coerce.number().int().min(3600).default(30 * 24 * 3600),

  MFA_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64'),
  CSRF_SECRET: hex64,
  REFRESH_TOKEN_PEPPER: hex64,
  SPOKE_SERVICE_TOKENS: z.string().default(''),
  /** Roles that bypass the paid gate on LIVE / BETA / MAINTENANCE apps. */
  PAID_GATE_VIP_ROLES: csv.default('SUPERADMIN,ADVISORY_BOARD'),
  /** Lifetime of audience-scoped app tokens (POST /v1/auth/app-token). */
  APP_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),

  /**
   * Billing is in Indian rupees only. Set true to also bill addresses outside
   * India in US dollars through Stripe (the code path is kept but switched off).
   */
  USD_BILLING_ENABLED: bool.default('false'),
  /** Pay per use: price of one analysis (one animal / video) in paise, before GST. */
  PAY_PER_USE_PRICE_PAISE: z.coerce.number().int().min(100).max(10_000_000).default(2000),
  /** Length of the free access a SUPERADMIN approves from a "one month free" request. */
  TRIAL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  /** Bearer token for POST /v1/webhooks/mail/inbound (replies forwarded into the SuperAdmin mailbox); empty disables it. */
  MAIL_INBOUND_TOKEN: z.string().default('').refine((v) => v === '' || v.length >= 32, 'must be at least 32 characters'),

  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(5),
  SESSION_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(60),
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  PUBLIC_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(60),
  LOGIN_LOCKOUT_THRESHOLD: z.coerce.number().int().min(3).default(10),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  ORCID_CLIENT_ID: z.string().default(''),
  ORCID_CLIENT_SECRET: z.string().default(''),
  ORCID_BASE_URL: z.string().url().default('https://orcid.org'),

  TURNSTILE_SECRET_KEY: z.string().min(1),
  TURNSTILE_ALLOWED_HOSTNAMES: csv.default('altvivo.bio,www.altvivo.bio'),

  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),

  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_ENDPOINT: z.string().url().optional(),
  R2_BUCKET_VAULT: z.string().default('altvivo-vault'),
  R2_BUCKET_UPLOADS: z.string().default('altvivo-uploads'),
  R2_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
  /** Bucket served publicly (CDN) for advisory-board portraits; empty disables uploads. */
  R2_BUCKET_PUBLIC: z.string().default(''),
  R2_PUBLIC_BASE_URL: z.string().default(''),

  // Seller identity printed on GST invoices (all required to issue invoices).
  SELLER_LEGAL_NAME: z.string().default(''),
  SELLER_TRADE_NAME: z.string().default('AltVivo'),
  SELLER_GSTIN: z.string().default(''),
  SELLER_PAN: z.string().default(''),
  /** Multi-line in .env as literal "\n" separators. */
  SELLER_ADDRESS: z.string().default('').transform((v) => v.replace(/\\n/g, '\n').trim()),
  SELLER_STATE_CODE: z.string().default(''),
  SELLER_EMAIL: z.string().default('billing@altvivo.bio'),
  SELLER_PHONE: z.string().default(''),
  /** Letter of Undertaking ARN for zero-rated exports of services. */
  SELLER_LUT_REFERENCE: z.string().default(''),
  // Bank details printed on proforma invoices (NEFT / RTGS).
  SELLER_BANK_NAME: z.string().default(''),
  SELLER_BANK_ACCOUNT_NAME: z.string().default(''),
  SELLER_BANK_ACCOUNT_NUMBER: z.string().default(''),
  SELLER_BANK_IFSC: z.string().default(''),
  SELLER_BANK_BRANCH: z.string().default(''),
  PROFORMA_VALIDITY_DAYS: z.coerce.number().int().min(1).max(180).default(30),
  SUPPORT_EMAIL: z.string().email().default('support@altvivo.bio'),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM: z.string().default('AltVivo <no-reply@altvivo.bio>'),
});

export type Env = z.infer<typeof EnvSchema>;

export interface Config extends Env {
  jwtPrivateKeyPem: string;
  jwtPublicKeyPem: string;
  jwtPreviousPublicKeyPem: string | null;
  mfaKey: Buffer;
  serviceTokens: Map<string, string>; // token -> app_id
  allowedOriginSet: Set<string>;
  webOrigin: string;
  vipRoles: Set<string>;
  /** True when every seller field needed for a GST invoice is configured. */
  invoicingEnabled: boolean;
}

function readKey(path: string, label: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`cannot read ${label} at ${path}: ${(err as Error).message}`);
  }
}

export function parseServiceTokens(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const idx = entry.indexOf(':');
    if (idx < 1) throw new Error('SPOKE_SERVICE_TOKENS entries must be app_id:token');
    const appId = entry.slice(0, idx);
    const token = entry.slice(idx + 1);
    if (!/^[a-z][a-z0-9]{1,31}$/.test(appId)) throw new Error(`invalid app id in SPOKE_SERVICE_TOKENS: ${appId}`);
    if (token.length < 32) throw new Error(`service token for ${appId} is shorter than 32 characters`);
    map.set(token, appId);
  }
  return map;
}

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Seller details are optional (invoicing disabled) but, when present, must be consistent. */
const configError = (key: string, message: string) => new Error(`invalid configuration:\n  ${key}: ${message}`);

function validateSeller(e: Env): boolean {
  const required = [e.SELLER_LEGAL_NAME, e.SELLER_GSTIN, e.SELLER_ADDRESS, e.SELLER_STATE_CODE];
  if (required.every((v) => !v)) return false;
  if (required.some((v) => !v)) {
    throw configError('SELLER_*', 'set SELLER_LEGAL_NAME, SELLER_GSTIN, SELLER_ADDRESS and SELLER_STATE_CODE together');
  }
  if (!GSTIN_RE.test(e.SELLER_GSTIN)) throw configError('SELLER_GSTIN', 'not a GSTIN');
  if (e.SELLER_GSTIN.slice(0, 2) !== e.SELLER_STATE_CODE) {
    throw configError('SELLER_STATE_CODE', 'must equal the first two digits of SELLER_GSTIN');
  }
  return true;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`invalid configuration:\n${issues}`);
  }
  const e = parsed.data;
  if (e.R2_PUBLIC_BASE_URL && !/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(e.R2_PUBLIC_BASE_URL)) {
    throw configError('R2_PUBLIC_BASE_URL', 'must be an https URL');
  }
  if (!!e.R2_BUCKET_PUBLIC !== !!e.R2_PUBLIC_BASE_URL) {
    throw configError('R2_BUCKET_PUBLIC / R2_PUBLIC_BASE_URL', 'set both or neither');
  }
  const vip = e.PAID_GATE_VIP_ROLES.filter((r) => !['SUPERADMIN', 'ADVISORY_BOARD'].includes(r));
  if (vip.length) throw configError('PAID_GATE_VIP_ROLES', `only SUPERADMIN and ADVISORY_BOARD may bypass billing (got ${vip.join(', ')})`);
  const previous = e.JWT_PREVIOUS_PUBLIC_KEY_FILE ? readKey(e.JWT_PREVIOUS_PUBLIC_KEY_FILE, 'previous JWT public key') : null;
  return {
    ...e,
    jwtPrivateKeyPem: readKey(e.JWT_PRIVATE_KEY_FILE, 'JWT private key'),
    jwtPublicKeyPem: readKey(e.JWT_PUBLIC_KEY_FILE, 'JWT public key'),
    jwtPreviousPublicKeyPem: previous,
    mfaKey: Buffer.from(e.MFA_ENCRYPTION_KEY, 'base64'),
    serviceTokens: parseServiceTokens(e.SPOKE_SERVICE_TOKENS),
    allowedOriginSet: new Set(e.ALLOWED_ORIGINS.map((o) => o.replace(/\/$/, ''))),
    webOrigin: new URL(e.PUBLIC_WEB_URL).origin,
    vipRoles: new Set(e.PAID_GATE_VIP_ROLES),
    invoicingEnabled: validateSeller(e),
  };
}
