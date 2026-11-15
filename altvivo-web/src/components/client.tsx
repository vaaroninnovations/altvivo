"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Monitor, Moon, Sun, X } from "lucide-react";
import { PUBLIC } from "@/lib/config";
import { cx } from "./ui";

// ------------------------------------------------------------------ theme --
type ThemePref = "light" | "dark" | "system";
const THEME_KEY = "altvivo-theme";

/** Preferences are "functional" cookies-and-storage: persisted only with consent (see consent.tsx). */
function themeStore(): Storage | null {
  try {
    const raw = document.cookie.split("; ").find((c) => c.startsWith("altvivo_consent="));
    const functional = raw ? (JSON.parse(decodeURIComponent(raw.slice(16))) as { functional?: boolean }).functional === true : false;
    return functional ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function applyTheme(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>("system");
  useEffect(() => {
    try {
      setPref(((localStorage.getItem(THEME_KEY) ?? sessionStorage.getItem(THEME_KEY)) as ThemePref) || "system");
    } catch {
      /* storage blocked */
    }
  }, []);
  const choose = (p: ThemePref) => {
    setPref(p);
    try {
      themeStore()?.setItem(THEME_KEY, p);
    } catch {
      /* storage blocked */
    }
    applyTheme(p);
  };
  const options: { value: ThemePref; label: string; Icon: typeof Sun }[] = [
    { value: "light", label: "Light", Icon: Sun },
    { value: "system", label: "System", Icon: Monitor },
    { value: "dark", label: "Dark", Icon: Moon },
  ];
  return (
    <div role="radiogroup" aria-label="Colour theme" className="inline-flex rounded-full border border-line bg-surface p-0.5">
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          title={label}
          onClick={() => choose(value)}
          className={cx("grid size-7 place-items-center rounded-full transition", pref === value ? "bg-surface-3 text-fg" : "text-subtle hover:text-fg")}
        >
          <Icon className="size-3.5" aria-hidden />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ switch --
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition disabled:opacity-50",
        checked ? "border-accent bg-accent" : "border-line-strong bg-surface-3",
      )}
    >
      <span className={cx("inline-block size-4.5 rounded-full bg-white shadow transition", checked ? "translate-x-5.5" : "translate-x-0.5")} />
    </button>
  );
}

// ------------------------------------------------------------------ dialog --
export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cx(
        "m-auto w-[calc(100%-2rem)] rounded-2xl border border-line bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm",
        wide ? "max-w-2xl" : "max-w-md",
      )}
    >
      {open && (
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-subtle hover:bg-surface-2 hover:text-fg" aria-label="Close">
              <X className="size-5" aria-hidden />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

// --------------------------------------------------------------- turnstile --
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

let turnstileLoader: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  turnstileLoader ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      turnstileLoader = null;
      reject(new Error("Turnstile failed to load"));
    };
    document.head.appendChild(s);
  });
  return turnstileLoader;
}

/** Cloudflare Turnstile. `onToken(null)` when expired/reset. Call `reset()` via the returned key change after a failed submit. */
export function Turnstile({ onToken, action, resetKey = 0 }: { onToken: (t: string | null) => void; action: string; resetKey?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  const stableOnToken = useRef(onToken);
  stableOnToken.current = onToken;

  useEffect(() => {
    let cancelled = false;
    if (!PUBLIC.turnstileSiteKey) {
      setFailed(true);
      return;
    }
    loadTurnstile()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile) return;
        widget.current = window.turnstile.render(box.current, {
          sitekey: PUBLIC.turnstileSiteKey,
          action,
          theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
          callback: (t: string) => stableOnToken.current(t),
          "expired-callback": () => stableOnToken.current(null),
          "error-callback": () => stableOnToken.current(null),
        });
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [action]);

  useEffect(() => {
    if (resetKey > 0 && widget.current) {
      window.turnstile?.reset(widget.current);
      stableOnToken.current(null);
    }
  }, [resetKey]);

  if (failed) {
    return <p className="text-xs text-danger">Human verification could not load. Disable content blockers for this page and reload.</p>;
  }
  return <div ref={box} className="min-h-[65px]" />;
}

/** Re-renders children with a fresh key so forms can reset Turnstile after an error. */
export function useResetCounter() {
  const [n, setN] = useState(0);
  return [n, useCallback(() => setN((v) => v + 1), [])] as const;
}
