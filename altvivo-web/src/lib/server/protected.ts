import "server-only";
import { redirect } from "next/navigation";
import { CoreError, CoreUnauthorized, coreGet } from "./core";
import { redirectToSignIn, requireSession, type Session } from "./session";

export type SearchParams = Record<string, string | string[] | undefined>;

export function pathWithQuery(path: string, sp: SearchParams): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") q.set(k, v);
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/**
 * Session + authenticated core GET for a protected page. Handles expiry
 * (bounce/refresh), revocation (sign in again) and pending MFA enrolment.
 */
export async function loadProtected<T>(path: string, sp: SearchParams, apiPath: string): Promise<{ session: Session; data: T }> {
  const current = pathWithQuery(path, sp);
  const bounced = sp.av_r === "1";
  const session = await requireSession(current, bounced);
  try {
    const data = await coreGet<T>(apiPath, { token: session.token });
    return { session, data };
  } catch (err) {
    if (err instanceof CoreUnauthorized) redirectToSignIn(current, bounced);
    if (err instanceof CoreError && err.code === "MFA_ENROLLMENT_REQUIRED" && path !== "/workspace/security") {
      redirect("/workspace/security?enroll=1");
    }
    throw err;
  }
}

/** What the checkout and unlock dialogs need to know about the signed-in user. */
export const viewerOf = (s: Session) => ({
  signedIn: true,
  emailVerified: s.emailVerified,
  email: s.email,
  role: s.role,
  hasOrg: !!s.orgId,
});

/** Price lists and billing are in Indian rupees only. */
export async function requestCurrency(_explicit?: string | string[]): Promise<"INR"> {
  return "INR";
}
