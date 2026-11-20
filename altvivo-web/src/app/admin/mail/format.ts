/**
 * Light formatting for mail written in the SuperAdmin Mailbox.
 *
 *   **bold**   *italic*   __underline__   ~~strike~~   [text](https://link)
 *   # Heading / ## Subheading     - or • bullet     1. numbered     > quote
 *
 * The text is HTML-escaped FIRST, then the marks are turned into a fixed set
 * of tags, so nothing the author types can inject markup. Links are limited
 * to http(s) and mailto. Copy of altvivo-core/src/lib/mail-format.ts (core renders the email; this renders the preview and the thread). Keep in sync.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export interface FormatStyle {
  a: string;
  h1: string;
  h2: string;
  p: string;
  ul: string;
  ol: string;
  li: string;
  quote: string;
}

/** Inline styles for email clients (Gmail and Outlook ignore stylesheets). */
export const EMAIL_STYLE: FormatStyle = {
  a: 'color:#4B1FD8;text-decoration:underline',
  h1: 'margin:20px 0 8px;font-size:18px;line-height:1.35;font-weight:600',
  h2: 'margin:16px 0 6px;font-size:16px;line-height:1.4;font-weight:600',
  p: 'margin:0 0 12px',
  ul: 'margin:0 0 12px;padding-left:22px',
  ol: 'margin:0 0 12px;padding-left:22px',
  li: 'margin:0 0 4px',
  quote: 'margin:0 0 12px;padding:2px 0 2px 12px;border-left:3px solid #E6E3F3;color:#5B5876',
};

const URL_RE = /\b(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;

function inline(raw: string, st: FormatStyle): string {
  // Markdown links become placeholders so the bare-URL pass does not touch them.
  const links: string[] = [];
  let s = esc(raw.replace(/\u0000/g, '')).replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (_, text: string, href: string) => {
    links.push(`<a href="${href}" style="${st.a}">${text}</a>`);
    return `\u0000${links.length - 1}\u0000`;
  });
  s = s.replace(URL_RE, (u) => `<a href="${u}" style="${st.a}">${u}</a>`);
  s = s
    .replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([^_\n]*?\S)__/g, '<u>$1</u>')
    .replace(/~~(?=\S)([^~\n]*?\S)~~/g, '<s>$1</s>')
    .replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?!\*)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => links[Number(i)]!);
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*\d{1,3}[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const HEADING = /^(#{1,2})\s+(.*)$/;

/** Formatted text -> safe HTML. */
export function renderMailHtml(text: string, st: FormatStyle = EMAIL_STYLE): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  const run = (re: RegExp) => {
    const items: string[] = [];
    while (i < lines.length && re.test(lines[i]!)) items.push(re.exec(lines[i++]!)![1]!);
    return items;
  };
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      const tag = h[1]!.length === 1 ? 'h1' : 'h2';
      out.push(`<div role="heading" aria-level="${tag === 'h1' ? 2 : 3}" style="${st[tag]}">${inline(h[2]!, st)}</div>`);
      i++;
    } else if (BULLET.test(line)) {
      out.push(`<ul style="${st.ul}">${run(BULLET).map((x) => `<li style="${st.li}">${inline(x, st)}</li>`).join('')}</ul>`);
    } else if (NUMBER.test(line)) {
      out.push(`<ol style="${st.ol}">${run(NUMBER).map((x) => `<li style="${st.li}">${inline(x, st)}</li>`).join('')}</ol>`);
    } else if (QUOTE.test(line)) {
      out.push(`<blockquote style="${st.quote}">${run(QUOTE).map((x) => inline(x, st)).join('<br>')}</blockquote>`);
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i]!.trim() && !HEADING.test(lines[i]!) && !BULLET.test(lines[i]!) && !NUMBER.test(lines[i]!) && !QUOTE.test(lines[i]!)) {
        para.push(inline(lines[i++]!, st));
      }
      out.push(`<p style="${st.p}">${para.join('<br>')}</p>`);
    }
  }
  return out.join('\n');
}

/** Formatted text -> plain text for the text/plain part (marks removed, links spelled out). */
export function mailPlainText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (_, t: string, href: string) => `${t} (${href.replace(/^mailto:/, '')})`)
    .replace(/^#{1,2}\s+/gm, '')
    .replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '$1')
    .replace(/__(?=\S)([^_\n]*?\S)__/g, '$1')
    .replace(/~~(?=\S)([^~\n]*?\S)~~/g, '$1')
    .replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?!\*)/g, '$1$2');
}

/** Same structure, themed for the Mailbox (light and dark). */
export const WEB_STYLE: FormatStyle = {
  a: 'color:var(--accent-ink);text-decoration:underline',
  h1: 'margin:14px 0 6px;font-size:1.05rem;font-weight:600',
  h2: 'margin:12px 0 4px;font-size:0.95rem;font-weight:600',
  p: 'margin:0 0 10px',
  ul: 'margin:0 0 10px;padding-left:22px;list-style:disc',
  ol: 'margin:0 0 10px;padding-left:22px;list-style:decimal',
  li: 'margin:0 0 3px',
  quote: 'margin:0 0 10px;padding:1px 0 1px 10px;border-left:3px solid var(--line-strong);color:var(--muted)',
};
