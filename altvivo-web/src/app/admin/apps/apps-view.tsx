"use client";

import { useState, type FormEvent } from "react";
import { BellRing, Pencil } from "lucide-react";
import { LoadState, PageHeader, Table, useAdmin, useSigner } from "@/components/admin/kit";
import { Dialog, Switch } from "@/components/client";
import { Alert, Button, Card, Field, Pill, StatusBadge, formatDate } from "@/components/ui";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import type { AdminApp, AppStatus, PlanKind } from "@/lib/types";

interface AdminPlan {
  planCode: string;
  name: string;
  description: string;
  kind: PlanKind;
  pricingModel: "FLAT" | "PER_SEAT";
  interval: "MONTH" | "YEAR";
  priceInrPaise: number;
  priceUsdCents: number;
  minSeats: number;
  maxSeats: number | null;
  monthlyCredits: number;
  gstRateBp: number;
  stripePriceId: string | null;
  isPublic: boolean;
  highlighted: boolean;
  active: boolean;
  sortOrder: number;
  features: string[];
  apps: string[];
  subscriptions: number;
}

const STATUSES: { value: AppStatus; label: string; help: string }[] = [
  { value: "LIVE", label: "Live", help: "Licensed users can launch it." },
  { value: "BETA", label: "Beta", help: "Licensed users can launch it; marked as beta." },
  { value: "MAINTENANCE", label: "Maintenance", help: "Gate refuses everyone except VIPs; users see a maintenance notice." },
  { value: "COMING_SOON", label: "Coming soon", help: "Not launchable; visitors can join the waitlist." },
];

