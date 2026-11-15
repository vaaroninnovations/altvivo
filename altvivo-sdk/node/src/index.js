// @altvivo/sso - single sign-on for Node/Express spokes on *.altvivo.bio
//
//   import { createAltVivo } from "@altvivo/sso";
//   const altvivo = createAltVivo({ appId: "amaze" });          // reads ALTVIVO_* env
//   app.use(altvivo.authenticate());                             // sets req.altvivo
//   app.use("/api", altvivo.requireUser({ minLevel: "trial" })); // 401/403 JSON or redirect
//
// The access token (`altvivo_at`, RS256) is verified locally against the
// IdP's JWKS; revocations are read from Redis (`core:revoked:*`) when a
// client is supplied. Nothing here ever sees a password or refresh token.

import { createRemoteJWKSet, createLocalJWKSet, jwtVerify, errors as joseErrors } from "jose";

export const ACCESS_LEVELS = Object.freeze(["none", "waitlist", "trial", "basic", "pro", "full"]);

export function levelRank(level) {
  const i = ACCESS_LEVELS.indexOf(String(level ?? "none").toLowerCase());
  return i < 0 ? 0 : i;
}

export class TokenError extends Error {
  constructor(message, { expired = false } = {}) {
    super(message);
    this.name = "TokenError";
    this.expired = expired;
  }
}

/** Normalised view of the access-token claims. */
export function toClaims(p) {
  if (typeof p.sub !== "string" || typeof p.sid !== "string") throw new TokenError("token is missing sub/sid");
  const ents = p.entitlements && typeof p.entitlements === "object" ? p.entitlements : {};
  return Object.freeze({
    sub: p.sub,
    sid: p.sid,
    email: String(p.email ?? "").toLowerCase(),
    name: String(p.name ?? ""),
    role: String(p.role ?? "RESEARCHER"),
    orgId: p.org_id ?? null,
    tier: String(p.tier ?? "FREE"),
    entitlements: Object.freeze(Object.fromEntries(Object.entries(ents).map(([k, v]) => [k, String(v).toLowerCase()]))),
    creditsRemaining: Number(p.credits_remaining ?? 0),
    emailVerified: p.email_verified === true,
    mfa: p.mfa === true,
    iat: Number(p.iat),
    exp: Number(p.exp),
    jti: String(p.jti ?? ""),
    accessLevel(appId) {
      return this.entitlements[appId] ?? "none";
    },
    hasAccess(appId, minimum = "trial") {
      return levelRank(this.entitlements[appId]) >= levelRank(minimum);
    },
  });
}

/**
 * @param {{ jwksUrl?: string, jwks?: {keys: object[]}, issuer?: string, leewaySeconds?: number, cacheSeconds?: number }} opts
 */
export function createVerifier(opts = {}) {
  const issuer = opts.issuer ?? "https://api.altvivo.bio";
  const keySet = opts.jwks
    ? createLocalJWKSet(opts.jwks)
    : createRemoteJWKSet(new URL(opts.jwksUrl), {
        cacheMaxAge: (opts.cacheSeconds ?? 300) * 1000,
        cooldownDuration: 30_000, // unknown kid -> refetch at most every 30 s
        timeoutDuration: 3000,
      });
  return {
    async verify(token) {
      if (typeof token !== "string" || token.length === 0 || token.length > 8192) throw new TokenError("missing token");
      try {
        const { payload } = await jwtVerify(token, keySet, {
          issuer,
          algorithms: ["RS256"],
          clockTolerance: opts.leewaySeconds ?? 5,
          requiredClaims: ["sub", "sid", "exp", "iat"],
        });
        return toClaims(payload);
      } catch (err) {
        if (err instanceof TokenError) throw err;
        if (err instanceof joseErrors.JWTExpired) throw new TokenError("access token expired", { expired: true });
        throw new TokenError(err?.message ?? "invalid token");
      }
    },
  };
}

/**
 * Revocation reader. `redis` is any client with `mget(...keys)` (ioredis,
 * node-redis v4 via `{ mget: (...k) => client.mGet(k) }`, or a test double).
 */
