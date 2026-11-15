-- =============================================================================
-- AltVivo db_core: strict paid access, GST billing, advisory board CMS
-- -----------------------------------------------------------------------------
-- Revised commercial model (no free tier, no trials):
--   * access to a spoke = a paid grant in force (own subscription, Dual-Suite
--     bundle, institution site licence, or a SUPERADMIN manual licence)
--   * ADVISORY_BOARD role (VIP bypass is applied by altvivo-core)
--   * payments, GST tax invoices / proforma invoices / credit notes with
--     gapless numbering and trigger-computed tax
--   * advisory board CMS, contact enquiries, cookie-consent evidence
--
--  1. Retire the free-tier / early-bird objects
--  2. Enums
--  3. Table changes (existing data mapped, not discarded)
--  4. New tables, indexes, foreign keys
--  5. CHECK constraints
--  6. Institutions: seat limits, suspension
--  7. Subscriptions + entitlement materialisation, manual licences
--  8. Access resolution (JWT `entitlements` claim, /v1/auth/verify)
--  9. Payments state machine
-- 10. Invoices: tax maths, gapless numbering, immutability
-- 11. Consent evidence (append-only)
-- 12. Row-change audit, reporting views
-- 13. Privileges
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Retire the free-tier / early-bird objects
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS app_registry_launch ON app_registry;
DROP FUNCTION IF EXISTS app_registry_after_status_change();
DROP FUNCTION IF EXISTS apply_launch_unlocks(text);
DROP FUNCTION IF EXISTS user_effective_entitlements(uuid);
DROP TRIGGER IF EXISTS subscriptions_sync_entitlements ON subscriptions;
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_canceled_chk;
ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_seats_chk;
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_seat_limit_chk;

-- -----------------------------------------------------------------------------
-- 2. Enums
-- -----------------------------------------------------------------------------
CREATE TYPE "organization_kind" AS ENUM ('UNIVERSITY', 'COLLEGE', 'RESEARCH_INSTITUTE', 'HOSPITAL', 'COMPANY', 'GOVERNMENT', 'OTHER');
CREATE TYPE "organization_status" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "plan_kind" AS ENUM ('SINGLE_APP', 'BUNDLE', 'SITE_LICENSE');
CREATE TYPE "pricing_model" AS ENUM ('FLAT', 'PER_SEAT');
CREATE TYPE "billing_mode" AS ENUM ('RECURRING', 'ONE_TIME');
CREATE TYPE "entitlement_source" AS ENUM ('SUBSCRIPTION', 'MANUAL');
CREATE TYPE "payment_provider" AS ENUM ('RAZORPAY', 'STRIPE', 'BANK_TRANSFER');
CREATE TYPE "payment_status" AS ENUM ('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED');
CREATE TYPE "invoice_kind" AS ENUM ('PROFORMA', 'TAX_INVOICE', 'CREDIT_NOTE');
CREATE TYPE "invoice_status" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'CANCELLED');
CREATE TYPE "tax_treatment" AS ENUM ('INTRA_STATE', 'INTER_STATE', 'EXPORT');
CREATE TYPE "contact_status" AS ENUM ('NEW', 'IN_PROGRESS', 'CLOSED', 'SPAM');
CREATE TYPE "consent_action" AS ENUM ('ACCEPT_ALL', 'REJECT_NON_ESSENTIAL', 'CUSTOM', 'WITHDRAW');

-- New role. Not referenced as a literal anywhere in this migration (a value
-- added by ALTER TYPE cannot be used in the same transaction).
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'ADVISORY_BOARD' BEFORE 'SUPERADMIN';

-- access_level: NONE | FULL. Waitlist / trial levels never granted paid access.
ALTER TABLE "app_registry" ALTER COLUMN "default_access_level" DROP DEFAULT;
CREATE TYPE "access_level_new" AS ENUM ('NONE', 'FULL');
ALTER TABLE "plan_entitlements" ALTER COLUMN "access_level" TYPE "access_level_new"
  USING (CASE WHEN "access_level"::text IN ('BASIC', 'PRO', 'FULL') THEN 'FULL' ELSE 'NONE' END)::"access_level_new";
ALTER TABLE "app_entitlements" ALTER COLUMN "access_level" TYPE "access_level_new"
  USING (CASE WHEN "access_level"::text IN ('BASIC', 'PRO', 'FULL') THEN 'FULL' ELSE 'NONE' END)::"access_level_new";
ALTER TABLE "app_registry" DROP COLUMN "default_access_level";
ALTER TYPE "access_level" RENAME TO "access_level_old";
ALTER TYPE "access_level_new" RENAME TO "access_level";
DROP TYPE "access_level_old";

-- subscription_status: TRIALING no longer exists; a trial was never paid.
CREATE TYPE "subscription_status_new" AS ENUM ('PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');
ALTER TABLE "subscriptions" ALTER COLUMN "status" TYPE "subscription_status_new"
  USING (CASE WHEN "status"::text = 'TRIALING' THEN 'PENDING' ELSE "status"::text END)::"subscription_status_new";
ALTER TYPE "subscription_status" RENAME TO "subscription_status_old";
ALTER TYPE "subscription_status_new" RENAME TO "subscription_status";
DROP TYPE "subscription_status_old";

-- -----------------------------------------------------------------------------
-- 3. Table changes
-- -----------------------------------------------------------------------------
ALTER TABLE "users" ADD COLUMN "disabled_reason" VARCHAR(500);

ALTER TABLE "organizations"
  ADD COLUMN "contact_email" CITEXT,
  ADD COLUMN "contact_name" VARCHAR(200),
  ADD COLUMN "contact_phone" VARCHAR(20),
  ADD COLUMN "kind" "organization_kind" NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "notes" VARCHAR(2000),
  ADD COLUMN "status" "organization_status" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "suspended_at" TIMESTAMPTZ(6);
ALTER TABLE "organizations" DROP COLUMN "subscription_tier";

ALTER TABLE "plan_entitlements" DROP COLUMN "unlock_on_launch",
  ALTER COLUMN "access_level" SET DEFAULT 'FULL';

-- Plans: kind / seat range replace the old tier + fixed seat count. The
-- pre-revision catalogue (individual, PI lab, institutional) is removed when
-- nothing references it, and otherwise retired (inactive, hidden).
ALTER TABLE "plans"
  ADD COLUMN "description" VARCHAR(500) NOT NULL DEFAULT '',
  ADD COLUMN "gst_rate_bp" SMALLINT NOT NULL DEFAULT 1800,
  ADD COLUMN "highlighted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "kind" "plan_kind",
  ADD COLUMN "max_seats" INTEGER,
  ADD COLUMN "min_seats" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "pricing_model" "pricing_model" NOT NULL DEFAULT 'FLAT',
  ADD COLUMN "sac_code" VARCHAR(8) NOT NULL DEFAULT '997331';
UPDATE "plans"
   SET "kind"      = CASE WHEN "tier"::text LIKE 'INSTITUTIONAL%' THEN 'SITE_LICENSE' ELSE 'BUNDLE' END::"plan_kind",
       "min_seats" = 1,
       "max_seats" = "seats";
DELETE FROM "plans" p
 WHERE p."plan_code" IN ('individual_monthly', 'individual_yearly', 'pi_lab_monthly', 'pi_lab_yearly', 'institutional_yearly')
   AND NOT EXISTS (SELECT 1 FROM "subscriptions" s WHERE s."plan_code" = p."plan_code");
UPDATE "plans" SET "active" = false, "is_public" = false
 WHERE "plan_code" IN ('individual_monthly', 'individual_yearly', 'pi_lab_monthly', 'pi_lab_yearly', 'institutional_yearly');
ALTER TABLE "plans" ALTER COLUMN "kind" SET NOT NULL;
ALTER TABLE "plans" DROP COLUMN "seats", DROP COLUMN "tier";
DROP TYPE "subscription_tier";

