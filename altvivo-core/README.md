# altvivo-core — identity provider, paid gate, billing and admin API

`api.altvivo.bio`. Fastify 5 + TypeScript on Node 22 LTS, Prisma 5 (schema, triggers and audit engine in [db/](db/README.md)), Redis 7.

```bash
npm ci && npm run db:generate
```
```bash
npm test
```
`npm test` starts an embedded PostgreSQL 16, applies the production migrations and `db/seed/seed.ts`, and runs 64 HTTP-level tests as the restricted `core_app` role (Stripe and Razorpay are replaced by in-memory fakes).

## Access model

One month free, then paid. A person can request one month of free access (`POST /v1/public/trial-request`); a SUPERADMIN approves it at `/admin/trials` (`/v1/api/admin/trials*`, TOTP-signed) and the free month starts once the address has a verified account (claims report it as `source: "trial"`, tier `TRIAL`). There is no permanent free tier. Contact enquiries, free-month requests and forwarded replies (`POST /v1/webhooks/mail/inbound`, `MAIL_INBOUND_TOKEN`) land in the SuperAdmin mailbox (`/v1/api/admin/mail*`). Otherwise a user may open XPRISM or aMaze only while a **paid grant** is in force:
- an individual single-app plan or the Dual-Suite bundle;
- their institution's site licence;
- a manual licence a SUPERADMIN recorded for an offline payment.

`SUPERADMIN` (on an MFA-verified session) and `ADVISORY_BOARD` bypass billing on LIVE, BETA and MAINTENANCE apps; this is set by `PAID_GATE_VIP_ROLES`.

The access token carries `entitlements.<app> = { active, level, source, plan, expires_at }` (see [CONTRACTS.md](../altvivo-infra/CONTRACTS.md)). When access changes, core marks the affected users' tokens **stale** in Redis. The changes that do this:
- a purchase or refund;
- a manual licence being granted, extended or revoked;
- seats or institution status changing;
- an app's status flip.

On their next request the gate makes the browser refresh, so new access applies within one request instead of up to 15 minutes later. The stale check compares the token's millisecond `iat_ms`.

## Endpoints

