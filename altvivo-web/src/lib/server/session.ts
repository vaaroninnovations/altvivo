import "server-only";
import { createRemoteJWKSet, jwtVerify, errors } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PUBLIC, siteOrigin } from "../config";
import type { Role } from "../types";

const JWKS_URL = process.env.JWKS_INTERNAL_URL ?? `${(process.env.CORE_INTERNAL_URL ?? "http://altvivo-core:4000").replace(/\/$/, "")}/.well-known/jwks.json`;
const ISSUER = process.env.JWT_ISSUER ?? "https://api.altvivo.bio";
const jwks = createRemoteJWKSet(new URL(JWKS_URL), { cacheMaxAge: 300_000, cooldownDuration: 30_000, timeoutDuration: 4000 });

export interface Session {
  token: string;
  sub: string;
  sid: string;
  email: string;
  name: string;
  role: Role;
  orgId: string | null;
  tier: string;
  mfa: boolean;
  mfaEnrollmentRequired: boolean;
  emailVerified: boolean;
  entitlements: Record<string, string>;
  creditsRemaining: number;
  exp: number;
}

export type SessionState = { session: Session } | { session: null; expired: boolean };

/** Verifies `altvivo_at` locally (RS256 via the IdP's JWKS). Revocation is enforced by core on every API call. */
export async function readSession(): Promise<SessionState> {
  const token = (await cookies()).get("altvivo_at")?.value;
  if (!token) return { session: null, expired: false };
  try {
    const { payload: p } = await jwtVerify(token, jwks, { issuer: ISSUER, algorithms: ["RS256"], clockTolerance: 5 });
    return {
      session: {
        token,
        sub: String(p.sub),
        sid: String(p.sid),
        email: String(p.email ?? ""),
        name: String(p.name ?? ""),
        role: p.role as Role,
        orgId: (p.org_id as string | null) ?? null,
        tier: String(p.tier ?? "NONE"),
        mfa: p.mfa === true,
        mfaEnrollmentRequired: p.mfa_enrollment_required === true,
        emailVerified: p.email_verified === true,
        entitlements: (p.entitlements as Record<string, string>) ?? {},
        creditsRemaining: Number(p.credits_remaining ?? 0),
        exp: Number(p.exp),
      },
    };
  } catch (err) {
    return { session: null, expired: err instanceof errors.JWTExpired };
  }
}

/**
 * For protected pages. No valid access token -> bounce through the IdP to
 * rotate the refresh cookie (path-scoped to api.altvivo.bio) and come back;
 * if that already happened (`av_r=1`) go to the login page instead.
 */
export async function requireSession(currentPath: string, alreadyBounced: boolean): Promise<Session> {
  const state = await readSession();
  if (state.session) return state.session;
  redirectToSignIn(currentPath, alreadyBounced);
}

export function redirectToSignIn(currentPath: string, alreadyBounced: boolean): never {
  if (alreadyBounced) redirect(`/login?next=${encodeURIComponent(stripBounceMarker(currentPath))}`);
  const back = new URL(currentPath, siteOrigin);
  back.searchParams.set("av_r", "1");
  redirect(`${PUBLIC.apiUrl}/v1/auth/refresh/bounce?next=${encodeURIComponent(back.toString())}`);
}

export function stripBounceMarker(path: string): string {
  const url = new URL(path, siteOrigin);
  url.searchParams.delete("av_r");
  return `${url.pathname}${url.search}`;
}
