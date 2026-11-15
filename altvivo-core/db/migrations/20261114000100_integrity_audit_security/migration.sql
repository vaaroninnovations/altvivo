-- =============================================================================
-- AltVivo db_core: integrity, cryptographic audit engine and privileges
-- -----------------------------------------------------------------------------
--  1. CHECK constraints Prisma cannot express
--  2. Request-scoped audit context (who / from where), set per transaction
--  3. audit_logs: append-only, SHA-256 hash chain, verification function
--  4. Generic row-change auditing for security-relevant tables
--  5. Credit ledger: append-only, locked balance computation, no overdraft
--  6. Spoke registry: status-change stamping + early-bird entitlement unlocks
--  7. Entitlement resolution helpers used by the IdP when minting JWTs
--  8. Least-privilege grants for core_app / core_readonly
--
-- Every function that writes protected tables is SECURITY DEFINER (owned by
-- core_migrator) with a pinned search_path, so the runtime role never needs
-- direct write access to audit_chain_head or credit_accounts.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. CHECK constraints
-- -----------------------------------------------------------------------------

CREATE FUNCTION av_valid_domains(p_domains text[])
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT coalesce(bool_and(d ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'), true)
  FROM unnest(p_domains) AS d;
$$;

ALTER TABLE users
  ADD CONSTRAINT users_email_format_chk CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254),
  ADD CONSTRAINT users_orcid_format_chk CHECK (orcid_id IS NULL OR orcid_id ~ '^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$'),
  ADD CONSTRAINT users_full_name_chk CHECK (length(btrim(full_name)) > 0),
  ADD CONSTRAINT users_failed_login_chk CHECK (failed_login_count >= 0),
  ADD CONSTRAINT users_mfa_secret_chk CHECK (NOT mfa_enabled OR mfa_secret IS NOT NULL),
  ADD CONSTRAINT users_mfa_envelope_chk CHECK (mfa_secret IS NULL OR mfa_secret ~ '^v[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  ADD CONSTRAINT users_password_hash_chk CHECK (password_hash IS NULL OR password_hash LIKE '$argon2id$%');

ALTER TABLE organizations
  ADD CONSTRAINT organizations_name_chk CHECK (length(btrim(name)) > 0),
  ADD CONSTRAINT organizations_seat_limit_chk CHECK (seat_limit > 0),
  ADD CONSTRAINT organizations_country_chk CHECK (billing_country ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT organizations_domains_chk CHECK (av_valid_domains(domain_whitelist));

ALTER TABLE oauth_accounts
  ADD CONSTRAINT oauth_accounts_provider_id_chk CHECK (length(provider_account_id) > 0);

ALTER TABLE auth_sessions
  ADD CONSTRAINT auth_sessions_expiry_chk CHECK (expires_at > created_at);

ALTER TABLE refresh_tokens
  ADD CONSTRAINT refresh_tokens_hash_chk CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT refresh_tokens_expiry_chk CHECK (expires_at > issued_at);

ALTER TABLE auth_tokens
  ADD CONSTRAINT auth_tokens_hash_chk CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT auth_tokens_expiry_chk CHECK (expires_at > created_at);

ALTER TABLE mfa_recovery_codes
  ADD CONSTRAINT mfa_recovery_codes_hash_chk CHECK (code_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE app_registry
  ADD CONSTRAINT app_registry_app_id_chk CHECK (app_id ~ '^[a-z][a-z0-9]{1,31}$'),
  ADD CONSTRAINT app_registry_subdomain_chk CHECK (subdomain_url = 'https://' || app_id || '.altvivo.bio'),
  ADD CONSTRAINT app_registry_version_chk CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$'),
  ADD CONSTRAINT app_registry_phase_chk CHECK (phase BETWEEN 1 AND 9),
  ADD CONSTRAINT app_registry_icon_chk CHECK (icon_key ~ '^[a-z0-9-]{1,64}$');

ALTER TABLE app_waitlist
  ADD CONSTRAINT app_waitlist_email_format_chk CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254),
  ADD CONSTRAINT app_waitlist_source_chk CHECK (source IN ('web', 'workspace', 'coming-soon', 'topbar', 'admin')),
  ADD CONSTRAINT app_waitlist_notified_chk CHECK (notified = (notified_at IS NOT NULL));

ALTER TABLE plans
  ADD CONSTRAINT plans_code_chk CHECK (plan_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  ADD CONSTRAINT plans_price_chk CHECK (price_inr_paise >= 0 AND price_usd_cents >= 0),
  ADD CONSTRAINT plans_seats_chk CHECK (seats > 0),
  ADD CONSTRAINT plans_credits_chk CHECK (monthly_credits >= 0);

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_owner_chk CHECK (num_nonnulls(user_id, org_id) = 1),
  ADD CONSTRAINT subscriptions_currency_chk CHECK (currency IN ('INR', 'USD')),
  ADD CONSTRAINT subscriptions_razorpay_inr_chk CHECK (provider <> 'RAZORPAY' OR currency = 'INR'),
  ADD CONSTRAINT subscriptions_seats_chk CHECK (seats > 0),
  ADD CONSTRAINT subscriptions_canceled_chk CHECK (status <> 'CANCELED' OR canceled_at IS NOT NULL);

ALTER TABLE billing_events
  ADD CONSTRAINT billing_events_sha_chk CHECK (payload_sha256 ~ '^[0-9a-f]{64}$');

ALTER TABLE credit_accounts
  ADD CONSTRAINT credit_accounts_owner_chk CHECK (num_nonnulls(user_id, org_id) = 1),
  ADD CONSTRAINT credit_accounts_balance_chk CHECK (balance >= 0);

ALTER TABLE credit_ledger
  ADD CONSTRAINT credit_ledger_account_chk CHECK (account_id IS NOT NULL),
  ADD CONSTRAINT credit_ledger_owner_chk CHECK (num_nonnulls(user_id, org_id) >= 1),
  ADD CONSTRAINT credit_ledger_delta_chk CHECK (delta <> 0),
  ADD CONSTRAINT credit_ledger_balance_chk CHECK (balance_after >= 0),
  ADD CONSTRAINT credit_ledger_action_chk CHECK (action_type ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  ADD CONSTRAINT credit_ledger_reference_chk CHECK (length(reference_id) > 0);

ALTER TABLE workspace_files
  ADD CONSTRAINT workspace_files_name_chk CHECK (length(btrim(file_name)) > 0 AND file_name !~ '[/\\[:cntrl:]]' AND file_name NOT IN ('.', '..')),
  ADD CONSTRAINT workspace_files_size_chk CHECK (size_bytes > 0 AND size_bytes <= 10737418240),
  ADD CONSTRAINT workspace_files_sha_chk CHECK (sha256_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT workspace_files_key_chk CHECK (r2_object_key ~ '^[A-Za-z0-9!_.*''()/-]+$' AND r2_object_key !~ '(^/|\.\./|//)');

ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_id_chk CHECK (id > 0),
  ADD CONSTRAINT audit_logs_event_type_chk CHECK (event_type ~ '^[A-Z][A-Z0-9_]*(\.[A-Z][A-Z0-9_]*)*$'),
  ADD CONSTRAINT audit_logs_app_id_chk CHECK (app_id ~ '^[a-z][a-z0-9]{1,31}$'),
  ADD CONSTRAINT audit_logs_metadata_chk CHECK (jsonb_typeof(metadata) = 'object'),
  ADD CONSTRAINT audit_logs_prev_hash_chk CHECK (previous_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT audit_logs_record_hash_chk CHECK (record_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE audit_chain_head
  ADD CONSTRAINT audit_chain_head_singleton_chk CHECK (id = 1),
  ADD CONSTRAINT audit_chain_head_genesis_chk CHECK (genesis_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT audit_chain_head_last_chk CHECK (last_hash ~ '^[0-9a-f]{64}$' AND last_id >= 0);


-- -----------------------------------------------------------------------------
-- 2. Audit context (set by altvivo-core at the start of each transaction)
-- -----------------------------------------------------------------------------

CREATE FUNCTION audit_set_context(
  p_actor_id   uuid,
  p_actor_ip   inet,
  p_user_agent text,
  p_app_id     text DEFAULT 'core',
  p_actor_type audit_actor_type DEFAULT 'USER'
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('altvivo.actor_id',   coalesce(p_actor_id::text, ''), true);
  PERFORM set_config('altvivo.actor_ip',   coalesce(p_actor_ip::text, ''), true);
  PERFORM set_config('altvivo.user_agent', left(coalesce(p_user_agent, ''), 512), true);
  PERFORM set_config('altvivo.app_id',     coalesce(p_app_id, 'core'), true);
  PERFORM set_config('altvivo.actor_type', coalesce(p_actor_type, 'USER')::text, true);
END;
$$;

CREATE FUNCTION audit_ctx(p_key text)
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('altvivo.' || p_key, true), '');
$$;

-- -----------------------------------------------------------------------------
-- 3. audit_logs: hash chain
-- -----------------------------------------------------------------------------

CREATE SEQUENCE audit_logs_id_seq AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;
ALTER SEQUENCE audit_logs_id_seq OWNED BY audit_logs.id;

-- Canonical serialisation: a JSON array (unambiguous escaping, no delimiter
-- injection) of every column except record_hash, with the timestamp rendered
-- as fixed-width UTC microseconds. jsonb's text form is deterministic.
CREATE FUNCTION audit_compute_hash(r audit_logs)
RETURNS char(64)
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT encode(
           sha256(convert_to(
             jsonb_build_array(
               r.id,
               to_char(r."timestamp" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
               r.actor_type::text,
               r.actor_id::text,
               r.actor_ip::text,
               r.user_agent,
               r.app_id,
               r.event_type,
               r.resource_id,
               r.metadata,
               r.previous_hash::text
             )::text,
             'UTF8')),
           'hex')::char(64);
$$;

CREATE FUNCTION audit_logs_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  head audit_chain_head%ROWTYPE;
BEGIN
  -- Serialise all writers on the single chain-head row. Under READ COMMITTED
  -- the lock returns the latest committed head; under REPEATABLE READ /
  -- SERIALIZABLE a concurrent append raises a serialization failure (retry).
  SELECT * INTO head FROM audit_chain_head WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'audit chain is not initialised (run npm run db:deploy)'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  -- Server-assigned, never caller-controlled.
  NEW.id := nextval('audit_logs_id_seq');
  NEW."timestamp" := clock_timestamp();

  -- Fill identity from the transaction's audit context when not given.
  NEW.actor_id   := coalesce(NEW.actor_id, audit_ctx('actor_id')::uuid);
  NEW.actor_ip   := coalesce(NEW.actor_ip, audit_ctx('actor_ip')::inet);
  NEW.user_agent := left(coalesce(NEW.user_agent, audit_ctx('user_agent')), 512);
  -- Column defaults ('core' / 'USER') yield to the transaction's audit context.
  IF NEW.app_id IS NULL OR (NEW.app_id = 'core' AND audit_ctx('app_id') IS NOT NULL) THEN
    NEW.app_id := coalesce(audit_ctx('app_id'), 'core');
  END IF;
  IF NEW.actor_type IS NULL OR (NEW.actor_type = 'USER' AND audit_ctx('actor_type') IS NOT NULL) THEN
    NEW.actor_type := coalesce(audit_ctx('actor_type')::audit_actor_type, 'USER');
  END IF;
  NEW.metadata := coalesce(NEW.metadata, '{}'::jsonb);

  NEW.previous_hash := head.last_hash;
  NEW.record_hash   := audit_compute_hash(NEW);

  UPDATE audit_chain_head
     SET last_id = NEW.id, last_hash = NEW.record_hash, updated_at = NEW."timestamp"
   WHERE id = 1;

  RETURN NEW;
END;
$$;

CREATE FUNCTION av_reject_modification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege',
          HINT = 'Record a new compensating entry instead of changing history.';
END;
$$;

CREATE TRIGGER audit_logs_chain
  BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_before_insert();

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION av_reject_modification();

CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION av_reject_modification();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION av_reject_modification();

-- The chain head may only move forward, and its genesis is immutable.
CREATE FUNCTION audit_chain_head_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_chain_head cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.genesis_hash IS DISTINCT FROM OLD.genesis_hash THEN
    RAISE EXCEPTION 'audit genesis hash is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.last_id <= OLD.last_id THEN
    RAISE EXCEPTION 'audit chain head can only advance (% -> %)', OLD.last_id, NEW.last_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_chain_head_guard
  BEFORE UPDATE OR DELETE ON audit_chain_head
  FOR EACH ROW EXECUTE FUNCTION audit_chain_head_guard();

CREATE TRIGGER audit_chain_head_no_truncate
  BEFORE TRUNCATE ON audit_chain_head
  FOR EACH STATEMENT EXECUTE FUNCTION av_reject_modification();

-- Recomputes the chain. Detects altered rows (record_hash mismatch), inserted /
-- deleted / reordered rows (previous_hash break) and tail deletion (head
-- mismatch). Pass a range to verify incrementally.
CREATE FUNCTION audit_verify_chain(p_from_id bigint DEFAULT NULL, p_to_id bigint DEFAULT NULL)
RETURNS TABLE (
  ok           boolean,
  rows_checked bigint,
  first_bad_id bigint,
  reason       text,
  head_id      bigint,
  head_hash    char(64)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  h             audit_chain_head%ROWTYPE;
  r             audit_logs%ROWTYPE;
  expected_prev char(64);
  n             bigint := 0;
  first_id      bigint;
BEGIN
  SELECT * INTO h FROM audit_chain_head WHERE id = 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0::bigint, NULL::bigint, 'chain head missing'::text, NULL::bigint, NULL::char(64);
    RETURN;
  END IF;

  SELECT min(a.id) INTO first_id FROM audit_logs a;

  IF p_from_id IS NULL OR first_id IS NULL OR p_from_id <= first_id THEN
    expected_prev := h.genesis_hash;
    p_from_id := 0;
  ELSE
    SELECT a.record_hash INTO expected_prev FROM audit_logs a WHERE a.id < p_from_id ORDER BY a.id DESC LIMIT 1;
  END IF;

  FOR r IN
    SELECT * FROM audit_logs a
     WHERE a.id >= p_from_id AND (p_to_id IS NULL OR a.id <= p_to_id)
     ORDER BY a.id
  LOOP
    n := n + 1;
    IF r.previous_hash IS DISTINCT FROM expected_prev THEN
      RETURN QUERY SELECT false, n, r.id,
        'previous_hash does not match the preceding record (row inserted, deleted or reordered)'::text,
        h.last_id, h.last_hash;
      RETURN;
    END IF;
    IF r.record_hash IS DISTINCT FROM audit_compute_hash(r) THEN
      RETURN QUERY SELECT false, n, r.id, 'record_hash mismatch (row contents altered)'::text, h.last_id, h.last_hash;
      RETURN;
    END IF;
    expected_prev := r.record_hash;
  END LOOP;

  IF p_to_id IS NULL AND expected_prev IS DISTINCT FROM h.last_hash THEN
    RETURN QUERY SELECT false, n, h.last_id,
      'chain head does not match the last record (records removed from the tail)'::text,
      h.last_id, h.last_hash;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, n, NULL::bigint, 'ok'::text, h.last_id, h.last_hash;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Generic row-change audit
--    Trigger args: [0] primary-key column, [1..] columns to ignore.
--    Secrets are recorded as "[REDACTED]" (the fact of change is kept).
-- -----------------------------------------------------------------------------

CREATE FUNCTION audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_j    jsonb;
  new_j    jsonb;
  diff     jsonb := '{}'::jsonb;
  k        text;
  pk_col   text := TG_ARGV[0];
  ignored  text[] := coalesce(TG_ARGV[1:TG_NARGS - 1], '{}'::text[]);
  redacted text[] := ARRAY['password_hash', 'mfa_secret', 'token_hash', 'code_hash'];
  ov       jsonb;
  nv       jsonb;
  actor    uuid := audit_ctx('actor_id')::uuid;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN old_j := to_jsonb(OLD); END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN new_j := to_jsonb(NEW); END IF;

  FOR k IN SELECT jsonb_object_keys(coalesce(new_j, old_j)) LOOP
    CONTINUE WHEN k = ANY (ignored);
    ov := old_j -> k;
    nv := new_j -> k;
    CONTINUE WHEN TG_OP = 'UPDATE' AND ov IS NOT DISTINCT FROM nv;
    IF k = ANY (redacted) THEN
      ov := CASE WHEN ov IS NULL OR ov = 'null'::jsonb THEN ov ELSE to_jsonb('[REDACTED]'::text) END;
      nv := CASE WHEN nv IS NULL OR nv = 'null'::jsonb THEN nv ELSE to_jsonb('[REDACTED]'::text) END;
    END IF;
    diff := diff || jsonb_build_object(k, CASE TG_OP
              WHEN 'INSERT' THEN jsonb_build_object('new', coalesce(nv, 'null'::jsonb))
              WHEN 'DELETE' THEN jsonb_build_object('old', coalesce(ov, 'null'::jsonb))
              ELSE jsonb_build_object('old', coalesce(ov, 'null'::jsonb), 'new', coalesce(nv, 'null'::jsonb))
            END);
  END LOOP;

  IF TG_OP = 'UPDATE' AND diff = '{}'::jsonb THEN
    RETURN NULL;
  END IF;

  INSERT INTO audit_logs (actor_type, actor_id, actor_ip, user_agent, app_id, event_type, resource_id, metadata)
  VALUES (
    coalesce(audit_ctx('actor_type')::audit_actor_type, CASE WHEN actor IS NULL THEN 'SYSTEM' ELSE 'USER' END::audit_actor_type),
    actor,
    audit_ctx('actor_ip')::inet,
    audit_ctx('user_agent'),
    coalesce(audit_ctx('app_id'), 'core'),
    'DB.' || upper(TG_TABLE_NAME) || '.' || TG_OP,
    coalesce(new_j, old_j) ->> pk_col,
    jsonb_build_object(
      'table',   TG_TABLE_NAME,
      'op',      TG_OP,
      'db_role', session_user,
      'txid',    txid_current(),
      'changes', diff
    )
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER users_audit
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('id', 'updated_at', 'last_login_at', 'failed_login_count');

CREATE TRIGGER organizations_audit
  AFTER INSERT OR UPDATE OR DELETE ON organizations
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('id', 'updated_at');

CREATE TRIGGER oauth_accounts_audit
  AFTER INSERT OR DELETE ON oauth_accounts
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('id', 'last_used_at');

CREATE TRIGGER mfa_recovery_codes_audit
  AFTER INSERT OR UPDATE OR DELETE ON mfa_recovery_codes
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('id');

CREATE TRIGGER app_registry_audit
  AFTER INSERT OR UPDATE OR DELETE ON app_registry
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('app_id', 'updated_at', 'status_changed_at');

CREATE TRIGGER plans_audit
  AFTER INSERT OR UPDATE OR DELETE ON plans
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('plan_code', 'updated_at');

CREATE TRIGGER plan_entitlements_audit
  AFTER INSERT OR UPDATE OR DELETE ON plan_entitlements
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('plan_code');

CREATE TRIGGER subscriptions_audit
  AFTER INSERT OR UPDATE OR DELETE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('id', 'updated_at');

CREATE TRIGGER app_entitlements_audit
  AFTER INSERT OR UPDATE OR DELETE ON app_entitlements
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('id');

CREATE TRIGGER workspace_files_audit
  AFTER INSERT OR UPDATE OR DELETE ON workspace_files
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('id');

-- -----------------------------------------------------------------------------
-- 5. Credit ledger
-- -----------------------------------------------------------------------------

CREATE FUNCTION credit_ledger_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  acct    credit_accounts%ROWTYPE;
  new_bal bigint;
BEGIN
  IF NEW.org_id IS NOT NULL AND NEW.user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'user % is not a member of organization %', NEW.user_id, NEW.org_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.org_id IS NOT NULL THEN
    INSERT INTO credit_accounts (org_id) VALUES (NEW.org_id) ON CONFLICT (org_id) DO NOTHING;
    SELECT * INTO acct FROM credit_accounts WHERE org_id = NEW.org_id FOR UPDATE;
  ELSIF NEW.user_id IS NOT NULL THEN
    INSERT INTO credit_accounts (user_id) VALUES (NEW.user_id) ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO acct FROM credit_accounts WHERE user_id = NEW.user_id FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'credit_ledger entry needs user_id or org_id' USING ERRCODE = 'not_null_violation';
  END IF;

  -- Idempotency is enforced here (not only by the unique index) because a
  -- caller's ON CONFLICT DO NOTHING would otherwise skip the row AFTER this
  -- trigger has already moved the balance.
  IF EXISTS (
    SELECT 1 FROM credit_ledger l
     WHERE l.account_id = acct.id AND l.action_type = NEW.action_type AND l.reference_id = NEW.reference_id
  ) THEN
    RAISE EXCEPTION 'duplicate credit_ledger entry (%, %)', NEW.action_type, NEW.reference_id
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'credit_ledger_account_id_action_type_reference_id_key';
  END IF;

  new_bal := acct.balance::bigint + NEW.delta;
  IF new_bal < 0 THEN
    RAISE EXCEPTION 'insufficient credits: balance %, requested %', acct.balance, NEW.delta
      USING ERRCODE = 'check_violation', CONSTRAINT = 'credit_ledger_balance_chk';
  END IF;
  IF new_bal > 2147483647 THEN
    RAISE EXCEPTION 'credit balance overflow' USING ERRCODE = 'numeric_value_out_of_range';
  END IF;

  NEW.account_id    := acct.id;
  NEW.balance_after := new_bal::int;
  NEW.created_at    := clock_timestamp();

  UPDATE credit_accounts SET balance = new_bal::int, updated_at = NEW.created_at WHERE id = acct.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER credit_ledger_post
  BEFORE INSERT ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION credit_ledger_before_insert();

CREATE TRIGGER credit_ledger_no_update
  BEFORE UPDATE ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION av_reject_modification();

CREATE TRIGGER credit_ledger_no_delete
  BEFORE DELETE ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION av_reject_modification();

CREATE TRIGGER credit_ledger_no_truncate
  BEFORE TRUNCATE ON credit_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION av_reject_modification();

-- Balance shown in the JWT `credits_remaining` claim: the organisation pool
-- for org members, otherwise the personal account.
CREATE FUNCTION credit_balance_for_user(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    (SELECT ca.balance
       FROM users u
       JOIN credit_accounts ca ON (u.org_id IS NOT NULL AND ca.org_id = u.org_id)
                               OR (u.org_id IS NULL AND ca.user_id = u.id)
      WHERE u.id = p_user_id),
    0);
$$;

-- -----------------------------------------------------------------------------
-- 6. Spoke registry + entitlement materialisation
-- -----------------------------------------------------------------------------

-- (Re)builds a subscription's app_entitlements from its plan template.
-- COMING_SOON apps are held at WAITLIST until launch.
CREATE FUNCTION sync_subscription_entitlements(p_sub_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  n_upserted integer;
  n_removed  integer;
BEGIN
  WITH target AS (
    SELECT pe.app_id,
           CASE WHEN r.status = 'COMING_SOON' THEN 'WAITLIST'::access_level ELSE pe.access_level END AS lvl
      FROM subscriptions s
      JOIN plan_entitlements pe ON pe.plan_code = s.plan_code
      JOIN app_registry r ON r.app_id = pe.app_id
     WHERE s.id = p_sub_id
  )
  INSERT INTO app_entitlements (sub_id, app_id, access_level)
  SELECT p_sub_id, t.app_id, t.lvl FROM target t
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

CREATE FUNCTION subscriptions_after_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM sync_subscription_entitlements(NEW.id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER subscriptions_sync_entitlements
  AFTER INSERT OR UPDATE OF plan_code ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION subscriptions_after_change();

-- Early-bird unlock: when an app launches, every live subscription whose plan
-- grants it (unlock_on_launch) is upgraded from WAITLIST/NONE to the plan level.
CREATE FUNCTION apply_launch_unlocks(p_app_id text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  n integer;
BEGIN
  WITH targets AS (
    SELECT s.id AS sub_id, pe.access_level
      FROM subscriptions s
      JOIN plan_entitlements pe ON pe.plan_code = s.plan_code AND pe.app_id = p_app_id
     WHERE pe.unlock_on_launch
       AND s.status IN ('ACTIVE', 'TRIALING', 'PAST_DUE')
  )
  INSERT INTO app_entitlements (sub_id, app_id, access_level)
  SELECT t.sub_id, p_app_id, t.access_level FROM targets t
  ON CONFLICT (sub_id, app_id) DO UPDATE
     SET access_level = EXCLUDED.access_level, granted_at = now()
   WHERE app_entitlements.access_level < EXCLUDED.access_level;
  GET DIAGNOSTICS n = ROW_COUNT;

  INSERT INTO audit_logs (actor_type, event_type, resource_id, metadata)
  VALUES (
    coalesce(audit_ctx('actor_type')::audit_actor_type, 'SYSTEM'),
    'APP.LAUNCH_UNLOCK',
    p_app_id,
    jsonb_build_object('app_id', p_app_id, 'entitlements_upgraded', n)
  );
  RETURN n;
END;
$$;

CREATE FUNCTION app_registry_before_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.app_id IS DISTINCT FROM OLD.app_id THEN
    RAISE EXCEPTION 'app_id is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := clock_timestamp();
    NEW.status_changed_by := audit_ctx('actor_id')::uuid;
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER app_registry_stamp
  BEFORE UPDATE ON app_registry
  FOR EACH ROW EXECUTE FUNCTION app_registry_before_update();

CREATE FUNCTION app_registry_after_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'COMING_SOON' AND NEW.status IN ('BETA', 'LIVE') THEN
    PERFORM apply_launch_unlocks(NEW.app_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER app_registry_launch
  AFTER UPDATE OF status ON app_registry
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION app_registry_after_status_change();

-- -----------------------------------------------------------------------------
-- 7. Entitlement resolution (JWT `entitlements` claim)
-- -----------------------------------------------------------------------------
-- level = max(app default for verified users, subscription grants, waitlist)
-- capped at WAITLIST while the app is COMING_SOON. Disabled users get NONE.

CREATE FUNCTION user_effective_entitlements(p_user_id uuid)
RETURNS TABLE (app_id varchar, status app_status, access_level access_level)
LANGUAGE sql
STABLE
AS $$
  WITH u AS (
    SELECT id, email, org_id, email_verified_at
      FROM users
     WHERE id = p_user_id AND disabled_at IS NULL
  ),
  subs AS (
    SELECT s.id
      FROM subscriptions s, u
     WHERE (s.user_id = u.id OR (u.org_id IS NOT NULL AND s.org_id = u.org_id))
       AND (s.status IN ('ACTIVE', 'TRIALING')
            OR (s.status = 'PAST_DUE' AND s.current_period_end > now() - interval '7 days'))
  ),
  granted AS (
    SELECT e.app_id, max(e.access_level) AS lvl
      FROM app_entitlements e
      JOIN subs ON subs.id = e.sub_id
     WHERE e.expires_at IS NULL OR e.expires_at > now()
     GROUP BY e.app_id
  ),
  waiting AS (
    SELECT DISTINCT w.app_id
      FROM app_waitlist w, u
     WHERE w.user_id = u.id OR w.email = u.email
  ),
  raw AS (
    SELECT r.app_id, r.status, r.sort_order,
           CASE WHEN NOT EXISTS (SELECT 1 FROM u) THEN 'NONE'::access_level
                ELSE GREATEST(
                       CASE WHEN (SELECT email_verified_at FROM u) IS NOT NULL
                            THEN r.default_access_level ELSE 'NONE'::access_level END,
                       coalesce(g.lvl, 'NONE'::access_level),
                       CASE WHEN wt.app_id IS NOT NULL THEN 'WAITLIST'::access_level ELSE 'NONE'::access_level END)
           END AS lvl
      FROM app_registry r
      LEFT JOIN granted g ON g.app_id = r.app_id
      LEFT JOIN waiting wt ON wt.app_id = r.app_id
  )
  SELECT raw.app_id, raw.status,
         CASE WHEN raw.status = 'COMING_SOON' THEN LEAST(raw.lvl, 'WAITLIST'::access_level) ELSE raw.lvl END
    FROM raw
   ORDER BY raw.sort_order, raw.app_id;
$$;

-- Non-secret projection of users for reporting / auditors.
CREATE VIEW users_directory AS
  SELECT id, email, full_name, affiliation, orcid_id, role, org_id, mfa_enabled,
         email_verified_at, last_login_at, disabled_at, created_at
    FROM users;

-- -----------------------------------------------------------------------------
-- 8. Privileges
-- -----------------------------------------------------------------------------
-- core_app / core_readonly receive DML / SELECT on new tables via the default
-- privileges set at first boot (postgres/initdb). Narrow them here.

REVOKE ALL ON FUNCTION
  audit_logs_before_insert(), audit_row_change(), credit_ledger_before_insert(),
  subscriptions_after_change(), app_registry_after_status_change(),
  apply_launch_unlocks(text), sync_subscription_entitlements(uuid),
  audit_verify_chain(bigint, bigint)
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'core_app') THEN
    -- Append-only evidence.
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM core_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON credit_ledger FROM core_app;
    -- Maintained only by SECURITY DEFINER triggers.
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_chain_head FROM core_app;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON credit_accounts FROM core_app;
    -- Forensic records: insert / mark processed only.
    REVOKE DELETE, TRUNCATE ON billing_events FROM core_app;
    -- Vault records are soft-deleted (deleted_at), never removed.
    REVOKE DELETE, TRUNCATE ON workspace_files FROM core_app;
    -- The audit id sequence is consumed only inside the definer trigger.
    REVOKE ALL ON SEQUENCE audit_logs_id_seq FROM core_app;
    IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
      REVOKE ALL ON _prisma_migrations FROM core_app;
    END IF;

    -- Internal helpers run only from definer triggers.
    REVOKE EXECUTE ON FUNCTION apply_launch_unlocks(text) FROM core_app;
    GRANT EXECUTE ON FUNCTION audit_verify_chain(bigint, bigint) TO core_app;
    GRANT EXECUTE ON FUNCTION sync_subscription_entitlements(uuid) TO core_app;
    GRANT SELECT ON users_directory TO core_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'core_readonly') THEN
    -- Credentials and session material are never readable for reporting.
    REVOKE SELECT ON users, auth_sessions, refresh_tokens, auth_tokens,
                     mfa_recovery_codes, oauth_accounts, billing_events
      FROM core_readonly;
    REVOKE ALL ON SEQUENCE audit_logs_id_seq FROM core_readonly;
    IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
      REVOKE ALL ON _prisma_migrations FROM core_readonly;
    END IF;
    GRANT SELECT ON users_directory TO core_readonly;
    GRANT EXECUTE ON FUNCTION audit_verify_chain(bigint, bigint) TO core_readonly;
  END IF;
END;
$$;