| Area | Route | Notes |
|---|---|---|
| Keys | `GET /.well-known/jwks.json` | current + previous RS256 key (rotation) |
| Paid gate | `GET /v1/auth/verify?app=` | Caddy `forward_auth`; JWT + Redis only. 200 with `X-AltVivo-*` headers, or a 302 / JSON 401·403·404·503 per CONTRACTS.md |
| | `POST /v1/auth/app-token {app}` | 5-minute RS256 token, `aud=<app>`, from the app's own origin, licence required |
| CSRF | `GET /v1/auth/csrf` | issues the signed `altvivo_csrf` cookie |
| Auth | `POST /v1/auth/register` · `login` · `mfa/verify` · `refresh` · `logout` · `logout-all` | Turnstile on register / login / forgot |
| | `GET /v1/auth/refresh/bounce?next=` | spokes: rotate + 303 back (or `/login?redirect=`) |
| | `GET /v1/auth/verify-email` · `POST verify-email/resend` · `forgot-password` · `reset-password` · `GET session` | `session` answers 401 `SESSION_STALE` after an access change |
| OAuth | `GET /v1/auth/oauth/{google,orcid}/start?next=` → `/callback` · `GET /v1/auth/oauth/pending/:id` | PKCE (Google), nonce, browser-bound state |
| MFA | `POST /v1/api/mfa/enroll` · `activate` · `recovery-codes` · `disable` | TOTP, replay-protected, 10 recovery codes |
| Public | `GET /v1/public/apps` · `plans?currency=` · `advisory-board[?featured=1]` | prices exclude GST; currency from `CF-IPCountry` |
| | `POST /v1/public/contact` · `consent` | contact: CSRF + Origin, 5/min/IP and 5/day/address, honeypot; consent: append-only evidence |
| User | `GET/PATCH /v1/api/me` · `POST /v1/api/me/password` · `GET /v1/api/workspace` · `GET/DELETE /v1/api/sessions[/:id]` | workspace shows live entitlements and upgrade links |
| | `GET /v1/api/credits/ledger` · `GET /v1/api/vault/files[/:id/download]` · `DELETE /v1/api/vault/files/:id` | |
| Billing | `GET/PUT /v1/api/billing/profile?scope=personal\|organization` | GST bill-to details (GSTIN checksum, state, PIN) |
| | `POST /v1/api/billing/checkout {planCode, seats?}` | draft GST invoice → Razorpay order (INR) or Stripe Checkout (USD) |
| | `POST /v1/api/billing/razorpay/confirm` | verifies the Checkout signature, captures, activates, returns fresh claims |
| | `GET /v1/api/billing/subscriptions` · `POST …/:id/cancel` · `GET /v1/api/billing/invoices` · `…/:id/pdf` · `GET /v1/api/billing/payments` | personal, plus the institution's for its administrators |
| | `POST /v1/api/billing/quotes {planCode, seats, poNumber?}` | institution admins: self-service proforma (PDF) |
| Webhooks | `POST /v1/billing/webhooks/stripe` · `POST /v1/billing/webhooks/razorpay` | HMAC over raw bytes, stored once, retried on failure |
| Admin | `GET /v1/api/admin/dashboard` | MRR/ARR per currency, licences per app, sessions, 30-day revenue, open proformas |
| | `GET/PATCH /v1/api/admin/apps[/:appId]` (LIVE / BETA / MAINTENANCE) · `GET/PATCH /v1/api/admin/plans[/:code]` | switchboard and pricing |
| | `GET /v1/api/admin/users[?q=]` · `GET/PATCH …/:id` · `POST …/:id/mfa-reset` · `POST …/:id/logout-all` | |
| | `GET/POST /v1/api/admin/licences` · `PATCH …/:id` · `POST …/:id/revoke` | manual licences with custom expiry (offline NEFT / RTGS / PO) |
| | `GET/POST /v1/api/admin/organizations` · `GET/PATCH …/:id` · `PUT …/:id/billing-profile` · `POST/DELETE …/:id/members[/:userId]` · `POST …/:id/proformas` | institutional tenants, seats, domains |
| | `GET /v1/api/admin/invoices[/:id[/pdf]]` · `POST …/:id/record-payment` · `…/cancel` · `…/credit-note` · `GET /v1/api/admin/payments` | |
| | `GET/POST /v1/api/admin/advisory-board` · `PATCH/DELETE …/:id` · `POST …/reorder` · `POST …/:id/photo-upload` · `…/photo-complete` | CMS |
| | `GET /v1/api/admin/contact` · `PATCH …/:id` · `GET /v1/api/admin/audit?eventType=&actorId=&appId=&resourceId=&from=&to=&before=` · `GET /v1/api/admin/audit/verify` | |
| Internal | `/v1/internal/registry` · `users/:id/entitlements` · `credits/debit` · `credits/refund` · `audit` · `vault/*` | spoke service token; 404 at the public edge; paid entitlement required |
| Ops | `GET /healthz` | DB + Redis |

Errors are always `{ "error": { "code", "message", "details?" } }`, except `/v1/auth/verify`, which answers in the plain shape Caddy and spokes expect.

All admin routes need a SUPERADMIN on an MFA-verified session. These also need a fresh TOTP code and a reason, recorded as an electronic signature in the audit chain:
- changes to access, prices, users or institutions;
- licences;
- recorded payments, cancellations and credit notes.

## Billing and GST invoices

- **One checkout record.** Checkout creates a DRAFT tax invoice. The database computes its GST lines and total, and the provider is asked for exactly that amount; its metadata carries only the invoice id.
- **On payment** (webhook or browser confirmation, idempotent and serialised by a row lock):
  1. Core checks the amount and currency against the invoice.
  2. It creates the subscription term.
  3. It issues the invoice; the database assigns the gapless number, e.g. `AV/2026-27/00042`.
  4. It marks the invoice paid, stores the PDF in R2 and emails a receipt.
  5. It marks the buyer's claims stale.

  A wrong amount activates nothing and is audited as `SECURITY.PAYMENT_AMOUNT_MISMATCH`.
