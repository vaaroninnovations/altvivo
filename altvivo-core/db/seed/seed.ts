// =============================================================================
// AltVivo db_core seed - idempotent, run by `npm run db:deploy` after the
// migrations (and runnable alone: `node db/seed/seed.ts`).
// -----------------------------------------------------------------------------
//   * audit chain head (genesis) - created once, never changed
//   * app_registry: xprism + amaze LIVE; pharmadme, stat, phytonet, mira
//     COMING_SOON. Re-running refreshes catalogue copy but NEVER touches
//     status / version, which the SUPERADMIN switchboard owns.
//   * plans + plan_entitlements: created when missing. Prices and app lists
//     edited later in /admin are never overwritten.
//
// Advisory board members, organizations and users are not seeded: they are
// real people and institutions, entered through /admin (SUPERADMIN accounts
// via `npm run cli:create-superadmin`).
//
// Env: DATABASE_URL (core_migrator), AUDIT_CHAIN_GENESIS (64 hex characters).
// Plain TypeScript with erasable syntax only, run directly by Node >= 22.18.
// =============================================================================
import { Prisma, PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'node:url';

type AppSeed = {
  appId: string;
  name: string;
  tagline: string;
  description: string;
  status: 'LIVE' | 'COMING_SOON';
  version: string;
  requiresCredits: boolean;
  phase: number;
  sortOrder: number;
  iconKey: string;
  highlights: string[];
};

type PlanSeed = Omit<Prisma.PlanCreateInput, 'entitlements' | 'subscriptions' | 'payments' | 'invoiceLines'> & {
  apps: string[];
};

export type SeedResult = {
  genesisCreated: boolean;
  appsCreated: string[];
  appsRefreshed: string[];
  plansCreated: string[];
};

export const APPS: readonly AppSeed[] = [
  {
    appId: 'xprism',
    name: 'XPRISM',
    tagline: 'Virtual Pharmacology & CAL In-Vivo Rodent Simulation',
    description:
      'A virtual pharmacology laboratory with 40+ simulated experiments that replace live-animal demonstrations in teaching and pre-study design, aligned with CCSEA guidelines and the PCI curriculum.',
    status: 'LIVE',
    version: '1.0.0',
    requiresCredits: false,
    phase: 1,
    sortOrder: 10,
    iconKey: 'flask-conical',
    highlights: [
      '40+ virtual experiments',
      'Aligned with CCSEA guidelines & the PCI curriculum',
      'Isolated organ bath',
      'Ocular pupillometer',
      'MES / PTZ seizure models',
      'Thermal nociception (hot plate, tail flick)',
    ],
  },
  {
    appId: 'amaze',
    name: 'aMaze',
    tagline: 'Rodent Neurobehavioral Video Tracking & Heatmaps',
    description:
      'aMaze is a modern, high-precision rodent behavioral tracking and analysis suite for laboratory neuroscience and behavioral pharmacology. It combines computer vision tracking, customizable arena/zone geometry, real-time posture alignment, trial management, multi-paradigm analytics, and interactive data visualization with exportable reports.',
    status: 'LIVE',
    version: '1.0.0',
    requiresCredits: true, // sold per use as well: one credit = one animal / video analysed
    phase: 1,
    sortOrder: 20,
    iconKey: 'scan-eye',
    highlights: [
      'Automatic arena / ROI detection',
      'Markerless tracking',
      'Behavioural assay heatmaps',
      'Open field, EPM, Y-maze, MWM',
      'CSV / JSON export',
    ],
  },
  {
    appId: 'pharmadme',
    name: 'PharmADME',
    tagline: '3D Multi-Compartment Human PK/ADME Simulator',
    description:
      'Physiologically based multi-compartment simulation of absorption, distribution, metabolism and excretion in a 3D human model.',
    status: 'COMING_SOON',
    version: '0.0.0',
    requiresCredits: true,
    phase: 2,
    sortOrder: 30,
    iconKey: 'pill',
    highlights: ['Multi-compartment PBPK', '3D organ visualisation', 'Dose-regimen what-ifs'],
  },
  {
    appId: 'stat',
    name: "Stat 'O' Mate AI",
    tagline: 'Life Sciences Biostatistics Platform',
    description:
      'AI-guided test selection, assumption checks and publication-ready statistical reporting for preclinical and clinical datasets.',
    status: 'COMING_SOON',
    version: '0.0.0',
    requiresCredits: true,
    phase: 2,
    sortOrder: 40,
    iconKey: 'sigma',
    highlights: ['Guided test selection', 'Assumption diagnostics', 'Publication-ready tables & figures'],
  },
  {
    appId: 'phytonet',
    name: 'PhytoNet AI',
    tagline: 'Network Pharmacology & Molecular Docking',
    description:
      'From phytochemical to target network: compound-target-pathway graphs with integrated molecular docking.',
    status: 'COMING_SOON',
    version: '0.0.0',
    requiresCredits: true,
    phase: 2,
    sortOrder: 50,
    iconKey: 'leaf',
    highlights: ['Compound-target-pathway networks', 'Integrated molecular docking', 'Enrichment analysis'],
  },
  {
    appId: 'mira',
    name: 'MIRA',
    tagline: 'Automated Manuscript Screening & Reference Verification',
    description:
      'Screens manuscripts for reporting-guideline gaps and verifies every reference against bibliographic databases.',
    status: 'COMING_SOON',
    version: '0.0.0',
    requiresCredits: true,
    phase: 2,
    sortOrder: 60,
    iconKey: 'file-search',
    highlights: ['ARRIVE / CONSORT checklist screening', 'Reference existence & retraction checks', 'Citation formatting'],
  },
];

// Price list. Minor units (paise / cents), GST excluded (18 % is added at
// checkout). XPRISM and aMaze are sold separately as yearly subscriptions and
// are the only public plans; the monthly plans, the Dual-Suite bundle and the
// institutional site licence are kept (isPublic: false) for existing records
// and for licences a SUPERADMIN arranges by hand.
// SAC 997331: licensing services for the right to use computer software.
export const PLANS: readonly PlanSeed[] = [
  {
    planCode: 'xprism_monthly',
    name: 'XPRISM',
    description: 'Single-app licence for the XPRISM virtual pharmacology lab, billed monthly.',
    kind: 'SINGLE_APP',
    interval: 'MONTH',
    priceInrPaise: 1_49_900,
    priceUsdCents: 2_400,
    isPublic: false,
    sortOrder: 15,
    features: ['Full XPRISM access', 'All 40+ virtual experiments', 'Experiment reports & exports', 'Cancel any time'],
    apps: ['xprism'],
  },
  {
    planCode: 'xprism_annual',
    name: 'XPRISM',
    description: 'Annual subscription to the XPRISM virtual pharmacology laboratory for one account: up to 100 students and 4 teachers.',
    kind: 'SINGLE_APP',
    interval: 'YEAR',
    priceInrPaise: 20_00_000,
    priceUsdCents: 24_000,
    sortOrder: 10,
    features: ['Up to 100 students per account', 'Up to 4 teachers per account', 'All 40+ virtual experiments', 'Assignments, batches and marks sheets', 'Experiment reports & exports'],
    apps: ['xprism'],
  },
  {
    planCode: 'amaze_monthly',
    name: 'aMaze',
    description: 'Single-app licence for aMaze rodent behaviour video tracking, billed monthly.',
    kind: 'SINGLE_APP',
    interval: 'MONTH',
    priceInrPaise: 1_99_900,
    priceUsdCents: 2_900,
    isPublic: false,
    sortOrder: 25,
    features: ['Full aMaze access', 'Markerless tracking & heatmaps', 'CSV / JSON export', 'Cancel any time'],
    apps: ['amaze'],
  },
  {
    planCode: 'amaze_annual',
    name: 'aMaze',
    description: 'Annual subscription to aMaze rodent behaviour video tracking, with unlimited videos.',
    kind: 'SINGLE_APP',
    interval: 'YEAR',
    priceInrPaise: 15_00_000,
    priceUsdCents: 29_000,
    sortOrder: 20,
    features: ['Unlimited animals and videos for 12 months', 'Markerless tracking & heatmaps', 'Open field, EPM, Y-maze, MWM', 'CSV / JSON export'],
    apps: ['amaze'],
  },
  {
    planCode: 'suite_monthly',
    name: 'AltVivo Dual-Suite',
    description: 'XPRISM and aMaze together at a bundle discount, billed monthly.',
    kind: 'BUNDLE',
    interval: 'MONTH',
    priceInrPaise: 2_99_900,
    priceUsdCents: 4_500,
    isPublic: false,
    sortOrder: 30,
    features: ['Full XPRISM access', 'Full aMaze access', 'One login, one invoice', 'Save 14 % vs two single-app plans'],
    apps: ['xprism', 'amaze'],
  },
  {
    planCode: 'suite_annual',
    name: 'AltVivo Dual-Suite (annual)',
    description: 'XPRISM and aMaze together at a bundle discount, billed yearly.',
    kind: 'BUNDLE',
    interval: 'YEAR',
    priceInrPaise: 29_99_000,
    priceUsdCents: 45_000,
    isPublic: false,
    sortOrder: 31,
    features: ['Full XPRISM access', 'Full aMaze access', 'One login, one invoice', '2 months free vs monthly'],
    apps: ['xprism', 'amaze'],
  },
  {
    planCode: 'site_license_annual',
    name: 'Institutional Site Licence',
    description:
      'Department or college-wide access to XPRISM and aMaze, priced per seat per year, with e-mail domain whitelisting and a proforma invoice for procurement.',
    kind: 'SITE_LICENSE',
    pricingModel: 'PER_SEAT',
    interval: 'YEAR',
    priceInrPaise: 2_40_000,
    priceUsdCents: 6_000,
    minSeats: 25,
    maxSeats: null,
    isPublic: false,
    sortOrder: 40,
    features: [
      'XPRISM & aMaze for every seat',
      'Minimum 25 seats',
      'Institutional e-mail domain whitelisting',
      'Admin seat management',
      'PDF quotation / proforma invoice for purchase orders',
      'NEFT / RTGS / PO payment accepted',
    ],
    apps: ['xprism', 'amaze'],
  },
];

const GENESIS_RE = /^[0-9a-f]{64}$/;

export async function seed(prisma: PrismaClient, genesisHex: string): Promise<SeedResult> {
  const genesis = genesisHex.toLowerCase();
  if (!GENESIS_RE.test(genesis)) throw new Error('AUDIT_CHAIN_GENESIS must be 64 hex characters');

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT audit_set_context(NULL::uuid, NULL::inet, 'db:deploy seed', 'core', 'SYSTEM'::audit_actor_type)`;

      // ------------------------------------------------------- chain head ----
      const genesisCreated =
        (await tx.$executeRaw`
          INSERT INTO audit_chain_head (id, genesis_hash, last_id, last_hash)
          VALUES (1, ${genesis}, 0, ${genesis})
          ON CONFLICT (id) DO NOTHING`) === 1;
      const head = await tx.auditChainHead.findUnique({ where: { id: 1 } });
      if (!head) throw new Error('audit chain head missing after seed');
      if (head.genesisHash !== genesis) {
        throw new Error(
          'AUDIT_CHAIN_GENESIS does not match the genesis stored in audit_chain_head. ' +
            'The genesis is immutable; restore the original value in .env.',
        );
      }

      // ----------------------------------------------------- app registry ----
      const existingApps = new Set(
        (await tx.appRegistry.findMany({ select: { appId: true } })).map((a) => a.appId),
      );
      const appsCreated: string[] = [];
      const appsRefreshed: string[] = [];
      for (const app of APPS) {
        const catalogue = {
          name: app.name,
          tagline: app.tagline,
          description: app.description,
          subdomainUrl: `https://${app.appId}.altvivo.bio`,
          requiresCredits: app.requiresCredits,
          phase: app.phase,
          sortOrder: app.sortOrder,
          iconKey: app.iconKey,
          highlights: app.highlights,
        };
        if (existingApps.has(app.appId)) {
          // Status and version belong to the switchboard: never reset them.
          await tx.appRegistry.update({ where: { appId: app.appId }, data: catalogue });
          appsRefreshed.push(app.appId);
        } else {
          await tx.appRegistry.create({
            data: { appId: app.appId, status: app.status, version: app.version, ...catalogue },
          });
          appsCreated.push(app.appId);
        }
      }

      // ------------------------------------------------------------ plans ----
      const existingPlans = new Set(
        (await tx.plan.findMany({ select: { planCode: true } })).map((p) => p.planCode),
      );
      const plansCreated: string[] = [];
      for (const { apps, ...plan } of PLANS) {
        if (existingPlans.has(plan.planCode)) continue;
        await tx.plan.create({
          data: {
            ...plan,
            entitlements: { create: apps.map((appId) => ({ appId, accessLevel: 'FULL' as const })) },
          },
        });
        plansCreated.push(plan.planCode);
      }

      return { genesisCreated, appsCreated, appsRefreshed, plansCreated };
    },
    { timeout: 60_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

// ---------------------------------------------------------- standalone run ---
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  try {
    const r = await seed(prisma, process.env.AUDIT_CHAIN_GENESIS ?? '');
    console.log(
      `[db:seed] OK - genesis ${r.genesisCreated ? 'created' : 'unchanged'}; ` +
        `apps created [${r.appsCreated.join(', ')}], refreshed [${r.appsRefreshed.join(', ')}]; ` +
        `plans created [${r.plansCreated.join(', ')}]`,
    );
  } catch (err) {
    console.error(`[db:seed] ERROR: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
