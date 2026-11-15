#!/usr/bin/env node
// =============================================================================
// npm run db:verify-audit [-- --from <id>] [-- --to <id>] [-- --json]
// Recomputes the audit_logs SHA-256 hash chain. Exit code 0 = intact,
// 2 = chain broken (tampering / corruption), 1 = could not run.
// Works with core_readonly credentials (EXECUTE on audit_verify_chain only).
// Schedule it (cron / systemd) and alert on non-zero exit.
// =============================================================================
import { parseArgs } from 'node:util';
import pg from 'pg';

const { values } = parseArgs({
  options: {
    from: { type: 'string' },
    to: { type: 'string' },
    json: { type: 'boolean', default: false },
  },
});

const toId = (v, name) => {
  if (v === undefined) return null;
  if (!/^\d+$/.test(v)) {
    console.error(`--${name} must be a positive integer`);
    process.exit(1);
  }
  return v;
};

const url = process.env.AUDIT_VERIFY_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Set AUDIT_VERIFY_DATABASE_URL or DATABASE_URL');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, application_name: 'altvivo-audit-verify' });
try {
  await client.connect();
  const started = Date.now();
  const { rows: [r] } = await client.query(
    'SELECT ok, rows_checked, first_bad_id, reason, head_id, head_hash FROM audit_verify_chain($1::bigint, $2::bigint)',
    [toId(values.from, 'from'), toId(values.to, 'to')],
  );
  const result = { ...r, rows_checked: Number(r.rows_checked), duration_ms: Date.now() - started };
  if (values.json) {
    console.log(JSON.stringify(result));
  } else if (r.ok) {
    console.log(`audit chain OK: ${result.rows_checked} records, head #${r.head_id} ${r.head_hash} (${result.duration_ms} ms)`);
  } else {
    console.error(`AUDIT CHAIN BROKEN at record #${r.first_bad_id}: ${r.reason}`);
  }
  process.exitCode = r.ok ? 0 : 2;
} catch (err) {
  console.error(`audit verification could not run: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
