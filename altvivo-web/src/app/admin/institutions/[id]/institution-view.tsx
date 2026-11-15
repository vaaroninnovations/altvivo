"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, FilePlus2, KeyRound, UserMinus, UserPlus } from "lucide-react";
import { LoadState, PageHeader, Table, useAdmin, useSigner } from "@/components/admin/kit";
import { InvoiceActions, InvoiceStatus, KIND_LABEL, ProformaDialog, type AdminInvoice } from "@/components/admin/invoices";
import { GrantLicenceDialog, LicenceTable, type ManualLicence } from "@/components/admin/licences";
import { BillingProfileForm } from "@/components/checkout";
import { Alert, Button, ButtonLink, Card, Field, Pill, formatDate } from "@/components/ui";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import type { BillingProfile } from "@/lib/types";
import { ORG_KINDS, parseDomains } from "../institutions-view";

interface OrgDetail {
  organization: {
    id: string;
    name: string;
    kind: string;
    status: "ACTIVE" | "SUSPENDED";
    domainWhitelist: string[];
    seatLimit: number;
    seatsUsed: number;
    billingCountry: string;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    notes: string | null;
    suspendedAt: string | null;
    billingProfile: BillingProfile | null;
    members: { id: string; email: string; fullName: string; role: string; emailVerifiedAt: string | null; disabledAt: string | null; lastLoginAt: string | null }[];
    entitlements: ManualLicence[];
    subscriptions: { id: string; planCode: string; seats: number; status: string; currentPeriodEnd: string; provider: string }[];
    invoices: AdminInvoice[];
  };
}

