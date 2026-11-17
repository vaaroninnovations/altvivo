import type { Metadata } from "next";
import { ArrowLeft, Wrench } from "lucide-react";
import { AppIcon, AppLogo, hasAppLogo } from "@/components/brand";
import { SiteFooter, SiteHeader } from "@/components/site";
import { ButtonLink, StatusBadge } from "@/components/ui";
import { portal } from "@/lib/config";
import { getPublicApps } from "@/lib/server/core";

export const metadata: Metadata = { title: "Temporarily unavailable", robots: { index: false, follow: true } };

/**
 * Shown by Caddy (and the paid gate) as /maintenance?app=<id> while an
 * application is in maintenance or its container is down. All links are
 * absolute to the portal, because Caddy can serve this under the app's host.
 */
export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ app?: string }> }) {
  const { app: appId = "" } = await searchParams;
  const apps = await getPublicApps();
  const app = apps.find((a) => a.appId === appId.toLowerCase());

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader absolute />
      <main id="main" className="flex-1 border-b border-line">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:py-24">
          <div>
            <a href={portal("/")} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
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
                  <StatusBadge status="MAINTENANCE" />
                </div>
                <p className="eyebrow mt-8">Temporarily unavailable</p>
                <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{app.name}</h1>
                <p className="mt-3 text-lg text-accent-ink">{app.tagline}</p>
                <p className="mt-5 max-w-xl leading-relaxed text-muted">
                  {app.name} is being updated and will be back shortly. Your data and session are safe. Refresh this page in a few minutes.
                </p>
              </>
            ) : (
              <>
                <h1 className="mt-8 text-4xl font-semibold tracking-tight">Temporarily unavailable</h1>
                <p className="mt-4 text-muted">This AltVivo application is being updated and will be back shortly.</p>
              </>
            )}
          </div>

          <div className="lg:pt-16">
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
          </div>
        </div>
      </main>
      <SiteFooter absolute />
    </div>
  );
}
