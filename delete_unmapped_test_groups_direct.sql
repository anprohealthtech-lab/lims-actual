-- =====================================================
-- DIRECT DELETE UNMAPPED TEST GROUPS
-- =====================================================
-- This script directly deletes test groups with no analyte mappings
-- Use this if the function approach doesn't work
-- =====================================================

-- STEP 1: See what will be deleted (SAFE - READ ONLY)
SELECT 
  tg.id,
  tg.name,
  tg.code,
  tg.lab_id,
  tg.created_at,
  EXISTS (SELECT 1 FROM order_tests ot WHERE ot.test_group_id = tg.id) AS has_orders,
  EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = tg.id) AS has_results,
  EXISTS (SELECT 1 FROM test_workflow_map twm WHERE twm.test_group_id = tg.id) AS has_workflow_map,
  EXISTS (SELECT 1 FROM lab_templates lt WHERE lt.test_group_id = tg.id) AS has_templates,
  CASE 
    WHEN EXISTS (SELECT 1 FROM order_tests ot WHERE ot.test_group_id = tg.id) THEN '⚠️ HAS ORDERS - DO NOT DELETE'
    WHEN EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = tg.id) THEN '⚠️ HAS RESULTS - DO NOT DELETE'
    ELSE '✅ SAFE TO DELETE'
  END AS status
FROM test_groups tg
WHERE NOT EXISTS (
  SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id
)
ORDER BY tg.created_at DESC;

-- STEP 2: Count by lab (SAFE - READ ONLY)
SELECT 
  l.name AS lab_name,
  COUNT(tg.id) AS unmapped_count
FROM labs l
JOIN test_groups tg ON tg.lab_id = l.id
WHERE NOT EXISTS (
  SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id
)
AND NOT EXISTS (
  SELECT 1 FROM order_tests ot WHERE ot.test_group_id = tg.id
)
AND NOT EXISTS (
  SELECT 1 FROM results r WHERE r.test_group_id = tg.id
)
GROUP BY l.id, l.name
ORDER BY COUNT(tg.id) DESC;

-- =====================================================
-- STEP 3: ACTUAL DELETION - UNCOMMENT TO EXECUTE
-- ⚠️ WARNING: This will permanently delete records
-- =====================================================

-- First, delete related records (to handle foreign keys)
/*
BEGIN;

-- Delete test_workflow_map entries
DELETE FROM test_workflow_map 
WHERE test_group_id IN (
  SELECT tg.id
  FROM test_groups tg
  WHERE NOT EXISTS (
    SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM order_tests ot WHERE ot.test_group_id = tg.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM results r WHERE r.test_group_id = tg.id
  )
);

-- Delete workflow_versions entries
DELETE FROM workflow_versions 
WHERE test_group_id IN (
  SELECT tg.id
  FROM test_groups tg
  WHERE NOT EXISTS (
    SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM order_tests ot WHERE ot.test_group_id = tg.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM results r WHERE r.test_group_id = tg.id
  )
);

-- Delete lab_templates entries
DELETE FROM lab_templates 
WHERE test_group_id IN (
  SELECT tg.id
  FROM test_groups tg
  WHERE NOT EXISTS (
    SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM order_tests ot WHERE ot.test_group_id = tg.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM results r WHERE r.test_group_id = tg.id
  )
);

-- Delete package_test_groups entries
DELETE FROM package_test_groups 
WHERE test_group_id IN (
  SELECT tg.id
  FROM test_groups tg
  WHERE NOT EXISTS (
    SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM order_tests ot WHERE ot.test_group_id = tg.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM results r WHERE r.test_group_id = tg.id
  )
);

-- Delete workflow_ai_configs entries
DELETE FROM workflow_ai_configs 
WHERE test_group_id IN (
  SELECT tg.id
  FROM test_groups tg
  WHERE NOT EXISTS (
    SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM order_tests ot WHERE ot.test_group_id = tg.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM results r WHERE r.test_group_id = tg.id
  )
);

-- Finally, delete the test groups themselves
DELETE FROM test_groups 
WHERE id IN (
  SELECT tg.id
  FROM test_groups tg
  WHERE NOT EXISTS (
    SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM order_tests ot WHERE ot.test_group_id = tg.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM results r WHERE r.test_group_id = tg.id
  )
);

-- Show what was deleted
SELECT 
  'DELETED' AS action,
  COUNT(*) AS count
FROM test_groups tg
WHERE NOT EXISTS (
  SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id
);

COMMIT;
*/

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
  -- Delete related records
  DELETE FROM test_workflow_map WHERE test_group_id IN (
    SELECT id FROM test_groups 
    WHERE lab_id = v_lab_id 
    AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM order_tests ot WHERE ot.test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = test_groups.id)
  );
  
  DELETE FROM workflow_versions WHERE test_group_id IN (
    SELECT id FROM test_groups 
    WHERE lab_id = v_lab_id 
    AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM order_tests ot WHERE ot.test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = test_groups.id)
  );
  
  DELETE FROM lab_templates WHERE test_group_id IN (
    SELECT id FROM test_groups 
    WHERE lab_id = v_lab_id 
    AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM order_tests ot WHERE ot.test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = test_groups.id)
  );
  
  DELETE FROM package_test_groups WHERE test_group_id IN (
    SELECT id FROM test_groups 
    WHERE lab_id = v_lab_id 
    AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM order_tests ot WHERE ot.test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = test_groups.id)
  );
  
  DELETE FROM workflow_ai_configs WHERE test_group_id IN (
    SELECT id FROM test_groups 
    WHERE lab_id = v_lab_id 
    AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM order_tests ot WHERE ot.test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = test_groups.id)
  );
  
  -- Delete test groups
  DELETE FROM test_groups 
  WHERE lab_id = v_lab_id 
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = test_groups.id)
  AND NOT EXISTS (SELECT 1 FROM order_tests ot WHERE ot.test_group_id = test_groups.id)
  AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = test_groups.id);
  
  RAISE NOTICE 'Deletion completed for lab %', v_lab_id;
END $$;

COMMIT;
*/
