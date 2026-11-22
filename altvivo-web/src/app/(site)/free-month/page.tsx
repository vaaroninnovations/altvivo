import type { Metadata } from "next";
import { Check, CreditCard, ShieldCheck } from "lucide-react";
import { FreeMonthStart, TrialStatus, TrialSteps } from "@/components/trial";
import { ButtonLink, Card, SectionHeading } from "@/components/ui";
import { coreGet, getTrialOffer } from "@/lib/server/core";
import { readSession } from "@/lib/server/session";
import { trialLength, trialState } from "@/lib/trial";
import type { WorkspaceData } from "@/lib/types";

export const metadata: Metadata = {
  title: "One month free",
  description: "Create an account and get one month of free, full access to XPRISM and aMaze on AltVivo. No card needed; nothing is charged when the month ends.",
};
export const dynamic = "force-dynamic";

export default async function FreeMonthPage() {
  const [offer, state] = await Promise.all([getTrialOffer(), readSession()]);
  const s = state.session;
  // A signed-in person sees where their own request stands instead of an empty form.
  const mine = s ? await coreGet<WorkspaceData>("/v1/api/workspace", { token: s.token }).catch(() => null) : null;
  const trial = mine?.trial ?? null;
  const where = trialState(trial);
  const canAsk = where === "none" || where === "declined";
  const names = offer.apps.map((a) => a.name);

  return (
    <div className="border-b border-line">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:py-20">
        <div>
          <SectionHeading eyebrow={`${offer.days} days · no card`} title={`Try AltVivo free for ${trialLength(offer.days)}`}>
            Full access to {names.join(" and ") || "our applications"}: every experiment, every assay, every export. Decide after you have used it with your own
            students or your own videos.
          </SectionHeading>

          <TrialSteps days={offer.days} className="mt-10" />

          <ul className="mt-8 grid gap-2.5 text-sm">
            {[
              "The same applications paying customers use: nothing is hidden or watermarked",
              "Your data, reports and exports stay in your account after the month",
              "One free month per person",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-live-ink" aria-hidden />
                <span>{t}</span>
              </li>
            ))}
          </ul>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <div className="flex gap-3 rounded-2xl border border-line bg-surface p-4 text-sm">
              <CreditCard className="mt-0.5 size-5 shrink-0 text-accent-ink" aria-hidden strokeWidth={1.75} />
              <p className="text-muted">
                <span className="font-medium text-fg">No automatic charge.</span> When the month ends, access stops until you choose a plan.
              </p>
            </div>
            <div className="flex gap-3 rounded-2xl border border-line bg-surface p-4 text-sm">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent-ink" aria-hidden strokeWidth={1.75} />
              <p className="text-muted">
                <span className="font-medium text-fg">Simple prices afterwards.</span>{" "}
                <a href="/pricing" className="text-accent-ink underline">
                  See XPRISM and aMaze pricing
                </a>
                .
              </p>
            </div>
          </div>
        </div>

        <Card className="glow h-fit p-6 sm:p-8">
          <h2 className="text-lg font-semibold">{canAsk ? "Start your free month" : "Your free month"}</h2>
          <p className="mb-6 mt-1 text-sm text-muted">
            {canAsk
              ? `No form and no waiting: create your account, verify your email, and your ${offer.days} days start at once.`
              : "Each person gets one free month; here is where yours stands."}
          </p>
          {trial && where !== "declined" && (
            <div className="mb-6">
              <TrialStatus trial={trial} />
            </div>
          )}
          {canAsk ? (
            <FreeMonthStart days={offer.days} signedIn={!!s} emailVerified={!!s?.emailVerified} />
          ) : (
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/workspace">Open my applications</ButtonLink>
              <ButtonLink href="/pricing" variant="outline">
                See plans
              </ButtonLink>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
