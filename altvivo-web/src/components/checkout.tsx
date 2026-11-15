"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, CreditCard, FileText, Lock, Rocket } from "lucide-react";
import { api, ApiError, fieldErrors } from "@/lib/api";
import { COUNTRIES, GST_STATES, formatMoney, gstEstimate, planPrice, validGstin } from "@/lib/money";
import type { ApiEntitlement, BillingProfile, CatalogPlan, CheckoutResponse, Currency, PublicApp } from "@/lib/types";
import { Dialog } from "./client";
import { Alert, Button, ButtonLink, Field, cx } from "./ui";

// ======================================================= billing profile ====

const EMPTY: BillingProfile = {
  legalName: "", gstin: null, email: "", phone: null, addressLine1: "", addressLine2: null, city: "", state: null, stateCode: null, postalCode: "", country: "IN",
};

/** GST bill-to details. Indian addresses need the GST state; a GSTIN is optional (B2B invoices). */
export function BillingProfileForm({
  scope,
  initial,
  defaultEmail,
  onSaved,
  submitLabel = "Save billing details",
  endpoint,
}: {
  scope: "personal" | "organization";
  /** Override the save URL (SuperAdmin edits an institution's profile). */
  endpoint?: string;
  initial: BillingProfile | null;
  defaultEmail?: string;
  onSaved: (p: BillingProfile) => void;
  submitLabel?: string;
}) {
  const [p, setP] = useState<BillingProfile>(initial ?? { ...EMPTY, email: defaultEmail ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const india = p.country === "IN";
  const set = <K extends keyof BillingProfile>(k: K, v: BillingProfile[K]) => setP((cur) => ({ ...cur, [k]: v }));

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (p.legalName.trim().length < 2) e.legalName = scope === "organization" ? "Enter the institution's legal name" : "Enter the name for the invoice";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) e.email = "Enter a valid email address";
    if (p.addressLine1.trim().length < 3) e.addressLine1 = "Enter the street address";
    if (p.city.trim().length < 2) e.city = "Enter the city";
    if (india) {
      if (!p.stateCode) e.stateCode = "Select the state (sets CGST/SGST or IGST)";
      if (!/^[1-9][0-9]{5}$/.test(p.postalCode)) e.postalCode = "Enter the 6-digit PIN code";
      if (p.gstin) {
        if (!validGstin(p.gstin)) e.gstin = "This GSTIN is not valid (check the 15 characters)";
        else if (p.stateCode && p.gstin.slice(0, 2) !== p.stateCode) e.gstin = "The GSTIN belongs to a different state";
      }
    } else if (p.postalCode.trim().length < 3) e.postalCode = "Enter the postal code";
    return e;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...p,
        gstin: india && p.gstin ? p.gstin : null,
        state: india ? (GST_STATES.find((s) => s.code === p.stateCode)?.name ?? null) : p.state || null,
        stateCode: india ? p.stateCode : null,
        phone: p.phone || null,
        addressLine2: p.addressLine2 || null,
      };
      const r = await api<{ profile: BillingProfile }>(endpoint ?? `/v1/api/billing/profile?scope=${scope}`, { method: "PUT", body });
      onSaved(r.profile);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(err instanceof ApiError ? err.message : "Could not save the billing details. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label={scope === "organization" ? "Institution legal name" : "Name on invoice"} id="bp-name" error={errors.legalName}>
            <input id="bp-name" className="field" value={p.legalName} onChange={(e) => set("legalName", e.target.value)} autoComplete="organization" aria-invalid={!!errors.legalName} />
          </Field>
        </div>
        <Field label="Billing email" id="bp-email" error={errors.email} hint="Invoices are emailed here">
          <input id="bp-email" type="email" className="field" value={p.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" aria-invalid={!!errors.email} />
        </Field>
        <Field label="Phone (optional)" id="bp-phone" error={errors.phone}>
          <input id="bp-phone" type="tel" className="field" value={p.phone ?? ""} onChange={(e) => set("phone", e.target.value)} autoComplete="tel" />
        </Field>
        <Field label="Country" id="bp-country">
          <select id="bp-country" className="field" value={p.country} onChange={(e) => setP((cur) => ({ ...cur, country: e.target.value, stateCode: null, gstin: null }))}>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        {india ? (
          <Field label="State (GST)" id="bp-state" error={errors.stateCode}>
            <select id="bp-state" className="field" value={p.stateCode ?? ""} onChange={(e) => set("stateCode", e.target.value || null)} aria-invalid={!!errors.stateCode}>
              <option value="">Select state</option>
              {GST_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="State / region (optional)" id="bp-region">
            <input id="bp-region" className="field" value={p.state ?? ""} onChange={(e) => set("state", e.target.value)} autoComplete="address-level1" />
          </Field>
        )}
        <div className="sm:col-span-2">
          <Field label="Address" id="bp-a1" error={errors.addressLine1}>
            <input id="bp-a1" className="field" value={p.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} autoComplete="address-line1" aria-invalid={!!errors.addressLine1} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <input aria-label="Address line 2" className="field" placeholder="Department, building (optional)" value={p.addressLine2 ?? ""} onChange={(e) => set("addressLine2", e.target.value)} autoComplete="address-line2" />
        </div>
        <Field label="City" id="bp-city" error={errors.city}>
          <input id="bp-city" className="field" value={p.city} onChange={(e) => set("city", e.target.value)} autoComplete="address-level2" aria-invalid={!!errors.city} />
        </Field>
        <Field label={india ? "PIN code" : "Postal code"} id="bp-pin" error={errors.postalCode}>
          <input id="bp-pin" className="field" inputMode={india ? "numeric" : "text"} value={p.postalCode} onChange={(e) => set("postalCode", e.target.value)} autoComplete="postal-code" aria-invalid={!!errors.postalCode} />
        </Field>
        {india && (
          <div className="sm:col-span-2">
            <Field label="GSTIN (optional, for a B2B tax invoice)" id="bp-gstin" error={errors.gstin} hint="Leave empty if you are not GST-registered">
              <input
                id="bp-gstin"
                className="field readout uppercase"
                maxLength={15}
                value={p.gstin ?? ""}
                onChange={(e) => set("gstin", e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "") || null)}
                aria-invalid={!!errors.gstin}
                placeholder="29ABCDE1234F1Z5"
              />
            </Field>
          </div>
        )}
      </div>
      <p className="text-xs text-subtle">
        {india
          ? "Indian addresses are billed in INR with GST (CGST + SGST in the seller's state, IGST elsewhere)."
          : "Addresses outside India are billed in USD as a zero-rated export of services."}
      </p>
      <Button type="submit" loading={busy} className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}

// ============================================================ Razorpay =====

interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}
interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", cb: (r: { error?: { description?: string } }) => void): void;
}
declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => RazorpayInstance;
  }
}

