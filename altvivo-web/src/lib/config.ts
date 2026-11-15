/** Values inlined at build time (NEXT_PUBLIC_*) - safe to ship to the browser. */
export const PUBLIC = {
  apiUrl: (process.env.NEXT_PUBLIC_API_URL ?? "https://api.altvivo.bio").replace(/\/$/, ""),
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? "https://altvivo.bio").replace(/\/$/, ""),
  embedUrl: process.env.NEXT_PUBLIC_EMBED_URL ?? "https://embed.altvivo.bio/bar.js",
  turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
  razorpayKeyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? "",
} as const;

export const siteOrigin = new URL(PUBLIC.siteUrl).origin;
export const siteHost = new URL(PUBLIC.siteUrl).hostname;

/**
 * Same-site redirect targets only: the portal itself, any https app on
 * *.altvivo.bio, and (development) localhost. Everything else falls back.
 */
export function safeNext(raw: string | null | undefined, fallback = "/workspace"): string {
  if (!raw) return fallback;
  try {
    const url = new URL(raw, siteOrigin);
    if (url.username || url.password) return fallback;
    if (url.origin === siteOrigin) return url.pathname.startsWith("//") ? fallback : `${url.pathname}${url.search}${url.hash}`;
    const okHost = url.hostname === siteHost || url.hostname.endsWith(`.${siteHost}`);
    if (okHost && url.protocol === "https:") return url.toString();
    if (url.hostname === "localhost" && new URL(siteOrigin).hostname === "localhost") return url.toString();
    return fallback;
  } catch {
    return fallback;
  }
}

/** Absolute URL on the portal (needed on phase-2 subdomains, where relative links would stay on the subdomain). */
export const portal = (path: string) => `${siteOrigin}${path.startsWith("/") ? path : `/${path}`}`;
