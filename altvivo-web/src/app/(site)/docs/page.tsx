import type { Metadata } from "next";
import { BookOpen, CreditCard, FlaskConical, GraduationCap, KeyRound, LifeBuoy, Microscope, Rocket, ScanEye, ShieldCheck, type LucideIcon } from "lucide-react";
import { ButtonLink, Card, SectionHeading } from "@/components/ui";
import { legalInfo } from "@/lib/legal";
import { getTrialOffer } from "@/lib/server/core";

export const metadata: Metadata = {
  title: "Documentation",
  description: "How to use AltVivo: step-by-step guides for students, faculty and researchers, and principal investigators, plus XPRISM, aMaze, billing and security.",
};

interface Guide {
  id: string;
  Icon: LucideIcon;
  title: string;
  intro: string;
  steps: [string, string][];
  tips?: string[];
}

const guides = (days: number, support: string): { group: string; items: Guide[] }[] => [
  {
    group: "Start here",
    items: [
      {
        id: "getting-started",
        Icon: Rocket,
        title: "Getting started (everyone)",
        intro: "From first visit to your first experiment. It takes a few minutes plus the time we need to approve your free month.",
        steps: [
          ["Request your free month", `Open "One month free" from the banner at the top of the site and fill in the short form. No card is needed.`],
          ["Wait for our email", "A person on our team reads each request, usually within one working day, and replies to the address you gave."],
          ["Create your account", "Use the link in the approval email, or choose Sign in, then Create an account. Register with the same email address you used in the request."],
          ["Verify your email", `Open the verification link we send you. Your ${days} days start at that moment.`],
          ["Open an application", "Go to your Workspace. Each application you can use shows a Launch button."],
        ],
        tips: ["Already have an account? Sign in first, then send the request: the free month is added to that account as soon as it is approved.", "You sign in once at altvivo.bio and stay signed in across XPRISM and aMaze."],
      },
    ],
  },
  {
    group: "Guides by role",
    items: [
      {
        id: "students",
        Icon: GraduationCap,
        title: "Students",
        intro: "For B.Pharm, M.Pharm, MBBS and life-science students doing practicals or preparing for exams.",
        steps: [
          ["Create your account", "Register with the email address your teacher has on record, so you can be added to your class in XPRISM."],
          ["Trying it on your own? Ask for a free month", `Any student can request ${days} days free and choose "Student" as the role.`],
          ["Launch XPRISM from your Workspace", "Pick an experiment, read the aim and procedure, then run it. You can repeat an experiment as often as you like."],
          ["Record and submit", "Enter your readings, let XPRISM plot the result, and submit the experiment if your teacher has set it as an assignment."],
          ["Keep your reports", "Export the report for your practical record. Files you save appear under Research vault in your Workspace."],
        ],
        tips: ["Your account is personal. Do not share your password with classmates; each student needs their own account.", "If XPRISM says your college account is not active, ask your teacher to add you to the batch."],
      },
      {
        id: "faculty",
        Icon: FlaskConical,
        title: "Faculty and researchers",
        intro: "For teaching staff running practical classes and for scientists analysing behaviour videos.",
        steps: [
          ["Try it with your own class or data", `Request the free month and choose both applications. You get the full product for ${days} days.`],
          ["Teaching with XPRISM", "Create batches, set experiments as assignments and review submissions. Marks sheets can be exported for your records."],
          ["Analysing with aMaze", "Create a project, choose the assay (open field, elevated plus maze, Y-maze or Morris water maze), add your video and confirm the arena and zones that aMaze detects."],
          ["Read the results", "aMaze gives the track, time in each zone, entries, distance and speed, with an occupancy heatmap for each trial."],
          ["Export", "Download results as CSV or JSON for your statistics software, and save reports to the vault."],
        ],
        tips: ["Check the detected arena before you run a batch of videos: a correct arena is what makes the numbers comparable between trials.", "After the free month, XPRISM and aMaze are separate yearly subscriptions. One XPRISM account covers up to 100 students and 4 teachers."],
      },
      {
        id: "pi",
        Icon: Microscope,
        title: "Principal investigators and lab heads",
        intro: "For people responsible for a group and its budget.",
        steps: [
          ["Evaluate first", "Use your own free month, and ask each member of the group to request theirs, so everyone can judge the fit."],
          ["Choose what to buy", "XPRISM: one yearly subscription per account of up to 100 students and 4 teachers. aMaze: a yearly subscription with unlimited videos, or pay per use for each animal or video analysed."],
          ["Subscribe", "Open Pricing, choose the product, enter your billing details (add your GSTIN for a B2B invoice) and pay. Access opens as soon as payment completes."],
          ["Keep your paperwork", "Tax invoices and payment history are under Billing in your Workspace, as PDFs."],
          ["Renew in time", "We email a reminder before a term ends. If you renew early, the new term starts when the current one ends."],
        ],
        tips: ["For a few videos, aMaze pay per use costs less; for regular work the yearly subscription does. A class of more than 100 students needs a second XPRISM account."],
      },
    ],
  },
  {
    group: "The applications",
    items: [
      {
        id: "xprism",
        Icon: BookOpen,
        title: "XPRISM: virtual pharmacology laboratory",
        intro: "More than 40 simulated in-vivo and isolated-tissue experiments for computer-assisted learning.",
        steps: [
          ["Choose an experiment", "Isolated tissue and organ bath (frog rectus, rat ileum, histamine bioassays, pA2), rabbit eye, analgesia (hot plate, tail flick), anticonvulsant screening (MES, PTZ) and behaviour models."],
          ["Set it up", "Select the preparation, drug and doses as you would at the bench."],
          ["Run and observe", "Administer the dose and watch the response. Repeat with other doses to build the series."],
          ["Analyse", "XPRISM plots the readings, for example a dose-response curve, and helps you work out the result."],
          ["Report", "Save or export the experiment report."],
        ],
      },
      {
        id: "amaze",
        Icon: ScanEye,
        title: "aMaze: behaviour video tracking",
        intro: "Markerless tracking of rodents in standard mazes, with heatmaps and exportable measurements.",
        steps: [
          ["Create a project", "Name it and choose the assay: open field, elevated plus maze, Y-maze or Morris water maze."],
          ["Add a video", "Use a steady, top-down recording with even lighting. One animal per arena."],
          ["Confirm the arena", "aMaze finds the arena and its zones automatically. Adjust them if needed, then start tracking."],
          ["Review", "Check the path overlay, then read zone time, entries, distance and speed."],
          ["Export", "Download the heatmap and the per-trial data as CSV or JSON."],
        ],
        tips: ["Projects and settings are kept in your browser on the device you used, so continue a project on the same computer."],
      },
    ],
  },
  {
    group: "Your account",
    items: [
      {
        id: "billing",
        Icon: CreditCard,
        title: "Plans, payment and invoices",
        intro: "What happens after the free month.",
        steps: [
          ["When the free month ends", "The applications lock. Nothing is charged, and your account, reports and exports are kept."],
          ["Choose a plan", "XPRISM yearly; aMaze yearly or pay per use. Prices are on the Pricing page and exclude GST."],
          ["aMaze pay per use", "Buy the number of analyses you need (one per animal or video) on the Pricing page or with Pay per use in your workspace. aMaze opens while you have analyses left; each analysed video uses one."],
          ["Pay", "By UPI, cards or NetBanking, in Indian rupees."],
          ["Invoices", "Every payment produces a tax invoice PDF under Billing."],
          ["Refunds", "A first purchase can be cancelled within 7 days for a full refund. See the Terms for the full policy."],
        ],
      },
      {
        id: "security",
        Icon: ShieldCheck,
        title: "Sign-in and security",
        intro: "Keeping your account yours.",
        steps: [
          ["Sign in", "Use your email and password, or Google or ORCID."],
          ["Forgot your password", "Choose Forgot password on the sign-in page. The link we email you is valid for one hour."],
          ["Turn on two-factor authentication", "Under Security, scan the code with an authenticator app and store your recovery codes somewhere safe."],
          ["Check your sessions", "Security lists the devices that are signed in. You can sign out any of them, or all at once."],
        ],
      },
    ],
  },
];

