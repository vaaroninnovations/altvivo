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
// an active Dual-Suite term) and student@altvivo.test (on a running free month), demo
// free-month requests and SuperAdmin mailbox messages, plus demo
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
  await db.query(`INSERT INTO credit_ledger (user_id, action_type, delta, reference_id) VALUES ($1, 'USAGE_PURCHASE', 12, 'dev-grant-1')`, [pi.id]);
  await db.query(`INSERT INTO credit_ledger (user_id, app_id, action_type, delta, reference_id) VALUES ($1, 'amaze', 'USAGE', -3, 'amaze:job-17')`, [pi.id]);
  for (const [app, ev, res] of [["amaze", "AMAZE.TRIAL_RECORDED", "trial-17"], ["xprism", "XPRISM.EXPERIMENT_SUBMITTED", "organ-bath-07"], ["amaze", "AMAZE.TRIAL_RECORDED", "trial-18"]]) {
    await db.query(`INSERT INTO audit_logs (actor_type, actor_id, app_id, event_type, resource_id) VALUES ('SERVICE', $1, $2, $3, $4)`, [pi.id, app, ev, res]);
  }
  await db.query(`INSERT INTO app_waitlist (user_id, email, app_id, source) VALUES ($1, 'researcher@altvivo.test', 'stat', 'workspace')`, [pi.id]);
  await db.query(`INSERT INTO app_waitlist (email, app_id, source) VALUES ('early1@lab.test','pharmadme','web'), ('early2@lab.test','pharmadme','coming-soon')`);
  // ---- one month free: a running free month, two requests waiting, one declined
  const { rows: [student] } = await db.query(`SELECT id FROM users WHERE email = 'student@altvivo.test'`);
  const { rows: [running] } = await db.query(
    `INSERT INTO trial_requests (name, email, institution, designation, app_ids, use_case, user_id, status, days, decided_by, decided_at, starts_at, ends_at, updated_at)
     VALUES ('Rahul Student', 'student@altvivo.test', 'Dev College of Pharmacy', 'B.Pharm student', ARRAY['xprism','amaze'], 'Practising organ-bath experiments before the practical exam.',
             $1, 'ACTIVE', 30, $2, now() - interval '9 days', now() - interval '9 days', now() + interval '21 days', now()) RETURNING id`,
    [student.id, founder.id],
  );
  for (const appId of ["xprism", "amaze"]) {
    await db.query(
      `INSERT INTO app_entitlements (app_id, source, user_id, granted_by, starts_at, expires_at, reason, reference)
       VALUES ($1, 'MANUAL', $2, $3, now() - interval '9 days', now() + interval '21 days', 'One month free (30 days)', $4)`,
      [appId, student.id, founder.id, `TRIAL-${running.id.slice(0, 8).toUpperCase()}`],
    );
  }
  const pending = [
    ["Dr. Meera Nair", "meera.nair@pharmacy.test", "Kerala Institute of Pharmaceutical Sciences", "Associate Professor", ["xprism", "amaze"], "We teach 120 B.Pharm students each year and want to evaluate XPRISM for the pharmacology practicals before the next academic council meeting.", "2 hours"],
    ["Arjun Mehta", "arjun.mehta@neurolab.test", "Centre for Behavioural Neuroscience", "PhD scholar", ["amaze"], "Scoring elevated plus maze videos for my thesis; I would like to compare aMaze tracking with our manual scoring.", "26 hours"],
  ];
  for (const [name, email, inst, role, apps, why, ago] of pending) {
    const { rows: [t] } = await db.query(
      `INSERT INTO trial_requests (name, email, institution, designation, app_ids, use_case, days, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,30, now() - $7::interval, now()) RETURNING id`,
      [name, email, inst, role, apps, why, ago],
    );
    await db.query(
      `INSERT INTO mail_messages (folder, thread_id, from_name, from_email, to_emails, subject, body, source, trial_request_id, created_at, updated_at)
       VALUES ('INBOX', gen_random_uuid(), $1, $2, ARRAY['support@altvivo.test'], $3, $4, 'trial', $5, now() - $6::interval, now())`,
      [name, email, `One month free: ${name}, ${inst}`, `${role}, ${inst}\nApplications: ${apps.join(", ")}\n\n${why}`, t.id, ago],
    );
  }
  await db.query(
    `INSERT INTO trial_requests (name, email, institution, app_ids, use_case, status, days, decided_by, decided_at, decision_note, created_at, updated_at)
     VALUES ('Test Account', 'qwerty@mailbox.test', 'None', ARRAY['xprism'], 'just looking around', 'DECLINED', 30, $1, now() - interval '3 days', 'No institution or use case given', now() - interval '4 days', now())`,
    [founder.id],
  );

  // ---- SuperAdmin mailbox: an enquiry with our reply and the customer's answer, a draft, a sent announcement
  const { rows: [enquiry] } = await db.query(
    `INSERT INTO contact_messages (name, email, institution, category, subject, message, status, handled_by, handled_at, created_at, updated_at)
     VALUES ('Prof. Kavita Sharma', 'kavita.sharma@university.test', 'State University College of Pharmacy', 'institutional', 'Site licence for 180 students',
             'We would like a quotation for a site licence covering XPRISM and aMaze for 180 students and 12 faculty. Our purchase committee meets on the 28th.', 'IN_PROGRESS', $1, now() - interval '20 hours', now() - interval '2 days', now()) RETURNING id`,
    [founder.id],
  );
  const { rows: [m1] } = await db.query(
    `INSERT INTO mail_messages (folder, thread_id, from_name, from_email, to_emails, subject, body, is_read, source, contact_message_id, created_at, updated_at)
     VALUES ('INBOX', gen_random_uuid(), 'Prof. Kavita Sharma', 'kavita.sharma@university.test', ARRAY['support@altvivo.test'], 'Site licence for 180 students',
             'We would like a quotation for a site licence covering XPRISM and aMaze for 180 students and 12 faculty. Our purchase committee meets on the 28th.', true, 'contact', $1, now() - interval '2 days', now()) RETURNING id, thread_id`,
    [enquiry.id],
  );
  const { rows: [m2] } = await db.query(
    `INSERT INTO mail_messages (folder, thread_id, in_reply_to, from_name, from_email, to_emails, subject, body, is_read, source, contact_message_id, created_by, sent_at, created_at, updated_at)
     VALUES ('SENT', $1, $2, 'AltVivo', 'no-reply@altvivo.bio', ARRAY['kavita.sharma@university.test'], 'Re: Site licence for 180 students',
             E'Dear Prof. Sharma,\n\nThank you for writing. A proforma invoice for 192 seats is on its way to you; it is valid for 30 days and carries our bank details for NEFT / RTGS.\n\nYour department can also start with one month free while procurement is in progress.\n\nRegards,\nAltVivo', true, 'compose', $3, $4, now() - interval '20 hours', now() - interval '20 hours', now()) RETURNING id`,
    [m1.thread_id, m1.id, enquiry.id, founder.id],
  );
  await db.query(
    `INSERT INTO mail_messages (folder, thread_id, in_reply_to, from_name, from_email, to_emails, subject, body, source, is_starred, created_at, updated_at)
     VALUES ('INBOX', $1, $2, 'Prof. Kavita Sharma', 'kavita.sharma@university.test', ARRAY['support@altvivo.test'], 'RE: Site licence for 180 students',
             E'Thank you, received. Could the proforma mention our GSTIN 27AAAAA0000A1Z5? We will also take up the free month for the faculty.', 'inbound', true, now() - interval '3 hours', now())`,
    [m1.thread_id, m2.id],
  );
  const { rows: [support] } = await db.query(
    `INSERT INTO contact_messages (name, email, category, subject, message, app_id, created_at, updated_at)
     VALUES ('Sanjay Verma', 'sanjay.verma@college.test', 'support', 'Tail-flick latency not saving', 'In XPRISM the tail-flick readings disappear when I switch to the next animal. Chrome on Windows 11.', 'xprism', now() - interval '50 minutes', now()) RETURNING id`,
  );
  await db.query(
    `INSERT INTO mail_messages (folder, thread_id, from_name, from_email, to_emails, subject, body, source, contact_message_id, created_at, updated_at)
     VALUES ('INBOX', gen_random_uuid(), 'Sanjay Verma', 'sanjay.verma@college.test', ARRAY['support@altvivo.test'], 'Tail-flick latency not saving',
             'In XPRISM the tail-flick readings disappear when I switch to the next animal. Chrome on Windows 11.', 'contact', $1, now() - interval '50 minutes', now())`,
    [support.id],
  );
  await db.query(
    `INSERT INTO mail_messages (folder, thread_id, from_name, from_email, to_emails, subject, body, is_read, source, created_by, created_at, updated_at)
     VALUES ('DRAFT', gen_random_uuid(), 'AltVivo', 'no-reply@altvivo.bio', ARRAY['deans@pharmacy-council.test'], 'One month free for your pharmacology department',
             E'Dear colleague,\n\nEvery faculty member and student can now try XPRISM and aMaze free for one month.\n\n', true, 'compose', $1, now() - interval '5 hours', now())`,
    [founder.id],
  );
  await db.query(
    `INSERT INTO mail_messages (folder, thread_id, from_name, from_email, to_emails, cc_emails, subject, body, is_read, source, created_by, sent_at, created_at, updated_at)
     VALUES ('SENT', gen_random_uuid(), 'AltVivo', 'no-reply@altvivo.bio', ARRAY['advisory.board@altvivo.test'], ARRAY['founder@altvivo.test'], 'Advisory board: one month free launches this week',
             E'Dear members,\n\nFrom this week every new researcher can request one month of free access. Requests are reviewed by the admin team.\n\nRegards,\nFounder', true, 'compose', $1, now() - interval '4 days', now() - interval '4 days', now())`,
    [founder.id],
  );
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
