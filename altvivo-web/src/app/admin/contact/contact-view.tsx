"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { LoadState, PageHeader, adminError, useAdmin } from "@/components/admin/kit";
import { Alert, Button, ButtonLink, Card, Pill, formatDate } from "@/components/ui";
import { api } from "@/lib/api";
import { CONTACT_CATEGORIES } from "@/lib/contact";

type Status = "NEW" | "IN_PROGRESS" | "CLOSED" | "SPAM";
interface ContactMessage {
  id: string;
  name: string;
  email: string;
  institution: string | null;
  category: string;
  subject: string;
  message: string;
  appId: string | null;
  userId: string | null;
  status: Status;
  handledAt: string | null;
  createdAt: string;
}

const TONE: Record<Status, "accent" | "soon" | "muted" | "danger"> = { NEW: "accent", IN_PROGRESS: "soon", CLOSED: "muted", SPAM: "danger" };
const categoryLabel = (c: string) => CONTACT_CATEGORIES.find((x) => x.value === c)?.label ?? c;

export function ContactView() {
  const [status, setStatus] = useState<Status | "">("NEW");
  const [more, setMore] = useState<ContactMessage[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);
  const [error2, setError2] = useState<string | null>(null);
  const path = `/v1/api/admin/contact${status ? `?status=${status}` : ""}`;
  const { data, error, loading, reload, setData } = useAdmin<{ messages: ContactMessage[]; nextCursor: string | null }>(path);
  const next = cursor === undefined ? data?.nextCursor : cursor;
  const rows = [...(data?.messages ?? []), ...more];

  async function loadMore() {
    if (!next) return;
    const r = await api<{ messages: ContactMessage[]; nextCursor: string | null }>(`/v1/api/admin/contact?${new URLSearchParams({ ...(status ? { status } : {}), cursor: next })}`);
    setMore((m) => [...m, ...r.messages]);
    setCursor(r.nextCursor);
  }

  async function mark(m: ContactMessage, s: Exclude<Status, "NEW">) {
    setError2(null);
    try {
      const r = await api<{ message: ContactMessage }>(`/v1/api/admin/contact/${m.id}`, { method: "PATCH", body: { status: s } });
      const replace = (list: ContactMessage[]) => list.map((x) => (x.id === m.id ? r.message : x)).filter((x) => !status || x.status === status);
      if (data) setData({ ...data, messages: replace(data.messages) });
      setMore(replace);
    } catch (err) {
      setError2(adminError(err));
    }
  }

  return (
    <>
      <PageHeader title="Contact inbox" description="Messages from the /contact form: sales and institutional quotes, support, billing, privacy requests. Reply by email; mark progress here so nothing is answered twice." />
      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Message status">
        {(["NEW", "IN_PROGRESS", "CLOSED", "SPAM", ""] as const).map((s) => (
          <Button
            key={s || "all"}
            size="sm"
            role="tab"
            aria-selected={status === s}
            variant={status === s ? "primary" : "outline"}
            onClick={() => {
              setStatus(s);
              setMore([]);
              setCursor(undefined);
            }}
          >
            {s ? s.replace("_", " ").toLowerCase() : "all"}
          </Button>
        ))}
      </div>
      {error2 && (
        <div className="mb-4">
          <Alert tone="danger">{error2}</Alert>
        </div>
      )}
      <LoadState loading={loading && !data} error={error} onRetry={reload} />
      {data && !rows.length && <Card className="p-10 text-center text-sm text-muted">No messages here.</Card>}
      <ul className="space-y-3">
        {rows.map((m) => (
          <li key={m.id}>
            <Card className="p-5">
              <button type="button" className="flex w-full flex-col gap-1 text-left sm:flex-row sm:items-start sm:justify-between" aria-expanded={open === m.id} onClick={() => setOpen(open === m.id ? null : m.id)}>
                <span className="min-w-0">
                  <span className="block font-medium">{m.subject}</span>
                  <span className="block truncate text-sm text-muted">
                    {m.name} · {m.email}
                    {m.institution && ` · ${m.institution}`}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Pill tone="muted">{categoryLabel(m.category)}</Pill>
                  <Pill tone={TONE[m.status]}>{m.status.replace("_", " ").toLowerCase()}</Pill>
                  <span className="whitespace-nowrap text-xs text-subtle">{formatDate(m.createdAt, true)}</span>
                </span>
              </button>
              {open === m.id && (
                <div className="mt-4 space-y-4 border-t border-line pt-4">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.message}</p>
                  <p className="text-xs text-subtle">
                    {m.appId && <>About {m.appId} · </>}
                    {m.userId ? (
                      <Link href={`/admin/users/${m.userId}`} className="text-accent-ink hover:underline">
                        Signed-in user
                      </Link>
                    ) : (
                      "Not signed in"
                    )}
                    {m.handledAt && <> · last handled {formatDate(m.handledAt, true)}</>}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <ButtonLink size="sm" href={`mailto:${m.email}?subject=${encodeURIComponent(`Re: ${m.subject}`)}`} external>
                      <Mail className="size-3.5" aria-hidden /> Reply by email
                    </ButtonLink>
                    {m.status !== "IN_PROGRESS" && (
                      <Button size="sm" variant="outline" onClick={() => mark(m, "IN_PROGRESS")}>
                        In progress
                      </Button>
                    )}
                    {m.status !== "CLOSED" && (
                      <Button size="sm" variant="outline" onClick={() => mark(m, "CLOSED")}>
                        Close
                      </Button>
                    )}
                    {m.status !== "SPAM" && (
                      <Button size="sm" variant="ghost" className="text-danger" onClick={() => mark(m, "SPAM")}>
                        Spam
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>
      {next && (
        <div className="mt-4 text-center">
          <Button variant="outline" onClick={loadMore}>
            Load more
          </Button>
        </div>
      )}
    </>
  );
}
