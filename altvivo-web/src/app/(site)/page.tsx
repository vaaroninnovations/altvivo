import { ArrowRight, BadgeCheck, Check, FileText, Fingerprint, Gift, Lock, ScrollText, ShieldCheck } from "lucide-react";
import { AppIcon, AppLogo, hasAppLogo } from "@/components/brand";
import { HeroReadout } from "@/components/hero-readout";
import { HeroVideos } from "@/components/hero-videos";
import { Reveal } from "@/components/motion";
import { TrialSteps } from "@/components/trial";
import { ButtonLink, Card, SectionHeading, StatusBadge } from "@/components/ui";
import { isAvailable } from "@/lib/catalog";
import { formatMoney } from "@/lib/money";
import { getCatalog, getPublicApps, getTrialOffer } from "@/lib/server/core";
import { trialLength } from "@/lib/trial";
import type { CatalogResponse, PublicApp } from "@/lib/types";

/** What each flagship product covers (copy for the product cards; status and version come from the registry). */
const PRODUCT: Record<string, { label: string; modules: string[]; audience: string }> = {
  xprism: {
    label: "Virtual pharmacology · Computer-Assisted Learning (CAL)",
    modules: [
      "Isolated tissue & organ bath: frog rectus, rat ileum, histamine bioassays, pA2 / Schild plot",
      "Rabbit eye: mydriatic and miotic drugs on pupil size",
      "Analgesia: Eddy's hot plate and tail-flick analgesiometer",
      "Anticonvulsant screening: MES and PTZ seizure models",
      "Behaviour: elevated plus maze, Y-maze, Morris water maze, forced swim, rota-rod",
      "Assignments, batches and marks sheets for college staff",
    ],
    audience: "Pharmacology teaching labs, B.Pharm / M.Pharm / MBBS practicals, and pre-study design aligned with CCSEA guidance.",
  },
  amaze: {
    label: "Neurobehavioural video tracking & assay analytics",
    modules: [
      "Elevated Plus Maze, Morris Water Maze, Open Field, Y-Maze",
      "Automatic arena and ROI detection",
      "Markerless tracking of rodent movement",
      "Trajectories, zone time, entries and speed",
      "Occupancy heatmaps and per-trial reports",
      "CSV / JSON exports for statistics",
    ],
    audience: "Behavioural pharmacology and neuroscience groups that want consistent, reproducible scoring of recorded trials.",
  },
};

function fromPrice(catalog: CatalogResponse | null, appId: string): string | null {
  if (!catalog) return null;
  const singles = catalog.plans.filter((p) => p.kind === "SINGLE_APP" && p.apps.includes(appId));
  if (!singles.length) return null;
  return `${formatMoney(Math.min(...singles.map((p) => p.prices[catalog.currency])), catalog.currency, { whole: true })}/year`;
}

function ProductCard({ app, catalog, index, trialDays }: { app: PublicApp; catalog: CatalogResponse | null; index: number; trialDays: number }) {
  const info = PRODUCT[app.appId];
  const price = fromPrice(catalog, app.appId);
  return (
    <Reveal delay={index * 0.08}>
      <Card className="glow flex h-full flex-col overflow-hidden">
        <div className="border-b border-line p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            {hasAppLogo(app.appId) ? (
              <AppLogo appId={app.appId} name={app.name} className="h-24 sm:h-28" />
            ) : (
              <div className="grid size-12 place-items-center rounded-xl border border-accent/30 bg-accent-soft text-accent-ink">
                <AppIcon iconKey={app.iconKey} className="size-6" />
              </div>
            )}
            <StatusBadge status={app.status} />
          </div>
          <p className="eyebrow mt-6">{info?.label ?? app.tagline}</p>
          <h3 className={hasAppLogo(app.appId) ? "sr-only" : "mt-2 font-serif text-4xl font-medium tracking-tight"}>{app.name}</h3>
          <p className="readout mt-1 text-xs text-subtle">{app.url.replace("https://", "")}</p>
          <p className="mt-4 text-sm leading-relaxed text-muted">{app.description}</p>
        </div>
        <ul className="grid flex-1 gap-2.5 p-6 sm:p-8">
          {(info?.modules ?? app.highlights).map((h) => (
            <li key={h} className="flex items-start gap-2.5 text-sm">
              <Check className="mt-0.5 size-4 shrink-0 text-live-ink" aria-hidden />
              <span>{h}</span>
            </li>
          ))}
        </ul>
        {info && <p className="mx-6 mb-6 rounded-xl bg-surface-2 px-4 py-3 text-xs leading-relaxed text-muted sm:mx-8">{info.audience}</p>}
        <div className="flex flex-wrap items-center gap-3 border-t border-line p-6 sm:px-8">
          <ButtonLink href="/free-month">
            Try {app.name} free <ArrowRight className="size-4" aria-hidden />
          </ButtonLink>
          <ButtonLink href={app.url} variant="outline">
            <Lock className="size-4" aria-hidden /> Launch
          </ButtonLink>
          <span className="readout ml-auto text-right text-sm text-muted">
            {trialDays} days free
            {price && (
              <a href={`/pricing?app=${app.appId}`} className="block text-xs text-subtle hover:text-accent-ink">
                then from {price}
              </a>
            )}
          </span>
        </div>
      </Card>
    </Reveal>
  );
}