-- Subscriptions: one-time prepaid terms, frozen unit price, period start/end.
ALTER TABLE "subscriptions"
  ADD COLUMN "billing_mode" "billing_mode" NOT NULL DEFAULT 'RECURRING',
  ADD COLUMN "current_period_start" TIMESTAMPTZ(6),
  ADD COLUMN "ended_at" TIMESTAMPTZ(6),
  ADD COLUMN "unit_amount_minor" BIGINT NOT NULL DEFAULT 0,
  ALTER COLUMN "external_sub_id" DROP NOT NULL;
UPDATE "subscriptions" s
   SET "unit_amount_minor" = CASE s."currency" WHEN 'INR' THEN p."price_inr_paise" ELSE p."price_usd_cents" END,
       "ended_at" = CASE WHEN s."status" IN ('CANCELED', 'EXPIRED') THEN coalesce(s."canceled_at", s."updated_at") END
  FROM "plans" p
 WHERE p."plan_code" = s."plan_code";
ALTER TABLE "subscriptions" ALTER COLUMN "unit_amount_minor" DROP DEFAULT;

-- Entitlements: subscription-derived OR manual licences held by a user / org.
ALTER TABLE "app_entitlements"
  ADD COLUMN "granted_by" UUID,
  ADD COLUMN "org_id" UUID,
  ADD COLUMN "reason" VARCHAR(500),
  ADD COLUMN "reference" VARCHAR(120),
  ADD COLUMN "revoke_reason" VARCHAR(500),
  ADD COLUMN "revoked_at" TIMESTAMPTZ(6),
  ADD COLUMN "revoked_by" UUID,
  ADD COLUMN "source" "entitlement_source" NOT NULL DEFAULT 'SUBSCRIPTION',
  ADD COLUMN "starts_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "user_id" UUID,
  ALTER COLUMN "sub_id" DROP NOT NULL,
  ALTER COLUMN "access_level" SET DEFAULT 'FULL';
-- Subscription rows carry their term on the subscription itself.
UPDATE "app_entitlements" SET "expires_at" = NULL WHERE "expires_at" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. New tables
-- -----------------------------------------------------------------------------
CREATE TABLE "billing_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "org_id" UUID,
    "legal_name" VARCHAR(200) NOT NULL,
    "gstin" VARCHAR(15),
    "email" CITEXT NOT NULL,
    "phone" VARCHAR(20),
    "address_line1" VARCHAR(200) NOT NULL,
    "address_line2" VARCHAR(200),
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(100),
    "state_code" CHAR(2),
    "postal_code" VARCHAR(12) NOT NULL,
    "country" CHAR(2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" "payment_provider" NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'CREATED',
    "user_id" UUID,
    "org_id" UUID,
    "subscription_id" UUID,
    "invoice_id" UUID,
    "plan_code" VARCHAR(64),
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "tax_minor" BIGINT NOT NULL DEFAULT 0,
    "refunded_minor" BIGINT NOT NULL DEFAULT 0,
    "fee_minor" BIGINT,
    "method" VARCHAR(32),
    "provider_order_id" VARCHAR(255),
    "provider_payment_id" VARCHAR(255),
    "reference" VARCHAR(120),
    "description" VARCHAR(300) NOT NULL,
    "failure_code" VARCHAR(64),
    "failure_reason" VARCHAR(500),
    "recorded_by" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "captured_at" TIMESTAMPTZ(6),
    "refunded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "invoice_kind" NOT NULL,
    "status" "invoice_status" NOT NULL DEFAULT 'DRAFT',
    "number" VARCHAR(16),
    "financial_year" VARCHAR(7),
    "user_id" UUID,
    "org_id" UUID,
    "subscription_id" UUID,
    "related_invoice_id" UUID,
    "currency" CHAR(3) NOT NULL,
    "tax_treatment" "tax_treatment" NOT NULL,
    "seller_legal_name" VARCHAR(200) NOT NULL,
    "seller_gstin" VARCHAR(15),
    "seller_address" VARCHAR(600) NOT NULL,
    "seller_state_code" CHAR(2) NOT NULL,
    "buyer_name" VARCHAR(200) NOT NULL,
    "buyer_email" CITEXT NOT NULL,
    "buyer_gstin" VARCHAR(15),
    "buyer_address" VARCHAR(600) NOT NULL,
    "buyer_state_code" CHAR(2),
    "buyer_country" CHAR(2) NOT NULL,
    "place_of_supply" CHAR(2) NOT NULL,
    "po_number" VARCHAR(64),
    "notes" VARCHAR(2000),
    "subtotal_minor" BIGINT NOT NULL DEFAULT 0,
    "discount_minor" BIGINT NOT NULL DEFAULT 0,
    "taxable_minor" BIGINT NOT NULL DEFAULT 0,
    "cgst_minor" BIGINT NOT NULL DEFAULT 0,
    "sgst_minor" BIGINT NOT NULL DEFAULT 0,
    "igst_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "valid_until" DATE,
    "due_date" DATE,
    "issued_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" VARCHAR(500),
    "pdf_object_key" VARCHAR(1024),
    "pdf_sha256" CHAR(64),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "sac_code" VARCHAR(8) NOT NULL,
    "app_id" VARCHAR(32),
    "plan_code" VARCHAR(64),
    "quantity" INTEGER NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "discount_minor" BIGINT NOT NULL DEFAULT 0,
    "gst_rate_bp" SMALLINT NOT NULL,
    "taxable_minor" BIGINT NOT NULL DEFAULT 0,
    "cgst_minor" BIGINT NOT NULL DEFAULT 0,
    "sgst_minor" BIGINT NOT NULL DEFAULT 0,
    "igst_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "period_start" DATE,
    "period_end" DATE,
    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invoice_series" (
    "prefix" VARCHAR(4) NOT NULL,
    "financial_year" VARCHAR(7) NOT NULL,
    "last_number" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invoice_series_pkey" PRIMARY KEY ("prefix","financial_year")
);

CREATE TABLE "advisory_board_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(80) NOT NULL,
    "honorific" VARCHAR(20),
    "full_name" VARCHAR(200) NOT NULL,
    "credentials" VARCHAR(200),
    "designation" VARCHAR(200) NOT NULL,
    "affiliation" VARCHAR(300) NOT NULL,
    "bio" VARCHAR(5000) NOT NULL,
    "photo_url" VARCHAR(1024),
    "photo_alt" VARCHAR(300),
    "specializations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "orcid_id" VARCHAR(19),
    "scholar_url" VARCHAR(500),
    "linkedin_url" VARCHAR(500),
    "website_url" VARCHAR(500),
    "sort_order" SMALLINT NOT NULL DEFAULT 100,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "user_id" UUID,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "advisory_board_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contact_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "email" CITEXT NOT NULL,
    "institution" VARCHAR(300),
    "category" VARCHAR(32) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "message" VARCHAR(5000) NOT NULL,
    "app_id" VARCHAR(32),
    "user_id" UUID,
    "ip_address" INET,
    "user_agent" VARCHAR(512),
    "status" "contact_status" NOT NULL DEFAULT 'NEW',
    "handled_by" UUID,
    "handled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "consent_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subject_id" UUID NOT NULL,
    "user_id" UUID,
    "policy_version" VARCHAR(32) NOT NULL,
    "action" "consent_action" NOT NULL,
    "functional" BOOLEAN NOT NULL DEFAULT false,
    "analytics" BOOLEAN NOT NULL DEFAULT false,
    "marketing" BOOLEAN NOT NULL DEFAULT false,
    "ip_hash" CHAR(64),
    "user_agent" VARCHAR(512),
    "source" VARCHAR(32) NOT NULL DEFAULT 'banner',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_profiles_user_id_key" ON "billing_profiles"("user_id");
