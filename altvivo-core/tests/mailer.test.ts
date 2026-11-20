import { describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import { SmtpMailer, templates } from '../src/lib/mailer.js';

/** SmtpMailer with nodemailer's transport swapped for a recorder. */
function mailer() {
  const sent: Record<string, unknown>[] = [];
  const m = new SmtpMailer({ SMTP_HOST: 'localhost', SMTP_PORT: 587, SMTP_FROM: 'AltVivo <no-reply@altvivo.bio>', SMTP_REPLY_FROM: 'AltVivo <hello@altvivo.bio>' } as Config);
  (m as unknown as { transport: { sendMail: (o: Record<string, unknown>) => Promise<void> } }).transport = { sendMail: async (o) => void sent.push(o) };
  return { m, sent };
}

describe('mail senders', () => {
  it('automated mail is one-way from no-reply@', async () => {
    const { m, sent } = mailer();
    await m.send({ to: 'a@b.edu', ...templates.passwordReset('A', 'https://altvivo.bio/x') });
    expect(sent[0]).toMatchObject({ from: 'AltVivo <no-reply@altvivo.bio>', headers: { 'Auto-Submitted': 'auto-generated' } });
    expect(sent[0]!.replyTo).toBeUndefined();
    expect(sent[0]!.text).toContain('does not accept replies');
    expect(sent[0]!.html).toContain('does not accept replies');
  });

  it('admin mail and invites are two-way from hello@', async () => {
    const { m, sent } = mailer();
    await m.send({ to: 'a@b.edu', sender: 'hello', ...templates.accountInvite('A', 'https://altvivo.bio/x', 7) });
    expect(sent[0]).toMatchObject({ from: 'AltVivo <hello@altvivo.bio>', replyTo: 'AltVivo <hello@altvivo.bio>' });
    expect(sent[0]!.headers).toBeUndefined();
    expect(sent[0]!.html).not.toContain('does not accept replies');
    expect(sent[0]).not.toHaveProperty('sender');
  });
});
