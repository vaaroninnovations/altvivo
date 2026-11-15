"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { KeyRound, ShieldCheck } from "lucide-react";
import { go } from "@/components/auth";
import { Alert, Button, Field } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { safeNext } from "@/lib/config";

export function MfaForm({ challengeId, next }: { challengeId: string; next: string }) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ redirect?: string }>("/v1/auth/mfa/verify", {
        method: "POST",
        body: useRecovery ? { challengeId, recoveryCode: code.trim() } : { challengeId, code: code.replace(/\s/g, "") },
      });
      go(safeNext(r.redirect ?? next));
    } catch (err) {
      if (err instanceof ApiError && err.code === "MFA_CHALLENGE_EXPIRED") setExpired(true);
      setError(err instanceof ApiError ? err.message : "Verification failed. Please retry.");
      setCode("");
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent-ink">
        <ShieldCheck className="size-6" aria-hidden />
      </div>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">Two-factor verification</h1>
      <p className="mt-2 text-sm text-muted">
        {useRecovery ? "Enter one of the recovery codes you saved when you set up two-factor authentication." : "Enter the 6-digit code from your authenticator app."}
      </p>
      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
        {error && (
          <Alert tone="danger" action={expired ? <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-accent-ink">Sign in again</Link> : undefined}>
            {error}
          </Alert>
        )}
        {useRecovery ? (
          <Field label="Recovery code" id="code">
            <input id="code" className="field readout" autoComplete="off" spellCheck={false} placeholder="xxxx-xxxx-xxxx" value={code} onChange={(e) => setCode(e.target.value)} required />
          </Field>
        ) : (
          <Field label="Authentication code" id="code">
            <input
              id="code"
              className="field readout text-center text-2xl tracking-[0.5em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
            />
          </Field>
        )}
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={expired || (useRecovery ? code.trim().length < 10 : code.length !== 6)}>
          Verify and continue
        </Button>
        <button
          type="button"
          onClick={() => {
            setUseRecovery((v) => !v);
            setCode("");
            setError(null);
          }}
          className="mx-auto flex items-center gap-2 text-sm text-accent-ink hover:underline"
        >
          <KeyRound className="size-4" aria-hidden />
          {useRecovery ? "Use an authenticator code instead" : "Lost your device? Use a recovery code"}
        </button>
      </form>
    </div>
  );
}
