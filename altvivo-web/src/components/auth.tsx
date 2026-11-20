"use client";

import { PUBLIC } from "@/lib/config";

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 48 48" className="size-[18px]" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
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
