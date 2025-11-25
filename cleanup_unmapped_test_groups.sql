-- =====================================================
-- CLEANUP UNMAPPED TEST GROUPS - PERIODIC MAINTENANCE
-- =====================================================
-- Run this script periodically to clean up test groups
-- that have no analyte mappings (likely created by errors)
-- =====================================================

-- STEP 1: Find all unmapped test groups
-- This is a safe read-only query to see what would be affected
SELECT 
  test_group_id,
  test_group_name,
  test_group_code,
  lab_id,
  created_at,
  has_orders,
  has_results,
  has_workflow_mappings,
  CASE 
    WHEN has_orders OR has_results THEN '⚠️ CANNOT DELETE (has data)'
    ELSE '✅ Safe to delete'
  END AS safety_status
FROM find_unmapped_test_groups()
ORDER BY created_at DESC;

-- STEP 2: DRY RUN - See what would be deleted (SAFE)
-- This won't actually delete anything, just shows what would happen
SELECT * FROM delete_unmapped_test_groups(
  p_dry_run := true,
  p_lab_id := NULL  -- NULL = all labs, or pass specific lab_id
);

-- STEP 3: ACTUAL DELETE - Only run this after reviewing dry run results
-- ⚠️ WARNING: This will permanently delete test groups with no analytes
-- Uncomment the line below to execute actual deletion:
-- SELECT * FROM delete_unmapped_test_groups(p_dry_run := false, p_lab_id := NULL);

-- STEP 4: Verify deletion (run after STEP 3)
-- This should return no rows if cleanup was successful
-- SELECT * FROM find_unmapped_test_groups();

-- =====================================================
-- ADDITIONAL DIAGNOSTIC QUERIES
-- =====================================================

-- Query 1: Count unmapped test groups by lab
SELECT 
  l.name AS lab_name,
  l.id AS lab_id,
  COUNT(tg.id) AS unmapped_test_groups
FROM labs l
LEFT JOIN test_groups tg ON tg.lab_id = l.id
WHERE NOT EXISTS (
  SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id
)
GROUP BY l.id, l.name
HAVING COUNT(tg.id) > 0
ORDER BY COUNT(tg.id) DESC;

-- Query 2: Find test groups created recently with no analytes (last 7 days)
SELECT 
  tg.id,
  tg.name,
  tg.code,
  tg.created_at,
  l.name AS lab_name,
  'No analytes mapped' AS issue
FROM test_groups tg
JOIN labs l ON l.id = tg.lab_id
WHERE tg.created_at > NOW() - INTERVAL '7 days'
AND NOT EXISTS (
  SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id
)
ORDER BY tg.created_at DESC;

-- Query 3: Find test groups with no analytes AND no workflow mappings
-- These are the safest to delete (never actually used)
SELECT 
  tg.id,
  tg.name,
  tg.code,
  tg.created_at,
  l.name AS lab_name
FROM test_groups tg
JOIN labs l ON l.id = tg.lab_id
WHERE NOT EXISTS (
  SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id
)
AND NOT EXISTS (
  SELECT 1 FROM test_workflow_map twm WHERE twm.test_group_id = tg.id
)
AND NOT EXISTS (
  SELECT 1 FROM order_tests ot WHERE ot.test_group_id = tg.id
)
ORDER BY tg.created_at DESC;
