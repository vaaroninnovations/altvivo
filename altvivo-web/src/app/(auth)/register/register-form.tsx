"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Divider, OAuthButtons, go } from "@/components/auth";
import { Turnstile, useResetCounter } from "@/components/client";
import { Alert, Button, Field, cx } from "@/components/ui";
import { PUBLIC } from "@/lib/config";
import { api, ApiError, fieldErrors } from "@/lib/api";

interface Pending {
  provider: string;
  name: string;
  email: string | null;
  orcidId: string | null;
}

function strength(pw: string): { score: number; label: string } {
  let s = 0;
  if (pw.length >= 12) s++;
  if (pw.length >= 16) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) s++;
  return { score: s, label: ["Too short", "Weak", "Fair", "Good", "Strong"][s] ?? "Strong" };
}

export function RegisterForm({ next, oauthPendingId }: { next: string; oauthPendingId: string | null }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [form, setForm] = useState({ fullName: "", email: "", password: "", affiliation: "", role: "RESEARCHER" });
  const [agree, setAgree] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [resetKey, reset] = useResetCounter();
  const pw = useMemo(() => strength(form.password), [form.password]);

  useEffect(() => {
    if (!oauthPendingId) return;
    fetch(`${PUBLIC.apiUrl}/v1/auth/oauth/pending/${oauthPendingId}`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const p = (await r.json()) as Pending;
        setPending(p);
        setForm((f) => ({ ...f, fullName: p.name || f.fullName, email: p.email ?? f.email }));
      })
      .catch(() => setPendingError("Your ORCID sign-up expired. Start again with the ORCID button below."));
  }, [oauthPendingId]);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token) return setError("Please complete the human check.");
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await api("/v1/auth/register", {
        method: "POST",
        body: {
          email: form.email,
          fullName: form.fullName,
          affiliation: form.affiliation || undefined,
          role: form.role,
          turnstileToken: token,
          ...(form.password ? { password: form.password } : {}),
          ...(pending && oauthPendingId ? { oauthPendingId } : {}),
        },
      });
      go(next === "/workspace" ? "/workspace?welcome=1" : next);
    } catch (err) {
      const f = fieldErrors(err);
      setFields(f);
      setError(err instanceof ApiError ? (Object.keys(f).length ? "Please check the highlighted fields." : err.message) : "Could not create your account. Please retry.");
      setBusy(false);
      reset();
    }
  }

  const passwordRequired = !pending;

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Create your AltVivo account</h1>
      <p className="mt-2 text-sm text-muted">
        Already registered?{" "}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-accent-ink hover:underline">
          Sign in
        </Link>
      </p>

      <div className="mt-8 space-y-6">
        {pending && (
          <Alert tone="info" title={`Linking your ${pending.provider === "ORCID" ? "ORCID iD" : "Google account"}`}>
            {pending.orcidId ? <span className="readout">{pending.orcidId}</span> : null} Add your email to finish. A password is optional.
          </Alert>
        )}
        {pendingError && <Alert tone="warning">{pendingError}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        {!pending && (
          <>
            <OAuthButtons next={next} />
            <Divider label="or with email" />
          </>
        )}
        <form onSubmit={submit} className="space-y-5" noValidate>
          <Field label="Full name" id="fullName" error={fields.fullName}>
            <input id="fullName" className="field" autoComplete="name" required value={form.fullName} onChange={set("fullName")} aria-invalid={!!fields.fullName} />
          </Field>
          <Field label="Email" id="email" error={fields.email} hint="Use your institutional email to join your college's licence automatically.">
            <input id="email" type="email" className="field" autoComplete="email" inputMode="email" required value={form.email} onChange={set("email")} aria-invalid={!!fields.email} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="I am a" id="role">
              <select id="role" className="field" value={form.role} onChange={set("role")}>
                <option value="STUDENT">Student</option>
                <option value="RESEARCHER">Researcher / faculty</option>
                <option value="PI">Principal investigator</option>
              </select>
            </Field>
            <Field label="Institution (optional)" id="affiliation">
              <input id="affiliation" className="field" autoComplete="organization" value={form.affiliation} onChange={set("affiliation")} />
            </Field>
          </div>
          <Field label={passwordRequired ? "Password" : "Password (optional)"} id="password" error={fields.password}>
            <input
              id="password"
              type="password"
              className="field"
              autoComplete="new-password"
              required={passwordRequired}
              minLength={12}
              value={form.password}
              onChange={set("password")}
              aria-describedby="pw-meter"
            />
            {form.password && (
              <div id="pw-meter" className="flex items-center gap-2" aria-live="polite">
                <div className="flex flex-1 gap-1">
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className={cx("h-1 flex-1 rounded-full", i < pw.score ? (pw.score >= 3 ? "bg-live" : "bg-soon") : "bg-surface-3")} />
                  ))}
                </div>
                <span className="readout text-[11px] text-subtle">{pw.label}</span>
              </div>
            )}
            {!form.password && <p className="text-xs text-subtle">At least 12 characters. A passphrase of several words works well.</p>}
          </Field>
          <label className="flex items-start gap-3 text-sm text-muted">
            <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} required />
            <span>I agree to the AltVivo Terms of Service and Privacy Policy.</span>
          </label>
          <Turnstile action="register" onToken={setToken} resetKey={resetKey} />
          <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!agree || !form.email || !form.fullName || (passwordRequired && form.password.length < 12)}>
            Create account
          </Button>
        </form>
      </div>
    </div>
  );
}
