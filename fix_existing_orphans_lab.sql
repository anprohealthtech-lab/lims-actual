-- =====================================================
-- ONE-TIME FIX: Auto-link existing orphan test groups
-- Lab ID: 113bf166-ca18-40cd-9b5e-552958be0d58
-- =====================================================
-- Run this AFTER the migration (20260308_add_analyte_count_column.sql)
-- This handles all existing orphans that were created before the triggers
-- =====================================================

BEGIN;

-- =====================================================
-- STEP 1: Preview orphans and their auto-link candidates
-- =====================================================

SELECT 
  tg.id,
  tg.name,
  tg.code,
  tg.analyte_count,
  tg.created_at,
  -- Global catalog match?
  (SELECT jsonb_array_length(COALESCE(gtc.analytes, '[]'::jsonb))
   FROM global_test_catalog gtc 
   WHERE LOWER(TRIM(gtc.code)) = LOWER(TRIM(tg.code))
   LIMIT 1) AS global_analyte_count,
  -- Same-name sibling match?
  (SELECT COUNT(*) FROM test_group_analytes tga 
   JOIN test_groups tg2 ON tg2.id = tga.test_group_id
   WHERE tg2.lab_id = tg.lab_id
     AND LOWER(TRIM(tg2.name)) = LOWER(TRIM(tg.name))
     AND tg2.id != tg.id
     AND tg2.analyte_count > 0
   LIMIT 1) > 0 AS has_sibling_match,
  -- Same-code cross-lab match?  
  (SELECT COUNT(*) FROM test_groups tg3
   WHERE LOWER(TRIM(tg3.code)) = LOWER(TRIM(tg.code))
     AND tg3.id != tg.id
     AND tg3.analyte_count > 0
   LIMIT 1) > 0 AS has_crosslab_match,
  -- Has data?
  EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = tg.id) AS has_orders,
  EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = tg.id) AS has_results,
  -- Recommended action
  CASE
    WHEN (SELECT jsonb_array_length(COALESCE(gtc.analytes, '[]'::jsonb))
          FROM global_test_catalog gtc 
          WHERE LOWER(TRIM(gtc.code)) = LOWER(TRIM(tg.code))
          LIMIT 1) > 0
    THEN '🌍 LINK from Global Catalog'
    WHEN EXISTS (
      SELECT 1 FROM test_groups tg2 
      WHERE tg2.lab_id = tg.lab_id
        AND LOWER(TRIM(tg2.name)) = LOWER(TRIM(tg.name))
        AND tg2.id != tg.id AND tg2.analyte_count > 0
    ) THEN '🔗 LINK from Same-Lab Sibling'
    WHEN EXISTS (
      SELECT 1 FROM test_groups tg3
      WHERE LOWER(TRIM(tg3.code)) = LOWER(TRIM(tg.code))
        AND tg3.id != tg.id AND tg3.analyte_count > 0
    ) THEN '🔗 LINK from Cross-Lab Match'
    WHEN NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = tg.id)
     AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = tg.id)
    THEN '🗑️ DELETE (no data, no source)'
    ELSE '⚠️ MANUAL REVIEW (has data, no source)'
  END AS action
FROM test_groups tg
WHERE tg.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
  AND tg.analyte_count = 0
ORDER BY tg.name;

-- =====================================================
-- STEP 2A: Auto-link from global_test_catalog
-- =====================================================

