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
    id: "advisory-board-welcome",
    label: "Welcome: Advisory Board member",
    subject: "Welcome to the AltVivo Advisory Board",
    body: `Dear [Dr./Prof. Last Name],

Thank you for accepting our invitation. It is a pleasure to welcome you to the AltVivo Advisory Board as an Advisory Member.

Your term begins on [start date] and you will remain on the Board until [end date]. The term can be renewed by mutual consent before it ends.

Your profile is now live on the AltVivo website:
https://altvivo.bio/about#[profile-slug]

Please look it over. If you would like any change to your name, designation, institution, photograph or bio, reply to this email and we will update it.

As an Advisory Member, we will invite you to:
• Offer guidance on the scientific direction and academic relevance of the platform
• Review selected content or modules for scientific accuracy, as and when convenient
• Suggest improvements, emerging research areas and collaboration opportunities
• Join online advisory meetings, approximately [two] times a year

This remains an honorary position, with no financial obligation and no fixed time commitment. We will write to you ahead of the first advisory meeting with the agenda.

Thank you once again for lending your expertise to AltVivo's mission of humane, alternative approaches in teaching and research. We look forward to working with you.

Warm regards,
Dr. Vara Prasad Saka
Founder
AltVivo, Vaaron Innovations
hello@altvivo.bio | https://altvivo.bio`,
  },
  {
    id: "xprism-introduction",
    label: "Letter: Introducing XPRISM to a college",
    subject: "Introducing XPRISM – a virtual pharmacology laboratory for B.Pharm and M.Pharm programmes",
    body: `To
The Principal, the Deans and Heads of Department, and all Faculty Members
[Name of the College of Pharmacy]
[City, State]

Respected Sir/Madam,

We are pleased to introduce XPRISM, a web-based virtual pharmacology laboratory that lets pharmacy students perform experiments step by step, the way they would at the bench, without using live animals or costly isolated-tissue setups.

XPRISM presents realistic apparatus, instruments and animal models on screen. Students mount tissues, add drugs, record responses and analyse results themselves, rather than watching a recorded demonstration. The experiments follow the Pharmacy Council of India (PCI) practical syllabus, and support the CPCSEA guidance to replace, reduce and refine animal use in teaching.

XPRISM runs in any modern browser on desktops, laptops and lab computers, so it needs no special hardware and fits easily into your existing practical schedule.

MODULES FOR B.PHARM
XPRISM covers the experiments in the PCI practical syllabus for Pharmacology I, II and III (Semesters V to VII).

Pharmacology I
• Introduction to experimental pharmacology: lab animals, handling, CPCSEA norms, common instruments
• Routes of drug administration: oral, IP, IV, SC and IM dosing in rats and mice, dose calculation
• Drugs on the rabbit eye: mydriasis, miosis and pupil reflex with autonomic drugs
• Local anaesthetics: surface and infiltration anaesthesia models
• Locomotor activity: CNS stimulants and depressants on the actophotometer
• Muscle coordination: skeletal muscle relaxants on the rota-rod
• Anticonvulsant activity: MES and PTZ-induced convulsions
• Anxiolytic activity: elevated plus maze

Pharmacology II
• Dose–response curves: acetylcholine on frog rectus abdominis and rat ileum
• Agonists and antagonists: physostigmine potentiation, d-tubocurarine and atropine blockade
• Histamine and antihistamines: guinea-pig ileum, DRC and antagonism
• Bioassays: matching, bracketing, interpolation, three-point and four-point assays
• pA2 determination: atropine and mepyramine pA2 values
• Isolated heart: drugs on the isolated frog heart
• Blood pressure: drugs on anaesthetised rat/dog BP

Pharmacology III
• Analgesic activity: hot plate and tail-flick methods
• Anti-inflammatory activity: carrageenan-induced paw oedema
• Anti-ulcer and diuretic activity: pylorus ligation, diuretic screening in rats

MODULES FOR M.PHARM
For M.Pharm (Pharmacology), XPRISM goes deeper into quantitative pharmacology and preclinical screening, in line with the PCI M.Pharm practicals.

• Advanced bioassays: pA2 and pD2 values, Schild plots, competitive and non-competitive antagonism
• Receptor pharmacology: agonist affinity and efficacy, cumulative dose–response curves
• CNS screening: antidepressant (forced swim, tail suspension), sedative-hypnotic, antipsychotic and nootropic models
• Cardiovascular screening: isolated heart, BP and anti-arrhythmic models
• Analgesic and anti-inflammatory screening: writhing, hot plate, tail flick, paw oedema, cotton-pellet granuloma
• Metabolic and GI screening: antidiabetic (OGTT, induced diabetes), anti-ulcer and hepatoprotective models
• Toxicity studies: acute and sub-acute toxicity per OECD guidelines, LD50 estimation
• Pharmacokinetics: plasma concentration–time data, AUC, half-life, clearance and volume of distribution
• Research methodology: study design, sample size, statistical analysis and report writing

These modules help postgraduate students plan and rehearse protocols before research work, and reduce the number of animals used during dissertation trials.

FEATURES FOR TEACHERS
XPRISM gives faculty more time to teach and less time setting up apparatus and preparing animals.
• Hands-on, step-by-step experiments: students do every step themselves, from preparing the setup to recording the response, so teachers can check real understanding.
• Classroom demonstration mode: project any experiment in a lecture before the practical session.
• Assign experiments to batches: schedule practicals for a class, a batch or individual students.
• Live progress tracking: see who has started, completed or is stuck on an experiment.
• Automatic records and graphs: observations, tables and dose–response curves are generated for each student, ready for evaluation.
• Built-in assessments: viva questions, quizzes and pre-lab and post-lab questions with automatic scoring.
• Repeatable on demand: students can repeat an experiment as often as needed, with no extra drugs, tissues or animals.
• Teaching support: theory notes, principles and expected results for every module.

FEATURES FOR THE INSTITUTE
For management, XPRISM lowers laboratory costs and strengthens the institute's academic and accreditation profile.
• Ethical, CPCSEA-friendly teaching: cuts animal use in routine UG practicals and supports the 3Rs (replace, reduce, refine).
• Lower running costs: fewer animals, drugs, tissues, chemicals and less equipment maintenance.
• Central admin dashboard: manage departments, faculty, batches and student accounts from one place.
• Reports for NAAC, NBA and PCI inspections: usage, attendance and performance reports ready to download.
• Access anywhere: students can practise in the lab, library or at home on any browser.
• Scales with intake: one licence covers B.Pharm and M.Pharm batches, with no extra lab space needed.
• Training and support: onboarding for faculty and ongoing technical support from our team.
• Modern, innovative image: shows prospective students and visiting committees that the institute uses current teaching technology.

OUR REQUEST
We would be glad to arrange a free live demonstration of XPRISM for your faculty at a date that suits you, followed by a trial for one batch of students. We are confident it will add real value to the practical training at your institute.

Please reply to this email or call us at [Phone] to schedule the demonstration. You can also see XPRISM at https://altvivo.bio.

Thank you for your time and consideration.

Yours sincerely,
Dr. Vara Prasad Saka
Founder
XPRISM by AltVivo, Vaaron Innovations
[Phone] · hello@altvivo.bio · https://altvivo.bio`,
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
