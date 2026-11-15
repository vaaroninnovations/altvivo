"use client";

import { useState } from "react";
import Link from "next/link";
import { LoadState, PageHeader, Table, useAdmin } from "@/components/admin/kit";
import { Button, Pill, formatDate } from "@/components/ui";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import type { PaymentRow } from "@/lib/types";

type AdminPayment = PaymentRow & {
  userId: string | null;
  orgId: string | null;
  planCode: string | null;
  feeMinor: number | null;
  reference: string | null;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  failureCode: string | null;
  failureReason: string | null;
  user: { email: string } | null;
  organization: { name: string } | null;
  invoice: { number: string } | null;
};

const STATUS_TONE: Record<PaymentRow["status"], "live" | "soon" | "accent" | "muted" | "danger"> = {
  CREATED: "muted",
  AUTHORIZED: "accent",
  CAPTURED: "live",
  FAILED: "danger",
  PARTIALLY_REFUNDED: "soon",
  REFUNDED: "soon",
};

export function PaymentsView() {
  const [status, setStatus] = useState("");
  const [provider, setProvider] = useState("");
  const [more, setMore] = useState<AdminPayment[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const qs = (extra: Record<string, string> = {}) =>
    new URLSearchParams(Object.fromEntries(Object.entries({ status, provider, ...extra }).filter(([, v]) => v))).toString();
  const { data, error, loading, reload } = useAdmin<{ payments: AdminPayment[]; nextCursor: string | null }>(`/v1/api/admin/payments?${qs()}`);
  const reset = () => {
    setMore([]);
    setCursor(undefined);
  };
  const next = cursor === undefined ? data?.nextCursor : cursor;

  async function loadMore() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const r = await api<{ payments: AdminPayment[]; nextCursor: string | null }>(`/v1/api/admin/payments?${qs({ cursor: next })}`);
      setMore((m) => [...m, ...r.payments]);
      setCursor(r.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  const rows = [...(data?.payments ?? []), ...more];
  const captured = rows.filter((p) => p.status === "CAPTURED" || p.status === "PARTIALLY_REFUNDED");
  const totals = captured.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.currency]: (acc[p.currency] ?? 0) + p.amountMinor - p.refundedMinor }), {});

  return (
    <>
      <PageHeader
        title="Payments"
        description="Every Razorpay, Stripe and recorded bank-transfer payment. Provider webhooks are the source of truth; refunds are issued in the provider's dashboard and arrive here by webhook."
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <select
          className="field w-44"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            reset();
          }}
          aria-label="Status"
        >
          <option value="">Any status</option>
          {Object.keys(STATUS_TONE).map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ").toLowerCase()}
            </option>
          ))}
        </select>
        <select
          className="field w-44"
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            reset();
          }}
          aria-label="Provider"
        >
          <option value="">All providers</option>
          <option value="RAZORPAY">Razorpay</option>
          <option value="STRIPE">Stripe</option>
          <option value="BANK_TRANSFER">Bank transfer</option>
        </select>
        {Object.keys(totals).length > 0 && (
          <p className="text-sm text-muted">
            Net captured in view:{" "}
            {Object.entries(totals)
              .map(([c, v]) => formatMoney(v, c as PaymentRow["currency"]))
              .join(" · ")}
          </p>
        )}
      </div>
      <LoadState loading={loading && !data} error={error} onRetry={reload} />
      {data && (
        <>
          <Table head={["Date", "Payer", "Description", "Provider", "Amount", "Status", "Invoice"]} empty={!rows.length} minWidth={1000}>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="whitespace-nowrap">{formatDate(p.capturedAt ?? p.createdAt, true)}</td>
                <td>
                  {p.orgId ? (
                    <Link href={`/admin/institutions/${p.orgId}`} className="text-accent-ink hover:underline">
                      {p.organization?.name ?? "Institution"}
                    </Link>
                  ) : p.userId ? (
                    <Link href={`/admin/users/${p.userId}`} className="text-accent-ink hover:underline">
                      {p.user?.email ?? "User"}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="max-w-64">
                  <span className="line-clamp-2">{p.description}</span>
                  {p.failureReason && <span className="block text-xs text-danger">{p.failureReason}</span>}
                </td>
                <td className="readout text-xs">
                  {p.provider.replace("_", " ").toLowerCase()}
                  {p.method && ` · ${p.method}`}
                  <span className="block max-w-40 truncate text-subtle" title={p.providerPaymentId ?? p.reference ?? p.providerOrderId ?? ""}>
                    {p.providerPaymentId ?? p.reference ?? p.providerOrderId ?? ""}
                  </span>
                </td>
                <td className="readout whitespace-nowrap">
                  {formatMoney(p.amountMinor, p.currency)}
                  {p.refundedMinor > 0 && <span className="block text-xs text-soon-ink">−{formatMoney(p.refundedMinor, p.currency)} refunded</span>}
                  {p.feeMinor !== null && <span className="block text-xs text-subtle">fee {formatMoney(p.feeMinor, p.currency)}</span>}
                </td>
                <td>
                  <Pill tone={STATUS_TONE[p.status]}>{p.status.replace("_", " ").toLowerCase()}</Pill>
                </td>
                <td className="readout text-xs">
                  {p.invoice ? (
                    <Link href={`/admin/invoices?q=${encodeURIComponent(p.invoice.number)}`} className="text-accent-ink hover:underline">
                      {p.invoice.number}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </Table>
          {next && (
            <div className="mt-4 text-center">
              <Button variant="outline" onClick={loadMore} loading={loadingMore}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
