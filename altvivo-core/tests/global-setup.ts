/**
 * Starts a throw-away PostgreSQL 16, provisions it exactly like
 * altvivo-infra/postgres/initdb (roles, default privileges), then runs the
 * production deploy (migrations + seed). Tests connect as the restricted
 * runtime role `core_app`, so privilege mistakes surface here.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    appDatabaseUrl: string;
    migratorDatabaseUrl: string;
  }
}

const PORT = 54000 + Math.floor(Math.random() * 900);
const PW = { mig: 'm'.repeat(40), app: 'a'.repeat(40), ro: 'r'.repeat(40) };
const url = (u: string, p: string, db: string) => `postgresql://${u}:${p}@127.0.0.1:${PORT}/${db}`;

let server: EmbeddedPostgres | undefined;
let dir: string | undefined;

export async function setup(project: TestProject) {
  dir = mkdtempSync(path.join(tmpdir(), 'altvivo-pg-'));
  server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port: PORT, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();

  const su = new pg.Client({ connectionString: url('postgres', 'postgres', 'postgres') });
  await su.connect();
  await su.query(`
    CREATE ROLE core_migrator LOGIN PASSWORD '${PW.mig}';
    CREATE ROLE core_app LOGIN NOINHERIT PASSWORD '${PW.app}';
    CREATE ROLE core_readonly LOGIN NOINHERIT PASSWORD '${PW.ro}';`);
  await su.query(`CREATE DATABASE db_core OWNER core_migrator ENCODING 'UTF8' TEMPLATE template0`);
  await su.query(`REVOKE ALL ON DATABASE db_core FROM PUBLIC; GRANT CONNECT, TEMPORARY ON DATABASE db_core TO core_app; GRANT CONNECT ON DATABASE db_core TO core_readonly;`);
  await su.end();
  const su2 = new pg.Client({ connectionString: url('postgres', 'postgres', 'db_core') });
  await su2.connect();
  await su2.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS pg_trgm;
    REVOKE ALL ON SCHEMA public FROM PUBLIC;
    ALTER SCHEMA public OWNER TO core_migrator;
    GRANT USAGE ON SCHEMA public TO core_app, core_readonly;
    ALTER DEFAULT PRIVILEGES FOR ROLE core_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO core_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE core_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO core_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE core_migrator IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO core_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE core_migrator IN SCHEMA public GRANT SELECT ON TABLES TO core_readonly;`);
  await su2.end();

  const migratorUrl = url('core_migrator', PW.mig, 'db_core');
  const r = spawnSync(process.execPath, ['db/scripts/deploy.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, DATABASE_URL: migratorUrl, AUDIT_CHAIN_GENESIS: 'ab'.repeat(32) },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`db:deploy failed\n${r.stdout}\n${r.stderr}`);

  project.provide('appDatabaseUrl', url('core_app', PW.app, 'db_core'));
  project.provide('migratorDatabaseUrl', migratorUrl);
}

export async function teardown() {
  await server?.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
}
