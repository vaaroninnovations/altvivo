# ORCID sign-in: ORCID developer tools setup

AltVivo's "ORCID" button is a server-side OpenID Connect flow run by `altvivo-core` (`altvivo-core/src/services/oauth.ts`). It asks only for the `openid` scope and verifies the returned `id_token` against ORCID's JWKS. The free **Public API** is all it needs. Membership and the Member API are not required. As with Google, ORCID only talks to the API host, so the spokes need no ORCID client of their own.

| Value | Production | Sandbox (testing) |
|---|---|---|
| Register at | <https://orcid.org/developer-tools> | <https://sandbox.orcid.org/developer-tools> |
| Redirect URI | `https://api.altvivo.bio/v1/auth/oauth/orcid/callback` | your test API's `…/v1/auth/oauth/orcid/callback` |
| Scope | `openid` | `openid` |
| `ORCID_BASE_URL` | `https://orcid.org` (default) | `https://sandbox.orcid.org` |
| Env vars | `ORCID_CLIENT_ID`, `ORCID_CLIENT_SECRET` | same names, sandbox values |

The redirect URI is `${PUBLIC_API_URL}/v1/auth/oauth/orcid/callback`, built in `altvivo-core/src/routes/oauth.ts`.

**What ORCID gives AltVivo:** the researcher's ORCID iD (`sub`, e.g. `0000-0002-1825-0097`) and their given and family names. It never gives an email. A first-time ORCID user is therefore sent on to the registration page, pre-filled with their name and iD, to enter and confirm an email address before an account exists. That step is deliberate, because it prevents pre-account takeover.

---

## 1. Prepare the ORCID account

The credentials belong to the ORCID record you register them under, and each record can hold **one** Public API client. Use an iD controlled by the organisation (for example a shared admin record), not a researcher's personal one, so access survives staff changes.

1. Sign in at <https://orcid.org/signin> (create a record if needed).
2. Make sure the record's primary email is **verified**. Developer tools stay locked until it is.

## 2. Register the Public API client

1. Click your name (top right) → **Developer tools**, or open <https://orcid.org/developer-tools>.
2. Read and accept the **ORCID Public API terms of service** → **Register for the free ORCID public API**.
3. Fill in the application form:
   - **Application name**: `AltVivo`. Researchers see this on ORCID's authorisation screen.
   - **Application URL**: `https://altvivo.bio`
   - **Application description**: a short line shown to users, e.g. *"Sign in to AltVivo, a suite of research tools for alternative-to-animal methods, with your ORCID iD."*
   - **Redirect URIs**: add exactly
     ```
     https://api.altvivo.bio/v1/auth/oauth/orcid/callback
     ```
     Use `https`, with no trailing slash.
4. **Save application**.
5. The page now shows the **Client ID** (`APP-XXXXXXXXXXXXXXXX`) and the **Client secret** (a UUID). You can see the secret again on this page later, but store both in your password manager now.

ORCID applies the change straight away. There is no review or publishing step, unlike Google.

## 3. (Optional) Sandbox credentials for testing

The sandbox is a separate copy of ORCID with its own records and credentials. Production client IDs do not work there, and sandbox ones do not work in production.

1. Create a record at <https://sandbox.orcid.org/register>. The sandbox only sends email to **`@mailinator.com`** addresses, so register with one (e.g. `altvivo-dev@mailinator.com`) and verify it at <https://www.mailinator.com>.
2. Repeat step 2 at <https://sandbox.orcid.org/developer-tools> with your test API's callback URI. If ORCID refuses a plain-`http` localhost URI, use an HTTPS tunnel or a staging host instead.
3. In that environment's `.env`, set `ORCID_BASE_URL=https://sandbox.orcid.org` along with the sandbox client ID and secret.

## 4. Put the credentials on the server

On the production VPS:

```bash
nano /opt/altvivo/altvivo-infra/.env
```

```dotenv
ORCID_CLIENT_ID=APP-XXXXXXXXXXXXXXXX
ORCID_CLIENT_SECRET=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
ORCID_BASE_URL=https://orcid.org
```

Recreate only the API container:

```bash
cd /opt/altvivo/altvivo-infra && docker compose up -d altvivo-core
```

`OrcidProvider` turns itself on only when both the ID and the secret are set. `ORCID_BASE_URL` must match the place the credentials came from: production credentials with a sandbox base URL (or the other way round) fail with `invalid_client`.

## 5. Check it works

1. Open `https://altvivo.bio/login` in a private window → **ORCID**.
2. You should reach ORCID's sign-in page, then an authorisation screen saying **AltVivo** wants to "get your ORCID iD" → **Authorize access**.
3. A new iD lands on AltVivo's registration page with name and iD pre-filled and asks for an email. An iD already linked to an account signs straight in.
4. The linked iD then shows under **Workspace → Security**. There is currently no button there to link ORCID to an account created another way: an iD is linked when the account is created through ORCID.
5. If it fails, check `docker compose logs --tail=100 altvivo-core`.

| What you see | Cause | Fix |
|---|---|---|
| ORCID error page: *redirect URI doesn't match* / `invalid_grant` on callback | Registered URI differs from `PUBLIC_API_URL` + `/v1/auth/oauth/orcid/callback` | Fix the URI in Developer tools (step 2) |
| `invalid_client` in the core logs | Wrong ID or secret, or sandbox and production mixed up | Re-copy the values; check `ORCID_BASE_URL` |
| "ORCID id_token …" error in the logs | Token issuer or audience mismatch, again usually a sandbox/production mix-up | Same as above |
| Developer tools page has no register button | Primary email not verified, or the record already has a Public API client | Verify the email, or edit the existing client |
| Back on AltVivo with an "expired" error | Took more than ~10 minutes, or the state cookie was blocked | Try again in a single tab |

## Rotating the secret

In **Developer tools**, click **Reset client secret**. The old secret **stops working immediately**, so update `.env` and run `docker compose up -d altvivo-core` straight afterwards. ORCID sign-in fails for the minute in between. Do it at a quiet time.

## Going further (not needed for sign-in)

Reading anything beyond the iD and name (works, affiliations) or writing to records needs other scopes, such as `/read-limited` or `/activities/update`, and an ORCID **membership** for the Member API. AltVivo does not use them today.