WITH orphans_with_global AS (
  SELECT 
    tg.id AS test_group_id,
    tg.name,
    tg.code,
    gtc.analytes AS global_analytes
  FROM test_groups tg
  JOIN global_test_catalog gtc ON LOWER(TRIM(gtc.code)) = LOWER(TRIM(tg.code))
  WHERE tg.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND tg.analyte_count = 0
    AND gtc.analytes IS NOT NULL
    AND jsonb_array_length(gtc.analytes) > 0
)
INSERT INTO test_group_analytes (test_group_id, analyte_id, display_order, is_visible)
SELECT 
  owg.test_group_id,
  (elem #>> '{}')::uuid,
  ROW_NUMBER() OVER (PARTITION BY owg.test_group_id)::integer,
  true
FROM orphans_with_global owg,
     jsonb_array_elements(owg.global_analytes) AS elem
WHERE (elem #>> '{}') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND EXISTS (SELECT 1 FROM analytes WHERE id = (elem #>> '{}')::uuid)
  AND NOT EXISTS (
    SELECT 1 FROM test_group_analytes existing 
    WHERE existing.test_group_id = owg.test_group_id 
      AND existing.analyte_id = (elem #>> '{}')::uuid
  );

-- Update counts for those just linked
UPDATE test_groups tg
SET analyte_count = (SELECT COUNT(*) FROM test_group_analytes WHERE test_group_id = tg.id),
    updated_at = NOW()
WHERE tg.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
  AND tg.analyte_count = 0
  AND EXISTS (SELECT 1 FROM test_group_analytes WHERE test_group_id = tg.id);

SELECT 'Step 2A done: Linked from global catalog' AS status,
  COUNT(*) AS groups_linked
FROM test_groups
WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
  AND analyte_count > 0;

-- =====================================================
-- STEP 2B: Auto-link remaining orphans from same-lab sibling
-- =====================================================

INSERT INTO test_group_analytes (test_group_id, analyte_id, display_order, is_visible, is_header, header_name, custom_reference_range, attachment_required)
SELECT 
  orphan.id,
  tga.analyte_id,
  tga.display_order,
  tga.is_visible,
  tga.is_header,
  tga.header_name,
  tga.custom_reference_range,
  tga.attachment_required
FROM test_groups orphan
JOIN LATERAL (
  SELECT tg2.id
  FROM test_groups tg2
  WHERE tg2.lab_id = orphan.lab_id
    AND LOWER(TRIM(tg2.name)) = LOWER(TRIM(orphan.name))
    AND tg2.id != orphan.id
    AND tg2.analyte_count > 0
  ORDER BY tg2.analyte_count DESC, tg2.created_at ASC
  LIMIT 1
) sibling ON TRUE
JOIN test_group_analytes tga ON tga.test_group_id = sibling.id
WHERE orphan.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
  AND orphan.analyte_count = 0
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes WHERE test_group_id = orphan.id)
  AND NOT EXISTS (
    SELECT 1 FROM test_group_analytes existing 
    WHERE existing.test_group_id = orphan.id 
      AND existing.analyte_id = tga.analyte_id
  );

-- Update counts
UPDATE test_groups tg
SET analyte_count = (SELECT COUNT(*) FROM test_group_analytes WHERE test_group_id = tg.id),
    updated_at = NOW()
WHERE tg.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
  AND tg.analyte_count = 0
  AND EXISTS (SELECT 1 FROM test_group_analytes WHERE test_group_id = tg.id);

SELECT 'Step 2B done: Linked from same-lab siblings' AS status;

-- =====================================================
-- STEP 2C: Auto-link remaining orphans from cross-lab match
-- =====================================================

INSERT INTO test_group_analytes (test_group_id, analyte_id, display_order, is_visible, is_header, header_name, custom_reference_range, attachment_required)
SELECT 
  orphan.id,
  tga.analyte_id,
  tga.display_order,
  tga.is_visible,
  tga.is_header,
  tga.header_name,
  tga.custom_reference_range,
  tga.attachment_required
FROM test_groups orphan
JOIN LATERAL (
  SELECT tg2.id
  FROM test_groups tg2
  WHERE LOWER(TRIM(tg2.code)) = LOWER(TRIM(orphan.code))
    AND tg2.id != orphan.id
    AND tg2.analyte_count > 0
  ORDER BY tg2.analyte_count DESC, tg2.created_at ASC
  LIMIT 1
) crosslab ON TRUE
JOIN test_group_analytes tga ON tga.test_group_id = crosslab.id
WHERE orphan.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
  AND orphan.analyte_count = 0
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes WHERE test_group_id = orphan.id)
  AND NOT EXISTS (
    SELECT 1 FROM test_group_analytes existing 
    WHERE existing.test_group_id = orphan.id 
      AND existing.analyte_id = tga.analyte_id
  );

-- Update counts
UPDATE test_groups tg
SET analyte_count = (SELECT COUNT(*) FROM test_group_analytes WHERE test_group_id = tg.id),
    updated_at = NOW()
WHERE tg.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
  AND tg.analyte_count = 0
  AND EXISTS (SELECT 1 FROM test_group_analytes WHERE test_group_id = tg.id);

SELECT 'Step 2C done: Linked from cross-lab matches' AS status;

-- =====================================================
-- STEP 3: Delete remaining orphans with NO data
-- =====================================================

-- Preview what will be deleted
SELECT 
  'TO DELETE' AS action,
  tg.id,
  tg.name,
  tg.code,
  tg.analyte_count
FROM test_groups tg
WHERE tg.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
  AND tg.analyte_count = 0
  AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = tg.id)
  AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = tg.id)
  AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = tg.id)
  AND NOT EXISTS (SELECT 1 FROM result_values WHERE test_group_id = tg.id);

