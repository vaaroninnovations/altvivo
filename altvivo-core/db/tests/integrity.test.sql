-- =============================================================================
-- db_core integrity tests. Run as core_migrator (schema owner) via
-- `npm run db:test`. Everything happens inside one transaction that is
-- ROLLED BACK, so it is safe on a staging copy - never point it at production.
-- Each block raises (failing the run) on the first violated expectation.
-- =============================================================================
BEGIN;

SELECT audit_set_context('00000000-0000-4000-8000-0000000000aa', '203.0.113.9', 'integrity-test', 'core', 'USER');

-- --------------------------------------------------------------- fixtures ----
INSERT INTO organizations (id, name, kind, seat_limit, billing_country, domain_whitelist)
VALUES ('10000000-0000-4000-8000-000000000001', 'Test Institute of Pharmacy', 'COLLEGE', 50, 'IN', ARRAY['tip.edu.in']);

INSERT INTO users (id, email, password_hash, full_name, role, org_id, email_verified_at, updated_at)
VALUES
  ('20000000-0000-4000-8000-000000000001', 'pi@tip.edu.in', '$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA', 'Dr. PI', 'PI',
   '10000000-0000-4000-8000-000000000001', now(), now()),
  ('20000000-0000-4000-8000-000000000002', 'solo@example.org', NULL, 'Solo Researcher', 'RESEARCHER', NULL, now(), now()),
  ('20000000-0000-4000-8000-000000000003', 'unverified@example.org', NULL, 'Unverified', 'STUDENT', NULL, NULL, now()),
  ('20000000-0000-4000-8000-000000000004', 'admin@altvivo.bio', NULL, 'Platform Admin', 'SUPERADMIN', NULL, now(), now()),
  ('20000000-0000-4000-8000-000000000005', 'student@tip.edu.in', NULL, 'Unverified Student', 'STUDENT',
   '10000000-0000-4000-8000-000000000001', NULL, now()),
  ('20000000-0000-4000-8000-000000000006', 'advisor@example.org', NULL, 'Prof. Advisor', 'ADVISORY_BOARD', NULL, now(), now());

-- ========================================================= 1. audit chain ====
DO $$
DECLARE
  h0 audit_chain_head%ROWTYPE;
  a  audit_logs%ROWTYPE;
  b  audit_logs%ROWTYPE;
  v  record;
BEGIN
  SELECT * INTO h0 FROM audit_chain_head WHERE id = 1;
  ASSERT FOUND, 'chain head must exist after seed';

  -- Caller-supplied id / timestamp / hashes are discarded.
  INSERT INTO audit_logs (id, "timestamp", event_type, resource_id, metadata, previous_hash, record_hash)
  VALUES (999999, '2000-01-01', 'TEST.FIRST', 'r1', '{"k": 1}', repeat('a', 64), repeat('b', 64))
  RETURNING * INTO a;
  ASSERT a.id <> 999999, 'id must be server-assigned';
  ASSERT a."timestamp" > now() - interval '1 minute', 'timestamp must be server-assigned';
  ASSERT a.previous_hash = h0.last_hash, 'first record must link to the previous head';
  ASSERT a.record_hash <> repeat('b', 64), 'record_hash must be computed';
  ASSERT a.record_hash = audit_compute_hash(a), 'stored hash must equal recomputed hash';
  ASSERT a.actor_id = '00000000-0000-4000-8000-0000000000aa', 'actor must come from audit context';
  ASSERT a.actor_ip = '203.0.113.9'::inet, 'ip must come from audit context';

  INSERT INTO audit_logs (event_type, resource_id) VALUES ('TEST.SECOND', 'r2') RETURNING * INTO b;
  ASSERT b.id > a.id, 'ids must increase along the chain';
  ASSERT b.previous_hash = a.record_hash, 'second record must link to the first';
  ASSERT (SELECT last_id FROM audit_chain_head) = b.id, 'head must track the newest record';

  -- Service context (spoke -> core call) fills actor_type / app_id defaults.
  PERFORM audit_set_context(NULL, '198.51.100.7', 'xprism-sdk', 'xprism', 'SERVICE');
  INSERT INTO audit_logs (event_type) VALUES ('TEST.SERVICE') RETURNING * INTO b;
  ASSERT b.actor_type = 'SERVICE' AND b.app_id = 'xprism' AND b.actor_id IS NULL,
    format('service context not applied: %s / %s', b.actor_type, b.app_id);
  PERFORM audit_set_context('00000000-0000-4000-8000-0000000000aa', '203.0.113.9', 'integrity-test', 'core', 'USER');

  SELECT * INTO v FROM audit_verify_chain();
  ASSERT v.ok, format('chain must verify, got: %s at %s', v.reason, v.first_bad_id);
  RAISE NOTICE 'PASS audit chain links, server-assigned fields, context, verification (% rows)', v.rows_checked;
END;
$$;

-- Append-only enforcement holds even for the table owner.
DO $$
DECLARE
  blocked int := 0;
BEGIN
  BEGIN UPDATE audit_logs SET metadata = '{"x":1}' WHERE event_type = 'TEST.FIRST';
  EXCEPTION WHEN insufficient_privilege THEN blocked := blocked + 1; END;
  BEGIN DELETE FROM audit_logs WHERE event_type = 'TEST.FIRST';
  EXCEPTION WHEN insufficient_privilege THEN blocked := blocked + 1; END;
  BEGIN TRUNCATE audit_logs;
  EXCEPTION WHEN insufficient_privilege THEN blocked := blocked + 1; END;
  BEGIN UPDATE audit_chain_head SET last_id = 0;
  EXCEPTION WHEN insufficient_privilege THEN blocked := blocked + 1; END;
  BEGIN UPDATE audit_chain_head SET genesis_hash = repeat('c', 64), last_id = last_id + 1;
  EXCEPTION WHEN insufficient_privilege THEN blocked := blocked + 1; END;
  BEGIN DELETE FROM audit_chain_head;
  EXCEPTION WHEN insufficient_privilege THEN blocked := blocked + 1; END;
  ASSERT blocked = 6, format('expected 6 blocked operations, got %s', blocked);
  RAISE NOTICE 'PASS UPDATE / DELETE / TRUNCATE on audit_logs and chain head are rejected';
END;
$$;

