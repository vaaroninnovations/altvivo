"use client";

import { useState } from "react";
import { ArrowLeft, Building2, Check, Lock, Rocket } from "lucide-react";
import { AppIcon, AppLogo, hasAppLogo } from "@/components/brand";
import { CheckoutDialog, type Viewer } from "@/components/checkout";
import { Alert, ButtonLink, Card, StatusBadge, entitled, formatDate } from "@/components/ui";
import { PlanOptions } from "@/components/unlock";
import type { CatalogPlan, CatalogResponse, WorkspaceApp } from "@/lib/types";

const REASON: Record<string, { title: string; body: (app: string) => string }> = {
  subscription_required: {
    title: "A licence is required",
    body: (app) => `Your AltVivo account does not hold an active ${app} licence yet. Choose a plan below. Access opens as soon as payment completes.`,
  },
  subscription_expired: {
    title: "Your licence has ended",
    body: (app) => `Your ${app} licence period is over. Renew to continue where you left off; your data and exports are kept.`,
  },
};

export function UpgradeView({
  app,
  apps,
  catalog,
  viewer,
  reason,
  cancelled,
}: {
  app: WorkspaceApp | null;
  apps: WorkspaceApp[];
  catalog: CatalogResponse | null;
  viewer: Viewer;
  reason: string | null;
  cancelled: boolean;
}) {
  const [plan, setPlan] = useState<CatalogPlan | null>(null);
  const [activated, setActivated] = useState(false);

  if (!app) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-semibold">Choose an application</h1>
        <div className="grid gap-4 sm:grid-cols-2">
          {apps.map((a) => (
            <a key={a.appId} href={`/workspace/upgrade?app=${a.appId}`} className="rounded-2xl border border-line bg-surface p-5 transition hover:border-accent">
              {hasAppLogo(a.appId) ? <AppLogo appId={a.appId} name={a.name} className="h-14" /> : <AppIcon iconKey={a.iconKey} className="size-6 text-accent-ink" />}
              <p className="mt-3 font-semibold">{a.name}</p>
              <p className="text-sm text-muted">{a.tagline}</p>
            </a>
          ))}
        </div>
      </div>
    );
  }

  const ok = entitled(app.entitlement) || activated;
  const r = REASON[reason ?? ""] ?? REASON.subscription_required!;

  return (
    <div className="space-y-8">
      <a href="/workspace" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> My applications
      </a>

      <div className="grid gap-8 lg:grid-cols-[1fr_1.15fr]">
        <Card className="p-7 sm:p-9">
          <div className="flex items-center justify-between gap-4">
            {hasAppLogo(app.appId) ? (
              <AppLogo appId={app.appId} name={app.name} className="h-20" />
            ) : (
              <div className="grid size-14 place-items-center rounded-2xl border border-accent/30 bg-accent-soft text-accent-ink">
                <AppIcon iconKey={app.iconKey} className="size-7" />
              </div>
            )}
            <StatusBadge status={app.status} />
          </div>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight">{app.name}</h1>
          <p className="mt-1 text-accent-ink">{app.tagline}</p>
          <p className="mt-4 text-sm leading-relaxed text-muted">{app.description}</p>
          <ul className="mt-6 space-y-2.5">
            {app.highlights.map((h) => (
              <li key={h} className="flex items-start gap-2.5 text-sm">
                <Check className="mt-0.5 size-4 shrink-0 text-live-ink" aria-hidden />
                {h}
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-5">
          {ok ? (
            <Card className="p-7">
              <Alert tone="success" title={`${app.name} is unlocked`}>
                {app.entitlement.expiresAt && !activated ? `Your licence is valid until ${formatDate(app.entitlement.expiresAt)}.` : "Your licence is active."}
              </Alert>
              <ButtonLink href={app.url} size="lg" className="mt-5 w-full">
                <Rocket className="size-4" aria-hidden /> Launch {app.name}
              </ButtonLink>
            </Card>
          ) : (
            <>
              {cancelled && <Alert tone="info">Checkout was cancelled. Nothing was charged.</Alert>}
              <Alert tone={reason === "subscription_expired" ? "warning" : "info"} title={r.title}>
                {r.body(app.name)}
              </Alert>
              {catalog ? (
                <Card className="p-6">
                  <p className="mb-4 flex items-center gap-2 font-semibold">
                    <Lock className="size-4 text-accent-ink" aria-hidden /> Choose your licence
                  </p>
                  <PlanOptions catalog={catalog} appId={app.appId} apps={apps} onChoose={setPlan} />
                </Card>
              ) : (
                <Alert tone="danger">Prices could not be loaded. Please refresh in a moment.</Alert>
              )}
              <Card className="flex items-start gap-4 p-6">
                <Building2 className="mt-0.5 size-5 shrink-0 text-accent-ink" aria-hidden />
                <div className="text-sm">
                  <p className="font-medium">{viewer.hasOrg ? "Your institution's licence does not include this application" : "Buying for a department or college?"}</p>
                  <p className="mt-1 text-muted">
                    {viewer.hasOrg
                      ? "Ask your institution administrator to add it to the site licence, or buy a personal licence above."
                      : "A site licence covers every member, with a proforma invoice for your purchase order."}{" "}
                    <a href="/pricing#institutional" className="text-accent-ink underline">
                      Site licences
                    </a>
                  </p>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>

      {plan && (
        <CheckoutDialog
          open
          onClose={() => setPlan(null)}
          onActivated={() => setActivated(true)}
          plan={plan}
          viewer={viewer}
          apps={apps}
          returnPath={`/workspace/upgrade?app=${app.appId}`}
        />
      )}
    </div>
  );
}
