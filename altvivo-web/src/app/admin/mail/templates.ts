/**
 * Ready-made messages for the mailbox composer. Choosing one fills the subject
 * and text; edit the parts in [square brackets] before sending. Every mail is
 * wrapped in the AltVivo email template (logo header and footer) by core.
 */
export interface MailTemplate {
  id: string;
  label: string;
  subject: string;
  body: string;
}

export const MAIL_TEMPLATES: MailTemplate[] = [
  {
    id: "welcome",
    label: "Welcome to AltVivo",
    subject: "Welcome to AltVivo",
    body: `Dear [Name],

Welcome to AltVivo, and thank you for joining us.

Your account opens XPRISM (virtual pharmacology laboratory) and aMaze (behaviour video tracking) from one sign-in at https://altvivo.bio/workspace.

A short guide for your role is here: https://altvivo.bio/docs

If anything is unclear, reply to this email and we will help.

Regards,
The AltVivo team`,
  },
  {
    id: "free-month-invite",
    label: "Invite: one month free",
    subject: "Try AltVivo free for one month",
    body: `Dear [Name],

We would like to offer you and your colleagues one month of free, full access to XPRISM and aMaze. No card is needed and nothing is charged when the month ends.

Request it here: https://altvivo.bio/free-month

We review requests within one working day.

Regards,
The AltVivo team`,
  },
  {
    id: "free-month-ending",
    label: "Free month ending soon",
    subject: "Your free month on AltVivo is ending",
    body: `Dear [Name],

Your free month ends on [date]. I hope it has been useful.

To keep working without a break, choose a plan here: https://altvivo.bio/pricing

Your reports and exports stay in your account either way. If you are buying for a department, tell me the number of seats and I will send a quotation.

Regards,
The AltVivo team`,
  },
  {
    id: "quotation",
    label: "Site-licence quotation",
    subject: "AltVivo site licence: your quotation",
    body: `Dear [Name],

Thank you for your interest in a site licence for [Institution].

Seats: [number]
Applications: XPRISM and aMaze
Term: 12 months
Price: [amount] plus GST

A numbered proforma invoice follows separately. It is valid for 30 days and carries our bank details for NEFT / RTGS; please quote its number as the payment reference. The licence starts when payment is received, and a GST tax invoice is issued at once.

Regards,
The AltVivo team`,
  },
  {
    id: "payment-received",
    label: "Payment received",
    subject: "AltVivo: payment received",
    body: `Dear [Name],

We have received your payment of [amount] against [proforma / invoice number]. Thank you.

Your licence is active now, and the tax invoice is available under Billing in your workspace: https://altvivo.bio/workspace/billing

Regards,
The AltVivo team`,
  },
  {
    id: "support-reply",
    label: "Support: we are looking into it",
    subject: "Re: your AltVivo support request",
    body: `Dear [Name],

Thank you for telling us about this. We are looking into it and will write again by [date].

To help us, could you send:
- the application and the experiment or assay you were using
- your browser and operating system
- a screenshot of what you saw

Regards,
AltVivo support`,
  },
  {
    id: "support-resolved",
    label: "Support: resolved",
    subject: "Re: your AltVivo support request",
    body: `Dear [Name],

The problem you reported has been fixed. Please reload the page and try again.

If it happens again, reply to this email and we will reopen it straight away.

Regards,
AltVivo support`,
  },
];
