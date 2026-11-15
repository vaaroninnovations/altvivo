"use client";

import { useState, type FormEvent } from "react";
import { BellRing, CheckCircle2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Dialog, Turnstile, useResetCounter } from "./client";
import { Button, Field } from "./ui";

/** Anonymous early-access sign-up (Turnstile-protected). */
export function WaitlistForm({ appId, appName, source = "web", compact = false }: { appId: string; appName: string; source?: "web" | "coming-soon" | "topbar"; compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [resetKey, reset] = useResetCounter();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token) return setError("Please complete the human check.");
    setState("busy");
    setError(null);
    try {
      await api("/v1/public/waitlist", { method: "POST", body: { email, appId, turnstileToken: token, source } });
      setState("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save your request. Please retry.");
      setState("idle");
      reset();
    }
  }

  if (state === "done") {
    return (
      <div role="status" className="flex items-start gap-3 rounded-xl border border-live/30 bg-live-soft p-4 text-sm">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-live-ink" aria-hidden />
        <p>
          You are on the early-access list for <strong>{appName}</strong>. We will email <span className="readout">{email}</span> the moment it launches.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Work or institutional email" id={`wl-${appId}`} error={error ?? undefined}>
        <input
          id={`wl-${appId}`}
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="field"
          placeholder="you@institute.edu.in"
          aria-invalid={!!error}
        />
      </Field>
      <Turnstile action="waitlist" onToken={setToken} resetKey={resetKey} />
      <Button type="submit" loading={state === "busy"} className={compact ? "" : "w-full"} disabled={!email}>
        <BellRing className="size-4" aria-hidden /> Join early access
      </Button>
      <p className="text-xs text-subtle">One email at launch. No marketing list.</p>
    </form>
  );
}

export function WaitlistButton({ appId, appName }: { appId: string; appName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <BellRing className="size-4" aria-hidden /> Join early access waitlist
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Early access: ${appName}`}>
        <p className="mb-5 text-sm text-muted">Be first in line when {appName} launches on AltVivo. Subscribers also get early-bird access included in their plan.</p>
        <WaitlistForm appId={appId} appName={appName} />
      </Dialog>
    </>
  );
}
