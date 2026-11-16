import type { Metadata } from "next";
import {
  ArrowRight,
  Building2,
  Eye,
  FlaskConical,
  HeartHandshake,
  Mail,
  Repeat,
  Scale,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  UserRound,
  Users,
} from "lucide-react";
import { MemberCard } from "@/components/advisory";
import { AppLogo, hasAppLogo } from "@/components/brand";
import { Address } from "@/components/legal";
import { ButtonLink, Card, SectionHeading, StatusBadge } from "@/components/ui";
import { isAvailable } from "@/lib/catalog";
import { legalInfo } from "@/lib/legal";
import { getAdvisoryBoard, getPublicApps, getTrialOffer } from "@/lib/server/core";

export const metadata: Metadata = {
  title: "About us",
  description:
    "Aaron Innovations, the company behind AltVivo: who we are, what we aim for, what altvivo.bio offers and the Scientific Advisory Board that guides it.",
};
export const dynamic = "force-dynamic";

const VALUES = [
  {
    Icon: HeartHandshake,
    title: "Fewer animals, same learning",
    body: "Every experiment we simulate is one that does not need a live animal. We build around the 3Rs: Replace, Reduce, Refine.",
  },
  {
    Icon: FlaskConical,
    title: "Science first",
    body: "Models, expected responses and scoring follow published pharmacology and are reviewed by practising scientists.",
  },
  {
    Icon: ShieldCheck,
    title: "Records you can trust",
    body: "Sign-in, licences and billing are written to a tamper-evident audit trail, so a college can show what happened and when.",
  },
  {
    Icon: Scale,
    title: "Fair and plain",
    body: "One month free to try, clear prices afterwards, GST invoices for every purchase and no automatic charges after the free month.",
  },
];

const THREE_RS = [
  {
    Icon: Repeat,
    title: "Replacement",
    body: "Virtual laboratories stand in for live-animal demonstrations in teaching and pre-study design.",
  },
  {
    Icon: TrendingDown,
    title: "Reduction",
    body: "Consistent, automated scoring gets more from every study, so fewer animals are needed.",
  },
  {
    Icon: Sparkles,
    title: "Refinement",
    body: "Markerless video tracking measures behaviour without handling or marking the animal.",
  },
];

