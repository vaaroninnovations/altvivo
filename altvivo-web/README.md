# altvivo-web — the AltVivo portal (altvivo.bio)

Next.js 16 (App Router, React 19, Tailwind 4), served by `altvivo-web:3000` behind Caddy. Design: obsidian `#070B14` dark mode and clinical slate `#F8FAFC` light mode, teal `#0EA5E9` and emerald `#10B981` accents, Plus Jakarta Sans and JetBrains Mono.

## Pages

| Route | What it does | Data |
|---|---|---|
| `/` | Hero, the flagship products (XPRISM, aMaze) with live "from" prices, platform pillars, the featured Scientific Advisory Board, institutions | `GET /v1/public/apps`, `plans`, `advisory-board?featured=1` |
| `/advisory-board` | Published advisory board: portrait, credentials, designation, affiliation, specialisations, ORCID / Scholar / LinkedIn / website, bio dialog | `GET /v1/public/advisory-board` (managed in `/admin`) |
| `/pricing` | Currency switch (INR via Razorpay, USD via Stripe), monthly / annual, single-app and Dual-Suite cards, site-licence seat calculator with GST, proforma PDF for institution admins or a quotation request, comparison, FAQ | `GET /v1/public/plans`; checkout below |
| `/free-month` | "One month free" request form (name, institution, role, applications, use case); a signed-in visitor sees where their own request stands. The site-wide announcement bar (`components/trial.tsx`) links here | `GET /v1/public/trial-offer`, `POST /v1/public/trial-request` |
| `/privacy`, `/terms`, `/cookies` | Privacy Policy (DPDPA 2023 + GDPR, Grievance Officer), Terms & Conditions (licences, seats, no sharing, research disclaimers, IP, GST, refunds `#refunds`, Indian jurisdiction), Cookie Policy (every cookie and storage key) | legal identity from `LEGAL_*` / `SELLER_*` env, read per request |
| `/contact` | Contact form (`?topic=institutional` etc.) | `POST /v1/public/contact` |
| `/maintenance?app=` | Maintenance page (the paid gate and Caddy send visitors here while an app is down or in maintenance) | registry |
| `/login`, `/register` | Sign-in (password, Google, TOTP step `/login/mfa`) and registration. Both honour `?redirect=` (the paid gate's parameter) and `?next=` | `/v1/auth/*` |
| `/workspace` | My Applications: each app shows "Active licence" with Launch, or "Locked — upgrade required" with one-click checkout; renewal warnings, data vault | `/v1/api/workspace`, `/v1/auth/session` |
| `/workspace/upgrade?app=&reason=` | Where the paid gate sends unlicensed users: explains the reason, offers the app plan or the Dual-Suite bundle | `/v1/public/plans`, checkout |
| `/workspace/billing` | Licences in force (renew, stop auto-renew), bundle upgrade, tax invoice PDFs, payments, personal and institution GST billing details | `/v1/api/billing/*` |
| `/workspace/security` | Profile, affiliation, ORCID, password, TOTP enrolment and recovery codes, sessions and sign-out everywhere (`/workspace/account` redirects here) | `/v1/api/account/*`, `/v1/auth/mfa/*` |
| `/admin` | SuperAdmin only (server guard + TOTP-verified session). Revenue and telemetry dashboard | `/v1/api/admin/dashboard` |
| `/admin/users`, `/admin/users/[id]` | Search users; role and institution, suspend / reactivate, MFA reset, sign out everywhere, manual licence grants | `/v1/api/admin/users*`, `licences` |
| `/admin/licences` | All manual (offline NEFT / RTGS / PO / complimentary) licences: change expiry, revoke | `/v1/api/admin/licences*` |
| `/admin/institutions`, `/admin/institutions/[id]` | Tenants: seat limit, whitelisted domains, status, GST billing profile, members, institution licences, proformas and invoices with "record bank payment" | `/v1/api/admin/organizations*`, `invoices*` |
| `/admin/invoices`, `/admin/payments` | Every tax invoice, proforma and credit note (PDF, record payment, credit note, cancel); every Razorpay / Stripe / bank payment | `/v1/api/admin/invoices*`, `payments` |
| `/admin/apps` | App switchboard (LIVE / BETA / MAINTENANCE, version) and plan price editor | `/v1/api/admin/apps*`, `plans*` |
| `/admin/advisory` | Advisory board CMS: create, edit, publish / hide, feature, reorder, delete, portrait upload (SHA-256 presigned PUT) | `/v1/api/admin/advisory-board*` |
| `/admin/mail` | SuperAdmin mailbox: Inbox (contact enquiries, free-month requests, forwarded replies), Starred, Sent, Drafts, Trash; conversation view, compose / reply / forward, save draft, search, unread filter, bulk read / star / trash / restore / delete, empty trash | `/v1/api/admin/mail*` |
| `/admin/trials` | Free-month requests: approve (TOTP-signed, 1 to 90 days) or decline; shows whether the address already has a verified account | `/v1/api/admin/trials*` |
| `/admin/contact`, `/admin/audit` | Contact inbox with status workflow; filterable hash-chained audit trail with chain verification | `/v1/api/admin/contact*`, `audit*` |

Every privileged admin change opens the e-signature dialog (`components/admin/kit.tsx`): a fresh authenticator code (single use) and a reason, both stored in the audit trail by core.

### Checkout (`components/checkout.tsx`)

1. Sign-in check; a sign-in link brings the visitor back to `/pricing?plan=<code>`, which resumes the purchase.
2. GST billing details (`BillingProfileForm`, reused by `/workspace/billing`). The GSTIN is validated with the same mod-36 checksum and state rule as the database.
3. Review: taxable value, GST and total. Currency follows the billing country.
4. Payment:
   - **India:** `POST /v1/api/billing/checkout`, then Razorpay Checkout (UPI, cards, NetBanking), then `POST /v1/api/billing/razorpay/confirm`.
   - **Elsewhere:** a redirect to Stripe Checkout.
5. "Licence active", with launch buttons and the invoice link.

Institution administrators can generate a numbered proforma PDF with `POST /v1/api/billing/quotes` on `/pricing#institutional`.

### Cookie consent (`components/consent.tsx`)

- **Banner.** Accept all, Reject non-essential, or Customise (Preferences / Analytics / Marketing; Necessary is always on).
- **Storage.** The choice is kept in `altvivo_consent` on `.altvivo.bio`, so every app can read it, and recorded as evidence with `POST /v1/public/consent`.
- **Changing it.** Use "Cookie preferences" in the footer or the button on `/cookies`.
- **Theme preference.** Without Preferences consent the theme choice is kept only for the tab (sessionStorage).

## Configuration

Build-time (`NEXT_PUBLIC_*`, Docker build args): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_EMBED_URL`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.

Runtime:
- **Search engines and analytics (all optional, read per request):** `GOOGLE_SITE_VERIFICATION` and `BING_SITE_VERIFICATION` print the ownership meta tags in `<head>` (`src/app/layout.tsx`); `GA_MEASUREMENT_ID` (`G-XXXXXXXXXX`) turns on Google Analytics 4 (`components/analytics.tsx`), which loads only after the visitor allows Analytics cookies, never on signed-in pages, and is added to the CSP only when set. `/robots.txt` and `/sitemap.xml` come from `src/app/robots.ts` and `src/app/sitemap.ts`.
- **About page founder:** `LEGAL_FOUNDER_NAME`, `LEGAL_FOUNDER_ROLE`, `LEGAL_FOUNDER_BIO`, `LEGAL_FOUNDER_PHOTO` (blank uses the built-in profile and `public/brand/founder.jpg`).
- **Core API:** `CORE_INTERNAL_URL`, `JWKS_INTERNAL_URL`, `JWT_ISSUER`.
- **Legal identity:**
  - `LEGAL_ENTITY_NAME`, `LEGAL_REGISTERED_ADDRESS`, `LEGAL_CIN`, `SELLER_TRADE_NAME`, `SELLER_GSTIN`;
  - `LEGAL_PRIVACY_EMAIL`, `LEGAL_SALES_EMAIL`, `SUPPORT_EMAIL`;
  - `LEGAL_GRIEVANCE_OFFICER_NAME`, `LEGAL_GRIEVANCE_OFFICER_EMAIL`, `LEGAL_GRIEVANCE_OFFICER_PHONE`;
  - `LEGAL_JURISDICTION_CITY`.

All of these are set by `altvivo-infra/docker-compose.yml`.

## Local development

```bash
cd ../altvivo-core && npm run build && node scripts/dev-stack.mjs
```
```bash
cp .env.development.example .env.local && npm run build && npm start
```

The dev stack seeds `researcher@altvivo.test` (Dual-Suite licence), `student@altvivo.test` (no licence) and `founder@altvivo.test` (SUPERADMIN), with password `altvivo-dev-password`, plus demo advisory profiles.

- **Checkout.** It shows "opening soon" unless you start the dev stack with Razorpay or Stripe test keys in its environment (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`).
- **Legal review.** The policy texts are written for an Indian SaaS company serving Indian and international customers. Have them reviewed by counsel before launch.
