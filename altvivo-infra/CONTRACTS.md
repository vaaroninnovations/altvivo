# AltVivo integration contracts (set in Module 1; database in Module 2, API in Module 3, portal in Modules 4–5)

Module 1 wires Caddy, XPRISM, aMaze and the top bar against the interfaces below. Modules 2 (schema) and 3 (altvivo-core) must implement them exactly; Modules 4–5 (altvivo-web) must serve the listed pages.

## 1. Access-token claims (`altvivo_at`, RS256, 15 min)

```json
{
  "sub": "usr_uuid",
  "sid": "session_uuid",
  "email": "researcher@institute.edu.in",
  "email_verified": true,
  "name": "Dr. Researcher",
  "role": "PI",
  "org_id": "org_uuid",
  "tier": "INSTITUTIONAL",
  "mfa": true,
  "entitlements": {
    "xprism": { "active": true,  "level": "full", "source": "institution", "plan": "site_license_annual", "expires_at": 1798761599 },
    "amaze":  { "active": false, "level": "none", "source": null,          "plan": null,                  "expires_at": null }
  },
  "credits_remaining": 1250,
  "iat": 1731590000,
  "iat_ms": 1731590000123,
  "exp": 1731590900,
  "iss": "https://api.altvivo.bio",
  "jti": "uuid"
}
```

- **Entitlement shape.** `entitlements.<app>` is an object for every app in `app_registry`.
  - `active` is `true` only for a paid grant that is in force: an individual subscription, a dual-suite bundle, an institutional seat, or a manual grant by a SUPERADMIN.
  - `expires_at` is epoch seconds, or `null` for open-ended grants.
  - Spokes refuse when `active !== true` or `expires_at <= now`.
- **No free tier.** Trials, waitlists and default access never set `active: true`.
- **Roles.** `role` is one of `STUDENT | RESEARCHER | PI | INSTITUTE_ADMIN | ADVISORY_BOARD | SUPERADMIN`. `SUPERADMIN` and `ADVISORY_BOARD` bypass billing (env `PAID_GATE_VIP_ROLES` on core, `ALTVIVO_VIP_ROLES` on spokes).
- **XPRISM admin.** XPRISM grants its platform-admin role only to `SUPERADMIN` with `mfa: true`.
- **Tier.** `tier` is `NONE | INDIVIDUAL | BUNDLE | INSTITUTIONAL | VIP` (the best grant held); `source` is `individual | bundle | institution | manual | vip`.
- **Freshness.** `iat_ms` is the mint time in milliseconds. After any access change, core marks the user's tokens stale (Redis `core:stale:user:<sub>`, epoch ms); the gate then answers like an expired token so the browser refreshes. Spokes may ignore this: the gate runs first.

The session endpoints (`GET /v1/auth/session`, `POST /v1/auth/refresh`) return `user.entitlements` in the same shape, camel-cased (`active`, `level`, `plan`, `expiresAt` as ISO-8601). `<altvivo-topbar>` and aMaze read that shape.

## 2. `GET /v1/auth/verify?app=<app_id>` — Caddy `forward_auth` (layer 1)

Called by Caddy for **every** request to a paid spoke, carrying the browser's `Cookie` plus these headers: `X-Forwarded-Method`, `X-Forwarded-Uri`, `X-Forwarded-Host`, `X-Forwarded-Proto: https` and `X-Real-IP`.

It must answer from the JWT and the Redis revocation list only (no database query), and quickly. The original URL is `https://{X-Forwarded-Host}{X-Forwarded-Uri}`.

| Situation | Navigation request (GET/HEAD, `Accept: text/html`) | API / XHR / other |
|---|---|---|
| Valid token, `active` (or VIP role), app `LIVE`/`BETA` | `200`, empty body, with headers `X-AltVivo-User-Id`, `X-AltVivo-Email`, `X-AltVivo-Role`, `X-AltVivo-Access` (`paid` \| `vip`), `X-AltVivo-Plan` | same |
| No / invalid / revoked token | `302 https://altvivo.bio/login?redirect=<original URL>` | `401 {"error":"unauthenticated","redirect":…}` |
| Token expired | `302 https://api.altvivo.bio/v1/auth/refresh/bounce?next=<original URL>` | `401 {"error":"session_expired","refreshUrl":…}` |
| Signed in, not paid / expired grant | `302 https://altvivo.bio/workspace/upgrade?app=<id>&reason=subscription_required` (or `subscription_expired`) | `403 {"error":"subscription_required","redirect":…}` |
| App `MAINTENANCE` (non-VIP) | `302 https://altvivo.bio/coming-soon?app=<id>&state=maintenance` (portal host; a spoke-host URL would loop back through the gate) | `503` |
| App `COMING_SOON` | `302 https://altvivo.bio/coming-soon?app=<id>` | `404` |

- **Rejected `next`/`redirect` values.** Anything outside `https://*.altvivo.bio` is rejected.
- **Header copying.** Caddy copies only the five `X-AltVivo-*` headers, and drops client-supplied copies of them.
- **Rate limits.** The endpoint is excluded from core's `/v1/auth/*` 5/min limit, because it runs once per asset request.

## 3. Other core endpoints used by Module 1 code

