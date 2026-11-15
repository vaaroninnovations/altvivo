import { coreGet, getCatalog } from "@/lib/server/core";
import { loadProtected, requestCurrency, viewerOf, type SearchParams } from "@/lib/server/protected";
import type { BillingProfile, InvoiceSummary, PaymentRow, SubscriptionRow, WorkspaceData } from "@/lib/types";
import { BillingView } from "./billing-view";

export const metadata = { title: "Billing & invoices" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { session, data: ws } = await loadProtected<WorkspaceData>("/workspace/billing", sp, "/v1/api/workspace");
  const token = session.token;
  const isOrgAdmin = !!session.orgId && (session.role === "INSTITUTE_ADMIN" || session.role === "SUPERADMIN");
  const [subs, invoices, payments, profile, orgProfile, catalog] = await Promise.all([
    coreGet<{ subscriptions: SubscriptionRow[] }>("/v1/api/billing/subscriptions", { token }),
    coreGet<{ invoices: InvoiceSummary[] }>("/v1/api/billing/invoices", { token }),
    coreGet<{ payments: PaymentRow[] }>("/v1/api/billing/payments", { token }),
    coreGet<{ profile: BillingProfile | null }>("/v1/api/billing/profile?scope=personal", { token }),
    isOrgAdmin ? coreGet<{ profile: BillingProfile | null }>("/v1/api/billing/profile?scope=organization", { token }) : Promise.resolve({ profile: null }),
    getCatalog(await requestCurrency(sp.currency)),
  ]);
  return (
    <BillingView
      data={{
        subscriptions: subs.subscriptions,
        invoices: invoices.invoices,
        payments: payments.payments,
        profile: profile.profile,
        orgProfile: orgProfile.profile,
        apps: ws.apps,
      }}
      catalog={catalog}
      viewer={viewerOf(session)}
      isOrgAdmin={isOrgAdmin}
      returned={{ status: typeof sp.status === "string" ? sp.status : null, invoice: typeof sp.invoice === "string" ? sp.invoice : null }}
    />
  );
}
