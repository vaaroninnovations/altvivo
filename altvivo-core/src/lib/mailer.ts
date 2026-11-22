import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from '../config.js';
import { mailPlainText, renderMailHtml } from './mail-format.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Validated address only (e.g. the sender of a contact enquiry). */
  replyTo?: string;
  /** Validated addresses only (mailbox compose). */
  cc?: string[];
  /**
   * 'hello' = a two-way message people may answer (admin mailbox, account
   * invites): sent from SMTP_REPLY_FROM with replies going back there.
   * Default 'noreply' = one-way, automated mail from SMTP_FROM.
   */
  sender?: 'hello' | 'noreply';
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

  async send({ sender = 'noreply', ...msg }: MailMessage): Promise<void> {
    if (sender === 'hello') {
      await this.transport.sendMail({ from: this.cfg.SMTP_REPLY_FROM, replyTo: this.cfg.SMTP_REPLY_FROM, ...msg });
      return;
    }
    await this.transport.sendMail({
      from: this.cfg.SMTP_FROM,
      ...msg,
      text: `${msg.text}\n\n--\nThis address does not accept replies. To contact AltVivo, write to ${brand.replyEmail}.`,
      // RFC 3834: tells mail systems not to send auto-replies (vacation notices) back.
      headers: { 'Auto-Submitted': 'auto-generated' },
    });
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Brand settings for every email (set once at start-up from the configuration). */
const brand = { webOrigin: 'https://altvivo.bio', supportEmail: 'support@altvivo.bio', replyEmail: 'hello@altvivo.bio', legalName: 'Aaron Innovations' };
export function configureMailBrand(b: Partial<typeof brand>): void {
  Object.assign(brand, Object.fromEntries(Object.entries(b).filter(([, v]) => !!v)));
}

const INK = '#16132F';
const MUTED = '#5B5876';
const LINE = '#E6E3F3';
const FONT = "'IBM Plex Sans','Segoe UI',Helvetica,Arial,sans-serif";

/**
 * The AltVivo email template: logo header on the brand gradient rule, a white
 * card for the content, and a footer with the sender's identity. Table layout
 * and inline styles only, so it renders the same in Gmail, Outlook and Apple Mail.
 */
function layout(title: string, bodyHtml: string, footer = 'You received this because of activity on your AltVivo account. If this was not you, you can ignore this email.', replyable = false): string {
  const web = brand.webOrigin;
  const replies = replyable ? '' : `<br>This address does not accept replies. To contact us, write to <a href="mailto:${escapeHtml(brand.replyEmail)}" style="color:#4B1FD8;text-decoration:none">${escapeHtml(brand.replyEmail)}</a>.`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#F4F2FB;font-family:${FONT};color:${INK};-webkit-text-size-adjust:100%">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F2FB"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:16px;overflow:hidden">
<tr><td style="height:4px;line-height:4px;font-size:0;background:#4B1FD8;background-image:linear-gradient(90deg,#0A2BDB,#4B1FD8 55%,#9D0BEF)">&nbsp;</td></tr>
<tr><td style="padding:24px 32px 20px;border-bottom:1px solid ${LINE}"><a href="${escapeHtml(web)}" style="text-decoration:none"><img src="${escapeHtml(web)}/brand/altvivo-wordmark.png" width="150" height="29" alt="AltVivo" style="display:block;border:0;height:29px;width:150px;color:#4B1FD8;font-size:20px;font-weight:700"></a></td></tr>
<tr><td style="padding:32px;font-size:15px;line-height:1.65;color:${INK}"><h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;font-weight:600;color:${INK}">${escapeHtml(title)}</h1>${bodyHtml}</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid ${LINE};background:#FBFAFE;font-size:12px;line-height:1.6;color:${MUTED}">${escapeHtml(footer)}${replies}<br><br>
<strong style="color:${INK}">AltVivo</strong> · a product of ${escapeHtml(brand.legalName)}<br>
<a href="${escapeHtml(web)}" style="color:#4B1FD8;text-decoration:none">altvivo.bio</a> · <a href="mailto:${escapeHtml(brand.supportEmail)}" style="color:#4B1FD8;text-decoration:none">${escapeHtml(brand.supportEmail)}</a> · <a href="${escapeHtml(web)}/privacy" style="color:#4B1FD8;text-decoration:none">Privacy</a> · <a href="${escapeHtml(web)}/terms" style="color:#4B1FD8;text-decoration:none">Terms</a></td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 18px"><tr><td style="border-radius:10px;background:#4B1FD8;background-image:linear-gradient(90deg,#2A22DB,#7A14E6)"><a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 24px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;border-radius:10px">${escapeHtml(label)}</a></td></tr></table>
<p style="font-size:12px;color:${MUTED};word-break:break-all;margin:0 0 4px">Or paste this link into your browser:<br>${escapeHtml(href)}</p>`;

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
  accountInvite(name: string, link: string, days: number): Omit<MailMessage, 'to'> {
    return {
      subject: 'Your AltVivo account is ready',
      text: `Hi ${name},\n\nAn AltVivo administrator has created an account for you. Choose your password to activate it (valid for ${days} days, single use):\n${link}\n\nQuestions? Just reply to this email.\n\nIf you were not expecting this, you can ignore this email.`,
      html: layout('Your AltVivo account is ready', `<p>Hi ${escapeHtml(name)},</p><p>An AltVivo administrator has created an account for you. Choose your password to activate it. The link is valid for ${days} days and can be used once.</p>${button(link, 'Set your password')}<p>If you were not expecting this, you can ignore this email.</p>`, 'Questions? Reply to this email and the AltVivo team will get back to you.', true),
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
  trialRequestNotification(m: { name: string; email: string; institution: string; designation: string | null; apps: string[]; useCase: string; id: string }, link: string): Omit<MailMessage, 'to'> {
    const lines = [`From: ${m.name} <${m.email}>`, `Institution: ${m.institution}`, m.designation ? `Role: ${m.designation}` : null, `Applications: ${m.apps.join(', ')}`, `Reference: ${m.id}`].filter(Boolean) as string[];
    return {
      subject: `[AltVivo free month] ${m.name}, ${m.institution}`,
      text: `${lines.join('\n')}\n\n${m.useCase}\n\nReview: ${link}`,
      html: layout('One month free: new request', `<p>${lines.map(escapeHtml).join('<br>')}</p><p style="white-space:pre-wrap">${escapeHtml(m.useCase)}</p>${button(link, 'Review request')}`),
    };
  },
  trialRequestReceived(name: string, days: number): Omit<MailMessage, 'to'> {
    return {
      subject: 'We received your request for one month free on AltVivo',
      text: `Hi ${name},\n\nThanks for requesting ${days} days of free access to AltVivo. Our team reviews every request, usually within one working day, and you will hear from us by email.\n\nNo payment details are needed for the free month.`,
      html: layout('Your free month request', `<p>Hi ${escapeHtml(name)},</p><p>Thanks for requesting <strong>${days} days of free access</strong> to AltVivo. Our team reviews every request, usually within one working day, and you will hear from us by email.</p><p>No payment details are needed for the free month.</p>`),
    };
  },
  trialApproved(name: string, days: number, apps: string[], link: string, o: { active: boolean; endsOn: string | null }): Omit<MailMessage, 'to'> {
    const list = apps.join(' and ');
    const how = o.active
      ? `Your free access to ${list} is active now${o.endsOn ? ` and runs until ${o.endsOn}` : ''}.`
      : `Create your AltVivo account with this email address and verify it: your ${days} days of free access to ${list} start the moment you do.`;
    return {
      subject: `Your free month on AltVivo is ${o.active ? 'active' : 'approved'}`,
      text: `Hi ${name},\n\nGood news: your request for one month free was approved. ${how}\n\n${link}\n\nWhen the free month ends, access stops unless you choose a plan. Nothing is charged automatically.`,
      html: layout(o.active ? 'Your free month is active' : 'Your free month is approved', `<p>Hi ${escapeHtml(name)},</p><p>Good news: your request for one month free was approved. ${escapeHtml(how)}</p>${button(link, o.active ? 'Open my applications' : 'Create my account')}<p>When the free month ends, access stops unless you choose a plan. Nothing is charged automatically.</p>`),
    };
  },
  freeMonthStarted(name: string, days: number, apps: string[], link: string, endsOn: string): Omit<MailMessage, 'to'> {
    const list = apps.join(' and ');
    return {
      subject: 'Your free month on AltVivo has started',
      text: `Hi ${name},\n\nWelcome to AltVivo. Your ${days} days of free, full access to ${list} are active now and run until ${endsOn}.\n\n${link}\n\nWhen the free month ends, access stops unless you choose a plan. Nothing is charged automatically.`,
      html: layout('Your free month has started', `<p>Hi ${escapeHtml(name)},</p><p>Welcome to AltVivo. Your <strong>${days} days of free, full access</strong> to ${escapeHtml(list)} are active now and run until <strong>${escapeHtml(endsOn)}</strong>.</p>${button(link, 'Open my applications')}<p>When the free month ends, access stops unless you choose a plan. Nothing is charged automatically.</p>`),
    };
  },
  trialDeclined(name: string, note: string | null, link: string): Omit<MailMessage, 'to'> {
    return {
      subject: 'About your request for one month free on AltVivo',
      text: `Hi ${name},\n\nThank you for your interest in AltVivo. We are not able to offer the free month for this request.${note ? `\n\n${note}` : ''}\n\nYou can still start with a monthly plan, or ask us about an institutional licence:\n${link}`,
      html: layout('About your free month request', `<p>Hi ${escapeHtml(name)},</p><p>Thank you for your interest in AltVivo. We are not able to offer the free month for this request.</p>${note ? `<p>${escapeHtml(note)}</p>` : ''}<p>You can still start with a monthly plan, or ask us about an institutional licence.</p>${button(link, 'See plans')}`),
    };
  },
  trialEnding(name: string, endsOn: string, link: string): Omit<MailMessage, 'to'> {
    return {
      subject: `Your free month on AltVivo ends on ${endsOn}`,
      text: `Hi ${name},\n\nYour free access ends on ${endsOn}. Choose a plan before then to keep working without a break; your data and exports are kept either way:\n${link}`,
      html: layout('Your free month is ending', `<p>Hi ${escapeHtml(name)},</p><p>Your free access ends on <strong>${escapeHtml(endsOn)}</strong>. Choose a plan before then to keep working without a break. Your data and exports are kept either way.</p>${button(link, 'Choose a plan')}`),
    };
  },
  /** Mail written by a SuperAdmin in the mailbox: the text as typed, inside the AltVivo template. */
  adminMessage(subject: string, body: string): Omit<MailMessage, 'to'> {
    return {
      subject,
      text: mailPlainText(body),
      html: layout(subject, renderMailHtml(body),'This message was sent to you by the AltVivo team. You can reply to this email.', true),
    };
  },
};
