/**
 * AltVivo inbound mail (Cloudflare Email Routing -> Email Worker).
 *
 *   hello@altvivo.bio    two-way: the message is posted to core's
 *                        /v1/webhooks/mail/inbound and appears in the
 *                        SuperAdmin Mailbox (threaded with the mail it answers).
 *                        Optionally also forwarded to FORWARD_TO.
 *   no-reply@altvivo.bio one-way: rejected at SMTP time, so the sender gets a
 *                        bounce telling them where to write instead.
 *
 * Any other address routed to this worker is rejected the same way.
 * INBOX_ADDRESSES may list more two-way addresses (e.g. support@), hello@ first.
 */
import PostalMime from 'postal-mime';

const MAX_TEXT = 20000;
const MAX_FILES = 20;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Object-key-safe version of a file name (the original is kept for display). */
const safeName = (name) => {
  const clean = name.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(-120);
  return clean || 'attachment';
};

/**
 * Real attachments only: skips empty parts and the small inline images that
 * mail signatures and logos add (pasted photos are larger and are kept).
 */
const keep = (a) => {
  const size = a.content?.byteLength ?? 0;
  if (!size || size > MAX_FILE_BYTES) return false;
  if (a.disposition === 'inline' && a.contentId && /^image\//.test(a.mimeType || '') && size < 20 * 1024) return false;
  return true;
};

const stripHtml = (html) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export default {
  async email(message, env) {
    const to = message.to.toLowerCase();
    const inboxes = (env.INBOX_ADDRESSES || 'hello@altvivo.bio').split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
    const inbox = inboxes[0];

    if (!inboxes.includes(to)) {
      message.setReject(`This address does not accept mail. To contact AltVivo, write to ${inbox}.`);
      return;
    }

    const email = await PostalMime.parse(message.raw);
    const from = (email.from?.address || message.from).toLowerCase();
    const text = (email.text?.trim() || (email.html ? stripHtml(email.html) : '') || '(empty message)').slice(0, MAX_TEXT);
    const recipients = [...new Set([to, ...(email.to || []).map((a) => a.address?.toLowerCase()).filter(Boolean)])].slice(0, 20);

    // Attachments go straight into the private vault bucket; core gets only their details.
    const attachments = [];
    for (const a of (email.attachments || []).filter(keep).slice(0, MAX_FILES)) {
      const fileName = (a.filename || 'attachment').slice(0, 200);
      const key = `mail-inbound/${crypto.randomUUID()}/${safeName(fileName)}`;
      const contentType = (a.mimeType || 'application/octet-stream').slice(0, 120);
      await env.MAIL_FILES.put(key, a.content, { httpMetadata: { contentType } });
      attachments.push({ key, fileName, contentType, size: a.content.byteLength });
    }

    let res;
    try {
      res = await fetch(env.INBOUND_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.MAIL_INBOUND_TOKEN}` },
        body: JSON.stringify({
          from,
          ...(email.from?.name ? { fromName: email.from.name.slice(0, 200) } : {}),
          to: recipients,
          subject: (email.subject || '(no subject)').slice(0, 300),
          text,
          attachments,
        }),
      });
    } finally {
      // Undelivered message: drop its files (the sender's server retries the whole mail).
      if (!res?.ok && attachments.length) await env.MAIL_FILES.delete(attachments.map((a) => a.key)).catch(() => undefined);
    }
    if (!res.ok) {
      // Temporary failure: Cloudflare reports it to the sender's server, which retries later.
      throw new Error(`AltVivo inbound webhook answered ${res.status}`);
    }

    if (env.FORWARD_TO) await message.forward(env.FORWARD_TO);
  },
};
