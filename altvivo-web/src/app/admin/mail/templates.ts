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
    id: "advisory-board-invite",
    label: "Invite: Advisory Board member",
    subject: "Invitation to Join the AltVivo Advisory Board as an Advisory Member",
    body: `Dear [Dr./Prof. Last Name],

Greetings from AltVivo!

AltVivo is a platform dedicated to advancing alternatives to animal experimentation in education and research through [virtual laboratories, in-silico models, simulations and training resources]. Our goal is to support the 3Rs (Replacement, Reduction and Refinement) by giving students, educators and researchers credible, scientifically sound tools that reduce reliance on live animals.

In recognition of your distinguished contributions to [field, e.g. pharmacology / toxicology / life sciences education], we are honoured to invite you to join the AltVivo Advisory Board as an Advisory Member.

As an Advisory Member, you would be invited to:
• Offer strategic guidance on the scientific direction and academic relevance of the platform
• Review selected content or modules for scientific accuracy, as and when convenient
• Suggest improvements, emerging research areas and collaboration opportunities
• Help promote ethical, humane and alternative approaches in teaching and research
• Join online advisory meetings, approximately [two] times a year

This is an honorary position. It carries no financial obligation and no fixed time commitment. The term will be [two years], renewable by mutual consent.

Consent for website listing
With your permission, we would like to list you as an Advisory Member on the AltVivo website and in our official communications, with your name, title, designation, institution, a professional photograph and a short bio (50–100 words). Nothing will be published without your approval, and you may ask for your details to be updated or removed at any time.

If you are happy to accept, please reply to this email by [Date] with the statement below, along with your photograph and a short bio:

"I, [Full Name], [Designation] at [Institution], accept the invitation to serve as an Advisory Member of the AltVivo Advisory Board and consent to the display of my name, designation, institution, photograph and bio on the AltVivo website and official communications."

We believe your expertise would be invaluable to AltVivo's mission, and we would be delighted to have you with us. Please feel free to contact me with any questions.

Thank you for considering this invitation.

Warm regards,
[Your Full Name]
[Designation, e.g. Founder & Director]
AltVivo
[Phone] | [Website]`,
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
