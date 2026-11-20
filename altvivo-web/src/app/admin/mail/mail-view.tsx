"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Bold, Download, Paperclip, CornerUpLeft, FileEdit, Forward, Heading, Inbox, Italic, Link2, List, ListOrdered, MailOpen, Mail as MailIcon, PenSquare, Quote, RefreshCw, RotateCcw, Search, Send, Star, Strikethrough, Trash2, Underline } from "lucide-react";
import { LoadState, PageHeader, adminError, useAdmin } from "@/components/admin/kit";
import { Dialog } from "@/components/client";
import { Alert, Button, Card, Field, Pill, cx, formatDate } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { MAIL_TEMPLATES } from "./templates";
import { WEB_STYLE, renderMailHtml } from "./format";

type Folder = "INBOX" | "SENT" | "DRAFT" | "TRASH";
type View = Folder | "STARRED";

interface Counts {
  inbox: number;
  unread: number;
  starred: number;
  sent: number;
  drafts: number;
  trash: number;
}

interface MailBase {
  id: string;
  folder: Folder;
  trashedFrom: Folder | null;
  threadId: string;
  inReplyTo: string | null;
  fromName: string | null;
  fromEmail: string;
  toEmails: string[];
  ccEmails: string[];
  subject: string;
  isRead: boolean;
  isStarred: boolean;
  source: "compose" | "contact" | "trial" | "inbound" | "system";
  contactMessageId: string | null;
  trialRequestId: string | null;
  sentAt: string | null;
  deliveryError: string | null;
  attachments?: MailAttachment[];
  createdAt: string;
}
interface MailAttachment {
  key: string;
  fileName: string;
  contentType: string;
  size: number;
}
interface MailRow extends MailBase {
  snippet: string;
}
interface MailFull extends MailBase {
  body: string;
  contactMessage?: { id: string; category: string; status: string; institution: string | null; userId: string | null } | null;
  trialRequest?: { id: string; status: string; institution: string; appIds: string[]; days: number } | null;
}
interface ListResponse {
  messages: MailRow[];
  nextCursor: string | null;
  counts: Counts;
  sender: string;
}

interface Draft {
  draftId?: string;
  inReplyTo?: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
}

const FOLDERS: { view: View; label: string; Icon: typeof Inbox; count: (c: Counts) => number; badge?: (c: Counts) => number }[] = [
  { view: "INBOX", label: "Inbox", Icon: Inbox, count: (c) => c.inbox, badge: (c) => c.unread },
  { view: "STARRED", label: "Starred", Icon: Star, count: (c) => c.starred },
  { view: "SENT", label: "Sent", Icon: Send, count: (c) => c.sent },
  { view: "DRAFT", label: "Drafts", Icon: FileEdit, count: (c) => c.drafts },
  { view: "TRASH", label: "Trash", Icon: Trash2, count: (c) => c.trash },
];
const SOURCE: Record<MailBase["source"], string | null> = { compose: null, contact: "Contact form", trial: "Free-month request", inbound: "Reply", system: "System" };

const addresses = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
const who = (m: MailBase) => (m.folder === "SENT" || m.folder === "DRAFT" || m.trashedFrom === "SENT" || m.trashedFrom === "DRAFT" ? `To: ${m.toEmails.join(", ") || "(no recipient)"}` : m.fromName || m.fromEmail);
const when = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : formatDate(iso);
};
const quote = (m: MailFull) => `\n\n\nOn ${formatDate(m.createdAt, true)}, ${m.fromName ?? m.fromEmail} wrote:\n${m.body.split("\n").map((l) => `> ${l}`).join("\n")}`;
const re = (s: string, prefix: "Re" | "Fwd") => (new RegExp(`^${prefix}:`, "i").test(s) ? s : `${prefix}: ${s}`);

