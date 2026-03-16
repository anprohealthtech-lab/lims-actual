-- =====================================================
-- FULL AUDIT: DUPLICATE TEST GROUPS, ORPHANS, DUPLICATE ANALYTES
-- Lab ID: 113bf166-ca18-40cd-9b5e-552958be0d58
-- =====================================================
-- Run this FIRST to understand the data before making changes
-- =====================================================

-- =====================================================
-- SECTION 1: DUPLICATE TEST GROUPS (same name or code)
-- =====================================================
-- Find test groups that share the same name (case-insensitive)

SELECT 
  '1A. DUPLICATE BY NAME' AS section,
  LOWER(TRIM(tg.name)) AS normalized_name,
  COUNT(*) AS duplicate_count,
  ARRAY_AGG(tg.id ORDER BY tg.created_at) AS ids,
  ARRAY_AGG(tg.name ORDER BY tg.created_at) AS names,
  ARRAY_AGG(tg.code ORDER BY tg.created_at) AS codes,
  ARRAY_AGG(
    (SELECT COUNT(*) FROM test_group_analytes tga WHERE tga.test_group_id = tg.id)
    ORDER BY tg.created_at
  ) AS analyte_counts,
  ARRAY_AGG(
    (SELECT COUNT(*) FROM order_test_groups otg WHERE otg.test_group_id = tg.id)
    ORDER BY tg.created_at
  ) AS order_counts,
  ARRAY_AGG(
    (SELECT COUNT(*) FROM results r WHERE r.test_group_id = tg.id)
    ORDER BY tg.created_at
  ) AS result_counts,
  ARRAY_AGG(tg.created_at ORDER BY tg.created_at) AS created_dates
FROM test_groups tg
WHERE tg.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
GROUP BY LOWER(TRIM(tg.name))
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

-- Find test groups that share the same code
SELECT 
  '1B. DUPLICATE BY CODE' AS section,
  LOWER(TRIM(tg.code)) AS normalized_code,
  COUNT(*) AS duplicate_count,
  ARRAY_AGG(tg.id ORDER BY tg.created_at) AS ids,
  ARRAY_AGG(tg.name ORDER BY tg.created_at) AS names,
  ARRAY_AGG(tg.code ORDER BY tg.created_at) AS codes,
  ARRAY_AGG(
    (SELECT COUNT(*) FROM test_group_analytes tga WHERE tga.test_group_id = tg.id)
    ORDER BY tg.created_at
  ) AS analyte_counts,
  ARRAY_AGG(
    (SELECT COUNT(*) FROM order_test_groups otg WHERE otg.test_group_id = tg.id)
    ORDER BY tg.created_at
  ) AS order_counts
FROM test_groups tg
WHERE tg.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
GROUP BY LOWER(TRIM(tg.code))
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

-- =====================================================
-- SECTION 2: ORPHAN TEST GROUPS (no analytes linked)
-- =====================================================
-- These are test groups with ZERO analytes

