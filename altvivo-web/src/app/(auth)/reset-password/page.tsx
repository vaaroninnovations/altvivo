"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Field } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("The two passwords do not match.");
    setBusy(true);
    setError(null);
    try {
      await api("/v1/auth/reset-password", { method: "POST", body: { token, password } });
      router.replace("/login?reset=1");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reset your password. Please retry.");
      setBusy(false);
    }
  }

  if (token.length < 20) {
    return (
      <Alert tone="danger" title="Invalid reset link" action={<Link href="/forgot-password" className="font-semibold text-accent-ink">Request a new link</Link>}>
        Open the link from your email again, or request a new one.
      </Alert>
    );
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="New password" id="password" hint="At least 12 characters. Signing in with the new password signs you out everywhere else.">
        <input id="password" type="password" className="field" autoComplete="new-password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Repeat new password" id="confirm">
        <input id="confirm" type="password" className="field" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={busy} disabled={password.length < 12 || !confirm}>
        Set new password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Choose a new password</h1>
      <Suspense>
        <ResetForm />
      </Suspense>
    </div>
  );
}
