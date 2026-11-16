"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Mail, X } from "lucide-react";
import { LoadState, PageHeader, adminError, useAdmin, useSigner } from "@/components/admin/kit";
import { Alert, Button, ButtonLink, Card, Pill, formatDate } from "@/components/ui";
import { api } from "@/lib/api";

type Status = "PENDING" | "APPROVED" | "ACTIVE" | "DECLINED";
interface TrialRow {
  id: string;
  name: string;
  email: string;
  institution: string;
  designation: string | null;
  appIds: string[];
  useCase: string;
  status: Status;
  days: number;
  decidedAt: string | null;
  decisionNote: string | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  ended: boolean;
  account: { id: string; emailVerified: boolean; role: string; subscriptions: number } | null;
}
interface TrialList {
  defaultDays: number;
  counts: Partial<Record<Status, number>>;
  requests: TrialRow[];
  nextCursor: string | null;
}

const TABS: { value: Status | ""; label: string }[] = [
  { value: "PENDING", label: "Waiting" },
  { value: "APPROVED", label: "Approved, not started" },
  { value: "ACTIVE", label: "Started" },
  { value: "DECLINED", label: "Declined" },
  { value: "", label: "All" },
];
const TONE: Record<Status, "soon" | "accent" | "live" | "muted"> = { PENDING: "soon", APPROVED: "accent", ACTIVE: "live", DECLINED: "muted" };
const APP_NAME: Record<string, string> = { xprism: "XPRISM", amaze: "aMaze" };
const label = (r: TrialRow) => (r.status === "PENDING" ? "waiting" : r.status === "APPROVED" ? "approved" : r.status === "DECLINED" ? "declined" : r.ended ? "finished" : "running");

export function TrialsView() {
  const sign = useSigner();
  const [status, setStatus] = useState<Status | "">("PENDING");
  const [days, setDays] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const { data, error, loading, reload } = useAdmin<TrialList>(`/v1/api/admin/trials${status ? `?status=${status}` : ""}`);

  const approve = (r: TrialRow) => {
    const d = days[r.id] ?? r.days;
    sign({
      title: `Approve ${d} days free for ${r.name}`,
      description: r.account?.emailVerified
        ? `Access to ${r.appIds.map((a) => APP_NAME[a] ?? a).join(" and ")} starts now and ends after ${d} days. ${r.email} is told by email.`
        : `${r.email} has no verified account yet. The ${d} days start when that address has a verified account; we email the invitation now.`,
      reason: "none",
      confirmLabel: "Sign and approve",
      run: async (sig) => {
        await api(`/v1/api/admin/trials/${r.id}/approve`, { method: "POST", body: { totpCode: sig.totpCode, days: d } });
        setNotice({ tone: "success", text: `Free month approved for ${r.email}.` });
        await reload();
      },
    });
  };

  const decline = (r: TrialRow) =>
    sign({
      title: `Decline the request from ${r.name}`,
      description: "The person is told by email that the free month cannot be offered. Your reason stays internal.",
      requireCode: false,
      danger: true,
      confirmLabel: "Decline",
      run: async (sig) => {
        await api(`/v1/api/admin/trials/${r.id}/decline`, { method: "POST", body: { reason: sig.reason } });
        setNotice({ tone: "success", text: `Request from ${r.email} declined.` });
        await reload();
      },
    });

  return (
    <>
      <PageHeader
        title="Free-month requests"
        description={`Requests from the "one month free" form. Approving grants ${data?.defaultDays ?? 30} days of full access to the applications asked for, once per person; it is signed with your authenticator code and recorded in the audit trail.`}
      />
      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Request status">
        {TABS.map((t) => (
          <Button key={t.value || "all"} size="sm" role="tab" aria-selected={status === t.value} variant={status === t.value ? "primary" : "outline"} onClick={() => setStatus(t.value)}>
            {t.label}
            {t.value && data?.counts[t.value] ? <span className="readout ml-1 opacity-80">{data.counts[t.value]}</span> : null}
          </Button>
        ))}
      </div>
      {notice && (
        <div className="mb-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}
      <LoadState loading={loading && !data} error={error} onRetry={reload} />
      {data && !data.requests.length && <Card className="p-10 text-center text-sm text-muted">No requests here.</Card>}
      <ul className="space-y-3">
        {data?.requests.map((r) => (
          <li key={r.id}>
            <Card className="p-5 sm:p-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {r.name}
                    {r.designation && <span className="ml-2 text-sm font-normal text-muted">{r.designation}</span>}
                  </p>
                  <p className="truncate text-sm text-muted">
                    <span className="readout">{r.email}</span> · {r.institution}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {r.appIds.map((a) => (
                    <Pill key={a} tone="muted">
                      {APP_NAME[a] ?? a}
                    </Pill>
                  ))}
                  <Pill tone={r.ended ? "muted" : TONE[r.status]}>{label(r)}</Pill>
                  <span className="whitespace-nowrap text-xs text-subtle">{formatDate(r.createdAt, true)}</span>
                </div>
              </div>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{r.useCase}</p>
              <p className="mt-3 text-xs text-subtle">
                {r.account ? (
                  <>
                    <Link href={`/admin/users/${r.account.id}`} className="text-accent-ink underline">
                      Account
                    </Link>{" "}
                    · {r.account.emailVerified ? "email verified" : "email not verified"}
                    {r.account.subscriptions > 0 && ` · ${r.account.subscriptions} paid ${r.account.subscriptions === 1 ? "subscription" : "subscriptions"} on record`}
                  </>
                ) : (
                  "No account with this address yet"
                )}
                {r.status === "ACTIVE" && r.startsAt && r.endsAt && (
                  <>
                    {" "}
                    · {r.days} days, {formatDate(r.startsAt)} to {formatDate(r.endsAt)}
                  </>
                )}
                {r.decidedAt && r.status !== "ACTIVE" && <> · decided {formatDate(r.decidedAt, true)}</>}
                {r.decisionNote && <> · “{r.decisionNote}”</>}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {r.status === "PENDING" && (
                  <>
                    <label className="flex items-center gap-2 text-sm text-muted">
                      Days
                      <input
                        type="number"
                        min={1}
                        max={90}
                        className="field readout h-9 w-20 text-center"
                        value={days[r.id] ?? r.days}
                        onChange={(e) => setDays((d) => ({ ...d, [r.id]: Math.min(90, Math.max(1, Math.floor(Number(e.target.value) || 1))) }))}
                        aria-label={`Days of free access for ${r.name}`}
                      />
                    </label>
                    <Button size="sm" onClick={() => approve(r)}>
                      <Check className="size-4" aria-hidden /> Approve
                    </Button>
                  </>
                )}
                {(r.status === "PENDING" || r.status === "APPROVED") && (
                  <Button size="sm" variant="ghost" className="text-danger" onClick={() => decline(r)}>
                    <X className="size-4" aria-hidden /> Decline
                  </Button>
                )}
                <ButtonLink size="sm" variant="outline" href={`/admin/mail?${new URLSearchParams({ compose: r.email, subject: "Your free month on AltVivo" })}`}>
                  <Mail className="size-3.5" aria-hidden /> Write to {r.name.replace(/^(Dr|Prof|Mr|Mrs|Ms)\.?\s+/i, "").split(/\s+/)[0]}
                </ButtonLink>
                {r.status === "ACTIVE" && r.account && (
                  <Link href={`/admin/licences?userId=${r.account.id}`} className="text-xs text-accent-ink underline">
                    Licences (extend or revoke)
                  </Link>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
