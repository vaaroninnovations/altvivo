"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import QRCode from "qrcode";
import { Copy, Download, KeyRound, Laptop, ShieldCheck, ShieldOff, UserRound } from "lucide-react";
import { go } from "@/components/auth";
import { Alert, Button, Card, Field, Pill, formatDate } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { PasswordInput } from "@/components/client";

export interface AccountData {
  email: string;
  name: string;
  role: string;
  mfaRequiredForRole: boolean;
  enrollmentPending: boolean;
  profile: { fullName: string; affiliation: string | null; orcidId: string | null; hasPassword: boolean; mfaEnabled: boolean; emailVerified: boolean; createdAt: string } | null;
  organization: { id: string; name: string; kind: string; status: "ACTIVE" | "SUSPENDED"; seatLimit: number; domainWhitelist: string[] } | null;
  sessions: { id: string; createdAt: string; lastUsedAt: string; ipAddress: string | null; userAgent: string | null; mfaVerified: boolean; current: boolean }[];
}

const msg = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function Section({ id, icon, title, description, children }: { id?: string; icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-24">
      <div className="grid gap-6 p-6 md:grid-cols-[16rem_1fr] md:p-8">
        <div>
          <div className="flex items-center gap-2 text-accent-ink">{icon}</div>
          <h2 className="mt-3 font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted">{description}</p>
        </div>
        <div>{children}</div>
      </div>
    </Card>
  );
}

function ProfileForm({ profile }: { profile: NonNullable<AccountData["profile"]> }) {
  const [fullName, setFullName] = useState(profile.fullName);
  const [affiliation, setAffiliation] = useState(profile.affiliation ?? "");
  const [state, setState] = useState<{ busy: boolean; ok?: string; err?: string }>({ busy: false });
  async function save(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      await api("/v1/api/me", { method: "PATCH", body: { fullName, affiliation: affiliation || null } });
      setState({ busy: false, ok: "Profile saved." });
    } catch (err) {
      setState({ busy: false, err: msg(err, "Could not save.") });
    }
  }
  return (
    <form onSubmit={save} className="space-y-4">
      {state.ok && <Alert tone="success">{state.ok}</Alert>}
      {state.err && <Alert tone="danger">{state.err}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" id="fullName">
          <input id="fullName" className="field" value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={2} />
        </Field>
        <Field label="Institution" id="affiliation">
          <input id="affiliation" className="field" value={affiliation} onChange={(e) => setAffiliation(e.target.value)} />
        </Field>
      </div>
      <p className="text-sm text-muted">
        ORCID iD{" "}
        {profile.orcidId ? (
          <a href={`https://orcid.org/${profile.orcidId}`} target="_blank" rel="noopener noreferrer" className="readout text-accent-ink underline">
            {profile.orcidId}
          </a>
        ) : (
          <span>Not linked. An iD is linked when you create your account with &quot;Sign in with ORCID&quot;.</span>
        )}
      </p>
      <Button type="submit" loading={state.busy}>
        Save profile
      </Button>
    </form>
  );
}

function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [state, setState] = useState<{ busy: boolean; ok?: string; err?: string }>({ busy: false });
  async function save(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      const r = await api<{ otherSessionsRevoked: number }>("/v1/api/me/password", {
        method: "POST",
        body: { ...(hasPassword ? { currentPassword: current } : {}), newPassword: next },
      });
      setCurrent("");
      setNext("");
      setState({ busy: false, ok: `Password ${hasPassword ? "changed" : "set"}. ${r.otherSessionsRevoked} other session(s) were signed out.` });
    } catch (err) {
      setState({ busy: false, err: msg(err, "Could not change the password.") });
    }
  }
  return (
    <form onSubmit={save} className="space-y-4">
      {state.ok && <Alert tone="success">{state.ok}</Alert>}
      {state.err && <Alert tone="danger">{state.err}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        {hasPassword && (
          <Field label="Current password" id="current">
            <PasswordInput id="current" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </Field>
        )}
        <Field label="New password" id="new" hint="At least 12 characters.">
          <PasswordInput id="new" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={12} />
        </Field>
      </div>
      <Button type="submit" loading={state.busy} disabled={next.length < 12 || (hasPassword && !current)}>
        {hasPassword ? "Change password" : "Set a password"}
      </Button>
    </form>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone?: () => void }) {
  const text = `AltVivo recovery codes\nEach code works once. Store them somewhere safe.\n\n${codes.join("\n")}\n`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-4">
      <Alert tone="warning" title="Save these recovery codes now">
        They are shown only once. Each one signs you in a single time if you lose your authenticator.
      </Alert>
      <ol className="readout grid grid-cols-2 gap-2 rounded-xl border border-line bg-surface-2 p-4 text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          }}
        >
          <Copy className="size-4" aria-hidden /> {copied ? "Copied" : "Copy"}
        </Button>
        <a
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-sm font-semibold hover:border-accent"
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
          download="altvivo-recovery-codes.txt"
        >
          <Download className="size-4" aria-hidden /> Download
        </a>
        {onDone && (
          <Button size="sm" onClick={onDone}>
            I have saved them
          </Button>
        )}
      </div>
    </div>
  );
}

