"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Cookie, ShieldCheck } from "lucide-react";
import { PUBLIC } from "@/lib/config";
import { csrfToken } from "@/lib/api";
import { POLICY_VERSION } from "@/lib/policy";
import { Dialog, Switch } from "./client";
import { Button, cx } from "./ui";

/**
 * Cookie consent (DPDPA 2023 s.6 / GDPR Art. 7 / ePrivacy).
 *
 * The choice lives in the first-party cookie `altvivo_consent`, scoped to
 * .altvivo.bio so every AltVivo app can honour it, and each decision is
 * also recorded server-side as append-only evidence (POST /v1/public/consent).
 * Strictly necessary cookies (sign-in, CSRF, payment security) need no
 * consent and cannot be switched off here.
 */

export interface ConsentState {
  version: string;
  subjectId: string | null;
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
  decidedAt: string;
}

const COOKIE = "altvivo_consent";
const OPEN_EVENT = "altvivo:open-consent";
export const CONSENT_EVENT = "altvivo:consent";
const THEME_KEY = "altvivo-theme";

function cookieDomain(): string {
  const host = window.location.hostname;
  const site = new URL(PUBLIC.siteUrl).hostname;
  return host === site || host.endsWith(`.${site}`) ? `; Domain=.${site}` : "";
}

export function readConsent(): ConsentState | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie.split("; ").find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw.slice(COOKIE.length + 1))) as Partial<ConsentState>;
    if (typeof v.version !== "string") return null;
    return {
      version: v.version,
      subjectId: typeof v.subjectId === "string" ? v.subjectId : null,
      functional: v.functional === true,
      analytics: v.analytics === true,
      marketing: v.marketing === true,
      decidedAt: typeof v.decidedAt === "string" ? v.decidedAt : "",
    };
  } catch {
    return null;
  }
}

