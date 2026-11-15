"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Turnstile, useResetCounter } from "@/components/client";
import { Alert, Button, Field } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetKey, reset] = useResetCounter();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token) return setError("Please complete the human check.");
    setBusy(true);
    setError(null);
    try {
      await api("/v1/auth/forgot-password", { method: "POST", body: { email, turnstileToken: token } });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send the email. Please retry.");
      reset();
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div>
        <div className="grid size-12 place-items-center rounded-2xl bg-live-soft text-live-ink">
          <MailCheck className="size-6" aria-hidden />
        </div>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">Check your inbox</h1>
        <p className="mt-3 text-muted">
          If an account exists for <span className="readout text-fg">{email}</span>, a reset link is on its way. It works once and expires in one hour.
        </p>
        <Link href="/login" className="mt-8 inline-block text-sm font-medium text-accent-ink hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-2 text-sm text-muted">We will email you a link to choose a new password.</p>
      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Email" id="email">
          <input id="email" type="email" className="field" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Turnstile action="forgot_password" onToken={setToken} resetKey={resetKey} />
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!email}>
          Send reset link
        </Button>
        <Link href="/login" className="block text-center text-sm text-accent-ink hover:underline">
          Back to sign in
        </Link>
      </form>
    </div>
  );
}
