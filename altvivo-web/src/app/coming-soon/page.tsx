import type { Metadata } from "next";
import { ArrowLeft, Check, Wrench } from "lucide-react";
import { AppIcon, AppLogo, hasAppLogo } from "@/components/brand";
import { SiteFooter, SiteHeader } from "@/components/site";
import { ButtonLink, StatusBadge } from "@/components/ui";
import { WaitlistForm } from "@/components/waitlist";
import { portal } from "@/lib/config";
import { getPublicApps } from "@/lib/server/core";

export const metadata: Metadata = { title: "Launching soon", robots: { index: false, follow: true } };

/**
 * Served by Caddy on phase-2 subdomains (pharmadme.altvivo.bio, ...) as
 * /coming-soon?app=<id>, and on live spokes during an outage with
 * &state=maintenance. All links are absolute to the portal.
 */
export default async function ComingSoonPage({ searchParams }: { searchParams: Promise<{ app?: string; state?: string }> }) {
  const { app: appId = "", state } = await searchParams;
  const apps = await getPublicApps();
  const app = apps.find((a) => a.appId === appId.toLowerCase());
  const maintenance = state === "maintenance";

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader absolute />
      <main id="main" className="flex-1 border-b border-line">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:py-24">
          <div>
            <a href={portal("/#roadmap")} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
              <ArrowLeft className="size-4" aria-hidden /> All AltVivo applications
            </a>
            {app ? (
              <>
                <div className="mt-8 flex items-center gap-4">
                  {hasAppLogo(app.appId) ? (
                    <AppLogo appId={app.appId} name={app.name} className="h-20" />
                  ) : (
                    <div className="grid size-14 place-items-center rounded-2xl border border-accent/30 bg-accent-soft text-accent-ink">
                      <AppIcon iconKey={app.iconKey} className="size-7" />
                    </div>
                  )}
                  <StatusBadge status={maintenance ? "MAINTENANCE" : app.status} />
                </div>
                <p className="eyebrow mt-8">{maintenance ? "Temporarily unavailable" : "Launching soon on AltVivo"}</p>
                <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{app.name}</h1>
                <p className="mt-3 text-lg text-accent-ink">{app.tagline}</p>
                <p className="mt-5 max-w-xl leading-relaxed text-muted">
                  {maintenance
                    ? `${app.name} is being updated and will be back shortly. Your data and session are safe. Refresh this page in a few minutes.`
                    : app.description}
                </p>
                {!maintenance && (
                  <ul className="mt-8 space-y-3">
                    {app.highlights.map((h) => (
                      <li key={h} className="flex gap-3">
                        <Check className="mt-0.5 size-5 shrink-0 text-live-ink" aria-hidden />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <>
                <h1 className="mt-8 text-4xl font-semibold tracking-tight">Something new is coming</h1>
                <p className="mt-4 text-muted">This AltVivo application is not public yet.</p>
              </>
            )}
          </div>

          <div className="lg:pt-16">
            {maintenance ? (
              <div className="glow rounded-2xl border border-line bg-surface p-7">
                <Wrench className="size-6 text-accent-ink" aria-hidden />
                <h2 className="mt-4 text-lg font-semibold">Scheduled work in progress</h2>
                <p className="mt-2 text-sm text-muted">Other AltVivo applications are unaffected.</p>
                <div className="mt-6 flex flex-wrap gap-3">
                  {app && (
                    <ButtonLink href={app.url} external>
                      Try again
                    </ButtonLink>
                  )}
                  <ButtonLink href={portal("/workspace")} variant="outline" external>
                    Open workspace
                  </ButtonLink>
                </div>
              </div>
            ) : app && app.status === "COMING_SOON" ? (
              <div className="glow rounded-2xl border border-line bg-surface p-7">
                <h2 className="text-lg font-semibold">Get early access</h2>
                <p className="mb-6 mt-2 text-sm text-muted">
                  We will email you at launch. AltVivo subscribers get early-bird access to {app.name} included in their plan.
                </p>
                <WaitlistForm appId={app.appId} appName={app.name} source="coming-soon" />
              </div>
            ) : app ? (
              <div className="glow rounded-2xl border border-line bg-surface p-7">
                <h2 className="text-lg font-semibold">{app.name} is available</h2>
                <ButtonLink href={app.url} className="mt-5" external>
                  Open {app.name}
                </ButtonLink>
              </div>
            ) : (
              <ButtonLink href={portal("/")} external>
                Go to altvivo.bio
              </ButtonLink>
            )}
          </div>
        </div>
      </main>
      <SiteFooter absolute />
    </div>
  );
}
