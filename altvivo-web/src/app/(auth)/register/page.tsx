import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/config";
import { readSession } from "@/lib/server/session";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create your account" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string; redirect?: string; oauth?: string; email?: string; trial?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.redirect ?? sp.next);
  if ((await readSession()).session) redirect(next);
  const oauth = sp.oauth && /^[A-Za-z0-9_-]{20,64}$/.test(sp.oauth) ? sp.oauth : null;
  // The "free month approved" email links here with the approved address filled in.
  const email = sp.email && /^[^@\s]{1,64}@[^@\s]{1,190}$/.test(sp.email) ? sp.email : "";
  return <RegisterForm next={next} oauthPendingId={oauth} defaultEmail={email} freeMonth={sp.trial === "1"} />;
}
