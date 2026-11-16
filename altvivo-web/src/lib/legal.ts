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
  /** Shown on /about; empty until LEGAL_FOUNDER_NAME is set. */
  founderName: string;
  founderRole: string;
  /** Paragraphs separated by a blank line (literal "\n\n" in .env). */
  founderBio: string;
  /** City whose courts have jurisdiction (Terms). */
  jurisdictionCity: string;
}

const env = (k: string, fallback = "") => (process.env[k] ?? "").trim() || fallback;

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
    founderName: env("LEGAL_FOUNDER_NAME"),
    founderRole: env("LEGAL_FOUNDER_ROLE", `Started and leads ${entity}`),
    founderBio: env("LEGAL_FOUNDER_BIO").replace(/\\n/g, "\n"),
    jurisdictionCity: env("LEGAL_JURISDICTION_CITY", "Bengaluru"),
  };
}

export { POLICY_EFFECTIVE, POLICY_VERSION } from "./policy";
