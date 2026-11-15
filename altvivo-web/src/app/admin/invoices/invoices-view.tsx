"use client";

import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { LoadState, PageHeader, Table, useAdmin } from "@/components/admin/kit";
import { InvoiceActions, InvoiceStatus, KIND_LABEL, type AdminInvoice } from "@/components/admin/invoices";
import { Alert, Button, formatDate } from "@/components/ui";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/money";

type Filters = { kind: string; status: string; q: string };

export function InvoicesView({ initial }: { initial: Filters }) {
  const [filters, setFilters] = useState<Filters>(initial);
  const [q, setQ] = useState(initial.q);
  const [more, setMore] = useState<AdminInvoice[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const qs = (extra: Record<string, string> = {}) =>
    new URLSearchParams(Object.fromEntries(Object.entries({ ...filters, ...extra }).filter(([, v]) => v))).toString();
  const path = `/v1/api/admin/invoices?${qs()}`;
  const { data, error, loading, reload } = useAdmin<{ invoices: AdminInvoice[]; nextCursor: string | null }>(path);

  const update = (f: Partial<Filters>) => {
    setFilters((cur) => ({ ...cur, ...f }));
    setMore([]);
    setCursor(undefined);
  };
  const refresh = (msg: string) => {
    setNotice(msg);
    setMore([]);
    setCursor(undefined);
    void reload();
  };
  const next = cursor === undefined ? data?.nextCursor : cursor;

  async function loadMore() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const r = await api<{ invoices: AdminInvoice[]; nextCursor: string | null }>(`/v1/api/admin/invoices?${qs({ cursor: next })}`);
      setMore((m) => [...m, ...r.invoices]);
      setCursor(r.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  const rows = [...(data?.invoices ?? []), ...more];

  return (
    <>
      <PageHeader
        title="Invoices"
        description="GST tax invoices, proformas and credit notes. Numbers are gapless per series and issued by the database; documents are never edited or deleted, only cancelled or credited."
      />
      {notice && (
        <div className="mb-5">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      <form
        className="mb-5 flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: q.trim() });
        }}
      >
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input className="field pl-9" placeholder="Number, buyer name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search invoices" />
        </div>
        <select className="field w-40" value={filters.kind} onChange={(e) => update({ kind: e.target.value })} aria-label="Document type">
          <option value="">All types</option>
          {Object.entries(KIND_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select className="field w-36" value={filters.status} onChange={(e) => update({ status: e.target.value })} aria-label="Status">
          <option value="">Any status</option>
          <option value="ISSUED">Issued / unpaid</option>
          <option value="PAID">Paid</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <Button type="submit">Search</Button>
      </form>
      <LoadState loading={loading && !data} error={error} onRetry={reload} />
      {data && (
        <>
          <Table head={["Number", "Type", "Buyer", "Issued", "Taxable", "GST", "Total", "Status", ""]} empty={!rows.length} minWidth={1060}>
            {rows.map((i) => (
              <tr key={i.id}>
                <td className="readout whitespace-nowrap">{i.number}</td>
                <td className="whitespace-nowrap">
                  {KIND_LABEL[i.kind]}
                  {i.poNumber && <span className="block text-xs text-subtle">PO {i.poNumber}</span>}
                </td>
                <td>
                  {i.orgId ? (
                    <Link href={`/admin/institutions/${i.orgId}`} className="text-accent-ink hover:underline">
                      {i.buyerName}
                    </Link>
                  ) : i.userId ? (
                    <Link href={`/admin/users/${i.userId}`} className="text-accent-ink hover:underline">
                      {i.buyerName}
                    </Link>
                  ) : (
                    i.buyerName
                  )}
                  <span className="block text-xs text-subtle">{i.taxTreatment.replace("_", "-").toLowerCase()}</span>
                </td>
                <td className="whitespace-nowrap">{formatDate(i.issuedAt)}</td>
                <td className="readout whitespace-nowrap">{formatMoney(i.taxableMinor, i.currency)}</td>
                <td className="readout whitespace-nowrap text-muted">{formatMoney(i.taxMinor, i.currency)}</td>
                <td className="readout whitespace-nowrap font-medium">{formatMoney(i.totalMinor, i.currency)}</td>
                <td>
                  <InvoiceStatus inv={i} />
                </td>
                <td>
                  <InvoiceActions inv={i} onChanged={refresh} />
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
