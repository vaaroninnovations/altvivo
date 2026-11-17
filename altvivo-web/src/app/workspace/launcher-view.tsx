"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarClock, FileText, Gift, History, Lock, Rocket, ShieldCheck, Wrench } from "lucide-react";
import { AppIcon, AppLogo, hasAppLogo } from "@/components/brand";
import type { Viewer } from "@/components/checkout";
import { Alert, Button, ButtonLink, Card, LicenceBadge, Pill, StatusBadge, entitled, formatBytes, formatDate } from "@/components/ui";
import { TrialStatus } from "@/components/trial";
import { UnlockDialog } from "@/components/unlock";
import { BuyAnalysesDialog } from "@/components/usage";
import { api } from "@/lib/api";
import { isAvailable } from "@/lib/catalog";
import { trialLength, trialState } from "@/lib/trial";
import type { CatalogResponse, WorkspaceApp, WorkspaceData } from "@/lib/types";

const SOURCE_TEXT: Record<string, string> = {
  trial: "One month free",
  payg: "Pay per use",
  individual: "Personal licence",
  bundle: "Dual-Suite bundle",
  institution: "Your institution's licence",
  manual: "Licence issued by AltVivo",
  vip: "Complimentary access",
};

const NOTICES: Record<string, { tone: "warning" | "danger" | "info"; title: string; body: string }> = {
  xprism_college_inactive: {
    tone: "warning",
    title: "Your XPRISM college account is not active",
    body: "XPRISM could not match your sign-in to an active college or batch. Ask your teacher to add you to the class.",
  },
  xprism_account_disabled: {
    tone: "danger",
    title: "Your XPRISM account has been disabled",
    body: "An XPRISM administrator disabled this account. Contact your instructor or support@altvivo.bio if you think this is a mistake.",
  },
};

const daysLeft = (iso: string | null) => (iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000) : null);

