"use client";

import { Fragment, useState, type FormEvent } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { LoadState, PageHeader, Table, adminError, useAdmin } from "@/components/admin/kit";
import { Alert, Button, formatDate } from "@/components/ui";
import { api } from "@/lib/api";

interface AuditEvent {
  id: string;
  timestamp: string;
  actorType: string;
  actorId: string | null;
  actorIp: string | null;
  userAgent: string | null;
  appId: string;
  eventType: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  recordHash: string;
}

const PRESETS = [
  { value: "", label: "All events" },
  { value: "AUTH.", label: "Authentication" },
  { value: "BILLING.", label: "Billing & payments" },
  { value: "ADMIN.", label: "Admin actions" },
  { value: "SECURITY.", label: "Security alerts" },
  { value: "ORG.", label: "Institutions" },
  { value: "VAULT.", label: "Data vault" },
  { value: "DB.", label: "Record changes (triggers)" },
];

const EMPTY = { eventType: "", actorId: "", appId: "", resourceId: "", from: "", to: "" };
type Filters = typeof EMPTY;

const toQuery = (f: Filters, extra: Record<string, string> = {}) => {
  const p: Record<string, string> = {};
  if (f.eventType.trim()) p.eventType = f.eventType.trim().toUpperCase();
  if (f.actorId.trim()) p.actorId = f.actorId.trim();
  if (f.appId.trim()) p.appId = f.appId.trim().toLowerCase();
  if (f.resourceId.trim()) p.resourceId = f.resourceId.trim();
  if (f.from) p.from = new Date(`${f.from}T00:00:00+05:30`).toISOString();
  if (f.to) p.to = new Date(`${f.to}T23:59:59+05:30`).toISOString();
  return new URLSearchParams({ ...p, limit: "100", ...extra }).toString();
};

