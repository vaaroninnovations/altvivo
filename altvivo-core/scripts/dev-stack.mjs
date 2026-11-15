#!/usr/bin/env node
// =============================================================================
// Local development stack for altvivo-core - NOT for production.
//
//   npm run build && node scripts/dev-stack.mjs
//
// Boots an embedded PostgreSQL 16 (production migrations + seed), an
// in-memory Redis, and the real API on http://localhost:4000 with host-only,
// non-Secure cookies so altvivo-web on http://localhost:3000 can sign in.
// Emails are printed to the console; Turnstile uses Cloudflare's test secret
// (always passes); object storage is in-memory; payments/OAuth are off.
// Seeds: founder@altvivo.test (SUPERADMIN), researcher@altvivo.test (PI with
// an active Dual-Suite term) and student@altvivo.test (no licence), plus demo
// advisory-board profiles. Password: see DEV_PASSWORD. Invoicing uses a
// synthetic seller GSTIN; payment gateways stay off (checkout answers 409).
// =============================================================================
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import RedisMock from "ioredis-mock";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(path.join(root, "dist", "server.js"))) {
  console.error("Run `npm run build` first.");
  process.exit(1);
}
const { loadConfig } = await import("../dist/config.js");
const { createDeps } = await import("../dist/container.js");
const { buildApp } = await import("../dist/server.js");

const DEV_PASSWORD = process.env.DEV_PASSWORD ?? "altvivo-dev-password";
const PG_PORT = Number(process.env.DEV_PG_PORT ?? 54400);
const API_PORT = Number(process.env.PORT ?? 4000);
const WEB_ORIGIN = process.env.DEV_WEB_ORIGIN ?? "http://localhost:3000";
const work = path.join(tmpdir(), "altvivo-dev-stack");
mkdirSync(work, { recursive: true });

// ----------------------------------------------------------------- postgres --
const pgDir = path.join(work, `pg-${Date.now()}`);
const server = new EmbeddedPostgres({ databaseDir: pgDir, user: "postgres", password: "postgres", port: PG_PORT, persistent: false, onLog: () => {} });
await server.initialise();
await server.start();
const url = (u, p, db) => `postgresql://${u}:${p}@127.0.0.1:${PG_PORT}/${db}`;
const PW = { mig: "m".repeat(40), app: "a".repeat(40) };
{
  const su = new pg.Client({ connectionString: url("postgres", "postgres", "postgres") });
  await su.connect();
  await su.query(`CREATE ROLE core_migrator LOGIN PASSWORD '${PW.mig}'; CREATE ROLE core_app LOGIN NOINHERIT PASSWORD '${PW.app}'; CREATE ROLE core_readonly LOGIN NOINHERIT PASSWORD 'r';`);
  await su.query(`CREATE DATABASE db_core OWNER core_migrator TEMPLATE template0`);
  await su.query(`GRANT CONNECT, TEMPORARY ON DATABASE db_core TO core_app`);
  await su.end();
  const db = new pg.Client({ connectionString: url("postgres", "postgres", "db_core") });
  await db.connect();
  await db.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS pg_trgm;
    REVOKE ALL ON SCHEMA public FROM PUBLIC; ALTER SCHEMA public OWNER TO core_migrator;
    GRANT USAGE ON SCHEMA public TO core_app, core_readonly;
    ALTER DEFAULT PRIVILEGES FOR ROLE core_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO core_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE core_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO core_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE core_migrator IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO core_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE core_migrator IN SCHEMA public GRANT SELECT ON TABLES TO core_readonly;`);
  await db.end();
  const r = spawnSync(process.execPath, ["db/scripts/deploy.mjs"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: url("core_migrator", PW.mig, "db_core"), AUDIT_CHAIN_GENESIS: "ab".repeat(32) },
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`db:deploy failed\n${r.stdout}\n${r.stderr}`);
}

// --------------------------------------------------------------- core app --
const keys = path.join(work, "keys");
mkdirSync(keys, { recursive: true });
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
writeFileSync(path.join(keys, "private.pem"), privateKey.export({ type: "pkcs8", format: "pem" }));
writeFileSync(path.join(keys, "public.pem"), publicKey.export({ type: "spki", format: "pem" }));

const cfg = loadConfig({
  NODE_ENV: "development",
  LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
  PORT: String(API_PORT),
  HOST: "127.0.0.1",
  PUBLIC_API_URL: `http://localhost:${API_PORT}`,
  PUBLIC_WEB_URL: WEB_ORIGIN,
  ALLOWED_ORIGINS: WEB_ORIGIN,
  COOKIE_DOMAIN: "",
  COOKIE_SECURE: "false",
  DATABASE_URL: url("core_app", PW.app, "db_core"),
  REDIS_URL: "redis://in-memory",
  JWT_PRIVATE_KEY_FILE: path.join(keys, "private.pem"),
  JWT_PUBLIC_KEY_FILE: path.join(keys, "public.pem"),
  MFA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  CSRF_SECRET: randomBytes(32).toString("hex"),
  REFRESH_TOKEN_PEPPER: randomBytes(32).toString("hex"),
  SPOKE_SERVICE_TOKENS: "",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  AUTH_RATE_LIMIT_PER_MINUTE: "30",
  R2_ACCOUNT_ID: "dev",
  R2_ACCESS_KEY_ID: "dev",
  R2_SECRET_ACCESS_KEY: "dev",
  SMTP_HOST: "console",
  SUPPORT_EMAIL: "support@altvivo.test",
  SELLER_LEGAL_NAME: "Aaron Innovations",
  SELLER_GSTIN: "29AAACA1234B1ZE",
  SELLER_ADDRESS: "12 Dev Road\nBengaluru, Karnataka 560001",
  SELLER_STATE_CODE: "29",
  SELLER_BANK_NAME: "Dev Bank",
  SELLER_BANK_ACCOUNT_NUMBER: "000111222333",
  SELLER_BANK_IFSC: "DEVB0000001",
  // Optional: real test-mode keys to try checkout locally.
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID ?? "",
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET ?? "",
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? "",
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? "",
});