const WHO: Record<string, string> = {
  students: "I am a student",
  faculty: "I teach or do research",
  pi: "I lead a lab or group",
};

export default async function DocsPage() {
  const [offer, L] = [await getTrialOffer(), legalInfo()];
  const groups = guides(offer.days, L.salesEmail);
  return (
    <>
      <section className="border-b border-line">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20">
          <SectionHeading eyebrow="Documentation" title="How to use AltVivo">
            Short, step-by-step guides. Start with the one written for you, then look at the application you will use.
          </SectionHeading>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {groups[1]!.items.map(({ id, Icon, title, intro }) => (
              <a key={id} href={`#${id}`} className="group rounded-2xl border border-line bg-surface p-5 transition hover:-translate-y-0.5 hover:border-accent/50">
                <Icon className="size-6 text-accent-ink" aria-hidden strokeWidth={1.75} />
                <p className="mt-4 font-semibold">{WHO[id] ?? title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{intro}</p>
              </a>
            ))}
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label="Documentation contents" className="lg:sticky lg:top-24 lg:h-fit">
          {groups.map((g) => (
            <div key={g.group} className="mb-6">
              <p className="eyebrow">{g.group}</p>
              <ul className="mt-3 space-y-1 text-sm">
                {g.items.map((i) => (
                  <li key={i.id}>
                    <a href={`#${i.id}`} className="block rounded-lg px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-fg">
                      {i.title.split(":")[0]!.replace(" (everyone)", "")}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="min-w-0 space-y-14">
          {groups.map((g) => (
            <section key={g.group} aria-label={g.group} className="space-y-8">
              {g.items.map(({ id, Icon, title, intro, steps, tips }) => (
                <article key={id} id={id} className="scroll-mt-24">
                  <Card className="p-6 sm:p-8">
                    <div className="flex items-start gap-4">
                      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink">
                        <Icon className="size-5" aria-hidden strokeWidth={1.75} />
                      </span>
                      <div>
                        <h2 className="text-2xl">{title}</h2>
                        <p className="mt-1 text-sm leading-relaxed text-muted">{intro}</p>
                      </div>
                    </div>
                    <ol className="mt-6 space-y-4">
                      {steps.map(([head, body], n) => (
                        <li key={head} className="flex gap-4">
                          <span className="readout grid size-7 shrink-0 place-items-center rounded-full border border-line-strong text-xs font-semibold text-accent-ink">{n + 1}</span>
                          <div>
                            <p className="font-medium">{head}</p>
                            <p className="mt-0.5 text-sm leading-relaxed text-muted">{body}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                    {tips && (
                      <ul className="mt-6 space-y-2 rounded-xl bg-surface-2 px-5 py-4 text-sm text-muted">
                        {tips.map((t) => (
                          <li key={t} className="flex gap-2.5">
                            <KeyRound className="mt-0.5 size-4 shrink-0 text-accent-ink" aria-hidden />
                            <span>{t}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </article>
              ))}
            </section>
          ))}

          <Card className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:p-8">
            <LifeBuoy className="size-8 shrink-0 text-accent-ink" aria-hidden strokeWidth={1.5} />
            <div className="flex-1">
              <h2 className="text-xl">Still stuck?</h2>
              <p className="mt-1 text-sm text-muted">
                Write to <a href={`mailto:${L.supportEmail}`} className="text-accent-ink underline">{L.supportEmail}</a> and tell us what you were doing. We reply within one working day.
              </p>
            </div>
            <ButtonLink href="/contact?topic=support" variant="outline">
              Contact support
            </ButtonLink>
          </Card>
        </div>
      </div>
    </>
  );
}