let razorpayLoader: Promise<void> | null = null;
function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  razorpayLoader ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      razorpayLoader = null;
      reject(new Error("Razorpay Checkout could not load"));
    };
    document.head.appendChild(s);
  });
  return razorpayLoader;
}

// ============================================================ checkout =====

export interface Viewer {
  signedIn: boolean;
  emailVerified: boolean;
  email: string | null;
  role: string | null;
  hasOrg: boolean;
}

type Step = "loading" | "signin" | "verify" | "not-admin" | "profile" | "review" | "paying" | "done" | "error";

const errorText = (err: unknown): string => {
  if (!(err instanceof ApiError)) return "Something went wrong. Please retry.";
  switch (err.code) {
    case "INVOICING_NOT_CONFIGURED":
    case "PROVIDER_UNAVAILABLE":
      return "Online payment is not open yet for this currency. Write to sales@altvivo.bio and we will invoice you directly.";
    case "ALREADY_SUBSCRIBED":
      return "This plan already renews automatically on your account. Manage it from Billing.";
    case "EMAIL_NOT_VERIFIED":
      return "Verify your email address first (check your inbox), then try again.";
    case "PAYMENT_NOT_CAPTURED":
      return "The payment did not complete. No licence was activated; you can try again.";
    default:
      return err.message;
  }
};

/**
 * Buy a plan: billing details -> GST total from the server -> Razorpay
 * (INR: UPI, cards, NetBanking) or Stripe (USD) -> licence active.
 */
