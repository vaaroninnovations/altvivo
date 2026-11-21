# Google sign-in: Google Cloud Console setup

AltVivo's "Continue with Google" button is a server-side OAuth 2.0 / OpenID Connect flow run by `altvivo-core` (authorization code + PKCE + nonce, `prompt=select_account`, no refresh tokens). Google only ever talks to the API host, so you need **one** OAuth client and **one** redirect URI. The spokes (XPRISM, aMaze) do not need their own Google clients; they rely on the AltVivo session.

| Value | Production |
|---|---|
| Redirect URI | `https://api.altvivo.bio/v1/auth/oauth/google/callback` |
| Scopes | `openid`, `email`, `profile` (all non-sensitive) |
| Authorised domain | `altvivo.bio` |
| Env vars | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` in `altvivo-infra/.env` |

The redirect URI is built in `altvivo-core/src/routes/oauth.ts` as `${PUBLIC_API_URL}/v1/auth/oauth/google/callback`. If `PUBLIC_API_URL` ever changes, the URI in Google must change with it, character for character.

---

## 1. Create (or pick) a project

1. Open <https://console.cloud.google.com/> and sign in with the Google account that should own AltVivo's credentials (ideally an organisation or shared admin account, not a personal one).
2. Project picker (top bar) → **New project** → name it `AltVivo` → **Create**, then make sure it is the selected project.

No APIs need enabling. Sign-in with the `openid email profile` scopes works without turning on any API.

## 2. Configure the consent screen (Google Auth Platform)

Go to **APIs & Services → OAuth consent screen**, which opens the **Google Auth Platform**. On a new project, click **Get started**:

1. **App information**: App name `AltVivo`. User support email: an address you monitor.
2. **Audience**: **External**, so any Google account can sign in.
3. **Contact information**: developer contact email(s).
4. Accept the Google API Services User Data Policy → **Create**.

Then fill in the left-hand sections:

**Branding**
- App logo (optional: uploading one triggers brand verification, see step 5). Use a 120×120 px square PNG/JPG.
- App home page: `https://altvivo.bio`
- Privacy policy: `https://altvivo.bio/privacy`
- Terms of service: `https://altvivo.bio/terms`
- **Authorised domains**: add `altvivo.bio`. That covers `api.altvivo.bio` too. Google asks you to prove ownership in [Google Search Console](https://search.google.com/search-console); the `GOOGLE_SITE_VERIFICATION` env var already prints the meta tag for that.

Check that the privacy and terms URLs are the real ones served by `altvivo-web` before saving. Google rejects links that 404.

**Data Access** → **Add or remove scopes** → tick:
- `openid`
- `.../auth/userinfo.email`
- `.../auth/userinfo.profile`

→ **Update** → **Save**. All three are non-sensitive, so Google does not require a security assessment.

## 3. Create the OAuth client

**Google Auth Platform → Clients → Create client** (same as *APIs & Services → Credentials → Create credentials → OAuth client ID*):

- Application type: **Web application**
- Name: `AltVivo API (production)`
- **Authorised JavaScript origins**: leave empty. The browser never calls Google directly.
- **Authorised redirect URIs** → **Add URI**:
  ```
  https://api.altvivo.bio/v1/auth/oauth/google/callback
  ```
  It must be exact: `https`, no trailing slash, lowercase `google`.

**Create**. Copy the **Client ID** (`…apps.googleusercontent.com`) and the **Client secret** (`GOCSPX-…`). Google now shows the secret in full only once: download the JSON or store it in your password manager straight away. If you lose it, add a new secret on the client page and delete the old one.

For local development, create a **second** client (`AltVivo API (dev)`) with your local API's callback, e.g. `http://localhost:<core port>/v1/auth/oauth/google/callback`. Google allows plain `http` only for `localhost`. Do not add localhost URIs to the production client.

## 4. Publish the app

**Google Auth Platform → Audience → Publishing status**: while it reads **Testing**, only the accounts under *Test users* (up to 100) can sign in, and everyone else gets "Access blocked: AltVivo has not completed the Google verification process". Add yourself as a test user to try it out, then click **Publish app → Confirm** to move to **In production** before launch.

## 5. Verification (only if Google asks)

With only non-sensitive scopes, AltVivo needs **brand verification** at most, and only if you upload a logo or Google flags the branding. Until it passes, users may see an "unverified app" notice. Under **Verification Centre**, submit once the authorised domain is verified in Search Console. It usually takes a few business days. Without a logo, the app can go live straight away.

## 6. Put the credentials on the server

On the production VPS (`/opt/altvivo/altvivo-infra`):

```bash
nano /opt/altvivo/altvivo-infra/.env
```

```dotenv
GOOGLE_CLIENT_ID=1234567890-abc…apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-…
```

Then recreate only the API container so it picks the values up:

```bash
cd /opt/altvivo/altvivo-infra && docker compose up -d altvivo-core
```

`GoogleProvider` turns itself on only when both values are non-empty. While either is blank, the Google button's `/start` endpoint returns an error instead of redirecting.

## 7. Check it works

1. Open `https://altvivo.bio/login` in a private window → **Google**.
2. You should land on Google's account chooser showing "to continue to AltVivo", then come back signed in (or on the registration page for a new account).
3. If it fails, check `docker compose logs --tail=100 altvivo-core`.

| Error on Google's page | Cause | Fix |
|---|---|---|
| `Error 400: redirect_uri_mismatch` | URI in the client doesn't match `PUBLIC_API_URL` + `/v1/auth/oauth/google/callback` | Fix the URI in step 3. Changes take a few minutes to apply. |
| `Error 401: invalid_client` | Wrong or stale client ID/secret in `.env` | Re-copy the values, then recreate `altvivo-core` |
| "Access blocked … has not completed the verification process" | App still in **Testing** and the account is not a test user | Publish (step 4) or add the account as a test user |
| `Error 400: invalid_request` mentioning the domain | `altvivo.bio` not in Authorised domains | Add and verify it (step 2) |
| Back on AltVivo with an "expired" or state error | Took more than ~10 minutes, or the browser blocked the state cookie | Try again in one tab; check that `api.altvivo.bio` cookies are not blocked |

## Rotating the secret

Client page → **Add secret** → put the new secret in `.env` → `docker compose up -d altvivo-core` → once sign-in works, **Disable**, then **Delete** the old secret.
