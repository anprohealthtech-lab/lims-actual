-- =====================================================
-- DIRECT DELETE UNMAPPED ANALYTES
-- =====================================================
-- This script deletes analytes that are not attached to any test group
-- Cleans up both 'analytes' and 'lab_analytes' tables
-- =====================================================

-- STEP 1: See unmapped GLOBAL analytes (SAFE - READ ONLY)
SELECT 
  a.id,
  a.name,
  a.category,
  a.unit,
  a.created_at,
  a.is_global,
  EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = a.id) AS has_test_groups,
  EXISTS (SELECT 1 FROM result_values rv WHERE rv.analyte_id = a.id) AS has_results,
  EXISTS (SELECT 1 FROM lab_analytes la WHERE la.analyte_id = a.id) AS has_lab_copies,
  CASE 
    WHEN EXISTS (SELECT 1 FROM result_values rv WHERE rv.analyte_id = a.id) THEN '⚠️ HAS RESULTS - DO NOT DELETE'
    WHEN EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = a.id) THEN '⚠️ HAS TEST GROUPS - DO NOT DELETE'
    ELSE '✅ SAFE TO DELETE'
  END AS status
FROM analytes a
WHERE NOT EXISTS (
  SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = a.id
)
ORDER BY a.created_at DESC;

-- STEP 2: See unmapped LAB_ANALYTES (SAFE - READ ONLY)
SELECT 
  la.id,
  la.name AS analyte_name,
  la.analyte_id,
  l.name AS lab_name,
  la.lab_id,
  la.created_at,
  EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = la.analyte_id) AS parent_has_test_groups,
  EXISTS (SELECT 1 FROM result_values rv WHERE rv.analyte_id = la.analyte_id) AS has_results,
  CASE 
    WHEN EXISTS (SELECT 1 FROM result_values rv WHERE rv.analyte_id = la.analyte_id) THEN '⚠️ HAS RESULTS - DO NOT DELETE'
    WHEN EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = la.analyte_id) THEN '⚠️ PARENT HAS TEST GROUPS - DO NOT DELETE'
    ELSE '✅ SAFE TO DELETE'
  END AS status
FROM lab_analytes la
JOIN labs l ON l.id = la.lab_id
WHERE NOT EXISTS (
  SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = la.analyte_id
)
ORDER BY la.created_at DESC;

-- STEP 3: Count unmapped analytes by type (SAFE - READ ONLY)
SELECT 
  'Global Analytes' AS type,
  COUNT(a.id) AS unmapped_count
FROM analytes a
WHERE NOT EXISTS (
  SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = a.id
)
AND NOT EXISTS (
  SELECT 1 FROM result_values rv WHERE rv.analyte_id = a.id
)

UNION ALL

SELECT 
  'Lab Analytes' AS type,
  COUNT(la.id) AS unmapped_count
FROM lab_analytes la
WHERE NOT EXISTS (
  SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = la.analyte_id
)
AND NOT EXISTS (
  SELECT 1 FROM result_values rv WHERE rv.analyte_id = la.analyte_id
);

-- STEP 4: Count unmapped lab_analytes by lab (SAFE - READ ONLY)
SELECT 
  l.name AS lab_name,
  COUNT(la.id) AS unmapped_lab_analytes
FROM labs l
JOIN lab_analytes la ON la.lab_id = l.id
WHERE NOT EXISTS (
  SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = la.analyte_id
)
AND NOT EXISTS (
  SELECT 1 FROM result_values rv WHERE rv.analyte_id = la.analyte_id
)
GROUP BY l.id, l.name
ORDER BY COUNT(la.id) DESC;

-- =====================================================
-- STEP 5: ACTUAL DELETION - READY TO RUN
-- ⚠️ WARNING: This will permanently delete records
-- =====================================================

-- Delete unmapped analytes and lab_analytes
BEGIN;

-- First, delete lab_analytes that reference unmapped global analytes
DELETE FROM lab_analytes 
WHERE analyte_id IN (
  SELECT a.id
  FROM analytes a
  WHERE NOT EXISTS (
    SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = a.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM result_values rv WHERE rv.analyte_id = a.id
  )
);

-- Delete analyte_aliases for unmapped analytes
DELETE FROM analyte_aliases 
WHERE analyte_id IN (
  SELECT a.id
  FROM analytes a
  WHERE NOT EXISTS (
    SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = a.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM result_values rv WHERE rv.analyte_id = a.id
  )
);

-- Delete ai_prompts for unmapped analytes
DELETE FROM ai_prompts 
WHERE analyte_id IN (
  SELECT a.id
  FROM analytes a
  WHERE NOT EXISTS (
    SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = a.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM result_values rv WHERE rv.analyte_id = a.id
  )
);

-- Finally, delete unmapped global analytes
DELETE FROM analytes 
WHERE id IN (
  SELECT a.id
  FROM analytes a
  WHERE NOT EXISTS (
    SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = a.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM result_values rv WHERE rv.analyte_id = a.id
  )
);

-- Show what was deleted
SELECT 
  'Deleted Global Analytes' AS action,
  (SELECT COUNT(*) FROM analytes WHERE NOT EXISTS (
    SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = analytes.id
  )) AS remaining_unmapped;

SELECT 
  'Deleted Lab Analytes' AS action,
  (SELECT COUNT(*) FROM lab_analytes WHERE NOT EXISTS (
    SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = lab_analytes.analyte_id
  )) AS remaining_unmapped;

COMMIT;

-- =====================================================
-- ALTERNATIVE: Delete for specific lab only
-- =====================================================
/*
BEGIN;

-- Replace 'YOUR-LAB-ID-HERE' with actual lab_id
DO $$
DECLARE
  v_lab_id uuid := 'YOUR-LAB-ID-HERE';
BEGIN
  -- Delete lab_analytes for specific lab where parent analyte is unmapped
  DELETE FROM lab_analytes 
  WHERE lab_id = v_lab_id 
  AND analyte_id IN (
    SELECT a.id FROM analytes a
    WHERE NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = a.id)
    AND NOT EXISTS (SELECT 1 FROM result_values rv WHERE rv.analyte_id = a.id)
  );
  
  RAISE NOTICE 'Deletion completed for lab %', v_lab_id;
END $$;

COMMIT;
*/

-- =====================================================
-- DIAGNOSTIC: Find analytes with only lab_analytes but no test_group_analytes
-- =====================================================
SELECT 
  a.name AS analyte_name,
  a.category,
  COUNT(DISTINCT la.lab_id) AS lab_count,
  ARRAY_AGG(DISTINCT l.name) AS labs_using
FROM analytes a
JOIN lab_analytes la ON la.analyte_id = a.id
JOIN labs l ON l.id = la.lab_id
WHERE NOT EXISTS (
  SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = a.id
)
GROUP BY a.id, a.name, a.category
ORDER BY COUNT(DISTINCT la.lab_id) DESC;
