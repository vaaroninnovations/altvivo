import type { IncomingMessage, ServerResponse } from "node:http";

export type AccessLevel = "none" | "waitlist" | "trial" | "basic" | "pro" | "full";
export const ACCESS_LEVELS: readonly AccessLevel[];
export function levelRank(level: string | null | undefined): number;

export interface Claims {
  readonly sub: string;
  readonly sid: string;
  readonly email: string;
  readonly name: string;
  readonly role: "STUDENT" | "RESEARCHER" | "PI" | "INSTITUTE_ADMIN" | "SUPERADMIN" | string;
  readonly orgId: string | null;
  readonly tier: string;
  readonly entitlements: Readonly<Record<string, AccessLevel>>;
  readonly creditsRemaining: number;
  readonly emailVerified: boolean;
  readonly mfa: boolean;
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
  accessLevel(appId: string): AccessLevel;
  hasAccess(appId: string, minimum?: AccessLevel): boolean;
}

export class TokenError extends Error {
  readonly expired: boolean;
}

export function toClaims(payload: Record<string, unknown>): Claims;

export interface Verifier {
  verify(token: string): Promise<Claims>;
}

export function createVerifier(opts: {
  jwksUrl?: string;
  jwks?: { keys: object[] };
  issuer?: string;
  leewaySeconds?: number;
  cacheSeconds?: number;
}): Verifier;

export interface MgetClient {
  mget(...keys: string[]): Promise<(string | null)[]>;
}

export function createRevocationChecker(opts?: {
  redis?: MgetClient | null;
  prefix?: string;
  failOpen?: boolean;
  logger?: Pick<Console, "warn">;
}): { isRevoked(claims: Claims): Promise<boolean> };

export interface AltVivoRequestState {
  claims: Claims | null;
  expired: boolean;
  reason: null | "no_token" | "expired" | "invalid" | "revoked" | "error";
}

declare module "http" {
  interface IncomingMessage {
    altvivo?: AltVivoRequestState;
  }
}

type Middleware = (req: IncomingMessage & { cookies?: Record<string, string>; originalUrl?: string }, res: ServerResponse & any, next: (err?: unknown) => void) => void;

export interface AltVivo {
  readonly config: Readonly<Record<string, unknown>>;
  readonly verifier: Verifier;
  authenticate(): Middleware;
  requireUser(opts?: { minLevel?: AccessLevel }): Middleware;
  loginRedirect(req: IncomingMessage, next?: string): string;
  bounceRedirect(req: IncomingMessage): string;
  centralLogout(next?: string): string;
}

export function createAltVivo(options?: {
  appId?: string;
  jwksUrl?: string;
  jwks?: { keys: object[] };
  issuer?: string;
  cookieName?: string;
  loginUrl?: string;
  logoutUrl?: string;
  bounceUrl?: string;
  refreshUrl?: string;
  pricingUrl?: string;
  publicOrigin?: string;
  redis?: MgetClient | null;
  redisPrefix?: string;
  verifier?: Verifier;
  logger?: Pick<Console, "warn" | "error">;
}): AltVivo;

export class CoreError extends Error {
  readonly status: number;
  readonly code: string;
}

export interface CoreClient {
  entitlements(userId: string): Promise<{ userId: string; entitlements: Record<string, AccessLevel>; creditsRemaining: number }>;
  debitCredits(userId: string, amount: number, actionType: string, referenceId: string): Promise<{ ledgerEntryId: string; balance: number }>;
  refundCredits(userId: string, amount: number, referenceId: string): Promise<{ ledgerEntryId: string; balance: number }>;
  audit(userId: string | null, eventType: string, opts?: { resourceId?: string | null; metadata?: Record<string, unknown>; actorIp?: string | null; userAgent?: string | null }): Promise<{ status: string }>;
  vaultUploadUrl(userId: string, file: { fileName: string; fileType: "CSV" | "JSON" | "MP4" | "PDF"; sizeBytes: number; sha256: string }): Promise<{ objectKey: string; uploadUrl: string; method: "PUT"; headers: Record<string, string>; expiresAt: string }>;
  vaultComplete(objectKey: string): Promise<{ file: { id: string; fileName: string; fileType: string; sizeBytes: number; sha256: string; sourceApp: string } }>;
  vaultDownloadUrl(fileId: string, userId: string): Promise<{ url: string; fileName: string; fileType: string; sha256: string; expiresInSeconds: number }>;
}

export function createCoreClient(opts?: { baseUrl?: string; serviceToken?: string; timeoutMs?: number; fetchImpl?: typeof fetch }): CoreClient;
