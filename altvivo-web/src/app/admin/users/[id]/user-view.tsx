"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, KeyRound, LogOut, ShieldOff, UserCheck, UserX } from "lucide-react";
import { LoadState, PageHeader, Table, useAdmin, useSigner } from "@/components/admin/kit";
import { GrantLicenceDialog, LicenceTable, type ManualLicence } from "@/components/admin/licences";
import { Alert, Button, Card, Field, LicenceBadge, Pill, formatDate } from "@/components/ui";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import type { ApiEntitlement, InvoiceSummary, SubscriptionRow } from "@/lib/types";
import { ROLES } from "../users-view";

interface UserDetail {
  user: {
    id: string;
    email: string;
    fullName: string;
    affiliation: string | null;
    orcidId: string | null;
    role: (typeof ROLES)[number];
    orgId: string | null;
    mfaEnabled: boolean;
    emailVerifiedAt: string | null;
    lastLoginAt: string | null;
    lockedUntil: string | null;
    disabledAt: string | null;
    disabledReason: string | null;
    createdAt: string;
    organization: { id: string; name: string; status: string } | null;
  };
  access: { tier: string; entitlements: Record<string, ApiEntitlement> };
  activeSessions: number;
  subscriptions: (Omit<SubscriptionRow, "plan" | "scope" | "inForce"> & { planCode: string })[];
  licences: ManualLicence[];
  invoices: InvoiceSummary[];
}

