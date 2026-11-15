"use client";

import { useEffect, useState } from "react";
import { CalendarClock, FileDown, Layers, Receipt, RefreshCw, Wallet } from "lucide-react";
import { BillingProfileForm, CheckoutDialog, type Viewer } from "@/components/checkout";
import { Alert, Button, Card, Pill, cx, entitled, formatDate } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import type { BillingProfile, CatalogPlan, CatalogResponse, InvoiceSummary, PaymentRow, SubscriptionRow, WorkspaceApp } from "@/lib/types";

export interface BillingData {
  subscriptions: SubscriptionRow[];
  invoices: InvoiceSummary[];
  payments: PaymentRow[];
  profile: BillingProfile | null;
  orgProfile: BillingProfile | null;
  apps: WorkspaceApp[];
}

const KIND: Record<InvoiceSummary["kind"], string> = { TAX_INVOICE: "Tax invoice", PROFORMA: "Proforma", CREDIT_NOTE: "Credit note" };
const PAY_TONE: Record<PaymentRow["status"], "live" | "danger" | "muted" | "accent" | "soon"> = {
  CAPTURED: "live",
  FAILED: "danger",
  REFUNDED: "muted",
  PARTIALLY_REFUNDED: "soon",
  CREATED: "muted",
  AUTHORIZED: "accent",
};

function Section({ title, icon, children, action }: { title: string; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-subtle">
          {icon}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function PdfButton({ inv }: { inv: InvoiceSummary }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        setErr(false);
        try {
          const r = await api<{ url: string }>(`/v1/api/billing/invoices/${inv.id}/pdf`);
          window.open(r.url, "_blank", "noopener");
        } catch {
          setErr(true);
        } finally {
          setBusy(false);
        }
      }}
      className={cx("inline-flex items-center gap-1 text-xs font-semibold hover:underline disabled:opacity-50", err ? "text-danger" : "text-accent-ink")}
      aria-label={`Download ${KIND[inv.kind]} ${inv.number}`}
    >
      <FileDown className="size-3.5" aria-hidden /> {err ? "Retry" : "PDF"}
    </button>
  );
}