SELECT 
  '2. ORPHAN TEST GROUPS (no analytes)' AS section,
  tg.id,
  tg.name,
  tg.code,
  tg.category,
  tg.created_at,
  -- Check if there's a DUPLICATE (same name) that HAS analytes
  (SELECT COUNT(*) 
   FROM test_groups tg2 
   WHERE tg2.lab_id = tg.lab_id 
     AND LOWER(TRIM(tg2.name)) = LOWER(TRIM(tg.name)) 
     AND tg2.id != tg.id
     AND EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg2.id)
  ) AS duplicates_with_analytes,
  -- Check if another test group with same name exists at all
  (SELECT COUNT(*) 
   FROM test_groups tg2 
   WHERE tg2.lab_id = tg.lab_id 
     AND LOWER(TRIM(tg2.name)) = LOWER(TRIM(tg.name)) 
     AND tg2.id != tg.id
  ) AS total_duplicates,
  -- Check usage
  (SELECT COUNT(*) FROM order_test_groups otg WHERE otg.test_group_id = tg.id) AS order_count,
  (SELECT COUNT(*) FROM results r WHERE r.test_group_id = tg.id) AS result_count,
  (SELECT COUNT(*) FROM order_test_groups otg2 WHERE otg2.test_group_id = tg.id) AS order_test_group_count,
  (SELECT COUNT(*) FROM result_values rv WHERE rv.test_group_id = tg.id) AS result_value_count,
  -- Recommendation
  CASE
    WHEN (SELECT COUNT(*) FROM order_test_groups otg WHERE otg.test_group_id = tg.id) > 0 
      OR (SELECT COUNT(*) FROM results r WHERE r.test_group_id = tg.id) > 0
    THEN '🔄 HAS DATA - Can copy analytes from duplicate'
    WHEN (SELECT COUNT(*) FROM test_groups tg2 
          WHERE tg2.lab_id = tg.lab_id 
            AND LOWER(TRIM(tg2.name)) = LOWER(TRIM(tg.name)) 
            AND tg2.id != tg.id
            AND EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg2.id)
         ) > 0
    THEN '🗑️ SAFE DELETE - Duplicate with analytes exists'
    ELSE '⚠️ TRULY ORPHAN - No matching test group found'
  END AS recommendation
FROM test_groups tg
WHERE tg.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id)
ORDER BY tg.name, tg.created_at;

-- =====================================================
-- SECTION 3: DUPLICATE ANALYTES (same name in analytes table)
-- =====================================================

SELECT 
  '3A. DUPLICATE ANALYTES (global)' AS section,
  LOWER(TRIM(a.name)) AS normalized_name,
  COUNT(*) AS duplicate_count,
  ARRAY_AGG(a.id ORDER BY a.created_at) AS ids,
  ARRAY_AGG(a.name ORDER BY a.created_at) AS names,
  ARRAY_AGG(a.unit ORDER BY a.created_at) AS units,
  ARRAY_AGG(a.category ORDER BY a.created_at) AS categories,
  ARRAY_AGG(
    (SELECT COUNT(*) FROM test_group_analytes tga 
     WHERE tga.analyte_id = a.id 
       AND tga.test_group_id IN (SELECT id FROM test_groups WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'))
    ORDER BY a.created_at
  ) AS usage_in_this_lab,
  ARRAY_AGG(
    (SELECT COUNT(*) FROM result_values rv WHERE rv.analyte_id = a.id)
    ORDER BY a.created_at
  ) AS result_value_counts,
  ARRAY_AGG(a.created_at ORDER BY a.created_at) AS created_dates
FROM analytes a
WHERE a.id IN (
  SELECT tga.analyte_id FROM test_group_analytes tga
  JOIN test_groups tg ON tg.id = tga.test_group_id
  WHERE tg.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
)
GROUP BY LOWER(TRIM(a.name))
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

-- Duplicate lab_analytes
SELECT 
  '3B. DUPLICATE LAB ANALYTES' AS section,
  LOWER(TRIM(COALESCE(la.name, a.name))) AS normalized_name,
  COUNT(*) AS duplicate_count,
  ARRAY_AGG(la.id ORDER BY la.created_at) AS lab_analyte_ids,
  ARRAY_AGG(la.analyte_id ORDER BY la.created_at) AS parent_analyte_ids,
  ARRAY_AGG(COALESCE(la.name, a.name) ORDER BY la.created_at) AS names,
  ARRAY_AGG(
    (SELECT COUNT(*) FROM test_group_analytes tga WHERE tga.analyte_id = la.analyte_id)
    ORDER BY la.created_at
  ) AS test_group_usages,
  ARRAY_AGG(
    (SELECT COUNT(*) FROM result_values rv WHERE rv.analyte_id = la.analyte_id)
    ORDER BY la.created_at
  ) AS result_counts
FROM lab_analytes la
JOIN analytes a ON a.id = la.analyte_id
WHERE la.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
GROUP BY LOWER(TRIM(COALESCE(la.name, a.name)))
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

-- =====================================================
-- SECTION 4: ORPHAN-TO-DUPLICATE LINKING CANDIDATES
-- =====================================================
-- Orphan test groups that could be linked to analytes 
-- from a matching duplicate test group

SELECT 
  '4. LINKABLE ORPHANS' AS section,
  orphan.id AS orphan_test_group_id,
  orphan.name AS orphan_name,
  orphan.code AS orphan_code,
  orphan.created_at AS orphan_created,
  good.id AS good_test_group_id,
  good.name AS good_name,
  good.code AS good_code,
  good.created_at AS good_created,
  (SELECT COUNT(*) FROM test_group_analytes tga WHERE tga.test_group_id = good.id) AS good_analyte_count,
  (SELECT COUNT(*) FROM order_test_groups otg WHERE otg.test_group_id = orphan.id) AS orphan_order_count,
  (SELECT COUNT(*) FROM results r WHERE r.test_group_id = orphan.id) AS orphan_result_count,
  CASE
    WHEN (SELECT COUNT(*) FROM order_test_groups otg WHERE otg.test_group_id = orphan.id) = 0
     AND (SELECT COUNT(*) FROM results r WHERE r.test_group_id = orphan.id) = 0
    THEN 'DELETE orphan (no data)'
    WHEN (SELECT COUNT(*) FROM order_test_groups otg WHERE otg.test_group_id = orphan.id) > 0
    THEN 'LINK analytes to orphan (has orders)'
    ELSE 'MERGE data then delete orphan'
  END AS action
FROM test_groups orphan
JOIN test_groups good 
  ON good.lab_id = orphan.lab_id
  AND LOWER(TRIM(good.name)) = LOWER(TRIM(orphan.name))
  AND good.id != orphan.id
  AND EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = good.id)
WHERE orphan.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = orphan.id)
ORDER BY orphan.name;

