import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { createAltVivo, createCoreClient, createVerifier, levelRank } from "../src/index.js";

const ISS = "https://api.altvivo.bio";
const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
const other = await generateKeyPair("RS256");

async function token(over = {}, key = privateKey, kid = "k1") {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: "usr-1", sid: "sid-1", email: "Researcher@Institute.edu.in", name: "Dr. Researcher", org_id: null, role: "PI",
    tier: "INSTITUTIONAL_PRO", entitlements: { amaze: "pro", xprism: "full" }, credits_remaining: 1250, email_verified: true,
    mfa: false, iat: now, exp: now + 900, jti: "j1", ...over,
  };
  return new SignJWT(payload).setProtectedHeader({ alg: "RS256", kid }).setIssuer(over.iss ?? ISS).sign(key);
}

// Minimal Express-like harness: req/res with redirect/status/json.
function run(mws, { cookie, accept = "application/json", mode, url = "/api/projects" } = {}) {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", url, originalUrl: url, headers: { cookie, accept, ...(mode ? { "sec-fetch-mode": mode } : {}) } };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b, req }); },
      redirect(c, l) { resolve({ status: c, location: l, req }); },
    };
    let i = 0;
    const next = (err) => {
      if (err) return reject(err);
      const mw = mws[i++];
      if (!mw) return resolve({ status: 200, req });
      Promise.resolve(mw(req, res, next)).catch(reject);
    };
    next();
  });
}

const redisStore = new Map();
const fakeRedis = { async mget(...keys) { return keys.map((k) => redisStore.get(k) ?? null); } };
const av = createAltVivo({ appId: "amaze", jwks: { keys: [jwk] }, publicOrigin: "https://amaze.altvivo.bio", redis: fakeRedis, logger: { warn() {}, error() {} } });
const chain = (min) => [av.authenticate(), av.requireUser({ minLevel: min })];

test("valid token passes and exposes normalised claims", async () => {
  const r = await run(chain("trial"), { cookie: `other=1; altvivo_at=${await token()}` });
  assert.equal(r.status, 200);
  const c = r.req.altvivo.claims;
  assert.equal(c.email, "researcher@institute.edu.in");
  assert.equal(c.accessLevel("amaze"), "pro");
  assert.equal(c.creditsRemaining, 1250);
  assert.ok(c.hasAccess("amaze", "basic"));
  assert.ok(!c.hasAccess("amaze", "full"));
});

test("missing token: 401 for API, redirect to login for page loads", async () => {
  const api = await run(chain());
  assert.equal(api.status, 401);
  assert.equal(api.body.error, "unauthenticated");
  const page = await run(chain(), { accept: "text/html", mode: "navigate", url: "/dashboard?x=1" });
  assert.equal(page.status, 303);
  assert.equal(page.location, "https://altvivo.bio/login?next=https%3A%2F%2Famaze.altvivo.bio%2Fdashboard%3Fx%3D1");
});

test("expired token: refresh hint for API, bounce for page loads", async () => {
  const now = Math.floor(Date.now() / 1000);
  const expired = await token({ iat: now - 2000, exp: now - 100 });
  const api = await run(chain(), { cookie: `altvivo_at=${expired}` });
  assert.deepEqual([api.status, api.body.error], [401, "session_expired"]);
  const page = await run(chain(), { cookie: `altvivo_at=${expired}`, accept: "text/html", mode: "navigate", url: "/track" });
  assert.equal(page.location, "https://api.altvivo.bio/v1/auth/refresh/bounce?next=https%3A%2F%2Famaze.altvivo.bio%2Ftrack");
});

test("forged, foreign-issuer and HS256 tokens are rejected", async () => {
  const forged = await token({}, other.privateKey);
  const foreign = await token({ iss: "https://evil.example" });
  const hs = await new SignJWT({ sub: "x", sid: "y" }).setProtectedHeader({ alg: "HS256", kid: "k1" }).setIssuer(ISS).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode("secret-secret-secret-secret-1234"));
  for (const t of [forged, foreign, hs, "garbage"]) {
    const r = await run(chain(), { cookie: `altvivo_at=${t}` });
    assert.equal(r.status, 401, t.slice(0, 16));
    assert.equal(r.req.altvivo.reason, "invalid");
  }
});

test("revocation by session and by user", async () => {
  const t = await token({ sid: "sid-revoked" });
  redisStore.set("core:revoked:sid:sid-revoked", "1");
  assert.equal((await run(chain(), { cookie: `altvivo_at=${t}` })).req.altvivo.reason, "revoked");
  const now = Math.floor(Date.now() / 1000);
  const old = await token({ sub: "usr-9", sid: "s9", iat: now - 30 });
  redisStore.set("core:revoked:user:usr-9", String(now - 10));
  assert.equal((await run(chain(), { cookie: `altvivo_at=${old}` })).status, 401);
});

test("entitlement gate returns 403 with pricing link", async () => {
  const r = await run(chain("trial"), { cookie: `altvivo_at=${await token({ entitlements: { amaze: "waitlist" } })}` });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "not_entitled");
  assert.equal(r.body.pricingUrl, "https://altvivo.bio/pricing?app=amaze");
  const unverified = await run(chain("trial"), { cookie: `altvivo_at=${await token({ email_verified: false, entitlements: {} })}` });
  assert.equal(unverified.body.error, "email_not_verified");
});

test("remote JWKS verifier fetches keys over HTTP", async () => {
  const srv = http.createServer((_q, s) => { s.setHeader("content-type", "application/json"); s.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const v = createVerifier({ jwksUrl: `http://127.0.0.1:${srv.address().port}/.well-known/jwks.json` });
    assert.equal((await v.verify(await token())).sub, "usr-1");
  } finally {
    srv.close();
  }
});

test("core client sends the service token and maps errors", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/debit")) return new Response(JSON.stringify({ error: { code: "INSUFFICIENT_CREDITS", message: "no" } }), { status: 402 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const core = createCoreClient({ baseUrl: "http://core:4000/", serviceToken: "t".repeat(40), fetchImpl });
  await core.audit("usr-1", "AMAZE.TRIAL_EXPORTED", { resourceId: "trial-1" });
  assert.equal(calls[0].url, "http://core:4000/v1/internal/audit");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${"t".repeat(40)}`);
  await assert.rejects(core.debitCredits("usr-1", 5, "TRACKING_JOB", "job-1"), (e) => e.status === 402 && e.code === "INSUFFICIENT_CREDITS");
});

test("level ordering", () => {
  assert.ok(levelRank("full") > levelRank("pro") && levelRank("trial") > levelRank("waitlist") && levelRank("bogus") === 0);
});
