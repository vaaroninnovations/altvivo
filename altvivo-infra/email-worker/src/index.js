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

    const res = await fetch(env.INBOUND_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.MAIL_INBOUND_TOKEN}` },
      body: JSON.stringify({
        from,
        ...(email.from?.name ? { fromName: email.from.name.slice(0, 200) } : {}),
        to: recipients,
        subject: (email.subject || '(no subject)').slice(0, 300),
        text,
      }),
    });
    if (!res.ok) {
      // Temporary failure: Cloudflare reports it to the sender's server, which retries later.
      throw new Error(`AltVivo inbound webhook answered ${res.status}`);
    }

    if (env.FORWARD_TO) await message.forward(env.FORWARD_TO);
  },
};
