"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Building2, Plus, Search } from "lucide-react";
import { LoadState, PageHeader, Table, useAdmin, useSigner } from "@/components/admin/kit";
import { Dialog } from "@/components/client";
import { Alert, Button, Field, Pill, formatDate } from "@/components/ui";
import { api } from "@/lib/api";
import { COUNTRIES } from "@/lib/money";

interface OrgRow {
  id: string;
  name: string;
  kind: string;
  status: "ACTIVE" | "SUSPENDED";
  domainWhitelist: string[];
  seatLimit: number;
  seatsUsed: number;
  billingCountry: string;
  createdAt: string;
  entitlements: { appId: string; expiresAt: string }[];
  subscriptions: { planCode: string; seats: number; currentPeriodEnd: string }[];
}

export const ORG_KINDS = ["UNIVERSITY", "COLLEGE", "RESEARCH_INSTITUTE", "HOSPITAL", "COMPANY", "GOVERNMENT", "OTHER"] as const;
export const parseDomains = (v: string) =>
  v
    .split(/[\s,;]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);

export function InstitutionsView() {
  const sign = useSigner();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const { data, error, loading, reload } = useAdmin<{ organizations: OrgRow[] }>(`/v1/api/admin/organizations${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  const [create, setCreate] = useState(false);
  const [form, setForm] = useState({ name: "", kind: "COLLEGE", domains: "", seatLimit: "25", billingCountry: "IN", contactName: "", contactEmail: "", contactPhone: "" });
  const [notice, setNotice] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    setCreate(false);
    sign({
      title: `Create institution "${form.name}"`,
      reason: "none",
      run: async ({ totpCode }) => {
        const r = await api<{ organization: { id: string } }>("/v1/api/admin/organizations", {
          method: "POST",
          body: {
            name: form.name,
            kind: form.kind,
            domainWhitelist: parseDomains(form.domains),
            seatLimit: Number(form.seatLimit),
            billingCountry: form.billingCountry,
            contactName: form.contactName || null,
            contactEmail: form.contactEmail || null,
            contactPhone: form.contactPhone || null,
            totpCode,
          },
        });
        setNotice("Institution created.");
        window.location.assign(`/admin/institutions/${r.organization.id}`);
      },
    });
  }

  return (
    <>
      <PageHeader
        title="Institutions"
        description="Institutional tenants: seat limits, whitelisted email domains, billing details, licences and proforma invoices."
        actions={
          <Button onClick={() => setCreate(true)}>
            <Plus className="size-4" aria-hidden /> New institution
          </Button>
        }
      />
      {notice && <Alert tone="success">{notice}</Alert>}
      <form
        className="mb-5 flex gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input className="field pl-9" placeholder="Institution name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search institutions" />
        </div>
        <Button type="submit">Search</Button>
      </form>
      <LoadState loading={loading && !data} error={error} onRetry={reload} />
      {data && (
        <Table head={["Institution", "Seats", "Domains", "Licences", "Status", "Created"]} empty={!data.organizations.length}>
          {data.organizations.map((o) => {
            const apps = [...new Set([...o.entitlements.map((e) => e.appId), ...(o.subscriptions.length ? ["site licence"] : [])])];
            return (
              <tr key={o.id}>
                <td>
                  <Link href={`/admin/institutions/${o.id}`} className="flex items-center gap-2 font-medium text-accent-ink hover:underline">
                    <Building2 className="size-4 shrink-0" aria-hidden /> {o.name}
                  </Link>
                  <span className="readout ml-6 text-xs text-subtle">{o.kind.replace("_", " ").toLowerCase()}</span>
                </td>
                <td className="readout">
                  {o.seatsUsed} / {o.seatLimit}
                </td>
                <td className="max-w-48 truncate text-xs text-muted">{o.domainWhitelist.join(", ") || "—"}</td>
                <td>{apps.length ? apps.map((a) => <Pill key={a} tone="live" className="mr-1">{a}</Pill>) : <span className="text-subtle">none</span>}</td>
                <td>{o.status === "ACTIVE" ? <Pill tone="live">active</Pill> : <Pill tone="danger">suspended</Pill>}</td>
                <td className="whitespace-nowrap text-muted">{formatDate(o.createdAt)}</td>
              </tr>
            );
          })}
        </Table>
      )}

      <Dialog open={create} onClose={() => setCreate(false)} title="New institution" wide>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Name" id="o-name">
                <input id="o-name" className="field" required minLength={2} value={form.name} onChange={set("name")} />
              </Field>
            </div>
            <Field label="Type" id="o-kind">
              <select id="o-kind" className="field" value={form.kind} onChange={set("kind")}>
                {ORG_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k.replace("_", " ").toLowerCase()}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Seat limit" id="o-seats">
              <input id="o-seats" type="number" min={1} className="field readout" value={form.seatLimit} onChange={set("seatLimit")} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Whitelisted email domains" id="o-domains" hint="Comma-separated, e.g. gcp.ac.in, students.gcp.ac.in. Verified addresses on these domains join automatically while seats last.">
                <input id="o-domains" className="field readout" value={form.domains} onChange={set("domains")} />
              </Field>
            </div>
            <Field label="Billing country" id="o-country">
              <select id="o-country" className="field" value={form.billingCountry} onChange={set("billingCountry")}>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Contact name" id="o-cname">
              <input id="o-cname" className="field" value={form.contactName} onChange={set("contactName")} />
            </Field>
            <Field label="Contact email" id="o-cemail">
              <input id="o-cemail" type="email" className="field" value={form.contactEmail} onChange={set("contactEmail")} />
            </Field>
            <Field label="Contact phone" id="o-cphone">
              <input id="o-cphone" type="tel" className="field" value={form.contactPhone} onChange={set("contactPhone")} />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={form.name.trim().length < 2}>
              Continue to sign
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
