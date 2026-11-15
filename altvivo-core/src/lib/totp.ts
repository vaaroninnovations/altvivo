import { authenticator } from 'otplib';
import type { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import { hmacHex } from './crypto.js';

authenticator.options = { step: 30, window: 1, digits: 6 };

export const ISSUER_LABEL = 'AltVivo';

export const generateTotpSecret = (): string => authenticator.generateSecret(20);

export const otpauthUri = (email: string, secret: string): string => authenticator.keyuri(email, ISSUER_LABEL, secret);

/**
 * Verifies a 6-digit code and rejects replay of the same time-step for that
 * user (a code is single-use even inside its 30 s validity window).
 */
export async function verifyTotp(redis: Redis, userId: string, secret: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const delta = authenticator.checkDelta(code, secret);
  if (delta === null) return false;
  const step = Math.floor(Date.now() / 1000 / 30) + delta;
  const fresh = await redis.set(`mfa:used:${userId}:${step}`, '1', 'EX', 120, 'NX');
  return fresh === 'OK';
}

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** 10 single-use recovery codes like "k7qm-3xpa-9hdt". Only HMACs are stored. */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(12);
    const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
  });
}

export const normaliseRecoveryCode = (code: string): string => code.toLowerCase().replace(/[^a-z0-9]/g, '');

export const hashRecoveryCode = (pepper: string, code: string): string =>
  hmacHex(pepper, `recovery:${normaliseRecoveryCode(code)}`);
