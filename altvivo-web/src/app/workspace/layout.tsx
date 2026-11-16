import type { Metadata } from "next";
import Link from "next/link";
import { LogOut, Zap } from "lucide-react";
import { Logo } from "@/components/brand";
import { ThemeToggle } from "@/components/client";
import { readSession } from "@/lib/server/session";
import { WorkspaceNav } from "./workspace-nav";

export const metadata: Metadata = { title: "Workspace", robots: { index: false } };

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const state = await readSession();
  const s = state.session;
  const initials = s ? (s.name || s.email).split(/\s+/).filter((p) => !/^dr\.?$/i.test(p)).map((p) => p[0]).slice(0, 2).join("").toUpperCase() : "";
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="AltVivo home" className="shrink-0">
            <Logo />
          </Link>
          {s && <WorkspaceNav isAdmin={s.role === "SUPERADMIN"} />}
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {s && (
              <Link
                href="/workspace/billing"
                className="readout hidden h-8 items-center gap-1.5 rounded-full border border-line px-3 text-xs hover:border-accent sm:flex"
                title="Pay per use: analyses left (one per animal / video)"
              >
                <Zap className="size-3.5 text-accent-ink" aria-hidden />
                {new Intl.NumberFormat("en-IN").format(s.creditsRemaining)}
                <span className="text-subtle">analyses</span>
              </Link>
            )}
            <div className="hidden md:block">
              <ThemeToggle />
            </div>
            {s && (
              <>
                <span className="grid size-8 place-items-center rounded-full brand-gradient text-xs font-bold text-white" title={`${s.name} · ${s.email}`} aria-hidden>
                  {initials}
                </span>
                <Link href="/logout?next=/" className="grid size-8 place-items-center rounded-lg text-subtle hover:bg-surface-2 hover:text-fg" title="Sign out">
                  <LogOut className="size-4" aria-hidden />
                  <span className="sr-only">Sign out</span>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>
    </div>
  );
}
