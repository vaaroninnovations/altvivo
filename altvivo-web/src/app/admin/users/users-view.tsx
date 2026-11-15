"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { LoadState, PageHeader, Table, useAdmin } from "@/components/admin/kit";
import { Button, Pill, formatDate } from "@/components/ui";

export interface AdminUserRow {
  id: string;
  email: string;
  fullName: string;
  affiliation: string | null;
  role: string;
  orgId: string | null;
  mfaEnabled: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  disabledAt: string | null;
  disabledReason: string | null;
  createdAt: string;
  organization: { name: string } | null;
}

export const ROLES = ["STUDENT", "RESEARCHER", "PI", "INSTITUTE_ADMIN", "ADVISORY_BOARD", "SUPERADMIN"] as const;

export function UsersView() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [pages, setPages] = useState<AdminUserRow[][]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const base = `/v1/api/admin/users?limit=50${query ? `&q=${encodeURIComponent(query)}` : ""}${role ? `&role=${role}` : ""}`;
  const { data, error, loading, reload } = useAdmin<{ users: AdminUserRow[]; nextCursor: string | null }>(cursor ? `${base}&cursor=${cursor}` : base);

  useEffect(() => {
    if (!data) return;
    setPages((p) => (cursor ? [...p, data.users] : [data.users]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- append once per page
  }, [data]);

  const rows = pages.flat();
  const search = (e: React.FormEvent) => {
    e.preventDefault();
    setCursor(null);
    setPages([]);
    setQuery(q.trim());
  };

  return (
    <>
      <PageHeader title="Users" description="Search accounts, change roles, suspend, reset two-factor and manage manual licences." />
      <form onSubmit={search} className="mb-5 flex flex-wrap gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input className="field pl-9" placeholder="Name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
        </div>
        <select
          className="field w-48"
          value={role}
          onChange={(e) => {
            setCursor(null);
            setPages([]);
            setRole(e.target.value);
          }}
          aria-label="Filter by role"
        >
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r.replace("_", " ").toLowerCase()}
            </option>
          ))}
        </select>
        <Button type="submit">Search</Button>
      </form>
      <LoadState loading={loading && !rows.length} error={error} onRetry={reload} />
      {rows.length > 0 && (
        <Table head={["User", "Role", "Institution", "Security", "Last sign-in", "Status"]}>
          {rows.map((u) => (
            <tr key={u.id}>
              <td>
                <Link href={`/admin/users/${u.id}`} className="font-medium text-accent-ink hover:underline">
                  {u.fullName}
                </Link>
                <span className="block text-xs text-subtle">{u.email}</span>
              </td>
              <td className="readout text-xs">{u.role}</td>
              <td className="text-muted">{u.organization?.name ?? "—"}</td>
              <td className="space-x-1">
                {u.mfaEnabled ? <Pill tone="live">2FA</Pill> : <Pill tone="muted">No 2FA</Pill>}
                {!u.emailVerifiedAt && <Pill tone="soon">Unverified</Pill>}
              </td>
              <td className="whitespace-nowrap text-muted">{u.lastLoginAt ? formatDate(u.lastLoginAt, true) : "never"}</td>
              <td>{u.disabledAt ? <Pill tone="danger">Suspended</Pill> : <Pill tone="live">Active</Pill>}</td>
            </tr>
          ))}
        </Table>
      )}
      {!loading && !rows.length && !error && <p className="py-10 text-center text-sm text-subtle">No users match.</p>}
      {data?.nextCursor && (
        <div className="mt-4 text-center">
          <Button variant="outline" onClick={() => setCursor(data.nextCursor)} loading={loading}>
            Load more
          </Button>
        </div>
      )}
    </>
  );
}