function writeConsent(c: ConsentState) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify(c))}; Path=/; Max-Age=${365 * 86400}; SameSite=Lax${cookieDomain()}${secure}`;
}

/** Preference storage is "functional": without consent the theme lasts only for this tab. */
export function preferenceStorage(): Storage | null {
  try {
    return readConsent()?.functional ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function openCookiePreferences() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

type Choice = Pick<ConsentState, "functional" | "analytics" | "marketing">;
type Action = "ACCEPT_ALL" | "REJECT_NON_ESSENTIAL" | "CUSTOM";

async function record(action: Action, choice: Choice, subjectId: string | null): Promise<string | null> {
  try {
    const send = async (fresh: boolean) =>
      fetch(`${PUBLIC.apiUrl}/v1/public/consent`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": await csrfToken(fresh) },
        body: JSON.stringify({ ...(subjectId ? { subjectId } : {}), policyVersion: POLICY_VERSION, action, ...choice, source: "banner" }),
      });
    let res = await send(false);
    if (res.status === 403) res = await send(true);
    if (!res.ok) return subjectId;
    return ((await res.json()) as { subjectId: string }).subjectId;
  } catch {
    // The choice is still honoured locally; evidence is retried on the next change.
    return subjectId;
  }
}

const CATEGORIES: { key: keyof Choice; title: string; body: string }[] = [
  {
    key: "functional",
    title: "Preferences",
    body: "Remembers choices such as light or dark mode on this device. Without it, those choices last only until you close the tab.",
  },
  {
    key: "analytics",
    title: "Analytics",
    body: "Aggregate usage statistics. The AltVivo portal does not run analytics today; XPRISM asks separately before loading any. Your choice here applies if we add them.",
  },
  {
    key: "marketing",
    title: "Marketing",
    body: "Advertising or remarketing cookies. AltVivo does not use any; this stays off unless you switch it on.",
  },
];

export function CookieConsent() {
  const [state, setState] = useState<ConsentState | null>(null);
  const [ready, setReady] = useState(false);
  const [banner, setBanner] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [draft, setDraft] = useState<Choice>({ functional: false, analytics: false, marketing: false });
  const [saving, setSaving] = useState(false);
  const titleId = useId();

  useEffect(() => {
    const c = readConsent();
    setState(c);
    setBanner(!c || c.version !== POLICY_VERSION);
    setReady(true);
    const open = () => {
      const cur = readConsent();
      setDraft({ functional: cur?.functional ?? false, analytics: cur?.analytics ?? false, marketing: cur?.marketing ?? false });
      setDialog(true);
    };
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);

  const decide = useCallback(
    async (action: Action, choice: Choice) => {
      setSaving(true);
      const prev = readConsent();
      const local: ConsentState = { version: POLICY_VERSION, subjectId: prev?.subjectId ?? null, ...choice, decidedAt: new Date().toISOString() };
      writeConsent(local);
      if (!choice.functional) {
        try {
          // Withdrawn: forget stored preferences but keep the current tab's look.
          const theme = window.localStorage.getItem(THEME_KEY);
          window.localStorage.removeItem(THEME_KEY);
          if (theme) window.sessionStorage.setItem(THEME_KEY, theme);
        } catch {
          /* storage blocked */
        }
      }
      setState(local);
      setBanner(false);
      setDialog(false);
      window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: local }));
      const subjectId = await record(action, choice, local.subjectId);
      if (subjectId && subjectId !== local.subjectId) writeConsent({ ...local, subjectId });
      setSaving(false);
    },
    [],
  );

  if (!ready) return null;

  return (
    <>
      {banner && (
        <section
          role="region"
          aria-labelledby={titleId}
          className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-3xl rounded-2xl border border-line bg-surface/95 p-5 shadow-2xl backdrop-blur-md sm:inset-x-6 sm:bottom-6"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink">
              <Cookie className="size-5" aria-hidden />
            </div>
            <div className="flex-1">
              <h2 id={titleId} className="font-semibold">
                Cookies on AltVivo
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                We use strictly necessary cookies to keep you signed in across AltVivo apps, protect forms and process payments. With your
                permission we also remember preferences such as dark mode. We do not use advertising cookies. Read the{" "}
                <a href="/cookies" className="text-accent-ink underline underline-offset-2">
                  Cookie Policy
                </a>
                .
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => decide("ACCEPT_ALL", { functional: true, analytics: true, marketing: true })} disabled={saving}>
                  Accept all
                </Button>
                <Button size="sm" variant="outline" onClick={() => decide("REJECT_NON_ESSENTIAL", { functional: false, analytics: false, marketing: false })} disabled={saving}>
                  Reject non-essential
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraft({ functional: state?.functional ?? false, analytics: state?.analytics ?? false, marketing: state?.marketing ?? false });
                    setDialog(true);
                  }}
                >
                  Customise
                </Button>
              </div>
            </div>
          </div>
        </section>
      )}

      <Dialog open={dialog} onClose={() => setDialog(false)} title="Cookie preferences" wide>
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4 rounded-xl border border-line bg-surface-2 p-4">
            <div>
              <p className="flex items-center gap-2 font-medium">
                <ShieldCheck className="size-4 text-live-ink" aria-hidden /> Strictly necessary
              </p>
              <p className="mt-1 text-sm text-muted">
                Sign-in (<code className="readout text-xs">altvivo_at</code>, <code className="readout text-xs">altvivo_rt</code>), form protection (
                <code className="readout text-xs">altvivo_csrf</code>), bot protection and payment security. Always on.
              </p>
            </div>
            <span className="readout shrink-0 text-xs text-subtle">Always on</span>
          </div>
          {CATEGORIES.map((c) => (
            <div key={c.key} className={cx("flex items-start justify-between gap-4 rounded-xl border border-line p-4", draft[c.key] && "border-accent/40")}>
              <div>
                <p className="font-medium">{c.title}</p>
                <p className="mt-1 text-sm text-muted">{c.body}</p>
              </div>
              <Switch checked={draft[c.key]} onChange={(v) => setDraft((d) => ({ ...d, [c.key]: v }))} label={c.title} />
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => decide("REJECT_NON_ESSENTIAL", { functional: false, analytics: false, marketing: false })} disabled={saving}>
            Reject non-essential
          </Button>
          <Button onClick={() => decide("CUSTOM", draft)} loading={saving}>
            Save choices
          </Button>
        </div>
        {state?.decidedAt && (
          <p className="readout mt-4 text-xs text-subtle">
            Last choice: {new Date(state.decidedAt).toLocaleString("en-IN")} · policy {state.version}
          </p>
        )}
      </Dialog>
    </>
  );
}

/** Footer link that reopens the preferences dialog. */
export function CookiePreferencesLink({ className }: { className?: string }) {
  return (
    <button type="button" onClick={openCookiePreferences} className={cx("text-left text-muted hover:text-fg", className)}>
      Cookie preferences
    </button>
  );
}
