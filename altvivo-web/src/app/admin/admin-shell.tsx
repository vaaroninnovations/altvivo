"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, FileText, Gauge, Gift, Inbox, KeyRound, LayoutGrid, Mail, ScrollText, Users, UserSquare2, Wallet } from "lucide-react";
import { SignerProvider } from "@/components/admin/kit";
import { Alert, cx } from "@/components/ui";

const NAV = [
  { href: "/admin", label: "Dashboard", Icon: Gauge },
  { href: "/admin/mail", label: "Mailbox", Icon: Mail },
  { href: "/admin/trials", label: "Free-month requests", Icon: Gift },
  { href: "/admin/users", label: "Users", Icon: Users },
  { href: "/admin/licences", label: "Manual licences", Icon: KeyRound },
  { href: "/admin/institutions", label: "Institutions", Icon: Building2 },
  { href: "/admin/invoices", label: "Invoices", Icon: FileText },
  { href: "/admin/payments", label: "Payments", Icon: Wallet },
  { href: "/admin/apps", label: "Apps & pricing", Icon: LayoutGrid },
  { href: "/admin/advisory", label: "Advisory board", Icon: UserSquare2 },
  { href: "/admin/contact", label: "Contact enquiries", Icon: Inbox },
  { href: "/admin/audit", label: "Audit log", Icon: ScrollText },
];

export function AdminShell({ mfa, children }: { mfa: boolean; children: React.ReactNode }) {
  const path = usePathname();
  return (
    <SignerProvider>
      <div className="lg:grid lg:grid-cols-[15rem_1fr]">
        <nav aria-label="Admin" className="border-b border-line lg:sticky lg:top-14 lg:h-[calc(100dvh-3.5rem)] lg:border-b-0 lg:border-r">
          <ul className="flex gap-1 overflow-x-auto p-3 lg:flex-col lg:overflow-visible">
            {NAV.map(({ href, label, Icon }) => {
              const active = href === "/admin" ? path === "/admin" : path.startsWith(href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition",
                      active ? "bg-surface-2 font-medium text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden /> {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <main id="main" className="min-w-0 px-4 py-8 sm:px-8 lg:py-10">
          {!mfa && (
            <div className="mb-6">
              <Alert tone="warning" title="Two-factor session required">
                This session was not verified with your authenticator. Sign out and sign in again to use administrator functions.
              </Alert>
            </div>
          )}
          {children}
        </main>
      </div>
    </SignerProvider>
  );
}
