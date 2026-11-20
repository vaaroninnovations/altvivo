# AltVivo mail addresses

| Address | Direction | Used for |
|---|---|---|
| `no-reply@altvivo.bio` (`SMTP_FROM`) | **One-way, send only.** Mail sent to it is rejected with a bounce that points to hello@. | Verification, password reset, receipts, invoices, trial notices, security alerts. Carries `Auto-Submitted: auto-generated`, and the footer says replies are not accepted. |
| `hello@altvivo.bio` (`SMTP_REPLY_FROM`) | **Two-way.** People can reply. | Messages written in **Admin → Mailbox** and account invites from **Admin → Users → Add user**. Replies show up in the Mailbox inbox, in the same conversation. |

**Attachments** on received mail (up to 20 files, 25 MB each) are stored in the
private `altvivo-vault` R2 bucket under `mail-inbound/`. The worker skips the small
inline images that mail signatures add. Admins download them from the message in
the Mailbox through 5-minute links, and deleting the message deletes its files.

Both addresses send through Resend (`smtp.resend.com`). Because the whole
`altvivo.bio` domain is verified there, hello@ can send without any extra setup.

Receiving uses **Cloudflare Email Routing** plus this worker. Until it is set
up, altvivo.bio has no MX record and replies to hello@ bounce.

## One-time setup (Cloudflare dashboard, zone altvivo.bio)

1. **Email → Email Routing → Get started.** Let Cloudflare add its MX and SPF
   records. Keep the existing Resend records (`send.altvivo.bio`, `resend._domainkey`).
   They don't conflict, because Resend's SPF lives on `send.altvivo.bio` and not on the root domain.
2. **Deploy the worker** from this folder:
   ```powershell
   npm install
   ```
   ```powershell
   npx wrangler login
   ```
   ```powershell
   npx wrangler deploy
   ```
   Then set the shared token. Use the same value as `MAIL_INBOUND_TOKEN` in `/opt/altvivo/altvivo-infra/.env` on the server:
   ```powershell
   npx wrangler secret put MAIL_INBOUND_TOKEN
   ```
3. **Email Routing → Routing rules:**
   - Custom address `hello@altvivo.bio` → action **Send to a Worker** → `altvivo-inbound-mail`.
   - Custom address `support@altvivo.bio` (shown across the website) → the same worker. It is listed in `INBOX_ADDRESSES`, so it also lands in the Mailbox.
   - Custom address `no-reply@altvivo.bio` → **Send to a Worker** → `altvivo-inbound-mail` (the worker rejects it with a helpful bounce). Alternatively, use the **Drop** action.
   - Leave **Catch-all** disabled, or set it to **Drop**.
4. Optional: to also get a copy of every hello@ mail in a personal inbox, add that
   inbox as a verified **destination address** and set `FORWARD_TO` in `wrangler.toml`.

## Check it works

Send a mail to hello@altvivo.bio from any inbox. It should appear under
**Admin → Mailbox → Inbox** within a few seconds. A mail to no-reply@altvivo.bio
should bounce back with "This address does not accept mail".