function MfaSection({ enabled, roleRequires, pending }: { enabled: boolean; roleRequires: boolean; pending: boolean }) {
  const [step, setStep] = useState<"idle" | "scan" | "codes">("idle");
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disablePw, setDisablePw] = useState("");
  const [isEnabled, setIsEnabled] = useState(enabled);

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ otpauthUrl: string; secret: string }>("/v1/api/mfa/enroll", { method: "POST" });
      setSecret(r.secret);
      setQr(await QRCode.toDataURL(r.otpauthUrl, { margin: 1, width: 208, color: { dark: "#0B0F19", light: "#FFFFFF" } }));
      setStep("scan");
    } catch (err) {
      setError(msg(err, "Could not start enrolment."));
    } finally {
      setBusy(false);
    }
  }
  async function activate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ recoveryCodes: string[] }>("/v1/api/mfa/activate", { method: "POST", body: { code } });
      setCodes(r.recoveryCodes);
      setIsEnabled(true);
      setStep("codes");
    } catch (err) {
      setError(msg(err, "That code did not match."));
      setCode("");
    } finally {
      setBusy(false);
    }
  }
  async function regenerate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ recoveryCodes: string[] }>("/v1/api/mfa/recovery-codes", { method: "POST", body: { code } });
      setCodes(r.recoveryCodes);
      setCode("");
      setStep("codes");
    } catch (err) {
      setError(msg(err, "Could not create new codes."));
    } finally {
      setBusy(false);
    }
  }
  async function disable(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/v1/api/mfa/disable", { method: "POST", body: { code, password: disablePw } });
      setIsEnabled(false);
      setCode("");
      setDisablePw("");
    } catch (err) {
      setError(msg(err, "Could not turn off two-factor authentication."));
    } finally {
      setBusy(false);
    }
  }

  const codeInput = (
    <input
      id="totp"
      className="field readout max-w-48 text-center text-lg tracking-[0.4em]"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      value={code}
      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
      required
    />
  );

  if (step === "codes") return <RecoveryCodes codes={codes} onDone={() => (pending ? go("/workspace") : setStep("idle"))} />;

  return (
    <div className="space-y-5">
      {error && <Alert tone="danger">{error}</Alert>}
      {pending && (
        <Alert tone="warning" title="Two-factor authentication is required for your role">
          Set it up now to continue to your workspace and administrator tools.
        </Alert>
      )}
      <div className="flex items-center gap-3">
        {isEnabled ? <Pill tone="live">Enabled</Pill> : <Pill tone="muted">Off</Pill>}
        <span className="text-sm text-muted">Authenticator app (TOTP)</span>
      </div>

      {!isEnabled && step === "idle" && (
        <Button onClick={begin} loading={busy}>
          <ShieldCheck className="size-4" aria-hidden /> Set up two-factor
        </Button>
      )}

      {!isEnabled && step === "scan" && (
        <form onSubmit={activate} className="grid gap-6 sm:grid-cols-[auto_1fr]">
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} width={208} height={208} alt="QR code for your authenticator app" className="rounded-xl border border-line bg-white p-2" />
          )}
          <div className="space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>Scan the code with Google Authenticator, Microsoft Authenticator, 1Password or similar.</li>
              <li>Enter the 6-digit code it shows.</li>
            </ol>
            <details className="text-sm">
              <summary className="cursor-pointer text-accent-ink">Can&apos;t scan? Enter the key manually</summary>
              <p className="readout mt-2 break-all rounded-lg bg-surface-2 p-2 text-xs">{secret}</p>
            </details>
            <Field label="Code from your app" id="totp">
              {codeInput}
            </Field>
            <Button type="submit" loading={busy} disabled={code.length !== 6}>
              Verify and enable
            </Button>
          </div>
        </form>
      )}

      {isEnabled && step === "idle" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <form onSubmit={regenerate} className="space-y-3 rounded-xl border border-line p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <KeyRound className="size-4" aria-hidden /> New recovery codes
            </p>
            <p className="text-xs text-subtle">Replaces all existing codes.</p>
            <Field label="Current code" id="totp">
              {codeInput}
            </Field>
            <Button type="submit" size="sm" variant="outline" loading={busy} disabled={code.length !== 6}>
              Generate
            </Button>
          </form>
          {!roleRequires && (
            <form onSubmit={disable} className="space-y-3 rounded-xl border border-line p-4">
              <p className="flex items-center gap-2 text-sm font-medium">
                <ShieldOff className="size-4" aria-hidden /> Turn off two-factor
              </p>
              <Field label="Password" id="mfa-pw">
                <PasswordInput id="mfa-pw" autoComplete="current-password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} required />
              </Field>
              <Field label="Current code" id="totp-off">
                <input id="totp-off" className="field readout max-w-48" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
              </Field>
              <Button type="submit" size="sm" variant="danger" loading={busy} disabled={code.length !== 6 || !disablePw}>
                Turn off
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function Sessions({ sessions }: { sessions: AccountData["sessions"] }) {
  const [list, setList] = useState(sessions);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function revoke(id: string, current: boolean) {
    setBusy(id);
    try {
      await api(`/v1/api/sessions/${id}`, { method: "DELETE" });
      if (current) return go("/login");
      setList((l) => l.filter((s) => s.id !== id));
    } catch (err) {
      setError(msg(err, "Could not sign out that session."));
    } finally {
      setBusy(null);
    }
  }
  async function everywhere() {
    setBusy("all");
    try {
      await api("/v1/auth/logout-all", { method: "POST" });
    } finally {
      go("/login");
    }
  }
  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <ul className="divide-y divide-line rounded-xl border border-line">
        {list.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <Laptop className="size-4 text-subtle" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate">{s.userAgent ? s.userAgent.replace(/\(.*?\)/g, "").slice(0, 70) : "Unknown device"}</p>
              <p className="readout text-xs text-subtle">
                {s.ipAddress ?? "—"} · last active {formatDate(s.lastUsedAt, true)}
                {s.mfaVerified ? " · 2FA" : ""}
              </p>
            </div>
            {s.current ? <Pill tone="accent">This device</Pill> : null}
            <Button variant="ghost" size="sm" loading={busy === s.id} onClick={() => revoke(s.id, s.current)}>
              Sign out
            </Button>
          </li>
        ))}
      </ul>
      <Button variant="outline" size="sm" loading={busy === "all"} onClick={everywhere}>
        Sign out of every device
      </Button>
    </div>
  );
}