export function MailView() {
  const params = useSearchParams();
  const [view, setView] = useState<View>("INBOX");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [more, setMore] = useState<MailRow[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ message: MailFull; thread: MailFull[] } | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const path = `/v1/api/admin/mail?${new URLSearchParams({ folder: view, ...(search ? { q: search } : {}), ...(unreadOnly ? { unread: "1" } : {}) })}`;
  const { data, error, loading, reload, setData } = useAdmin<ListResponse>(path);
  const rows = [...(data?.messages ?? []), ...more];
  const next = cursor === undefined ? data?.nextCursor : cursor;
  const c = counts ?? data?.counts ?? null;

  useEffect(() => {
    if (data) setCounts(data.counts);
  }, [data]);

  // /admin/mail?compose=someone@example.org&subject=... opens the composer (used by "Reply by mail" links).
  useEffect(() => {
    const to = params.get("compose");
    if (to !== null) setDraft({ to, cc: "", subject: params.get("subject") ?? "", body: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on load
  }, []);

  const resetList = () => {
    setMore([]);
    setCursor(undefined);
    setSelected(new Set());
  };
  const choose = (v: View) => {
    setView(v);
    setOpenId(null);
    setDetail(null);
    resetList();
  };
  const refresh = useCallback(async () => {
    setMore([]);
    setCursor(undefined);
    setSelected(new Set());
    await reload();
  }, [reload]);

  // Check for new mail every 30 s while the tab is visible, and at once when it
  // becomes visible again. Silent (no spinner), and skipped while the admin is
  // mid-task: older pages loaded, rows ticked, or writing a message.
  const busy = more.length > 0 || selected.size > 0 || draft !== null;
  const poll = useRef({ path, busy, setData });
  poll.current = { path, busy, setData };
  useEffect(() => {
    const check = async () => {
      const p = poll.current;
      if (document.visibilityState !== "visible" || p.busy) return;
      try {
        const fresh = await api<ListResponse>(p.path);
        if (poll.current.path === p.path && !poll.current.busy) p.setData(fresh);
      } catch {
        // Ignore: the next check tries again; the Refresh button shows real errors.
      }
    };
    const timer = window.setInterval(check, 30_000);
    const onVisible = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const patchRows = (fn: (list: MailRow[]) => MailRow[]) => {
    if (data) setData({ ...data, messages: fn(data.messages) });
    setMore(fn);
  };

  async function loadMore() {
    if (!next) return;
    try {
      const r = await api<ListResponse>(`${path}&cursor=${next}`);
      setMore((m) => [...m, ...r.messages]);
      setCursor(r.nextCursor);
    } catch (err) {
      setNotice({ tone: "danger", text: adminError(err) });
    }
  }

  async function open(row: MailRow) {
    if (row.folder === "DRAFT") {
      // Drafts open in the composer.
      try {
        const r = await api<{ message: MailFull }>(`/v1/api/admin/mail/${row.id}`);
        setDraft({ draftId: r.message.id, inReplyTo: r.message.inReplyTo ?? undefined, to: r.message.toEmails.join(", "), cc: r.message.ccEmails.join(", "), subject: r.message.subject === "(no subject)" ? "" : r.message.subject, body: r.message.body });
      } catch (err) {
        setNotice({ tone: "danger", text: adminError(err) });
      }
      return;
    }
    setOpenId(row.id);
    setDetail(null);
    setDetailError(null);
    try {
      const r = await api<{ message: MailFull; thread: MailFull[]; counts: Counts }>(`/v1/api/admin/mail/${row.id}`);
      setDetail(r);
      setCounts(r.counts);
      patchRows((list) => list.map((m) => (m.id === row.id ? { ...m, isRead: r.message.isRead } : m)));
    } catch (err) {
      setDetailError(adminError(err, "Could not open the message."));
    }
  }

  async function patch(id: string, body: { isRead?: boolean; isStarred?: boolean; folder?: "TRASH" | "RESTORE" }) {
    setNotice(null);
    try {
      const r = await api<{ message: MailRow; counts: Counts }>(`/v1/api/admin/mail/${id}`, { method: "PATCH", body });
      setCounts(r.counts);
      const leaves = !!body.folder || (view === "STARRED" && body.isStarred === false);
      patchRows((list) => (leaves ? list.filter((m) => m.id !== id) : list.map((m) => (m.id === id ? r.message : m))));
      if (leaves && openId === id) {
        setOpenId(null);
        setDetail(null);
      } else if (detail?.message.id === id) {
        setDetail({ ...detail, message: { ...detail.message, isRead: r.message.isRead, isStarred: r.message.isStarred } });
      }
    } catch (err) {
      setNotice({ tone: "danger", text: adminError(err) });
    }
  }

  async function bulk(action: "read" | "unread" | "star" | "unstar" | "trash" | "restore" | "delete", ids = [...selected]) {
    if (!ids.length) return;
    if (action === "delete" && !window.confirm(`Delete ${ids.length} ${ids.length === 1 ? "message" : "messages"} for good? This cannot be undone.`)) return;
    setNotice(null);
    try {
      await api(`/v1/api/admin/mail/bulk`, { method: "POST", body: { ids, action } });
      if (openId && ids.includes(openId) && (action === "trash" || action === "restore" || action === "delete")) {
        setOpenId(null);
        setDetail(null);
      }
      await refresh();
    } catch (err) {
      setNotice({ tone: "danger", text: adminError(err) });
    }
  }

  async function emptyTrash() {
    if (!window.confirm("Delete everything in Trash for good? This cannot be undone.")) return;
    try {
      const r = await api<{ deleted: number; counts: Counts }>("/v1/api/admin/mail/trash/empty", { method: "POST" });
      setNotice({ tone: "success", text: `${r.deleted} ${r.deleted === 1 ? "message" : "messages"} deleted.` });
      setOpenId(null);
      setDetail(null);
      await refresh();
    } catch (err) {
      setNotice({ tone: "danger", text: adminError(err) });
    }
  }

  const reply = (m: MailFull) =>
    setDraft({
      inReplyTo: m.id,
      to: m.folder === "SENT" || m.trashedFrom === "SENT" ? m.toEmails.join(", ") : m.fromEmail,
      cc: "",
      subject: re(m.subject, "Re"),
      body: quote(m),
    });
  const forward = (m: MailFull) => setDraft({ to: "", cc: "", subject: re(m.subject, "Fwd"), body: `\n\n\n---------- Forwarded message ----------\nFrom: ${m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail}\nDate: ${formatDate(m.createdAt, true)}\nSubject: ${m.subject}\n\n${m.body}` });

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const inTrash = view === "TRASH";

  return (
    <>
      <PageHeader
        title="Mailbox"
        description="Enquiries from the contact form, free-month requests and replies arrive in the inbox. Mail you write here is sent from the AltVivo address and kept in Sent."
        actions={
          <Button onClick={() => setDraft({ to: "", cc: "", subject: "", body: "" })}>
            <PenSquare className="size-4" aria-hidden /> Compose
          </Button>
        }
      />

      {notice && (
        <div className="mb-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[12.5rem_minmax(0,1fr)]">
        {/* ------------------------------------------------------- folders */}
        <nav aria-label="Mail folders">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {FOLDERS.map(({ view: v, label, Icon, count, badge }) => {
              const on = view === v;
              const n = c ? (badge ? badge(c) : count(c)) : 0;
              return (
                <li key={v}>
                  <button
                    type="button"
                    onClick={() => choose(v)}
                    aria-current={on ? "page" : undefined}
                    className={cx(
                      "flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition",
                      on ? "bg-accent-soft font-semibold text-accent-ink" : "text-muted hover:bg-surface-2 hover:text-fg",
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="flex-1 text-left">{label}</span>
                    {n > 0 && (
                      <span className={cx("readout rounded-full px-1.5 text-[11px]", badge ? "brand-gradient font-semibold text-white" : "text-subtle")} aria-label={badge ? `${n} unread` : `${n} messages`}>
                        {n}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {data?.sender && (
            <p className="mt-4 hidden px-3 text-xs leading-relaxed text-subtle lg:block">
              Sending as
              <span className="readout block break-all text-muted">{data.sender}</span>
            </p>
          )}
        </nav>

        <div className="min-w-0">
          {/* ----------------------------------------------------- toolbar */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <form
              className="relative min-w-0 flex-1 sm:max-w-xs"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(query.trim());
                resetList();
              }}
            >
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
              <input className="field h-9 pl-9" type="search" placeholder="Search mail" aria-label="Search mail" value={query} onChange={(e) => setQuery(e.target.value)} />
            </form>
            <Button
              size="sm"
              variant={unreadOnly ? "primary" : "outline"}
              aria-pressed={unreadOnly}
              onClick={() => {
                setUnreadOnly((v) => !v);
                resetList();
              }}
            >
              Unread
            </Button>
            <Button size="sm" variant="outline" onClick={refresh} loading={loading} aria-label="Refresh">
              {!loading && <RefreshCw className="size-4" aria-hidden />}
            </Button>
            {inTrash && rows.length > 0 && (
              <Button size="sm" variant="ghost" className="text-danger" onClick={emptyTrash}>
                Empty trash
              </Button>
            )}
            {search && (
              <button
                type="button"
                className="text-xs text-accent-ink underline"
                onClick={() => {
                  setSearch("");
                  setQuery("");
                  resetList();
                }}
              >
                Clear search “{search}”
              </button>
            )}
          </div>

          <LoadState loading={loading && !data} error={error} onRetry={reload} />

          {data && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
              {/* ------------------------------------------------- list */}
              <Card className={cx("overflow-hidden", openId && "hidden xl:block")}>
                <div className="flex min-h-11 items-center gap-2 border-b border-line px-3 py-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--accent)]"
                    aria-label="Select all"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                    disabled={!rows.length}
                  />
                  {selected.size ? (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="readout mr-1 text-xs text-subtle">{selected.size} selected</span>
                      {inTrash ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => bulk("restore")}>
                            <RotateCcw className="size-3.5" aria-hidden /> Restore
                          </Button>
                          <Button size="sm" variant="ghost" className="text-danger" onClick={() => bulk("delete")}>
                            Delete for good
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => bulk("read")}>
                            Read
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => bulk("unread")}>
                            Unread
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => bulk("star")}>
                            Star
                          </Button>
                          <Button size="sm" variant="ghost" className="text-danger" onClick={() => bulk("trash")}>
                            <Trash2 className="size-3.5" aria-hidden /> Trash
                          </Button>
                        </>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-subtle">
                      {rows.length} {rows.length === 1 ? "message" : "messages"}
                      {next ? "+" : ""}
                    </span>
                  )}
                </div>
                {!rows.length && (
                  <p className="px-5 py-12 text-center text-sm text-subtle">
                    {search || unreadOnly ? "Nothing matches." : view === "INBOX" ? "The inbox is empty." : view === "DRAFT" ? "No drafts." : "Nothing here."}
                  </p>
                )}
                <ul className="divide-y divide-line">
                  {rows.map((m) => {
                    const unread = !m.isRead && m.folder === "INBOX";
                    return (
                      <li key={m.id} className={cx("flex items-start gap-2 px-3 py-3 transition", openId === m.id ? "bg-accent-soft" : "hover:bg-surface-2")}>
                        <input
                          type="checkbox"
                          className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
                          aria-label={`Select ${m.subject}`}
                          checked={selected.has(m.id)}
                          onChange={() =>
                            setSelected((s) => {
                              const n = new Set(s);
                              if (n.has(m.id)) n.delete(m.id);
                              else n.add(m.id);
                              return n;
                            })
                          }
                        />
                        <button
                          type="button"
                          className={cx("mt-0.5 shrink-0 rounded p-0.5", m.isStarred ? "text-soon-ink" : "text-subtle hover:text-fg")}
                          aria-pressed={m.isStarred}
                          aria-label={m.isStarred ? "Remove star" : "Star"}
                          onClick={() => patch(m.id, { isStarred: !m.isStarred })}
                        >
                          <Star className="size-4" aria-hidden fill={m.isStarred ? "currentColor" : "none"} />
                        </button>
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => open(m)}>
                          <span className="flex items-baseline justify-between gap-3">
                            <span className={cx("truncate text-sm", unread ? "font-semibold text-fg" : "text-muted")}>
                              {unread && <span className="mr-1.5 inline-block size-2 rounded-full bg-accent align-middle" aria-label="Unread" />}
                              {who(m)}
                            </span>
                            <span className="readout shrink-0 text-[11px] text-subtle">{when(m.sentAt ?? m.createdAt)}</span>
                          </span>
                          <span className={cx("mt-0.5 flex items-center gap-1.5 text-sm", unread ? "font-semibold text-fg" : "text-fg")}>
                            <span className="truncate">{m.subject}</span>
                            {!!m.attachments?.length && <Paperclip className="size-3.5 shrink-0 text-subtle" aria-label={`${m.attachments.length} attachment${m.attachments.length > 1 ? "s" : ""}`} />}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-subtle">{m.snippet || "(no text)"}</span>
                          {(SOURCE[m.source] || m.deliveryError) && (
                            <span className="mt-1.5 flex flex-wrap gap-1.5">
                              {SOURCE[m.source] && <Pill tone={m.source === "trial" ? "live" : m.source === "contact" ? "accent" : "muted"}>{SOURCE[m.source]}</Pill>}
                              {m.deliveryError && <Pill tone="danger">Not sent</Pill>}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {next && (
                  <div className="border-t border-line p-3 text-center">
                    <Button size="sm" variant="outline" onClick={loadMore}>
                      Load more
                    </Button>
                  </div>
                )}
              </Card>

              {/* --------------------------------------------- reading pane */}
              <div className={cx("min-w-0", !openId && "hidden xl:block")}>
                {!openId && (
                  <Card className="grid h-full min-h-64 place-items-center p-10 text-center text-sm text-subtle">
                    <div>
                      <MailOpen className="mx-auto size-8" aria-hidden strokeWidth={1.5} />
                      <p className="mt-3">Choose a message to read it.</p>
                    </div>
                  </Card>
                )}
                {openId && (
                  <Card className="overflow-hidden">
                    <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="xl:hidden"
                        onClick={() => {
                          setOpenId(null);
                          setDetail(null);
                        }}
                      >
                        <ArrowLeft className="size-4" aria-hidden /> Back
                      </Button>
                      {detail && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => reply(detail.message)}>
                            <CornerUpLeft className="size-4" aria-hidden /> Reply
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => forward(detail.message)}>
                            <Forward className="size-4" aria-hidden /> Forward
                          </Button>
                          {detail.message.folder === "INBOX" && (
                            <Button size="sm" variant="ghost" onClick={() => patch(detail.message.id, { isRead: !detail.message.isRead })}>
                              <MailIcon className="size-4" aria-hidden /> {detail.message.isRead ? "Mark unread" : "Mark read"}
                            </Button>
                          )}
                          <span className="flex-1" />
                          {detail.message.folder === "TRASH" ? (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => patch(detail.message.id, { folder: "RESTORE" })}>
                                <RotateCcw className="size-4" aria-hidden /> Restore
                              </Button>
                              <Button size="sm" variant="ghost" className="text-danger" onClick={() => bulk("delete", [detail.message.id])}>
                                Delete for good
                              </Button>
                            </>
                          ) : (
                            <Button size="sm" variant="ghost" className="text-danger" onClick={() => patch(detail.message.id, { folder: "TRASH" })}>
                              <Trash2 className="size-4" aria-hidden /> Trash
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                    {detailError && (
                      <div className="p-5">
                        <Alert tone="danger">{detailError}</Alert>
                      </div>
                    )}
                    {!detail && !detailError && <p className="p-10 text-center text-sm text-subtle">Loading…</p>}
                    {detail && (
                      <div className="p-5 sm:p-6">
                        <h2 className="text-xl font-semibold leading-snug">{detail.message.subject}</h2>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {detail.message.contactMessage && (
                            <>
                              <Pill tone="accent">Contact · {detail.message.contactMessage.category}</Pill>
                              <Pill tone="muted">{detail.message.contactMessage.status.replace("_", " ").toLowerCase()}</Pill>
                              {detail.message.contactMessage.institution && <span className="text-xs text-subtle">{detail.message.contactMessage.institution}</span>}
                              {detail.message.contactMessage.userId && (
                                <Link href={`/admin/users/${detail.message.contactMessage.userId}`} className="text-xs text-accent-ink underline">
                                  Account
                                </Link>
                              )}
                            </>
                          )}
                          {detail.message.trialRequest && (
                            <>
                              <Pill tone="live">Free month · {detail.message.trialRequest.status.toLowerCase()}</Pill>
                              <Link href="/admin/trials" className="text-xs text-accent-ink underline">
                                Review the request
                              </Link>
                            </>
                          )}
                        </div>
                        <ol className="mt-5 space-y-4">
                          {detail.thread.map((m) => {
                            const ours = m.folder === "SENT" || m.trashedFrom === "SENT";
                            return (
                              <li key={m.id} className={cx("rounded-xl border p-4", m.id === detail.message.id ? "border-accent/40 bg-surface" : "border-line bg-surface-2/60", ours && "ml-4 sm:ml-10")}>
                                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                                  <p className="text-sm font-semibold">
                                    {ours ? "AltVivo" : (m.fromName ?? m.fromEmail)}
                                    {!ours && m.fromName && <span className="readout ml-2 text-xs font-normal text-subtle">{m.fromEmail}</span>}
                                  </p>
                                  <p className="readout text-xs text-subtle">{formatDate(m.sentAt ?? m.createdAt, true)}</p>
                                </div>
                                {(ours || m.ccEmails.length > 0) && (
                                  <p className="mt-0.5 text-xs text-subtle">
                                    To {m.toEmails.join(", ")}
                                    {m.ccEmails.length > 0 && ` · Cc ${m.ccEmails.join(", ")}`}
                                  </p>
                                )}
                                {/* Escaped first, then a fixed set of tags (see format.ts): safe to inject. */}
                                <div className="mt-3 break-words text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMailHtml(m.body, WEB_STYLE) }} />
                                {!!m.attachments?.length && <Attachments messageId={m.id} files={m.attachments} />}
                              </li>
                            );
                          })}
                        </ol>
                        <div className="mt-5 flex gap-2">
                          <Button onClick={() => reply(detail.thread[detail.thread.length - 1] ?? detail.message)}>
                            <CornerUpLeft className="size-4" aria-hidden /> Reply
                          </Button>
                          <Button variant="outline" onClick={() => forward(detail.message)}>
                            <Forward className="size-4" aria-hidden /> Forward
                          </Button>
                        </div>
                      </div>
                    )}
                  </Card>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {draft && (
        <Composer
          key={draft.draftId ?? draft.inReplyTo ?? "new"}
          initial={draft}
          sender={data?.sender ?? ""}
          onClose={() => setDraft(null)}
          onDone={async (text) => {
            setDraft(null);
            setNotice({ tone: "success", text });
            await refresh();
          }}
        />
      )}
    </>
  );
}

const fileSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Files received with a message: each download asks core for a short-lived private link. */
function Attachments({ messageId, files }: { messageId: string; files: MailAttachment[] }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function download(n: number) {
    setBusy(n);
    setError(null);
    try {
      const r = await api<{ url: string }>(`/v1/api/admin/mail/${messageId}/attachments/${n}`);
      window.location.assign(r.url);
    } catch (err) {
      setError(adminError(err, "The file could not be downloaded."));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-subtle">
        <Paperclip className="size-3.5" aria-hidden /> {files.length} attachment{files.length > 1 ? "s" : ""}
      </p>
      <ul className="flex flex-wrap gap-2">
        {files.map((f, n) => (
          <li key={f.key}>
            <button
              type="button"
              onClick={() => download(n)}
              disabled={busy !== null}
              className="flex max-w-64 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-left text-xs hover:border-accent disabled:opacity-60"
            >
              <Download className={cx("size-4 shrink-0 text-accent-ink", busy === n && "animate-pulse")} aria-hidden />
              <span className="min-w-0">
                <span className="block truncate font-medium text-fg">{f.fileName}</span>
                <span className="block text-subtle">{fileSize(f.size)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}

type Action = { wrap: [string, string]; placeholder: string } | { prefix: string } | { link: true };

const TOOLS: ({ label: string; Icon: typeof Bold; action: Action; keys?: string } | "|")[] = [
  { label: "Bold", Icon: Bold, action: { wrap: ["**", "**"], placeholder: "bold text" }, keys: "b" },
  { label: "Italic", Icon: Italic, action: { wrap: ["*", "*"], placeholder: "italic text" }, keys: "i" },
  { label: "Underline", Icon: Underline, action: { wrap: ["__", "__"], placeholder: "underlined text" }, keys: "u" },
  { label: "Strikethrough", Icon: Strikethrough, action: { wrap: ["~~", "~~"], placeholder: "struck text" } },
  "|",
  { label: "Heading", Icon: Heading, action: { prefix: "## " } },
  { label: "Bulleted list", Icon: List, action: { prefix: "- " } },
  { label: "Numbered list", Icon: ListOrdered, action: { prefix: "1. " } },
  { label: "Quote", Icon: Quote, action: { prefix: "> " } },
  "|",
  { label: "Link", Icon: Link2, action: { link: true }, keys: "k" },
];

const LINE_MARK = /^(\d{1,3}[.)]|[-*•>]|#{1,2})\s+/;

/** Pure text edit behind the toolbar: returns the new text and the range to select. */
function applyFormat(text: string, start: number, end: number, action: Action): { text: string; start: number; end: number } | null {
  if ("wrap" in action) {
    const [a, b] = action.wrap;
    const sel = text.slice(start, end);
    // Toggle off when the selection is already wrapped.
    if (sel && text.slice(start - a.length, start) === a && text.slice(end, end + b.length) === b) {
      return { text: text.slice(0, start - a.length) + sel + text.slice(end + b.length), start: start - a.length, end: end - a.length };
    }
    const inner = sel || action.placeholder;
    return { text: text.slice(0, start) + a + inner + b + text.slice(end), start: start + a.length, end: start + a.length + inner.length };
  }
  if ("link" in action) {
    const url = window.prompt("Link address (https://…)", "https://")?.trim();
    if (!url || !/^(https?:\/\/|mailto:)\S+$/.test(url)) return null;
    const label = text.slice(start, end) || url;
    const md = `[${label}](${url})`;
    return { text: text.slice(0, start) + md + text.slice(end), start: start + 1, end: start + 1 + label.length };
  }
  // Line marks apply to every line the selection touches; pressing again removes them.
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const stop = text.indexOf("\n", end);
  const to = stop === -1 ? text.length : stop;
  const lines = text.slice(from, to).split("\n");
  const numbered = action.prefix === "1. ";
  const has = (l: string) => (numbered ? /^\d{1,3}[.)]\s+/.test(l) : l.startsWith(action.prefix));
  const off = lines.every(has);
  const next = lines.map((l, n) => (off ? l.replace(LINE_MARK, "") : `${numbered ? `${n + 1}. ` : action.prefix}${l.replace(LINE_MARK, "")}`)).join("\n");
  return { text: text.slice(0, from) + next + text.slice(to), start: from, end: from + next.length };
}

function Composer({ initial, sender, onClose, onDone }: { initial: Draft; sender: string; onClose: () => void; onDone: (notice: string) => Promise<void> }) {
  const [form, setForm] = useState(initial);
  const [showCc, setShowCc] = useState(!!initial.cc);
  const [busy, setBusy] = useState<"send" | "draft" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (k: "to" | "cc" | "subject" | "body") => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"write" | "preview">("write");

  /** Applies a toolbar action to the textarea selection and keeps the cursor sensible. */
  function format(action: Action) {
    const el = bodyRef.current;
    if (!el) return;
    const r = applyFormat(el.value, el.selectionStart, el.selectionEnd, action);
    if (!r) return;
    setForm((f) => ({ ...f, body: r.text }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.start, r.end);
    });
  }
  // Start typing where it makes sense: the recipient for a new message, above the quoted text for a reply.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (!initial.to) return toRef.current?.focus();
      bodyRef.current?.focus();
      bodyRef.current?.setSelectionRange(0, 0);
      if (bodyRef.current) bodyRef.current.scrollTop = 0;
    }, 50);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per composer
  }, []);
  const dirty = form.to !== initial.to || form.cc !== initial.cc || form.subject !== initial.subject || form.body !== initial.body;

  async function submit(asDraft: boolean, e?: FormEvent) {
    e?.preventDefault();
    const to = addresses(form.to);
    const cc = addresses(form.cc);
    const bad = [...to, ...cc].find((a) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a));
    if (bad) return setError(`“${bad}” is not an email address.`);
    if (!asDraft) {
      if (!to.length) return setError("Add at least one recipient.");
      if (!form.subject.trim()) return setError("Add a subject.");
      if (!form.body.trim()) return setError("Write a message.");
    }
    setBusy(asDraft ? "draft" : "send");
    setError(null);
    try {
      await api("/v1/api/admin/mail", {
        method: "POST",
        body: { to, cc, subject: form.subject, body: form.body, draft: asDraft, ...(form.draftId ? { draftId: form.draftId } : {}), ...(form.inReplyTo ? { inReplyTo: form.inReplyTo } : {}) },
      });
      await onDone(asDraft ? "Draft saved." : `Sent to ${to.join(", ")}.`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "MAIL_SEND_FAILED") {
        const id = (err.details as { draftId?: string } | undefined)?.draftId;
        if (id) setForm((f) => ({ ...f, draftId: id }));
      }
      setError(adminError(err, "The message could not be sent."));
      setBusy(null);
    }
  }

  return (
    <Dialog
      open
      wide
      title={form.inReplyTo ? "Reply" : form.draftId ? "Edit draft" : "New message"}
      onClose={() => {
        if (busy) return;
        if (!dirty || window.confirm("Discard this message?")) onClose();
      }}
    >
      <form onSubmit={(e) => submit(false, e)} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        {sender && (
          <p className="text-xs text-subtle">
            From <span className="readout text-muted">{sender}</span>. Replies come back to this Mailbox.
          </p>
        )}
        <Field label="To" id="mail-to" hint="Separate several addresses with commas.">
          <div className="flex gap-2">
            <input id="mail-to" ref={toRef} className="field" value={form.to} onChange={set("to")} autoComplete="off" inputMode="email" />
            {!showCc && (
              <Button type="button" size="md" variant="ghost" onClick={() => setShowCc(true)}>
                Cc
              </Button>
            )}
          </div>
        </Field>
        {showCc && (
          <Field label="Cc" id="mail-cc">
            <input id="mail-cc" className="field" value={form.cc} onChange={set("cc")} autoComplete="off" inputMode="email" />
          </Field>
        )}
        <Field label="Template" id="mail-template" hint="Fills the subject and text. Replace the parts in [square brackets] before sending.">
          <select
            id="mail-template"
            className="field"
            value=""
            onChange={(e) => {
              const t = MAIL_TEMPLATES.find((x) => x.id === e.target.value);
              if (!t) return;
              if (form.body.trim() && !initial.inReplyTo && !window.confirm("Replace the text you have written with this template?")) return;
              // In a reply, keep the subject and put the template above the quoted message.
              setForm((f) => (initial.inReplyTo ? { ...f, body: `${t.body}${initial.body}` } : { ...f, subject: t.subject, body: t.body }));
            }}
          >
            <option value="">Choose a template…</option>
            {MAIL_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Subject" id="mail-subject">
          <input id="mail-subject" className="field" value={form.subject} onChange={set("subject")} maxLength={300} />
        </Field>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="mail-body" className="block text-sm font-medium text-fg">
              Message
            </label>
            <div className="flex rounded-lg border border-line p-0.5 text-xs" role="tablist" aria-label="Message view">
              {(["write", "preview"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={cx("rounded-md px-2.5 py-1 font-medium capitalize", tab === t ? "bg-surface-3 text-fg" : "text-subtle hover:text-fg")}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          {tab === "write" ? (
            <>
              <div className="flex flex-wrap gap-0.5 rounded-t-[10px] border border-b-0 border-line-strong bg-surface-2 p-1" role="toolbar" aria-label="Formatting">
                {TOOLS.map((t, n) =>
                  t === "|" ? (
                    <span key={`sep-${n}`} className="mx-1 my-1 w-px bg-line" aria-hidden />
                  ) : (
                    <button
                      key={t.label}
                      type="button"
                      title={t.keys ? `${t.label} (Ctrl+${t.keys.toUpperCase()})` : t.label}
                      aria-label={t.label}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => format(t.action)}
                      className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-3 hover:text-fg"
                    >
                      <t.Icon className="size-4" aria-hidden />
                    </button>
                  ),
                )}
              </div>
              <textarea
                id="mail-body"
                ref={bodyRef}
                rows={12}
                className="field !mt-0 rounded-t-none"
                value={form.body}
                onChange={set("body")}
                onKeyDown={(e) => {
                  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
                  const t = TOOLS.find((x) => x !== "|" && x.keys === e.key.toLowerCase());
                  if (t && t !== "|") {
                    e.preventDefault();
                    format(t.action);
                  }
                }}
                maxLength={20000}
              />
              <p className="text-xs text-subtle">
                Select text and use the buttons, or type <span className="readout">**bold**</span>, <span className="readout">*italic*</span>, <span className="readout">- list</span>. Web addresses become links.
              </p>
            </>
          ) : (
            <div
              className="min-h-[18rem] rounded-[10px] border border-line-strong bg-surface px-4 py-3 text-sm leading-relaxed"
              dangerouslySetInnerHTML={{ __html: form.body.trim() ? renderMailHtml(form.body, WEB_STYLE) : '<p style="color:var(--subtle)">Nothing to preview yet.</p>' }}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="ghost" onClick={() => submit(true)} loading={busy === "draft"} disabled={busy === "send"}>
            <FileEdit className="size-4" aria-hidden /> Save draft
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={!!busy}>
              Discard
            </Button>
            <Button type="submit" loading={busy === "send"} disabled={busy === "draft"}>
              <Send className="size-4" aria-hidden /> Send
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
