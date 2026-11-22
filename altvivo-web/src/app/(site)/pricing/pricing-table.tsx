"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Check, GraduationCap, Mail, Minus, Users, Video } from "lucide-react";
import { AppLogo, hasAppLogo } from "@/components/brand";
import { CheckoutDialog, type Viewer } from "@/components/checkout";
import { Dialog } from "@/components/client";
import { ContactForm } from "@/components/contact";
import { Button, ButtonLink, Card, Pill, cx } from "@/components/ui";
import { BuyAnalysesDialog } from "@/components/usage";
import { formatMoney, perMonth } from "@/lib/money";
import { AMAZE_PER_VIDEO_PAISE, XPRISM_STUDENTS, XPRISM_TEACHERS } from "@/lib/pricing";
import type { AppStatus, CatalogPlan, CatalogResponse, PayPerUse } from "@/lib/types";

type AppLite = { appId: string; name: string; url: string; status: AppStatus; tagline: string };

/** The yearly plan of one application (XPRISM and aMaze are sold separately). */
const yearly = (plans: CatalogPlan[], appId: string) => plans.find((p) => p.kind === "SINGLE_APP" && p.interval === "YEAR" && p.apps.length === 1 && p.apps[0] === appId) ?? null;

function Price({ amount, unit, note }: { amount: string; unit: string; note: string }) {
  return (
    <div>
      <p className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="readout text-4xl font-semibold tracking-tight">{amount}</span>
        <span className="text-sm text-muted">{unit}</span>
      </p>
      <p className="mt-1 text-xs text-subtle">{note}</p>
    </div>
  );
}

function Features({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2.5 text-sm">
      {items.map((f) => (
        <li key={f} className="flex items-start gap-2.5">
          <Check className="mt-0.5 size-4 shrink-0 text-live-ink" aria-hidden />
          <span>{f}</span>
        </li>
      ))}
    </ul>
  );
}

function BuyButton({ plan, label, onBuy, variant = "primary" }: { plan: CatalogPlan; label: string; onBuy: () => void; variant?: "primary" | "outline" }) {
  return (
    <Button className="w-full" variant={variant} onClick={onBuy} disabled={!plan.purchasable}>
      {plan.purchasable ? (
        <>
          {label} <ArrowRight className="size-4" aria-hidden />
        </>
      ) : (
        "Online purchase opening soon"
      )}
    </Button>
  );
}

function ProductHead({ app, fallback }: { app: AppLite | undefined; fallback: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      {app && hasAppLogo(app.appId) ? <AppLogo appId={app.appId} name={app.name} className="h-16" /> : <h3 className="font-serif text-3xl">{app?.name ?? fallback}</h3>}
      <Pill tone="accent">Annual subscription</Pill>
    </div>
  );
}

