import { createHash, createPublicKey, randomUUID } from 'node:crypto';
import { SignJWT, decodeJwt, decodeProtectedHeader, exportJWK, importPKCS8, importSPKI, jwtVerify, type JWK, type JWTPayload } from 'jose';
import type { UserRole } from '@prisma/client';
import type { Config } from '../config.js';

export type EntitlementSource = 'trial' | 'payg' | 'individual' | 'bundle' | 'institution' | 'manual' | 'vip';

/**
 * Access to one app - paid, or the one-month free access (`source: 'trial'`)
 * (altvivo-infra/CONTRACTS.md section 1). Spokes and
 * /v1/auth/verify allow access only when `active === true` and `expires_at`
 * is null or in the future.
 */
export interface EntitlementClaim {
  active: boolean;
  level: 'full' | 'none';
  source: EntitlementSource | null;
  plan: string | null;
  /** Epoch seconds; null = open-ended (VIP). */
  expires_at: number | null;
}

export type AccessTier = 'NONE' | 'TRIAL' | 'INDIVIDUAL' | 'BUNDLE' | 'INSTITUTIONAL' | 'VIP';

/** Claims the IdP computes for a session (spec section 3.1 plus session binding). */
export interface SessionClaims {
  sub: string;
  email: string;
  name: string;
  org_id: string | null;
  role: UserRole;
  tier: AccessTier;
  entitlements: Record<string, EntitlementClaim>;
  credits_remaining: number;
  email_verified: boolean;
  /** Session (refresh-token family) id - revocation handle for spokes. */
  sid: string;
  /** True when this session passed TOTP (or the role does not require it). */
  mfa: boolean;
  /** Present when the role mandates MFA and the user has not enrolled yet. */
  mfa_enrollment_required?: boolean;
}

/** Access-token payload as signed. */
export interface AccessClaims extends SessionClaims {
  iat: number;
  /** Mint time in milliseconds (claims-staleness checks need sub-second precision). */
  iat_ms?: number;
  exp: number;
  iss: string;
  jti: string;
}

type KeyLike = Awaited<ReturnType<typeof importSPKI>>;

export function keyId(publicPem: string): string {
  const der = createPublicKey(publicPem).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex').slice(0, 32);
}

export class TokenService {
  private constructor(
    private readonly issuer: string,
    private readonly ttl: number,
    private readonly signingKey: Awaited<ReturnType<typeof importPKCS8>>,
    readonly currentKid: string,
    private readonly verifyKeys: Map<string, KeyLike>,
    private readonly jwks: { keys: JWK[] },
  ) {}

  static async create(cfg: Config): Promise<TokenService> {
    const currentKid = keyId(cfg.jwtPublicKeyPem);
    if (cfg.JWT_KID && cfg.JWT_KID !== currentKid) {
      throw new Error(`JWT_KID (${cfg.JWT_KID}) does not match the public key (${currentKid})`);
    }
    const signingKey = await importPKCS8(cfg.jwtPrivateKeyPem, 'RS256');
    const verifyKeys = new Map<string, KeyLike>();
    const jwk: JWK[] = [];
    const pems = [cfg.jwtPublicKeyPem, cfg.jwtPreviousPublicKeyPem].filter((p): p is string => !!p);
    for (const pem of pems) {
      const kid = keyId(pem);
      if (verifyKeys.has(kid)) continue;
      const key = await importSPKI(pem, 'RS256', { extractable: true });
      verifyKeys.set(kid, key);
      jwk.push({ ...(await exportJWK(key)), kid, alg: 'RS256', use: 'sig' });
    }
    return new TokenService(cfg.JWT_ISSUER, cfg.ACCESS_TOKEN_TTL_SECONDS, signingKey, currentKid, verifyKeys, { keys: jwk });
  }

  get accessTtlSeconds(): number {
    return this.ttl;
  }

  jwksDocument(): { keys: JWK[] } {
    return this.jwks;
  }

  async sign(claims: SessionClaims): Promise<{ token: string; claims: AccessClaims }> {
    const nowMs = Date.now();
    const iat = Math.floor(nowMs / 1000);
    const full: AccessClaims = { ...claims, iat, iat_ms: nowMs, exp: iat + this.ttl, iss: this.issuer, jti: randomUUID() };
    const token = await new SignJWT(full as unknown as JWTPayload)
      .setProtectedHeader({ alg: 'RS256', kid: this.currentKid, typ: 'JWT' })
      .sign(this.signingKey);
    return { token, claims: full };
  }

  /**
   * Short-lived token for one app's own backend services (e.g. the aMaze
   * video-tracking API). `aud` = the app, carrying only that app's
   * entitlement, so it is useless against core or other spokes.
   */
  async signAppToken(
    sub: string,
    appId: string,
    entitlement: EntitlementClaim,
    ttlSeconds: number,
  ): Promise<{ token: string; expiresAt: Date }> {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + ttlSeconds;
    const token = await new SignJWT({ entitlements: { [appId]: entitlement } } as unknown as JWTPayload)
      .setProtectedHeader({ alg: 'RS256', kid: this.currentKid, typ: 'JWT' })
      .setIssuer(this.issuer)
      .setSubject(sub)
      .setAudience(appId)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .setJti(randomUUID())
      .sign(this.signingKey);
    return { token, expiresAt: new Date(exp * 1000) };
  }

  /**
   * Verifies signature + issuer. With `allowExpiredUpToSeconds`, an expired
   * token is still accepted if it expired no longer ago than that (used only by
   * logout, so a session can be ended after its access token lapsed).
   */
  async verify(token: string, opts: { allowExpiredUpToSeconds?: number } = {}): Promise<AccessClaims> {
    const { kid, alg } = decodeProtectedHeader(token);
    if (alg !== 'RS256' || !kid) throw new Error('unexpected token header');
    const key = this.verifyKeys.get(kid);
    if (!key) throw new Error('unknown signing key');
    let currentDate: Date | undefined;
    if (opts.allowExpiredUpToSeconds) {
      const { exp } = decodeJwt(token);
      const now = Math.floor(Date.now() / 1000);
      if (typeof exp === 'number' && exp <= now && now - exp <= opts.allowExpiredUpToSeconds) {
        currentDate = new Date((exp - 1) * 1000);
      }
    }
    const { payload } = await jwtVerify(token, key, {
      issuer: this.issuer,
      algorithms: ['RS256'],
      clockTolerance: 5,
      requiredClaims: ['sub', 'sid', 'exp', 'iat'],
      ...(currentDate ? { currentDate } : {}),
    });
    return payload as unknown as AccessClaims;
  }
}
