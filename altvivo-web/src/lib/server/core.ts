import "server-only";
import { FALLBACK_APPS } from "../catalog";
import type { AdvisoryMember, CatalogResponse, PublicApp } from "../types";

const CORE = (process.env.CORE_INTERNAL_URL ?? "http://altvivo-core:4000").replace(/\/$/, "");

export class CoreUnauthorized extends Error {}

/** Non-2xx from core with its error code (e.g. 403 MFA_ENROLLMENT_REQUIRED). */
export class CoreError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Server-side call to altvivo-core on the Docker network. */
export async function coreGet<T>(path: string, opts: { token?: string; revalidate?: number; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(`${CORE}${path}`, {
    headers: {
      Accept: "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    ...(opts.token ? { cache: "no-store" as const } : { next: { revalidate: opts.revalidate ?? 30 } }),
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 401) throw new CoreUnauthorized(path);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new CoreError(res.status, body?.error?.code ?? "HTTP_ERROR", body?.error?.message ?? `core ${path} -> ${res.status}`);
  }
  return (await res.json()) as T;
}

/** App registry; falls back to the built-in catalogue if core is unreachable. */
export async function getPublicApps(): Promise<PublicApp[]> {
  try {
    const { apps } = await coreGet<{ apps: PublicApp[] }>("/v1/public/apps", { revalidate: 30 });
    return apps.length ? apps : FALLBACK_APPS;
  } catch {
    return FALLBACK_APPS;
  }
}

/** Public price list; null when core is unreachable (pages show a retry notice, never invented prices). */
export async function getCatalog(currency: "INR" | "USD"): Promise<CatalogResponse | null> {
  try {
    const c = await coreGet<CatalogResponse>(`/v1/public/plans?currency=${currency}`, { revalidate: 60 });
    // A cached response from an older API version has no kind / prices: treat it as unavailable, never render it.
    const valid = Array.isArray(c.plans) && c.plans.length > 0 && c.plans.every((p) => typeof p.kind === "string" && p.prices && Number.isFinite(p.prices.INR));
    return valid ? c : null;
  } catch {
    return null;
  }
}

/** Published advisory board members (empty when none are published or core is unreachable). */
export async function getAdvisoryBoard(featuredOnly = false): Promise<AdvisoryMember[]> {
  try {
    const { members } = await coreGet<{ members: AdvisoryMember[] }>(`/v1/public/advisory-board${featuredOnly ? "?featured=1" : ""}`, { revalidate: 120 });
    return members;
  } catch {
    return [];
  }
}