export function PricingView({
  catalog,
  apps,
  viewer,
  preselectPlan,
  focusApp,
  trialDays,
}: {
  catalog: CatalogResponse;
  apps: AppLite[];
  viewer: Viewer & { name: string | null };
  preselectPlan: string | null;
  focusApp: string | null;
  trialDays: number;
}) {
  const { currency, plans } = catalog;
  const xprism = yearly(plans, "xprism");
  const amaze = yearly(plans, "amaze");
  const pre = plans.find((p) => p.planCode === preselectPlan) ?? null;
  const [checkout, setCheckout] = useState<CatalogPlan | null>(null);
  const [payPerUse, setPayPerUse] = useState(false);
  const app = (id: string) => apps.find((a) => a.appId === id);
  const gst = (p: CatalogPlan) => `+ ${p.gstRateBp / 100}% GST · about ${formatMoney(perMonth(p, currency), currency, { round: true })} a month`;
  // Price of one analysis: from core when it publishes one, else the built-in figure (then it is arranged by our team).
  const payg: PayPerUse = catalog.payPerUse?.find((p) => p.appId === "amaze") ?? { appId: "amaze", name: "aMaze", amountMinor: AMAZE_PER_VIDEO_PAISE, gstRateBp: amaze?.gstRateBp ?? 1800, purchasable: false };
  const paygOnline = !!catalog.payPerUse?.some((p) => p.appId === "amaze");
  const perVideo = formatMoney(payg.amountMinor, currency, { whole: true });

  // After sign-in the visitor comes back with ?plan=: resume the purchase.
  useEffect(() => {
    if (pre && viewer.signedIn && pre.purchasable) setCheckout(pre);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on load
  }, []);

  return (
    <>
      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        {/* ------------------------------------------------------- XPRISM */}
        {xprism && (
          <Card id="xprism" className={cx("flex scroll-mt-24 flex-col p-7 sm:p-9", focusApp === "xprism" && "ring-2 ring-accent")}>
            <ProductHead app={app("xprism")} fallback="XPRISM" />
            <p className="mt-5 text-sm leading-relaxed text-muted">{xprism.description}</p>
            <div className="mt-6">
              <Price amount={formatMoney(xprism.prices[currency], currency, { whole: true })} unit="per year, per account" note={gst(xprism)} />
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-line bg-surface-2/60 p-4">
                <dt className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-subtle">
                  <GraduationCap className="size-4 text-accent-ink" aria-hidden /> Students
                </dt>
                <dd className="readout mt-1 text-2xl font-semibold">{XPRISM_STUDENTS}</dd>
                <dd className="text-xs text-muted">per account</dd>
              </div>
              <div className="rounded-xl border border-line bg-surface-2/60 p-4">
                <dt className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-subtle">
                  <Users className="size-4 text-accent-ink" aria-hidden /> Teachers
                </dt>
                <dd className="readout mt-1 text-2xl font-semibold">{XPRISM_TEACHERS}</dd>
                <dd className="text-xs text-muted">per account</dd>
              </div>
            </dl>
            <div className="mt-6 flex-1">
              <Features items={xprism.features} />
            </div>
            <div className="mt-7">
              <BuyButton plan={xprism} label="Subscribe to XPRISM" onBuy={() => setCheckout(xprism)} />
            </div>
            <p className="mt-3 text-center text-xs text-subtle">More than {XPRISM_STUDENTS} students? Take a second account.</p>
          </Card>
        )}

        {/* -------------------------------------------------------- aMaze */}
        {amaze && (
          <Card id="amaze" className={cx("flex scroll-mt-24 flex-col p-7 sm:p-9", focusApp === "amaze" && "ring-2 ring-accent")}>
            <ProductHead app={app("amaze")} fallback="aMaze" />
            <p className="mt-5 text-sm leading-relaxed text-muted">Rodent behaviour video tracking. Choose a yearly subscription, or pay only for the videos you analyse.</p>

            <div className="mt-6 grid flex-1 gap-4">
              <div className="flex flex-col rounded-2xl border border-accent/40 bg-surface p-5">
                <p className="eyebrow">Option 1 · Annual</p>
                <div className="mt-3">
                  <Price amount={formatMoney(amaze.prices[currency], currency, { whole: true })} unit="per year" note={gst(amaze)} />
                </div>
                <div className="mt-4 flex-1">
                  <Features items={amaze.features} />
                </div>
                <div className="mt-5">
                  <BuyButton plan={amaze} label="Subscribe to aMaze" onBuy={() => setCheckout(amaze)} />
                </div>
              </div>

              <div className="flex flex-col rounded-2xl border border-line bg-surface p-5">
                <p className="eyebrow">Option 2 · Pay per use</p>
                <div className="mt-3">
                  <Price amount={perVideo} unit="per animal / video" note={`+ ${amaze.gstRateBp / 100}% GST · charged for each video tracked and analysed`} />
                </div>
                <div className="mt-4 flex-1">
                  <Features items={["No yearly commitment", "The same tracking, heatmaps and exports", "Suits a single study or a small batch of videos"]} />
                </div>
                <Button className="mt-5 w-full" variant="outline" onClick={() => setPayPerUse(true)}>
                  <Video className="size-4" aria-hidden /> {paygOnline ? "Buy analyses" : "Ask for pay per use"}
                </Button>
              </div>
            </div>
            <p className="mt-4 text-center text-xs text-subtle">
              Analysing more than {Math.ceil(amaze.prices[currency] / payg.amountMinor)} videos a year? The annual subscription costs less.
            </p>
          </Card>
        )}
      </div>
      <p className="mt-4 text-xs text-subtle">
        XPRISM and aMaze are separate products with separate subscriptions. Prepaid yearly terms, paid by UPI, cards or NetBanking via Razorpay. Renew early and
        the new term starts when the current one ends.
      </p>

      {/* ---------------------------------------------------- comparison */}
      <section className="mt-20" aria-labelledby="compare">
        <h2 id="compare" className="text-2xl font-semibold tracking-tight">
          Compare the options
        </h2>
        <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="p-4 font-medium text-muted" scope="col">
                  &nbsp;
                </th>
                {["Free month", "XPRISM", "aMaze annual", "aMaze pay per use"].map((h) => (
                  <th key={h} scope="col" className="p-4 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Application", "XPRISM + aMaze", "XPRISM", "aMaze", "aMaze"],
                  [
                    "Price (before GST)",
                    `Free for ${trialDays} days`,
                    xprism ? `${formatMoney(xprism.prices[currency], currency, { whole: true })} / year` : "-",
                    amaze ? `${formatMoney(amaze.prices[currency], currency, { whole: true })} / year` : "-",
                    `${perVideo} / video`,
                  ],
                  ["Who it covers", "1 person", `${XPRISM_STUDENTS} students + ${XPRISM_TEACHERS} teachers`, "1 account", "1 account"],
                  ["Usage", "Full access", "All experiments", "Unlimited videos", "Per animal / video"],
                  ["Reports and exports", true, true, true, true],
                  ["GST tax invoice", false, true, true, true],
                ] as [string, ...(string | boolean)[]][]
              ).map(([label, ...cells]) => (
                <tr key={label} className="border-b border-line last:border-0">
                  <th scope="row" className="p-4 text-left font-medium text-muted">
                    {label}
                  </th>
                  {cells.map((c, i) => (
                    <td key={i} className="p-4">
                      {typeof c === "string" ? c : c ? <Check className="size-4 text-live-ink" aria-label="Included" /> : <Minus className="size-4 text-subtle" aria-label="Not included" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ----------------------------------------------------------- FAQ */}
      <section className="mt-20 grid gap-10 lg:grid-cols-[1fr_2fr]" aria-labelledby="faq">
        <div>
          <h2 id="faq" className="text-2xl font-semibold tracking-tight">
            Questions
          </h2>
          <p className="mt-3 text-sm text-muted">
            Anything else? <a href="/contact" className="text-accent-ink underline">Contact us</a>.
          </p>
          <ButtonLink href="/register?trial=1" variant="outline" className="mt-5">
            <Mail className="size-4" aria-hidden /> Start one month free
          </ButtonLink>
        </div>
        <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {[
            [
              "Is there a free trial?",
              `Yes. Every new account gets ${trialDays} days of free, full access to XPRISM and aMaze, starting the moment you verify your email. No card is needed and nothing is charged when the month ends. There is no permanent free plan.`,
            ],
            ["Are XPRISM and aMaze sold together?", "No. They are separate products with separate subscriptions. Subscribe to the one you need, or to both."],
            ["What does one XPRISM account include?", `One yearly subscription covers up to ${XPRISM_STUDENTS} students and ${XPRISM_TEACHERS} teachers. A larger class needs a second account.`],
            ["How does aMaze pay per use work?", `You pay ${perVideo} plus GST for each animal or video that is tracked and analysed, with no yearly commitment. Buy the number of analyses you need from this page or from your workspace; each analysed video uses one, and unused ones stay on your account. If you analyse many videos, the annual subscription is cheaper.`],
            ["How is GST charged?", "Prices exclude GST. 18% GST is added at checkout and you receive a GST tax invoice. Add your GSTIN for a B2B invoice. All prices and invoices are in Indian rupees."],
            ["Which payment methods are accepted?", "UPI, debit and credit cards and NetBanking through Razorpay. Buying from outside India? Write to us and we will arrange it."],
            ["What happens when my subscription ends?", "Access to the application stops at the end of the paid year. Your account, invoices and exported files stay available; renew at any time to continue."],
            ["Can I get a refund?", "Yes, within 7 days of your first purchase of a plan: cancel for a full refund to the original payment method. Renewals follow the refund and cancellation policy in our Terms."],
          ].map(([q, a]) => (
            <details key={q} className="group p-5">
              <summary className="cursor-pointer list-none font-medium marker:hidden">
                <span className="flex items-center justify-between gap-4">
                  {q}
                  <span className="text-subtle transition group-open:rotate-45" aria-hidden>
                    +
                  </span>
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {checkout && <CheckoutDialog open onClose={() => setCheckout(null)} plan={checkout} seats={1} viewer={viewer} apps={apps} returnPath={`/pricing?plan=${checkout.planCode}`} />}
      {paygOnline && app("amaze") && (
        <BuyAnalysesDialog open={payPerUse} onClose={() => setPayPerUse(false)} offer={payg} app={app("amaze")!} viewer={viewer} returnPath="/pricing?app=amaze" />
      )}
      <Dialog open={payPerUse && !paygOnline} onClose={() => setPayPerUse(false)} title="aMaze pay per use" wide>
        <p className="mb-5 text-sm text-muted">
          Tell us roughly how many animals or videos you plan to analyse. We set up pay per use on your account and reply within one working day.
        </p>
        <ContactForm
          defaultCategory="sales"
          defaultName={viewer.name ?? ""}
          defaultEmail={viewer.email ?? ""}
          defaultSubject="aMaze pay per use"
          defaultMessage={`I would like to use aMaze on a pay-per-use basis (${perVideo} per animal / video, plus GST).\n\nNumber of animals / videos:\nAssay (open field, EPM, Y-maze, MWM):\nWhen I plan to start:`}
        />
      </Dialog>
    </>
  );
}
