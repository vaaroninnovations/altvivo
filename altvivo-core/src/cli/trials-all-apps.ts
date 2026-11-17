/**
 * One-off: give every free month all applications (run inside the core container):
 *   docker compose exec altvivo-core node dist/cli/trials-all-apps.js
 * Running free months get a licence for each open app they lack, ending with
 * the free month; pending and approved requests list every app. Safe to re-run.
 * Affected users see the change at their next token refresh (at most 15 minutes).
 */
import { PrismaClient } from '@prisma/client';
import { loadConfig } from '../config.js';
import { systemActor, withAudit } from '../lib/audit.js';
import { extendTrialsToAllApps } from '../services/trials.js';

const cfg = loadConfig();
const prisma = new PrismaClient({ datasourceUrl: cfg.DATABASE_URL });

try {
  const r = await withAudit(prisma, { ...systemActor(), userAgent: 'cli:trials-all-apps' }, (tx) => extendTrialsToAllApps(tx));
  console.log(`Free months updated: ${r.licences} licence(s) added for ${r.users.length} account(s); ${r.requests} waiting request(s) now list every app.`);
} finally {
  await prisma.$disconnect();
}
