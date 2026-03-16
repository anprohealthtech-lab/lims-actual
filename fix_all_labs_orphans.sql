-- =====================================================
-- GLOBAL FIX: Auto-link ALL orphan test groups (all labs)
-- =====================================================
-- Fixes every test_group where analyte_count = 0
-- Strategy: Global Catalog → Same-Lab Sibling → Cross-Lab Match → Delete if no data
-- =====================================================

BEGIN;

-- =====================================================
-- STEP 1: Preview orphan counts per lab
-- =====================================================

SELECT 
  tg.lab_id,
  l.name AS lab_name,
  COUNT(*) AS orphan_count,
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = tg.id)) AS with_orders,
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM results WHERE test_group_id = tg.id)) AS with_results
FROM test_groups tg
LEFT JOIN labs l ON l.id = tg.lab_id
WHERE tg.analyte_count = 0
GROUP BY tg.lab_id, l.name
ORDER BY orphan_count DESC;

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
  WHERE tg.analyte_count = 0
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
WHERE tg.analyte_count = 0
  AND EXISTS (SELECT 1 FROM test_group_analytes WHERE test_group_id = tg.id);

SELECT 'Step 2A done: Linked from global catalog' AS status,
  COUNT(*) FILTER (WHERE analyte_count > 0) AS now_linked,
  COUNT(*) FILTER (WHERE analyte_count = 0) AS still_orphaned
FROM test_groups;

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
WHERE orphan.analyte_count = 0
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
WHERE tg.analyte_count = 0
  AND EXISTS (SELECT 1 FROM test_group_analytes WHERE test_group_id = tg.id);

SELECT 'Step 2B done: Linked from same-lab siblings' AS status,
  COUNT(*) FILTER (WHERE analyte_count = 0) AS still_orphaned
FROM test_groups;

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
WHERE orphan.analyte_count = 0
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
WHERE tg.analyte_count = 0
  AND EXISTS (SELECT 1 FROM test_group_analytes WHERE test_group_id = tg.id);

SELECT 'Step 2C done: Linked from cross-lab matches' AS status,
  COUNT(*) FILTER (WHERE analyte_count = 0) AS still_orphaned
FROM test_groups;

-- =====================================================
-- STEP 3: Delete remaining orphans with NO data
-- =====================================================

-- Preview what will be deleted (per lab)
SELECT 
  tg.lab_id,
  l.name AS lab_name,
  COUNT(*) AS to_delete
FROM test_groups tg
LEFT JOIN labs l ON l.id = tg.lab_id
WHERE tg.analyte_count = 0
  AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = tg.id)
  AND NOT EXISTS (SELECT 1 FROM order_tests WHERE test_group_id = tg.id)
  AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = tg.id)
  AND NOT EXISTS (SELECT 1 FROM result_values WHERE test_group_id = tg.id)
GROUP BY tg.lab_id, l.name
ORDER BY to_delete DESC;

-- Clean up ALL child references for data-less orphans
DELETE FROM account_prices WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE analyte_count = 0
    AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM order_tests WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM result_values WHERE test_group_id = test_groups.id)
);
DELETE FROM package_test_groups WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE analyte_count = 0
    AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM order_tests WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM result_values WHERE test_group_id = test_groups.id)
);
DELETE FROM test_workflow_map WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE analyte_count = 0
    AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM order_tests WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM result_values WHERE test_group_id = test_groups.id)
);
DELETE FROM location_test_prices WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE analyte_count = 0
    AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM order_tests WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM result_values WHERE test_group_id = test_groups.id)
);
DELETE FROM outsourced_lab_prices WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE analyte_count = 0
    AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM order_tests WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM result_values WHERE test_group_id = test_groups.id)
);
DELETE FROM lab_templates WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE analyte_count = 0
    AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM order_tests WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM result_values WHERE test_group_id = test_groups.id)
);
DELETE FROM lab_template_sections WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE analyte_count = 0
    AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM order_tests WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM result_values WHERE test_group_id = test_groups.id)
);
DELETE FROM test_catalog_embeddings WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE analyte_count = 0
    AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM order_tests WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM result_values WHERE test_group_id = test_groups.id)
);
DELETE FROM test_mappings WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE analyte_count = 0
    AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM order_tests WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM result_values WHERE test_group_id = test_groups.id)
);
DELETE FROM doctor_test_sharing WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE analyte_count = 0
    AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM order_tests WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM result_values WHERE test_group_id = test_groups.id)
);
DELETE FROM workflow_ai_configs WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE analyte_count = 0
    AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM order_tests WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM result_values WHERE test_group_id = test_groups.id)
);
DELETE FROM workflow_versions WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE analyte_count = 0
    AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM order_tests WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM result_values WHERE test_group_id = test_groups.id)
);
DELETE FROM ai_prompts WHERE test_id IN (
  SELECT id FROM test_groups WHERE analyte_count = 0
    AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM order_tests WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM result_values WHERE test_group_id = test_groups.id)
);
DELETE FROM calibration_records WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE analyte_count = 0
    AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM order_tests WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM result_values WHERE test_group_id = test_groups.id)
);
DELETE FROM inventory_test_mapping WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE analyte_count = 0
    AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM order_tests WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM result_values WHERE test_group_id = test_groups.id)
);
DELETE FROM qc_analyzer_coverage WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE analyte_count = 0
    AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM order_tests WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM result_values WHERE test_group_id = test_groups.id)
);
DELETE FROM qc_target_values WHERE test_group_id IN (
  SELECT id FROM test_groups WHERE analyte_count = 0
    AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM order_tests WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
    AND NOT EXISTS (SELECT 1 FROM result_values WHERE test_group_id = test_groups.id)
);

-- NOW delete the orphan test groups themselves
DELETE FROM test_groups
WHERE analyte_count = 0
  AND NOT EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = test_groups.id)
  AND NOT EXISTS (SELECT 1 FROM order_tests WHERE test_group_id = test_groups.id)
  AND NOT EXISTS (SELECT 1 FROM results WHERE test_group_id = test_groups.id)
  AND NOT EXISTS (SELECT 1 FROM result_values WHERE test_group_id = test_groups.id);

-- =====================================================
-- STEP 4: Final verification
-- =====================================================

SELECT 
  'GLOBAL RESULT' AS report,
  COUNT(*) AS total_test_groups,
  COUNT(*) FILTER (WHERE analyte_count > 0) AS with_analytes,
  COUNT(*) FILTER (WHERE analyte_count = 0) AS still_orphaned
FROM test_groups;

-- Remaining orphans per lab (need manual review - have order/result data)
SELECT 
  tg.lab_id,
  l.name AS lab_name,
  COUNT(*) AS orphan_count,
  '⚠️ NEEDS MANUAL REVIEW' AS status
FROM test_groups tg
LEFT JOIN labs l ON l.id = tg.lab_id
WHERE tg.analyte_count = 0
GROUP BY tg.lab_id, l.name
ORDER BY orphan_count DESC;

COMMIT;
-- If something went wrong: ROLLBACK;
