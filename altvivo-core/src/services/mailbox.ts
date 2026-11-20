import { randomUUID } from 'node:crypto';
import type { MailFolder, MailMessage, Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

export interface InboxInput {
  fromName: string | null;
  fromEmail: string;
  subject: string;
  body: string;
  source: 'contact' | 'trial' | 'inbound' | 'system';
  toEmails?: string[];
  contactMessageId?: string | null;
  trialRequestId?: string | null;
  threadId?: string | null;
  inReplyTo?: string | null;
  /** Files already stored in the vault bucket. */
  attachments?: { key: string; fileName: string; contentType: string; size: number }[];
}

/** Files a message in the SuperAdmin inbox (unread). */
export function deliverToInbox(db: Db, m: InboxInput): Promise<MailMessage> {
  return db.mailMessage.create({
    data: {
      folder: 'INBOX',
      threadId: m.threadId ?? randomUUID(),
      inReplyTo: m.inReplyTo ?? null,
      fromName: m.fromName?.slice(0, 200) ?? null,
      fromEmail: m.fromEmail,
      toEmails: m.toEmails ?? [],
      subject: m.subject.slice(0, 300),
      body: m.body.slice(0, 20000),
      source: m.source,
      contactMessageId: m.contactMessageId ?? null,
      trialRequestId: m.trialRequestId ?? null,
      attachments: m.attachments ?? [],
    },
  });
}

/** "Re: Re: Fwd: Hello" -> "hello" (for matching a reply to the conversation it answers). */
export const normalizeSubject = (s: string) => s.replace(/^(\s*(re|fwd?|aw)\s*:\s*)+/i, '').trim().toLowerCase();

/** The conversation an inbound message belongs to: the latest mail we sent to that address about the same subject. */
export async function threadForInbound(db: Db, fromEmail: string, subject: string): Promise<{ threadId: string; inReplyTo: string } | null> {
  const wanted = normalizeSubject(subject);
  if (!wanted) return null;
  const sent = await db.mailMessage.findMany({
    where: { sentAt: { not: null }, toEmails: { has: fromEmail.toLowerCase() } },
    orderBy: { sentAt: 'desc' },
    take: 25,
    select: { id: true, threadId: true, subject: true },
  });
  const hit = sent.find((m) => normalizeSubject(m.subject) === wanted);
  return hit ? { threadId: hit.threadId, inReplyTo: hit.id } : null;
}

export interface MailCounts {
  inbox: number;
  unread: number;
  starred: number;
  sent: number;
  drafts: number;
  trash: number;
}

export async function mailCounts(db: Db): Promise<MailCounts> {
  const [byFolder, unread, starred] = await Promise.all([
    db.mailMessage.groupBy({ by: ['folder'], _count: { _all: true } }),
    db.mailMessage.count({ where: { folder: 'INBOX', isRead: false } }),
    db.mailMessage.count({ where: { isStarred: true, folder: { not: 'TRASH' } } }),
  ]);
  const n = (f: MailFolder) => byFolder.find((r) => r.folder === f)?._count._all ?? 0;
  return { inbox: n('INBOX'), unread, starred, sent: n('SENT'), drafts: n('DRAFT'), trash: n('TRASH') };
}

/** Row of a message list: everything but the full body. */
export const toMailSummary = (m: MailMessage) => {
  const { body, ...rest } = m;
  const snippet = body.replace(/\s+/g, ' ').trim();
  return { ...rest, snippet: snippet.length > 180 ? `${snippet.slice(0, 180)}…` : snippet };
};
