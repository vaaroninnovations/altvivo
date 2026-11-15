import type { CatalogPlan, Currency } from "./types";

/**
 * Minor units -> "₹1,49,900.00" (Indian grouping) or "$1,234.00".
 * `whole` drops ".00" on whole amounts; `round` rounds to whole units (display-only estimates).
 */
export function formatMoney(minor: number, currency: Currency, opts: { whole?: boolean; round?: boolean } = {}): string {
  const major = opts.round ? Math.round(minor / 100) : minor / 100;
  const fraction = opts.round || (opts.whole && Number.isInteger(major)) ? 0 : 2;
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
  }).format(major);
}

/** GST shown on the pricing page. Mirrors the database rounding (half-up per line). */
export function gstEstimate(taxableMinor: number, rateBp: number, currency: Currency) {
  // Exports (USD, customers outside India) are zero-rated under LUT.
  const tax = currency === "INR" ? Math.round((taxableMinor * rateBp) / 10_000) : 0;
  return { taxableMinor, taxMinor: tax, totalMinor: taxableMinor + tax };
}

export function planPrice(plan: CatalogPlan, currency: Currency, seats = 1): number {
  return plan.prices[currency] * (plan.pricingModel === "PER_SEAT" ? seats : 1);
}

/** Monthly equivalent of an annual price (for "₹1,249 / month billed yearly"). */
export const perMonth = (plan: CatalogPlan, currency: Currency) => Math.round(plan.prices[currency] / (plan.interval === "YEAR" ? 12 : 1));

/** GST state / UT codes (CBIC) for the billing address form. */
export const GST_STATES: { code: string; name: string }[] = [
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "18", name: "Assam" },
  { code: "10", name: "Bihar" },
  { code: "04", name: "Chandigarh" },
  { code: "22", name: "Chhattisgarh" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "07", name: "Delhi" },
  { code: "30", name: "Goa" },
  { code: "24", name: "Gujarat" },
  { code: "06", name: "Haryana" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "01", name: "Jammu and Kashmir" },
  { code: "20", name: "Jharkhand" },
  { code: "29", name: "Karnataka" },
  { code: "32", name: "Kerala" },
  { code: "38", name: "Ladakh" },
  { code: "31", name: "Lakshadweep" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "27", name: "Maharashtra" },
  { code: "14", name: "Manipur" },
  { code: "17", name: "Meghalaya" },
  { code: "15", name: "Mizoram" },
  { code: "13", name: "Nagaland" },
  { code: "21", name: "Odisha" },
  { code: "34", name: "Puducherry" },
  { code: "03", name: "Punjab" },
  { code: "08", name: "Rajasthan" },
  { code: "11", name: "Sikkim" },
  { code: "33", name: "Tamil Nadu" },
  { code: "36", name: "Telangana" },
  { code: "16", name: "Tripura" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "05", name: "Uttarakhand" },
  { code: "19", name: "West Bengal" },
  { code: "97", name: "Other Territory" },
];

/** ISO 3166-1 countries offered in the billing form (India first; everything else is billed in USD). */
export const COUNTRIES: { code: string; name: string }[] = [
  { code: "IN", name: "India" },
  ...[
    ["AE", "United Arab Emirates"], ["AU", "Australia"], ["BD", "Bangladesh"], ["BR", "Brazil"], ["CA", "Canada"], ["CH", "Switzerland"],
    ["CN", "China"], ["DE", "Germany"], ["EG", "Egypt"], ["ES", "Spain"], ["FR", "France"], ["GB", "United Kingdom"], ["ID", "Indonesia"],
    ["IE", "Ireland"], ["IT", "Italy"], ["JP", "Japan"], ["KE", "Kenya"], ["KR", "South Korea"], ["LK", "Sri Lanka"], ["MY", "Malaysia"],
    ["NG", "Nigeria"], ["NL", "Netherlands"], ["NP", "Nepal"], ["NZ", "New Zealand"], ["OM", "Oman"], ["PH", "Philippines"], ["PK", "Pakistan"],
    ["QA", "Qatar"], ["SA", "Saudi Arabia"], ["SE", "Sweden"], ["SG", "Singapore"], ["TH", "Thailand"], ["TR", "Türkiye"], ["US", "United States"],
    ["VN", "Vietnam"], ["ZA", "South Africa"],
  ].map(([code, name]) => ({ code: code!, name: name! })),
];

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Same mod-36 checksum the database enforces (av_valid_gstin). */
export function validGstin(v: string): boolean {
  if (!GSTIN_RE.test(v)) return false;
  const A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let total = 0;
  for (let i = 0; i < 14; i += 1) {
    const p = A.indexOf(v[i]!) * (i % 2 === 1 ? 2 : 1);
    total += Math.floor(p / 36) + (p % 36);
  }
  return v[14] === A[(36 - (total % 36)) % 36];
}
