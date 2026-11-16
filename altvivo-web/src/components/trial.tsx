"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, CalendarCheck, CheckCircle2, Clock3, Gift, Send, X } from "lucide-react";
import { api, ApiError, fieldErrors } from "@/lib/api";
import { FREE_MONTH_PATH, TRIAL_ROLES, trialDaysLeft, trialLength, trialState } from "@/lib/trial";
import type { Trial } from "@/lib/types";
import { Alert, Button, ButtonLink, Field, cx, formatDate } from "./ui";

/** Site-wide announcement bar. Closing it lasts until the page is reloaded (nothing is stored). */
export function TrialBanner({ days, href = FREE_MONTH_PATH, appNames }: { days: number; href?: string; appNames: string[] }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const apps = appNames.length ? appNames.join(" and ") : "every live application";
  return (
    <div role="region" aria-label="Offer" className="brand-gradient relative text-white">
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-x-4 gap-y-1 px-12 py-2.5 text-center text-sm sm:px-14">
        <p className="text-pretty">
          <Gift className="mr-1.5 inline size-4 -translate-y-px" aria-hidden />
          <strong className="font-semibold">{trialLength(days).replace(/^o/, "O")} free.</strong>{" "}
          <span className="opacity-95">
            Full access to {apps} for {days} days. No card needed.
          </span>{" "}
          <a href={href} className="inline-flex items-center gap-1 whitespace-nowrap font-semibold underline decoration-white/60 underline-offset-4 hover:decoration-white">
            Request your free month <ArrowRight className="size-3.5" aria-hidden />
          </a>
        </p>
      </div>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-white/80 hover:bg-white/15 hover:text-white sm:right-4"
        aria-label="Close this announcement"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/** Where a signed-in person's request stands (workspace, upgrade page, /free-month). */
export function TrialStatus({ trial, compact = false }: { trial: Trial; compact?: boolean }) {
  const state = trialState(trial);
  if (state === "pending") {
    return (
      <Alert tone="info" title="Your free month request is with our team">
        Sent on {formatDate(trial.createdAt)}. We review every request, usually within one working day, and email you the moment it is approved.
      </Alert>
    );
  }
  if (state === "approved") {
    return (
      <Alert tone="success" title="Your free month is approved">
        It starts as soon as your email address is verified. Open the link we sent you, then reload this page.
      </Alert>
    );
  }
  if (state === "running") {
    const left = trialDaysLeft(trial);
    return (
      <Alert
        tone={left <= 5 ? "warning" : "success"}
        title={`Free month: ${left} ${left === 1 ? "day" : "days"} left`}
        action={
          <ButtonLink href="/pricing" size="sm" variant={left <= 5 ? "primary" : "outline"}>
            Choose a plan
          </ButtonLink>
        }
      >
        Full access until <strong>{formatDate(trial.endsAt!)}</strong>.{!compact && " Nothing is charged when it ends; choose a plan to keep working without a break."}
      </Alert>
    );
  }
  if (state === "ended") {
    return (
      <Alert tone="warning" title="Your free month has ended" action={<ButtonLink href="/pricing" size="sm">Choose a plan</ButtonLink>}>
        It ran until {formatDate(trial.endsAt!)}. Your account, data and exports are kept; a plan opens the applications again.
      </Alert>
    );
  }
  if (state === "declined") {
    return (
      <Alert tone="info" title="We could not offer the free month for your last request">
        You can send a new request with more detail about your institution and how you will use AltVivo, or go straight to a subscription.
      </Alert>
    );
  }
  return null;
}

interface AppOption {
  appId: string;
  name: string;
}

/** POST /v1/public/trial-request (CSRF + Origin checked, rate-limited; reviewed by a SuperAdmin). */
export function TrialRequestForm({
  apps,
  days,
  defaultName = "",
  defaultEmail = "",
  defaultInstitution = "",
  signedIn = false,
  onSent,
}: {
  apps: AppOption[];
  days: number;
  defaultName?: string;
  defaultEmail?: string;
  defaultInstitution?: string;
  signedIn?: boolean;
  onSent?: (trial: Trial | null) => void;
}) {
  const [form, setForm] = useState({ name: defaultName, email: defaultEmail, institution: defaultInstitution, designation: "", useCase: "", website: "" });
  const [chosen, setChosen] = useState<string[]>(apps.map((a) => a.appId));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"received" | "already_requested" | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (form.name.trim().length < 2) e.name = "Enter your name";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) e.email = "Enter a valid email address";
    if (form.institution.trim().length < 2) e.institution = "Enter your college, university or organisation";
    if (form.useCase.trim().length < 10) e.useCase = "Tell us in a sentence or two how you will use it";
    if (!chosen.length) e.apps = "Choose at least one application";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ status: "received" | "already_requested"; trial?: Trial }>("/v1/public/trial-request", {
        method: "POST",
        body: { name: form.name, email: form.email, institution: form.institution, designation: form.designation || null, apps: chosen, useCase: form.useCase, website: form.website },
      });
      setDone(r.status);
      onSent?.(r.trial ?? null);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(
        err instanceof ApiError && err.status === 429
          ? "You have sent several requests in a short time. Please wait a little, or email support@altvivo.bio."
          : err instanceof ApiError
            ? err.message
            : "Your request could not be sent. Please retry or email support@altvivo.bio.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-xl border border-live/30 bg-live-soft p-5 text-sm">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-live-ink" aria-hidden />
        <div>
          <p className="font-semibold text-fg">{done === "already_requested" ? "You have already asked for your free month." : "Thank you. Your request is with our team."}</p>
          <p className="mt-1 leading-relaxed text-muted">
            {done === "already_requested" ? (
              "Each person gets one free month. Its status is shown in your workspace."
            ) : (
              <>
                We review every request, usually within one working day, and reply to <span className="readout">{form.email}</span>.{" "}
                {signedIn ? "Your free month starts the moment it is approved." : `Once approved, create your account with that address and your ${days} days begin.`}
              </>
            )}
          </p>
          {signedIn && (
            <ButtonLink href="/workspace" size="sm" variant="outline" className="mt-4">
              Back to my applications
            </ButtonLink>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" id="tr-name" error={errors.name}>
          <input id="tr-name" className="field" value={form.name} onChange={set("name")} autoComplete="name" aria-invalid={!!errors.name} />
        </Field>
        <Field label="Work or institutional email" id="tr-email" error={errors.email} hint={signedIn ? "The free month is added to this account." : "Your free month is tied to this address."}>
          <input id="tr-email" type="email" className="field" value={form.email} onChange={set("email")} autoComplete="email" aria-invalid={!!errors.email} readOnly={signedIn} />
        </Field>
        <Field label="College, university or organisation" id="tr-inst" error={errors.institution}>
          <input id="tr-inst" className="field" value={form.institution} onChange={set("institution")} autoComplete="organization" aria-invalid={!!errors.institution} maxLength={300} />
        </Field>
        <Field label="Your role (optional)" id="tr-role">
          <select id="tr-role" className="field" value={form.designation} onChange={set("designation")}>
            <option value="">Choose…</option>
            {TRIAL_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-fg">Applications to try</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {apps.map((a) => {
            const on = chosen.includes(a.appId);
            return (
              <label key={a.appId} className={cx("flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition", on ? "border-accent/60 bg-accent-soft" : "border-line bg-surface hover:border-line-strong")}>
                <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={on} onChange={() => toggle(a.appId)} />
                <span className="font-medium">{a.name}</span>
              </label>
            );
          })}
        </div>
        {errors.apps && <p className="mt-1.5 text-xs text-danger">{errors.apps}</p>}
      </fieldset>

      <Field label="How will you use AltVivo?" id="tr-use" error={errors.useCase} hint="For example: the course or study, how many students or colleagues, and when you plan to start.">
        <textarea id="tr-use" rows={4} className="field" value={form.useCase} onChange={set("useCase")} maxLength={2000} aria-invalid={!!errors.useCase} />
      </Field>

      {/* Honeypot: hidden from people and assistive technology, filled in by bots. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="tr-website">Website</label>
        <input id="tr-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
      </div>

      <p className="text-xs leading-relaxed text-subtle">
        One free month per person. No payment details are asked for and nothing is charged when it ends. We use these details only to review your request and
        contact you about it (see the{" "}
        <a href="/privacy" className="underline">
          Privacy Policy
        </a>{" "}
        and{" "}
        <a href="/terms#free-month" className="underline">
          Terms
        </a>
        ).
      </p>
      <Button type="submit" size="lg" loading={busy} className="w-full sm:w-auto">
        <Send className="size-4" aria-hidden /> Request {trialLength(days)} free
      </Button>
    </form>
  );
}

/** The three steps, shown beside the form and on the homepage. */
export function TrialSteps({ days, className }: { days: number; className?: string }) {
  const steps = [
    { Icon: Send, title: "Send the request", body: "Tell us who you are and how you plan to use XPRISM or aMaze. It takes a minute and needs no card." },
    { Icon: Clock3, title: "We review it", body: "A person on our team reads every request, usually within one working day, and replies by email." },
    { Icon: CalendarCheck, title: `Your ${days} days begin`, body: "Sign in with the same email address. The clock starts when your access is switched on, not when you asked." },
  ];
  return (
    <ol className={cx("grid gap-4", className)}>
      {steps.map(({ Icon, title, body }, i) => (
        <li key={title} className="flex gap-4 rounded-2xl border border-line bg-surface p-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink">
            <Icon className="size-5" aria-hidden strokeWidth={1.75} />
          </span>
          <div>
            <p className="font-semibold">
              <span className="readout mr-2 text-xs text-subtle">0{i + 1}</span>
              {title}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
