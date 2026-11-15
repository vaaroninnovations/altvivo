"use client";

import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { formatMoney, perMonth } from "@/lib/money";
import type { CatalogPlan, CatalogResponse, PublicApp } from "@/lib/types";
import { CheckoutDialog, type Viewer } from "./checkout";
import { Dialog } from "./client";
import { Pill, cx } from "./ui";

/** Plans a person can buy for one app: its single-app plans and the bundles that include it. */
export function plansFor(catalog: CatalogResponse, appId: string): CatalogPlan[] {
  return catalog.plans
    .filter((p) => p.kind !== "SITE_LICENSE" && p.apps.includes(appId))
    .sort((a, b) => (a.kind === b.kind ? (a.interval === b.interval ? 0 : a.interval === "YEAR" ? -1 : 1) : a.kind === "SINGLE_APP" ? -1 : 1));
}

export function PlanOptions({
  catalog,
  appId,
  apps,
  onChoose,
}: {
  catalog: CatalogResponse;
  appId: string;
  apps: Pick<PublicApp, "appId" | "name">[];
  onChoose: (plan: CatalogPlan) => void;
}) {
  const cur = catalog.currency;
  const options = plansFor(catalog, appId);
  if (!options.length) return <p className="text-sm text-muted">No plan includes this application yet. Contact sales@altvivo.bio.</p>;
  return (
    <ul className="grid gap-3">
      {options.map((p) => {
        const names = p.apps.map((id) => apps.find((a) => a.appId === id)?.name ?? id);
        return (
          <li key={p.planCode}>
            <button
              type="button"
              disabled={!p.purchasable}
              onClick={() => onChoose(p)}
              className={cx(
                "group flex w-full items-center gap-4 rounded-2xl border bg-surface p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
                p.highlighted ? "border-accent/50 hover:border-accent" : "border-line hover:border-accent/60",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {p.name}
                  {p.kind === "BUNDLE" && <Pill tone="accent">{names.join(" + ")}</Pill>}
                  {p.highlighted && <Pill tone="live">Best value</Pill>}
                </p>
                <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  {p.features.slice(0, 3).map((f) => (
                    <li key={f} className="flex items-center gap-1">
                      <Check className="size-3 text-live-ink" aria-hidden /> {f}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="shrink-0 text-right">
                <p className="readout text-lg font-semibold">{formatMoney(p.prices[cur], cur, { whole: true })}</p>
                <p className="text-xs text-subtle">
                  {p.interval === "YEAR" ? `/ year · ≈ ${formatMoney(perMonth(p, cur), cur, { round: true })}/mo` : "/ month"}
                  {cur === "INR" ? " + GST" : ""}
                </p>
              </div>
              <ArrowRight className="size-4 shrink-0 text-subtle transition group-hover:translate-x-0.5 group-hover:text-accent-ink" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** "Unlock" button flow: pick a plan, then the checkout dialog. */
export function UnlockDialog({
  open,
  onClose,
  appId,
  appName,
  catalog,
  viewer,
  apps,
  returnPath,
  onActivated,
}: {
  open: boolean;
  onClose: () => void;
  onActivated?: () => void;
  appId: string;
  appName: string;
  catalog: CatalogResponse;
  viewer: Viewer;
  apps: Pick<PublicApp, "appId" | "name" | "url">[];
  returnPath: string;
}) {
  const [plan, setPlan] = useState<CatalogPlan | null>(null);
  return (
    <>
      <Dialog open={open && !plan} onClose={onClose} title={`Unlock ${appName}`} wide>
        <p className="mb-5 text-sm text-muted">
          Choose a licence. It activates as soon as payment completes{catalog.currency === "INR" ? ", with a GST invoice" : ""}.
        </p>
        <PlanOptions catalog={catalog} appId={appId} apps={apps} onChoose={setPlan} />
        <p className="mt-5 text-xs text-subtle">
          Part of a college or university? Ask your institution administrator about a site licence, or see{" "}
          <a href="/pricing#institutional" className="underline">
            institutional pricing
          </a>
          .
        </p>
      </Dialog>
      {plan && (
        <CheckoutDialog
          open
          onClose={() => {
            setPlan(null);
            onClose();
          }}
          plan={plan}
          viewer={viewer}
          apps={apps}
          returnPath={returnPath}
          onActivated={onActivated}
        />
      )}
    </>
  );
}