export function AccountView({ data }: { data: AccountData }) {
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Security</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Account &amp; security</h1>
        <p className="mt-1 text-sm text-muted">
          {data.email}
          {data.organization ? ` · ${data.organization.name}` : ""}
          {data.organization?.status === "SUSPENDED" ? " (institution licence suspended)" : ""}
        </p>
      </div>

      <Section id="mfa" icon={<ShieldCheck className="size-5" aria-hidden />} title="Two-factor authentication" description="A one-time code from your phone protects your account even if your password leaks.">
        <MfaSection enabled={data.profile?.mfaEnabled ?? false} roleRequires={data.mfaRequiredForRole} pending={data.enrollmentPending} />
      </Section>

      {data.profile && (
        <>
          <Section icon={<UserRound className="size-5" aria-hidden />} title="Profile" description="Shown in AltVivo applications and on exported reports.">
            <ProfileForm profile={data.profile} />
          </Section>
          <Section icon={<KeyRound className="size-5" aria-hidden />} title="Password" description="Changing it signs out your other sessions.">
            <PasswordForm hasPassword={data.profile.hasPassword} />
          </Section>
          <Section icon={<Laptop className="size-5" aria-hidden />} title="Active sessions" description="Devices currently signed in to AltVivo. Signing one out ends it in every app immediately.">
            <Sessions sessions={data.sessions} />
          </Section>
        </>
      )}
    </div>
  );
}