export function UserView({ id }: { id: string }) {
  const sign = useSigner();
  const { data, error, loading, reload } = useAdmin<UserDetail>(`/v1/api/admin/users/${id}`);
  const orgs = useAdmin<{ organizations: { id: string; name: string }[] }>("/v1/api/admin/organizations");
  const [grant, setGrant] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [org, setOrg] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!data) return <LoadState loading={loading} error={error} onRetry={reload} />;
  const u = data.user;
  const currentRole = role ?? u.role;
  const currentOrg = org ?? u.orgId ?? "";
  const done = (msg: string) => {
    setNotice(msg);
    setRole(null);
    setOrg(null);
    void reload();
  };

  const patch = (body: Record<string, unknown>, title: string, msg: string, danger = false) =>
    sign({
      title,
      description: "The user's sessions are ended so their new access applies at once.",
      danger,
      run: async ({ totpCode, reason }) => {
        await api(`/v1/api/admin/users/${u.id}`, { method: "PATCH", body: { ...body, reason, totpCode } });
        done(msg);
      },
    });

  return (
    <>
      <Link href="/admin/users" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Users
      </Link>
      <PageHeader
        title={u.fullName}
        description={
          <>
            <span className="readout">{u.email}</span> · joined {formatDate(u.createdAt)} · {data.activeSessions} active {data.activeSessions === 1 ? "session" : "sessions"}
          </>
        }
        actions={
          <Button onClick={() => setGrant(true)}>
            <KeyRound className="size-4" aria-hidden /> Grant licence
          </Button>
        }
      />
      {notice && (
        <div className="mb-6">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      {u.disabledAt && (
        <div className="mb-6">
          <Alert tone="danger" title={`Suspended on ${formatDate(u.disabledAt)}`}>
            {u.disabledReason}
          </Alert>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-subtle">Access now</h2>
            <Card className="divide-y divide-line">
              {Object.entries(data.access.entitlements).map(([app, e]) => (
                <div key={app} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                  <span className="font-medium">{app}</span>
                  <span className="text-muted">
                    {e.active ? `${e.source}${e.plan ? ` · ${e.plan}` : ""}${e.expiresAt ? ` · until ${formatDate(e.expiresAt)}` : ""}` : "—"}
                  </span>
                  <LicenceBadge entitlement={e} />
                </div>
              ))}
            </Card>
            <p className="mt-2 text-xs text-subtle">Tier: {data.access.tier}. Institution grants require a verified email and an active institution.</p>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-subtle">Manual licences</h2>
            <LicenceTable licences={data.licences.filter((l) => l.userId === u.id)} onChanged={reload} />
            {data.licences.some((l) => l.orgId) && <p className="mt-2 text-xs text-subtle">Institution-wide licences are managed on the institution page.</p>}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-subtle">Subscriptions</h2>
            <Table head={["Plan", "Provider", "Period", "Status"]} empty={!data.subscriptions.length} minWidth={560}>
              {data.subscriptions.map((s) => (
                <tr key={s.id}>
                  <td>{s.planCode}</td>
                  <td className="readout text-xs">
                    {s.provider} · {s.billingMode === "RECURRING" ? "recurring" : "prepaid"}
                  </td>
                  <td className="whitespace-nowrap">
                    {s.currentPeriodStart ? `${formatDate(s.currentPeriodStart)} – ` : ""}
                    {formatDate(s.currentPeriodEnd)}
                  </td>
                  <td>
                    <Pill tone={s.status === "ACTIVE" ? "live" : s.status === "PAST_DUE" ? "soon" : "muted"}>{s.status.toLowerCase()}</Pill>
                  </td>
                </tr>
              ))}
            </Table>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-subtle">Invoices</h2>
            <Table head={["Number", "Date", "Total", "Status"]} empty={!data.invoices.length} minWidth={480}>
              {data.invoices.map((i) => (
                <tr key={i.id}>
                  <td className="readout">
                    <Link href={`/admin/invoices?q=${encodeURIComponent(i.number)}`} className="text-accent-ink hover:underline">
                      {i.number}
                    </Link>
                  </td>
                  <td>{formatDate(i.issuedAt)}</td>
                  <td className="readout">{formatMoney(i.totalMinor, i.currency)}</td>
                  <td>{i.status.toLowerCase()}</td>
                </tr>
              ))}
            </Table>
          </section>
        </div>

        <aside className="space-y-6">
          <Card className="space-y-4 p-5">
            <h2 className="font-semibold">Profile</h2>
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted">Affiliation</dt>
              <dd>{u.affiliation ?? "—"}</dd>
              <dt className="text-muted">ORCID</dt>
              <dd className="readout">{u.orcidId ?? "—"}</dd>
              <dt className="text-muted">Email</dt>
              <dd>{u.emailVerifiedAt ? `verified ${formatDate(u.emailVerifiedAt)}` : "not verified"}</dd>
              <dt className="text-muted">Two-factor</dt>
              <dd>{u.mfaEnabled ? "enabled" : "off"}</dd>
              <dt className="text-muted">Last sign-in</dt>
              <dd>{u.lastLoginAt ? formatDate(u.lastLoginAt, true) : "never"}</dd>
              {u.lockedUntil && new Date(u.lockedUntil) > new Date() && (
                <>
                  <dt className="text-muted">Locked until</dt>
                  <dd>{formatDate(u.lockedUntil, true)}</dd>
                </>
              )}
            </dl>
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="font-semibold">Role & institution</h2>
            <Field label="Role" id="role">
              <select id="role" className="field" value={currentRole} onChange={(e) => setRole(e.target.value)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r.replace("_", " ").toLowerCase()}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Institution" id="org" hint="Membership uses one of the institution's seats.">
              <select id="org" className="field" value={currentOrg} onChange={(e) => setOrg(e.target.value)}>
                <option value="">No institution</option>
                {(orgs.data?.organizations ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
            <Button
              className="w-full"
              disabled={currentRole === u.role && currentOrg === (u.orgId ?? "")}
              onClick={() =>
                patch(
                  { ...(currentRole !== u.role ? { role: currentRole } : {}), ...(currentOrg !== (u.orgId ?? "") ? { orgId: currentOrg || null } : {}) },
                  `Update ${u.fullName}`,
                  "Role / institution updated.",
                )
              }
            >
              <UserCheck className="size-4" aria-hidden /> Save changes
            </Button>
          </Card>

          <Card className="space-y-3 p-5">
            <h2 className="font-semibold">Security actions</h2>
            {u.disabledAt ? (
              <Button variant="outline" className="w-full" onClick={() => patch({ disabled: false }, `Reactivate ${u.fullName}`, "Account reactivated.")}>
                <UserCheck className="size-4" aria-hidden /> Reactivate account
              </Button>
            ) : (
              <Button variant="danger" className="w-full" onClick={() => patch({ disabled: true }, `Suspend ${u.fullName}`, "Account suspended and signed out everywhere.", true)}>
                <UserX className="size-4" aria-hidden /> Suspend account
              </Button>
            )}
            <Button
              variant="outline"
              className="w-full"
              disabled={!u.mfaEnabled}
              onClick={() =>
                sign({
                  title: `Reset two-factor for ${u.fullName}`,
                  description: "Only after verifying the person's identity out of band. They must enrol again at next sign-in.",
                  danger: true,
                  run: async ({ totpCode, reason }) => {
                    await api(`/v1/api/admin/users/${u.id}/mfa-reset`, { method: "POST", body: { totpCode, reason } });
                    done("Two-factor reset; the user has been signed out.");
                  },
                })
              }
            >
              <ShieldOff className="size-4" aria-hidden /> Reset two-factor
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() =>
                sign({
                  title: `Sign ${u.fullName} out everywhere`,
                  reason: "required",
                  requireCode: false,
                  confirmLabel: "Sign out everywhere",
                  run: async ({ reason }) => {
                    await api(`/v1/api/admin/users/${u.id}/logout-all`, { method: "POST", body: { reason } });
                    done("All sessions ended.");
                  },
                })
              }
            >
              <LogOut className="size-4" aria-hidden /> Sign out all sessions
            </Button>
          </Card>
        </aside>
      </div>

      <GrantLicenceDialog open={grant} onClose={() => setGrant(false)} holder={{ userId: u.id, label: u.fullName }} onDone={() => done("Licence granted.")} />
    </>
  );
}
