"use client";

import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";

/** Small-screen navigation (the desktop nav is hidden below `lg`). */
export function MobileNav({ items, signInHref }: { items: { href: string; label: string }[]; signInHref: string | null }) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div ref={panel} className="relative lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen((v) => !v)}
        className="grid size-9 place-items-center rounded-lg border border-line text-muted hover:text-fg"
      >
        {open ? <X className="size-4.5" aria-hidden /> : <Menu className="size-4.5" aria-hidden />}
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
      </button>
      {open && (
        <nav id="mobile-nav" aria-label="Main" className="absolute right-0 top-11 w-60 rounded-2xl border border-line bg-surface p-2 shadow-2xl">
          {items.map((n) => (
            <a key={n.href} href={n.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 text-sm text-muted hover:bg-surface-2 hover:text-fg">
              {n.label}
            </a>
          ))}
          {signInHref && (
            <a href={signInHref} className="mt-1 block rounded-lg border-t border-line px-3 py-2.5 text-sm font-medium text-fg hover:bg-surface-2">
              Sign in
            </a>
          )}
        </nav>
      )}
    </div>
  );
}
