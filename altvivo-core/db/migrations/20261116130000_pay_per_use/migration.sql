-- =============================================================================
-- AltVivo core - pay per use (aMaze: one credit = one animal / video analysed)
-- -----------------------------------------------------------------------------
-- A person buys analyses in advance (a GST tax invoice, paid online). Each one
-- is a credit in credit_ledger. While the balance is above zero the person may
-- open every app that is sold per use (app_registry.requires_credits), and the
-- app reports each analysis to core, which takes one credit. A subscription,
-- free month or licence always comes first: its holder is never charged per use.
-- =============================================================================

UPDATE app_registry SET requires_credits = true WHERE app_id = 'amaze';

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
    UNION ALL
    -- Pay per use: open while prepaid analyses remain (no end date).
    SELECT r.app_id, 'payg', NULL::varchar, NULL::plan_kind, NULL::timestamptz
      FROM app_registry r
     WHERE r.requires_credits
       AND EXISTS (SELECT 1 FROM u WHERE u.email_verified_at IS NOT NULL)
       AND credit_balance_for_user(p_user_id) > 0
  ),
  best AS (
    -- A subscription, licence or free month outranks pay per use (its holder is
    -- not charged per analysis); among those the longest-lasting wins, and at
    -- equal expiry a paid grant outranks the free month.
    SELECT DISTINCT ON (g.app_id) g.*
      FROM grants g
     ORDER BY g.app_id, (g.source = 'payg'), g.expires_at DESC, (g.source = 'trial')
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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'core_app') THEN
    GRANT EXECUTE ON FUNCTION user_access_claims(uuid, timestamptz) TO core_app;
  END IF;
END;
$$;
