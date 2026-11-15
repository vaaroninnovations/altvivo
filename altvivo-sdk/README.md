# altvivo-sdk — Module 4: spoke integration SDK and shared top bar

> **Status (revised spec, 2026-11-15).** XPRISM and aMaze no longer use these packages. XPRISM ships a self-contained `lab/altvivo_sso_middleware.py` and aMaze is a static app behind Caddy's paid gate; both live as patches in `altvivo-infra/spokes/`, and the top bar moved to `altvivo-infra/embed/`. The Python and Node packages below remain as building blocks for future Phase 2 spokes. They still use the earlier string-valued entitlements, so update them to the paid-entitlement claims in `altvivo-infra/CONTRACTS.md` before reusing them.


Everything a `*.altvivo.bio` application needs to join AltVivo single sign-on.

| Path | What it is | Tests |
|---|---|---|
| [`python/`](python) | `altvivo-sso` for Django: JWKS cache, RS256 verification, `AltVivoSSOMiddleware`, identity model, user mapper hook, `{% altvivo_topbar %}`, core service client | 13 (`DJANGO_SETTINGS_MODULE=tests.settings python -m django test tests`) |
| [`node/`](node) | `@altvivo/sso` for Express: `createAltVivo().authenticate()` / `.requireUser()`, revocation reader, core service client | 9 (`npm test`) |
| [`topbar/`](topbar) | `<altvivo-topbar>` web component served from `embed.altvivo.bio/bar.js` | visual + behavioural check via `topbar/demo/` |
| [`integrations/xprism/`](integrations/xprism) | Patch for vaaroninnovations/XPRISM | XPRISM's 153 tests + 8 SSO tests, with SSO on and off |
| [`integrations/amaze/`](integrations/amaze) | Patch for vaaroninnovations/aMaze | 9 end-to-end server tests |

## How SSO works on a spoke

```
browser ──(cookie altvivo_at, Domain=.altvivo.bio)──► spoke
spoke:  verify RS256 locally (JWKS cached 5 min, refetch on unknown kid)
        └─ Redis core:revoked:sid:<sid> / core:revoked:user:<sub>   (instant logout)
        └─ entitlements[app] ≥ trial ?  else 403 + link to pricing
expired token:
        page load → 303 https://api.altvivo.bio/v1/auth/refresh/bounce?next=<this page>
        XHR/API   → 401 {"error":"session_expired","refreshUrl":…}   (bar.js refreshes proactively)
spoke logout → https://altvivo.bio/logout?next=<spoke>  (clears the shared cookies)
```

Spokes never see passwords, refresh tokens or MFA secrets. They need only the public JWKS and, for server-to-server calls (credits, audit, vault), their service token.

## Django (XPRISM and future Python spokes)

```python
INSTALLED_APPS += ["altvivo_sso"]
MIDDLEWARE.insert(MIDDLEWARE.index("django.contrib.auth.middleware.AuthenticationMiddleware") + 1,
                  "altvivo_sso.middleware.AltVivoSSOMiddleware")
AUTHENTICATION_BACKENDS = ["django.contrib.auth.backends.ModelBackend", "altvivo_sso.backends.AltVivoBackend"]
ALTVIVO_SSO = {"APP_ID": "xprism", "USER_MAPPER": "myapp.altvivo.MyMapper"}   # rest from ALTVIVO_* env
urlpatterns += [path("sso/", include("altvivo_sso.urls"))]                    # login/ and logout/
```

- **Hybrid mode (default).** Sessions created by the app's own login form are left alone, so college or local accounts keep working beside SSO. With `MODE="required"`, set `LOGIN_URL = "altvivo_sso:login"`.
- **Linking.** `DefaultUserMapper` links an existing local user only when AltVivo says the email is verified, and lets you veto the link with `may_link()`. Otherwise it creates a user with an unusable password. Override `create_user` and `update_user` for app-specific fields.
- **Signals and checks.** `altvivo_sso.signals.sso_login(request, user, claims)` fires once per AltVivo session, which is the hook for local audit logs. System checks catch a missing backend, wrong middleware order, or missing `PUBLIC_ORIGIN` or Redis.
- **Server-to-server calls.** For example:

  ```python
  from altvivo_sso.client import core

  core().debit_credits(sub, 5, "RUN", ref)
  core().audit(sub, "XPRISM.EXPERIMENT_SUBMITTED", ...)
  core().vault_upload_url(...)
  ```

## Express (aMaze and future Node spokes)

```js
import { createAltVivo, createCoreClient } from "@altvivo/sso";
const altvivo = createAltVivo({ appId: "amaze", redis });          // ALTVIVO_* env for the rest
app.use(altvivo.authenticate());                                    // req.altvivo = { claims, expired, reason }
app.use("/api/private", altvivo.requireUser({ minLevel: "trial" }));
const core = createCoreClient();                                    // ALTVIVO_CORE_INTERNAL_URL + ALTVIVO_SERVICE_TOKEN
```

## Top bar

```html
<script src="https://embed.altvivo.bio/bar.js" defer crossorigin="anonymous"></script>
<altvivo-topbar app="xprism"></altvivo-topbar>
```

- **What it shows.**
  - A waffle app switcher. LIVE and BETA apps are links with an entitlement badge (Full, Pro, Trial, or Upgrade); COMING_SOON apps carry a **SOON** pill.
  - The live credit balance.
  - An account menu with sign-out.
  - A "Verify your email" notice when needed.
- **Session handling.**
  - It refreshes the access token 60 seconds before expiry, and after the tab regains focus if the token is due.
  - Signing out in one tab signs out the others (`BroadcastChannel`).
  - It emits `altvivo:session` and `altvivo:signedout` events.
- **Rendering.**
  - Shadow DOM with constructable stylesheets.
  - Dark and light themes (`theme="auto|light|dark"`).
  - Keyboard support: Escape closes, arrow keys move, focus returns to the button.
  - Phone-width layout.
- **Safety.** Text comes from the API via `textContent` only, and app links are allow-listed to `https://*.altvivo.bio`.
- **Build.** `node topbar/build.mjs` writes `dist/bar.js` (5-minute cache) and an immutable `dist/bar.v1.0.0.js` plus its SRI hash. Caddy serves `dist/` at `embed.altvivo.bio` (`EMBED_DIST_DIR`).

## Applying the integrations

```bash
cd ../spokes/xprism && git am ../../altvivo-sdk/integrations/xprism/0001-xprism-altvivo-sso.patch
```
```bash
cd ../spokes/amaze && git am ../../altvivo-sdk/integrations/amaze/0001-amaze-altvivo-sso.patch
```

Both apply cleanly on the upstream heads checked on 2026-11-14 (XPRISM `ad137c6`, aMaze `87e60c0`). See each integration's README for what changes and why.
