import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from '../config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Validated address only (e.g. the sender of a contact enquiry). */
  replyTo?: string;
}

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(private readonly cfg: Config) {
    this.transport = nodemailer.createTransport({
      host: cfg.SMTP_HOST,
      port: cfg.SMTP_PORT,
      secure: cfg.SMTP_PORT === 465,
      requireTLS: cfg.SMTP_PORT !== 465,
      auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASSWORD } : undefined,
      tls: { minVersion: 'TLSv1.2' },
      connectionTimeout: 10_000,
    });
  }

  async send(msg: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.cfg.SMTP_FROM, ...msg });
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#F8FAFC;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0B0F19">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #E2E8F0;border-radius:12px">
<tr><td style="padding:24px 28px;border-bottom:1px solid #E2E8F0;font-weight:700;font-size:18px;color:#0EA5E9">AltVivo</td></tr>
<tr><td style="padding:28px"><h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(title)}</h1>${bodyHtml}</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #E2E8F0;font-size:12px;color:#64748B">You received this because of activity on your AltVivo account. If this was not you, you can ignore this email.</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#0EA5E9;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">${escapeHtml(label)}</a></p>
<p style="font-size:12px;color:#64748B;word-break:break-all">Or paste this link into your browser:<br>${escapeHtml(href)}</p>`;

export const templates = {
  verifyEmail(name: string, link: string): Omit<MailMessage, 'to'> {
    return {
      subject: 'Verify your AltVivo email address',
      text: `Hi ${name},\n\nConfirm your email address to activate your AltVivo account:\n${link}\n\nThis link expires in 24 hours.`,
      html: layout('Verify your email address', `<p>Hi ${escapeHtml(name)},</p><p>Confirm your email address to activate your AltVivo account. This link expires in 24 hours.</p>${button(link, 'Verify email')}`),
    };
  },
  passwordReset(name: string, link: string): Omit<MailMessage, 'to'> {
    return {
      subject: 'Reset your AltVivo password',
      text: `Hi ${name},\n\nUse this link to choose a new password (valid for 1 hour):\n${link}\n\nIf you did not ask for this, ignore this email - your password stays the same.`,
      html: layout('Reset your password', `<p>Hi ${escapeHtml(name)},</p><p>Use the button below to choose a new password. The link is valid for 1 hour and can be used once.</p>${button(link, 'Choose a new password')}<p>If you did not ask for this, ignore this email - your password stays the same.</p>`),
    };
  },
  securityAlert(name: string, what: string): Omit<MailMessage, 'to'> {
    return {
      subject: `AltVivo security notice: ${what}`,
      text: `Hi ${name},\n\n${what} on your AltVivo account. If this was not you, reset your password immediately.`,
      html: layout('Security notice', `<p>Hi ${escapeHtml(name)},</p><p><strong>${escapeHtml(what)}</strong> on your AltVivo account.</p><p>If this was not you, reset your password immediately and contact support.</p>`),
    };
  },
  paymentReceipt(name: string, number: string, currency: string, totalMinor: bigint, link: string): Omit<MailMessage, 'to'> {
    const amount = `${currency} ${(Number(totalMinor) / 100).toFixed(2)}`;
    return {
      subject: `AltVivo payment received - invoice ${number}`,
      text: `Hi ${name},\n\nThank you. We received ${amount}. Your GST invoice ${number} is ready:\n${link}\n\nYour licence is active now - reload any open AltVivo tab.`,
      html: layout('Payment received', `<p>Hi ${escapeHtml(name)},</p><p>Thank you. We received <strong>${escapeHtml(amount)}</strong> and issued invoice <strong>${escapeHtml(number)}</strong>. Your licence is active now.</p>${button(link, 'View invoice')}`),
    };
  },
  proformaIssued(name: string, number: string, currency: string, totalMinor: bigint, validUntil: string, link: string): Omit<MailMessage, 'to'> {
    const amount = `${currency} ${(Number(totalMinor) / 100).toFixed(2)}`;
    return {
      subject: `AltVivo proforma invoice ${number}`,
      text: `Hello ${name},\n\nProforma invoice ${number} for ${amount} (valid until ${validUntil}) is ready for your procurement process:\n${link}\n\nQuote ${number} as the reference when paying by NEFT / RTGS.`,
      html: layout('Your proforma invoice', `<p>Hello ${escapeHtml(name)},</p><p>Proforma invoice <strong>${escapeHtml(number)}</strong> for <strong>${escapeHtml(amount)}</strong> is valid until ${escapeHtml(validUntil)}. Quote the number as the payment reference for NEFT / RTGS.</p>${button(link, 'Download proforma')}`),
    };
  },
  renewalReminder(name: string, planName: string, endsOn: string, link: string): Omit<MailMessage, 'to'> {
    return {
      subject: `Your ${planName} licence ends on ${endsOn}`,
      text: `Hi ${name},\n\nYour prepaid ${planName} licence ends on ${endsOn}. Renew before then to keep access - the new term starts when the current one ends:\n${link}`,
      html: layout('Licence ending soon', `<p>Hi ${escapeHtml(name)},</p><p>Your prepaid <strong>${escapeHtml(planName)}</strong> licence ends on <strong>${escapeHtml(endsOn)}</strong>. Renew now and the new term starts when the current one ends.</p>${button(link, 'Renew licence')}`),
    };
  },
  contactNotification(m: { name: string; email: string; institution: string | null; category: string; subject: string; message: string; appId: string | null; id: string }): Omit<MailMessage, 'to'> {
    const lines = [
      `From: ${m.name} <${m.email}>`,
      m.institution ? `Institution: ${m.institution}` : null,
      `Category: ${m.category}${m.appId ? ` (${m.appId})` : ''}`,
      `Reference: ${m.id}`,
    ].filter(Boolean) as string[];
    return {
      subject: `[AltVivo ${m.category}] ${m.subject}`,
      text: `${lines.join('\n')}\n\n${m.message}`,
      html: layout(m.subject, `<p>${lines.map(escapeHtml).join('<br>')}</p><p style="white-space:pre-wrap">${escapeHtml(m.message)}</p>`),
    };
  },
  contactAcknowledgement(name: string, subject: string): Omit<MailMessage, 'to'> {
    return {
      subject: `We received your message: ${subject}`,
      text: `Hi ${name},\n\nThanks for contacting AltVivo. Our team usually replies within one working day.`,
      html: layout('We received your message', `<p>Hi ${escapeHtml(name)},</p><p>Thanks for contacting AltVivo about <strong>${escapeHtml(subject)}</strong>. Our team usually replies within one working day.</p>`),
    };
  },
  appLaunched(appName: string, link: string): Omit<MailMessage, 'to'> {
    return {
      subject: `${appName} is now live on AltVivo`,
      text: `${appName} has launched. You joined the early-access list - open it here:\n${link}`,
      html: layout(`${appName} is live`, `<p>You joined the early-access list for <strong>${escapeHtml(appName)}</strong>. It is now available on AltVivo.</p>${button(link, `Open ${appName}`)}`),
    };
  },
};
