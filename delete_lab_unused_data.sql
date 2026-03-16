-- =====================================================
-- DELETE UNUSED DATA FOR LAB ID: 113bf166-ca18-40cd-9b5e-552958be0d58
-- =====================================================
-- DANGER ZONE: This script permanently deletes unused data
-- ALWAYS RUN THE AUDIT SCRIPT FIRST (cleanup_lab_unused_data.sql)
-- ALWAYS RUN DRY_RUN FIRST BEFORE ACTUAL DELETION
-- =====================================================

-- Store lab ID in a variable
\set lab_id '113bf166-ca18-40cd-9b5e-552958be0d58'
\set dry_run true  -- Set to false when ready to actually delete

-- =====================================================
-- DRY RUN: SHOW WHAT WOULD BE DELETED
-- =====================================================
-- This is safe to run - it only shows, doesn't delete

BEGIN;

-- Show unmapped test groups to be deleted
SELECT 'DRY RUN: Test Groups to Delete' AS action, COUNT(*) as count
FROM test_groups tg
WHERE tg.lab_id = :'lab_id'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id)
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.test_group_id = tg.id)
  AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = tg.id)
  AND NOT EXISTS (SELECT 1 FROM test_workflow_map twm WHERE twm.test_group_id = tg.id);

-- Show details of test groups to be deleted
SELECT 
  tg.id,
  tg.name,
  tg.code,
  tg.created_at,
  'TEST_GROUP_DELETE' AS action
FROM test_groups tg
WHERE tg.lab_id = :'lab_id'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id)
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.test_group_id = tg.id)
  AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = tg.id)
  AND NOT EXISTS (SELECT 1 FROM test_workflow_map twm WHERE twm.test_group_id = tg.id);

-- Show orphaned lab analytes to be deleted
SELECT 'DRY RUN: Lab Analytes to Delete' AS action, COUNT(*) as count
FROM lab_analytes la
WHERE la.lab_id = :'lab_id'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = la.analyte_id)
  AND NOT EXISTS (SELECT 1 FROM result_values rv WHERE rv.analyte_id = la.analyte_id);

-- Show details of lab analytes to be deleted
SELECT 
  la.id,
  la.name,
  la.analyte_id,
  la.created_at,
  'LAB_ANALYTE_DELETE' AS action
FROM lab_analytes la
WHERE la.lab_id = :'lab_id'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = la.analyte_id)
  AND NOT EXISTS (SELECT 1 FROM result_values rv WHERE rv.analyte_id = la.analyte_id);

ROLLBACK;

-- =====================================================
-- ACTUAL DELETION (UNCOMMENT TO EXECUTE)
-- =====================================================
-- Only proceed if DRY RUN results look correct
-- Change ':dry_run' value to false to enable these operations

BEGIN;

-- Step 1: Delete orphaned lab_analytes first (no foreign key dependencies)
DELETE FROM lab_analytes
WHERE lab_id = :'lab_id'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = lab_analytes.analyte_id)
  AND NOT EXISTS (SELECT 1 FROM result_values rv WHERE rv.analyte_id = lab_analytes.analyte_id);

-- Step 2: Delete test_group_branding records (if they reference test groups)
DELETE FROM test_group_branding
WHERE test_group_id IN (
  SELECT tg.id FROM test_groups tg
  WHERE tg.lab_id = :'lab_id'
    AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id)
    AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.test_group_id = tg.id)
    AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = tg.id)
    AND NOT EXISTS (SELECT 1 FROM test_workflow_map twm WHERE twm.test_group_id = tg.id)
);

-- Step 3: Delete unmapped test groups
DELETE FROM test_groups
WHERE lab_id = :'lab_id'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = test_groups.id)
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.test_group_id = test_groups.id)
  AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = test_groups.id)
  AND NOT EXISTS (SELECT 1 FROM test_workflow_map twm WHERE twm.test_group_id = test_groups.id);

-- Confirmation
SELECT 'DELETION COMPLETE - Changes committed' AS status;

COMMIT;

-- =====================================================
-- VERIFICATION (run AFTER deletion)
-- =====================================================
-- Verify no remaining unused data

SELECT 'VERIFICATION' AS section, '1. Remaining unmapped test groups' AS check_type, COUNT(*) as remaining_count
FROM test_groups tg
WHERE tg.lab_id = :'lab_id'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id)
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.test_group_id = tg.id)
  AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = tg.id)
  AND NOT EXISTS (SELECT 1 FROM test_workflow_map twm WHERE twm.test_group_id = tg.id)

UNION ALL

SELECT 'VERIFICATION', '2. Remaining orphaned lab analytes', COUNT(*)
FROM lab_analytes la
WHERE la.lab_id = :'lab_id'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = la.analyte_id)
  AND NOT EXISTS (SELECT 1 FROM result_values rv WHERE rv.analyte_id = la.analyte_id);
