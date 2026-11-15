#!/usr/bin/env node
// =============================================================================
// npm run db:test  -  database integrity + least-privilege test suite
//
//   ALTVIVO_ALLOW_DB_TESTS=1                (explicit opt-in)
//   TEST_MIGRATOR_URL=postgresql://core_migrator:...@host/db_core
//   TEST_APP_URL=postgresql://core_app:...@host/db_core
//   TEST_READONLY_URL=postgresql://core_readonly:...@host/db_core   (optional)
//
// All writes happen inside transactions that are rolled back. Use against a
// development or staging database that has been migrated + seeded.
// =============================================================================
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));

if (process.env.ALTVIVO_ALLOW_DB_TESTS !== '1') {
  console.error('Refusing to run: set ALTVIVO_ALLOW_DB_TESTS=1 (never against production).');
  process.exit(1);
}
for (const v of ['TEST_MIGRATOR_URL', 'TEST_APP_URL']) {
  if (!process.env[v]) {
    console.error(`${v} is required`);
    process.exit(1);
  }
}

let failures = 0;
const pass = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  failures += 1;
  console.error(`  ✗ ${msg}`);
};

async function withClient(url, name, fn) {
  const client = new pg.Client({ connectionString: url, application_name: `altvivo-db-test-${name}` });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// Runs `sql` inside a savepoint; expects one of the SQLSTATEs in `code`
// (string or array), or success when `code` is null.
async function expect(client, label, sql, params, code) {
  const accepted = code === null ? [] : [code].flat();
  await client.query('SAVEPOINT t');
  try {
    await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT t');
    if (code === null) pass(label);
    else fail(`${label}: expected SQLSTATE ${accepted.join('/')}, statement succeeded`);
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT t');
    if (accepted.includes(err.code)) pass(label);
    else fail(`${label}: ${err.code ?? ''} ${err.message}`);
  }
}

// --------------------------------------------------- 1. integrity (owner) ----
console.log('Integrity suite (core_migrator, rolled back):');
await withClient(process.env.TEST_MIGRATOR_URL, 'migrator', async (client) => {
  client.on('notice', (n) => {
    if (n.message.startsWith('PASS')) pass(n.message.slice(5));
  });
  const sql = await readFile(path.join(here, '..', 'tests', 'integrity.test.sql'), 'utf8');
  try {
    await client.query(sql);
  } catch (err) {
    fail(`integrity.test.sql: ${err.message}${err.where ? `\n      at ${err.where}` : ''}`);
    await client.query('ROLLBACK').catch(() => {});
  }
});

// ------------------------------------------------ 2. runtime role privileges --
const DENIED = '42501';
console.log('Privilege suite (core_app, rolled back):');
await withClient(process.env.TEST_APP_URL, 'app', async (c) => {
  await c.query('BEGIN');
  await expect(c, 'core_app can append audit records',
    "INSERT INTO audit_logs (event_type, metadata) VALUES ('TEST.APP_ROLE', '{}')", [], null);
  await expect(c, 'core_app cannot UPDATE audit_logs', "UPDATE audit_logs SET metadata = '{}'", [], DENIED);
  await expect(c, 'core_app cannot DELETE audit_logs', 'DELETE FROM audit_logs', [], DENIED);
  await expect(c, 'core_app cannot TRUNCATE audit_logs', 'TRUNCATE audit_logs', [], DENIED);
  await expect(c, 'core_app cannot move the chain head', 'UPDATE audit_chain_head SET last_id = last_id + 1', [], DENIED);
  await expect(c, 'core_app cannot use the audit id sequence', "SELECT nextval('audit_logs_id_seq')", [], DENIED);
  await expect(c, 'core_app cannot UPDATE credit_ledger', 'UPDATE credit_ledger SET delta = 1', [], DENIED);
  await expect(c, 'core_app cannot DELETE credit_ledger', 'DELETE FROM credit_ledger', [], DENIED);
  await expect(c, 'core_app cannot write credit_accounts directly', 'UPDATE credit_accounts SET balance = 1000000', [], DENIED);
  await expect(c, 'core_app cannot hard-delete vault files', 'DELETE FROM workspace_files', [], DENIED);
  await expect(c, 'core_app cannot DELETE billing_events', 'DELETE FROM billing_events', [], DENIED);
  await expect(c, 'core_app cannot read _prisma_migrations', 'SELECT 1 FROM _prisma_migrations LIMIT 1', [], DENIED);
  await expect(c, 'core_app cannot draw invoice numbers', "SELECT invoice_next_number('TAX_INVOICE', '2026-27')", [], DENIED);
  await expect(c, 'core_app cannot write invoice_series', "UPDATE invoice_series SET last_number = 1", [], DENIED);
  await expect(c, 'core_app cannot DELETE payments', 'DELETE FROM payments', [], DENIED);
  await expect(c, 'core_app cannot DELETE entitlements', 'DELETE FROM app_entitlements', [], DENIED);
  await expect(c, 'core_app cannot UPDATE consent_records', 'UPDATE consent_records SET marketing = true', [], DENIED);
  await expect(c, 'core_app cannot forge a subscription entitlement',
    `WITH u AS (INSERT INTO users (email, full_name, updated_at) VALUES ('forge@example.org', 'F', now()) RETURNING id),
          s AS (INSERT INTO subscriptions (user_id, provider, external_sub_id, plan_code, status, currency, unit_amount_minor, current_period_end, updated_at)
                SELECT id, 'RAZORPAY', 'sub_forge', 'amaze_monthly', 'ACTIVE', 'INR', 199900, now() + interval '1 month', now() FROM u RETURNING id)
     INSERT INTO app_entitlements (app_id, source, sub_id) SELECT 'xprism', 'SUBSCRIPTION', id FROM s`, [], DENIED);
  await expect(c, 'core_app can create, price and issue an invoice (definer numbering)',
    `WITH u AS (INSERT INTO users (email, full_name, updated_at) VALUES ('inv@example.org', 'Inv', now()) RETURNING id),
          i AS (INSERT INTO invoices (kind, user_id, currency, tax_treatment, seller_legal_name, seller_gstin, seller_address,
                                      seller_state_code, buyer_name, buyer_email, buyer_address, buyer_state_code, buyer_country, place_of_supply)
                SELECT 'TAX_INVOICE', id, 'INR', 'INTRA_STATE', 'Seller', '29AAACA1234B1ZE', 'Bengaluru', '29',
                       'Inv', 'inv@example.org', 'Mysuru', '29', 'IN', '29' FROM u RETURNING id)
     INSERT INTO invoice_lines (invoice_id, position, description, sac_code, quantity, unit_price_minor, gst_rate_bp)
     SELECT id, 1, 'XPRISM - 1 month', '997331', 1, 149900, 1800 FROM i`, [], null);
  await expect(c, 'core_app issue assigns AV number and totals',
    `DO $$ DECLARE n text; t bigint; BEGIN
       UPDATE invoices SET status = 'ISSUED' WHERE buyer_email = 'inv@example.org' RETURNING number, total_minor INTO n, t;
       IF n !~ '^AV/' OR t <> 176882 THEN RAISE EXCEPTION 'got % / %', n, t; END IF; END $$`, [], null);
  await expect(c, 'core_app can read revenue view', 'SELECT * FROM revenue_active_subscriptions', [], null);
  await expect(c, 'core_app cannot create tables', 'CREATE TABLE pwn (x int)', [], DENIED);
  await expect(c, 'core_app can verify the audit chain', 'SELECT * FROM audit_verify_chain()', [], null);
  await expect(c, 'core_app can resolve paid access',
    "SELECT * FROM user_access_claims('00000000-0000-4000-8000-000000000000')", [], null);
  await c.query('ROLLBACK');
});

if (process.env.TEST_READONLY_URL) {
  console.log('Privilege suite (core_readonly):');
  await withClient(process.env.TEST_READONLY_URL, 'readonly', async (c) => {
    await c.query('BEGIN');
    await expect(c, 'core_readonly cannot read users (password hashes)', 'SELECT 1 FROM users LIMIT 1', [], DENIED);
    await expect(c, 'core_readonly cannot read refresh_tokens', 'SELECT 1 FROM refresh_tokens LIMIT 1', [], DENIED);
    await expect(c, 'core_readonly cannot read billing_profiles', 'SELECT 1 FROM billing_profiles LIMIT 1', [], DENIED);
    await expect(c, 'core_readonly cannot read contact_messages', 'SELECT 1 FROM contact_messages LIMIT 1', [], DENIED);
    await expect(c, 'core_readonly can read the revenue view', 'SELECT 1 FROM revenue_active_subscriptions LIMIT 1', [], null);
    await expect(c, 'core_readonly can read users_directory', 'SELECT 1 FROM users_directory LIMIT 1', [], null);
    await expect(c, 'core_readonly can read audit_logs', 'SELECT 1 FROM audit_logs LIMIT 1', [], null);
    // Blocked twice over: read-only default transaction (25006) and no INSERT grant (42501).
    await expect(c, 'core_readonly cannot write', "INSERT INTO audit_logs (event_type) VALUES ('TEST.RO')", [], ['25006', DENIED]);
    await expect(c, 'core_readonly can verify the audit chain', 'SELECT * FROM audit_verify_chain()', [], null);
    await c.query('ROLLBACK');
    await c.query('BEGIN READ WRITE');
    await expect(c, 'core_readonly cannot write even in a read-write transaction',
      "INSERT INTO audit_logs (event_type) VALUES ('TEST.RO')", [], DENIED);
    await c.query('ROLLBACK');
  });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll database checks passed.');
