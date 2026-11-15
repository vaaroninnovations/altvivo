"use client";

import { PUBLIC } from "./config";

/** Error as returned by altvivo-core: { error: { code, message, details? } }. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function readCookie(name: string): string | null {
  for (const part of document.cookie ? document.cookie.split("; ") : []) {
    const i = part.indexOf("=");
    if (part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

let csrfPromise: Promise<string> | null = null;

/**
 * Signed double-submit token (cookie `altvivo_csrf`, shared on .altvivo.bio).
 * `force` asks the API again: it re-issues the cookie when the one we hold no
 * longer verifies (for example after the server's CSRF secret was rotated).
 */
export async function csrfToken(force = false): Promise<string> {
  const existing = readCookie("altvivo_csrf");
  if (existing && !force) return existing;
  csrfPromise ??= fetch(`${PUBLIC.apiUrl}/v1/auth/csrf`, { credentials: "include" })
    .then(async (r) => {
      if (!r.ok) throw new ApiError(r.status, "CSRF_UNAVAILABLE", "Could not start a secure session. Please retry.");
      return ((await r.json()) as { csrfToken: string }).csrfToken;
    })
    .finally(() => {
      csrfPromise = null;
    });
  return csrfPromise;
}

interface Options {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Retry once after a silent refresh when the access token has expired. */
  retryOnExpiry?: boolean;
}

async function raw(path: string, { method = "GET", body }: Options) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") headers["X-CSRF-Token"] = await csrfToken();
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(`${PUBLIC.apiUrl}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let refreshPromise: Promise<boolean> | null = null;

/** Rotates the refresh token; true when a new access token was issued. */
export function refreshSession(): Promise<boolean> {
  refreshPromise ??= raw("/v1/auth/refresh", { method: "POST" })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  let res = await raw(path, opts);
  if (res.status === 403 && (opts.method ?? "GET") !== "GET") {
    const code = ((await res.clone().json().catch(() => null)) as { error?: { code?: string } } | null)?.error?.code;
    if (code === "CSRF_FAILED") {
      await csrfToken(true);
      res = await raw(path, opts);
    }
  }
  if (res.status === 401 && opts.retryOnExpiry !== false && path.startsWith("/v1/api/")) {
    if (await refreshSession()) res = await raw(path, opts);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: unknown } } | null;
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? "HTTP_ERROR", e?.message ?? "Something went wrong. Please retry.", e?.details);
  }
  return data as T;
}

/** Field-level messages from a VALIDATION_FAILED error. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || err.code !== "VALIDATION_FAILED" || !Array.isArray(err.details)) return {};
  return Object.fromEntries((err.details as { path: string; message: string }[]).map((d) => [d.path, d.message]));
}
