"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Building2, Calculator, Check, FileDown, Mail, Minus, Sparkles } from "lucide-react";
import { BillingProfileForm, CheckoutDialog, type Viewer } from "@/components/checkout";
import { Dialog } from "@/components/client";
import { ContactForm } from "@/components/contact";
import { Alert, Button, ButtonLink, Card, Pill, cx } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatMoney, gstEstimate, perMonth, planPrice } from "@/lib/money";
import type { AppStatus, BillingProfile, CatalogPlan, CatalogResponse, Currency, InvoiceSummary } from "@/lib/types";

type AppLite = { appId: string; name: string; url: string; status: AppStatus; tagline: string };
type Interval = "MONTH" | "YEAR";

const appNames = (plan: CatalogPlan, apps: AppLite[]) => plan.apps.map((id) => apps.find((a) => a.appId === id)?.name ?? id);

function PriceTag({ plan, currency, label }: { plan: CatalogPlan; currency: Currency; label?: string }) {
  const annual = plan.interval === "YEAR";
  return (
    <div>
      <p className="flex items-baseline gap-1.5">
        <span className="readout text-4xl font-semibold tracking-tight">{formatMoney(plan.prices[currency], currency, { whole: true })}</span>
        <span className="text-sm text-muted">{label ?? (annual ? "/ year" : "/ month")}</span>
      </p>
      <p className="mt-1 text-xs text-subtle">
        {annual ? `≈ ${formatMoney(perMonth(plan, currency), currency, { round: true })} per month, billed yearly` : "Billed monthly, prepaid"}
        {currency === "INR" ? ` · + ${plan.gstRateBp / 100}% GST` : " · no tax for exports"}
      </p>
    </div>
  );
}

function PlanCard({
  plan,
  currency,
  apps,
  onBuy,
  badge,
  focus,
  savings,
}: {
  plan: CatalogPlan;
  currency: Currency;
  apps: AppLite[];
  onBuy: () => void;
  badge?: string;
  focus?: boolean;
  savings?: string | null;
}) {
  return (
    <Card className={cx("relative flex flex-col p-7", plan.highlighted && "glow border-accent/50", focus && "ring-2 ring-accent")}>
      {badge && (
        <span className="readout absolute -top-3 left-7 brand-gradient rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white">
          {badge}
        </span>
      )}
      <p className="eyebrow">{plan.kind === "BUNDLE" ? "Dual-Suite bundle" : "Single-app licence"}</p>
      <h3 className="mt-2 text-xl font-semibold">{plan.name.replace(/ \(annual\)$/, "")}</h3>
      <p className="mt-1 min-h-10 text-sm text-muted">{plan.description}</p>
      <div className="mt-5">
        <PriceTag plan={plan} currency={currency} />
        {savings && <p className="mt-2 text-xs font-medium text-live-ink">{savings}</p>}
      </div>
      <div className="mt-5 flex flex-wrap gap-1.5">
        {appNames(plan, apps).map((n) => (
          <Pill key={n} tone="accent">
            {n}
          </Pill>
        ))}
      </div>
      <ul className="mt-5 flex-1 space-y-2.5 text-sm">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5">
            <Check className="mt-0.5 size-4 shrink-0 text-live-ink" aria-hidden />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Button className="mt-7 w-full" variant={plan.highlighted ? "primary" : "outline"} onClick={onBuy} disabled={!plan.purchasable}>
        {plan.purchasable ? (
          <>
            Buy {plan.kind === "BUNDLE" ? "the bundle" : appNames(plan, apps)[0]} <ArrowRight className="size-4" aria-hidden />
          </>
        ) : (
          "Online purchase opening soon"
        )}
      </Button>
    </Card>
  );
}

// ------------------------------------------------------- proforma (PDF) --

