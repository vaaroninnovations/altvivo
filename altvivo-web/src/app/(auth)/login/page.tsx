import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/config";
import { readSession } from "@/lib/server/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

const OAUTH_ERRORS: Record<string, string> = {
  oauth_denied: "Sign-in was cancelled at the provider.",
  oauth_state: "That sign-in link expired or was opened in a different browser. Please try again.",
  oauth_expired: "That sign-in took too long. Please try again.",
  oauth_failed: "We could not complete sign-in with the provider. Please try again.",
  oauth_unavailable: "That sign-in option is not available right now.",
  account_disabled: "This account has been disabled. Contact support@altvivo.bio.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.redirect ?? sp.next);
  const state = await readSession();
  if (state.session) redirect(next);
  const notice = sp.reset
    ? "Your password was changed. Sign in with the new one."
    : sp.verify_signin
      ? "Sign in to confirm your email address. Didn't create this account? Use \"Forgot password\" to take it over."
      : sp.verify_error === "wrong_account"
        ? "That verification link belongs to a different account. Sign out, then open the link again."
        : sp.verify_error
          ? "That verification link is invalid or has expired. Sign in to request a new one."
          : null;
  return <LoginForm next={next} oauthError={sp.error ? (OAUTH_ERRORS[sp.error] ?? "Sign-in failed. Please try again.") : null} notice={notice} />;
}
