export type AppStatus = "LIVE" | "BETA" | "COMING_SOON" | "MAINTENANCE";
export type Role = "STUDENT" | "RESEARCHER" | "PI" | "INSTITUTE_ADMIN" | "ADVISORY_BOARD" | "SUPERADMIN";

export interface PublicApp {
  appId: string;
  name: string;
  tagline: string;
  description: string;
  url: string;
  status: AppStatus;
  version: string;
  requiresCredits: boolean;
  phase: number;
  sortOrder: number;
  iconKey: string;
  highlights: string[];
}

export type PlanKind = "SINGLE_APP" | "BUNDLE" | "SITE_LICENSE";
export type Currency = "INR" | "USD";

/** GET /v1/public/plans - prices are minor units, GST-exclusive. */
export interface CatalogPlan {
  planCode: string;
  name: string;
  description: string;
  kind: PlanKind;
  pricingModel: "FLAT" | "PER_SEAT";
  interval: "MONTH" | "YEAR";
  minSeats: number;
  maxSeats: number | null;
  apps: string[];
  features: string[];
  highlighted: boolean;
  gstRateBp: number;
  amountMinor: number;
  prices: Record<Currency, number>;
  renews: "automatically" | "prepaid";
  purchasable: boolean;
  quoteAvailable: boolean;
}

/** An app sold per use: the price of one analysis (one animal / video), before GST. */
export interface PayPerUse {
  appId: string;
  name: string;
  amountMinor: number;
  gstRateBp: number;
  purchasable: boolean;
}

export interface CatalogResponse {
  payPerUse?: PayPerUse[];
  currency: Currency;
  provider: "STRIPE" | "RAZORPAY";
  taxNote: string;
  invoicing: boolean;
  plans: CatalogPlan[];
}

/** GET /v1/public/advisory-board */
export interface AdvisoryMember {
  slug: string;
  honorific: string | null;
  fullName: string;
  credentials: string | null;
  designation: string;
  affiliation: string;
  bio: string;
  photoUrl: string | null;
  photoAlt: string | null;
  specializations: string[];
  orcidId: string | null;
  scholarUrl: string | null;
  linkedinUrl: string | null;
  websiteUrl: string | null;
}

/** Access to one app (paid, or the one-month free access: source "trial"), as returned by the session endpoints. */
export interface ApiEntitlement {
  active: boolean;
  level: "full" | "none";
  source: "trial" | "payg" | "individual" | "bundle" | "institution" | "manual" | "vip" | null;
  plan: string | null;
  expiresAt: string | null;
}

/** GST bill-to details (GET/PUT /v1/api/billing/profile). */
export interface BillingProfile {
  legalName: string;
  gstin: string | null;
  email: string;
  phone: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  stateCode: string | null;
  postalCode: string;
  country: string;
}

export type CheckoutResponse =
  | {
      provider: "RAZORPAY";
      invoiceId: string;
      currency: "INR";
      amountMinor: number;
      razorpay: { keyId: string; orderId: string; amount: number; currency: "INR"; name: string; description: string; prefill: Record<string, string>; notes: Record<string, string> };
    }
  | { provider: "STRIPE"; invoiceId: string; currency: "USD"; amountMinor: number; checkoutUrl: string };

/** Issued document as listed by /v1/api/billing/invoices. */
export interface InvoiceSummary {
  id: string;
  kind: "PROFORMA" | "TAX_INVOICE" | "CREDIT_NOTE";
  status: "ISSUED" | "PAID" | "CANCELLED";
  number: string;
  issuedAt: string;
  paidAt: string | null;
  validUntil: string | null;
  currency: Currency;
  taxTreatment: "INTRA_STATE" | "INTER_STATE" | "EXPORT";
  buyerName: string;
  poNumber: string | null;
  taxableMinor: number;
  taxMinor: number;
  totalMinor: number;
  hasPdf: boolean;
}

/** Shape returned by altvivo-core as `user` (publicUser). */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  orgId: string | null;
  tier: "NONE" | "TRIAL" | "INDIVIDUAL" | "BUNDLE" | "INSTITUTIONAL" | "VIP";
  emailVerified: boolean;
  entitlements: Record<string, ApiEntitlement>;
  creditsRemaining: number;
  mfa: boolean;
  mfaEnrollmentRequired: boolean;
  accessTokenExpiresAt: string;
}

/** GET /v1/api/workspace - live entitlements (not the token's). */
export interface WorkspaceApp extends PublicApp {
  entitlement: ApiEntitlement;
  upgradeUrl: string;
  onWaitlist: boolean;
}

/** A person's "one month free" request (GET /v1/api/workspace, POST /v1/public/trial-request). */
export interface Trial {
  id: string;
  status: "PENDING" | "APPROVED" | "ACTIVE" | "DECLINED";
  days: number;
  appIds: string[];
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  ended: boolean;
}

/** GET /v1/public/trial-offer */
export interface TrialOffer {
  days: number;
  apps: { appId: string; name: string }[];
}

export interface WorkspaceData {
  user: SessionUser;
  creditsRemaining: number;
  trial: Trial | null;
  trialDays: number;
  apps: WorkspaceApp[];
  recentFiles: { id: string; sourceApp: string; fileName: string; fileType: string; sizeBytes: number; createdAt: string }[];
  recentActivity: { id: string; timestamp: string; appId: string; eventType: string; resourceId: string | null; metadata: Record<string, unknown> }[];
}

export interface SubscriptionRow {
  id: string;
  provider: "RAZORPAY" | "STRIPE";
  billingMode: "RECURRING" | "ONE_TIME";
  planCode: string;
  plan: { name: string; kind: PlanKind; interval: "MONTH" | "YEAR"; pricingModel: "FLAT" | "PER_SEAT" };
  status: "PENDING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED";
  currency: Currency;
  seats: number;
  unitAmountMinor: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  scope: "personal" | "organization";
  inForce: boolean;
}

export interface PaymentRow {
  id: string;
  provider: "RAZORPAY" | "STRIPE" | "BANK_TRANSFER";
  status: "CREATED" | "AUTHORIZED" | "CAPTURED" | "FAILED" | "PARTIALLY_REFUNDED" | "REFUNDED";
  currency: Currency;
  amountMinor: number;
  refundedMinor: number;
  method: string | null;
  description: string;
  invoiceId: string | null;
  capturedAt: string | null;
  createdAt: string;
}

export interface AdminApp extends PublicApp {
  statusChangedAt: string;
  statusChangedBy: string | null;
  waitlistTotal: number;
  waitlistPendingNotification: number;
}
