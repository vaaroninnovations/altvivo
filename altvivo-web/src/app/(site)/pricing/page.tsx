import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { SectionHeading, cx } from "@/components/ui";
import { getCatalog, getPublicApps } from "@/lib/server/core";
import { readSession } from "@/lib/server/session";
import { PricingView } from "./pricing-table";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "XPRISM and aMaze licences: single-app, Dual-Suite bundle and institutional site licences. INR with GST invoices via Razorpay (UPI, cards, NetBanking) or USD via Stripe.",
};

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ currency?: string; plan?: string; app?: string; seats?: string }> }) {
  const sp = await searchParams;
  const country = (await headers()).get("cf-ipcountry")?.toUpperCase();
  const currency: "INR" | "USD" = sp.currency === "INR" || sp.currency === "USD" ? sp.currency : country === "IN" ? "INR" : "USD";
  const [catalog, apps, state] = await Promise.all([getCatalog(currency), getPublicApps(), readSession()]);
  const s = state.session;
  const keep = (c: string) => `/pricing?currency=${c}${sp.app ? `&app=${encodeURIComponent(sp.app)}` : ""}`;

  return (
    <div className="border-b border-line">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <SectionHeading eyebrow="Pricing" title="Licences for researchers, labs and institutions">
            Choose one application, both together at a bundle price, or a site licence for your department. Every purchase comes with a GST tax invoice.
          </SectionHeading>
          <div className="flex flex-col items-start gap-2 lg:items-end">
            <div role="group" aria-label="Currency" className="inline-flex rounded-full border border-line bg-surface p-1">
              {(["INR", "USD"] as const).map((c) => (
                <Link
                  key={c}
                  href={keep(c)}
                  aria-current={currency === c ? "true" : undefined}
                  scroll={false}
                  className={cx("readout rounded-full px-4 py-1.5 text-sm transition", currency === c ? "bg-fg text-bg" : "text-muted hover:text-fg")}
                >
                  {c === "INR" ? "₹ INR" : "$ USD"}
                </Link>
              ))}
            </div>
            <p className="text-xs text-subtle">{currency === "INR" ? "Razorpay · UPI, cards, NetBanking · GST invoice" : "Stripe · cards worldwide · zero-rated export invoice"}</p>
          </div>
        </div>

        {catalog ? (
          <PricingView
            catalog={catalog}
            apps={apps.map((a) => ({ appId: a.appId, name: a.name, url: a.url, status: a.status, tagline: a.tagline }))}
            viewer={{ signedIn: !!s, emailVerified: s?.emailVerified ?? false, email: s?.email ?? null, role: s?.role ?? null, hasOrg: !!s?.orgId, name: s?.name ?? null }}
            preselectPlan={sp.plan ?? null}
            focusApp={sp.app ?? null}
            initialSeats={Number(sp.seats) || null}
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