export function AuditView() {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [more, setMore] = useState<AuditEvent[]>([]);
  const [before, setBefore] = useState<string | null | undefined>(undefined);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [verify, setVerify] = useState<{ ok: boolean; rowsChecked: number; firstBadId: string | null; reason: string | null } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const { data, error, loading, reload } = useAdmin<{ events: AuditEvent[]; nextBefore: string | null }>(`/v1/api/admin/audit?${toQuery(filters)}`);
  const next = before === undefined ? data?.nextBefore : before;
  const rows = [...(data?.events ?? []), ...more];
  const set = (k: keyof Filters) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  function apply(e?: FormEvent, f: Filters = draft) {
    e?.preventDefault();
    setFilters(f);
    setMore([]);
    setBefore(undefined);
  }

  async function loadMore() {
    if (!next) return;
    const r = await api<{ events: AuditEvent[]; nextBefore: string | null }>(`/v1/api/admin/audit?${toQuery(filters, { before: next })}`);
    setMore((m) => [...m, ...r.events]);
    setBefore(r.nextBefore);
  }

  async function runVerify() {
    setVerifying(true);
    setVerifyError(null);
    try {
      setVerify(await api("/v1/api/admin/audit/verify"));
    } catch (err) {
      setVerifyError(adminError(err));
    } finally {
      setVerifying(false);
    }
  }

  const actorLabel = (e: AuditEvent) => {
    const m = e.metadata as { signature?: { signer_name?: string }; email?: string };
    return m.signature?.signer_name ?? (e.actorId ? `${e.actorId.slice(0, 8)}…` : e.actorType.toLowerCase());
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only, hash-chained trail of security, billing and admin events. Rows cannot be updated or deleted; the chain check recomputes every hash."
        actions={
          <Button variant="outline" onClick={runVerify} loading={verifying}>
            <ShieldCheck className="size-4" aria-hidden /> Verify chain
          </Button>
        }
      />
      {verifyError && (
        <div className="mb-5">
          <Alert tone="danger">{verifyError}</Alert>
        </div>
      )}
      {verify && (
        <div className="mb-5">
          {verify.ok ? (
            <Alert tone="success" title="Chain intact">
              All {verify.rowsChecked.toLocaleString("en-IN")} records verified; every hash links to its predecessor.
            </Alert>
          ) : (
            <Alert tone="danger" title="Chain broken">
              <span className="flex items-center gap-1.5">
                <ShieldAlert className="size-4" aria-hidden /> First bad record #{verify.firstBadId}: {verify.reason}. Treat this as a security incident.
              </span>
            </Alert>
          )}
        </div>
      )}

      <form onSubmit={apply} className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <select
          className="field lg:col-span-1"
          aria-label="Event category"
          value={PRESETS.some((p) => p.value === draft.eventType) ? draft.eventType : "custom"}
          onChange={(e) => {
            if (e.target.value === "custom") return;
            const f = { ...draft, eventType: e.target.value };
            setDraft(f);
            apply(undefined, f);
          }}
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
          {!PRESETS.some((p) => p.value === draft.eventType) && <option value="custom">Custom prefix</option>}
        </select>
        <input className="field readout" placeholder="Event prefix, e.g. AUTH.LOGIN" value={draft.eventType} onChange={set("eventType")} aria-label="Event type prefix" />
        <input className="field readout" placeholder="Actor user ID" value={draft.actorId} onChange={set("actorId")} aria-label="Actor user ID" />
        <input className="field readout" placeholder="Resource ID" value={draft.resourceId} onChange={set("resourceId")} aria-label="Resource ID" />
        <input className="field" type="date" value={draft.from} onChange={set("from")} aria-label="From date" />
        <input className="field" type="date" value={draft.to} onChange={set("to")} aria-label="To date" />
        <input className="field readout" placeholder="App (core, xprism, amaze)" value={draft.appId} onChange={set("appId")} aria-label="Application" />
        <div className="flex gap-2 sm:col-span-1 lg:col-span-5">
          <Button type="submit">Apply filters</Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setDraft(EMPTY);
              apply(undefined, EMPTY);
            }}
          >
            Reset
          </Button>
        </div>
      </form>

      <LoadState loading={loading && !data} error={error} onRetry={reload} />
      {data && (
        <>
          <Table head={["#", "Time (IST)", "Event", "Actor", "App", "Resource", "IP"]} empty={!rows.length} minWidth={960}>
            {rows.map((e) => (
              <Fragment key={e.id}>
                <tr className="cursor-pointer hover:bg-surface-2" onClick={() => setExpanded(expanded === e.id ? null : e.id)} aria-expanded={expanded === e.id}>
                  <td className="readout text-xs text-subtle">{e.id}</td>
                  <td className="whitespace-nowrap text-xs">{formatDate(e.timestamp, true)}</td>
                  <td className={`readout text-xs font-medium ${/FAIL|DENIED|REVOKE|SUSPEND|BREACH|REUSE/.test(e.eventType) ? "text-danger" : ""}`}>{e.eventType}</td>
                  <td className="text-xs">{actorLabel(e)}</td>
                  <td className="readout text-xs">{e.appId}</td>
                  <td className="readout max-w-48 truncate text-xs text-muted">{e.resourceId ?? "—"}</td>
                  <td className="readout text-xs text-muted">{e.actorIp ?? "—"}</td>
                </tr>
                {expanded === e.id && (
                  <tr>
                    <td colSpan={7} className="bg-surface-2">
                      <pre className="readout max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(e.metadata, null, 2)}</pre>
                      <p className="readout mt-2 text-[11px] text-subtle">
                        actor {e.actorId ?? e.actorType} · hash {e.recordHash.slice(0, 16)}…{e.userAgent ? ` · ${e.userAgent}` : ""}
                      </p>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </Table>
          {next && (
            <div className="mt-4 text-center">
              <Button variant="outline" onClick={loadMore}>
                Load older events
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
