import { NextResponse, type NextRequest } from "next/server";

const API = process.env.NEXT_PUBLIC_API_URL ?? "https://api.altvivo.bio";
const EMBED = new URL(process.env.NEXT_PUBLIC_EMBED_URL ?? "https://embed.altvivo.bio/bar.js").origin;
const DEV = process.env.NODE_ENV !== "production";

/**
 * Per-request nonce Content-Security-Policy. Next.js reads the nonce from the
 * request's CSP header and applies it to its own scripts; 'strict-dynamic'
 * lets those trusted scripts load Turnstile / Razorpay Checkout.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com https://checkout.razorpay.com ${EMBED}${DEV ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // Advisory-board portraits are served from the CMS media origin (any https CDN).
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${API} https://challenges.cloudflare.com https://api.razorpay.com https://lumberjack.razorpay.com https://*.r2.cloudflarestorage.com${DEV ? " ws: http://localhost:*" : ""}`,
    "frame-src https://challenges.cloudflare.com https://api.razorpay.com https://checkout.razorpay.com",
    "frame-ancestors 'self'",
    `form-action 'self' ${API}`,
    "base-uri 'self'",
    "object-src 'none'",
    ...(API.startsWith("https://") ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // HTML routes only; static assets and the health check skip the proxy.
    { source: "/((?!_next/static|_next/image|favicon.ico|brand/|api/health).*)", missing: [{ type: "header", key: "next-router-prefetch" }] },
  ],
};