-- Clean up child references
DELETE FROM account_prices WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND analyte_count = 0 AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM result_values WHERE test_group_id = test_groups.id)
);
DELETE FROM package_test_groups WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND analyte_count = 0 AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
);
DELETE FROM test_workflow_map WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND analyte_count = 0 AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
);
DELETE FROM location_test_prices WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND analyte_count = 0 AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
);
DELETE FROM outsourced_lab_prices WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND analyte_count = 0 AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
);
DELETE FROM lab_templates WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND analyte_count = 0 AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
);
DELETE FROM lab_template_sections WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND analyte_count = 0 AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
);
DELETE FROM test_catalog_embeddings WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND analyte_count = 0 AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
);
DELETE FROM test_mappings WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND analyte_count = 0 AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
);
DELETE FROM doctor_test_sharing WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND analyte_count = 0 AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
);
DELETE FROM workflow_ai_configs WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND analyte_count = 0 AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
);
DELETE FROM workflow_versions WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND analyte_count = 0 AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
);
DELETE FROM ai_prompts WHERE test_id IN (
  SELECT id FROM test_groups WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND analyte_count = 0 AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
);
DELETE FROM calibration_records WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND analyte_count = 0 AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
);
DELETE FROM inventory_test_mapping WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND analyte_count = 0 AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
);
DELETE FROM qc_analyzer_coverage WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND analyte_count = 0 AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
);
DELETE FROM qc_target_values WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND analyte_count = 0 AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
);

-- NOW delete the orphan test groups
DELETE FROM test_groups
WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
  AND analyte_count = 0
  AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
  AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
  AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
  AND NOT EXISTS (SELECT 1 FROM result_values WHERE test_group_id = test_groups.id);

-- =====================================================
-- STEP 4: Final verification
-- =====================================================

SELECT 
  'FINAL RESULT' AS report,
  COUNT(*) AS total_test_groups,
  COUNT(*) FILTER (WHERE analyte_count > 0) AS with_analytes,
  COUNT(*) FILTER (WHERE analyte_count = 0) AS still_orphaned,
  COUNT(*) FILTER (WHERE analyte_count = 0 
    AND EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)) AS orphans_with_orders
FROM test_groups
WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58';

-- Show any remaining orphans that couldn't be auto-linked (have orders/results)
SELECT 
  '⚠️ NEEDS MANUAL REVIEW' AS status,
  tg.id,
  tg.name,
  tg.code,
  tg.analyte_count,
  (SELECT COUNT(*) FROM order_test_groups WHERE test_group_id = tg.id) AS order_count,
  (SELECT COUNT(*) FROM results WHERE test_group_id = tg.id) AS result_count
FROM test_groups tg
WHERE tg.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
  AND tg.analyte_count = 0;

COMMIT;
-- If something went wrong: ROLLBACK;
