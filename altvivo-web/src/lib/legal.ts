import "server-only";

/**
 * Legal identity printed in the policies, read at request time from the web
 * container's environment (altvivo-infra/.env, LEGAL_* and SELLER_*).
 * Contact addresses default to the role mailboxes on altvivo.bio.
 */
export interface LegalInfo {
  entity: string;
  tradeName: string;
  address: string;
  cin: string;
  gstin: string;
  privacyEmail: string;
  supportEmail: string;
  salesEmail: string;
  grievanceName: string;
  grievanceEmail: string;
  grievancePhone: string;
  /** Shown on /about; LEGAL_FOUNDER_* override the built-in founder profile. */
  founderName: string;
  founderRole: string;
  /** Paragraphs separated by a blank line (literal "\n\n" in .env). */
  founderBio: string;
  /** Portrait path or URL (LEGAL_FOUNDER_PHOTO). */
  founderPhoto: string;
  /** City whose courts have jurisdiction (Terms). */
  jurisdictionCity: string;
}

const env = (k: string, fallback = "") => (process.env[k] ?? "").trim() || fallback;

/** Founder shown on /about unless the LEGAL_FOUNDER_* variables replace it. */
const FOUNDER_NAME = "Dr. Vara Prasad Saka";
const FOUNDER_BIO = [
  "Dr. Vara Prasad Saka is a Pharmacologist and scientific writer with over 12 years of experience in experimental research and academic instruction. Holding a Ph.D. in Pharmacology, his core expertise spans in-vivo and in-vitro pharmacology, neurobehavioral studies, and immunomodulatory research. He currently serves as a Research Associate at Dr. Anjali Chatterji Regional Research Institute for Homoeopathy (DACRRIH), Kolkata.",
  "Beyond traditional bench-side laboratory work, he is deeply committed to advancing the 3Rs (Replacement, Reduction, Refinement) in animal testing and modernizing pharmacology education. Recognizing the need to bridge traditional preclinical methodologies with accessible, modern technology, he established Aaron Innovations.",
  "This vision led to the creation of the AltVivo ecosystem, including computational tools like XPRISM and aMaze. By developing browser-native virtual laboratories and automated neurobehavioral tracking applications, his goal is to make rigorous biostatistics and experimental pharmacology tools universally accessible. He combines his extensive background as a published researcher and academic editor for PLOS ONE with a strong push for open-source, tech-driven alternatives that empower the next generation of researchers and students.",
].join("\n\n");

export function legalInfo(): LegalInfo {
  const entity = env("LEGAL_ENTITY_NAME", env("SELLER_LEGAL_NAME", "Aaron Innovations"));
  return {
    entity,
    tradeName: env("SELLER_TRADE_NAME", "AltVivo"),
    address: env("LEGAL_REGISTERED_ADDRESS", env("SELLER_ADDRESS")).replace(/\\n/g, "\n"),
    cin: env("LEGAL_CIN"),
    gstin: env("SELLER_GSTIN"),
    privacyEmail: env("LEGAL_PRIVACY_EMAIL", "privacy@altvivo.bio"),
    supportEmail: env("SUPPORT_EMAIL", "support@altvivo.bio"),
    salesEmail: env("LEGAL_SALES_EMAIL", "sales@altvivo.bio"),
    grievanceName: env("LEGAL_GRIEVANCE_OFFICER_NAME", "Grievance Officer"),
    grievanceEmail: env("LEGAL_GRIEVANCE_OFFICER_EMAIL", "grievance@altvivo.bio"),
    grievancePhone: env("LEGAL_GRIEVANCE_OFFICER_PHONE"),
    founderName: env("LEGAL_FOUNDER_NAME", FOUNDER_NAME),
    founderRole: env("LEGAL_FOUNDER_ROLE", "Founder"),
    founderBio: env("LEGAL_FOUNDER_BIO", FOUNDER_BIO).replace(/\\n/g, "\n"),
    founderPhoto: env("LEGAL_FOUNDER_PHOTO", "/brand/founder.jpg"),
    jurisdictionCity: env("LEGAL_JURISDICTION_CITY", "Bengaluru"),
  };
}

export { POLICY_EFFECTIVE, POLICY_VERSION } from "./policy";
