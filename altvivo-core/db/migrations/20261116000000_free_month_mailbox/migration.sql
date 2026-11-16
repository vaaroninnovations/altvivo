-- =============================================================================
-- AltVivo core - one-month free access + SuperAdmin mailbox
-- -----------------------------------------------------------------------------
--  1. trial_requests : "one month free" requests from the public form. A
--     SUPERADMIN approves or declines each one. Approval grants a time-boxed
--     licence per requested app (app_entitlements, source MANUAL, reference
--     'TRIAL-...') to the account that owns the e-mail address - immediately
--     when that account exists and is verified, otherwise the moment it
--     verifies its address. One free month per e-mail address.
--  2. mail_messages  : the SuperAdmin mailbox (inbox, sent, drafts, trash).
--     Contact enquiries, free-month requests and inbound replies land in the
--     inbox; composed mail is delivered by SMTP and kept in Sent.
--  3. user_access_claims() reports those licences as source 'trial'.
-- =============================================================================

CREATE TYPE "trial_status" AS ENUM ('PENDING', 'APPROVED', 'ACTIVE', 'DECLINED');
CREATE TYPE "mail_folder" AS ENUM ('INBOX', 'SENT', 'DRAFT', 'TRASH');

CREATE TABLE "trial_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "email" CITEXT NOT NULL,
    "institution" VARCHAR(300) NOT NULL,
    "designation" VARCHAR(120),
    "app_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "use_case" VARCHAR(2000) NOT NULL,
    "user_id" UUID,
    "status" "trial_status" NOT NULL DEFAULT 'PENDING',
    "days" INTEGER NOT NULL DEFAULT 30,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" VARCHAR(500),
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "ip_address" INET,
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trial_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mail_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "folder" "mail_folder" NOT NULL,
    "trashed_from" "mail_folder",
    "thread_id" UUID NOT NULL,
    "in_reply_to" UUID,
    "from_name" VARCHAR(200),
    "from_email" CITEXT NOT NULL,
    "to_emails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "cc_emails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "subject" VARCHAR(300) NOT NULL,
    "body" VARCHAR(20000) NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "is_starred" BOOLEAN NOT NULL DEFAULT false,
    "source" VARCHAR(16) NOT NULL DEFAULT 'compose',
    "contact_message_id" UUID,
    "trial_request_id" UUID,
    "created_by" UUID,
    "sent_at" TIMESTAMPTZ(6),
    "delivery_error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mail_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "trial_requests_status_created_at_idx" ON "trial_requests"("status", "created_at");
CREATE INDEX "trial_requests_user_id_idx" ON "trial_requests"("user_id");
CREATE INDEX "trial_requests_email_idx" ON "trial_requests"("email");
-- One free month per e-mail address; a declined request may be followed by a new one.
CREATE UNIQUE INDEX "trial_requests_one_per_email" ON "trial_requests"("email") WHERE "status" <> 'DECLINED';

CREATE INDEX "mail_messages_folder_created_at_idx" ON "mail_messages"("folder", "created_at" DESC);
CREATE INDEX "mail_messages_thread_id_created_at_idx" ON "mail_messages"("thread_id", "created_at");
CREATE INDEX "mail_messages_from_email_idx" ON "mail_messages"("from_email");

ALTER TABLE "trial_requests" ADD CONSTRAINT "trial_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_in_reply_to_fkey" FOREIGN KEY ("in_reply_to") REFERENCES "mail_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_contact_message_id_fkey" FOREIGN KEY ("contact_message_id") REFERENCES "contact_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_trial_request_id_fkey" FOREIGN KEY ("trial_request_id") REFERENCES "trial_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE trial_requests
  ADD CONSTRAINT trial_email_chk CHECK (av_valid_email(email)),
  ADD CONSTRAINT trial_text_chk CHECK (
    length(btrim(name)) > 0 AND length(btrim(institution)) > 0 AND length(btrim(use_case)) > 0),
  ADD CONSTRAINT trial_apps_chk CHECK (cardinality(app_ids) BETWEEN 1 AND 12),
  ADD CONSTRAINT trial_days_chk CHECK (days BETWEEN 1 AND 90),
  ADD CONSTRAINT trial_decision_chk CHECK (
    (status = 'PENDING' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status <> 'PENDING' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  ADD CONSTRAINT trial_period_chk CHECK (
    (status = 'ACTIVE' AND user_id IS NOT NULL AND starts_at IS NOT NULL AND ends_at > starts_at)
    OR (status <> 'ACTIVE' AND starts_at IS NULL AND ends_at IS NULL));

ALTER TABLE mail_messages
  ADD CONSTRAINT mail_from_chk CHECK (av_valid_email(from_email)),
  ADD CONSTRAINT mail_source_chk CHECK (source IN ('compose', 'contact', 'trial', 'inbound', 'system')),
  ADD CONSTRAINT mail_recipients_chk CHECK (cardinality(to_emails) <= 20 AND cardinality(cc_emails) <= 20),
  ADD CONSTRAINT mail_sent_chk CHECK (folder <> 'SENT' OR (sent_at IS NOT NULL AND cardinality(to_emails) >= 1)),
  ADD CONSTRAINT mail_trash_chk CHECK ((folder = 'TRASH') = (trashed_from IS NOT NULL) AND trashed_from IS DISTINCT FROM 'TRASH');

-- -----------------------------------------------------------------------------
-- Access resolution: identical to the previous definition, except that a
-- user-held manual licence whose reference starts with 'TRIAL-' is reported
-- as source 'trial' (the one-month free access).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION user_access_claims(p_user_id uuid, p_at timestamptz DEFAULT now())
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
           CASE WHEN e.org_id IS NOT NULL THEN 'institution'
                WHEN e.reference LIKE 'TRIAL-%' THEN 'trial'
                ELSE 'manual' END,
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
    -- Longest-lasting grant wins; at equal expiry a paid grant outranks the free month.
    SELECT DISTINCT ON (g.app_id) g.*
      FROM grants g
     ORDER BY g.app_id, g.expires_at DESC, (g.source = 'trial')
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
-- Privileges
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'core_app') THEN
    REVOKE TRUNCATE ON trial_requests, mail_messages FROM core_app;
    -- Requests are decided, never removed (they are the record of who had a free month).
    REVOKE DELETE ON trial_requests FROM core_app;
    GRANT EXECUTE ON FUNCTION user_access_claims(uuid, timestamptz) TO core_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'core_readonly') THEN
    -- Personal data and correspondence are not needed for reporting.
    REVOKE SELECT ON trial_requests, mail_messages FROM core_readonly;
  END IF;
END;
$$;