export function AppsView() {
  const sign = useSigner();
  const apps = useAdmin<{ apps: AdminApp[] }>("/v1/api/admin/apps");
  const plans = useAdmin<{ plans: AdminPlan[] }>("/v1/api/admin/plans");
  const [notice, setNotice] = useState<string | null>(null);
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<AdminPlan | null>(null);

  const changeStatus = (a: AdminApp, status: AppStatus) =>
    sign({
      title: `Set ${a.name} to ${STATUSES.find((s) => s.value === status)!.label}`,
      description: (
        <>
          {STATUSES.find((s) => s.value === status)!.help} Every signed-in user&apos;s token is refreshed so the change applies within seconds.
        </>
      ),
      danger: status === "MAINTENANCE" || status === "COMING_SOON",
      run: async ({ totpCode, reason }) => {
        await api(`/v1/api/admin/apps/${a.appId}`, { method: "PATCH", body: { status, reason, totpCode } });
        setNotice(`${a.name} is now ${status.replace("_", " ").toLowerCase()}.`);
        void apps.reload();
      },
    });

  const changeVersion = (a: AdminApp) => {
    const version = (versions[a.appId] ?? "").trim();
    sign({
      title: `Record ${a.name} version ${version}`,
      run: async ({ totpCode, reason }) => {
        await api(`/v1/api/admin/apps/${a.appId}`, { method: "PATCH", body: { version, reason, totpCode } });
        setVersions((v) => ({ ...v, [a.appId]: "" }));
        setNotice(`${a.name} version set to ${version}.`);
        void apps.reload();
      },
    });
  };

  const notify = (a: AdminApp) =>
    sign({
      title: `Email ${a.waitlistPendingNotification} waitlisted ${a.waitlistPendingNotification === 1 ? "person" : "people"} about ${a.name}`,
      description: "Each address is emailed once; the link goes to the app's pricing.",
      defaultReason: `${a.name} launch announcement`,
      run: async ({ totpCode, reason }) => {
        const r = await api<{ sent: number; failed: number }>(`/v1/api/admin/apps/${a.appId}/notify-waitlist`, { method: "POST", body: { reason, totpCode } });
        setNotice(`Waitlist notified: ${r.sent} sent${r.failed ? `, ${r.failed} failed (retry later)` : ""}.`);
        void apps.reload();
      },
    });

  return (
    <>
      <PageHeader title="Apps & pricing" description="The application switchboard enforced by the Caddy gate, and the plan catalogue used by /pricing and checkout. Every change is e-signed and audited." />
      {notice && (
        <div className="mb-6">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-subtle">Application switchboard</h2>
      <LoadState loading={apps.loading && !apps.data} error={apps.error} onRetry={apps.reload} />
      {apps.data && (
        <div className="mb-10 grid gap-4 lg:grid-cols-2">
          {apps.data.apps.map((a) => (
            <Card key={a.appId} className="space-y-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{a.name}</h3>
                  <p className="readout text-xs text-subtle">
                    {a.url.replace(/^https:\/\//, "")} · v{a.version}
                  </p>
                </div>
                <StatusBadge status={a.status} />
              </div>
              <div role="radiogroup" aria-label={`${a.name} status`} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {STATUSES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    role="radio"
                    aria-checked={a.status === s.value}
                    title={s.help}
                    disabled={a.status === s.value}
                    onClick={() => changeStatus(a, s.value)}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${a.status === s.value ? "border-accent bg-accent/10 text-accent-ink" : "border-line text-muted hover:border-accent/50 hover:text-fg"}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-subtle">
                Status changed {formatDate(a.statusChangedAt, true)}. Waitlist: {a.waitlistTotal} total, {a.waitlistPendingNotification} not yet notified.
              </p>
              <div className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
                <div className="flex-1">
                  <Field label="Deployed version" id={`v-${a.appId}`}>
                    <input
                      id={`v-${a.appId}`}
                      className="field readout"
                      placeholder={a.version}
                      value={versions[a.appId] ?? ""}
                      onChange={(e) => setVersions((v) => ({ ...v, [a.appId]: e.target.value }))}
                    />
                  </Field>
                </div>
                <Button variant="outline" disabled={!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test((versions[a.appId] ?? "").trim())} onClick={() => changeVersion(a)}>
                  Save version
                </Button>
                <Button variant="ghost" disabled={!a.waitlistPendingNotification || (a.status !== "LIVE" && a.status !== "BETA")} onClick={() => notify(a)}>
                  <BellRing className="size-4" aria-hidden /> Notify waitlist
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-subtle">Plans & prices</h2>
      <LoadState loading={plans.loading && !plans.data} error={plans.error} onRetry={plans.reload} />
      {plans.data && (
        <Table head={["Plan", "Apps", "Price (₹)", "Seats", "Subscriptions", "Visibility", ""]} empty={!plans.data.plans.length} minWidth={980}>
          {plans.data.plans.map((p) => (
            <tr key={p.planCode} className={p.active ? "" : "opacity-60"}>
              <td>
                <span className="font-medium">{p.name}</span>
                <span className="readout block text-xs text-subtle">
                  {p.planCode} · {p.interval === "YEAR" ? "yearly" : "monthly"}
                  {p.pricingModel === "PER_SEAT" && " · per seat"}
                </span>
              </td>
              <td className="readout text-xs">{p.apps.join(" + ")}</td>
              <td className="readout whitespace-nowrap">{formatMoney(p.priceInrPaise, "INR")}</td>
              <td className="readout text-xs">
                {p.minSeats}
                {p.maxSeats === null ? "+" : p.maxSeats === p.minSeats ? "" : `–${p.maxSeats}`}
              </td>
              <td className="readout">{p.subscriptions}</td>
              <td className="space-x-1 whitespace-nowrap">
                {!p.active ? <Pill tone="muted">retired</Pill> : p.isPublic ? <Pill tone="live">public</Pill> : <Pill tone="soon">unlisted</Pill>}
                {p.highlighted && <Pill tone="accent">featured</Pill>}
              </td>
              <td className="text-right">
                <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                  <Pencil className="size-3.5" aria-hidden /> Edit
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <p className="mt-2 text-xs text-subtle">Prices exclude GST. Changes apply to new checkouts and renewals; existing paid terms are not affected.</p>

      {editing && (
        <PlanDialog
          plan={editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            setNotice(msg);
            void plans.reload();
          }}
        />
      )}
    </>
  );
}

function PlanDialog({ plan, onClose, onSaved }: { plan: AdminPlan; onClose: () => void; onSaved: (msg: string) => void }) {
  const sign = useSigner();
  const [f, setF] = useState({
    name: plan.name,
    description: plan.description,
    inr: (plan.priceInrPaise / 100).toFixed(2),
    usd: (plan.priceUsdCents / 100).toFixed(2),
    minSeats: String(plan.minSeats),
    maxSeats: plan.maxSeats === null ? "" : String(plan.maxSeats),
    monthlyCredits: String(plan.monthlyCredits),
    features: plan.features.join("\n"),
    sortOrder: String(plan.sortOrder),
    stripePriceId: plan.stripePriceId ?? "",
    highlighted: plan.highlighted,
    active: plan.active,
    isPublic: plan.isPublic,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((cur) => ({ ...cur, [k]: e.target.value }));

  function changes() {
    const next: Record<string, unknown> = {
      name: f.name.trim(),
      description: f.description.trim(),
      priceInrPaise: Math.round(Number(f.inr) * 100),
      minSeats: Number(f.minSeats),
      maxSeats: f.maxSeats.trim() ? Number(f.maxSeats) : null,
      monthlyCredits: Number(f.monthlyCredits),
      features: f.features
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      sortOrder: Number(f.sortOrder),
      highlighted: f.highlighted,
      active: f.active,
      isPublic: f.isPublic,
    };
    const before: Record<string, unknown> = { ...plan };
    return Object.fromEntries(Object.entries(next).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])));
  }
  const diff = changes();
  const priceChange = "priceInrPaise" in diff;

  function submit(e: FormEvent) {
    e.preventDefault();
    sign({
      title: `Update plan ${plan.name}`,
      description: (
        <ul className="list-disc space-y-0.5 pl-5">
          {Object.keys(diff).map((k) => (
            <li key={k} className="readout text-xs">
              {k}
            </li>
          ))}
        </ul>
      ),
      danger: priceChange || diff.active === false,
      run: async ({ totpCode, reason }) => {
        await api(`/v1/api/admin/plans/${plan.planCode}`, { method: "PATCH", body: { ...diff, reason, totpCode } });
        onSaved(`${plan.name} updated.`);
      },
    });
  }

  const money = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim());
  const valid = f.name.trim().length >= 2 && money(f.inr) && Number(f.minSeats) >= 1 && (!f.maxSeats.trim() || Number(f.maxSeats) >= Number(f.minSeats)) && (!f.stripePriceId.trim() || /^price_[A-Za-z0-9]{6,64}$/.test(f.stripePriceId.trim()));

  return (
    <Dialog open onClose={onClose} title={`Edit ${plan.name}`} wide>
      <form onSubmit={submit} className="space-y-4">
        {plan.subscriptions > 0 && priceChange && (
          <Alert tone="warning">{plan.subscriptions} subscriptions use this plan. New prices apply from their next renewal; recurring subscriptions keep their linked Stripe price until you change it there.</Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display name" id="p-name">
            <input id="p-name" className="field" value={f.name} onChange={set("name")} />
          </Field>
          <Field label="Sort order" id="p-sort">
            <input id="p-sort" type="number" min={0} className="field readout" value={f.sortOrder} onChange={set("sortOrder")} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description" id="p-desc">
              <input id="p-desc" className="field" maxLength={500} value={f.description} onChange={set("description")} />
            </Field>
          </div>
          <Field label={`Price INR (₹, before GST${plan.pricingModel === "PER_SEAT" ? ", per seat" : ""})`} id="p-inr">
            <input id="p-inr" className="field readout" inputMode="decimal" value={f.inr} onChange={set("inr")} />
          </Field>
          <Field label="Minimum seats" id="p-min">
            <input id="p-min" type="number" min={1} className="field readout" value={f.minSeats} onChange={set("minSeats")} />
          </Field>
          <Field label="Maximum seats" id="p-max" hint="Empty = unlimited">
            <input id="p-max" type="number" min={1} className="field readout" value={f.maxSeats} onChange={set("maxSeats")} />
          </Field>
          <Field label="Monthly compute credits" id="p-cred">
            <input id="p-cred" type="number" min={0} className="field readout" value={f.monthlyCredits} onChange={set("monthlyCredits")} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Features (one per line, max 12)" id="p-feat">
              <textarea id="p-feat" rows={5} className="field" value={f.features} onChange={set("features")} />
            </Field>
          </div>
        </div>
        <div className="flex flex-wrap gap-6">
          <span className="flex items-center gap-2 text-sm">
            <Switch checked={f.active} onChange={(v) => setF((c) => ({ ...c, active: v }))} label="Available for purchase" />
            Available for purchase
          </span>
          <span className="flex items-center gap-2 text-sm">
            <Switch checked={f.isPublic} onChange={(v) => setF((c) => ({ ...c, isPublic: v }))} label="Listed on /pricing" />
            Listed on /pricing
          </span>
          <span className="flex items-center gap-2 text-sm">
            <Switch checked={f.highlighted} onChange={(v) => setF((c) => ({ ...c, highlighted: v }))} label="Best-value badge" />
            Best-value badge
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-subtle">GST {plan.gstRateBp / 100}% is added at checkout.</p>
          <Button type="submit" disabled={!valid || !Object.keys(diff).length}>
            Continue to sign
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