-- Tamper detection: bypass the triggers (as an attacker with owner/superuser
-- rights would) and confirm verification pinpoints the altered record.
SAVEPOINT tamper;
ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update;
UPDATE audit_logs SET metadata = '{"k": 2}' WHERE event_type = 'TEST.FIRST';
ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_update;
DO $$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM audit_verify_chain();
  ASSERT NOT v.ok, 'tampered content must be detected';
  ASSERT v.first_bad_id = (SELECT id FROM audit_logs WHERE event_type = 'TEST.FIRST'), 'must point at the altered row';
  ASSERT v.reason LIKE 'record_hash mismatch%', v.reason;
  RAISE NOTICE 'PASS altered record detected: %', v.reason;
END;
$$;
ROLLBACK TO SAVEPOINT tamper;

SAVEPOINT tamper_delete;
ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_delete;
DELETE FROM audit_logs WHERE event_type = 'TEST.FIRST';
ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_delete;
DO $$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM audit_verify_chain();
  ASSERT NOT v.ok, 'deleted record must be detected';
  ASSERT v.reason LIKE 'previous_hash does not match%', v.reason;
  RAISE NOTICE 'PASS deleted record detected: %', v.reason;
END;
$$;
ROLLBACK TO SAVEPOINT tamper_delete;

SAVEPOINT tamper_tail;
ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_delete;
DELETE FROM audit_logs WHERE id = (SELECT max(id) FROM audit_logs);
ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_delete;
DO $$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM audit_verify_chain();
  ASSERT NOT v.ok, 'tail truncation must be detected';
  ASSERT v.reason LIKE 'chain head does not match%', v.reason;
  RAISE NOTICE 'PASS tail deletion detected: %', v.reason;
END;
$$;
ROLLBACK TO SAVEPOINT tamper_tail;

-- ================================================== 2. row-change audit ======
DO $$
DECLARE l audit_logs%ROWTYPE;
BEGIN
  UPDATE users SET role = 'INSTITUTE_ADMIN', password_hash = '$argon2id$v=19$m=65536,t=3,p=4$bmV3$bmV3', updated_at = now()
   WHERE id = '20000000-0000-4000-8000-000000000001';
  SELECT * INTO l FROM audit_logs WHERE event_type = 'DB.USERS.UPDATE' ORDER BY id DESC LIMIT 1;
  ASSERT FOUND, 'user update must be audited';
  ASSERT l.resource_id = '20000000-0000-4000-8000-000000000001', 'resource must be the user id';
  ASSERT l.metadata #>> '{changes,role,old}' = 'PI' AND l.metadata #>> '{changes,role,new}' = 'INSTITUTE_ADMIN', 'role diff recorded';
  ASSERT l.metadata #>> '{changes,password_hash,new}' = '[REDACTED]', 'secrets must be redacted';
  ASSERT NOT (l.metadata -> 'changes') ? 'updated_at', 'ignored columns must not be recorded';

  -- A no-op update writes nothing.
  UPDATE users SET updated_at = now() WHERE id = '20000000-0000-4000-8000-000000000001';
  ASSERT (SELECT id FROM audit_logs WHERE event_type = 'DB.USERS.UPDATE' ORDER BY id DESC LIMIT 1) = l.id,
    'updates touching only ignored columns must not be audited';
  RAISE NOTICE 'PASS row-change audit with redaction and ignored columns';
END;
$$;

-- ===================================================== 3. credit ledger ======
DO $$
DECLARE
  e1 credit_ledger%ROWTYPE;
  e2 credit_ledger%ROWTYPE;
  failed boolean;
BEGIN
  INSERT INTO credit_ledger (user_id, action_type, delta, reference_id)
  VALUES ('20000000-0000-4000-8000-000000000002', 'PURCHASE', 100, 'pay_001') RETURNING * INTO e1;
  ASSERT e1.balance_after = 100 AND e1.account_id IS NOT NULL, 'top-up creates account and balance';

  INSERT INTO credit_ledger (user_id, app_id, action_type, delta, reference_id)
  VALUES ('20000000-0000-4000-8000-000000000002', 'amaze', 'TRACKING_JOB', -30, 'job_001') RETURNING * INTO e2;
  ASSERT e2.balance_after = 70, 'debit reduces balance';
  ASSERT credit_balance_for_user('20000000-0000-4000-8000-000000000002') = 70, 'balance helper';

  failed := false;
  BEGIN
    INSERT INTO credit_ledger (user_id, app_id, action_type, delta, reference_id)
    VALUES ('20000000-0000-4000-8000-000000000002', 'amaze', 'TRACKING_JOB', -71, 'job_002');
  EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, 'overdraft must be rejected';

  failed := false;
  BEGIN
    INSERT INTO credit_ledger (user_id, app_id, action_type, delta, reference_id)
    VALUES ('20000000-0000-4000-8000-000000000002', 'amaze', 'TRACKING_JOB', -10, 'job_001');
  EXCEPTION WHEN unique_violation THEN failed := true; END;
  ASSERT failed, 'duplicate reference must be rejected (idempotency)';
  ASSERT credit_balance_for_user('20000000-0000-4000-8000-000000000002') = 70, 'rejected entries leave balance intact';

  failed := false;
  BEGIN UPDATE credit_ledger SET delta = 1000 WHERE id = e1.id;
  EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  ASSERT failed, 'ledger is append-only';

  -- Org pool is shared by members.
  INSERT INTO credit_ledger (user_id, org_id, action_type, delta, reference_id)
  VALUES ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'MONTHLY_GRANT', 5000, 'grant_2026_11');
  ASSERT credit_balance_for_user('20000000-0000-4000-8000-000000000001') = 5000, 'org member sees org pool';

  failed := false;
  BEGIN
    INSERT INTO credit_ledger (user_id, org_id, action_type, delta, reference_id)
    VALUES ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'TRACKING_JOB', -1, 'x');
  EXCEPTION WHEN foreign_key_violation THEN failed := true; END;
  ASSERT failed, 'non-members cannot spend an org pool';
  RAISE NOTICE 'PASS credit ledger balance, overdraft, idempotency, append-only, org pool';
END;
$$;

-- ================================================= 4. strict paid access ====
DO $$
DECLARE
  u_pi   constant uuid := '20000000-0000-4000-8000-000000000001';
  u_solo constant uuid := '20000000-0000-4000-8000-000000000002';
  u_stu  constant uuid := '20000000-0000-4000-8000-000000000005';
  u_adv  constant uuid := '20000000-0000-4000-8000-000000000006';
  org    constant uuid := '10000000-0000-4000-8000-000000000001';
  c      record;
  v_sub  uuid;
  v_pkg  uuid;
  failed boolean;
