import "server-only";

const env = (k: string) => (process.env[k] ?? "").trim();

/**
 * Search-engine and analytics settings, read at request time from the web
 * container's environment (altvivo-infra/.env). Everything is optional.
 */
export function seo() {
  const ga = env("GA_MEASUREMENT_ID");
  return {
    /** content="" value of Google Search Console's HTML-tag verification. */
    googleSiteVerification: env("GOOGLE_SITE_VERIFICATION"),
    /** content="" value of Bing Webmaster Tools' meta-tag verification. */
    bingSiteVerification: env("BING_SITE_VERIFICATION"),
    /** Google Analytics 4 measurement ID; anything that is not G-XXXX is ignored. */
    gaMeasurementId: /^G-[A-Z0-9]{4,16}$/.test(ga) ? ga : "",
  };
}
