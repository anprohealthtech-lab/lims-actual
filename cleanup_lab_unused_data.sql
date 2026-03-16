-- =====================================================
-- CLEANUP UNUSED DATA FOR LAB ID: 113bf166-ca18-40cd-9b5e-552958be0d58
-- =====================================================
-- This script checks and deletes unused/unmapped data for a specific lab
-- Includes: test groups, analytes, and lab-specific mappings
-- =====================================================

-- Store lab ID in a variable for easy referencing
\set lab_id '113bf166-ca18-40cd-9b5e-552958be0d58'

-- =====================================================
-- SECTION 1: AUDIT - CHECK UNUSED TEST GROUPS
-- =====================================================
-- Test groups with no analyte mappings in this lab

SELECT 
  '1. UNMAPPED TEST GROUPS' AS section,
  tg.id,
  tg.name AS test_group_name,
  tg.code AS test_group_code,
  tg.lab_id,
  tg.created_at,
  COUNT(tga.id) AS analyte_count,
  EXISTS (SELECT 1 FROM orders o WHERE o.test_group_id = tg.id) AS has_orders,
  EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = tg.id) AS has_results,
  EXISTS (SELECT 1 FROM test_workflow_map twm WHERE twm.test_group_id = tg.id) AS has_workflow_mappings,
  CASE 
    WHEN EXISTS (SELECT 1 FROM orders o WHERE o.test_group_id = tg.id) THEN '⚠️ HAS ORDERS - DO NOT DELETE'
    WHEN EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = tg.id) THEN '⚠️ HAS RESULTS - DO NOT DELETE'
    WHEN EXISTS (SELECT 1 FROM test_workflow_map twm WHERE twm.test_group_id = tg.id) THEN '⚠️ HAS WORKFLOW MAPPINGS - DO NOT DELETE'
    WHEN COUNT(tga.id) = 0 THEN '✅ SAFE - No analytes, no usage'
    ELSE '⚠️ CHECK BEFORE DELETING'
  END AS deletion_status
FROM test_groups tg
LEFT JOIN test_group_analytes tga ON tga.test_group_id = tg.id
WHERE tg.lab_id = :'lab_id'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga2 WHERE tga2.test_group_id = tg.id)
GROUP BY tg.id, tg.name, tg.code, tg.lab_id, tg.created_at
ORDER BY tg.created_at DESC;

-- =====================================================
-- SECTION 2: AUDIT - CHECK UNUSED LAB-SPECIFIC ANALYTES
-- =====================================================
-- Lab analytes with no active test group mappings

SELECT 
  '2. ORPHANED LAB ANALYTES' AS section,
  la.id,
  la.name AS analyte_name,
  la.analyte_id AS parent_analyte_id,
  la.lab_id,
  la.created_at,
  EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = la.analyte_id) AS parent_has_test_groups,
  EXISTS (SELECT 1 FROM result_values rv WHERE rv.analyte_id = la.analyte_id) AS has_result_values,
  CASE 
    WHEN EXISTS (SELECT 1 FROM result_values rv WHERE rv.analyte_id = la.analyte_id) THEN '⚠️ HAS RESULTS - DO NOT DELETE'
    WHEN EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = la.analyte_id) THEN '✅ Parent has test groups'
    ELSE '✅ SAFE - No active usage'
  END AS deletion_status
FROM lab_analytes la
WHERE la.lab_id = :'lab_id'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = la.analyte_id)
ORDER BY la.created_at DESC;

-- =====================================================
-- SECTION 3: AUDIT - CHECK TEST GROUPS WITH NO USAGE
-- =====================================================
-- Test groups that exist but have no recent activity

SELECT 
  '3. TEST GROUPS WITH NO RECENT USAGE' AS section,
  tg.id,
  tg.name AS test_group_name,
  tg.code AS test_group_code,
  tg.created_at,
  COUNT(DISTINCT o.id) AS order_count,
  COUNT(DISTINCT r.id) AS result_count,
  MAX(o.created_at) AS last_order_date,
  MAX(r.created_at) AS last_result_date,
  CASE 
    WHEN COUNT(DISTINCT o.id) > 0 THEN '⚠️ HAS ORDERS - DO NOT DELETE'
    WHEN COUNT(DISTINCT r.id) > 0 THEN '⚠️ HAS RESULTS - DO NOT DELETE'
    ELSE '✅ SAFE - No usage'
  END AS deletion_status
FROM test_groups tg
LEFT JOIN orders o ON o.test_group_id = tg.id
LEFT JOIN results r ON r.test_group_id = tg.id
WHERE tg.lab_id = :'lab_id'
GROUP BY tg.id, tg.name, tg.code, tg.created_at
HAVING COUNT(DISTINCT o.id) = 0 AND COUNT(DISTINCT r.id) = 0
ORDER BY tg.created_at DESC;

-- =====================================================
-- SECTION 4: SUMMARY COUNT
-- =====================================================

SELECT 
  'SUMMARY' AS report,
  'Unmapped Test Groups (safe to delete)' AS category,
  COUNT(*) AS count
FROM test_groups tg
WHERE tg.lab_id = :'lab_id'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id)
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.test_group_id = tg.id)
  AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = tg.id)
  AND NOT EXISTS (SELECT 1 FROM test_workflow_map twm WHERE twm.test_group_id = tg.id)

UNION ALL

SELECT 
  'SUMMARY',
  'Orphaned Lab Analytes (safe to delete)',
  COUNT(*)
FROM lab_analytes la
WHERE la.lab_id = :'lab_id'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = la.analyte_id)
  AND NOT EXISTS (SELECT 1 FROM result_values rv WHERE rv.analyte_id = la.analyte_id);
