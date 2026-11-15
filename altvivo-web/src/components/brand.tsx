import { Box, FileSearch, FlaskConical, Leaf, Pill, ScanEye, Sigma, type LucideIcon } from "lucide-react";
import { cx } from "./ui";

const ICONS: Record<string, LucideIcon> = {
  "flask-conical": FlaskConical,
  "scan-eye": ScanEye,
  pill: Pill,
  sigma: Sigma,
  leaf: Leaf,
  "file-search": FileSearch,
};

export function AppIcon({ iconKey, className }: { iconKey: string; className?: string }) {
  const Icon = ICONS[iconKey] ?? Box;
  return <Icon className={className} aria-hidden strokeWidth={1.75} />;
}

/*
 * Official AltVivo artwork (public/brand). Each asset has a lightened twin for
 * dark mode so the ultramarine end of the gradient stays legible on midnight ink.
 * Plain <img> keeps the files cacheable as-is; intrinsic sizes prevent layout shift.
 */

/** The mouse-and-pixel "av" mark. Height-driven: size it with an h-* class. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex shrink-0", className ?? "h-7")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/altvivo-mark.png" width={512} height={332} alt="" aria-hidden className="h-full w-auto dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/altvivo-mark-dark.png" width={512} height={332} alt="" aria-hidden className="hidden h-full w-auto dark:block" />
    </span>
  );
}

/** Full wordmark lock-up (mark + "altvivo"). Height-driven, h-8 by default. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex shrink-0 items-center", className)}>
      <span className="sr-only">AltVivo</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/altvivo-wordmark.png" width={1200} height={392} alt="" aria-hidden className="h-8 w-auto dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/altvivo-wordmark-dark.png" width={1200} height={392} alt="" aria-hidden className="hidden h-8 w-auto dark:block" />
    </span>
  );
}

/* Product logos. Shown on a white plate in both themes: the artwork has dark
 * navy type that would disappear on the dark background. */
const APP_LOGOS: Record<string, { src: string; w: number; h: number }> = {
  xprism: { src: "/brand/xprism-logo.png", w: 900, h: 407 },
  amaze: { src: "/brand/amaze-logo.png", w: 900, h: 345 },
};

export const hasAppLogo = (appId: string) => appId in APP_LOGOS;

/** Product logo on a white plate. `className` sets the plate size (height-driven). */
export function AppLogo({ appId, name, className }: { appId: string; name: string; className?: string }) {
  const l = APP_LOGOS[appId];
  if (!l) return null;
  return (
    <span className={cx("inline-flex shrink-0 items-center justify-center rounded-xl border border-line bg-white px-3 py-2", className ?? "h-14")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={l.src} width={l.w} height={l.h} alt={`${name} logo`} className="h-full w-auto" />
    </span>
  );
}
