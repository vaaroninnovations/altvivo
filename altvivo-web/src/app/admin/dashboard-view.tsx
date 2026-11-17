"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Kpi, LoadState, PageHeader, Table, useAdmin } from "@/components/admin/kit";
import { Button, Card } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import type { Currency } from "@/lib/types";

interface Dashboard {
  generatedAt: string;
  recurringRevenue: { currency: Currency; mrrMinor: number; arrMinor: number; subscriptions: number }[];
  activeLicencesByApp: { appId: string; holders: number; seats: number }[];
  activeSubscriptionsByKind: { kind: string; subs: number; seats: number }[];
  sessions: { active: number; users24h: number };
  revenueLast30Days: { currency: Currency; grossMinor: number; taxMinor: number; refundedMinor: number; netMinor: number; payments: number }[];
  users: { total: number; verified: number; new30: number; disabled: number };
  openProformas: { currency: Currency; count: number; totalMinor: number }[];
  freeMonth: { pending: number; approved: number; active: number; ended: number; declined: number };
  mailbox: { unread: number };
}

const APP_NAME: Record<string, string> = { xprism: "XPRISM", amaze: "aMaze" };
const num = (n: number) => new Intl.NumberFormat("en-IN").format(n);

export function DashboardView() {
  const { data, error, loading, reload } = useAdmin<Dashboard>("/v1/api/admin/dashboard");
  const rr = (c: Currency) => data?.recurringRevenue.find((r) => r.currency === c);
  const kind = (k: string) => data?.activeSubscriptionsByKind.find((r) => r.kind === k);
  const lic = (a: string) => data?.activeLicencesByApp.find((r) => r.appId === a);

  return (
    <>
      <PageHeader
        title="Revenue & telemetry"
        description="Recurring revenue is GST-exclusive and covers subscriptions in force. Manual (offline) licences appear in revenue when their payment is recorded; free months earn nothing and are counted on their own."
        actions={
          <Button variant="outline" size="sm" onClick={reload} loading={loading}>
            <RefreshCw className="size-4" aria-hidden /> Refresh
          </Button>
        }
      />
      <LoadState loading={loading && !data} error={error} onRetry={reload} />
      {data && (
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {(["INR"] as const).map((c) => (
              <Kpi
                key={c}
                label="Monthly recurring revenue"
                tone="accent"
                value={formatMoney(rr(c)?.mrrMinor ?? 0, c, { round: true })}
                sub={`ARR ${formatMoney(rr(c)?.arrMinor ?? 0, c, { round: true })} · ${rr(c)?.subscriptions ?? 0} subscriptions`}
              />
            ))}
            <Kpi label="Active sessions" value={num(data.sessions.active)} sub={`${num(data.sessions.users24h)} users in the last 24 h`} />
            <Kpi label="Users" value={num(data.users.total)} sub={`${num(data.users.verified)} verified · ${num(data.users.new30)} new in 30 days · ${num(data.users.disabled)} suspended`} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {["xprism", "amaze"].map((a) => (
              <Kpi key={a} label={`Licensed · ${APP_NAME[a]}`} tone="live" value={num(lic(a)?.holders ?? 0)} sub={`${num(lic(a)?.seats ?? 0)} seats incl. institutions`} />
            ))}
            <Kpi label="Dual-Suite bundles" value={num(kind("BUNDLE")?.subs ?? 0)} sub={`${num(kind("SINGLE_APP")?.subs ?? 0)} single-app subscriptions`} />
            <Kpi label="Site licences (online)" value={num(kind("SITE_LICENSE")?.subs ?? 0)} sub={`${num(kind("SITE_LICENSE")?.seats ?? 0)} seats`} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Link href="/admin/trials" className="block rounded-2xl transition hover:-translate-y-0.5">
              <Kpi
                label="Free-month requests waiting"
                tone={data.freeMonth.pending ? "soon" : undefined}
                value={num(data.freeMonth.pending)}
                sub={`${num(data.freeMonth.approved)} approved, not started yet`}
              />
            </Link>
            <Kpi label="Free months running" tone="live" value={num(data.freeMonth.active)} sub={`${num(data.freeMonth.ended)} finished · ${num(data.freeMonth.declined)} declined`} />
            <Link href="/admin/mail" className="block rounded-2xl transition hover:-translate-y-0.5">
              <Kpi label="Unread mail" tone={data.mailbox.unread ? "accent" : undefined} value={num(data.mailbox.unread)} sub="Enquiries, free-month requests and replies" />
            </Link>
            <Kpi label="Licensed · total" value={num((lic("xprism")?.holders ?? 0) + (lic("amaze")?.holders ?? 0))} sub="Paid and manual licences; free months are counted separately" />
          </div>

          <div className="grid gap-6">
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-subtle">Revenue · last 30 days</h2>
              <Table head={["Currency", "Payments", "Gross", "GST", "Refunded", "Net"]} empty={!data.revenueLast30Days.length} minWidth={520}>
                {data.revenueLast30Days.map((r) => (
                  <tr key={r.currency}>
                    <td className="readout">{r.currency}</td>
                    <td>{r.payments}</td>
                    <td className="readout">{formatMoney(r.grossMinor, r.currency)}</td>
                    <td className="readout">{formatMoney(r.taxMinor, r.currency)}</td>
                    <td className="readout">{formatMoney(r.refundedMinor, r.currency)}</td>
                    <td className="readout font-semibold">{formatMoney(r.netMinor, r.currency)}</td>
                  </tr>
                ))}
              </Table>
              {data.openProformas.length > 0 && (
                <Card className="mt-4 p-4 text-sm">
                  <span className="font-medium">Open proformas:</span>{" "}
                  {data.openProformas.map((p) => `${p.count} × ${formatMoney(p.totalMinor, p.currency)} total`).join(" · ")}.{" "}
                  <Link href="/admin/invoices?kind=PROFORMA&status=ISSUED" className="text-accent-ink underline">
                    Review
                  </Link>
                </Card>
              )}
            </section>
          </div>
          <p className="readout text-xs text-subtle">Generated {new Date(data.generatedAt).toLocaleString("en-IN")}</p>
        </div>
      )}
    </>
  );
}
