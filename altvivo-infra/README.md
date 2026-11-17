# altvivo-infra — Module 1: Infrastructure, Network & Hardening

Production edge, data tier and host hardening for **altvivo.bio** on a single Ubuntu VPS.

```
                    Cloudflare DNS (optionally proxied)
                                 │
          ┌──────────── host: ufw + DOCKER-USER guard (80/443 only) ────────────┐
          │  caddy  (TLS 1.3, wildcard cert via DNS-01, HTTP/3, headers, edge RL) │
          │    │ altvivo_net (bridge)                                            │
          │    ├─ altvivo.bio ............ altvivo-web:3000                       │
          │    ├─ api.altvivo.bio ........ altvivo-core:4000                      │
          │    ├─ embed.altvivo.bio ...... /srv/embed/bar.js (static)             │
          │    ├─ xprism.altvivo.bio ..... [paid gate] → xprism:8000   LIVE       │
          │    ├─ amaze.altvivo.bio ...... [paid gate] → amaze:8080    LIVE       │
          │    └─ pharmadme|stat|phytonet|mira.altvivo.bio → altvivo-web /coming-soon │
          │  altvivo_data (internal: true, 172.30.10.0/24)                         │
          │    ├─ postgres:16  (db_core, xprism, … one DB per spoke with a server) │
          │    └─ redis:7      (ACL user per service, key-prefix isolation)        │
          └───────────────────────────────────────────────────────────────────────┘
```

## Layout

| Path | Purpose |
|---|---|
| `docker-compose.yml` | Whole stack; Phase-2 spokes are commented plug-in blocks |
| `caddy/Dockerfile` | Caddy + `caddy-dns/cloudflare`, `caddy-ratelimit`, `caddy-cloudflare-ip`; runs as uid 10001 |
| `caddy/Caddyfile` | Global TLS/headers/routing, maintenance fallback for down spokes |
| `caddy/spokes-enabled/*.caddy` | Active spoke upstreams (xprism, amaze), each behind the `paid_gate` `forward_auth` |
| `caddy/spokes-available/*.caddy` | Route templates for every app (copied in by `spoke-route.sh`) |
| `caddy/coming-soon.caddy` | Holding route for Phase-2 hosts |
| `postgres/pg_hba.conf` | Network auth: per-role, data subnet only, superuser TCP rejected |
| `postgres/initdb/init-multi-db.sh` | First-boot roles, databases, default privileges, extensions |
| `redis/redis.conf` | AOF persistence, `noeviction`, ACL file |
| `scripts/generate-secrets.sh` | `.env` from template, RS256 key pair + `kid`, Redis ACL (SHA-256 hashed), JWT rotation |
| `scripts/ufw-setup.sh` | ufw + Docker `DOCKER-USER` guard, optional Cloudflare-only origin |
| `scripts/backup.sh` / `restore.sh` | age-encrypted Postgres + Redis backups to R2 via rclone |
| `scripts/provision-spoke-db.sh` | DB + role for a spoke launched after first boot |
| `scripts/spoke-route.sh` | Enable/disable a spoke's public route with validate-then-reload + rollback |
| `systemd/altvivo-backup.{service,timer}` | Nightly backup at 02:30 IST |
| `host/docker-daemon.json`, `host/99-altvivo-sysctl.conf` | Docker daemon and kernel hardening |
| `embed/` | `<altvivo-topbar>` source, build script and demo; `embed/dist/` is served at `embed.altvivo.bio` |
| `spokes/XPRISM/0001-altvivo-paid-sso.patch` | XPRISM: `Dockerfile`, `lab/altvivo_sso_middleware.py`, Django 5.2 LTS |
| `spokes/aMaze/0001-altvivo-paid-sso.patch` | aMaze: `Dockerfile`, container `nginx.conf`, SSO client; retires its Express server |
| `CONTRACTS.md` | Interfaces Modules 2–5 must implement (JWT claims, `/v1/auth/verify`, redirects) |

Expected directory layout on the server:

```
/opt/altvivo/
├── altvivo-infra/      (this repo)
├── altvivo-core/       (Modules 2–3)
├── altvivo-web/        (Modules 4–5)
├── XPRISM/             (git clone of vaaroninnovations/XPRISM + spokes/XPRISM patch)
└── aMaze/              (git clone of vaaroninnovations/aMaze + spokes/aMaze patch)
```

## First deployment

0. **Copy to the server** at `/opt/altvivo/altvivo-infra` (git or `scp`). Files are LF-only (`.gitattributes`). Windows doesn't keep the executable bit, so restore it:
   ```bash
   chmod +x scripts/*.sh postgres/initdb/*.sh
   ```
1. **Host prerequisites** (Ubuntu 22.04/24.04):
   ```bash
   sudo apt-get update && sudo apt-get install -y ufw age rclone curl openssl
   ```
   Install Docker Engine + Compose plugin from Docker's apt repo, then:
   ```bash
   sudo cp host/docker-daemon.json /etc/docker/daemon.json && sudo systemctl restart docker
   ```
   ```bash
   sudo cp host/99-altvivo-sysctl.conf /etc/sysctl.d/ && sudo sysctl --system
   ```
2. **Firewall** — keeps your SSH session open (rule added before enabling):
   ```bash
   sudo ./scripts/ufw-setup.sh
   ```
   If the zone is proxied through Cloudflare, lock the origin to Cloudflare edges instead:
   ```bash
   sudo CLOUDFLARE_ONLY=1 ./scripts/ufw-setup.sh
   ```
3. **Secrets**:
   ```bash
   sudo ./scripts/generate-secrets.sh
   ```
   Then fill the blank third-party values in `.env` (Cloudflare token, Turnstile, Stripe, Razorpay, R2, SMTP, OAuth) and put your **age public key** in `secrets/backup/age_recipients.txt`.
4. **Spokes**: clone both apps next to this folder, then apply the integration patches:
   ```bash
   cd /opt/altvivo && git clone https://github.com/vaaroninnovations/XPRISM.git && git clone https://github.com/vaaroninnovations/aMaze.git
   ```
   ```bash
   git -C /opt/altvivo/XPRISM am /opt/altvivo/altvivo-infra/spokes/XPRISM/0001-altvivo-paid-sso.patch
   ```
   ```bash
   git -C /opt/altvivo/aMaze am /opt/altvivo/altvivo-infra/spokes/aMaze/0001-altvivo-paid-sso.patch
   ```
   Build the top bar:
   ```bash
   node embed/build.mjs
   ```
5. **DNS (Cloudflare)**: `A altvivo.bio`, `A *.altvivo.bio` → VPS IP. If proxied, SSL/TLS mode **Full (strict)**, minimum TLS 1.2 at the edge, "Always Use HTTPS" on.
6. **Bring-up**. Before Modules 2–5 exist you can bring up just the data tier and check the edge config:
   ```bash
   docker compose up -d postgres redis
   ```
   ```bash
   docker compose build caddy && docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
   ```
   Once all modules are in place:
   ```bash
   docker compose up -d --build
   ```
7. **Backups**:
   ```bash
   sudo rclone config
   ```
   (create an S3/R2 remote, set `BACKUP_RCLONE_REMOTE` in `.env`), then
   ```bash
   sudo cp systemd/altvivo-backup.* /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now altvivo-backup.timer
   ```
   Run one immediately and test a restore on a staging box:
   ```bash
   sudo ./scripts/backup.sh
   ```

## Shared VPS (AltVivo next to other websites)

When the same server also hosts other websites, neither stack can own ports 80/443. A small pass-through router does instead ([`edge-router/haproxy.cfg`](edge-router/haproxy.cfg)). It reads only the requested domain name and forwards the still-encrypted connection, so AltVivo and the other websites stay completely separate: each keeps its own containers, certificates and config.

```
internet :443 / :80
      │
  HAProxy (host service, owns 80/443, holds no certificates)
      ├─ altvivo.bio, *.altvivo.bio ── TLS + PROXY v2 ──> 127.0.0.1:8443  AltVivo Caddy
      ├─ any other domain (443) ───── TLS pass-through ─> 127.0.0.1:9443  other websites
      └─ any other domain (80) ────── HTTP ────────────> 127.0.0.1:9080  other websites
         (altvivo.bio on port 80 is redirected to https by HAProxy itself)
```