function QuoteDialog({ open, onClose, plan, seats }: { open: boolean; onClose: () => void; plan: CatalogPlan; seats: number }) {
  const [step, setStep] = useState<"loading" | "profile" | "form" | "busy" | "done" | "error">("loading");
  const [profile, setProfile] = useState<BillingProfile | null>(null);
  const [po, setPo] = useState("");
  const [result, setResult] = useState<{ invoice: InvoiceSummary; pdf: { url: string; fileName: string } } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("loading");
    setResult(null);
    api<{ profile: BillingProfile | null }>("/v1/api/billing/profile?scope=organization")
      .then((r) => {
        setProfile(r.profile);
        setStep(r.profile ? "form" : "profile");
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Could not load the institution's billing details.");
        setStep("error");
      });
  }, [open]);

  async function generate() {
    setStep("busy");
    setError(null);
    try {
      const r = await api<{ invoice: InvoiceSummary; pdf: { url: string; fileName: string } }>("/v1/api/billing/quotes", {
        method: "POST",
        body: { planCode: plan.planCode, seats, ...(po.trim() ? { poNumber: po.trim() } : {}) },
      });
      setResult(r);
      setStep("done");
    } catch (err) {
      setError(
        err instanceof ApiError && (err.code === "INVOICING_NOT_CONFIGURED" || err.status === 503)
          ? "Proforma invoices are not available yet. Please request a quotation from our team instead."
          : err instanceof ApiError
            ? err.message
            : "Could not create the proforma. Please retry.",
      );
      setStep("error");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Proforma invoice · ${seats} seats`} wide>
      {step === "loading" && <p className="py-6 text-center text-sm text-muted">Loading institution details…</p>}
      {step === "profile" && (
        <>
          <p className="mb-5 text-sm text-muted">The proforma is addressed to your institution. Enter its legal name, address and GSTIN (if registered).</p>
          <BillingProfileForm
            scope="organization"
            initial={null}
            submitLabel="Save and continue"
            onSaved={(p) => {
              setProfile(p);
              setStep("form");
            }}
          />
        </>
      )}
      {(step === "form" || step === "busy") && profile && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Addressed to <strong className="text-fg">{profile.legalName}</strong>. The proforma is numbered, valid for 30 days and lists our bank details for
            NEFT / RTGS. A GST tax invoice is issued when payment is received.
          </p>
          <label className="block space-y-1.5" htmlFor="po">
            <span className="text-sm font-medium">Purchase order / indent number (optional)</span>
            <input id="po" className="field" maxLength={64} value={po} onChange={(e) => setPo(e.target.value)} placeholder="e.g. GCP/PO/2026/14" />
          </label>
          <Button onClick={generate} loading={step === "busy"} className="w-full">
            <FileDown className="size-4" aria-hidden /> Generate proforma PDF
          </Button>
        </div>
      )}
      {step === "done" && result && (
        <div className="space-y-4">
          <Alert tone="success" title={`Proforma ${result.invoice.number} created`}>
            Total {formatMoney(result.invoice.totalMinor, result.invoice.currency)} including GST, valid until{" "}
            {result.invoice.validUntil ? new Date(result.invoice.validUntil).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "-"}. A copy was emailed to
            the billing address.
          </Alert>
          <ButtonLink href={result.pdf.url} className="w-full" target="_blank" rel="noopener">
            <FileDown className="size-4" aria-hidden /> Download {result.pdf.fileName}
          </ButtonLink>
          <p className="text-xs text-subtle">The download link expires in a few minutes; the document stays available under Billing in your workspace.</p>
        </div>
      )}
      {step === "error" && (
        <div className="space-y-4">
          <Alert tone="danger">{error}</Alert>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------ main view --

export function PricingView({
  catalog,
  apps,
  viewer,
  preselectPlan,
  focusApp,
  initialSeats,
}: {
  catalog: CatalogResponse;
  apps: AppLite[];
  viewer: Viewer & { name: string | null };
  preselectPlan: string | null;
  focusApp: string | null;
  initialSeats: number | null;
}) {
  const { currency, plans } = catalog;
  const pre = plans.find((p) => p.planCode === preselectPlan) ?? null;
  const [interval, setTerm] = useState<Interval>(pre && pre.kind !== "SITE_LICENSE" ? pre.interval : "YEAR");
  const [checkout, setCheckout] = useState<{ plan: CatalogPlan; seats: number } | null>(null);
  const site = plans.find((p) => p.kind === "SITE_LICENSE") ?? null;
  const [seats, setSeats] = useState(Math.max(site?.minSeats ?? 1, initialSeats ?? site?.minSeats ?? 1));
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);

  const returnPath = (code: string) => `/pricing?currency=${currency}&plan=${code}`;
  const isOrgAdmin = viewer.hasOrg && (viewer.role === "INSTITUTE_ADMIN" || viewer.role === "SUPERADMIN");

  // After sign-in the visitor comes back with ?plan=: resume the purchase.
  useEffect(() => {
    if (pre && viewer.signedIn && pre.purchasable) setCheckout({ plan: pre, seats: pre.kind === "SITE_LICENSE" ? seats : 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on load
  }, []);

  const byInterval = plans.filter((p) => p.kind !== "SITE_LICENSE" && p.interval === interval);
  const singles = byInterval.filter((p) => p.kind === "SINGLE_APP");
  const bundle = byInterval.find((p) => p.kind === "BUNDLE") ?? null;
  const singlesTotal = singles.reduce((sum, p) => sum + p.prices[currency], 0);
  const bundleSaving = bundle && singlesTotal > 0 ? Math.round(((singlesTotal - bundle.prices[currency]) / singlesTotal) * 100) : 0;
  const annualSaving = useMemo(() => {
    const m = plans.find((p) => p.kind === "BUNDLE" && p.interval === "MONTH");
    const y = plans.find((p) => p.kind === "BUNDLE" && p.interval === "YEAR");
    if (!m || !y) return null;
    const months = Math.round((m.prices[currency] * 12 - y.prices[currency]) / m.prices[currency]);
    return months > 0 ? `${months} months free` : null;
  }, [plans, currency]);

  const siteQuote = site ? gstEstimate(planPrice(site, currency, seats), site.gstRateBp, currency) : null;
  const seatsValid = site ? seats >= site.minSeats && (site.maxSeats === null || seats <= site.maxSeats) : false;

  return (
    <>
      {/* ------------------------------------------------- interval toggle */}
      <div className="mt-12 flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-full border border-line bg-surface p-1">
          {(["MONTH", "YEAR"] as const).map((iv) => (
            <button
              key={iv}
              type="button"
              role="radio"
              aria-checked={interval === iv}
              onClick={() => setTerm(iv)}
              className={cx("rounded-full px-4 py-1.5 text-sm transition", interval === iv ? "brand-gradient text-white" : "text-muted hover:text-fg")}
            >
              {iv === "MONTH" ? "Monthly" : "Annual"}
            </button>
          ))}
        </div>
        {annualSaving && (
          <span className="inline-flex items-center gap-1.5 text-sm text-live-ink">
            <Sparkles className="size-4" aria-hidden /> Annual plans: {annualSaving}
          </span>
        )}
      </div>

      {/* ---------------------------------------------- individual & bundle */}
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {singles.map((p) => (
          <PlanCard key={p.planCode} plan={p} currency={currency} apps={apps} focus={!!focusApp && p.apps.includes(focusApp)} onBuy={() => setCheckout({ plan: p, seats: 1 })} />
        ))}
        {bundle && (
          <PlanCard
            plan={bundle}
            currency={currency}
            apps={apps}
            badge="Best value"
            savings={bundleSaving > 0 ? `Save ${bundleSaving}% versus buying both apps separately` : null}
            onBuy={() => setCheckout({ plan: bundle, seats: 1 })}
          />
        )}
      </div>
      <p className="mt-4 text-xs text-subtle">
        {currency === "INR"
          ? "Prepaid terms paid by UPI, cards or NetBanking via Razorpay. Renew early and the new term starts when the current one ends."
          : byInterval.some((p) => p.renews === "automatically")
            ? "Plans marked as renewing are charged automatically each period until you cancel; others are prepaid terms."
            : "Prepaid terms paid by card via Stripe. Renew early and the new term starts when the current one ends."}
      </p>

      {/* --------------------------------------------------- site licence */}
      {site && siteQuote && (
        <section id="institutional" className="mt-20 scroll-mt-24">
          <Card className="glow overflow-hidden">
            <div className="grid gap-0 lg:grid-cols-[1.1fr_1fr]">
              <div className="p-7 sm:p-10">
                <div className="grid size-12 place-items-center rounded-xl bg-accent-soft text-accent-ink">
                  <Building2 className="size-6" aria-hidden />
                </div>
                <p className="eyebrow mt-6">Institutional / college site licence</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight">{site.name}</h2>
                <p className="mt-3 max-w-xl leading-relaxed text-muted">{site.description}</p>
                <ul className="mt-6 grid gap-2.5 text-sm sm:grid-cols-2">
                  {site.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 size-4 shrink-0 text-live-ink" aria-hidden />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="border-t border-line bg-surface p-7 sm:p-10 lg:border-l lg:border-t-0">
                <p className="flex items-center gap-2 font-semibold">
                  <Calculator className="size-4 text-accent-ink" aria-hidden /> Price your licence
                </p>
                <label htmlFor="seats" className="mt-5 block text-sm text-muted">
                  Seats (minimum {site.minSeats})
                </label>
                <div className="mt-2 flex items-center gap-2">
                  <button type="button" aria-label="Fewer seats" className="grid size-10 place-items-center rounded-xl border border-line-strong hover:border-accent" onClick={() => setSeats((n) => Math.max(site.minSeats, n - 5))}>
                    <Minus className="size-4" aria-hidden />
                  </button>
                  <input
                    id="seats"
                    type="number"
                    inputMode="numeric"
                    min={site.minSeats}
                    max={site.maxSeats ?? 100000}
                    value={seats}
                    onChange={(e) => setSeats(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                    className="field readout w-32 text-center text-lg"
                    aria-invalid={!seatsValid}
                  />
                  <button type="button" aria-label="More seats" className="grid size-10 place-items-center rounded-xl border border-line-strong text-lg hover:border-accent" onClick={() => setSeats((n) => n + 5)}>
                    +
                  </button>
                </div>
                {!seatsValid && <p className="mt-2 text-xs text-danger">Site licences start at {site.minSeats} seats.</p>}
                <dl className="mt-6 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted">
                      {seats} seats × {formatMoney(site.prices[currency], currency)} / year
                    </dt>
                    <dd className="readout">{formatMoney(siteQuote.taxableMinor, currency)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">{currency === "INR" ? `GST ${site.gstRateBp / 100}%` : "Tax (zero-rated export)"}</dt>
                    <dd className="readout">{formatMoney(siteQuote.taxMinor, currency)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-line pt-3 text-base font-semibold">
                    <dt>Total per year</dt>
                    <dd className="readout">{formatMoney(siteQuote.totalMinor, currency)}</dd>
                  </div>
                </dl>
                <div className="mt-7 grid gap-3">
                  {isOrgAdmin ? (
                    <>
                      <Button onClick={() => setQuoteOpen(true)} disabled={!seatsValid || !site.quoteAvailable}>
                        <FileDown className="size-4" aria-hidden /> Download proforma invoice (PDF)
                      </Button>
                      <Button variant="outline" onClick={() => setCheckout({ plan: site, seats })} disabled={!seatsValid || !site.purchasable}>
                        Pay online now <ArrowRight className="size-4" aria-hidden />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button onClick={() => setContactOpen(true)} disabled={!seatsValid}>
                        <Mail className="size-4" aria-hidden /> Request a formal quotation
                      </Button>
                      <p className="text-xs leading-relaxed text-subtle">
                        Institution administrators can generate a numbered proforma PDF themselves after signing in.{" "}
                        {!viewer.signedIn && (
                          <a href={`/login?redirect=${encodeURIComponent(`/pricing?currency=${currency}&seats=${seats}#institutional`)}`} className="text-accent-ink underline">
                            Sign in
                          </a>
                        )}
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          </Card>
        </section>
      )}

      {/* ---------------------------------------------------- comparison */}
      <section className="mt-20" aria-labelledby="compare">
        <h2 id="compare" className="text-2xl font-semibold tracking-tight">
          Compare licences
        </h2>
        <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="p-4 font-medium text-muted" scope="col">
                  &nbsp;
                </th>
                {["Single-app", "Dual-Suite", "Site licence"].map((h) => (
                  <th key={h} scope="col" className="p-4 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Applications", "XPRISM or aMaze", "XPRISM + aMaze", "XPRISM + aMaze"],
                  ["Users", "1 named user", "1 named user", `From ${site?.minSeats ?? 25} seats`],
                  ["Billing", "Monthly or annual", "Monthly or annual", "Annual"],
                  ["GST tax invoice", true, true, true],
                  ["Proforma invoice for procurement", false, false, true],
                  ["Email-domain auto-join", false, false, true],
                  ["Administrator seat management", false, false, true],
                  ["Pay by NEFT / RTGS / PO", false, false, true],
                ] as [string, string | boolean, string | boolean, string | boolean][]
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
        </div>
        <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {[
            ["Is there a free plan or trial?", "No. XPRISM and aMaze are licensed products: access requires an active paid licence held by you or your institution. Monthly plans let you start small."],
            [
              "How is GST charged?",
              "Prices exclude GST. Customers in India pay 18% GST (CGST + SGST when billed in our state, IGST elsewhere) and receive a GST tax invoice. Add your GSTIN at checkout for a B2B invoice. Customers outside India are billed in USD as a zero-rated export of services.",
            ],
            ["Which payment methods are accepted?", "In India: UPI, debit and credit cards and NetBanking through Razorpay. Elsewhere: cards through Stripe. Institutions can also pay by NEFT, RTGS or cheque against a proforma invoice."],
            ["What happens when my licence ends?", "Access to the application stops at the end of the paid period. Your account, invoices and exported files stay available; renew at any time to continue."],
            ["Can I share my login?", "No. Single-app and Dual-Suite licences are for one named user. Departments should use a site licence, which gives each member their own account."],
            ["Can I get a refund?", "Yes, within 7 days of your first purchase of a plan: cancel for a full refund to the original payment method. Renewals and site licences follow the refund and cancellation policy in our Terms."],
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

      {checkout && (
        <CheckoutDialog
          open={!!checkout}
          onClose={() => setCheckout(null)}
          plan={checkout.plan}
          seats={checkout.seats}
          viewer={viewer}
          apps={apps}
          returnPath={returnPath(checkout.plan.planCode)}
        />
      )}
      {site && <QuoteDialog open={quoteOpen} onClose={() => setQuoteOpen(false)} plan={site} seats={seats} />}
      <Dialog open={contactOpen} onClose={() => setContactOpen(false)} title="Request a site-licence quotation" wide>
        <ContactForm
          defaultCategory="institutional"
          defaultName={viewer.name ?? ""}
          defaultEmail={viewer.email ?? ""}
          defaultSubject={`Site licence quotation: ${seats} seats`}
          defaultMessage={`We would like a formal quotation for an AltVivo site licence (XPRISM + aMaze) for ${seats} seats, 12 months.\n\nInstitution:\nDepartment:\nBilling address and GSTIN:\nPurchase-order process / deadline:`}
        />
      </Dialog>
    </>
  );
}