export default async function AboutPage() {
  const L = legalInfo();
  const [board, apps, offer] = await Promise.all([getAdvisoryBoard(), getPublicApps(), getTrialOffer()]);
  const live = apps.filter(isAvailable);

  return (
    <>
      {/* ------------------------------------------------------------ intro */}
      <section className="relative overflow-hidden border-b border-line">
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="aurora aurora-a -left-40 -top-56 h-[34rem] w-[34rem] opacity-30" />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20">
          <SectionHeading eyebrow="About us" title="We build software that makes advanced scientific tools affordable and accessible to everyone">
            At AltVivo, we provide a unified digital ecosystem dedicated to advancing research and education in pharmacology and the life sciences. Developed
            under {L.entity}, our platform bridges the gap between complex computational analysis and everyday academic learning.
          </SectionHeading>
          <nav aria-label="On this page" className="mt-8 flex flex-wrap gap-2 text-sm">
            {[
              ["#mission", "Our mission"],
              ["#company", "The company"],
              ["#founder", "Who started it"],
              ["#aim", "Aim and vision"],
              ["#altvivo", "About altvivo.bio"],
              ["#advisory-board", "Advisory Board"],
            ].map(([to, label]) => (
              <a
                key={to}
                href={to}
                className="rounded-full border border-line bg-surface px-4 py-1.5 text-muted transition hover:border-accent/50 hover:text-fg"
              >
                {label}
              </a>
            ))}
          </nav>
        </div>
      </section>

      {/* ---------------------------------------------------------- mission */}
      <section id="mission" className="scroll-mt-24 border-b border-line bg-surface/70">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:py-20">
          <div>
            <div className="flex items-center gap-3">
              <span className="rule-mark" aria-hidden />
              <p className="eyebrow">Our mission</p>
            </div>
            <h2 className="mt-4 text-3xl sm:text-4xl">One digital ecosystem for pharmacology and the life sciences</h2>
            <div className="mt-5 space-y-4 leading-relaxed text-muted">
              <p>
                A core pillar of our mission is championing the 3Rs (Replacement, Reduction, and Refinement) by providing robust digital alternatives to
                traditional animal testing. By bringing together a specialized suite of tools like virtual experimental laboratories and automated behavioral
                tracking, AltVivo empowers educators, students, and preclinical researchers to conduct high-quality, ethically compliant science with precision
                and compassion.
              </p>
            </div>
          </div>
          <Card className="h-fit p-6 sm:p-8">
            <p className="eyebrow">The 3Rs</p>
            <ul className="mt-5 space-y-5">
              {THREE_RS.map(({ Icon, title, body }) => (
                <li key={title} className="flex items-start gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div>
                    <h3 className="font-semibold">{title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </section>

      {/* ---------------------------------------------------------- company */}
      <section id="company" className="mx-auto grid max-w-7xl scroll-mt-24 gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:py-20">
        <div>
          <div className="flex items-center gap-3">
            <span className="rule-mark" aria-hidden />
            <p className="eyebrow">The company</p>
          </div>
          <h2 className="mt-4 text-3xl sm:text-4xl">{L.entity}</h2>
          <div className="mt-5 space-y-4 leading-relaxed text-muted">
            <p>
              {L.entity} is the company that designs, builds and runs AltVivo. We make digital tools for life-science education and preclinical research:
              virtual laboratories, video-analysis software and the account, licensing and billing system that ties them together.
            </p>
            <p>
              Our work starts from a simple problem. Pharmacology and behaviour practicals have long depended on animal experiments, which are costly, hard to
              repeat and increasingly restricted. Students still need to see a dose-response curve form, and researchers still need behaviour scored the same
              way every time. We build the software that makes both possible on a screen.
            </p>
            <p>
              We work with college faculty, researchers and animal-ethics committee members, and we sell directly to colleges, laboratories and individual
              researchers, with a GST tax invoice for every purchase.
            </p>
          </div>
        </div>
        <Card className="h-fit p-6 sm:p-8">
          <div className="grid size-12 place-items-center rounded-xl bg-accent-soft text-accent-ink">
            <Building2 className="size-6" aria-hidden />
          </div>
          <dl className="mt-6 space-y-4 text-sm">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-subtle">Company</dt>
              <dd className="mt-1 font-medium">{L.entity}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-subtle">Product</dt>
              <dd className="mt-1">{L.tradeName} · altvivo.bio</dd>
            </div>
            {L.address && (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-subtle">Registered address</dt>
                <dd className="mt-1 text-muted">
                  <Address value={L.address} />
                </dd>
              </div>
            )}
            {L.gstin && (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-subtle">GSTIN</dt>
                <dd className="readout mt-1">{L.gstin}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-subtle">Write to us</dt>
              <dd className="mt-1">
                <a href={`mailto:${L.supportEmail}`} className="inline-flex items-center gap-1.5 text-accent-ink hover:underline">
                  <Mail className="size-3.5" aria-hidden /> {L.supportEmail}
                </a>
              </dd>
            </div>
          </dl>
        </Card>
      </section>

      {/* ---------------------------------------------------------- founder */}
      <section id="founder" className="scroll-mt-24 border-y border-line bg-surface/70">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[auto_1fr] lg:items-start lg:gap-14 lg:py-20">
          {L.founderPhoto ? (
            <img
              src={L.founderPhoto}
              width={1200}
              height={1600}
              alt={`Portrait of ${L.founderName}`}
              loading="lazy"
              className="aspect-[4/5] w-52 rounded-3xl border border-line object-cover object-top shadow-sm sm:w-64 lg:w-72"
            />
          ) : (
            <div className="brand-gradient grid size-24 place-items-center rounded-3xl text-white">
              <UserRound className="size-11" aria-hidden strokeWidth={1.5} />
            </div>
          )}
          <div className="max-w-3xl">
            <p className="eyebrow">Who started it</p>
            <h2 className="mt-3 text-3xl sm:text-4xl">{L.founderName || "The person behind AltVivo"}</h2>
            {L.founderName && <p className="mt-1 text-accent-ink">{L.founderRole}</p>}
            <div className="mt-5 space-y-4 leading-relaxed text-muted">
              {L.founderBio ? (
                L.founderBio.split(/\n{2,}/).map((p) => <p key={p.slice(0, 24)}>{p}</p>)
              ) : (
                <>
                  <p>
                    AltVivo was started by the person who leads {L.entity} today: someone who saw, in teaching laboratories, how much of a practical class is
                    spent on handling animals and how little on understanding the result.
                  </p>
                  <p>
                    The idea was to give every student the experiment itself, as many times as they need it, and to give every researcher the same measurement
                    no matter who scores the video. That idea became XPRISM and aMaze, and then the single AltVivo account that opens both.
                  </p>
                </>
              )}
            </div>
            <p className="mt-6 border-l-2 border-accent/40 pl-4 font-serif text-xl italic leading-snug text-fg/85">
              One Identity. Infinite Scientific Capabilities.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- aim and vision */}
      <section id="aim" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-16 sm:px-6 lg:py-20">
        <SectionHeading eyebrow="Aim and vision" title="What we are working towards" />
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <Card className="glow p-7 sm:p-9">
            <Target className="size-7 text-accent-ink" aria-hidden strokeWidth={1.75} />
            <h3 className="mt-5 text-2xl">Our aim</h3>
            <p className="mt-3 leading-relaxed text-muted">
              Our primary aim is to democratize access to advanced scientific software in pharmacology and the life sciences. We build cost-effective,
              high-quality digital tools that break down financial and technical barriers for colleges, research groups, and individual learners. By providing
              accessible platforms for pharmacological research, we strive to elevate the standard of education and research everywhere. Concurrently, we aim
              to advance the 3Rs (Replacement, Reduction, and Refinement) by delivering robust digital alternatives that reduce reliance on traditional animal
              models.
            </p>
          </Card>
          <Card className="glow p-7 sm:p-9">
            <Eye className="size-7 text-accent-ink" aria-hidden strokeWidth={1.75} />
            <h3 className="mt-5 text-2xl">Our vision</h3>
            <p className="mt-3 leading-relaxed text-muted">
              Our vision is a future where life science education and preclinical research are universally accessible, technologically advanced, and ethically
              grounded. We envision a global academic community where financial constraints no longer limit scientific discovery or practical learning. By
              pioneering innovative in-silico and in-vitro solutions, we want to create a world where educators and researchers can conduct high-impact,
              compassionate science with absolute precision.
            </p>
          </Card>
        </div>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {VALUES.map(({ Icon, title, body }) => (
            <div key={title} className="rounded-2xl border border-line bg-surface p-6">
              <Icon className="size-6 text-accent-ink" aria-hidden strokeWidth={1.75} />
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------- about altvivo.bio */}
      <section id="altvivo" className="scroll-mt-24 border-y border-line bg-surface/70">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20">
          <SectionHeading eyebrow="About altvivo.bio" title="One place to sign in, every application behind it">
            altvivo.bio is the front door. You create one account, start with {offer.days} days free, and open each application from your workspace. XPRISM and
            aMaze are separate products: subscribe to the one you need, or to both.
          </SectionHeading>
          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            {live.map((a) => (
              <Card key={a.appId} className="flex flex-col p-6 sm:p-8">
                <div className="flex items-start justify-between gap-4">
                  {hasAppLogo(a.appId) ? <AppLogo appId={a.appId} name={a.name} className="h-20" /> : <h3 className="font-serif text-3xl">{a.name}</h3>}
                  <StatusBadge status={a.status} />
                </div>
                <p className="mt-5 font-medium text-accent-ink">{a.tagline}</p>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{a.description}</p>
                <a href={`/docs#${a.appId}`} className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-ink hover:underline">
                  How to use {a.name} <ArrowRight className="size-4" aria-hidden />
                </a>
              </Card>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/free-month">
              Start one month free <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
            <ButtonLink href="/pricing" variant="outline">
              See pricing
            </ButtonLink>
            <ButtonLink href="/docs" variant="outline">
              Read the documentation
            </ButtonLink>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------- advisory board */}
      <section id="advisory-board" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-16 sm:px-6 lg:py-20">
        <SectionHeading eyebrow="Scientific Advisory Board" title="The scientists who keep AltVivo honest">
          Our advisors review how experiments are simulated, how behaviour is scored and how AltVivo supports the 3Rs in teaching and research. They are
          independent of day-to-day operations and serve in an advisory capacity.
        </SectionHeading>
        {board.length > 0 ? (
          <>
            <p className="readout mt-6 text-sm text-subtle">{board.length === 1 ? "1 advisor" : `${board.length} advisors`}</p>
            <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {board.map((m) => (
                <MemberCard key={m.slug} member={m} />
              ))}
            </div>
          </>
        ) : (
          <div className="mt-10 max-w-xl rounded-2xl border border-line bg-surface p-10 text-center">
            <div className="mx-auto grid size-12 place-items-center rounded-xl bg-accent-soft text-accent-ink">
              <Users className="size-6" aria-hidden />
            </div>
            <h3 className="mt-5 text-xl font-semibold">Board members are being confirmed</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              We publish each advisor here once they have agreed to their profile. Researchers interested in advising AltVivo are welcome to write to us.
            </p>
            <ButtonLink href="/contact?topic=partnership" variant="outline" className="mt-6">
              <Mail className="size-4" aria-hidden /> Contact us
            </ButtonLink>
          </div>
        )}
        <div className="mt-12 grid gap-8 border-t border-line pt-10 md:grid-cols-3">
          {[
            ["Scientific validity", "Advisors review experiment models, expected responses and teaching notes against published pharmacology."],
            ["Ethics and the 3Rs", "Members with animal-ethics committee experience advise on where simulation can replace, reduce or refine animal use."],
            [
              "Independence",
              "Advisors receive complimentary access to the AltVivo applications to review them. The role gives no access to other users' accounts or data.",
            ],
          ].map(([title, body]) => (
            <div key={title}>
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
