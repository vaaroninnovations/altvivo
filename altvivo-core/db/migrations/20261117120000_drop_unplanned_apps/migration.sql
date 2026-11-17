-- PharmADME, Stat (StatoMate AI), PhytoNet AI and MIRA were listed as
-- "coming soon" but are not planned. Remove them, and retire the
-- COMING_SOON status: AltVivo lists only applications that exist.
--
-- Production held no waitlist sign-ups, licences, credits, invoices or files
-- for these apps when this was written; the deletes below cover the tables
-- that may still point at them so the app rows can go.

SELECT audit_set_context(NULL::uuid, NULL::inet, 'migration: drop unplanned apps', 'core', 'SYSTEM'::audit_actor_type);

DELETE FROM app_waitlist      WHERE app_id IN ('pharmadme', 'stat', 'phytonet', 'mira');
DELETE FROM plan_entitlements WHERE app_id IN ('pharmadme', 'stat', 'phytonet', 'mira');
UPDATE contact_messages SET app_id = NULL WHERE app_id IN ('pharmadme', 'stat', 'phytonet', 'mira');
UPDATE trial_requests
   SET app_ids = array_remove(array_remove(array_remove(array_remove(app_ids, 'pharmadme'), 'stat'), 'phytonet'), 'mira')
 WHERE app_ids && ARRAY['pharmadme', 'stat', 'phytonet', 'mira']::text[]
   AND cardinality(array_remove(array_remove(array_remove(array_remove(app_ids, 'pharmadme'), 'stat'), 'phytonet'), 'mira')) >= 1;

DELETE FROM app_registry WHERE app_id IN ('pharmadme', 'stat', 'phytonet', 'mira');

-- Any other app still marked COMING_SOON becomes MAINTENANCE (not launchable
-- for customers) until an admin sets it LIVE or BETA.
UPDATE app_registry SET status = 'MAINTENANCE' WHERE status = 'COMING_SOON';

-- The enum label stays (database functions compare against it), but no app
-- can hold it any more.
ALTER TABLE app_registry ALTER COLUMN status SET DEFAULT 'MAINTENANCE';
ALTER TABLE app_registry ADD CONSTRAINT app_registry_no_coming_soon_chk CHECK (status <> 'COMING_SOON');
