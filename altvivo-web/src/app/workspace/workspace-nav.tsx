"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export function WorkspaceNav({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  const items = [
    { href: "/workspace", label: "Applications" },
    { href: "/workspace/billing", label: "Billing" },
    { href: "/workspace/security", label: "Security" },
    ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
  ];
  return (
    <nav aria-label="Workspace" className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {items.map((i) => {
        const active = i.href === "/workspace" ? path === "/workspace" || path.startsWith("/workspace/upgrade") : path.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={cx("whitespace-nowrap rounded-lg px-3 py-2 text-sm transition", active ? "bg-surface-2 font-medium text-fg" : "text-muted hover:text-fg")}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
