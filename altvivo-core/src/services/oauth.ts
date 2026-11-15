import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Config } from '../config.js';

export type OAuthProviderId = 'google' | 'orcid';

export interface OAuthIdentity {
  provider: 'GOOGLE' | 'ORCID';
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
  orcidId: string | null;
}

export interface AuthorizationParams {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface OAuthProvider {
  readonly enabled: boolean;
  authorizationUrl(p: AuthorizationParams): string;
  exchange(code: string, p: AuthorizationParams): Promise<OAuthIdentity>;
}

export type OAuthProviders = Record<OAuthProviderId, OAuthProvider>;

export const pkceChallenge = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url');

async function postForm(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`token endpoint ${new URL(url).host} returned ${res.status}: ${String(data.error ?? '')}`);
  return data;
}

function assertNonce(payload: JWTPayload, nonce: string): void {
  if (payload.nonce !== nonce) throw new Error('id_token nonce mismatch');
}

export class GoogleProvider implements OAuthProvider {
  private readonly jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  constructor(private readonly clientId: string, private readonly clientSecret: string) {}

  get enabled() {
    return !!this.clientId && !!this.clientSecret;
  }

  authorizationUrl(p: AuthorizationParams): string {
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.search = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: p.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: p.state,
      nonce: p.nonce,
      code_challenge: pkceChallenge(p.codeVerifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
      access_type: 'online',
    }).toString();
    return u.toString();
  }

  async exchange(code: string, p: AuthorizationParams): Promise<OAuthIdentity> {
    const tokens = await postForm('https://oauth2.googleapis.com/token', {
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: p.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: p.codeVerifier,
    });
    if (typeof tokens.id_token !== 'string') throw new Error('Google did not return an id_token');
    const { payload } = await jwtVerify(tokens.id_token, this.jwks, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: this.clientId,
      algorithms: ['RS256'],
    });
    assertNonce(payload, p.nonce);
    if (typeof payload.sub !== 'string') throw new Error('Google id_token without sub');
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
    return {
      provider: 'GOOGLE',
      subject: payload.sub,
      email,
      emailVerified: payload.email_verified === true,
      name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : (email ?? 'AltVivo user'),
      orcidId: null,
    };
  }
}

const ORCID_ID = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

export class OrcidProvider implements OAuthProvider {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  constructor(private readonly baseUrl: string, private readonly clientId: string, private readonly clientSecret: string) {
    this.jwks = createRemoteJWKSet(new URL(`${baseUrl}/oauth/jwks`));
  }

  get enabled() {
    return !!this.clientId && !!this.clientSecret;
  }

  authorizationUrl(p: AuthorizationParams): string {
    const u = new URL(`${this.baseUrl}/oauth/authorize`);
    u.search = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      scope: 'openid',
      redirect_uri: p.redirectUri,
      state: p.state,
      nonce: p.nonce,
    }).toString();
    return u.toString();
  }

  async exchange(code: string, p: AuthorizationParams): Promise<OAuthIdentity> {
    const tokens = await postForm(`${this.baseUrl}/oauth/token`, {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: p.redirectUri,
    });
    if (typeof tokens.id_token !== 'string') throw new Error('ORCID did not return an id_token');
    const { payload } = await jwtVerify(tokens.id_token, this.jwks, {
      issuer: this.baseUrl,
      audience: this.clientId,
      algorithms: ['RS256'],
    });
    assertNonce(payload, p.nonce);
    const orcid = typeof payload.sub === 'string' ? payload.sub : '';
    if (!ORCID_ID.test(orcid)) throw new Error('ORCID id_token carries an invalid iD');
    const given = typeof payload.given_name === 'string' ? payload.given_name : '';
    const family = typeof payload.family_name === 'string' ? payload.family_name : '';
    const name = `${given} ${family}`.trim() || (typeof tokens.name === 'string' ? tokens.name : '') || orcid;
    return { provider: 'ORCID', subject: orcid, email: null, emailVerified: false, name, orcidId: orcid };
  }
}

export function createOAuthProviders(cfg: Config): OAuthProviders {
  return {
    google: new GoogleProvider(cfg.GOOGLE_CLIENT_ID, cfg.GOOGLE_CLIENT_SECRET),
    orcid: new OrcidProvider(cfg.ORCID_BASE_URL, cfg.ORCID_CLIENT_ID, cfg.ORCID_CLIENT_SECRET),
  };
}