const objects = new Map();
const deps = await createDeps(cfg, {
  redis: new RedisMock({ keyPrefix: cfg.REDIS_KEY_PREFIX }),
  mailer: {
    async send(m) {
      console.log(`\n[mail] to=${m.to} subject="${m.subject}"\n${m.text}\n`);
    },
  },
  storage: {
    async presignPut(i) {
      return { url: `http://localhost:${API_PORT}/dev-null/${i.key}`, headers: {} };
    },
    async presignGet(_b, key) {
      return `http://localhost:${API_PORT}/dev-null/${key}`;
    },
    async head(_b, key) {
      const o = objects.get(key);
      return o ? { size: o.length, contentType: undefined } : null;
    },
    async readHead(_b, key, n) {
      return (objects.get(key) ?? Buffer.alloc(0)).subarray(0, n);
    },
    async remove(_b, key) {
      objects.delete(key);
    },
    async put(_b, key, body) {
      objects.set(key, body);
    },
  },
});

// ------------------------------------------------------------- dev seeds --
{
  const { hashPassword } = await import("../dist/lib/password.js");
  const hash = await hashPassword(DEV_PASSWORD);
  const db = new pg.Client({ connectionString: url("core_migrator", PW.mig, "db_core") });
  await db.connect();
  await db.query(`SELECT audit_set_context(NULL, '127.0.0.1', 'dev-stack seed', 'core', 'SYSTEM')`);
  const { rows: [founder] } = await db.query(
    `INSERT INTO users (email, password_hash, full_name, role, email_verified_at, updated_at) VALUES ('founder@altvivo.test', $1, 'Founder Admin', 'SUPERADMIN', now(), now()) RETURNING id`,
    [hash],
  );
  const { rows: [pi] } = await db.query(
    `INSERT INTO users (email, password_hash, full_name, affiliation, role, email_verified_at, updated_at) VALUES ('researcher@altvivo.test', $1, 'Dr. Priya Raman', 'Institute of Pharmacology', 'PI', now(), now()) RETURNING id`,
    [hash],
  );
  await db.query(
    `INSERT INTO subscriptions (user_id, provider, billing_mode, plan_code, status, currency, seats, unit_amount_minor, current_period_start, current_period_end, updated_at)
     VALUES ($1, 'RAZORPAY', 'ONE_TIME', 'suite_annual', 'ACTIVE', 'INR', 1, 2999000, now() - interval '65 days', now() + interval '300 days', now())`,
    [pi.id],
  );
  await db.query(
    `INSERT INTO users (email, password_hash, full_name, affiliation, role, email_verified_at, updated_at) VALUES ('student@altvivo.test', $1, 'Rahul Student', 'Dev College of Pharmacy', 'STUDENT', now(), now())`,
    [hash],
  );
  const demo = [
    ["demo-pharmacologist", "Prof.", "Demo Pharmacologist", "M.Pharm, PhD", "Professor of Pharmacology", "Example Institute of Pharmaceutical Sciences", ["Neuropharmacology", "Behavioural assays", "3Rs"], true],
    ["demo-toxicologist", "Dr.", "Demo Toxicologist", "MVSc, PhD", "Head, Preclinical Toxicology", "Example Research Laboratories", ["Safety pharmacology", "GLP", "IAEC"], true],
    ["demo-educator", "Dr.", "Demo Educator", "MBBS, MD (Pharmacology)", "Associate Professor", "Example Medical College", ["Medical education", "CAL", "Clinical pharmacology"], false],
  ];
  for (const [slug, hon, name, cred, des, aff, spec, featured] of demo) {
    await db.query(
      `INSERT INTO advisory_board_members (slug, honorific, full_name, credentials, designation, affiliation, bio, specializations, is_published, featured, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,now())`,
      [slug, hon, name, cred, des, aff, `Demo profile for local development only.

This text shows how a biography with several paragraphs appears in the advisory-board dialog on altvivo.bio.`, spec, featured],
    );
  }
  await db.query(`INSERT INTO credit_ledger (user_id, action_type, delta, reference_id) VALUES ($1, 'PLAN_CREDIT_GRANT', 6000, 'dev-grant-1')`, [pi.id]);
  await db.query(`INSERT INTO credit_ledger (user_id, app_id, action_type, delta, reference_id) VALUES ($1, 'amaze', 'TRACKING_JOB', -45, 'amaze:job-17')`, [pi.id]);
  for (const [app, ev, res] of [["amaze", "AMAZE.TRIAL_RECORDED", "trial-17"], ["xprism", "XPRISM.EXPERIMENT_SUBMITTED", "organ-bath-07"], ["amaze", "AMAZE.TRIAL_RECORDED", "trial-18"]]) {
    await db.query(`INSERT INTO audit_logs (actor_type, actor_id, app_id, event_type, resource_id) VALUES ('SERVICE', $1, $2, $3, $4)`, [pi.id, app, ev, res]);
  }
  await db.query(`INSERT INTO app_waitlist (user_id, email, app_id, source) VALUES ($1, 'researcher@altvivo.test', 'stat', 'workspace')`, [pi.id]);
  await db.query(`INSERT INTO app_waitlist (email, app_id, source) VALUES ('early1@lab.test','pharmadme','web'), ('early2@lab.test','pharmadme','coming-soon')`);
  await db.end();
  console.log(`[dev] seeded founder ${founder.id} and researcher ${pi.id}`);
}

const app = await buildApp(deps);
await app.listen({ port: API_PORT, host: "127.0.0.1" });
console.log(`
[dev] altvivo-core  http://localhost:${API_PORT}   (web origin ${WEB_ORIGIN})
[dev] sign in as researcher@altvivo.test or founder@altvivo.test  /  password: ${DEV_PASSWORD}
[dev] founder must enrol TOTP on first sign-in (Account page); emails print here.
`);

const stop = async () => {
  await app.close().catch(() => {});
  await server.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