function LiveAppCard({
  app,
  activity,
  onUnlock,
  freeMonth,
  analyses,
  onBuyAnalyses,
}: {
  /** Pay per use: analyses left on the account (null when this app is not sold per use). */
  analyses: number | null;
  onBuyAnalyses: () => void;
  app: WorkspaceApp;
  activity: WorkspaceData["recentActivity"];
  onUnlock: () => void;
  /** Days of free access this person can still ask for; null once they have asked. */
  freeMonth: number | null;
}) {
  const e = app.entitlement;
  const ok = entitled(e);
  const left = daysLeft(e.expiresAt);
  const maintenance = app.status === "MAINTENANCE";
  return (
    <Card className={ok ? "glow flex flex-col overflow-hidden" : "flex flex-col overflow-hidden"}>
      <div className="flex items-start gap-4 border-b border-line p-6">
        {hasAppLogo(app.appId) ? (
          <AppLogo appId={app.appId} name={app.name} className={ok ? "h-14" : "h-14 opacity-70 grayscale-[40%]"} />
        ) : (
          <div className={ok ? "grid size-12 shrink-0 place-items-center rounded-xl border border-accent/30 bg-accent-soft text-accent-ink" : "grid size-12 shrink-0 place-items-center rounded-xl border border-line bg-surface-2 text-subtle"}>
            <AppIcon iconKey={app.iconKey} className="size-6" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-semibold">{app.name}</h3>
            <StatusBadge status={app.status} />
          </div>
          <p className="mt-0.5 text-sm text-muted">{app.tagline}</p>
        </div>
      </div>

      <div className="flex-1 space-y-4 p-6">
        {ok ? (
          <div className="rounded-xl border border-live/30 bg-live-soft px-4 py-3">
            <p className="readout flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-live-ink">
              <ShieldCheck className="size-4" aria-hidden /> {e.source === "trial" ? "Free month active" : e.source === "payg" ? "Pay per use" : "Active licence"}
            </p>
            {e.source === "payg" && analyses !== null && (
              <p className="mt-1 text-sm">
                <strong className="readout">{analyses}</strong> {analyses === 1 ? "analysis" : "analyses"} left · one is used for each animal / video.{" "}
                <button type="button" onClick={onBuyAnalyses} className="font-semibold text-accent-ink underline">
                  Buy more
                </button>
              </p>
            )}
            <p className={e.source === "payg" ? "hidden" : "mt-1 text-sm"}>
              {SOURCE_TEXT[e.source ?? "individual"]}
              {e.expiresAt ? (
                <>
                  {" "}
                  · valid until <strong>{formatDate(e.expiresAt)}</strong>
                </>
              ) : null}
            </p>
            {left !== null && left <= 14 && e.source !== "institution" && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-soon-ink">
                <CalendarClock className="size-3.5" aria-hidden /> Ends in {left} {left === 1 ? "day" : "days"}.{" "}
                <button type="button" onClick={onUnlock} className="font-semibold underline">
                  {e.source === "trial" ? "Choose a plan" : "Renew now"}
                </button>
                {e.source === "trial" ? " to keep working without a break." : ". The new term starts when this one ends."}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-surface-2 px-4 py-3">
            <p className="readout flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
              <Lock className="size-4" aria-hidden /> {freeMonth ? "Locked: start free" : "Locked: plan required"}
            </p>
            <p className="mt-1 text-sm text-muted">
              {e.active && e.expiresAt
                ? `Your access ended on ${formatDate(e.expiresAt)}.`
                : freeMonth
                  ? `Open ${app.name} free for ${freeMonth} days, or choose a plan.`
                  : `A plan for ${app.name} is needed to open it.`}
            </p>
          </div>
        )}

        {maintenance && (
          <Alert tone="warning" title="Scheduled maintenance">
            {app.name} is being updated and will be back shortly. Your licence is not affected.
          </Alert>
        )}

        {activity.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">
              <History className="size-3.5" aria-hidden /> Recent activity
            </p>
            <ul className="space-y-1.5 text-sm">
              {activity.slice(0, 3).map((a) => (
                <li key={a.id} className="flex justify-between gap-3">
                  <span className="readout truncate text-xs text-muted">
                    {a.eventType.replace(/^[A-Z]+\./, "").replaceAll("_", " ").toLowerCase()}
                    {a.resourceId ? ` · ${a.resourceId}` : ""}
                  </span>
                  <span className="readout shrink-0 text-xs text-subtle">{formatDate(a.timestamp, true)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line p-6 pt-5">
        {ok ? (
          <ButtonLink href={app.url} className={maintenance && e.source !== "vip" ? "pointer-events-none opacity-50" : ""} aria-disabled={maintenance && e.source !== "vip"}>
            <Rocket className="size-4" aria-hidden /> Launch application
          </ButtonLink>
        ) : freeMonth ? (
          <>
            <ButtonLink href="/free-month">
              <Gift className="size-4" aria-hidden /> Start {trialLength(freeMonth)} free
            </ButtonLink>
            <Button variant="outline" onClick={onUnlock}>
              See plans
            </Button>
          </>
        ) : (
          <Button onClick={onUnlock}>
            <Lock className="size-4" aria-hidden /> Unlock {app.name}
          </Button>
        )}
        {!ok && analyses !== null && (
          <Button variant="outline" onClick={onBuyAnalyses}>
            Pay per use
          </Button>
        )}
        <span className="readout ml-auto text-xs text-subtle">v{app.version}</span>
      </div>
    </Card>
  );
}

export function LauncherView({
  data,
  catalog,
  viewer,
  isAdmin,
  flash,
  notice,
}: {
  data: WorkspaceData;
  catalog: CatalogResponse | null;
  viewer: Viewer;
  isAdmin: boolean;
  flash: "verified" | "welcome" | "purchased" | null;
  notice: string | null;
}) {
  const { user } = data;
  const [unlock, setUnlock] = useState<WorkspaceApp | null>(null);
  const [buyFor, setBuyFor] = useState<WorkspaceApp | null>(null);
  const offerFor = (appId: string) => catalog?.payPerUse?.find((p) => p.appId === appId) ?? null;
  const [activated, setActivated] = useState(false);
  const [resent, setResent] = useState<"idle" | "busy" | "sent">("idle");
  const live = data.apps.filter(isAvailable);
  const licensed = live.filter((a) => entitled(a.entitlement)).length;
  const firstName = user.name.replace(/^(Dr|Prof)\.?\s+/i, "").split(/\s+/)[0];
  const n = notice ? NOTICES[notice] : undefined;
  const trial = trialState(data.trial);
  const canAskFree = trial === "none" || trial === "declined";

  async function resend() {
    setResent("busy");
    try {
      await api("/v1/auth/verify-email/resend", { method: "POST" });
      setResent("sent");
    } catch {
      setResent("idle");
    }
  }

  return (
    <div className="space-y-10">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Welcome{flash === "welcome" ? "" : " back"}, {firstName}</h1>
          <p className="mt-1 text-sm text-muted">
            {licensed === 0
              ? canAskFree
                ? `No application is open yet. Your first ${data.trialDays} days are free.`
                : "No application is open at the moment."
              : `${licensed} of ${live.length} applications open.`}
            {user.tier === "TRIAL" && (
              <>
                {" "}
                <Pill tone="live">Free month</Pill>
              </>
            )}
            {user.tier === "VIP" && (
              <>
                {" "}
                <Pill tone="accent">Complimentary access</Pill>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/workspace/billing" variant="outline" size="sm">
            <FileText className="size-4" aria-hidden /> Billing & invoices
          </ButtonLink>
          {isAdmin && (
            <ButtonLink href="/admin" variant="outline" size="sm">
              <Wrench className="size-4" aria-hidden /> Admin
            </ButtonLink>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {flash === "verified" && (
          <Alert tone="success" title="Email verified">
            {trial === "running" ? "Your free month has started." : "You can now start your free month, buy licences and receive invoices at this address."}
          </Alert>
        )}
        {data.trial && trial !== "none" && <TrialStatus trial={data.trial} />}
        {canAskFree && licensed === 0 && user.tier !== "VIP" && (
          <Alert
            tone="info"
            title={`Try AltVivo free for ${trialLength(data.trialDays)}`}
            action={
              <ButtonLink href="/free-month" size="sm">
                <Gift className="size-4" aria-hidden /> Request it
              </ButtonLink>
            }
          >
            {data.trialDays} days of full access to every live application. No card needed, nothing charged when it ends.
          </Alert>
        )}
        {flash === "purchased" && <Alert tone="success" title="Payment received">Your licence is active. A GST invoice has been emailed to your billing address.</Alert>}
        {n && <Alert tone={n.tone} title={n.title}>{n.body}</Alert>}
        {!user.emailVerified && (
          <Alert
            tone="warning"
            title="Verify your email address"
            action={
              <Button size="sm" variant="outline" onClick={resend} loading={resent === "busy"} disabled={resent === "sent"}>
                {resent === "sent" ? "Link sent" : "Resend link"}
              </Button>
            }
          >
            Your free month starts, and licences can be bought, only from a verified address. We sent a link to <span className="readout">{user.email}</span>.
          </Alert>
        )}
        {!user.mfa && (user.role === "INSTITUTE_ADMIN" || user.role === "SUPERADMIN") && (
          <Alert tone="info" title="Sign in with two-factor authentication" action={<Link href="/workspace/security#mfa" className="text-sm font-semibold text-accent-ink">Set up</Link>}>
            Administrator actions require a session verified with two-factor authentication.
          </Alert>
        )}
      </div>

      <section aria-labelledby="apps-h">
        <h2 id="apps-h" className="mb-4 text-sm font-semibold uppercase tracking-wider text-subtle">
          My applications
        </h2>
        <div className="grid gap-6 lg:grid-cols-2">
          {live.map((a) => (
            <LiveAppCard
              key={a.appId}
              app={a}
              activity={data.recentActivity.filter((x) => x.appId === a.appId)}
              onUnlock={() => setUnlock(a)}
              freeMonth={canAskFree ? data.trialDays : null}
              analyses={offerFor(a.appId) ? data.creditsRemaining : null}
              onBuyAnalyses={() => setBuyFor(a)}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="vault-h">
        <h2 id="vault-h" className="mb-4 text-sm font-semibold uppercase tracking-wider text-subtle">
          Research vault
        </h2>
        <Card>
          {data.recentFiles.length ? (
            <ul className="divide-y divide-line">
              {data.recentFiles.map((f) => (
                <li key={f.id} className="flex items-center gap-4 px-5 py-3 text-sm">
                  <FileText className="size-4 shrink-0 text-subtle" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{f.fileName}</span>
                  <span className="readout hidden text-xs text-subtle sm:inline">{f.sourceApp}</span>
                  <span className="readout text-xs text-subtle">{formatBytes(f.sizeBytes)}</span>
                  <DownloadLink id={f.id} name={f.fileName} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-subtle">Files you save from XPRISM and aMaze appear here.</p>
          )}
        </Card>
      </section>

      {buyFor && offerFor(buyFor.appId) && (
        <BuyAnalysesDialog
          open
          onClose={() => {
            setBuyFor(null);
            if (activated) window.location.reload();
          }}
          onActivated={() => setActivated(true)}
          offer={offerFor(buyFor.appId)!}
          app={buyFor}
          viewer={viewer}
          returnPath="/workspace"
        />
      )}
      {unlock && catalog && (
        <UnlockDialog
          open
          onClose={() => {
            setUnlock(null);
            if (activated) window.location.reload();
          }}
          onActivated={() => setActivated(true)}
          appId={unlock.appId}
          appName={unlock.name}
          catalog={catalog}
          viewer={viewer}
          apps={data.apps}
          returnPath={`/workspace/upgrade?app=${unlock.appId}`}
        />
      )}
      {unlock && !catalog && (
        <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md">
          <Alert tone="danger" title="Prices are unavailable right now" action={<Button size="sm" variant="ghost" onClick={() => setUnlock(null)}>Close</Button>}>
            Please retry in a moment, or see <a className="underline" href="/pricing">pricing</a>.
          </Alert>
        </div>
      )}
    </div>
  );
}

function DownloadLink({ id, name }: { id: string; name: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-xs font-semibold text-accent-ink hover:underline disabled:opacity-50"
      disabled={busy}
      aria-label={`Download ${name}`}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await api<{ url: string }>(`/v1/api/vault/files/${id}/download`);
          window.location.assign(r.url);
        } finally {
          setBusy(false);
        }
      }}
    >
      Download <ArrowUpRight className="size-3" aria-hidden />
    </button>
  );
}