- **India: Razorpay.** Prepaid terms paid by UPI, cards or NetBanking, renewed by buying again. An early renewal starts when the current term ends. CGST + SGST apply within the seller's state, IGST otherwise.
- **Elsewhere: Stripe.** Zero-rated export of services under LUT. A one-time payment by default; auto-renewing when a plan has a recurring Stripe price, in which case every paid Stripe invoice gets its own GST invoice.
- **Refunds.** A full refund ends the term at once and issues a credit note for the whole invoice. A partial refund is recorded, and an administrator documents it with a credit note of the right amount.
- **Institutions:**
  1. The institution receives a proforma (`PF/…`, with bank details).
  2. Payment arrives by NEFT, RTGS or cheque.
  3. The admin records it with `record-payment`.
  4. Core issues a tax invoice against the proforma, grants manual licences for one interval to the institution for each app, and raises its seat limit.
- **PDFs** follow CGST Rule 46 (tax invoice) and Rule 53 (credit note). They are rendered with pdfkit and DejaVu Sans (₹ and accented names), carry Indian amount-in-words (lakh / crore), are stored once with their SHA-256, and are downloaded through short-lived signed URLs.
- **Housekeeping** (hourly): expires prepaid terms, deletes checkout drafts abandoned for 7 days, and sends a renewal reminder 7 days before a prepaid term ends.

## Security notes

- **Tokens.**
  - **Access token:** RS256 JWT, 15 min, in cookie `altvivo_at` (`Domain=.altvivo.bio; Path=/; HttpOnly; Secure; SameSite=Lax`).
  - **Refresh token:** 7 days, in cookie `altvivo_rt` (`Path=/v1/auth/refresh; SameSite=Strict`). Only an HMAC of it is stored. Each use rotates it, and reuse revokes the whole session family.
- **Instant logout everywhere.** Redis `core:revoked:sid:*` / `core:revoked:user:*`, read by the gate and by spokes.
- **The gate.**
  - The redirect target is rebuilt from the app's own host, so it is never an open redirect.
  - It fails closed if Redis is unreachable.
  - Caddy strips client-supplied `X-AltVivo-*` headers.
- **CSRF.** `Origin` allow-list + signed double-submit `altvivo_csrf`. App tokens are issued only to the app's own origin.
- **Rate limits.**
  - 5/min/IP on credential and contact endpoints; this limiter fails closed.
  - 60/min/IP on session endpoints.
  - 120/min/user on `/v1/api/*`.
  - Account lockout after 10 failed logins.
- **Passwords.** Argon2id.
- **MFA.** TOTP secrets are AES-256-GCM encrypted; codes are single-use. Enrolment is mandatory for INSTITUTE_ADMIN and SUPERADMIN.
- **Money and access invariants** live in the database (see [db/README.md](db/README.md)), so a bug in this API cannot:
  - create a free licence;
  - edit an issued invoice;
  - skip an invoice number;
  - shrink a refund;
  - exceed a seat limit.
- **Logs** redact cookies, Authorization headers, passwords, codes and tokens. Consent records store only a peppered hash of the IP.

## Operations

Create the first superadmin; it prints and emails a one-hour password-setup link and enforces TOTP at first sign-in:
```bash
docker compose exec altvivo-core node dist/cli/create-superadmin.js --email founder@altvivo.bio --name "Founder Name"
```

Before selling, set the `SELLER_*` variables (legal name, GSTIN, address, state code; LUT ARN for exports; bank details for proformas). Until they are set, checkout and proformas answer `503 INVOICING_NOT_CONFIGURED`.

Webhooks to register:
- Stripe: `https://api.altvivo.bio/v1/billing/webhooks/stripe`. Events:
  - `checkout.session.completed`, `checkout.session.async_payment_succeeded`
  - `invoice.paid`
  - `customer.subscription.updated`, `customer.subscription.deleted`
  - `charge.refunded`
- Razorpay: `https://api.altvivo.bio/v1/billing/webhooks/razorpay`. Events: `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`.

OAuth redirect URIs: `https://api.altvivo.bio/v1/auth/oauth/google/callback` and `https://api.altvivo.bio/v1/auth/oauth/orcid/callback`.