| Endpoint | Used by | Behaviour |
|---|---|---|
| `POST /v1/auth/app-token` `{ "app": "amaze" }` | aMaze → its video-tracking service | Requires a session with an active entitlement for that app and a CSRF header; same-site origins only. Returns `{ token, expiresAt }`: an RS256 JWT with `aud=<app>`, a 5-minute lifetime, `sub` and `entitlements.<app>` only. The session cookie is never exposed. |
| `POST /v1/public/contact` | aMaze contact page (and the portal) | `{ name, email, institution, category, subject, message, app }`. `category` is `sales | institutional | support | billing | partnership | press | privacy | other`, or one of aMaze's form labels (mapped; unknown text becomes `other`). CSRF and Origin checked, 5/min/IP and 5/day/address, stored and emailed to `SUPPORT_EMAIL` with Reply-To. Answers `201 {reference}`, or `4xx` with `{error:{message}}`. |
| `GET /.well-known/jwks.json` | XPRISM middleware (internally `http://altvivo-core:4000/...`) | Unchanged |
| Redis `core:revoked:sid:<sid>`, `core:revoked:user:<sub>` | XPRISM middleware, `/v1/auth/verify` | Unchanged (instant logout) |

## 4. Portal pages the spokes redirect to (altvivo-web)

| URL | Purpose |
|---|---|
| `/login?redirect=<url>` | Sign in, then continue to `redirect` (same-site only; `?next=` is accepted too) |
| `/register?redirect=<url>` | Create an account |
| `/logout?next=<url>` | POST the core logout (clears the `.altvivo.bio` cookies and revokes the session everywhere), then go to `next` |
| `/workspace/upgrade?app=<id>&reason=<reason>` | Explains the missing licence and opens checkout for that app or the bundle |
| `/workspace/security` | Password, TOTP, sessions (XPRISM's password pages hand off here) |
| `/workspace?notice=xprism_college_inactive` · `notice=xprism_account_disabled` | Messages for XPRISM accounts that cannot be used |
| `/coming-soon?app=<id>[&state=maintenance]` | Phase 2 holding page (Caddy also serves it on Phase 2 hosts) and the maintenance page for gated spokes |
| `/pricing[?plan=<code>][#institutional]` | Licences and checkout (Module 4); `?plan=` resumes a purchase after sign-in |
| `/advisory-board` · `/contact[?topic=<category>]` | Advisory board and contact form (Module 4) |
| `/workspace/billing[?status=success]` | Licences, invoices and GST billing details; Stripe's success URL returns here (Module 5) |
| `/admin/*` | SuperAdmin panel (Module 5): dashboard, users, manual licences, institutions and proformas, invoices, payments, apps and pricing, advisory CMS, contact inbox, audit log |
| `/privacy[#grievance]` · `/terms[#refunds]` · `/cookies` | Legal pages (Module 4) |

## 5. Database interfaces (Module 2, `altvivo-core/db`)

| Object | Use in Module 3 |
|---|---|
| `user_access_claims(user_id [, at])` | Builds `entitlements.<app>`: `{active, level: active ? "full" : "none", source, plan: plan_code, expires_at}`. Adds the VIP bypass for `PAID_GATE_VIP_ROLES` on top. Replaces `user_effective_entitlements`, which is dropped. |
| `organizations.status`, `seat_limit` + trigger | Domain auto-join must catch SQLSTATE `23514` (`organizations_seat_limit`) and tell the user the institution has no free seats |
| `subscriptions` (`billing_mode`, `unit_amount_minor`, `current_period_start`) | Webhooks write `ACTIVE`/`PAST_DUE`/`CANCELED`/`EXPIRED`. `PENDING` while checkout is open. `TRIALING` no longer exists. |
| `app_entitlements` with `source = MANUAL` | Admin manual licences: insert with `granted_by` (SUPERADMIN), `reason`, `expires_at`; revoke with `revoked_at`, `revoked_by`, `revoke_reason` |
| `payments`, `invoices`, `invoice_lines` | Insert invoices as `DRAFT` with seller/buyer snapshots and `tax_treatment`, add lines, then `UPDATE … SET status = 'ISSUED'` (the number and totals are assigned by the database). Render the PDF afterwards and store `pdf_object_key` + `pdf_sha256` once. |
| `revenue_active_subscriptions` | MRR per subscription for the revenue dashboard |
| `advisory_board_members`, `contact_messages`, `consent_records`, `billing_profiles` | CMS CRUD, `POST /v1/public/contact`, cookie-banner consent log, checkout bill-to |

## 6. Status (Module 3)

Every endpoint above is implemented in altvivo-core and covered by its test suite (`tests/paid.test.ts`, `tests/api.test.ts`). The portal (Modules 4–5) uses the routes listed in [altvivo-core/README.md](../altvivo-core/README.md):
- `/pricing`: `/v1/public/plans`.
- Advisory board: `/v1/public/advisory-board`.
- Cookie banner: `/v1/public/consent`.
- Upgrade and billing pages:
  - `/v1/api/billing/profile`, `checkout` and `razorpay/confirm`;
  - `invoices`, `subscriptions` and `quotes`.
- `/admin`: `/v1/api/admin/*`.
