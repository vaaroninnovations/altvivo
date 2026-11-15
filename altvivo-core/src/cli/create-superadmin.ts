/**
 * Bootstrap the first SUPERADMIN (run inside the core container):
 *   docker compose exec altvivo-core node dist/cli/create-superadmin.js --email founder@altvivo.bio --name "Founder Name"
 * No password is printed or accepted: a one-hour password-setup link is
 * emailed AND printed once. At first sign-in the account must enrol TOTP
 * before any admin endpoint becomes usable.
 */
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { audit, systemActor, withAudit } from '../lib/audit.js';
import { hmacHex, randomToken } from '../lib/crypto.js';
import { SmtpMailer, templates } from '../lib/mailer.js';

const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });
const email = z.string().trim().toLowerCase().email().parse(values.email);
const name = z.string().trim().min(2).max(200).parse(values.name);

const cfg = loadConfig();
const prisma = new PrismaClient({ datasourceUrl: cfg.DATABASE_URL });

try {
  const token = randomToken(32);
  const user = await withAudit(prisma, { ...systemActor(), userAgent: 'cli:create-superadmin' }, async (tx) => {
    const u = await tx.user.upsert({
      where: { email },
      create: { email, fullName: name, role: 'SUPERADMIN', emailVerifiedAt: new Date() },
      update: { role: 'SUPERADMIN', disabledAt: null },
    });
    await tx.authToken.create({
      data: {
        userId: u.id,
        purpose: 'PASSWORD_RESET',
        tokenHash: hmacHex(cfg.REFRESH_TOKEN_PEPPER, `auth:${token}`),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    await audit(tx, 'ADMIN.SUPERADMIN_BOOTSTRAP', u.id, { via: 'cli' });
    return u;
  });
  const link = `${new URL(cfg.PUBLIC_WEB_URL).origin}/reset-password?token=${encodeURIComponent(token)}`;
  await new SmtpMailer(cfg).send({ to: email, ...templates.passwordReset(user.fullName, link) }).catch((err) => {
    console.error(`(email not sent: ${(err as Error).message})`);
  });
  console.log(`SUPERADMIN ready: ${user.email} (${user.id})`);
  console.log(`Set the password within 1 hour: ${link}`);
  console.log('TOTP enrolment is enforced at first sign-in.');
} finally {
  await prisma.$disconnect();
}