export function BillingView({
  data,
  catalog,
  viewer,
  isOrgAdmin,
  returned,
}: {
  data: BillingData;
  catalog: CatalogResponse | null;
  viewer: Viewer;
  isOrgAdmin: boolean;
  returned: { status: string | null; invoice: string | null };
}) {
  const [subs, setSubs] = useState(data.subscriptions);
  const [checkout, setCheckout] = useState<CatalogPlan | null>(null);
  const [profileScope, setProfileScope] = useState<"personal" | "organization">("personal");
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activated, setActivated] = useState(false);

  // Back from Stripe Checkout: the webhook may land a moment after the redirect.
  const pendingInvoice = returned.status === "success" && returned.invoice && !data.invoices.some((i) => i.id === returned.invoice && i.status === "PAID");
  useEffect(() => {
    if (!pendingInvoice) return;
    const t = setTimeout(() => window.location.reload(), 4000);
    return () => clearTimeout(t);
  }, [pendingInvoice]);

  const live = data.apps.filter((a) => a.status !== "COMING_SOON");
  const activeApps = live.filter((a) => entitled(a.entitlement));
  const inForce = subs.filter((s) => s.inForce);
  const past = subs.filter((s) => !s.inForce);
  const planOf = (code: string) => catalog?.plans.find((p) => p.planCode === code) ?? null;

  // Single-app holders: suggest the Dual-Suite bundle (same interval as what they hold).
  const single = inForce.find((s) => s.plan.kind === "SINGLE_APP" && s.scope === "personal");
  const bundle = single && catalog ? catalog.plans.find((p) => p.kind === "BUNDLE" && p.interval === single.plan.interval && p.purchasable) : undefined;
  const missing = bundle ? live.filter((a) => bundle.apps.includes(a.appId) && !entitled(a.entitlement)) : [];

  async function cancelRenewal(s: SubscriptionRow) {
    setError(null);
    try {
      await api(`/v1/api/billing/subscriptions/${s.id}/cancel`, { method: "POST" });
      setSubs((list) => list.map((x) => (x.id === s.id ? { ...x, cancelAtPeriodEnd: true } : x)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel the renewal.");
    }
  }

  return (
    <div className="space-y-10">
      <div>
        <p className="eyebrow">Billing</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Licences, invoices & billing details</h1>
      </div>

      {returned.status === "success" &&
        (pendingInvoice ? (
          <Alert tone="info" title="Confirming your payment…">
            Stripe has accepted the payment; we are waiting for its confirmation. This page refreshes automatically.
          </Alert>
        ) : (
          <Alert tone="success" title="Payment received">
            Your licence is active and your GST invoice is listed below.
          </Alert>
        ))}
      {activated && <Alert tone="success" title="Renewal paid">The new term is listed below.</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}

      {/* ---------------------------------------------------- licences */}
      <Section title="Active licences" icon={<CalendarClock className="size-4" aria-hidden />}>
        {activeApps.length === 0 ? (
          <Card className="p-6 text-sm text-muted">
            No active licence. <a href="/pricing" className="text-accent-ink underline">See plans</a>.
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {activeApps.map((a) => {
              const s = inForce.find((x) => x.planCode === a.entitlement.plan);
              const plan = s ? planOf(s.planCode) : null;
              return (
                <Card key={a.appId} className="p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold">{a.name}</p>
                    <Pill tone="live">
                      {a.entitlement.source === "institution" ? "Institution" : a.entitlement.source === "vip" ? "Complimentary" : a.entitlement.source === "bundle" ? "Dual-Suite" : "Licensed"}
                    </Pill>
                  </div>
                  <p className="mt-2 text-sm text-muted">
                    {a.entitlement.expiresAt ? `Valid until ${formatDate(a.entitlement.expiresAt)}` : "No end date"}
                    {s ? ` · ${s.plan.name}` : ""}
                    {s?.billingMode === "RECURRING" ? (s.cancelAtPeriodEnd ? " · renewal cancelled" : " · renews automatically") : s ? " · prepaid" : ""}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {s?.billingMode === "ONE_TIME" && plan?.purchasable && (
                      <Button size="sm" variant="outline" onClick={() => setCheckout(plan)}>
                        <RefreshCw className="size-3.5" aria-hidden /> Renew
                      </Button>
                    )}
                    {s?.billingMode === "RECURRING" && !s.cancelAtPeriodEnd && (
                      <Button size="sm" variant="ghost" onClick={() => cancelRenewal(s)}>
                        Cancel renewal
                      </Button>
                    )}
                    {a.entitlement.source === "institution" && <p className="text-xs text-subtle">Managed by your institution administrator.</p>}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
        {bundle && missing.length > 0 && (
          <Card className="mt-4 flex flex-col gap-4 border-accent/40 p-5 sm:flex-row sm:items-center">
            <Layers className="size-6 shrink-0 text-accent-ink" aria-hidden />
            <div className="flex-1 text-sm">
              <p className="font-semibold">Add {missing.map((m) => m.name).join(" and ")} with the Dual-Suite bundle</p>
              <p className="text-muted">
                {bundle.name}: {formatMoney(bundle.prices[catalog!.currency], catalog!.currency, { whole: true })} per {bundle.interval === "YEAR" ? "year" : "month"}
                {catalog!.currency === "INR" ? " + GST" : ""}, covering both applications.
              </p>
            </div>
            <Button onClick={() => setCheckout(bundle)}>Upgrade to Dual-Suite</Button>
          </Card>
        )}
      </Section>

      {/* ----------------------------------------------------- invoices */}
      <Section title="Invoices" icon={<Receipt className="size-4" aria-hidden />}>
        <Card className="overflow-x-auto">
          {data.invoices.length === 0 ? (
            <p className="p-6 text-sm text-muted">Your GST invoices will appear here after your first payment.</p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-subtle">
                  <th className="p-4 font-medium">Number</th>
                  <th className="p-4 font-medium">Type</th>
                  <th className="p-4 font-medium">Date</th>
                  <th className="p-4 text-right font-medium">Amount</th>
                  <th className="p-4 font-medium">Status</th>
                  <th className="p-4" />
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((i) => (
                  <tr key={i.id} className={cx("border-b border-line last:border-0", i.id === returned.invoice && "bg-accent-soft")}>
                    <td className="readout p-4">{i.number}</td>
                    <td className="p-4">
                      {KIND[i.kind]}
                      {i.poNumber && <span className="block text-xs text-subtle">PO {i.poNumber}</span>}
                    </td>
                    <td className="p-4">{formatDate(i.issuedAt)}</td>
                    <td className="readout p-4 text-right">
                      {i.kind === "CREDIT_NOTE" ? "−" : ""}
                      {formatMoney(i.totalMinor, i.currency)}
                      {i.taxMinor > 0 && <span className="block text-xs text-subtle">incl. GST {formatMoney(i.taxMinor, i.currency)}</span>}
                    </td>
                    <td className="p-4">
                      <Pill tone={i.status === "PAID" ? "live" : i.status === "CANCELLED" ? "muted" : "accent"}>
                        {i.status === "ISSUED" && i.kind === "PROFORMA" ? (i.validUntil && new Date(i.validUntil) < new Date() ? "Expired" : "Awaiting payment") : i.status.toLowerCase()}
                      </Pill>
                    </td>
                    <td className="p-4 text-right">
                      <PdfButton inv={i} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </Section>

      {/* ----------------------------------------------------- payments */}
      {data.payments.length > 0 && (
        <Section title="Payments" icon={<Wallet className="size-4" aria-hidden />}>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="p-4">{formatDate(p.capturedAt ?? p.createdAt, true)}</td>
                    <td className="p-4">
                      {p.description}
                      <span className="readout block text-xs text-subtle">
                        {p.provider === "BANK_TRANSFER" ? "Bank transfer" : p.provider === "RAZORPAY" ? "Razorpay" : "Stripe"}
                        {p.method ? ` · ${p.method}` : ""}
                      </span>
                    </td>
                    <td className="readout p-4 text-right">
                      {formatMoney(p.amountMinor, p.currency)}
                      {p.refundedMinor > 0 && <span className="block text-xs text-subtle">refunded {formatMoney(p.refundedMinor, p.currency)}</span>}
                    </td>
                    <td className="p-4 text-right">
                      <Pill tone={PAY_TONE[p.status]}>{p.status.replace("_", " ").toLowerCase()}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </Section>
      )}

      {/* ------------------------------------------------ billing details */}
      <Section
        title="Billing details (GST)"
        icon={<Receipt className="size-4" aria-hidden />}
        action={
          isOrgAdmin ? (
            <div role="tablist" className="inline-flex rounded-full border border-line bg-surface p-0.5 text-xs">
              {(["personal", "organization"] as const).map((s) => (
                <button
                  key={s}
                  role="tab"
                  type="button"
                  aria-selected={profileScope === s}
                  onClick={() => {
                    setProfileScope(s);
                    setSaved(null);
                  }}
                  className={cx("rounded-full px-3 py-1", profileScope === s ? "bg-surface-3 text-fg" : "text-muted")}
                >
                  {s === "personal" ? "Personal" : "Institution"}
                </button>
              ))}
            </div>
          ) : undefined
        }
      >
        <Card className="p-6">
          {saved && (
            <div className="mb-5">
              <Alert tone="success">{saved}</Alert>
            </div>
          )}
          <BillingProfileForm
            key={profileScope}
            scope={profileScope}
            initial={profileScope === "personal" ? data.profile : data.orgProfile}
            defaultEmail={viewer.email ?? undefined}
            onSaved={() => setSaved("Billing details saved. New invoices use them; issued invoices never change.")}
          />
        </Card>
      </Section>

      {past.length > 0 && (
        <Section title="Previous terms" icon={<CalendarClock className="size-4" aria-hidden />}>
          <Card className="divide-y divide-line">
            {past.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <span>
                  {s.plan.name}
                  {s.seats > 1 ? ` · ${s.seats} seats` : ""}
                </span>
                <span className="text-muted">
                  {s.currentPeriodStart ? `${formatDate(s.currentPeriodStart)} – ` : ""}
                  {formatDate(s.currentPeriodEnd)}
                </span>
                <Pill tone="muted">{s.status === "ACTIVE" ? "upcoming" : s.status.toLowerCase()}</Pill>
              </div>
            ))}
          </Card>
        </Section>
      )}

      {checkout && (
        <CheckoutDialog
          open
          onClose={() => {
            setCheckout(null);
            if (activated) window.location.reload();
          }}
          onActivated={() => setActivated(true)}
          plan={checkout}
          viewer={viewer}
          apps={data.apps}
          returnPath="/workspace/billing"
        />
      )}
    </div>
  );
}
