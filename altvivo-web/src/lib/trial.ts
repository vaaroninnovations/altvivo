import type { Trial } from "./types";

/** Length of the free access when core cannot be asked (it publishes the real value at /v1/public/trial-offer). */
export const DEFAULT_TRIAL_DAYS = 30;

export const FREE_MONTH_PATH = "/free-month";

/** "one month" for the standard 30 days, otherwise "14 days". */
export const trialLength = (days: number) => (days >= 28 && days <= 31 ? "one month" : `${days} days`);

export const TRIAL_ROLES = ["Faculty / teaching staff", "Principal investigator", "Researcher / scientist", "PhD scholar", "Student", "Lab or department administrator", "Other"] as const;

/** Whole days left of a running free month (0 once it is over). */
export const trialDaysLeft = (t: Pick<Trial, "endsAt">) => (t.endsAt ? Math.max(0, Math.ceil((new Date(t.endsAt).getTime() - Date.now()) / 86_400_000)) : 0);

/** Where a person's request stands, in words for the workspace and the request page. */
export function trialState(t: Trial | null): "none" | "pending" | "approved" | "running" | "ended" | "declined" {
  if (!t) return "none";
  if (t.status === "PENDING") return "pending";
  if (t.status === "APPROVED") return "approved";
  if (t.status === "DECLINED") return "declined";
  return t.ended || (t.endsAt !== null && new Date(t.endsAt).getTime() <= Date.now()) ? "ended" : "running";
}
