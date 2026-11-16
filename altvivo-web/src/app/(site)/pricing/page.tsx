import type { Metadata } from "next";
import { Gift } from "lucide-react";
import { ButtonLink, SectionHeading } from "@/components/ui";
import { getCatalog, getPublicApps, getTrialOffer } from "@/lib/server/core";
import { trialLength } from "@/lib/trial";
import { readSession } from "@/lib/server/session";
import { PricingView } from "./pricing-table";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Start with one month free, then subscribe to XPRISM (Rs 20,000 a year for 100 students and 4 teachers) or aMaze (Rs 15,000 a year, or Rs 20 per animal / video). Prices in Indian rupees with GST invoices; pay by UPI, cards or NetBanking through Razorpay.",
};

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ plan?: string; app?: string }> }) {
  const sp = await searchParams;
  const currency = "INR" as const;
  const [catalog, apps, state, offer] = await Promise.all([getCatalog(currency), getPublicApps(), readSession(), getTrialOffer()]);
  const s = state.session;

  return (
    <div className="border-b border-line">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <SectionHeading eyebrow="Pricing" title="One month free, then simple yearly pricing">
            Start with {offer.days} days of full access at no cost. Afterwards subscribe to XPRISM, to aMaze, or to both: they are separate products.
            Every purchase comes with a GST tax invoice.
          </SectionHeading>
        </div>

        <div className="glow mt-10 flex flex-col gap-5 rounded-2xl border border-accent/30 bg-accent-soft p-6 sm:flex-row sm:items-center sm:p-7">
          <span className="brand-gradient grid size-12 shrink-0 place-items-center rounded-xl text-white">
            <Gift className="size-6" aria-hidden />
          </span>
          <div className="flex-1">
            <p className="text-lg font-semibold">Not ready to pay? Take {trialLength(offer.days)} free.</p>
            <p className="mt-1 text-sm text-muted">
              Full access to {offer.apps.map((a) => a.name).join(" and ") || "every live application"} for {offer.days} days. No card needed and nothing is
              charged when it ends; pick a plan below whenever you are ready.
            </p>
          </div>
          <ButtonLink href="/free-month" size="lg" className="shrink-0">
            Request your free month
          </ButtonLink>
        </div>

        {catalog ? (
          <PricingView
            trialDays={offer.days}
            catalog={catalog}
            apps={apps.map((a) => ({ appId: a.appId, name: a.name, url: a.url, status: a.status, tagline: a.tagline }))}
            viewer={{ signedIn: !!s, emailVerified: s?.emailVerified ?? false, email: s?.email ?? null, role: s?.role ?? null, hasOrg: !!s?.orgId, name: s?.name ?? null }}
            preselectPlan={sp.plan ?? null}
            focusApp={sp.app ?? null}
          />
        ) : (
          <p role="status" className="mt-12 rounded-2xl border border-line bg-surface p-8 text-center text-muted">
            Prices could not be loaded just now. Please refresh in a moment, or write to{" "}
            <a className="text-accent-ink underline" href="mailto:sales@altvivo.bio">
              sales@altvivo.bio
            </a>
            .
          </p>
        )}
      </div>
    </div>
  );
}
