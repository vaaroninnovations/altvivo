"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, BellRing, CalendarClock, FileText, History, Lock, Rocket, ShieldCheck, Wrench } from "lucide-react";
import { AppIcon, AppLogo, hasAppLogo } from "@/components/brand";
import type { Viewer } from "@/components/checkout";
import { Alert, Button, ButtonLink, Card, LicenceBadge, Pill, StatusBadge, entitled, formatBytes, formatDate } from "@/components/ui";
import { UnlockDialog } from "@/components/unlock";
import { api, ApiError } from "@/lib/api";
import { isAvailable } from "@/lib/catalog";
import type { CatalogResponse, WorkspaceApp, WorkspaceData } from "@/lib/types";

const SOURCE_TEXT: Record<string, string> = {
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
    body: "XPRISM could not match your sign-in to an active college or batch. Ask your institution administrator to add you, or buy a personal XPRISM licence.",
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
}: {
  app: WorkspaceApp;
  activity: WorkspaceData["recentActivity"];
  onUnlock: () => void;
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
              <ShieldCheck className="size-4" aria-hidden /> Active licence
            </p>
            <p className="mt-1 text-sm">
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
                  Renew now
                </button>
                . The new term starts when this one ends.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-surface-2 px-4 py-3">
            <p className="readout flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
              <Lock className="size-4" aria-hidden /> Locked: upgrade required
            </p>
            <p className="mt-1 text-sm text-muted">
              {e.active && e.expiresAt ? `Your licence ended on ${formatDate(e.expiresAt)}.` : `A licence for ${app.name} is needed to open it.`}
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
        ) : (
          <Button onClick={onUnlock}>
            <Lock className="size-4" aria-hidden /> Unlock {app.name}
          </Button>
        )}
        <span className="readout ml-auto text-xs text-subtle">v{app.version}</span>
      </div>
    </Card>
  );
}

function PipelineCard({ app }: { app: WorkspaceApp }) {
  const [listed, setListed] = useState(app.onWaitlist);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/api/waitlist/${app.appId}`, { method: listed ? "DELETE" : "POST" });
      setListed(!listed);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the waitlist.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="grid size-10 place-items-center rounded-xl border border-line bg-surface-2 text-muted">
          <AppIcon iconKey={app.iconKey} className="size-5" />
        </div>
        <StatusBadge status={app.status} />
      </div>
      <h3 className="mt-4 font-semibold">{app.name}</h3>
      <p className="mt-1 flex-1 text-sm text-muted">{app.tagline}</p>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <Button size="sm" variant={listed ? "ghost" : "outline"} className="mt-4" onClick={toggle} loading={busy}>
        <BellRing className="size-4" aria-hidden /> {listed ? "On the launch list · leave" : "Notify me at launch"}
      </Button>
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
  const [activated, setActivated] = useState(false);
  const [resent, setResent] = useState<"idle" | "busy" | "sent">("idle");
  const live = data.apps.filter(isAvailable);
  const pipeline = data.apps.filter((a) => a.status === "COMING_SOON");
  const licensed = live.filter((a) => entitled(a.entitlement)).length;
  const firstName = user.name.replace(/^(Dr|Prof)\.?\s+/i, "").split(/\s+/)[0];
  const n = notice ? NOTICES[notice] : undefined;

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
            {licensed === 0 ? "You have no active licence yet." : `${licensed} of ${live.length} applications licensed.`}
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
        {flash === "verified" && <Alert tone="success" title="Email verified">You can now buy licences and receive invoices at this address.</Alert>}
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
            Licences can be bought only from a verified address. We sent a link to <span className="readout">{user.email}</span>.
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
            <LiveAppCard key={a.appId} app={a} activity={data.recentActivity.filter((x) => x.appId === a.appId)} onUnlock={() => setUnlock(a)} />
          ))}
        </div>
      </section>

      {pipeline.length > 0 && (
        <section aria-labelledby="pipeline-h">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 id="pipeline-h" className="text-sm font-semibold uppercase tracking-wider text-subtle">
              Coming to AltVivo
            </h2>
            <p className="text-xs text-subtle">We email you once, at launch.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {pipeline.map((a) => (
              <PipelineCard key={a.appId} app={a} />
            ))}
          </div>
        </section>
      )}

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