export function CheckoutDialog({
  open,
  onClose,
  plan,
  seats = 1,
  viewer,
  apps,
  returnPath,
  onActivated,
}: {
  open: boolean;
  onClose: () => void;
  /** Called once the licence is active (Razorpay confirmation succeeded). */
  onActivated?: () => void;
  plan: CatalogPlan;
  seats?: number;
  viewer: Viewer;
  apps: Pick<PublicApp, "appId" | "name" | "url">[];
  returnPath: string;
}) {
  const site = plan.kind === "SITE_LICENSE";
  const scope = site ? "organization" : "personal";
  const [step, setStep] = useState<Step>("loading");
  const [profile, setProfile] = useState<BillingProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entitlements, setEntitlements] = useState<Record<string, ApiEntitlement> | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (!viewer.signedIn) return setStep("signin");
    if (!viewer.emailVerified) return setStep("verify");
    if (site && (!viewer.hasOrg || (viewer.role !== "INSTITUTE_ADMIN" && viewer.role !== "SUPERADMIN"))) return setStep("not-admin");
    setStep("loading");
    api<{ profile: BillingProfile | null }>(`/v1/api/billing/profile?scope=${scope}`)
      .then((r) => {
        setProfile(r.profile);
        setStep(r.profile ? "review" : "profile");
      })
      .catch((err) => {
        setError(errorText(err));
        setStep("error");
      });
  }, [open, viewer.signedIn, viewer.emailVerified, viewer.hasOrg, viewer.role, site, scope]);

  const currency: Currency = profile ? (profile.country === "IN" ? "INR" : "USD") : "INR";
  const quote = useMemo(() => gstEstimate(planPrice(plan, currency, seats), plan.gstRateBp, currency), [plan, currency, seats]);
  const unlocked = apps.filter((a) => plan.apps.includes(a.appId));

  async function pay() {
    setStep("paying");
    setError(null);
    try {
      const r = await api<CheckoutResponse>("/v1/api/billing/checkout", { method: "POST", body: { planCode: plan.planCode, ...(site ? { seats } : {}) } });
      if (r.provider === "STRIPE") {
        window.location.assign(r.checkoutUrl);
        return;
      }
      await loadRazorpay();
      const rzp = new window.Razorpay!({
        key: r.razorpay.keyId,
        order_id: r.razorpay.orderId,
        amount: r.razorpay.amount,
        currency: r.razorpay.currency,
        name: r.razorpay.name,
        description: r.razorpay.description,
        prefill: r.razorpay.prefill,
        notes: r.razorpay.notes,
        theme: { color: "#4B1FD8" },
        modal: {
          ondismiss: () => setStep("review"),
          confirm_close: true,
        },
        handler: async (resp: RazorpayResponse) => {
          setStep("paying");
          try {
            const done = await api<{ user: { entitlements: Record<string, ApiEntitlement> } }>("/v1/api/billing/razorpay/confirm", {
              method: "POST",
              body: { orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature },
            });
            setEntitlements(done.user.entitlements);
            setStep("done");
            onActivated?.();
          } catch (err) {
            setError(errorText(err));
            setStep("error");
          }
        },
      });
      rzp.on("payment.failed", (f) => {
        setError(f.error?.description ? `Payment failed: ${f.error.description}` : "The payment failed. No money was taken; you can try again.");
        setStep("error");
      });
      rzp.open();
    } catch (err) {
      setError(err instanceof Error && !(err instanceof ApiError) ? "Razorpay could not load. Disable content blockers for this page and retry." : errorText(err));
      setStep("error");
    }
  }

  const title = step === "done" ? "Licence active" : `${plan.name}${site ? ` · ${seats} seats` : ""}`;

  return (
    <Dialog open={open} onClose={onClose} title={title} wide>
      {step === "loading" && <p className="py-6 text-center text-sm text-muted">Loading your billing details…</p>}

      {step === "signin" && (
        <div className="space-y-4">
          <p className="text-sm text-muted">Sign in or create an AltVivo account to buy this licence. You will come straight back here.</p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href={`/login?redirect=${encodeURIComponent(returnPath)}`}>Sign in</ButtonLink>
            <ButtonLink href={`/register?redirect=${encodeURIComponent(returnPath)}`} variant="outline">
              Create account
            </ButtonLink>
          </div>
        </div>
      )}

      {step === "verify" && (
        <Alert tone="warning" title="Verify your email first">
          We sent a verification link when you registered. Open it, then return to this page. Licences can only be bought from a verified address.
        </Alert>
      )}

      {step === "not-admin" && (
        <div className="space-y-4">
          <Alert tone="info" title="Institutional licences are bought by your institution administrator">
            Ask the administrator of your institution&apos;s AltVivo account to buy seats or download a proforma invoice, or request a formal
            quotation from our team using the form below the price calculator.
          </Alert>
          <Button variant="outline" onClick={onClose}>
            Back to pricing
          </Button>
        </div>
      )}

      {step === "profile" && (
        <div>
          <p className="mb-5 text-sm text-muted">
            These details appear on your GST invoice. {site ? "Use the institution's registered name and address." : "Enter your own or your lab's details."}
          </p>
          <BillingProfileForm
            scope={scope}
            initial={null}
            defaultEmail={viewer.email ?? undefined}
            submitLabel="Continue to payment"
            onSaved={(saved) => {
              setProfile(saved);
              setStep("review");
            }}
          />
        </div>
      )}

      {(step === "review" || step === "paying") && profile && (
        <div className="space-y-5">
          <dl className="divide-y divide-line rounded-xl border border-line">
            <div className="flex justify-between gap-4 px-4 py-3 text-sm">
              <dt className="text-muted">Licence</dt>
              <dd className="text-right font-medium">
                {plan.name}
                <span className="block text-xs text-subtle">{unlocked.map((a) => a.name).join(" + ")} · {plan.interval === "YEAR" ? "12 months" : "1 month"}, prepaid{plan.renews === "automatically" && currency === "USD" ? ", renews automatically" : ""}</span>
              </dd>
            </div>
            {site && (
              <div className="flex justify-between gap-4 px-4 py-3 text-sm">
                <dt className="text-muted">Seats</dt>
                <dd className="readout">
                  {seats} × {formatMoney(plan.prices[currency], currency)}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-4 px-4 py-3 text-sm">
              <dt className="text-muted">Taxable value</dt>
              <dd className="readout">{formatMoney(quote.taxableMinor, currency)}</dd>
            </div>
            <div className="flex justify-between gap-4 px-4 py-3 text-sm">
              <dt className="text-muted">{currency === "INR" ? `GST ${plan.gstRateBp / 100}%` : "Tax (zero-rated export)"}</dt>
              <dd className="readout">{formatMoney(quote.taxMinor, currency)}</dd>
            </div>
            <div className="flex justify-between gap-4 px-4 py-3">
              <dt className="font-semibold">Total payable</dt>
              <dd className="readout text-lg font-semibold">{formatMoney(quote.totalMinor, currency)}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-2 px-4 py-3 text-sm">
            <span className="text-muted">
              Billed to <strong className="text-fg">{profile.legalName}</strong>
              {profile.gstin ? <span className="readout"> · GSTIN {profile.gstin}</span> : null}
            </span>
            <button type="button" className="text-accent-ink hover:underline" onClick={() => setStep("profile")}>
              Edit
            </button>
          </div>
          <Button size="lg" className="w-full" onClick={pay} loading={step === "paying"}>
            {currency === "INR" ? <CreditCard className="size-4" aria-hidden /> : <Lock className="size-4" aria-hidden />}
            {currency === "INR" ? `Pay ${formatMoney(quote.totalMinor, currency)} · UPI, cards, NetBanking` : `Continue to secure payment (Stripe)`}
          </Button>
          <p className="text-center text-xs text-subtle">
            {currency === "INR" ? "Payments are processed by Razorpay." : "You will be redirected to Stripe Checkout."} A GST invoice is emailed as soon as the payment
            completes. By paying you accept the <a href="/terms" className="underline">Terms</a> and the{" "}
            <a href="/terms#refunds" className="underline">refund policy</a>.
          </p>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-xl border border-live/30 bg-live-soft p-4">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-live-ink" aria-hidden />
            <p className="text-sm">
              Payment received. Your {plan.name} licence is active now, and your GST invoice is on its way to <strong>{profile?.email}</strong>.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {unlocked.map((a) => (
              <ButtonLink key={a.appId} href={a.url} className={cx(entitlements && !entitlements[a.appId]?.active && "pointer-events-none opacity-50")}>
                <Rocket className="size-4" aria-hidden /> Launch {a.name}
              </ButtonLink>
            ))}
          </div>
          <ButtonLink href="/workspace/billing" variant="outline" className="w-full">
            <FileText className="size-4" aria-hidden /> Invoices &amp; billing
          </ButtonLink>
        </div>
      )}

      {step === "error" && (
        <div className="space-y-4">
          <Alert tone="danger">{error}</Alert>
          <div className="flex gap-3">
            {profile && (
              <Button onClick={() => setStep("review")}>
                Try again <ArrowRight className="size-4" aria-hidden />
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
