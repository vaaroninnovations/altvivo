import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/config";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = { title: "Two-factor verification", robots: { index: false } };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ challenge?: string; next?: string }> }) {
  const { challenge, next } = await searchParams;
  if (!challenge || !/^[A-Za-z0-9_-]{20,64}$/.test(challenge)) redirect("/login");
  return <MfaForm challengeId={challenge} next={safeNext(next)} />;
}
