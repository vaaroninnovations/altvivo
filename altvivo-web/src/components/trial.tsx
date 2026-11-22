"use client";

import { useState } from "react";
import { ArrowRight, CalendarCheck, Gift, MailCheck, UserPlus, X } from "lucide-react";
import { api, ApiError, refreshSession } from "@/lib/api";
import { FREE_MONTH_SIGNUP, trialDaysLeft, trialLength, trialState } from "@/lib/trial";
import type { Trial } from "@/lib/types";
import { Alert, Button, ButtonLink, cx, formatDate } from "./ui";

/** Site-wide announcement bar. Closing it lasts until the page is reloaded (nothing is stored). */
export function TrialBanner({ days, href = FREE_MONTH_SIGNUP, appNames }: { days: number; href?: string; appNames: string[] }) {
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
            Start your free month <ArrowRight className="size-3.5" aria-hidden />
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

/** Where a signed-in person's free month stands (workspace, upgrade page, /free-month). */
export function TrialStatus({ trial, compact = false }: { trial: Trial; compact?: boolean }) {
  const state = trialState(trial);
  if (state === "pending") {
    return (
      <Alert tone="info" title="Your free month is ready to start">
        It starts automatically as soon as your email address is verified, or the next time you sign in.
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
      <Alert tone="info" title="The free month is not available for this account">
        Please contact support@altvivo.bio if you think this is a mistake, or go straight to a subscription.
      </Alert>
    );
  }
  return null;
}

/**
 * The free month without a form: a visitor creates an account; a signed-in,
 * verified account starts it with one click (POST /v1/api/free-month/start).
 */
export function FreeMonthStart({ days, signedIn, emailVerified }: { days: number; signedIn: boolean; emailVerified: boolean }) {
  if (!signedIn) {
    return (
      <div className="space-y-4">
        <ButtonLink href={FREE_MONTH_SIGNUP} size="lg" className="w-full sm:w-auto">
          <UserPlus className="size-4" aria-hidden /> Create my free account
        </ButtonLink>
        <p className="text-sm text-muted">
          Already registered?{" "}
          <a href="/login?redirect=%2Fworkspace" className="font-medium text-accent-ink hover:underline">
            Sign in
          </a>{" "}
          and your free month starts automatically.
        </p>
        <FreeMonthFinePrint />
      </div>
    );
  }
  if (!emailVerified) {
    return (
      <Alert tone="info" title="Verify your email to start">
        Open the verification link we sent you. Your {days} days begin the moment you do; there is nothing else to fill in.
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <StartFreeMonthButton size="lg" />
      <FreeMonthFinePrint />
    </div>
  );
}

/** POST /v1/api/free-month/start, then refresh the session so the new access shows everywhere at once. */
export function StartFreeMonthButton({ size = "sm", disabled = false }: { size?: "sm" | "lg"; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await api("/v1/api/free-month/start", { method: "POST" });
      await refreshSession();
      window.location.assign("/workspace");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Your free month could not be started. Please retry or email support@altvivo.bio.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button size={size} loading={busy} disabled={disabled} onClick={start} className={size === "lg" ? "w-full sm:w-auto" : undefined} title={disabled ? "Verify your email address first" : undefined}>
        <Gift className="size-4" aria-hidden /> Start my free month
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function FreeMonthFinePrint() {
  return (
    <p className="text-xs leading-relaxed text-subtle">
      One free month per person, covering every application on AltVivo. No payment details are asked for and nothing is charged when it ends (see the{" "}
      <a href="/terms#free-month" className="underline">
        Terms
      </a>{" "}
      and{" "}
      <a href="/privacy" className="underline">
        Privacy Policy
      </a>
      ).
    </p>
  );
}

/** The three steps, shown on /free-month and the homepage. */
export function TrialSteps({ days, className }: { days: number; className?: string }) {
  const steps = [
    { Icon: UserPlus, title: "Create your account", body: "Your name, email and a password, or sign up with Google or ORCID. It takes a minute and needs no card." },
    { Icon: MailCheck, title: "Verify your email", body: "Open the link we send you. There is no form to fill in and nobody to wait for." },
    { Icon: CalendarCheck, title: `Your ${days} days begin`, body: "Full access to every application starts automatically the moment your address is verified." },
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
