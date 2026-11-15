/** Topics of the contact form; values match altvivo-core's contact categories. */
export const CONTACT_CATEGORIES = [
  { value: "sales", label: "Individual or lab licence" },
  { value: "institutional", label: "Institutional / site licence, quotation or PO" },
  { value: "support", label: "Technical support" },
  { value: "billing", label: "Billing, invoices or GST" },
  { value: "partnership", label: "Research or academic collaboration" },
  { value: "press", label: "Press" },
  { value: "privacy", label: "Privacy or data request" },
  { value: "other", label: "Something else" },
] as const;

export type ContactCategory = (typeof CONTACT_CATEGORIES)[number]["value"];
