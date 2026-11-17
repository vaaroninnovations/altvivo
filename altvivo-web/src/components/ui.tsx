import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, Lock, XCircle } from "lucide-react";
import type { ApiEntitlement, AppStatus } from "@/lib/types";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "brand-gradient text-white hover:brightness-110 shadow-[0_10px_28px_-12px_var(--glow)]",
  secondary: "bg-fg text-bg hover:opacity-90",
  outline: "border border-line-strong text-fg hover:border-accent/60 hover:text-accent-ink bg-surface/80",
  ghost: "text-muted hover:text-fg hover:bg-surface-2",
  danger: "bg-danger text-white hover:brightness-110",
};
const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-6 text-base gap-2 rounded-xl",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra?: string) {
  return cx(
    "inline-flex items-center justify-center font-semibold transition disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap",
    VARIANT[variant],
    SIZE[size],
    extra,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  ...rest
}: ComponentProps<"button"> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
  external,
  ...rest
}: { href: string; variant?: Variant; size?: Size; className?: string; children: ReactNode; external?: boolean } & Omit<ComponentProps<"a">, "href">) {
  const cls = buttonClass(variant, size, className);
  if (external || /^https?:\/\//.test(href)) {
    return (
      <a href={href} className={cls} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} {...rest}>
      {children}
    </Link>
  );
}

// ------------------------------------------------------------------ badges --
export function Pill({ tone, children, className }: { tone: "live" | "soon" | "accent" | "muted" | "danger"; children: ReactNode; className?: string }) {
  const tones = {
    live: "text-live-ink bg-live-soft border-live/30",
    soon: "text-soon-ink bg-soon-soft border-soon/30",
    accent: "text-accent-ink bg-accent-soft border-accent/30",
    muted: "text-subtle bg-surface-2 border-line",
    danger: "text-danger bg-danger-soft border-danger/30",
  };
  return (
    <span className={cx("readout inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider", tones[tone], className)}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: AppStatus }) {
  if (status === "LIVE")
    return (
      <Pill tone="live">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-live" />
        </span>
        Live
      </Pill>
    );
  if (status === "BETA") return <Pill tone="accent">Beta</Pill>;
  return <Pill tone="muted">Maintenance</Pill>;
}

const SOURCE_LABEL: Record<NonNullable<ApiEntitlement["source"]>, string> = {
  trial: "Free month",
  payg: "Pay per use",
  individual: "Licensed",
  bundle: "Dual-Suite",
  institution: "Institution",
  manual: "Licensed",
  vip: "Complimentary",
};

/** Access in force now (an entitlement can lapse during a long-lived page). */
export const entitled = (e: ApiEntitlement | undefined) => !!e?.active && (!e.expiresAt || new Date(e.expiresAt).getTime() > Date.now());

export function LicenceBadge({ entitlement }: { entitlement: ApiEntitlement | undefined }) {
  if (!entitled(entitlement)) {
    return (
      <Pill tone="muted">
        <Lock className="size-3" aria-hidden /> Locked
      </Pill>
    );
  }
  return (
    <Pill tone="live">
      <CheckCircle2 className="size-3" aria-hidden /> {SOURCE_LABEL[entitlement!.source ?? "individual"]}
    </Pill>
  );
}

// ------------------------------------------------------------------ layout --
export function Card({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div {...rest} className={cx("elevated rounded-2xl border border-line bg-surface", className)}>
      {children}
    </div>
  );
}

export function Alert({ tone = "info", title, children, action }: { tone?: "info" | "success" | "warning" | "danger"; title?: string; children?: ReactNode; action?: ReactNode }) {
  const map = {
    info: { icon: Info, cls: "border-accent/30 bg-accent-soft text-fg", ic: "text-accent-ink" },
    success: { icon: CheckCircle2, cls: "border-live/30 bg-live-soft text-fg", ic: "text-live-ink" },
    warning: { icon: AlertTriangle, cls: "border-soon/30 bg-soon-soft text-fg", ic: "text-soon-ink" },
    danger: { icon: XCircle, cls: "border-danger/30 bg-danger-soft text-fg", ic: "text-danger" },
  }[tone];
  const Icon = map.icon;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center", map.cls)}>
      <Icon className={cx("size-5 shrink-0", map.ic)} aria-hidden />
      <div className="flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-muted">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Field({ label, id, error, hint, children }: { label: string; id: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-fg">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export function SectionHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3">
        <span className="rule-mark" aria-hidden />
        <p className="eyebrow">{eyebrow}</p>
      </div>
      <h2 className="mt-4 text-[2rem] leading-[1.1] text-fg text-balance sm:text-[2.6rem]">{title}</h2>
      {children && <p className="mt-4 text-base leading-relaxed text-muted">{children}</p>}
    </div>
  );
}

export function formatDate(iso: string, withTime = false) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", ...(withTime ? { timeStyle: "short" } : {}) }).format(new Date(iso));
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