BEGIN
  -- No free tier: a verified account, or a VIP role, holds nothing in the DB.
  SELECT * INTO c FROM user_access_claims(u_solo) WHERE app_id = 'xprism';
  ASSERT NOT c.active AND c.source IS NULL AND c.expires_at IS NULL, 'no grant -> no access';
  ASSERT NOT EXISTS (SELECT 1 FROM user_access_claims(u_adv) WHERE active),
    'roles grant nothing here (the VIP bypass is applied by altvivo-core)';
  ASSERT (SELECT count(*) FROM user_access_claims(u_solo)) = (SELECT count(*) FROM app_registry),
    'one claim row per registered app';

  -- Single-app subscription unlocks exactly its app.
  INSERT INTO subscriptions (user_id, provider, external_sub_id, plan_code, status, currency, unit_amount_minor,
                             current_period_start, current_period_end, updated_at)
  VALUES (u_solo, 'RAZORPAY', 'sub_t_x', 'xprism_monthly', 'ACTIVE', 'INR', 149900,
          now() - interval '1 day', now() + interval '29 days', now())
  RETURNING id INTO v_sub;
  SELECT * INTO c FROM user_access_claims(u_solo) WHERE app_id = 'xprism';
  ASSERT c.active AND c.source = 'individual' AND c.plan_code = 'xprism_monthly' AND c.plan_kind = 'SINGLE_APP'
     AND c.expires_at > now() + interval '28 days', format('single-app claim wrong: %s', row_to_json(c));
  ASSERT NOT (SELECT active FROM user_access_claims(u_solo) WHERE app_id = 'amaze'), 'single-app plan unlocks only its app';
  ASSERT NOT (SELECT active FROM user_access_claims(u_solo, now() - interval '2 days') WHERE app_id = 'xprism'),
    'no access before the paid period starts';

  -- PAST_DUE keeps the period already paid for, nothing beyond it.
  UPDATE subscriptions SET status = 'PAST_DUE', updated_at = now() WHERE id = v_sub;
  ASSERT (SELECT active FROM user_access_claims(u_solo) WHERE app_id = 'xprism'), 'past-due keeps access until period end';
  ASSERT NOT (SELECT active FROM user_access_claims(u_solo, now() + interval '30 days') WHERE app_id = 'xprism'),
    'no grace after current_period_end';

  -- Editing a plan's app list re-materialises its subscriptions.
  INSERT INTO plan_entitlements (plan_code, app_id) VALUES ('xprism_monthly', 'amaze');
  ASSERT EXISTS (SELECT 1 FROM app_entitlements WHERE sub_id = v_sub AND app_id = 'amaze'), 'plan edit adds apps';
  DELETE FROM plan_entitlements WHERE plan_code = 'xprism_monthly' AND app_id = 'amaze';
  ASSERT NOT EXISTS (SELECT 1 FROM app_entitlements WHERE sub_id = v_sub AND app_id = 'amaze'), 'plan edit removes apps';

  UPDATE subscriptions SET status = 'CANCELED', updated_at = now() WHERE id = v_sub;
  ASSERT (SELECT canceled_at IS NOT NULL AND ended_at IS NOT NULL FROM subscriptions WHERE id = v_sub), 'cancel is stamped';
  ASSERT NOT (SELECT active FROM user_access_claims(u_solo) WHERE app_id = 'xprism'), 'canceled grants nothing';

  -- One-time prepaid bundle: PENDING (checkout started) grants nothing.
  INSERT INTO subscriptions (user_id, provider, billing_mode, plan_code, status, currency, unit_amount_minor,
                             current_period_start, current_period_end, updated_at)
  VALUES (u_solo, 'STRIPE', 'ONE_TIME', 'suite_annual', 'PENDING', 'USD', 45000,
          now(), now() + interval '1 year', now())
  RETURNING id INTO v_pkg;
  ASSERT NOT EXISTS (SELECT 1 FROM user_access_claims(u_solo) WHERE active), 'pending checkout grants nothing';
  UPDATE subscriptions SET status = 'ACTIVE', updated_at = now() WHERE id = v_pkg;
  ASSERT (SELECT bool_and(active AND source = 'bundle') FROM user_access_claims(u_solo) WHERE app_id IN ('xprism', 'amaze')),
    'bundle unlocks XPRISM and aMaze';
  ASSERT NOT (SELECT active FROM user_access_claims(u_solo) WHERE app_id = 'pharmadme'), 'bundle does not reach other apps';

  -- Institution site licence: verified members of an ACTIVE organization.
  INSERT INTO subscriptions (org_id, provider, external_sub_id, plan_code, status, currency, seats, unit_amount_minor,
                             current_period_start, current_period_end, updated_at)
  VALUES (org, 'RAZORPAY', 'sub_t_site', 'site_license_annual', 'ACTIVE', 'INR', 50, 240000,
          now(), now() + interval '1 year', now());
  SELECT * INTO c FROM user_access_claims(u_pi) WHERE app_id = 'amaze';
  ASSERT c.active AND c.source = 'institution' AND c.plan_kind = 'SITE_LICENSE', 'member gets the site licence';
  ASSERT NOT (SELECT active FROM user_access_claims(u_stu) WHERE app_id = 'amaze'), 'unverified members get nothing';
  UPDATE organizations SET status = 'SUSPENDED' WHERE id = org;
  ASSERT (SELECT suspended_at IS NOT NULL FROM organizations WHERE id = org), 'suspension stamped';
  ASSERT NOT (SELECT active FROM user_access_claims(u_pi) WHERE app_id = 'amaze'), 'suspended institution grants nothing';
  UPDATE organizations SET status = 'ACTIVE' WHERE id = org;
  ASSERT (SELECT suspended_at IS NULL FROM organizations WHERE id = org), 'reactivation clears the stamp';
  UPDATE users SET disabled_at = now(), disabled_reason = 'test' WHERE id = u_pi;
  ASSERT NOT EXISTS (SELECT 1 FROM user_access_claims(u_pi) WHERE active), 'disabled users get nothing';
  UPDATE users SET disabled_at = NULL, disabled_reason = NULL WHERE id = u_pi;

  -- Owner / seat rules.
  failed := false;
  BEGIN
    INSERT INTO subscriptions (user_id, provider, external_sub_id, plan_code, status, currency, seats, unit_amount_minor, current_period_end, updated_at)
    VALUES (u_solo, 'RAZORPAY', 'sub_bad1', 'site_license_annual', 'ACTIVE', 'INR', 30, 240000, now() + interval '1 year', now());
  EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, 'site licence cannot belong to a user';
  failed := false;
  BEGIN
    INSERT INTO subscriptions (org_id, provider, external_sub_id, plan_code, status, currency, unit_amount_minor, current_period_end, updated_at)
    VALUES (org, 'RAZORPAY', 'sub_bad2', 'suite_monthly', 'ACTIVE', 'INR', 299900, now() + interval '1 month', now());
  EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, 'individual plans cannot belong to an organization';
  failed := false;
  BEGIN
    INSERT INTO subscriptions (org_id, provider, external_sub_id, plan_code, status, currency, seats, unit_amount_minor, current_period_end, updated_at)
    VALUES (org, 'RAZORPAY', 'sub_bad3', 'site_license_annual', 'ACTIVE', 'INR', 10, 240000, now() + interval '1 year', now());
  EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, 'site licence below minimum seats rejected';
  failed := false;
  BEGIN
    INSERT INTO subscriptions (user_id, provider, plan_code, status, currency, unit_amount_minor, current_period_end, updated_at)
    VALUES (u_solo, 'RAZORPAY', 'xprism_monthly', 'ACTIVE', 'INR', 149900, now() + interval '1 month', now());
  EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, 'recurring subscription needs the processor id';

  RAISE NOTICE 'PASS strict paid access: single app, bundle, site licence, period bounds, no grace, plan re-sync, owner/seat rules';