CREATE UNIQUE INDEX "billing_profiles_org_id_key" ON "billing_profiles"("org_id");
CREATE INDEX "payments_provider_order_id_idx" ON "payments"("provider_order_id");
CREATE INDEX "payments_user_id_created_at_idx" ON "payments"("user_id", "created_at");
CREATE INDEX "payments_org_id_created_at_idx" ON "payments"("org_id", "created_at");
CREATE INDEX "payments_status_captured_at_idx" ON "payments"("status", "captured_at");
CREATE INDEX "payments_invoice_id_idx" ON "payments"("invoice_id");
CREATE UNIQUE INDEX "payments_provider_provider_payment_id_key" ON "payments"("provider", "provider_payment_id");
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");
CREATE INDEX "invoices_user_id_created_at_idx" ON "invoices"("user_id", "created_at");
CREATE INDEX "invoices_org_id_created_at_idx" ON "invoices"("org_id", "created_at");
CREATE INDEX "invoices_kind_status_issued_at_idx" ON "invoices"("kind", "status", "issued_at");
CREATE INDEX "invoices_subscription_id_idx" ON "invoices"("subscription_id");
CREATE UNIQUE INDEX "invoice_lines_invoice_id_position_key" ON "invoice_lines"("invoice_id", "position");
CREATE UNIQUE INDEX "advisory_board_members_slug_key" ON "advisory_board_members"("slug");
CREATE UNIQUE INDEX "advisory_board_members_user_id_key" ON "advisory_board_members"("user_id");
CREATE INDEX "advisory_board_members_is_published_sort_order_idx" ON "advisory_board_members"("is_published", "sort_order");
CREATE INDEX "contact_messages_status_created_at_idx" ON "contact_messages"("status", "created_at");
CREATE INDEX "contact_messages_email_idx" ON "contact_messages"("email");
CREATE INDEX "consent_records_subject_id_created_at_idx" ON "consent_records"("subject_id", "created_at" DESC);
CREATE INDEX "consent_records_user_id_created_at_idx" ON "consent_records"("user_id", "created_at" DESC);
CREATE INDEX "app_entitlements_user_id_app_id_idx" ON "app_entitlements"("user_id", "app_id");
CREATE INDEX "app_entitlements_org_id_app_id_idx" ON "app_entitlements"("org_id", "app_id");
CREATE INDEX "app_entitlements_source_expires_at_idx" ON "app_entitlements"("source", "expires_at");
CREATE INDEX "organizations_status_idx" ON "organizations"("status");
CREATE INDEX "plans_kind_active_sort_order_idx" ON "plans"("kind", "active", "sort_order");
CREATE INDEX "subscriptions_status_current_period_end_idx" ON "subscriptions"("status", "current_period_end");