const PILLARS = [
  {
    Icon: BadgeCheck,
    title: "Regulatory-aligned teaching",
    body: "Simulation-first practicals that support the 3Rs (Replace, Reduce, Refine), aligned with CCSEA guidance and the PCI curriculum.",
  },
  {
    Icon: Fingerprint,
    title: "One secure sign-in",
    body: "Sign in once at altvivo.bio and open every app you have access to. Two-factor authentication for administrators; instant sign-out everywhere.",
  },
  {
    Icon: ScrollText,
    title: "Tamper-evident audit trail",
    body: "Security, licence and billing events are written to a SHA-256 hash chain designed for GLP and 21 CFR Part 11 style review.",
  },
  {
    Icon: FileText,
    title: "Simple, GST-ready billing",
    body: "Clear yearly prices in Indian rupees, a GST tax invoice for every payment, and payment by UPI, cards or NetBanking.",
  },
];

export default async function HomePage() {
  const currency = "INR" as const;
  const [apps, catalog, offer] = await Promise.all([getPublicApps(), getCatalog(currency), getTrialOffer()]);
  const live = apps.filter(isAvailable);

  return (
    <>
      {/* ------------------------------------------------------------ hero */}
      <section className="relative overflow-hidden border-b border-line">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <div className="aurora aurora-a -left-40 -top-56 h-[38rem] w-[38rem] opacity-40" />
          <div className="aurora aurora-b -right-32 top-10 h-[34rem] w-[34rem] opacity-35" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-bg/80" />
        </div>
        <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pb-24 lg:pt-20">
          <Reveal>
            <h1 className="text-[2.6rem] leading-[1.04] text-balance sm:text-6xl lg:text-[4.1rem]">
              One Identity. <em className="brand-text pr-1 italic">Infinite Scientific Capabilities.</em>
            </h1>
            <p className="mt-5 font-serif text-xl italic text-fg/80 sm:text-2xl">From molecular discovery to translational validation.</p>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted text-pretty">
              One platform for preclinical education, training and in-silico research. Every tool sits in one place, so students and researchers can
              work with confidence and keep building their skills.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href="/free-month" size="lg">
                <Gift className="size-4" aria-hidden /> Start {trialLength(offer.days)} free
              </ButtonLink>
              <ButtonLink href="/pricing" size="lg" variant="outline">
                View plans <ArrowRight className="size-4" aria-hidden />
              </ButtonLink>
            </div>
            <p className="mt-4 text-sm text-subtle">
              {offer.days} days of full access. No card needed, nothing charged when it ends.
            </p>
            <dl className="mt-10 grid max-w-lg grid-cols-3 divide-x divide-line border-y border-line">
              {[
                ["40+", "CAL in-vivo simulations"],
                [String(live.length), "applications live"],
                [String(offer.days), "days free to start"],
              ].map(([v, k]) => (
                <div key={k} className="px-4 py-4 first:pl-0">
                  <dt className="sr-only">{k}</dt>
                  <dd className="font-serif text-3xl text-fg">{v}</dd>
                  <dd className="mt-0.5 text-xs text-subtle">{k}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
          <Reveal delay={0.15}>
            <HeroVideos fallback={<HeroReadout />} />
          </Reveal>
        </div>
        {/* Standards strip: what the platform is designed around. */}
        <div className="relative border-t border-line bg-surface/70 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-10 gap-y-3 px-4 py-5 sm:px-6 lg:justify-between">
            <span className="readout text-[11px] uppercase tracking-[0.16em] text-subtle">Designed around</span>
            {["The 3Rs: Replace · Reduce · Refine", "Preclinical research", "Pharmacology and toxicology"].map((t) => (
              <span key={t} className="flex items-center gap-2 font-serif text-[1.05rem] text-muted">
                <BadgeCheck className="size-4 text-accent-ink" aria-hidden strokeWidth={1.75} />
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- live products */}
      <section id="apps" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-20 sm:px-6">
        <SectionHeading eyebrow="Flagship products" title="Two applications, one AltVivo sign-in">
          Try both free for {trialLength(offer.days)}. Afterwards subscribe to the one you need: XPRISM for a class of up to 100 students, aMaze by the
          year or per video. A subscription activates the moment payment completes.
        </SectionHeading>
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {live.map((a, i) => (
            <ProductCard key={a.appId} app={a} catalog={catalog} index={i} trialDays={offer.days} />
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------- free month */}
      <section id="free-month" className="scroll-mt-20 px-4 pb-20 sm:px-6">
        <div className="glow mx-auto grid max-w-7xl gap-10 rounded-3xl border border-line bg-surface p-8 sm:p-12 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <div className="brand-gradient grid size-14 place-items-center rounded-2xl text-white">
              <Gift className="size-7" aria-hidden />
            </div>
            <p className="eyebrow mt-6">{offer.days} days · no card</p>
            <h2 className="mt-3 text-3xl sm:text-4xl">Your first month is on us</h2>
            <p className="mt-3 max-w-xl leading-relaxed text-muted">
              Run the organ bath with your own batch, or score your own maze videos, before anyone raises a purchase order. The free month is the full
              product: nothing is hidden, and your reports and exports stay in your account.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <ButtonLink href="/free-month" size="lg">
                Request your free month <ArrowRight className="size-4" aria-hidden />
              </ButtonLink>
              <ButtonLink href="/pricing" size="lg" variant="outline">
                See what it costs afterwards
              </ButtonLink>
            </div>
          </div>
          <TrialSteps days={offer.days} />
        </div>
      </section>

      {/* ---------------------------------------------------------- pillars */}
      <section className="border-y border-line bg-surface/70 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <SectionHeading eyebrow="Platform" title="Built for regulated teaching and research" />
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PILLARS.map(({ Icon, title, body }, i) => (
              <Reveal key={title} delay={i * 0.05}>
                <div className="h-full rounded-2xl border border-line bg-bg p-6 transition hover:-translate-y-0.5 hover:border-accent/40">
                  <Icon className="size-6 text-accent-ink" aria-hidden strokeWidth={1.75} />
                  <h3 className="mt-4 font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

    </>
  );
}
