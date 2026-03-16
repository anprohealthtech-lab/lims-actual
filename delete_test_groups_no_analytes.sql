-- =====================================================
-- DELETE TEST GROUPS WITH NO ANALYTE LINKS
-- Lab ID: 113bf166-ca18-40cd-9b5e-552958be0d58
-- =====================================================
-- This script safely deletes test groups that have NO analytes mapped
-- =====================================================

\set lab_id '113bf166-ca18-40cd-9b5e-552958be0d58'

-- =====================================================
-- STEP 1: AUDIT - See what test groups have NO analytes
-- =====================================================

SELECT 
  'UNMAPPED TEST GROUPS' AS category,
  tg.id,
  tg.name,
  tg.code,
  tg.created_at,
  COUNT(tga.id) AS analyte_count,
  EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = tg.id) AS has_orders,
  EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = tg.id) AS has_results,
  CASE 
    WHEN EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = tg.id) THEN '⚠️ HAS ORDERS - DO NOT DELETE'
    WHEN EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = tg.id) THEN '⚠️ HAS RESULTS - DO NOT DELETE'
    ELSE '✅ SAFE TO DELETE'
  END AS status
FROM test_groups tg
LEFT JOIN test_group_analytes tga ON tga.test_group_id = tg.id
WHERE tg.lab_id = :'lab_id'
GROUP BY tg.id
HAVING COUNT(tga.id) = 0
ORDER BY tg.created_at DESC;

-- =====================================================
-- STEP 2: COUNT - How many to delete?
-- =====================================================

SELECT 
  COUNT(*) AS test_groups_to_delete,
  'Unmapped test groups (no analytes)' AS description
FROM test_groups tg
WHERE tg.lab_id = :'lab_id'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id);

-- =====================================================
-- STEP 3: DELETE - Remove test groups with NO analytes
-- =====================================================
-- Run this only after reviewing STEP 1 and STEP 2

BEGIN;

WITH tg_to_delete AS (
  SELECT tg.id
  FROM test_groups tg
  WHERE tg.lab_id = :'lab_id'
    AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = tg.id)
    AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = tg.id)
)
DELETE FROM test_groups
WHERE id IN (SELECT id FROM tg_to_delete);

-- Confirmation message
SELECT 'DELETED: Test groups with no analytes' AS status;

-- =====================================================
-- STEP 4: VERIFY - Confirm deletion
-- =====================================================

SELECT 
  COUNT(*) AS remaining_unmapped_test_groups
FROM test_groups tg
WHERE tg.lab_id = :'lab_id'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id);

COMMIT;