export function createRevocationChecker({ redis, prefix = "core:", failOpen = true, logger = console } = {}) {
  return {
    async isRevoked(claims) {
      if (!redis) return false;
      try {
        const [sid, userBefore] = await redis.mget(`${prefix}revoked:sid:${claims.sid}`, `${prefix}revoked:user:${claims.sub}`);
        if (sid) return true;
        return userBefore != null && claims.iat < Number(userBefore);
      } catch (err) {
        logger.warn?.(`[altvivo] revocation check failed (${failOpen ? "allowing" : "denying"}): ${err?.message}`);
        return !failOpen;
      }
    },
  };
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    if (!(k in out)) {
      try {
        out[k] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        out[k] = part.slice(i + 1).trim();
      }
    }
  }
  return out;
}

function wantsHtmlNavigation(req) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (req.headers["x-requested-with"] === "XMLHttpRequest") return false;
  const mode = req.headers["sec-fetch-mode"];
  if (mode) return mode === "navigate";
  return String(req.headers.accept ?? "").includes("text/html");
}

const env = (k, d) => (process.env[k] && process.env[k] !== "" ? process.env[k] : d);

/**
 * One-stop factory. Options fall back to the ALTVIVO_* environment variables
 * provided by altvivo-infra/docker-compose.yml.
 */
export function createAltVivo(options = {}) {
  const cfg = {
    appId: options.appId ?? env("ALTVIVO_APP_ID"),
    jwksUrl: options.jwksUrl ?? env("ALTVIVO_JWKS_URL", "https://api.altvivo.bio/.well-known/jwks.json"),
    issuer: options.issuer ?? env("ALTVIVO_JWT_ISSUER", "https://api.altvivo.bio"),
    cookieName: options.cookieName ?? env("ALTVIVO_ACCESS_COOKIE", "altvivo_at"),
    loginUrl: options.loginUrl ?? env("ALTVIVO_LOGIN_URL", "https://altvivo.bio/login"),
    logoutUrl: options.logoutUrl ?? env("ALTVIVO_LOGOUT_URL", "https://altvivo.bio/logout"),
    bounceUrl: options.bounceUrl ?? env("ALTVIVO_REFRESH_BOUNCE_URL", "https://api.altvivo.bio/v1/auth/refresh/bounce"),
    refreshUrl: options.refreshUrl ?? env("ALTVIVO_REFRESH_URL", "https://api.altvivo.bio/v1/auth/refresh"),
    pricingUrl: options.pricingUrl ?? env("ALTVIVO_PRICING_URL", "https://altvivo.bio/pricing"),
    publicOrigin: (options.publicOrigin ?? env("ALTVIVO_PUBLIC_ORIGIN", "")).replace(/\/$/, ""),
    redis: options.redis ?? null,
    redisPrefix: options.redisPrefix ?? env("ALTVIVO_REDIS_KEY_PREFIX", "core:"),
    logger: options.logger ?? console,
  };
  if (!cfg.appId) throw new Error("@altvivo/sso: appId (or ALTVIVO_APP_ID) is required");
  if (!/^[a-z][a-z0-9]{1,31}$/.test(cfg.appId)) throw new Error("@altvivo/sso: invalid appId");
  if (!cfg.publicOrigin) throw new Error("@altvivo/sso: publicOrigin (or ALTVIVO_PUBLIC_ORIGIN) is required");

  const verifier = options.verifier ?? createVerifier({ jwksUrl: cfg.jwksUrl, jwks: options.jwks, issuer: cfg.issuer });
  const revocation = createRevocationChecker({ redis: cfg.redis, prefix: cfg.redisPrefix, logger: cfg.logger });

  const selfUrl = (req) => `${cfg.publicOrigin}${req.originalUrl ?? req.url ?? "/"}`;
  const loginRedirect = (req, next) => `${cfg.loginUrl}?${new URLSearchParams({ next: next ?? selfUrl(req) })}`;
  const bounceRedirect = (req) => `${cfg.bounceUrl}?${new URLSearchParams({ next: selfUrl(req) })}`;
  const centralLogout = (next = `${cfg.publicOrigin}/`) => `${cfg.logoutUrl}?${new URLSearchParams({ next })}`;

  /** Populates req.altvivo = { claims, expired, reason } on every request. Never rejects. */
  function authenticate() {
    return async function altvivoAuthenticate(req, _res, next) {
      const state = { claims: null, expired: false, reason: "no_token" };
      req.altvivo = state;
      try {
        const cookies = req.cookies ?? parseCookies(req.headers.cookie);
        const token = cookies[cfg.cookieName];
        if (token) {
          try {
            const claims = await verifier.verify(token);
            if (await revocation.isRevoked(claims)) {
              state.reason = "revoked";
            } else {
              state.claims = claims;
              state.reason = null;
            }
          } catch (err) {
            state.expired = err instanceof TokenError && err.expired;
            state.reason = state.expired ? "expired" : "invalid";
          }
        }
      } catch (err) {
        cfg.logger.error?.(`[altvivo] authentication error: ${err?.message}`);
        state.reason = "error";
      }
      next();
    };
  }

  /**
   * Gate: 401 (API) / redirect (page loads) without a session; 403 when the
   * plan does not include this app at `minLevel`.
   */
  function requireUser({ minLevel = "trial" } = {}) {
    return function altvivoRequireUser(req, res, next) {
      const s = req.altvivo;
      if (!s) return next(new Error("@altvivo/sso: authenticate() must run before requireUser()"));
      if (!s.claims) {
        if (wantsHtmlNavigation(req)) return res.redirect(303, s.expired ? bounceRedirect(req) : loginRedirect(req));
        return res.status(401).json({
          error: s.expired ? "session_expired" : "unauthenticated",
          refreshUrl: cfg.refreshUrl,
          loginUrl: loginRedirect(req, `${cfg.publicOrigin}/`),
        });
      }
      if (!s.claims.hasAccess(cfg.appId, minLevel)) {
        const pricingUrl = `${cfg.pricingUrl}?${new URLSearchParams({ app: cfg.appId })}`;
        const reason = s.claims.emailVerified ? "not_entitled" : "email_not_verified";
        if (wantsHtmlNavigation(req)) return res.redirect(303, pricingUrl);
        return res.status(403).json({ error: reason, accessLevel: s.claims.accessLevel(cfg.appId), pricingUrl });
      }
      return next();
    };
  }

  return Object.freeze({
    config: Object.freeze({ ...cfg, redis: undefined }),
    verifier,
    authenticate,
    requireUser,
    loginRedirect,
    bounceRedirect,
    centralLogout,
  });
}