1. **AltVivo**: in `.env`, switch to router mode, then restart Caddy:
   ```
   CADDY_EDGE_MODE=router
   CADDY_PUBLISH_HTTP=127.0.0.1:8080
   CADDY_PUBLISH_HTTPS=127.0.0.1:8443
   ```
   ```bash
   docker compose up -d caddy
   ```
   Caddy now listens on loopback only, reads the visitor's real IP from the PROXY header ([`caddy/edge/router.caddy`](caddy/edge/router.caddy)), and serves HTTP/1.1 + HTTP/2 (HTTP/3 needs UDP 443, which the router does not forward).
2. **Other websites**: move their web server off the public ports to `127.0.0.1:9443` (HTTPS) and `127.0.0.1:9080` (HTTP). They keep issuing their own certificates: Let's Encrypt HTTP-01 challenges reach them through port 80. For Docker-based sites, publish as `"127.0.0.1:9443:443"` and `"127.0.0.1:9080:80"`. They see `127.0.0.1` as the client unless you enable the PROXY protocol for them (comment in `haproxy.cfg`); on port 80 they get `X-Forwarded-For`.
3. **Router**:
   ```bash
   sudo apt-get install -y haproxy
   ```
   ```bash
   sudo cp edge-router/haproxy.cfg /etc/haproxy/haproxy.cfg && sudo haproxy -c -f /etc/haproxy/haproxy.cfg
   ```
   ```bash
   sudo systemctl enable --now haproxy && sudo systemctl reload haproxy
   ```
   If your AltVivo domain is not `altvivo.bio`, change the four `altvivo.bio` matches in `haproxy.cfg`.

Also on a shared server:
- **Don't copy `host/docker-daemon.json`** over an existing Docker configuration: it changes behaviour for every container on the host (`icc`, `no-new-privileges`, address pools). The AltVivo containers set their own hardening, so it is optional. Merge only the log settings if you want them.
- **`scripts/ufw-setup.sh`** allows only SSH, 80 and 443, and drops any other port a container publishes on the public interface. Add rules afterwards for any other public ports the other websites need (mail, FTP, a control panel). Don't use `CLOUDFLARE_ONLY=1` unless every domain on the server is proxied through Cloudflare.
- **Docker subnets**: AltVivo uses `172.30.0.0/24` (`APP_SUBNET`) and `172.30.10.0/24`. Make sure no existing Docker network uses them.
- **Memory**: the AltVivo containers can use up to about 6.7 GB at their limits; size the VPS for both stacks.
- **Backups**: `scripts/backup.sh` covers AltVivo only.

## Security controls in this module

