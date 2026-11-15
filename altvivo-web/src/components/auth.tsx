"use client";

import { PUBLIC } from "@/lib/config";

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3 14.7 2 12 2 6.5 2 2 6.5 2 12s4.5 10 10 10c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.7H12z" />
    </svg>
  );
}

function OrcidGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <circle cx="12" cy="12" r="11" fill="#A6CE39" />
      <path fill="#fff" d="M8.3 17.3H6.9V7.7h1.4v9.6zM7.6 5.4a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8zm3 2.3h3.8c3.6 0 5.2 2.6 5.2 4.8 0 2.4-1.9 4.8-5.2 4.8h-3.8V7.7zm1.4 8.3h2.2c3.2 0 3.9-2.4 3.9-3.5 0-1.8-1.2-3.5-3.8-3.5H12V16z" />
    </svg>
  );
}

/** Google / ORCID sign-in (server-side OAuth flow at the IdP, PKCE + state cookie). */
export function OAuthButtons({ next }: { next: string }) {
  const absNext = next.startsWith("http") ? next : `${PUBLIC.siteUrl}${next}`;
  const href = (p: "google" | "orcid") => `${PUBLIC.apiUrl}/v1/auth/oauth/${p}/start?next=${encodeURIComponent(absNext)}`;
  return (
    <div className="grid grid-cols-2 gap-3">
      <a href={href("google")} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface text-sm font-medium hover:border-accent">
        <GoogleGlyph /> Google
      </a>
      <a href={href("orcid")} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface text-sm font-medium hover:border-accent">
        <OrcidGlyph /> ORCID
      </a>
    </div>
  );
}

export function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-xs text-subtle" aria-hidden>
      <span className="h-px flex-1 bg-line" />
      {label}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

/** Full navigation so server components re-read the fresh session cookie. */
export function go(url: string) {
  window.location.assign(url);
}