-- =====================================================
-- SECTION 5: SUMMARY TOTALS
-- =====================================================

SELECT 'SUMMARY' AS report, 'Total test groups' AS category, 
  COUNT(*) AS count
FROM test_groups WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'

UNION ALL

SELECT 'SUMMARY', 'Test groups WITH analytes',
  COUNT(DISTINCT tg.id)
FROM test_groups tg
JOIN test_group_analytes tga ON tga.test_group_id = tg.id
WHERE tg.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'

UNION ALL

SELECT 'SUMMARY', 'Test groups WITHOUT analytes (orphans)',
  COUNT(*)
FROM test_groups tg
WHERE tg.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id)

UNION ALL

SELECT 'SUMMARY', 'Orphans that are duplicates (can be linked/deleted)',
  COUNT(*)
FROM test_groups orphan
WHERE orphan.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = orphan.id)
  AND EXISTS (
    SELECT 1 FROM test_groups good 
    WHERE good.lab_id = orphan.lab_id
      AND LOWER(TRIM(good.name)) = LOWER(TRIM(orphan.name))
      AND good.id != orphan.id
      AND EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = good.id)
  )

UNION ALL

SELECT 'SUMMARY', 'Truly orphan (no matching test group with analytes)',
  COUNT(*)
FROM test_groups orphan
WHERE orphan.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = orphan.id)
  AND NOT EXISTS (
    SELECT 1 FROM test_groups good 
    WHERE good.lab_id = orphan.lab_id
      AND LOWER(TRIM(good.name)) = LOWER(TRIM(orphan.name))
      AND good.id != orphan.id
      AND EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = good.id)
  )

UNION ALL

SELECT 'SUMMARY', 'Duplicate analyte names (global) used by this lab',
  COUNT(*) - COUNT(DISTINCT LOWER(TRIM(a.name)))
FROM analytes a
WHERE a.id IN (
  SELECT tga.analyte_id FROM test_group_analytes tga
  JOIN test_groups tg ON tg.id = tga.test_group_id
  WHERE tg.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
);
