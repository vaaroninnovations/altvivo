import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';

/**
 * Fetches an image from a public https URL for the SuperAdmin (the advisory
 * "welcome card" needs portrait pixels the browser canvas may read, and most
 * pasted portrait URLs are served without CORS headers).
 *
 * SSRF guards: https only, no credentials in the URL, port 443, every DNS
 * answer is checked at connect time (no rebinding window) against private,
 * loopback, link-local, CGNAT, multicast and reserved ranges, redirects are
 * re-validated (at most 3), 8 s timeout, size cap, and the bytes must start
 * with a JPEG, PNG or WebP signature.
 */

const BLOCKED = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) BLOCKED.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) BLOCKED.addSubnet(net, bits, 'ipv6');

/** True when the address is a routable public unicast address. */
export function isPublicAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  const addr = mapped ? mapped[1]! : ip;
  const family = isIP(addr);
  if (!family) return false;
  return !BLOCKED.check(addr, family === 6 ? 'ipv6' : 'ipv4');
}

export const IMAGE_SIGNATURES: Record<'image/jpeg' | 'image/png' | 'image/webp', (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

export function sniffImage(b: Buffer): keyof typeof IMAGE_SIGNATURES | null {
  for (const [type, test] of Object.entries(IMAGE_SIGNATURES)) if (test(b)) return type as keyof typeof IMAGE_SIGNATURES;
  return null;
}

export class RemoteImageError extends Error {}

function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RemoteImageError('Not a valid URL');
  }
  if (url.protocol !== 'https:') throw new RemoteImageError('Only https URLs can be fetched');
  if (url.username || url.password) throw new RemoteImageError('URLs with credentials are not allowed');
  if (url.port && url.port !== '443') throw new RemoteImageError('Only the default https port is allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !isPublicAddress(host)) throw new RemoteImageError('The address is not public');
  if (/(^|\.)(localhost|local|internal|localdomain)$/i.test(host)) throw new RemoteImageError('The address is not public');
  return url;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** DNS lookup that refuses to connect to non-public addresses. */
function guardedLookup(hostname: string, options: object, cb: LookupCb) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, []);
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => !isPublicAddress(a.address))) {
      return cb(Object.assign(new Error('The address is not public'), { code: 'EBLOCKED' }), []);
    }
    if ((options as { all?: boolean }).all) return cb(null, list);
    cb(null, list[0]!.address, list[0]!.family);
  });
}

function getOnce(url: URL, maxBytes: number, timeoutMs: number): Promise<{ redirect: string } | { body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: 'GET', lookup: guardedLookup as never, headers: { Accept: 'image/jpeg,image/png,image/webp', 'User-Agent': 'AltVivo-Admin/1.0' }, timeout: timeoutMs },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ redirect: new URL(res.headers.location, url).toString() });
        }
        if (status !== 200) {
          res.resume();
          return reject(new RemoteImageError(`The photo host answered ${status}`));
        }
        const declared = Number(res.headers['content-length'] ?? 0);
        if (declared > maxBytes) {
          res.destroy();
          return reject(new RemoteImageError('The photo is too large'));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new RemoteImageError('The photo is too large'));
          } else chunks.push(c);
        });
        res.on('end', () => resolve({ body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new RemoteImageError('The photo host timed out')));
    req.on('error', (e) => reject(e instanceof RemoteImageError ? e : new RemoteImageError((e as NodeJS.ErrnoException).code === 'EBLOCKED' ? 'The address is not public' : 'Could not reach the photo host')));
    req.end();
  });
}

export async function fetchRemoteImage(raw: string, { maxBytes = 5 * 1024 * 1024, timeoutMs = 8000 } = {}) {
  let url = checkUrl(raw);
  for (let hop = 0; hop <= 3; hop++) {
    const r = await getOnce(url, maxBytes, timeoutMs);
    if ('redirect' in r) {
      url = checkUrl(r.redirect);
      continue;
    }
    const contentType = sniffImage(r.body);
    if (!contentType) throw new RemoteImageError('The URL is not a JPEG, PNG or WebP image');
    return { contentType, body: r.body };
  }
  throw new RemoteImageError('Too many redirects');
}