ALTER TABLE "app_entitlements" ADD CONSTRAINT "app_entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "app_entitlements" ADD CONSTRAINT "app_entitlements_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_profiles" ADD CONSTRAINT "billing_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_profiles" ADD CONSTRAINT "billing_profiles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_plan_code_fkey" FOREIGN KEY ("plan_code") REFERENCES "plans"("plan_code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_related_invoice_id_fkey" FOREIGN KEY ("related_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "app_registry"("app_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_plan_code_fkey" FOREIGN KEY ("plan_code") REFERENCES "plans"("plan_code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "advisory_board_members" ADD CONSTRAINT "advisory_board_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "app_registry"("app_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 5. CHECK constraints
-- -----------------------------------------------------------------------------

-- GSTIN: 2-digit state code, PAN, entity number, 'Z', mod-36 check character.
CREATE FUNCTION av_valid_gstin(p text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  total    integer := 0;
  v        integer;
  i        integer;
BEGIN
  IF p IS NULL THEN RETURN true; END IF;
  IF p !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' THEN RETURN false; END IF;
  FOR i IN 1..14 LOOP
    v := (strpos(alphabet, substr(p, i, 1)) - 1) * CASE WHEN i % 2 = 0 THEN 2 ELSE 1 END;
    total := total + (v / 36) + (v % 36);
  END LOOP;
  RETURN substr(p, 15, 1) = substr(alphabet, ((36 - total % 36) % 36) + 1, 1);
END;
$$;

CREATE FUNCTION av_valid_email(p text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT p IS NULL OR (p ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(p) <= 254); $$;

-- GST state / UT codes (01-38, 97 other territory). 96 = outside India.
CREATE FUNCTION av_valid_state_code(p text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT p IS NULL OR (p ~ '^[0-9]{2}$' AND (p::int BETWEEN 1 AND 38 OR p = '97')); $$;

CREATE FUNCTION av_valid_tags(p_tags text[], p_max_len integer)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT coalesce(bool_and(t IS NOT NULL AND length(btrim(t)) BETWEEN 1 AND p_max_len), true) FROM unnest(p_tags) AS t;
$$;

ALTER TABLE users
  ADD CONSTRAINT users_disabled_reason_chk CHECK (disabled_reason IS NULL OR disabled_at IS NOT NULL);

ALTER TABLE organizations
  ADD CONSTRAINT organizations_seat_limit_chk CHECK (seat_limit > 0 AND seat_limit <= 100000),
  ADD CONSTRAINT organizations_contact_email_chk CHECK (av_valid_email(contact_email)),
  ADD CONSTRAINT organizations_contact_phone_chk CHECK (contact_phone IS NULL OR contact_phone ~ '^\+?[0-9][0-9 ()-]{5,19}$'),
  ADD CONSTRAINT organizations_suspended_chk CHECK ((status = 'SUSPENDED') = (suspended_at IS NOT NULL));

ALTER TABLE plans
  ADD CONSTRAINT plans_seats_chk CHECK (min_seats >= 1 AND (max_seats IS NULL OR max_seats >= min_seats)),
  ADD CONSTRAINT plans_pricing_model_chk CHECK (pricing_model = 'FLAT' OR kind = 'SITE_LICENSE'),
  ADD CONSTRAINT plans_sac_chk CHECK (sac_code ~ '^[0-9]{4,8}$'),
  ADD CONSTRAINT plans_gst_rate_chk CHECK (gst_rate_bp BETWEEN 0 AND 2800),
  ADD CONSTRAINT plans_name_chk CHECK (length(btrim(name)) > 0);

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_canceled_chk CHECK (status <> 'CANCELED' OR canceled_at IS NOT NULL),
  ADD CONSTRAINT subscriptions_ended_chk CHECK (status NOT IN ('CANCELED', 'EXPIRED') OR ended_at IS NOT NULL),
  ADD CONSTRAINT subscriptions_external_chk CHECK (billing_mode = 'ONE_TIME' OR external_sub_id IS NOT NULL),
  ADD CONSTRAINT subscriptions_amount_chk CHECK (unit_amount_minor >= 0),
  ADD CONSTRAINT subscriptions_period_chk CHECK (current_period_start IS NULL OR current_period_start < current_period_end);

ALTER TABLE app_entitlements
  ADD CONSTRAINT app_entitlements_subscription_chk CHECK (
    source <> 'SUBSCRIPTION'
    OR (sub_id IS NOT NULL AND user_id IS NULL AND org_id IS NULL AND granted_by IS NULL AND expires_at IS NULL)),
  ADD CONSTRAINT app_entitlements_manual_chk CHECK (
    source <> 'MANUAL'
    OR (sub_id IS NULL AND num_nonnulls(user_id, org_id) = 1 AND granted_by IS NOT NULL
        AND length(btrim(coalesce(reason, ''))) > 0 AND expires_at IS NOT NULL AND expires_at > starts_at)),
  ADD CONSTRAINT app_entitlements_revoke_chk CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND length(btrim(coalesce(revoke_reason, ''))) > 0));

ALTER TABLE billing_profiles
  ADD CONSTRAINT billing_profiles_owner_chk CHECK (num_nonnulls(user_id, org_id) = 1),
  ADD CONSTRAINT billing_profiles_name_chk CHECK (length(btrim(legal_name)) > 0),
  ADD CONSTRAINT billing_profiles_email_chk CHECK (av_valid_email(email)),
  ADD CONSTRAINT billing_profiles_gstin_chk CHECK (av_valid_gstin(gstin)),
  ADD CONSTRAINT billing_profiles_country_chk CHECK (country ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT billing_profiles_state_code_chk CHECK (av_valid_state_code(state_code)),
  ADD CONSTRAINT billing_profiles_india_chk CHECK (
    country <> 'IN' OR (state_code IS NOT NULL AND postal_code ~ '^[1-9][0-9]{5}$')),
  ADD CONSTRAINT billing_profiles_gstin_state_chk CHECK (
    gstin IS NULL OR (country = 'IN' AND substr(gstin, 1, 2) = state_code)),
  ADD CONSTRAINT billing_profiles_phone_chk CHECK (phone IS NULL OR phone ~ '^\+?[0-9][0-9 ()-]{5,19}$');

ALTER TABLE payments
  ADD CONSTRAINT payments_owner_chk CHECK (num_nonnulls(user_id, org_id) = 1),
  ADD CONSTRAINT payments_currency_chk CHECK (currency IN ('INR', 'USD')),
  ADD CONSTRAINT payments_razorpay_inr_chk CHECK (provider <> 'RAZORPAY' OR currency = 'INR'),
  ADD CONSTRAINT payments_amount_chk CHECK (
    amount_minor > 0 AND tax_minor >= 0 AND tax_minor <= amount_minor
    AND refunded_minor >= 0 AND refunded_minor <= amount_minor AND (fee_minor IS NULL OR fee_minor >= 0)),
  ADD CONSTRAINT payments_captured_chk CHECK (
    status NOT IN ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED') OR captured_at IS NOT NULL),
  ADD CONSTRAINT payments_refund_state_chk CHECK (
    CASE status
      WHEN 'REFUNDED' THEN refunded_minor = amount_minor AND refunded_at IS NOT NULL
      WHEN 'PARTIALLY_REFUNDED' THEN refunded_minor > 0 AND refunded_minor < amount_minor AND refunded_at IS NOT NULL
      ELSE refunded_minor = 0
    END),
  ADD CONSTRAINT payments_online_ref_chk CHECK (
    provider = 'BANK_TRANSFER' OR num_nonnulls(provider_order_id, provider_payment_id) >= 1),
  ADD CONSTRAINT payments_offline_chk CHECK (
    provider <> 'BANK_TRANSFER' OR (recorded_by IS NOT NULL AND length(btrim(coalesce(reference, ''))) > 0)),
  ADD CONSTRAINT payments_method_chk CHECK (method IS NULL OR method ~ '^[a-z_]{2,32}$'),
  ADD CONSTRAINT payments_metadata_chk CHECK (jsonb_typeof(metadata) = 'object');

ALTER TABLE invoices
  ADD CONSTRAINT invoices_owner_chk CHECK (num_nonnulls(user_id, org_id) = 1),
  ADD CONSTRAINT invoices_currency_chk CHECK (currency IN ('INR', 'USD') AND (tax_treatment = 'EXPORT' OR currency = 'INR')),
  ADD CONSTRAINT invoices_export_chk CHECK ((tax_treatment = 'EXPORT') = (buyer_country <> 'IN')),
  ADD CONSTRAINT invoices_buyer_country_chk CHECK (buyer_country ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT invoices_seller_state_chk CHECK (av_valid_state_code(seller_state_code)),
  ADD CONSTRAINT invoices_seller_gstin_chk CHECK (
    av_valid_gstin(seller_gstin) AND (seller_gstin IS NULL OR substr(seller_gstin, 1, 2) = seller_state_code)),
  ADD CONSTRAINT invoices_buyer_state_chk CHECK (
    av_valid_state_code(buyer_state_code) AND (buyer_country <> 'IN' OR buyer_state_code IS NOT NULL)),
  ADD CONSTRAINT invoices_buyer_gstin_chk CHECK (
    av_valid_gstin(buyer_gstin)
    AND (buyer_gstin IS NULL OR (buyer_country = 'IN' AND substr(buyer_gstin, 1, 2) = buyer_state_code))),
  -- Place of supply for services (IGST Act s.12): the recipient's location.
  ADD CONSTRAINT invoices_place_of_supply_chk CHECK (
    CASE tax_treatment
      WHEN 'EXPORT'      THEN place_of_supply = '96'
      WHEN 'INTRA_STATE' THEN place_of_supply = seller_state_code AND place_of_supply = buyer_state_code
      ELSE place_of_supply <> seller_state_code AND place_of_supply = buyer_state_code
    END),
  ADD CONSTRAINT invoices_number_chk CHECK (
    (status = 'DRAFT' AND number IS NULL AND financial_year IS NULL AND issued_at IS NULL)
    OR (status <> 'DRAFT' AND number ~ '^(AV|PF|CN)/[0-9]{4}-[0-9]{2}/[0-9]{5}$'
        AND financial_year ~ '^[0-9]{4}-[0-9]{2}$' AND issued_at IS NOT NULL)),
  ADD CONSTRAINT invoices_paid_chk CHECK ((status = 'PAID') = (paid_at IS NOT NULL)),
  ADD CONSTRAINT invoices_cancelled_chk CHECK (
    (status = 'CANCELLED') = (cancelled_at IS NOT NULL)
    AND (status <> 'CANCELLED' OR length(btrim(coalesce(cancel_reason, ''))) > 0)),
  ADD CONSTRAINT invoices_credit_note_chk CHECK (kind <> 'CREDIT_NOTE' OR (related_invoice_id IS NOT NULL AND status <> 'PAID')),
  ADD CONSTRAINT invoices_pdf_chk CHECK (
    num_nulls(pdf_object_key, pdf_sha256) IN (0, 2)
    AND (pdf_sha256 IS NULL OR pdf_sha256 ~ '^[0-9a-f]{64}$')
    AND (pdf_object_key IS NULL OR (pdf_object_key ~ '^[A-Za-z0-9!_.*''()/-]+$' AND pdf_object_key !~ '(^/|\.\./|//)'))),
  ADD CONSTRAINT invoices_amounts_chk CHECK (
    subtotal_minor >= 0 AND discount_minor >= 0 AND taxable_minor >= 0
    AND cgst_minor >= 0 AND sgst_minor >= 0 AND igst_minor >= 0 AND total_minor >= 0),
  ADD CONSTRAINT invoices_buyer_chk CHECK (length(btrim(buyer_name)) > 0 AND av_valid_email(buyer_email)),
  ADD CONSTRAINT invoices_seller_chk CHECK (length(btrim(seller_legal_name)) > 0 AND length(btrim(seller_address)) > 0);

ALTER TABLE invoice_lines
  ADD CONSTRAINT invoice_lines_position_chk CHECK (position > 0),
  ADD CONSTRAINT invoice_lines_description_chk CHECK (length(btrim(description)) > 0),
  ADD CONSTRAINT invoice_lines_sac_chk CHECK (sac_code ~ '^[0-9]{4,8}$'),
  ADD CONSTRAINT invoice_lines_amounts_chk CHECK (
    quantity > 0 AND quantity <= 100000 AND unit_price_minor >= 0 AND discount_minor >= 0),
  ADD CONSTRAINT invoice_lines_rate_chk CHECK (gst_rate_bp BETWEEN 0 AND 2800),
  ADD CONSTRAINT invoice_lines_period_chk CHECK (period_start IS NULL OR period_end IS NULL OR period_end >= period_start);

ALTER TABLE invoice_series
  ADD CONSTRAINT invoice_series_prefix_chk CHECK (prefix IN ('AV', 'PF', 'CN')),
  ADD CONSTRAINT invoice_series_fy_chk CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  ADD CONSTRAINT invoice_series_number_chk CHECK (last_number BETWEEN 1 AND 99999);

ALTER TABLE advisory_board_members
  ADD CONSTRAINT advisory_slug_chk CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT advisory_text_chk CHECK (
    length(btrim(full_name)) > 0 AND length(btrim(designation)) > 0
    AND length(btrim(affiliation)) > 0 AND length(btrim(bio)) > 0),
  ADD CONSTRAINT advisory_orcid_chk CHECK (orcid_id IS NULL OR orcid_id ~ '^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$'),
  ADD CONSTRAINT advisory_photo_chk CHECK (photo_url IS NULL OR (photo_url ~ '^https://[^\s<>"]+$' AND photo_alt IS NOT NULL)),
  ADD CONSTRAINT advisory_scholar_chk CHECK (scholar_url IS NULL OR scholar_url ~ '^https://scholar\.google\.[a-z.]{2,10}/[^\s<>"]*$'),
  ADD CONSTRAINT advisory_linkedin_chk CHECK (linkedin_url IS NULL OR linkedin_url ~ '^https://([a-z]{2,3}\.)?linkedin\.com/[^\s<>"]*$'),
  ADD CONSTRAINT advisory_website_chk CHECK (website_url IS NULL OR website_url ~ '^https://[^\s<>"]+$'),
  ADD CONSTRAINT advisory_specializations_chk CHECK (
    specializations IS NOT NULL AND cardinality(specializations) <= 12
    AND av_valid_tags(specializations, 60));

ALTER TABLE contact_messages
  ADD CONSTRAINT contact_email_chk CHECK (av_valid_email(email)),
  ADD CONSTRAINT contact_category_chk CHECK (
    category IN ('sales', 'institutional', 'support', 'billing', 'partnership', 'press', 'privacy', 'other')),
  ADD CONSTRAINT contact_text_chk CHECK (
    length(btrim(name)) > 0 AND length(btrim(subject)) > 0 AND length(btrim(message)) > 0),
  ADD CONSTRAINT contact_handled_chk CHECK (status IN ('NEW') OR handled_at IS NOT NULL);

ALTER TABLE consent_records
  ADD CONSTRAINT consent_policy_chk CHECK (policy_version ~ '^[0-9A-Za-z.-]{1,32}$'),
  ADD CONSTRAINT consent_ip_hash_chk CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT consent_source_chk CHECK (source IN ('banner', 'preferences', 'account')),
  ADD CONSTRAINT consent_action_chk CHECK (
    CASE action
      WHEN 'ACCEPT_ALL' THEN functional AND analytics AND marketing
      WHEN 'REJECT_NON_ESSENTIAL' THEN NOT (functional OR analytics OR marketing)
      WHEN 'WITHDRAW' THEN NOT (functional OR analytics OR marketing)
      ELSE true
    END);

-- -----------------------------------------------------------------------------
-- 6. Institutions: seat limits, suspension
-- -----------------------------------------------------------------------------
-- Every active (not disabled) member uses one seat. The org row is locked so
-- concurrent joins cannot overshoot the limit.

CREATE FUNCTION org_seats_used(p_org_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT count(*)::int FROM users WHERE org_id = p_org_id AND disabled_at IS NULL;
$$;

CREATE FUNCTION users_enforce_seat_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_limit integer;
  v_used  integer;
BEGIN
  IF NEW.org_id IS NULL OR NEW.disabled_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.org_id IS NOT DISTINCT FROM NEW.org_id
     AND (OLD.disabled_at IS NULL) = (NEW.disabled_at IS NULL) THEN
    RETURN NEW;
  END IF;
  SELECT seat_limit INTO v_limit FROM organizations WHERE id = NEW.org_id FOR UPDATE;
  SELECT count(*) INTO v_used FROM users
   WHERE org_id = NEW.org_id AND disabled_at IS NULL AND id <> NEW.id;
  IF v_used >= v_limit THEN
    RAISE EXCEPTION 'organization % has no free seats (% of % used)', NEW.org_id, v_used, v_limit
      USING ERRCODE = 'check_violation', CONSTRAINT = 'organizations_seat_limit';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_seat_limit
  BEFORE INSERT OR UPDATE OF org_id, disabled_at ON users
  FOR EACH ROW EXECUTE FUNCTION users_enforce_seat_limit();

CREATE FUNCTION organizations_before_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_used integer;
BEGIN
  IF NEW.seat_limit < OLD.seat_limit THEN
    v_used := org_seats_used(NEW.id);
    IF NEW.seat_limit < v_used THEN
      RAISE EXCEPTION 'cannot reduce seats to % while % members are active; remove members first', NEW.seat_limit, v_used
        USING ERRCODE = 'check_violation', CONSTRAINT = 'organizations_seat_limit';
    END IF;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.suspended_at := CASE WHEN NEW.status = 'SUSPENDED' THEN clock_timestamp() END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_guard
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION organizations_before_update();

CREATE FUNCTION organizations_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.suspended_at := CASE WHEN NEW.status = 'SUSPENDED' THEN coalesce(NEW.suspended_at, clock_timestamp()) END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_stamp
  BEFORE INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION organizations_before_insert();

-- -----------------------------------------------------------------------------
-- 7. Subscriptions, entitlement materialisation, manual licences
-- -----------------------------------------------------------------------------

-- Plan / owner / seat consistency, checked when those fields change.
CREATE FUNCTION subscriptions_validate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE p plans%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.plan_code IS DISTINCT FROM OLD.plan_code
     OR NEW.seats IS DISTINCT FROM OLD.seats
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    SELECT * INTO p FROM plans WHERE plan_code = NEW.plan_code;
    IF p.kind = 'SITE_LICENSE' AND NEW.org_id IS NULL THEN
      RAISE EXCEPTION 'plan % is a site licence and must belong to an organization', p.plan_code
        USING ERRCODE = 'check_violation', CONSTRAINT = 'subscriptions_plan_owner';
    END IF;
    IF p.kind <> 'SITE_LICENSE' AND NEW.user_id IS NULL THEN
      RAISE EXCEPTION 'plan % is an individual plan and must belong to a user', p.plan_code
        USING ERRCODE = 'check_violation', CONSTRAINT = 'subscriptions_plan_owner';
    END IF;
    IF NEW.seats < p.min_seats OR (p.max_seats IS NOT NULL AND NEW.seats > p.max_seats) THEN
      RAISE EXCEPTION 'plan % allows % to % seats, got %', p.plan_code, p.min_seats, coalesce(p.max_seats::text, 'unlimited'), NEW.seats
        USING ERRCODE = 'check_violation', CONSTRAINT = 'subscriptions_plan_seats';
    END IF;
  END IF;
  IF NEW.status IN ('CANCELED', 'EXPIRED') AND NEW.ended_at IS NULL THEN
    NEW.ended_at := clock_timestamp();
  END IF;
  IF NEW.status = 'CANCELED' AND NEW.canceled_at IS NULL THEN
    NEW.canceled_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER subscriptions_validate
  BEFORE INSERT OR UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION subscriptions_validate();

-- (Re)builds a subscription's app_entitlements from its plan. The term lives
-- on the subscription, so rows only say WHICH apps the subscription unlocks.
CREATE OR REPLACE FUNCTION sync_subscription_entitlements(p_sub_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  n_upserted integer;
  n_removed  integer;
BEGIN
  INSERT INTO app_entitlements (sub_id, app_id, source, access_level)
  SELECT p_sub_id, pe.app_id, 'SUBSCRIPTION', pe.access_level
    FROM subscriptions s
    JOIN plan_entitlements pe ON pe.plan_code = s.plan_code
   WHERE s.id = p_sub_id
  ON CONFLICT (sub_id, app_id) DO UPDATE
     SET access_level = EXCLUDED.access_level, granted_at = now()
   WHERE app_entitlements.access_level IS DISTINCT FROM EXCLUDED.access_level;
  GET DIAGNOSTICS n_upserted = ROW_COUNT;

  DELETE FROM app_entitlements e
   WHERE e.sub_id = p_sub_id
     AND NOT EXISTS (
       SELECT 1 FROM subscriptions s JOIN plan_entitlements pe ON pe.plan_code = s.plan_code
        WHERE s.id = p_sub_id AND pe.app_id = e.app_id);
  GET DIAGNOSTICS n_removed = ROW_COUNT;

  RETURN n_upserted + n_removed;
END;
$$;

CREATE TRIGGER subscriptions_sync_entitlements
  AFTER INSERT OR UPDATE OF plan_code ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION subscriptions_after_change();

-- Editing a plan's app list re-materialises every subscription on it.
CREATE FUNCTION plan_entitlements_after_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_sub uuid;
BEGIN
  FOR v_sub IN
    SELECT id FROM subscriptions
     WHERE plan_code IN (coalesce(NEW.plan_code, OLD.plan_code), coalesce(OLD.plan_code, NEW.plan_code))
  LOOP
    PERFORM sync_subscription_entitlements(v_sub);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE TRIGGER plan_entitlements_resync
  AFTER INSERT OR UPDATE OR DELETE ON plan_entitlements
  FOR EACH ROW EXECUTE FUNCTION plan_entitlements_after_change();

-- Guard: subscription-derived rows are written only by the definer functions
-- above (current_user = schema owner). Manual licences can be created by the
-- runtime role, must be granted by a SUPERADMIN, may have their expiry, reason
-- and reference edited until revoked, and are revoked - never deleted.
CREATE FUNCTION app_entitlements_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  owner_role name := (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = TG_RELID);
  r          app_entitlements%ROWTYPE := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  v_role     text;
BEGIN
  IF r.source = 'SUBSCRIPTION' OR (TG_OP = 'UPDATE' AND OLD.source = 'SUBSCRIPTION') THEN
    IF current_user <> owner_role THEN
      RAISE EXCEPTION 'subscription entitlements are maintained by the database; change the subscription or plan instead'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- MANUAL
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'manual licences are revoked (revoked_at), never deleted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT role::text INTO v_role FROM users WHERE id = NEW.granted_by AND disabled_at IS NULL;
    IF v_role IS DISTINCT FROM 'SUPERADMIN' THEN
      RAISE EXCEPTION 'manual licences must be granted by an active SUPERADMIN'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.granted_at := clock_timestamp();
    IF NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'a manual licence cannot be created revoked' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE of a manual licence
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'licence % is revoked and can no longer change', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.app_id, NEW.source, NEW.sub_id, NEW.user_id, NEW.org_id, NEW.granted_by, NEW.granted_at, NEW.starts_at, NEW.access_level)
     IS DISTINCT FROM
     (OLD.app_id, OLD.source, OLD.sub_id, OLD.user_id, OLD.org_id, OLD.granted_by, OLD.granted_at, OLD.starts_at, OLD.access_level) THEN
    RAISE EXCEPTION 'only expires_at, reason, reference and revocation fields of a manual licence can change'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.revoked_at IS NOT NULL THEN
    NEW.revoked_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER app_entitlements_guard
  BEFORE INSERT OR UPDATE OR DELETE ON app_entitlements
  FOR EACH ROW EXECUTE FUNCTION app_entitlements_guard();

-- -----------------------------------------------------------------------------
-- 8. Access resolution
-- -----------------------------------------------------------------------------
-- One row per registered app. `active` is true only for a paid grant in force:
--   * own subscription (single app / bundle), ACTIVE or PAST_DUE, inside the
--     paid period [current_period_start, current_period_end)
--   * institution site licence, same rules, for verified members of an
--     ACTIVE organization
--   * unrevoked manual licence inside [starts_at, expires_at)
-- and never for a COMING_SOON app or a disabled user. When several grants
-- apply, the one lasting longest is reported. VIP roles are applied by
-- altvivo-core on top of this (they need no grant).

CREATE FUNCTION user_access_claims(p_user_id uuid, p_at timestamptz DEFAULT now())
RETURNS TABLE (
  app_id     varchar,
  app_status app_status,
  active     boolean,
  source     text,
  plan_code  varchar,
  plan_kind  plan_kind,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
AS $$
  WITH u AS (
    SELECT id, org_id, email_verified_at
      FROM users
     WHERE id = p_user_id AND disabled_at IS NULL
  ),
  org AS (
    SELECT o.id
      FROM organizations o
      JOIN u ON u.org_id = o.id
     WHERE o.status = 'ACTIVE' AND u.email_verified_at IS NOT NULL
  ),
  grants AS (
    SELECT e.app_id,
           CASE WHEN s.org_id IS NOT NULL THEN 'institution'
                WHEN p.kind = 'BUNDLE'    THEN 'bundle'
                ELSE 'individual' END        AS source,
           s.plan_code,
           p.kind                             AS plan_kind,
           s.current_period_end               AS expires_at
      FROM app_entitlements e
      JOIN subscriptions s ON s.id = e.sub_id
      JOIN plans p ON p.plan_code = s.plan_code
     WHERE e.source = 'SUBSCRIPTION'
       AND e.access_level = 'FULL'
       AND s.status IN ('ACTIVE', 'PAST_DUE')
       AND coalesce(s.current_period_start, s.created_at) <= p_at
       AND s.current_period_end > p_at
       AND (s.user_id = (SELECT id FROM u) OR s.org_id = (SELECT id FROM org))
    UNION ALL
    SELECT e.app_id,
           CASE WHEN e.org_id IS NOT NULL THEN 'institution' ELSE 'manual' END,
           NULL::varchar,
           NULL::plan_kind,
           e.expires_at
      FROM app_entitlements e
     WHERE e.source = 'MANUAL'
       AND e.access_level = 'FULL'
       AND e.revoked_at IS NULL
       AND e.starts_at <= p_at
       AND e.expires_at > p_at
       AND (e.user_id = (SELECT id FROM u) OR e.org_id = (SELECT id FROM org))
  ),
  best AS (
    SELECT DISTINCT ON (g.app_id) g.*
      FROM grants g
     ORDER BY g.app_id, g.expires_at DESC
  )
  SELECT r.app_id,
         r.status,
         (b.app_id IS NOT NULL AND r.status <> 'COMING_SOON') AS active,
         CASE WHEN r.status <> 'COMING_SOON' THEN b.source END,
         CASE WHEN r.status <> 'COMING_SOON' THEN b.plan_code END,
         CASE WHEN r.status <> 'COMING_SOON' THEN b.plan_kind END,
         CASE WHEN r.status <> 'COMING_SOON' THEN b.expires_at END
    FROM app_registry r
    LEFT JOIN best b ON b.app_id = r.app_id
   ORDER BY r.sort_order, r.app_id;
$$;

-- -----------------------------------------------------------------------------
-- 9. Payments state machine
-- -----------------------------------------------------------------------------
CREATE FUNCTION payments_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.provider, NEW.user_id, NEW.org_id, NEW.currency, NEW.amount_minor, NEW.tax_minor,
      NEW.recorded_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.provider, OLD.user_id, OLD.org_id, OLD.currency, OLD.amount_minor, OLD.tax_minor,
      OLD.recorded_by, OLD.created_at) THEN
    RAISE EXCEPTION 'payment % : provider, payer, currency and amounts are immutable', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (OLD.provider_order_id IS NOT NULL AND NEW.provider_order_id IS DISTINCT FROM OLD.provider_order_id)
     OR (OLD.provider_payment_id IS NOT NULL AND NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id)
     OR (OLD.subscription_id IS NOT NULL AND NEW.subscription_id IS DISTINCT FROM OLD.subscription_id)
     OR (OLD.invoice_id IS NOT NULL AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id)
     OR (OLD.captured_at IS NOT NULL AND NEW.captured_at IS DISTINCT FROM OLD.captured_at) THEN
    RAISE EXCEPTION 'payment % : references and capture time can be set once only', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.refunded_minor < OLD.refunded_minor THEN
    RAISE EXCEPTION 'payment % : refunded amount can only grow', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'CREATED'            AND NEW.status IN ('AUTHORIZED', 'CAPTURED', 'FAILED'))
    OR (OLD.status = 'AUTHORIZED'         AND NEW.status IN ('CAPTURED', 'FAILED'))
    OR (OLD.status = 'CAPTURED'           AND NEW.status IN ('PARTIALLY_REFUNDED', 'REFUNDED'))
    OR (OLD.status = 'PARTIALLY_REFUNDED' AND NEW.status = 'REFUNDED')) THEN
    RAISE EXCEPTION 'payment % : illegal status change % -> %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payments_guard
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_guard();

-- -----------------------------------------------------------------------------
-- 10. Invoices
-- -----------------------------------------------------------------------------

-- Indian financial year (1 April - 31 March, IST) of a timestamp: '2026-27'.
CREATE FUNCTION indian_financial_year(p_ts timestamptz)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE WHEN extract(month FROM l) >= 4
              THEN extract(year FROM l)::int || '-' || lpad(((extract(year FROM l)::int + 1) % 100)::text, 2, '0')
              ELSE (extract(year FROM l)::int - 1) || '-' || lpad((extract(year FROM l)::int % 100)::text, 2, '0')
         END
    FROM (SELECT p_ts AT TIME ZONE 'Asia/Kolkata' AS l) t;
$$;

-- Next gapless number. The series row stays locked until the issuing
-- transaction commits, so a rollback releases the number and no gap appears.
-- Called only from the definer issue trigger (EXECUTE revoked from core_app).
CREATE FUNCTION invoice_next_number(p_kind invoice_kind, p_fy text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_prefix text := CASE p_kind WHEN 'TAX_INVOICE' THEN 'AV' WHEN 'PROFORMA' THEN 'PF' ELSE 'CN' END;
  v_n      integer;
BEGIN
  INSERT INTO invoice_series AS s (prefix, financial_year, last_number)
  VALUES (v_prefix, p_fy, 1)
  ON CONFLICT (prefix, financial_year)
  DO UPDATE SET last_number = s.last_number + 1, updated_at = clock_timestamp()
  RETURNING last_number INTO v_n;
  -- invoice_series_number_chk stops the series at 99999 (16-character GST limit).
  RETURN v_prefix || '/' || p_fy || '/' || lpad(v_n::text, 5, '0');
END;
$$;

-- Line maths. Runs before the line is stored; the parent must be a DRAFT.
CREATE FUNCTION invoice_lines_compute()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  inv   invoices%ROWTYPE;
  gross numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT * INTO inv FROM invoices WHERE id = OLD.invoice_id FOR UPDATE;
    -- Not found: the draft itself is being deleted (cascade), already checked.
    IF FOUND AND inv.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'invoice % is %; its lines are frozen', inv.number, inv.status USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
    RAISE EXCEPTION 'invoice lines cannot move between invoices' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO inv FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
  IF inv.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'invoice % is %; its lines are frozen', inv.number, inv.status USING ERRCODE = 'insufficient_privilege';
  END IF;

  gross := NEW.quantity::numeric * NEW.unit_price_minor;
  IF NEW.discount_minor > gross THEN
    RAISE EXCEPTION 'line discount exceeds the line amount' USING ERRCODE = 'check_violation';
  END IF;
  NEW.taxable_minor := gross - NEW.discount_minor;
  NEW.cgst_minor := 0;
  NEW.sgst_minor := 0;
  NEW.igst_minor := 0;
  IF inv.tax_treatment = 'INTRA_STATE' THEN
    NEW.cgst_minor := round(NEW.taxable_minor * NEW.gst_rate_bp / 20000.0);
    NEW.sgst_minor := NEW.cgst_minor;
  ELSIF inv.tax_treatment = 'INTER_STATE' THEN
    NEW.igst_minor := round(NEW.taxable_minor * NEW.gst_rate_bp / 10000.0);
  END IF;
  NEW.total_minor := NEW.taxable_minor + NEW.cgst_minor + NEW.sgst_minor + NEW.igst_minor;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoice_lines_compute
  BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION invoice_lines_compute();

CREATE FUNCTION invoice_recompute_totals(p_invoice_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE invoices i
     SET subtotal_minor = t.subtotal,
         discount_minor = t.discount,
         taxable_minor  = t.taxable,
         cgst_minor     = t.cgst,
         sgst_minor     = t.sgst,
         igst_minor     = t.igst,
         total_minor    = t.total,
         updated_at     = clock_timestamp()
    FROM (SELECT coalesce(sum(l.quantity::bigint * l.unit_price_minor), 0) AS subtotal,
                 coalesce(sum(l.discount_minor), 0) AS discount,
                 coalesce(sum(l.taxable_minor), 0)  AS taxable,
                 coalesce(sum(l.cgst_minor), 0)     AS cgst,
                 coalesce(sum(l.sgst_minor), 0)     AS sgst,
                 coalesce(sum(l.igst_minor), 0)     AS igst,
                 coalesce(sum(l.total_minor), 0)    AS total
            FROM invoice_lines l WHERE l.invoice_id = p_invoice_id) t
   WHERE i.id = p_invoice_id AND i.status = 'DRAFT';
$$;

CREATE FUNCTION invoice_lines_after_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('altvivo.invoice_totals', 'on', true);
  PERFORM invoice_recompute_totals(coalesce(NEW.invoice_id, OLD.invoice_id));
  PERFORM set_config('altvivo.invoice_totals', '', true);
  RETURN NULL;
END;
$$;

CREATE TRIGGER invoice_lines_totals
  AFTER INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION invoice_lines_after_change();

CREATE FUNCTION invoices_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'invoices are created as DRAFT and then issued' USING ERRCODE = 'check_violation';
  END IF;
  NEW.number := NULL;
  NEW.financial_year := NULL;
  NEW.issued_at := NULL;
  NEW.paid_at := NULL;
  NEW.cancelled_at := NULL;
  NEW.pdf_object_key := NULL;
  NEW.pdf_sha256 := NULL;
  NEW.subtotal_minor := 0;
  NEW.discount_minor := 0;
  NEW.taxable_minor := 0;
  NEW.cgst_minor := 0;
  NEW.sgst_minor := 0;
  NEW.igst_minor := 0;
  NEW.total_minor := 0;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoices_insert
  BEFORE INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_before_insert();

-- Issue / pay / cancel rules. SECURITY DEFINER so it can draw numbers from
-- invoice_series, which the runtime role cannot touch.
CREATE FUNCTION invoices_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  mutable  constant text[] := ARRAY['status', 'paid_at', 'cancelled_at', 'cancel_reason', 'pdf_object_key', 'pdf_sha256', 'updated_at'];
  rel      invoices%ROWTYPE;
  credited bigint;
  n_lines  integer;
  k        text;
BEGIN
  -- ------------------------------------------------------------- DRAFT ----
  IF OLD.status = 'DRAFT' THEN
    IF coalesce(current_setting('altvivo.invoice_totals', true), '') <> 'on' THEN
      -- Totals are derived from lines; ignore attempts to write them directly.
      NEW.subtotal_minor := OLD.subtotal_minor;
      NEW.discount_minor := OLD.discount_minor;
      NEW.taxable_minor  := OLD.taxable_minor;
      NEW.cgst_minor     := OLD.cgst_minor;
      NEW.sgst_minor     := OLD.sgst_minor;
      NEW.igst_minor     := OLD.igst_minor;
      NEW.total_minor    := OLD.total_minor;
    END IF;
    NEW.number := NULL;
    NEW.financial_year := NULL;
    NEW.issued_at := NULL;
    IF NEW.pdf_object_key IS NOT NULL OR NEW.pdf_sha256 IS NOT NULL THEN
      RAISE EXCEPTION 'a PDF can only be attached to an issued invoice' USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status = 'DRAFT' THEN
      RETURN NEW;
    END IF;
    IF NEW.status <> 'ISSUED' THEN
      RAISE EXCEPTION 'a draft can only be issued or deleted' USING ERRCODE = 'check_violation';
    END IF;

    -- Issue. Totals are re-derived from the lines here, so nothing written to
    -- the header directly can reach an issued document.
    SELECT count(*),
           coalesce(sum(quantity::bigint * unit_price_minor), 0), coalesce(sum(discount_minor), 0),
           coalesce(sum(taxable_minor), 0), coalesce(sum(cgst_minor), 0), coalesce(sum(sgst_minor), 0),
           coalesce(sum(igst_minor), 0), coalesce(sum(total_minor), 0)
      INTO n_lines, NEW.subtotal_minor, NEW.discount_minor, NEW.taxable_minor,
           NEW.cgst_minor, NEW.sgst_minor, NEW.igst_minor, NEW.total_minor
      FROM invoice_lines WHERE invoice_id = NEW.id;
    IF n_lines = 0 OR NEW.total_minor <= 0 THEN
      RAISE EXCEPTION 'cannot issue an invoice without chargeable lines' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind IN ('TAX_INVOICE', 'CREDIT_NOTE') AND NEW.seller_gstin IS NULL THEN
      RAISE EXCEPTION 'a % needs the seller GSTIN', NEW.kind USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind = 'PROFORMA'
       AND (NEW.valid_until IS NULL OR NEW.valid_until < (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date) THEN
      RAISE EXCEPTION 'a proforma invoice needs a validity date in the future' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.related_invoice_id IS NOT NULL THEN
      SELECT * INTO rel FROM invoices WHERE id = NEW.related_invoice_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'referenced document % does not exist', NEW.related_invoice_id USING ERRCODE = 'foreign_key_violation';
      END IF;
      IF NEW.kind = 'TAX_INVOICE' AND rel.kind <> 'PROFORMA' THEN
        RAISE EXCEPTION 'a tax invoice can only reference a proforma invoice' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.kind = 'PROFORMA' THEN
        RAISE EXCEPTION 'a proforma invoice cannot reference another document' USING ERRCODE = 'check_violation';
      END IF;
      IF rel.status NOT IN ('ISSUED', 'PAID')
         OR rel.currency <> NEW.currency
         OR rel.user_id IS DISTINCT FROM NEW.user_id
         OR rel.org_id IS DISTINCT FROM NEW.org_id THEN
        RAISE EXCEPTION 'referenced document must be issued, in the same currency, for the same customer'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NEW.kind = 'CREDIT_NOTE' THEN
      IF rel.id IS NULL OR rel.kind <> 'TAX_INVOICE' THEN
        RAISE EXCEPTION 'a credit note must reference a tax invoice' USING ERRCODE = 'check_violation';
      END IF;
      SELECT coalesce(sum(total_minor), 0) INTO credited
        FROM invoices
       WHERE related_invoice_id = rel.id AND kind = 'CREDIT_NOTE' AND status = 'ISSUED' AND id <> NEW.id;
      IF credited + NEW.total_minor > rel.total_minor THEN
        RAISE EXCEPTION 'credit notes would exceed the invoice total (% + % > %)', credited, NEW.total_minor, rel.total_minor
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    NEW.issued_at := clock_timestamp();
    NEW.financial_year := indian_financial_year(NEW.issued_at);
    NEW.number := invoice_next_number(NEW.kind, NEW.financial_year);
    NEW.paid_at := NULL;
    NEW.cancelled_at := NULL;
    RETURN NEW;
  END IF;

  -- --------------------------------------------- ISSUED / PAID / CANCELLED ----
  FOR k IN SELECT jsonb_object_keys(to_jsonb(NEW)) LOOP
    CONTINUE WHEN k = ANY (mutable);
    IF to_jsonb(NEW) -> k IS DISTINCT FROM to_jsonb(OLD) -> k THEN
      RAISE EXCEPTION 'invoice % is %; % cannot change (issue a credit note instead)', OLD.number, OLD.status, k
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
  IF OLD.pdf_object_key IS NOT NULL
     AND (NEW.pdf_object_key IS DISTINCT FROM OLD.pdf_object_key OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256) THEN
    RAISE EXCEPTION 'invoice % already has its PDF', OLD.number USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status = OLD.status THEN
    IF (NEW.paid_at, NEW.cancelled_at, NEW.cancel_reason) IS DISTINCT FROM (OLD.paid_at, OLD.cancelled_at, OLD.cancel_reason) THEN
      RAISE EXCEPTION 'invoice % : settlement fields are fixed', OLD.number USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'ISSUED' AND NEW.status = 'PAID' AND OLD.kind IN ('TAX_INVOICE', 'PROFORMA') THEN
    NEW.paid_at := coalesce(NEW.paid_at, clock_timestamp());
    IF NEW.paid_at > clock_timestamp() + interval '1 minute' THEN
      RAISE EXCEPTION 'paid_at cannot be in the future' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'ISSUED' AND NEW.status = 'CANCELLED' THEN
    NEW.cancelled_at := clock_timestamp();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invoice % : illegal status change % -> % (a paid tax invoice is reversed with a credit note)',
    OLD.number, OLD.status, NEW.status USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER invoices_guard
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_before_update();

-- A change of tax treatment on a draft re-prices its lines.
CREATE FUNCTION invoices_after_treatment_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE invoice_lines SET gst_rate_bp = gst_rate_bp WHERE invoice_id = NEW.id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER invoices_reprice
  AFTER UPDATE OF tax_treatment ON invoices
  FOR EACH ROW
  WHEN (OLD.tax_treatment IS DISTINCT FROM NEW.tax_treatment AND NEW.status = 'DRAFT')
  EXECUTE FUNCTION invoices_after_treatment_change();

CREATE FUNCTION invoices_before_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'invoice % is %; issued documents are cancelled, never deleted', OLD.number, OLD.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER invoices_delete
  BEFORE DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_before_delete();

-- -----------------------------------------------------------------------------
-- 11. Consent evidence (append-only, also for the owner)
-- -----------------------------------------------------------------------------
CREATE FUNCTION consent_records_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'consent_records is append-only; record a new decision instead'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER consent_records_no_update
  BEFORE UPDATE OR DELETE ON consent_records
  FOR EACH ROW EXECUTE FUNCTION consent_records_immutable();
CREATE TRIGGER consent_records_no_truncate
  BEFORE TRUNCATE ON consent_records
  FOR EACH STATEMENT EXECUTE FUNCTION consent_records_immutable();

-- -----------------------------------------------------------------------------
-- 12. Row-change audit, reporting views
-- -----------------------------------------------------------------------------
CREATE TRIGGER payments_audit
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('id', 'updated_at');
CREATE TRIGGER invoices_audit
  AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('id', 'updated_at');
CREATE TRIGGER invoice_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('id');
CREATE TRIGGER billing_profiles_audit
  AFTER INSERT OR UPDATE OR DELETE ON billing_profiles
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('id', 'updated_at');
CREATE TRIGGER advisory_board_members_audit
  AFTER INSERT OR UPDATE OR DELETE ON advisory_board_members
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('id', 'updated_at');

-- Recurring revenue of subscriptions in force, GST-exclusive, in minor units
-- of the subscription currency (MRR; ARR = 12 x MRR). Manual licences are
-- offline sales and are reported from payments instead.
CREATE VIEW revenue_active_subscriptions AS
  SELECT s.id                AS subscription_id,
         s.plan_code,
         p.kind              AS plan_kind,
         p.interval,
         s.provider,
         s.billing_mode,
         s.currency,
         s.seats,
         s.user_id,
         s.org_id,
         s.current_period_end,
         s.unit_amount_minor * CASE WHEN p.pricing_model = 'PER_SEAT' THEN s.seats ELSE 1 END AS period_amount_minor,
         round((s.unit_amount_minor * CASE WHEN p.pricing_model = 'PER_SEAT' THEN s.seats ELSE 1 END)::numeric
               / CASE WHEN p.interval = 'YEAR' THEN 12 ELSE 1 END)::bigint AS mrr_minor
    FROM subscriptions s
    JOIN plans p ON p.plan_code = s.plan_code
   WHERE s.status IN ('ACTIVE', 'PAST_DUE')
     AND coalesce(s.current_period_start, s.created_at) <= now()
     AND s.current_period_end > now();

-- -----------------------------------------------------------------------------
-- 13. Privileges
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  invoice_next_number(invoice_kind, text), invoices_before_update(),
  plan_entitlements_after_change()
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'core_app') THEN
    -- Numbers are drawn only while issuing (definer trigger): no gaps.
    REVOKE ALL ON FUNCTION invoice_next_number(invoice_kind, text) FROM core_app;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON invoice_series FROM core_app;
    -- Financial records: never removed.
    REVOKE DELETE, TRUNCATE ON payments FROM core_app;
    REVOKE TRUNCATE ON invoices, invoice_lines FROM core_app;
    -- Entitlements: manual licences are revoked, subscription rows are
    -- removed only by the definer sync function.
    REVOKE DELETE, TRUNCATE ON app_entitlements FROM core_app;
    -- Consent evidence is append-only.
    REVOKE UPDATE, DELETE, TRUNCATE ON consent_records FROM core_app;
    GRANT EXECUTE ON FUNCTION user_access_claims(uuid, timestamptz) TO core_app;
    GRANT SELECT ON revenue_active_subscriptions TO core_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'core_readonly') THEN
    -- Personal data not needed for reporting.
    REVOKE SELECT ON billing_profiles, contact_messages, consent_records FROM core_readonly;
    GRANT SELECT ON revenue_active_subscriptions TO core_readonly;
  END IF;
END;
$$;