export function InstitutionView({ id }: { id: string }) {
  const sign = useSigner();
  const { data, error, loading, reload } = useAdmin<OrgDetail>(`/v1/api/admin/organizations/${id}`);
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const [grant, setGrant] = useState(false);
  const [proforma, setProforma] = useState(false);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState("");
  const [notice, setNotice] = useState<{ text: string; pdf?: string | null } | null>(null);
  const [error2, setError2] = useState<string | null>(null);

  if (!data) return <LoadState loading={loading} error={error} onRetry={reload} />;
  const o = data.organization;
  const form = edit ?? {
    name: o.name,
    kind: o.kind,
    seatLimit: String(o.seatLimit),
    domains: o.domainWhitelist.join(", "),
    contactName: o.contactName ?? "",
    contactEmail: o.contactEmail ?? "",
    contactPhone: o.contactPhone ?? "",
    notes: o.notes ?? "",
  };
  const set = (k: string) => (e: { target: { value: string } }) => setEdit({ ...form, [k]: e.target.value });
  const done = (text: string, pdf?: string | null) => {
    setNotice({ text, pdf });
    setEdit(null);
    void reload();
  };

  function save(e: FormEvent) {
    e.preventDefault();
    sign({
      title: `Update ${o.name}`,
      run: async ({ totpCode, reason }) => {
        await api(`/v1/api/admin/organizations/${o.id}`, {
          method: "PATCH",
          body: {
            name: form.name,
            kind: form.kind,
            seatLimit: Number(form.seatLimit),
            domainWhitelist: parseDomains(form.domains!),
            contactName: form.contactName || null,
            contactEmail: form.contactEmail || null,
            contactPhone: form.contactPhone || null,
            notes: form.notes || null,
            reason,
            totpCode,
          },
        });
        done("Institution updated.");
      },
    });
  }

  async function addMember(e: FormEvent) {
    e.preventDefault();
    setError2(null);
    try {
      await api(`/v1/api/admin/organizations/${o.id}/members`, { method: "POST", body: { email: memberEmail.trim(), ...(memberRole ? { role: memberRole } : {}) } });
      setMemberEmail("");
      done(`${memberEmail} added.`);
    } catch (err) {
      setError2(err instanceof Error ? err.message : "Could not add the member.");
    }
  }

  return (
    <>
      <Link href="/admin/institutions" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Institutions
      </Link>
      <PageHeader
        title={o.name}
        description={
          <>
            {o.seatsUsed} of {o.seatLimit} seats used · {o.domainWhitelist.length ? o.domainWhitelist.join(", ") : "no whitelisted domains"}
          </>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setGrant(true)}>
              <KeyRound className="size-4" aria-hidden /> Grant licence
            </Button>
            <Button onClick={() => setProforma(true)} disabled={!o.billingProfile}>
              <FilePlus2 className="size-4" aria-hidden /> New proforma
            </Button>
          </>
        }
      />
      {notice && (
        <div className="mb-6">
          <Alert tone="success" action={notice.pdf ? <ButtonLink href={notice.pdf} size="sm" target="_blank" rel="noopener">Download PDF</ButtonLink> : undefined}>
            {notice.text}
          </Alert>
        </div>
      )}
      {o.status === "SUSPENDED" && (
        <div className="mb-6">
          <Alert tone="danger" title="Suspended">
            Members do not receive the institution&apos;s licences while it is suspended.
          </Alert>
        </div>
      )}
      {!o.billingProfile && (
        <div className="mb-6">
          <Alert tone="warning" title="Add billing details first">Proformas and tax invoices need the institution&apos;s legal name, address and GSTIN (if registered).</Alert>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-subtle">Licences</h2>
            <LicenceTable licences={o.entitlements} onChanged={reload} />
            {o.subscriptions.length > 0 && (
              <div className="mt-3">
                <Table head={["Online site licence", "Seats", "Until", "Status"]} minWidth={480}>
                  {o.subscriptions.map((s) => (
                    <tr key={s.id}>
                      <td>
                        {s.planCode} <span className="readout text-xs text-subtle">{s.provider}</span>
                      </td>
                      <td className="readout">{s.seats}</td>
                      <td>{formatDate(s.currentPeriodEnd)}</td>
                      <td>{s.status.toLowerCase()}</td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-subtle">Proformas & invoices</h2>
            <Table head={["Number", "Type", "Issued", "Total", "Status", ""]} empty={!o.invoices.length} minWidth={760}>
              {o.invoices.map((i) => (
                <tr key={i.id}>
                  <td className="readout">{i.number}</td>
                  <td>
                    {KIND_LABEL[i.kind]}
                    {i.poNumber && <span className="block text-xs text-subtle">PO {i.poNumber}</span>}
                  </td>
                  <td className="whitespace-nowrap">{formatDate(i.issuedAt)}</td>
                  <td className="readout">{formatMoney(i.totalMinor, i.currency)}</td>
                  <td>
                    <InvoiceStatus inv={i} />
                  </td>
                  <td>
                    <InvoiceActions inv={i} onChanged={(m) => done(m)} />
                  </td>
                </tr>
              ))}
            </Table>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-subtle">
              Members ({o.seatsUsed} / {o.seatLimit} seats)
            </h2>
            <form onSubmit={addMember} className="mb-3 flex flex-wrap gap-2">
              <input className="field min-w-56 flex-1" type="email" placeholder="member@institution.edu" value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} aria-label="Member email" />
              <select className="field w-44" value={memberRole} onChange={(e) => setMemberRole(e.target.value)} aria-label="Role">
                <option value="">Keep current role</option>
                {["STUDENT", "RESEARCHER", "PI", "INSTITUTE_ADMIN"].map((r) => (
                  <option key={r} value={r}>
                    {r.replace("_", " ").toLowerCase()}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="outline" disabled={!memberEmail.includes("@")}>
                <UserPlus className="size-4" aria-hidden /> Add member
              </Button>
            </form>
            {error2 && (
              <div className="mb-3">
                <Alert tone="danger">{error2}</Alert>
              </div>
            )}
            <Table head={["Member", "Role", "Email", "Last sign-in", ""]} empty={!o.members.length} minWidth={640}>
              {o.members.map((m) => (
                <tr key={m.id} className={m.disabledAt ? "opacity-60" : ""}>
                  <td>
                    <Link href={`/admin/users/${m.id}`} className="text-accent-ink hover:underline">
                      {m.fullName}
                    </Link>
                    <span className="block text-xs text-subtle">{m.email}</span>
                  </td>
                  <td className="readout text-xs">{m.role}</td>
                  <td>{m.emailVerifiedAt ? <Pill tone="live">verified</Pill> : <Pill tone="soon">unverified</Pill>}</td>
                  <td className="text-muted">{m.lastLoginAt ? formatDate(m.lastLoginAt) : "never"}</td>
                  <td className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      onClick={async () => {
                        setError2(null);
                        try {
                          await api(`/v1/api/admin/organizations/${o.id}/members/${m.id}`, { method: "DELETE" });
                          done(`${m.email} removed; the seat is free.`);
                        } catch (err) {
                          setError2(err instanceof Error ? err.message : "Could not remove the member.");
                        }
                      }}
                    >
                      <UserMinus className="size-3.5" aria-hidden /> Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </Table>
          </section>
        </div>

        <aside className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-4 font-semibold">Tenant settings</h2>
            <form onSubmit={save} className="space-y-4">
              <Field label="Name" id="i-name">
                <input id="i-name" className="field" value={form.name} onChange={set("name")} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type" id="i-kind">
                  <select id="i-kind" className="field" value={form.kind} onChange={set("kind")}>
                    {ORG_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k.replace("_", " ").toLowerCase()}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Seat limit" id="i-seats">
                  <input id="i-seats" type="number" min={1} className="field readout" value={form.seatLimit} onChange={set("seatLimit")} />
                </Field>
              </div>
              <Field label="Whitelisted domains" id="i-domains">
                <textarea id="i-domains" rows={2} className="field readout" value={form.domains} onChange={set("domains")} />
              </Field>
              <Field label="Contact" id="i-cname">
                <input id="i-cname" className="field" placeholder="Name" value={form.contactName} onChange={set("contactName")} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <input aria-label="Contact email" type="email" className="field" placeholder="Email" value={form.contactEmail} onChange={set("contactEmail")} />
                <input aria-label="Contact phone" type="tel" className="field" placeholder="Phone" value={form.contactPhone} onChange={set("contactPhone")} />
              </div>
              <Field label="Internal notes" id="i-notes">
                <textarea id="i-notes" rows={3} className="field" maxLength={2000} value={form.notes} onChange={set("notes")} />
              </Field>
              <Button type="submit" className="w-full" disabled={!edit}>
                Save settings
              </Button>
            </form>
            <div className="mt-4 border-t border-line pt-4">
              <Button
                variant={o.status === "ACTIVE" ? "danger" : "outline"}
                className="w-full"
                onClick={() =>
                  sign({
                    title: o.status === "ACTIVE" ? `Suspend ${o.name}` : `Reactivate ${o.name}`,
                    description: o.status === "ACTIVE" ? "Members lose the institution's licences immediately; personal licences are not affected." : undefined,
                    danger: o.status === "ACTIVE",
                    run: async ({ totpCode, reason }) => {
                      await api(`/v1/api/admin/organizations/${o.id}`, { method: "PATCH", body: { status: o.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE", reason, totpCode } });
                      done(o.status === "ACTIVE" ? "Institution suspended." : "Institution reactivated.");
                    },
                  })
                }
              >
                {o.status === "ACTIVE" ? "Suspend institution" : "Reactivate institution"}
              </Button>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-4 font-semibold">Billing details (GST)</h2>
            <BillingProfileForm
              scope="organization"
              initial={o.billingProfile}
              endpoint={`/v1/api/admin/organizations/${o.id}/billing-profile`}
              onSaved={() => done("Billing details saved.")}
            />
          </Card>
        </aside>
      </div>

      <GrantLicenceDialog open={grant} onClose={() => setGrant(false)} holder={{ orgId: o.id, label: o.name }} onDone={() => done("Licence granted to the institution.")} />
      <ProformaDialog open={proforma} onClose={() => setProforma(false)} orgId={o.id} orgName={o.name} onDone={(m, pdf) => done(m, pdf)} />
    </>
  );
}
