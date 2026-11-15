import argon2 from 'argon2';
import { badRequest } from './errors.js';

// Spec 3.2: Argon2id, memoryCost 64 MiB, timeCost 3, parallelism 4.
const OPTIONS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 } as const;

// Verified against when the account does not exist, so response timing does
// not reveal which emails are registered.
let dummyHash: Promise<string> | null = null;
const getDummy = () => (dummyHash ??= argon2.hash('altvivo-timing-equaliser', OPTIONS));

export const hashPassword = (password: string): Promise<string> => argon2.hash(password, OPTIONS);

export async function verifyPassword(hash: string | null | undefined, password: string): Promise<boolean> {
  if (!hash) {
    await argon2.verify(await getDummy(), password).catch(() => false);
    return false;
  }
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export const needsRehash = (hash: string): boolean => argon2.needsRehash(hash, OPTIONS);

const COMMON = new Set([
  'password1234', 'password12345', 'qwertyuiop12', '123456789012', 'iloveyou1234', 'administrator',
  'welcome12345', 'letmein12345', 'altvivo12345', 'pharmacology1',
]);

/** NIST SP 800-63B style: length over composition rules, block obvious choices. */
export function assertPasswordPolicy(password: string, email: string, fullName?: string): void {
  if (password.length < 12) throw badRequest('WEAK_PASSWORD', 'Password must be at least 12 characters');
  if (password.length > 128) throw badRequest('WEAK_PASSWORD', 'Password must be at most 128 characters');
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) throw badRequest('WEAK_PASSWORD', 'This password is too common');
  if (/^(.)\1+$/.test(password)) throw badRequest('WEAK_PASSWORD', 'Password cannot be a single repeated character');
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  if (local.length >= 4 && lower.includes(local)) throw badRequest('WEAK_PASSWORD', 'Password must not contain your email address');
  const nameParts = (fullName ?? '').toLowerCase().split(/\s+/).filter((p) => p.length >= 4);
  if (nameParts.some((p) => lower.includes(p))) throw badRequest('WEAK_PASSWORD', 'Password must not contain your name');
}
