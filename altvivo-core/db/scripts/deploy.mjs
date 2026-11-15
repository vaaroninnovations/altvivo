#!/usr/bin/env node
// =============================================================================
// npm run db:deploy  -  run by the altvivo-core-migrate container on every start
//   1. prisma migrate deploy   (as core_migrator; applies pending migrations)
//   2. db/seed/seed.ts         (idempotent; one serializable transaction;
//                               creates / checks the audit genesis)
//   3. appends a SYSTEM.DB_DEPLOY audit event
//   4. verifies the whole audit hash chain
// Env: DATABASE_URL (migrator), AUDIT_CHAIN_GENESIS (64 hex chars)
// =============================================================================
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(here, '..');
const require = createRequire(import.meta.url);

function fail(msg) {
  console.error(`[db:deploy] ERROR: ${msg}`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
const genesis = (process.env.AUDIT_CHAIN_GENESIS ?? '').toLowerCase();
if (!databaseUrl) fail('DATABASE_URL is not set');
if (!/^[0-9a-f]{64}$/.test(genesis)) fail('AUDIT_CHAIN_GENESIS must be 64 hex characters');

// 1. Migrations - invoke the Prisma CLI directly (no npx: read-only filesystem).
const prismaCli = require.resolve('prisma/build/index.js');
const migrate = spawnSync(
  process.execPath,
  [prismaCli, 'migrate', 'deploy', '--schema', path.join(dbDir, 'schema.prisma')],
  { stdio: 'inherit', env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' } },
);
if (migrate.status !== 0) fail(`prisma migrate deploy exited with ${migrate.status}`);

// 2. Seed (TypeScript, run natively by Node >= 22.18 type stripping).
const { seed } = await import(pathToFileURL(path.join(dbDir, 'seed', 'seed.ts')).href);
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
let seeded;
try {
  seeded = await seed(prisma, genesis);
} catch (err) {
  await prisma.$disconnect();
  fail(`seed: ${err.message}`);
}
await prisma.$disconnect();
console.log(
  `[db:deploy] seed - apps created [${seeded.appsCreated.join(', ')}], ` +
  `plans created [${seeded.plansCreated.join(', ')}]${seeded.genesisCreated ? ', audit genesis created' : ''}`,
);

// 3-4. Deploy audit event + chain verification.
const client = new pg.Client({ connectionString: databaseUrl, application_name: 'altvivo-db-deploy' });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT audit_set_context(NULL, NULL, 'db:deploy', 'core', 'SYSTEM')");
  const { rows: migrations } = await client.query(
    'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at',
  );
  await client.query(
    `INSERT INTO audit_logs (actor_type, app_id, event_type, resource_id, metadata)
     VALUES ('SYSTEM', 'core', 'SYSTEM.DB_DEPLOY', $1, $2)`,
    [
      migrations.at(-1)?.migration_name ?? 'none',
      JSON.stringify({
        migrations_applied: migrations.map((m) => m.migration_name),
        seed: { apps_created: seeded.appsCreated, plans_created: seeded.plansCreated },
      }),
    ],
  );
  await client.query('COMMIT');

  const { rows: [verify] } = await client.query(
    'SELECT ok, rows_checked, first_bad_id, reason FROM audit_verify_chain()',
  );
  if (!verify.ok) {
    throw new Error(`audit chain verification failed at id ${verify.first_bad_id}: ${verify.reason}`);
  }
  console.log(`[db:deploy] OK - ${migrations.length} migrations, audit chain verified (${verify.rows_checked} records)`);
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  fail(err.message);
} finally {
  await client.end();
}
