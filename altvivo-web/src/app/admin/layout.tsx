import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, LogOut } from "lucide-react";
import { Logo } from "@/components/brand";
import { ThemeToggle } from "@/components/client";
import { readSession, redirectToSignIn } from "@/lib/server/session";
import { AdminShell } from "./admin-shell";

export const metadata: Metadata = { title: { default: "SuperAdmin", template: "%s · SuperAdmin · AltVivo" }, robots: { index: false, follow: false } };

/**
 * /admin is restricted to role === "SUPERADMIN" on a session verified with
 * TOTP. Core enforces the same on every /v1/api/admin/* call; this guard
 * only keeps everyone else from seeing the shell.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const state = await readSession();
  if (!state.session) redirectToSignIn("/admin", false);
  const s = state.session;
  if (s.role !== "SUPERADMIN") redirect("/workspace");
  if (s.mfaEnrollmentRequired) redirect("/workspace/security?enroll=1");

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
        <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
          <Link href="/admin" aria-label="SuperAdmin home" className="flex items-center gap-3">
            <Logo />
            <span className="readout rounded-md border border-danger/40 bg-danger-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-danger">Admin</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/workspace" className="hidden items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted hover:text-fg sm:inline-flex">
              <ArrowLeft className="size-4" aria-hidden /> Workspace
            </Link>
            <div className="hidden md:block">
              <ThemeToggle />
            </div>
            <span className="hidden text-sm text-muted lg:inline">{s.email}</span>
            <Link href="/logout?next=/" className="grid size-8 place-items-center rounded-lg text-subtle hover:bg-surface-2 hover:text-fg" title="Sign out">
              <LogOut className="size-4" aria-hidden />
              <span className="sr-only">Sign out</span>
            </Link>
          </div>
        </div>
      </header>
      <AdminShell mfa={s.mfa}>{children}</AdminShell>
    </div>
  );
}