- **Exposure**: only `caddy` publishes ports. Postgres/Redis are on an `internal: true` network with no route in or out. Docker's DNAT bypasses ufw's INPUT chain, so `ufw-setup.sh` also filters the `DOCKER-USER` chain: any newly published port other than 80/443 is dropped at the host.
- **TLS**: TLS 1.3 only, wildcard + apex certificate via Cloudflare DNS-01, HSTS with `preload` and `includeSubDomains` (submit to hstspreload.org after a week of stable HTTPS).
- **Headers**: HSTS, nosniff, Referrer-Policy, Permissions-Policy and COOP on every response. `X-Frame-Options: SAMEORIGIN` on portal/spokes, `DENY` on API/embed. CSP is strict on API/embed. For portal and spokes Caddy applies the policy from `.env` *when the app doesn't send its own* (`?Content-Security-Policy`), so Module 5's nonce CSP from Next.js middleware and Django's `django-csp` take precedence.
- **Header spoofing**: inbound `X-AltVivo-*`, `X-Internal-*`, `X-Real-IP` are stripped. `X-Real-IP` is set from the trusted client IP (Cloudflare ranges only).
- **Paid-access gate (layer 1)**: every request to `xprism.altvivo.bio` and `amaze.altvivo.bio` (pages and static assets) first goes to `altvivo-core /v1/auth/verify?app=<id>` via `forward_auth`. Unauthenticated → `altvivo.bio/login?redirect=…`; expired → refresh bounce; unpaid → `altvivo.bio/workspace/upgrade?app=<id>&reason=subscription_required`; `SUPERADMIN` and `ADVISORY_BOARD` bypass billing. Only XPRISM's Resend webhook skips the gate. XPRISM re-verifies the JWT itself (layer 2). See `CONTRACTS.md`.
- **Internal endpoints** (`/internal/*`, `/v1/internal/*`, `/metrics`) return 404 at the edge on every host. Spokes reach core directly at `http://altvivo-core:4000`.
- **Rate limits**: an edge backstop per IP (30/min `/v1/auth/*`, 600/min API). The spec's authoritative limits (5/min/IP auth, 120/min/user API) are enforced in `altvivo-core` with Redis in Module 3.
- **Containers**: non-root users, `read_only` root FS, `cap_drop: ALL`, `no-new-privileges`, bounded tmpfs, CPU/memory limits, log rotation. Caddy binds 80/443 as uid 10001 through the namespaced `ip_unprivileged_port_start` sysctl, not file capabilities.
- **Postgres**: SCRAM-SHA-256, `pg_hba` per role and data subnet only, superuser over TCP rejected, data checksums. `core_app` has DML only through default privileges; Module 2 revokes `UPDATE/DELETE/TRUNCATE` on `audit_logs`. Each spoke is confined to its own database (`sameuser`).
- **Redis**: `default` user disabled. Each service gets its own ACL user with a hashed password, restricted to `<service>:*` keys and no `@dangerous` commands. Spokes get **read-only** access to `core:revoked:*` (instant logout) and `core:registry:*`. `noeviction` means security state is never silently dropped.
- **Backups**: encrypted to an age public key whose private half stays offline. Includes SHA-256 manifest, `pg_restore --list` verification, remote checksum check, retention, a dead-man's-switch ping and the audit-chain head for tamper-evident restores.

## Launching a Phase-2 spoke (e.g. PharmADME)

```bash
sudo ./scripts/generate-secrets.sh --spoke pharmadme
```
```bash
./scripts/provision-spoke-db.sh pharmadme
```
```bash
docker compose restart redis
```
Then append `,pharmadme:${PHARMADME_SERVICE_TOKEN}` to `SPOKE_SERVICE_TOKENS` on `altvivo-core`, uncomment the `pharmadme` block in `docker-compose.yml`, and run:
```bash
docker compose up -d altvivo-core pharmadme
```
```bash
./scripts/spoke-route.sh enable pharmadme
```
Finally flip `app_registry.status` to `BETA`/`LIVE` in `/workspace/admin/apps`. Until the route is enabled, visitors keep seeing the Launching Soon page. If a spoke container goes down later, Caddy serves `/coming-soon?app=<id>&state=maintenance` instead of a 502.

## JWT key rotation

```bash
sudo ./scripts/generate-secrets.sh --rotate-jwt && docker compose up -d --force-recreate altvivo-core
```
The previous public key stays in JWKS (`previous_public.pem`), so tokens issued before rotation keep verifying until they expire (15 min).

## Contracts for later modules

See [`CONTRACTS.md`](CONTRACTS.md): access-token claims with paid entitlements, the `/v1/auth/verify` responses Caddy relies on, `/v1/auth/app-token`, `/v1/public/contact`, and the portal pages the spokes redirect to.

| Item | Value |
|---|---|
| Container uid/gid | `10001:10001` (core, web, XPRISM), `101:101` (aMaze nginx) |
| Core listen / health | `:4000`, `GET /healthz`; migrations `node db/scripts/deploy.mjs` |
| Web listen / health | `:3000`, `GET /api/health` |
| XPRISM | `:8000`, `GET /healthz`; migrations + `createcachetable` + `bootstrap_lab` (experiment catalogue) in `xprism-migrate` |
| aMaze | `:8080`, `GET /healthz` (nginx) |
| JWT keys | `/run/secrets/jwt_private_key`, `jwt_public_key`, `jwt_previous_public_key`; `JWT_KID` |
| Redis key prefixes | `core:*`, `xprism:*`; revocations at `core:revoked:*` |
