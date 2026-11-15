import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

export const hmacHex = (key: string | Buffer, data: string | Buffer): string =>
  createHmac('sha256', key).update(data).digest('hex');

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still spend comparable time to avoid a length oracle.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/**
 * AES-256-GCM envelope "v1.<iv>.<ciphertext>.<tag>" (base64url parts).
 * `aad` binds the ciphertext to its owner (e.g. user id) so a secret copied
 * onto another row fails to decrypt.
 */
export function sealSecret(key: Buffer, plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), ct.toString('base64url'), tag.toString('base64url')].join('.');
}

export function openSecret(key: Buffer, envelope: string, aad: string): string {
  const [version, iv, ct, tag] = envelope.split('.');
  if (version !== 'v1' || !iv || !ct || !tag) throw new Error('unsupported secret envelope');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}
