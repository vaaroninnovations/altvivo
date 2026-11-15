import { BlockList, isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

export function buildTrustedProxies(cidrs: string[]): BlockList {
  const list = new BlockList();
  for (const cidr of cidrs) {
    const [addr, prefix] = cidr.split('/');
    if (!addr) continue;
    const family = isIP(addr) === 6 ? 'ipv6' : 'ipv4';
    const bits = prefix ? Number(prefix) : family === 'ipv6' ? 128 : 32;
    list.addSubnet(addr, bits, family);
  }
  return list;
}

const stripMapped = (ip: string) => (ip.startsWith('::ffff:') ? ip.slice(7) : ip);

/**
 * Client IP: Caddy resolves the real visitor ({client_ip}, Cloudflare-aware)
 * into X-Real-IP. The header is honoured only when the TCP peer is a trusted
 * proxy; otherwise the socket address is used.
 */
export function clientIp(req: FastifyRequest, trusted: BlockList): string {
  const peer = stripMapped(req.socket.remoteAddress ?? '');
  const peerFamily = isIP(peer) === 6 ? 'ipv6' : 'ipv4';
  if (peer && trusted.check(peer, peerFamily)) {
    const hdr = req.headers['x-real-ip'];
    const value = stripMapped((Array.isArray(hdr) ? hdr[0] : hdr)?.trim() ?? '');
    if (value && isIP(value)) return value;
  }
  return peer || '0.0.0.0';
}

export function userAgent(req: FastifyRequest): string | null {
  const ua = req.headers['user-agent'];
  return ua ? ua.slice(0, 512) : null;
}

/** Validates a post-login redirect against the allow-listed origins. */
export function safeRedirect(target: string | undefined, allowedOrigins: Set<string>, fallback: string): string {
  if (!target) return fallback;
  try {
    const url = new URL(target);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) return fallback;
    if (url.username || url.password) return fallback;
    return allowedOrigins.has(url.origin) ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}