// ------------------------------------------------------------------------
// Server-to-server client for altvivo-core's internal API
// ------------------------------------------------------------------------

export class CoreError extends Error {
  constructor(status, code, message) {
    super(`${status} ${code}: ${message}`);
    this.name = "CoreError";
    this.status = status;
    this.code = code;
  }
}

export function createCoreClient({
  baseUrl = env("ALTVIVO_CORE_INTERNAL_URL", "http://altvivo-core:4000"),
  serviceToken = env("ALTVIVO_SERVICE_TOKEN"),
  timeoutMs = 10_000,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!serviceToken) throw new Error("@altvivo/sso: ALTVIVO_SERVICE_TOKEN is required for the core client");
  const base = baseUrl.replace(/\/$/, "");

  async function call(method, path, body) {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${serviceToken}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new CoreError(res.status, data?.error?.code ?? "HTTP_ERROR", data?.error?.message ?? res.statusText);
    return data;
  }

  return Object.freeze({
    entitlements: (userId) => call("GET", `/v1/internal/users/${encodeURIComponent(userId)}/entitlements`),
    debitCredits: (userId, amount, actionType, referenceId) =>
      call("POST", "/v1/internal/credits/debit", { userId, amount, actionType, referenceId }),
    refundCredits: (userId, amount, referenceId) => call("POST", "/v1/internal/credits/refund", { userId, amount, referenceId }),
    audit: (userId, eventType, { resourceId = null, metadata = {}, actorIp = null, userAgent = null } = {}) =>
      call("POST", "/v1/internal/audit", { userId, eventType, resourceId, metadata, actorIp, userAgent }),
    vaultUploadUrl: (userId, { fileName, fileType, sizeBytes, sha256 }) =>
      call("POST", "/v1/internal/vault/upload-url", { userId, fileName, fileType, sizeBytes, sha256 }),
    vaultComplete: (objectKey) => call("POST", "/v1/internal/vault/complete", { objectKey }),
    vaultDownloadUrl: (fileId, userId) =>
      call("GET", `/v1/internal/vault/files/${encodeURIComponent(fileId)}/download-url?${new URLSearchParams({ userId })}`),
  });
}
