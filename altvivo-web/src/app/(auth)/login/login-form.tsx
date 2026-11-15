"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Divider, OAuthButtons, go } from "@/components/auth";
import { Turnstile, useResetCounter } from "@/components/client";
import { Alert, Button, Field } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

type LoginResult = { status: "authenticated"; user: unknown } | { status: "mfa_required"; challengeId: string };

export function LoginForm({ next, oauthError, notice }: { next: string; oauthError: string | null; notice: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(oauthError);
  const [resetKey, reset] = useResetCounter();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token) return setError("Please complete the human check.");
    setBusy(true);
    setError(null);
    try {
      const r = await api<LoginResult>("/v1/auth/login", { method: "POST", body: { email, password, turnstileToken: token } });
      if (r.status === "mfa_required") {
        router.push(`/login/mfa?challenge=${encodeURIComponent(r.challengeId)}&next=${encodeURIComponent(next)}`);
        return;
      }
      go(next);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.code === "RATE_LIMITED"
            ? "Too many attempts from this network. Wait a minute and try again."
            : err.message
          : "Could not reach AltVivo. Check your connection and retry.";
      setError(msg);
      setBusy(false);
      reset();
    }
  }

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-muted">
        New to AltVivo?{" "}
        <Link href={`/register?next=${encodeURIComponent(next)}`} className="font-medium text-accent-ink hover:underline">
          Create an account
        </Link>
      </p>

      <div className="mt-8 space-y-6">
        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        <OAuthButtons next={next} />
        <Divider label="or with email" />
        <form onSubmit={submit} className="space-y-5" noValidate>
          <Field label="Email" id="email">
            <input id="email" type="email" autoComplete="email" inputMode="email" required className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field
            label="Password"
            id="password"
            hint={
              <Link href="/forgot-password" className="text-accent-ink hover:underline">
                Forgot password?
              </Link>
            }
          >
            <input id="password" type="password" autoComplete="current-password" required className="field" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Turnstile action="login" onToken={setToken} resetKey={resetKey} />
          <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!email || !password}>
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
