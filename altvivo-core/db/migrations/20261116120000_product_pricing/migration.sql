-- =============================================================================
-- AltVivo core - product pricing (XPRISM and aMaze sold separately, yearly)
-- -----------------------------------------------------------------------------
--   XPRISM : Rs 20,000 per year + GST, one account for up to 100 students and
--            4 teachers.
--   aMaze  : Rs 15,000 per year + GST (pay-per-use, Rs 50 per animal / video
--            tracked and analysed, is quoted on the website and sold on request).
-- Monthly plans, the Dual-Suite bundle and the institutional site licence are
-- withdrawn from the public price list. They are hidden, not deleted, so
-- existing subscriptions, invoices and the SUPERADMIN tools keep working.
-- On a new database the plans do not exist yet (the seed creates them with
-- these values), so every statement below is a no-op there.
-- =============================================================================

UPDATE plans
   SET name = 'XPRISM',
       description = 'Annual subscription to the XPRISM virtual pharmacology laboratory for one account: up to 100 students and 4 teachers.',
       price_inr_paise = 2000000,
       features = ARRAY['Up to 100 students per account', 'Up to 4 teachers per account', 'All 40+ virtual experiments', 'Assignments, batches and marks sheets', 'Experiment reports & exports'],
       is_public = true,
       sort_order = 10,
       updated_at = now()
 WHERE plan_code = 'xprism_annual';

UPDATE plans
   SET name = 'aMaze',
       description = 'Annual subscription to aMaze rodent behaviour video tracking, with unlimited videos.',
       price_inr_paise = 1500000,
       features = ARRAY['Unlimited animals and videos for 12 months', 'Markerless tracking & heatmaps', 'Open field, EPM, Y-maze, MWM', 'CSV / JSON export'],
       is_public = true,
       sort_order = 20,
       updated_at = now()
 WHERE plan_code = 'amaze_annual';

UPDATE plans
   SET is_public = false, highlighted = false, updated_at = now()
 WHERE plan_code IN ('xprism_monthly', 'amaze_monthly', 'suite_monthly', 'suite_annual', 'site_license_annual');