END;
$$;

-- ============================================ 5. manual licences / launch ====
DO $$
DECLARE
  u_pi    constant uuid := '20000000-0000-4000-8000-000000000001';
  u_solo  constant uuid := '20000000-0000-4000-8000-000000000002';
  u_unver constant uuid := '20000000-0000-4000-8000-000000000003';
  u_admin constant uuid := '20000000-0000-4000-8000-000000000004';
  org     constant uuid := '10000000-0000-4000-8000-000000000001';
  v       uuid;
  c       record;
  failed  boolean;
BEGIN
  INSERT INTO app_entitlements (app_id, source, user_id, granted_by, reason, reference, expires_at)
  VALUES ('xprism', 'MANUAL', u_unver, u_admin, 'Offline NEFT payment for PO 4411', 'UTR-55120', now() + interval '90 days')
  RETURNING id INTO v;
  SELECT * INTO c FROM user_access_claims(u_unver) WHERE app_id = 'xprism';
  ASSERT c.active AND c.source = 'manual' AND c.plan_code IS NULL AND c.expires_at > now() + interval '89 days',
    format('manual licence claim wrong: %s', row_to_json(c));

  failed := false;
  BEGIN
    INSERT INTO app_entitlements (app_id, source, user_id, granted_by, reason, expires_at)
    VALUES ('amaze', 'MANUAL', u_unver, u_pi, 'self-service', now() + interval '1 year');
  EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  ASSERT failed, 'only a SUPERADMIN can grant a manual licence';
  failed := false;
  BEGIN
    INSERT INTO app_entitlements (app_id, source, user_id, granted_by, reason)
    VALUES ('amaze', 'MANUAL', u_unver, u_admin, 'open-ended');
  EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, 'manual licences need an expiry';
  failed := false;
  BEGIN
    INSERT INTO app_entitlements (app_id, source, sub_id) VALUES ('amaze', 'SUBSCRIPTION', NULL);
  EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, 'subscription rows need a subscription';

  UPDATE app_entitlements SET expires_at = now() + interval '180 days', reference = 'UTR-55120/2' WHERE id = v;
  failed := false;
  BEGIN UPDATE app_entitlements SET user_id = u_solo WHERE id = v;
  EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  ASSERT failed, 'licence holder is immutable';
  failed := false;
  BEGIN DELETE FROM app_entitlements WHERE id = v;
  EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  ASSERT failed, 'manual licences are never deleted';

  UPDATE app_entitlements SET revoked_at = now(), revoked_by = u_admin, revoke_reason = 'Payment reversed' WHERE id = v;
  ASSERT NOT (SELECT active FROM user_access_claims(u_unver) WHERE app_id = 'xprism'), 'revocation removes access';
  failed := false;
  BEGIN UPDATE app_entitlements SET expires_at = now() + interval '2 years' WHERE id = v;
  EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  ASSERT failed, 'revocation is final';
  ASSERT EXISTS (SELECT 1 FROM audit_logs WHERE event_type = 'DB.APP_ENTITLEMENTS.UPDATE' AND resource_id = v::text
                  AND metadata #>> '{changes,revoke_reason,new}' = 'Payment reversed'), 'revocation audited';

  -- Organization-wide manual licence (purchase order) for a Phase 2 app.
  INSERT INTO app_entitlements (app_id, source, org_id, granted_by, reason, reference, expires_at)
  VALUES ('mira', 'MANUAL', org, u_admin, 'Pilot under PO TIP/2026/118', 'PO TIP/2026/118', now() + interval '1 year');
  SELECT * INTO c FROM user_access_claims(u_pi) WHERE app_id = 'mira';
  ASSERT NOT c.active AND c.source IS NULL, 'a COMING_SOON app never resolves to access';
  UPDATE app_registry SET status = 'LIVE', version = '1.0.0' WHERE app_id = 'mira';
  SELECT * INTO c FROM user_access_claims(u_pi) WHERE app_id = 'mira';
  ASSERT c.active AND c.source = 'institution', 'grant applies once the app launches';
  ASSERT (SELECT status_changed_by FROM app_registry WHERE app_id = 'mira') = '00000000-0000-4000-8000-0000000000aa',
    'status change stamped with acting user';
  ASSERT EXISTS (SELECT 1 FROM audit_logs WHERE event_type = 'DB.APP_REGISTRY.UPDATE' AND resource_id = 'mira'
                  AND metadata #>> '{changes,status,new}' = 'LIVE'), 'status flip audited';
  UPDATE app_registry SET status = 'MAINTENANCE' WHERE app_id = 'mira';
  ASSERT (SELECT active FROM user_access_claims(u_pi) WHERE app_id = 'mira'),
    'maintenance keeps the paid flag (core decides the maintenance redirect)';

  RAISE NOTICE 'PASS manual licences (SUPERADMIN only, expiry, immutable holder, revoke-not-delete), COMING_SOON cap, launch';
END;
$$;

-- ===================================================== 6. seat limits ========
DO $$
DECLARE
  o2     constant uuid := '10000000-0000-4000-8000-000000000002';
  failed boolean;
BEGIN
  INSERT INTO organizations (id, name, seat_limit, billing_country) VALUES (o2, 'Two Seat Lab', 2, 'IN');
  INSERT INTO users (id, email, full_name, org_id, updated_at) VALUES
    ('30000000-0000-4000-8000-000000000001', 'a@two.example', 'A', o2, now()),
    ('30000000-0000-4000-8000-000000000002', 'b@two.example', 'B', o2, now());
  failed := false;
  BEGIN INSERT INTO users (email, full_name, org_id, updated_at) VALUES ('c@two.example', 'C', o2, now());
  EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, 'joining a full organization is rejected';

  UPDATE users SET disabled_at = now() WHERE id = '30000000-0000-4000-8000-000000000002';
  INSERT INTO users (id, email, full_name, org_id, updated_at)
  VALUES ('30000000-0000-4000-8000-000000000003', 'c@two.example', 'C', o2, now());
  ASSERT org_seats_used(o2) = 2, 'disabled members free their seat';

  failed := false;
  BEGIN UPDATE users SET disabled_at = NULL WHERE id = '30000000-0000-4000-8000-000000000002';
  EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, 're-enabling into a full organization is rejected';
  failed := false;
  BEGIN UPDATE organizations SET seat_limit = 1 WHERE id = o2;
  EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, 'seat limit cannot drop below active members';
  UPDATE organizations SET seat_limit = 3 WHERE id = o2;
  UPDATE users SET disabled_at = NULL WHERE id = '30000000-0000-4000-8000-000000000002';
  ASSERT org_seats_used(o2) = 3, 'raised limit admits the member';
  RAISE NOTICE 'PASS institution seat limits';
END;
$$;

-- ================================================= 7. GST invoices ===========
DO $$
DECLARE
  u_solo constant uuid := '20000000-0000-4000-8000-000000000002';
  org    constant uuid := '10000000-0000-4000-8000-000000000001';
  inv    invoices%ROWTYPE;
  b2c    invoices%ROWTYPE;
  cn     invoices%ROWTYPE;
  pf     invoices%ROWTYPE;
  ex     invoices%ROWTYPE;
  n1     int;
  failed boolean;
BEGIN
  INSERT INTO invoices (kind, org_id, currency, tax_treatment, seller_legal_name, seller_gstin, seller_address, seller_state_code,
                        buyer_name, buyer_email, buyer_gstin, buyer_address, buyer_state_code, buyer_country, place_of_supply,
                        total_minor, number)
  VALUES ('TAX_INVOICE', org, 'INR', 'INTRA_STATE', 'AltVivo Test Seller', '29AAACA1234B1ZE', 'Bengaluru, Karnataka', '29',
          'Test Institute of Pharmacy', 'accounts@tip.edu.in', '29AAAPZ5678K1ZR', 'Bengaluru, Karnataka', '29', 'IN', '29',
          999999, 'AV/9999-99/99999')
  RETURNING * INTO inv;
  ASSERT inv.total_minor = 0 AND inv.number IS NULL, 'caller-supplied totals / number discarded on insert';

  INSERT INTO invoice_lines (invoice_id, position, description, sac_code, plan_code, quantity, unit_price_minor, discount_minor, gst_rate_bp)
  VALUES (inv.id, 1, 'Institutional Site Licence - 50 seats x 12 months', '997331', 'site_license_annual', 50, 240000, 0, 1800),
         (inv.id, 2, 'Onboarding workshop', '998399', NULL, 1, 10001, 1, 1800),
         (inv.id, 3, 'Rounding probe', '997331', NULL, 1, 50, 0, 1800);
  SELECT * INTO inv FROM invoices WHERE id = inv.id;
  -- 12,000,000 -> 1,080,000 x2 ; 10,000 -> 900 x2 ; 50 -> 4.5 -> 5 x2 (half-up)
  ASSERT (inv.subtotal_minor, inv.discount_minor, inv.taxable_minor, inv.cgst_minor, inv.sgst_minor, inv.igst_minor, inv.total_minor)
       = (12010051::bigint, 1::bigint, 12010050::bigint, 1080905::bigint, 1080905::bigint, 0::bigint, 14171860::bigint),
    format('intra-state totals wrong: %s', row_to_json(inv));

  UPDATE invoices SET total_minor = 1 WHERE id = inv.id;
  ASSERT (SELECT total_minor FROM invoices WHERE id = inv.id) = 14171860, 'totals cannot be written directly';

  -- Buyer moves to Maharashtra: inter-state, the lines are re-priced as IGST.
  UPDATE invoices SET tax_treatment = 'INTER_STATE', buyer_state_code = '27', buyer_gstin = '27AAACA1234B1ZI', place_of_supply = '27'
   WHERE id = inv.id;
  SELECT * INTO inv FROM invoices WHERE id = inv.id;
  ASSERT inv.cgst_minor = 0 AND inv.sgst_minor = 0 AND inv.igst_minor = 2161809 AND inv.total_minor = 14171859,
    format('inter-state re-pricing wrong: %s', row_to_json(inv));

  failed := false;
  BEGIN UPDATE invoices SET place_of_supply = '29' WHERE id = inv.id;
  EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, 'place of supply must match the treatment';
  failed := false;
  BEGIN UPDATE invoices SET buyer_gstin = '27AAACA1234B1ZJ' WHERE id = inv.id;
  EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, 'GSTIN checksum enforced';

  -- Issue: gapless number in the Indian financial year.
  UPDATE invoices SET status = 'ISSUED' WHERE id = inv.id RETURNING * INTO inv;
  ASSERT inv.number ~ '^AV/[0-9]{4}-[0-9]{2}/[0-9]{5}$' AND inv.financial_year = indian_financial_year(now())
     AND inv.issued_at IS NOT NULL AND split_part(inv.number, '/', 2) = inv.financial_year,
    format('issue stamping wrong: %s', inv.number);
  n1 := split_part(inv.number, '/', 3)::int;

  failed := false;
  BEGIN UPDATE invoices SET buyer_name = 'Someone Else' WHERE id = inv.id;
  EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  ASSERT failed, 'issued invoice header is immutable';
  failed := false;
  BEGIN UPDATE invoice_lines SET quantity = 1 WHERE invoice_id = inv.id;
  EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  ASSERT failed, 'issued invoice lines are frozen';
  failed := false;
  BEGIN INSERT INTO invoice_lines (invoice_id, position, description, sac_code, quantity, unit_price_minor, gst_rate_bp)
        VALUES (inv.id, 9, 'late line', '997331', 1, 100, 1800);
  EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  ASSERT failed, 'no lines can be added after issue';
  failed := false;
  BEGIN DELETE FROM invoices WHERE id = inv.id;
  EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  ASSERT failed, 'issued invoices are never deleted';

  UPDATE invoices SET pdf_object_key = 'invoices/2026-27/av-test.pdf', pdf_sha256 = repeat('c', 64) WHERE id = inv.id;
  failed := false;
  BEGIN UPDATE invoices SET pdf_object_key = 'invoices/other.pdf', pdf_sha256 = repeat('d', 64) WHERE id = inv.id;
  EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  ASSERT failed, 'the PDF is attached once';

  -- B2C intra-state invoice takes the next number.
  INSERT INTO invoices (kind, user_id, currency, tax_treatment, seller_legal_name, seller_gstin, seller_address, seller_state_code,
                        buyer_name, buyer_email, buyer_address, buyer_state_code, buyer_country, place_of_supply)
  VALUES ('TAX_INVOICE', u_solo, 'INR', 'INTRA_STATE', 'AltVivo Test Seller', '29AAACA1234B1ZE', 'Bengaluru, Karnataka', '29',
          'Solo Researcher', 'solo@example.org', 'Mysuru, Karnataka', '29', 'IN', '29')
  RETURNING * INTO b2c;
  INSERT INTO invoice_lines (invoice_id, position, description, sac_code, plan_code, quantity, unit_price_minor, gst_rate_bp)
  VALUES (b2c.id, 1, 'XPRISM - 1 month', '997331', 'xprism_monthly', 1, 149900, 1800);
  UPDATE invoices SET status = 'ISSUED' WHERE id = b2c.id RETURNING * INTO b2c;
  ASSERT split_part(b2c.number, '/', 3)::int = n1 + 1, format('numbers must be consecutive: %s after %s', b2c.number, inv.number);
  ASSERT b2c.total_minor = 176882, format('149900 + 2 x 13491 = 176882, got %s', b2c.total_minor);

  -- Credit notes: capped at the invoice total.
  INSERT INTO invoices (kind, org_id, related_invoice_id, currency, tax_treatment, seller_legal_name, seller_gstin, seller_address,
                        seller_state_code, buyer_name, buyer_email, buyer_gstin, buyer_address, buyer_state_code, buyer_country, place_of_supply)
  SELECT 'CREDIT_NOTE', org_id, id, currency, tax_treatment, seller_legal_name, seller_gstin, seller_address, seller_state_code,
         buyer_name, buyer_email, buyer_gstin, buyer_address, buyer_state_code, buyer_country, place_of_supply
    FROM invoices WHERE id = inv.id
  RETURNING * INTO cn;
  INSERT INTO invoice_lines (invoice_id, position, description, sac_code, quantity, unit_price_minor, gst_rate_bp)
  VALUES (cn.id, 1, 'Seat reduction 50 -> 45', '997331', 5, 240000, 1800);
  UPDATE invoices SET status = 'ISSUED' WHERE id = cn.id RETURNING * INTO cn;
  ASSERT cn.number LIKE 'CN/%' AND cn.total_minor = 1416000, format('credit note wrong: %s %s', cn.number, cn.total_minor);

  INSERT INTO invoices (kind, org_id, related_invoice_id, currency, tax_treatment, seller_legal_name, seller_gstin, seller_address,
                        seller_state_code, buyer_name, buyer_email, buyer_gstin, buyer_address, buyer_state_code, buyer_country, place_of_supply)
  SELECT 'CREDIT_NOTE', org_id, id, currency, tax_treatment, seller_legal_name, seller_gstin, seller_address, seller_state_code,
         buyer_name, buyer_email, buyer_gstin, buyer_address, buyer_state_code, buyer_country, place_of_supply
    FROM invoices WHERE id = inv.id
  RETURNING * INTO cn;
  INSERT INTO invoice_lines (invoice_id, position, description, sac_code, quantity, unit_price_minor, gst_rate_bp)
  VALUES (cn.id, 1, 'Over-credit', '997331', 50, 240000, 1800);
  failed := false;
  BEGIN UPDATE invoices SET status = 'ISSUED' WHERE id = cn.id;
  EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, 'credit notes cannot exceed the invoice';
  DELETE FROM invoices WHERE id = cn.id;
  ASSERT NOT EXISTS (SELECT 1 FROM invoice_lines WHERE invoice_id = cn.id), 'deleting a draft removes its lines';

  -- Settlement.
  UPDATE invoices SET status = 'PAID' WHERE id = inv.id RETURNING * INTO inv;
  ASSERT inv.paid_at IS NOT NULL, 'paid_at stamped';
  failed := false;
  BEGIN UPDATE invoices SET status = 'CANCELLED', cancel_reason = 'x' WHERE id = inv.id;
  EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, 'a paid tax invoice is reversed by credit note, not cancelled';
  UPDATE invoices SET status = 'CANCELLED', cancel_reason = 'Issued to the wrong customer' WHERE id = b2c.id RETURNING * INTO b2c;
  ASSERT b2c.cancelled_at IS NOT NULL AND b2c.number IS NOT NULL, 'cancelled invoices keep their number';

  -- Proforma (procurement quotation) needs a validity date.
  INSERT INTO invoices (kind, org_id, currency, tax_treatment, seller_legal_name, seller_gstin, seller_address, seller_state_code,
                        buyer_name, buyer_email, buyer_address, buyer_state_code, buyer_country, place_of_supply, po_number)
  VALUES ('PROFORMA', org, 'INR', 'INTRA_STATE', 'AltVivo Test Seller', '29AAACA1234B1ZE', 'Bengaluru, Karnataka', '29',
          'Test Institute of Pharmacy', 'accounts@tip.edu.in', 'Bengaluru, Karnataka', '29', 'IN', '29', 'TIP/PO/2026/77')
  RETURNING * INTO pf;
  INSERT INTO invoice_lines (invoice_id, position, description, sac_code, plan_code, quantity, unit_price_minor, gst_rate_bp)
  VALUES (pf.id, 1, 'Institutional Site Licence - 100 seats x 12 months', '997331', 'site_license_annual', 100, 240000, 1800);
  failed := false;
  BEGIN UPDATE invoices SET status = 'ISSUED' WHERE id = pf.id;
  EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, 'proforma without validity rejected';
  UPDATE invoices SET valid_until = current_date + 30 WHERE id = pf.id;
  UPDATE invoices SET status = 'ISSUED' WHERE id = pf.id RETURNING * INTO pf;
  ASSERT pf.number LIKE 'PF/%' AND pf.total_minor = 28320000, format('proforma wrong: %s %s', pf.number, pf.total_minor);

  -- Export of services under LUT: zero-rated, USD allowed.
  INSERT INTO invoices (kind, user_id, currency, tax_treatment, seller_legal_name, seller_gstin, seller_address, seller_state_code,
                        buyer_name, buyer_email, buyer_address, buyer_country, place_of_supply)
  VALUES ('TAX_INVOICE', u_solo, 'USD', 'EXPORT', 'AltVivo Test Seller', '29AAACA1234B1ZE', 'Bengaluru, Karnataka', '29',
          'Overseas Lab', 'lab@example.org', 'Boston, MA, USA', 'US', '96')
  RETURNING * INTO ex;
  INSERT INTO invoice_lines (invoice_id, position, description, sac_code, quantity, unit_price_minor, gst_rate_bp)
  VALUES (ex.id, 1, 'AltVivo Dual-Suite - 12 months', '997331', 1, 45000, 1800);
  SELECT * INTO ex FROM invoices WHERE id = ex.id;
  ASSERT ex.cgst_minor + ex.sgst_minor + ex.igst_minor = 0 AND ex.total_minor = 45000, 'exports are zero-rated';
  failed := false;
  BEGIN
    INSERT INTO invoices (kind, user_id, currency, tax_treatment, seller_legal_name, seller_address, seller_state_code,
                          buyer_name, buyer_email, buyer_address, buyer_state_code, buyer_country, place_of_supply)
    VALUES ('TAX_INVOICE', u_solo, 'USD', 'INTRA_STATE', 'S', 'A', '29', 'B', 'b@example.org', 'A', '29', 'IN', '29');
  EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, 'domestic invoices are in INR';

  RAISE NOTICE 'PASS GST invoices: line maths, CGST/SGST/IGST, re-pricing, gapless FY numbering, immutability, credit-note cap, proforma, export';
END;
$$;

-- ==================================================== 8. payments ============
DO $$
DECLARE
  u_solo  constant uuid := '20000000-0000-4000-8000-000000000002';
  u_admin constant uuid := '20000000-0000-4000-8000-000000000004';
  org     constant uuid := '10000000-0000-4000-8000-000000000001';
  p       payments%ROWTYPE;
  failed  boolean;
BEGIN
  INSERT INTO payments (provider, user_id, currency, amount_minor, tax_minor, provider_order_id, plan_code, description)
  VALUES ('RAZORPAY', u_solo, 'INR', 176882, 26982, 'order_t1', 'xprism_monthly', 'XPRISM - 1 month')
  RETURNING * INTO p;
  UPDATE payments SET status = 'CAPTURED', captured_at = now(), provider_payment_id = 'pay_t1', method = 'upi' WHERE id = p.id;

  failed := false;
  BEGIN UPDATE payments SET amount_minor = 1 WHERE id = p.id;
  EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  ASSERT failed, 'captured amount is immutable';
  failed := false;
  BEGIN UPDATE payments SET provider_payment_id = 'pay_other' WHERE id = p.id;
  EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  ASSERT failed, 'processor ids are set once';
  failed := false;
  BEGIN UPDATE payments SET status = 'FAILED' WHERE id = p.id;
  EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, 'captured payments cannot become failed';

  UPDATE payments SET status = 'PARTIALLY_REFUNDED', refunded_minor = 1000, refunded_at = now() WHERE id = p.id;
  failed := false;
  BEGIN UPDATE payments SET refunded_minor = 500 WHERE id = p.id;
  EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, 'refunds only grow';
  UPDATE payments SET status = 'REFUNDED', refunded_minor = 176882 WHERE id = p.id;

  failed := false;
  BEGIN INSERT INTO payments (provider, user_id, currency, amount_minor, provider_order_id, description)
        VALUES ('RAZORPAY', u_solo, 'USD', 100, 'order_t2', 'x');
  EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, 'Razorpay payments are INR';
  failed := false;
  BEGIN INSERT INTO payments (provider, org_id, currency, amount_minor, description, recorded_by)
        VALUES ('BANK_TRANSFER', org, 'INR', 28320000, 'Site licence - NEFT', u_admin);
  EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, 'bank transfers need the UTR / reference';
  INSERT INTO payments (provider, status, org_id, currency, amount_minor, tax_minor, method, reference, description, recorded_by, captured_at)
  VALUES ('BANK_TRANSFER', 'CAPTURED', org, 'INR', 28320000, 4320000, 'neft', 'UTR SBIN0000123456', 'Site licence - NEFT', u_admin, now());
  ASSERT EXISTS (SELECT 1 FROM audit_logs WHERE event_type = 'DB.PAYMENTS.UPDATE' AND resource_id = p.id::text), 'payment changes audited';
  RAISE NOTICE 'PASS payments: state machine, immutable amounts, monotonic refunds, provider rules, offline NEFT';
END;
$$;

-- ======================================= 9. CMS, contact, consent, billing ====
DO $$
DECLARE
  u_solo constant uuid := '20000000-0000-4000-8000-000000000002';
  v      uuid;
  failed int := 0;
BEGIN
  INSERT INTO advisory_board_members (slug, honorific, full_name, credentials, designation, affiliation, bio, photo_url, photo_alt,
                                      specializations, orcid_id, linkedin_url, is_published, featured, sort_order)
  VALUES ('test-advisor', 'Prof.', 'Test Advisor', 'M.Pharm, PhD', 'Professor of Pharmacology', 'Test University',
          'Works on alternatives to animal testing.', 'https://cdn.altvivo.bio/advisory/test.webp', 'Portrait of Test Advisor',
          ARRAY['Neuropharmacology', '3Rs'], '0000-0002-1825-0097', 'https://www.linkedin.com/in/test-advisor', true, true, 10);
  ASSERT EXISTS (SELECT 1 FROM audit_logs WHERE event_type = 'DB.ADVISORY_BOARD_MEMBERS.INSERT'), 'CMS edits audited';
  BEGIN INSERT INTO advisory_board_members (slug, full_name, designation, affiliation, bio, linkedin_url)
        VALUES ('a', 'A', 'D', 'X', 'B', 'https://evil.example/linkedin.com/in/x');
  EXCEPTION WHEN check_violation THEN failed := failed + 1; END;
  BEGIN INSERT INTO advisory_board_members (slug, full_name, designation, affiliation, bio, photo_url)
        VALUES ('b', 'B', 'D', 'X', 'B', 'https://cdn.altvivo.bio/b.webp');
  EXCEPTION WHEN check_violation THEN failed := failed + 1; END;
  BEGIN INSERT INTO advisory_board_members (slug, full_name, designation, affiliation, bio)
        VALUES ('Bad Slug', 'C', 'D', 'X', 'B');
  EXCEPTION WHEN check_violation THEN failed := failed + 1; END;
  BEGIN INSERT INTO advisory_board_members (slug, full_name, designation, affiliation, bio, specializations)
        VALUES ('d', 'D', 'D', 'X', 'B', ARRAY[repeat('x', 61)]);
  EXCEPTION WHEN check_violation THEN failed := failed + 1; END;
  BEGIN INSERT INTO advisory_board_members (slug, full_name, designation, affiliation, bio, website_url)
        VALUES ('e', 'E', 'D', 'X', 'B', 'javascript:alert(1)');
  EXCEPTION WHEN check_violation THEN failed := failed + 1; END;

  INSERT INTO contact_messages (name, email, institution, category, subject, message, app_id)
  VALUES ('Dr. Buyer', 'buyer@tip.edu.in', 'Test Institute of Pharmacy', 'institutional', 'Site licence quote', 'Please send a proforma for 60 seats.', 'xprism');
  BEGIN INSERT INTO contact_messages (name, email, category, subject, message) VALUES ('X', 'x@example.org', 'hacking', 'S', 'M');
  EXCEPTION WHEN check_violation THEN failed := failed + 1; END;

  INSERT INTO consent_records (subject_id, policy_version, action, functional, analytics, marketing, ip_hash)
  VALUES (gen_random_uuid(), '2026-11-15', 'ACCEPT_ALL', true, true, true, repeat('e', 64))
  RETURNING id INTO v;
  BEGIN INSERT INTO consent_records (subject_id, policy_version, action, analytics) VALUES (gen_random_uuid(), '2026-11-15', 'ACCEPT_ALL', false);
  EXCEPTION WHEN check_violation THEN failed := failed + 1; END;
  BEGIN UPDATE consent_records SET marketing = false WHERE id = v;
  EXCEPTION WHEN insufficient_privilege THEN failed := failed + 1; END;
  BEGIN DELETE FROM consent_records WHERE id = v;
  EXCEPTION WHEN insufficient_privilege THEN failed := failed + 1; END;

  INSERT INTO billing_profiles (user_id, legal_name, email, address_line1, city, state, state_code, postal_code, country)
  VALUES (u_solo, 'Solo Researcher', 'solo@example.org', '12 Lab Road', 'Mysuru', 'Karnataka', '29', '570001', 'IN');
  BEGIN INSERT INTO billing_profiles (org_id, legal_name, email, address_line1, city, postal_code, country)
        VALUES ('10000000-0000-4000-8000-000000000001', 'TIP', 'a@tip.edu.in', 'Road', 'City', '560001', 'IN');
  EXCEPTION WHEN check_violation THEN failed := failed + 1; END;
  BEGIN INSERT INTO billing_profiles (org_id, legal_name, gstin, email, address_line1, city, state_code, postal_code, country)
        VALUES ('10000000-0000-4000-8000-000000000001', 'TIP', '27AAACA1234B1ZI', 'a@tip.edu.in', 'Road', 'City', '29', '560001', 'IN');
  EXCEPTION WHEN check_violation THEN failed := failed + 1; END;

  ASSERT failed = 11, format('expected 11 rejections, got %s', failed);
  RAISE NOTICE 'PASS advisory CMS URL/slug/photo rules, contact categories, append-only consent, billing profile GST rules';
END;
$$;

-- ================================================ 10. constraint spot checks ==
DO $$
DECLARE failed int := 0;
BEGIN
  BEGIN INSERT INTO users (email, full_name, updated_at) VALUES ('not-an-email', 'X', now());
  EXCEPTION WHEN check_violation THEN failed := failed + 1; END;
  BEGIN INSERT INTO users (email, full_name, password_hash, updated_at) VALUES ('a@b.co', 'X', 'plaintext', now());
  EXCEPTION WHEN check_violation THEN failed := failed + 1; END;
  BEGIN INSERT INTO subscriptions (provider, external_sub_id, plan_code, status, currency, unit_amount_minor, current_period_end, updated_at)
        VALUES ('STRIPE', 'sub_orphan', 'xprism_monthly', 'ACTIVE', 'USD', 2400, now(), now());
  EXCEPTION WHEN check_violation THEN failed := failed + 1; END;
  BEGIN INSERT INTO workspace_files (owner_id, source_app, file_name, file_type, r2_object_key, size_bytes, sha256_hash)
        VALUES ('20000000-0000-4000-8000-000000000002', 'amaze', '../etc/passwd', 'CSV', 'u/x.csv', 10, repeat('a', 64));
  EXCEPTION WHEN check_violation THEN failed := failed + 1; END;
  BEGIN UPDATE app_registry SET subdomain_url = 'https://evil.example.com' WHERE app_id = 'xprism';
  EXCEPTION WHEN check_violation THEN failed := failed + 1; END;
  BEGIN UPDATE plans SET pricing_model = 'PER_SEAT' WHERE plan_code = 'xprism_monthly';
  EXCEPTION WHEN check_violation THEN failed := failed + 1; END;
  ASSERT failed = 6, format('expected 6 constraint rejections, got %s', failed);
  RAISE NOTICE 'PASS constraint spot checks';
END;
$$;

-- Final: whole chain still verifies after every test above.
DO $$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM audit_verify_chain();
  ASSERT v.ok, format('final chain verification failed: %s', v.reason);
  RAISE NOTICE 'PASS final chain verification (% records)', v.rows_checked;
END;
$$;

ROLLBACK;
