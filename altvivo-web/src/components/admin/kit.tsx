"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { PenLine, RefreshCw, ShieldCheck } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Dialog } from "../client";
import { Alert, Button, Card, Field, cx } from "../ui";

// ======================================================== e-signature ======

export interface Signature {
  totpCode: string;
  reason: string;
}

interface SignRequest {
  title: string;
  description?: ReactNode;
  /** Reason is mandatory for most privileged changes (stored in the audit trail). */
  reason?: "required" | "none";
  defaultReason?: string;
  confirmLabel?: string;
  danger?: boolean;
  /** false for actions core does not require a TOTP signature for (a reason is still recorded). */
  requireCode?: boolean;
  /** Runs with the signature; a thrown ApiError is shown in the dialog so the admin can retry. */
  run: (sig: Signature) => Promise<void>;
}

const SignerContext = createContext<((r: SignRequest) => void) | null>(null);

export const adminError = (err: unknown, fallback = "Something went wrong.") => {
  if (!(err instanceof ApiError)) return fallback;
  if (err.code === "MFA_CODE_INVALID") return "That code is invalid or was already used. Wait for the next code in your authenticator app and try again.";
  if (err.code === "MFA_REQUIRED") return "This session was not verified with two-factor authentication. Sign out and sign in again.";
  if (err.code === "VALIDATION_FAILED" && Array.isArray(err.details)) {
    return (err.details as { path: string; message: string }[]).map((d) => `${d.path || "request"}: ${d.message}`).join(" · ");
  }
  return err.message;
};

/**
 * Electronic signature (21 CFR 11.200 style): every privileged change asks
 * for a fresh TOTP code and, usually, a reason; both are recorded by core.
 */
export function SignerProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<SignRequest | null>(null);
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback((r: SignRequest) => {
    setReq(r);
    setCode("");
    setReason(r.defaultReason ?? "");
    setError(null);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!req) return;
    if (req.requireCode !== false && !/^\d{6}$/.test(code)) return setError("Enter the 6-digit code from your authenticator app.");
    if (req.reason !== "none" && reason.trim().length < 5) return setError("State the reason (at least 5 characters); it is stored in the audit trail.");
    setBusy(true);
    setError(null);
    try {
      await req.run({ totpCode: code, reason: reason.trim() });
      setReq(null);
    } catch (err) {
      setError(adminError(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SignerContext.Provider value={open}>
      {children}
      <Dialog open={!!req} onClose={() => !busy && setReq(null)} title={req?.title ?? ""}>
        {req && (
          <form onSubmit={submit} className="space-y-4">
            {req.description && <div className="text-sm text-muted">{req.description}</div>}
            {error && <Alert tone="danger">{error}</Alert>}
            {req.reason !== "none" && (
              <Field label="Reason (audit trail)" id="sign-reason">
                <textarea id="sign-reason" rows={2} className="field" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
              </Field>
            )}
            {req.requireCode !== false && (
              <Field label="Authenticator code" id="sign-code" hint="Signing with your two-factor code records you as the approver.">
                <input
                  id="sign-code"
                  className="field readout text-center text-lg tracking-[0.4em]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  autoFocus
                />
              </Field>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setReq(null)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" variant={req.danger ? "danger" : "primary"} loading={busy}>
                <PenLine className="size-4" aria-hidden /> {req.confirmLabel ?? "Sign and apply"}
              </Button>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-subtle">
              <ShieldCheck className="size-3.5" aria-hidden /> Each code can sign one action.
            </p>
          </form>
        )}
      </Dialog>
    </SignerContext.Provider>
  );
}

export function useSigner() {
  const ctx = useContext(SignerContext);
  if (!ctx) throw new Error("useSigner must be used inside SignerProvider");
  return ctx;
}

// ============================================================ data =========

/** GET an admin endpoint; `reload()` refetches. */
export function useAdmin<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (err) {
      if (n === seq.current) setError(adminError(err, "Could not load data."));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

// ============================================================ layout =======

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="eyebrow">SuperAdmin</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function LoadState({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
  if (error)
    return (
      <Alert
        tone="danger"
        action={
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="size-3.5" aria-hidden /> Retry
          </Button>
        }
      >
        {error}
      </Alert>
    );
  if (loading) return <p className="py-10 text-center text-sm text-subtle">Loading…</p>;
  return null;
}

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "accent" | "live" | "soon" }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-subtle">{label}</p>
      <p className={cx("readout mt-2 text-2xl font-semibold", tone === "accent" && "text-accent-ink", tone === "live" && "text-live-ink", tone === "soon" && "text-soon-ink")}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </Card>
  );
}

export function Table({ head, children, empty, minWidth = 720 }: { head: ReactNode[]; children: ReactNode; empty?: boolean; minWidth?: number }) {
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-subtle">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap p-3 font-medium first:pl-5 last:pr-5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-0 [&_td]:p-3 [&_td:first-child]:pl-5 [&_td:last-child]:pr-5">{children}</tbody>
      </table>
      {empty && <p className="p-8 text-center text-sm text-subtle">Nothing to show.</p>}
    </Card>
  );
}

/** ISO date (yyyy-mm-dd) for <input type="date">, at least `days` from now. */
export const isoDate = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
export const addDays = (days: number) => new Date(Date.now() + days * 86_400_000);
/** End of the chosen day in IST, so "valid until 31 Mar" includes 31 Mar. */
export const endOfDayIst = (yyyyMmDd: string) => new Date(`${yyyyMmDd}T23:59:59+05:30`).toISOString();
