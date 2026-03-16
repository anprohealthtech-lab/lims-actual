-- =====================================================
-- FIX: LINK ORPHAN TEST GROUPS & CLEAN DUPLICATES
-- Lab ID: 113bf166-ca18-40cd-9b5e-552958be0d58
-- =====================================================
-- STRATEGY:
--   1. For orphan test groups that have a MATCHING duplicate WITH analytes:
--      a) If orphan has NO orders/results → DELETE the orphan
--      b) If orphan HAS orders/results → COPY analytes from the good duplicate
--   2. For purely orphan test groups (no matching duplicate) → SKIP (manual review)
--   3. Clean up duplicate test groups (keep oldest with analytes, merge refs)
--   4. Clean up duplicate analytes
-- =====================================================
-- ⚠️ RUN audit_duplicates_orphans.sql FIRST to understand the data
-- =====================================================

BEGIN;

-- =====================================================
-- STEP 1: LINK ORPHAN TEST GROUPS TO ANALYTES
-- =====================================================
-- Copy analytes from the "good" duplicate into orphan test groups 
-- that HAVE orders/results (so we can't just delete them)

-- Preview what will be linked
SELECT 
  'PREVIEW - LINKING ANALYTES' AS action,
  orphan.id AS orphan_id,
  orphan.name AS orphan_name,
  good.id AS source_id,
  good.name AS source_name,
  (SELECT COUNT(*) FROM test_group_analytes WHERE test_group_id = good.id) AS analytes_to_copy,
  (SELECT COUNT(*) FROM order_test_groups WHERE test_group_id = orphan.id) AS orphan_orders,
  (SELECT COUNT(*) FROM results WHERE test_group_id = orphan.id) AS orphan_results
FROM test_groups orphan
JOIN LATERAL (
  SELECT tg2.id, tg2.name
  FROM test_groups tg2
  WHERE tg2.lab_id = orphan.lab_id
    AND LOWER(TRIM(tg2.name)) = LOWER(TRIM(orphan.name))
    AND tg2.id != orphan.id
    AND EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg2.id)
  ORDER BY 
    (SELECT COUNT(*) FROM test_group_analytes tga WHERE tga.test_group_id = tg2.id) DESC,
    tg2.created_at ASC
  LIMIT 1
) good ON TRUE
WHERE orphan.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = orphan.id)
  AND (
    EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    OR EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = orphan.id)
    OR EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    OR EXISTS (SELECT 1 FROM result_values rv WHERE rv.test_group_id = orphan.id)
  );

-- Actually copy analytes from "good" duplicate into orphans that have data
INSERT INTO test_group_analytes (test_group_id, analyte_id, display_order, is_visible, attachment_required, custom_reference_range, is_header, header_name)
SELECT 
  orphan.id,           -- target: the orphan
  tga.analyte_id,
  tga.display_order,
  tga.is_visible,
  tga.attachment_required,
  tga.custom_reference_range,
  tga.is_header,
  tga.header_name
FROM test_groups orphan
JOIN LATERAL (
  SELECT tg2.id
  FROM test_groups tg2
  WHERE tg2.lab_id = orphan.lab_id
    AND LOWER(TRIM(tg2.name)) = LOWER(TRIM(orphan.name))
    AND tg2.id != orphan.id
    AND EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg2.id)
  ORDER BY 
    (SELECT COUNT(*) FROM test_group_analytes tga WHERE tga.test_group_id = tg2.id) DESC,
    tg2.created_at ASC
  LIMIT 1
) good ON TRUE
JOIN test_group_analytes tga ON tga.test_group_id = good.id
WHERE orphan.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga2 WHERE tga2.test_group_id = orphan.id)
  AND (
    EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    OR EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = orphan.id)
    OR EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    OR EXISTS (SELECT 1 FROM result_values rv WHERE rv.test_group_id = orphan.id)
  )
  -- Avoid inserting duplicate analyte for same test group
  AND NOT EXISTS (
    SELECT 1 FROM test_group_analytes existing 
    WHERE existing.test_group_id = orphan.id 
      AND existing.analyte_id = tga.analyte_id
  );

-- =====================================================
-- STEP 2: DELETE ORPHAN TEST GROUPS THAT HAVE NO DATA
-- =====================================================
-- These are orphans with a matching duplicate that has analytes,
-- but the orphan itself has no orders/results → safe to delete

-- First clean up child table references for these orphans

-- 2a. Delete from account_prices
DELETE FROM account_prices WHERE test_group_id IN (
  SELECT orphan.id
  FROM test_groups orphan
  WHERE orphan.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM result_values rv WHERE rv.test_group_id = orphan.id)
);

-- 2b. Delete from account_package_prices referencing packages with these test groups
DELETE FROM package_test_groups WHERE test_group_id IN (
  SELECT orphan.id
  FROM test_groups orphan
  WHERE orphan.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM result_values rv WHERE rv.test_group_id = orphan.id)
);

-- 2c. Delete from test_workflow_map
DELETE FROM test_workflow_map WHERE test_group_id IN (
  SELECT orphan.id
  FROM test_groups orphan
  WHERE orphan.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM result_values rv WHERE rv.test_group_id = orphan.id)
);

-- 2d. Delete from location_test_prices
DELETE FROM location_test_prices WHERE test_group_id IN (
  SELECT orphan.id
  FROM test_groups orphan
  WHERE orphan.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM result_values rv WHERE rv.test_group_id = orphan.id)
);

-- 2e. Delete from outsourced_lab_prices
DELETE FROM outsourced_lab_prices WHERE test_group_id IN (
  SELECT orphan.id
  FROM test_groups orphan
  WHERE orphan.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM result_values rv WHERE rv.test_group_id = orphan.id)
);

-- 2f. Delete from lab_templates
DELETE FROM lab_templates WHERE test_group_id IN (
  SELECT orphan.id
  FROM test_groups orphan
  WHERE orphan.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM result_values rv WHERE rv.test_group_id = orphan.id)
);

-- 2g. Delete from lab_template_sections
DELETE FROM lab_template_sections WHERE test_group_id IN (
  SELECT orphan.id
  FROM test_groups orphan
  WHERE orphan.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM result_values rv WHERE rv.test_group_id = orphan.id)
);

-- 2h. Delete from test_catalog_embeddings
DELETE FROM test_catalog_embeddings WHERE test_group_id IN (
  SELECT orphan.id
  FROM test_groups orphan
  WHERE orphan.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM result_values rv WHERE rv.test_group_id = orphan.id)
);

-- 2i. Delete from test_mappings
DELETE FROM test_mappings WHERE test_group_id IN (
  SELECT orphan.id
  FROM test_groups orphan
  WHERE orphan.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM result_values rv WHERE rv.test_group_id = orphan.id)
);

-- 2j. Delete from doctor_test_sharing
DELETE FROM doctor_test_sharing WHERE test_group_id IN (
  SELECT orphan.id
  FROM test_groups orphan
  WHERE orphan.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM result_values rv WHERE rv.test_group_id = orphan.id)
);

-- 2k. Delete from workflow_ai_configs
DELETE FROM workflow_ai_configs WHERE test_group_id IN (
  SELECT orphan.id
  FROM test_groups orphan
  WHERE orphan.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM result_values rv WHERE rv.test_group_id = orphan.id)
);

-- 2l. Delete from workflow_versions
DELETE FROM workflow_versions WHERE test_group_id IN (
  SELECT orphan.id
  FROM test_groups orphan
  WHERE orphan.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM result_values rv WHERE rv.test_group_id = orphan.id)
);

-- 2m. Delete from ai_prompts
DELETE FROM ai_prompts WHERE test_id IN (
  SELECT orphan.id
  FROM test_groups orphan
  WHERE orphan.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = orphan.id)
    AND NOT EXISTS (SELECT 1 FROM result_values rv WHERE rv.test_group_id = orphan.id)
);

-- 2n. NOW delete the orphan test groups themselves
DELETE FROM test_groups
WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = test_groups.id)
  AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = test_groups.id)
  AND NOT EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = test_groups.id)
  AND NOT EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = test_groups.id)
  AND NOT EXISTS (SELECT 1 FROM result_values rv WHERE rv.test_group_id = test_groups.id);

-- =====================================================
-- STEP 3: CLEAN DUPLICATE ANALYTES
-- =====================================================
-- For duplicate analytes (same name), keep the one with most usage,
-- re-point references from the duplicate to the keeper

-- Preview duplicate analytes that would be merged
SELECT 
  'PREVIEW - DUPLICATE ANALYTES TO MERGE' AS action,
  keeper.id AS keep_id,
  keeper.name AS keep_name,
  dupes.id AS dupe_id,
  dupes.name AS dupe_name,
  (SELECT COUNT(*) FROM test_group_analytes tga WHERE tga.analyte_id = keeper.id) AS keeper_tga_count,
  (SELECT COUNT(*) FROM test_group_analytes tga WHERE tga.analyte_id = dupes.id) AS dupe_tga_count,
  (SELECT COUNT(*) FROM result_values rv WHERE rv.analyte_id = keeper.id) AS keeper_rv_count,
  (SELECT COUNT(*) FROM result_values rv WHERE rv.analyte_id = dupes.id) AS dupe_rv_count
FROM analytes keeper
JOIN analytes dupes 
  ON LOWER(TRIM(dupes.name)) = LOWER(TRIM(keeper.name))
  AND dupes.id != keeper.id
  AND dupes.created_at > keeper.created_at  -- Keep the older one
WHERE keeper.id IN (
  SELECT tga.analyte_id FROM test_group_analytes tga
  JOIN test_groups tg ON tg.id = tga.test_group_id
  WHERE tg.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
)
AND dupes.id IN (
  SELECT tga.analyte_id FROM test_group_analytes tga
  JOIN test_groups tg ON tg.id = tga.test_group_id
  WHERE tg.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
)
-- Only merge if the keeper has more or equal usage
AND (SELECT COUNT(*) FROM test_group_analytes tga WHERE tga.analyte_id = keeper.id) 
    >= (SELECT COUNT(*) FROM test_group_analytes tga WHERE tga.analyte_id = dupes.id)
ORDER BY keeper.name;

-- NOTE: Analyte deduplication is more complex because analytes are GLOBAL.
-- The above is a preview. To actually merge, you would need to:
--   1. Update test_group_analytes.analyte_id from dupe → keeper
--   2. Update result_values.analyte_id from dupe → keeper  
--   3. Update lab_analytes.analyte_id from dupe → keeper
--   4. Then delete the dupe analyte
-- This should be done CAREFULLY and manually reviewed.
-- Uncomment the block below to execute:

/*
-- Re-point test_group_analytes from duplicate to keeper
UPDATE test_group_analytes SET analyte_id = keeper.id
FROM (
  SELECT 
    MIN(a.id) FILTER (WHERE a.created_at = sub.min_created) AS keeper_id,
    a2.id AS dupe_id
  FROM analytes a
  JOIN (
    SELECT LOWER(TRIM(name)) AS norm_name, MIN(created_at) AS min_created
    FROM analytes
    WHERE id IN (
      SELECT tga.analyte_id FROM test_group_analytes tga
      JOIN test_groups tg ON tg.id = tga.test_group_id
      WHERE tg.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    )
    GROUP BY LOWER(TRIM(name))
    HAVING COUNT(*) > 1
  ) sub ON LOWER(TRIM(a.name)) = sub.norm_name AND a.created_at = sub.min_created
  JOIN analytes a2 ON LOWER(TRIM(a2.name)) = sub.norm_name AND a2.id != a.id
  GROUP BY a2.id
) keeper
WHERE test_group_analytes.analyte_id = keeper.dupe_id
  AND NOT EXISTS (
    SELECT 1 FROM test_group_analytes existing
    WHERE existing.test_group_id = test_group_analytes.test_group_id
      AND existing.analyte_id = keeper.keeper_id
  );

-- Delete test_group_analytes that now point to duplicates (already have keeper)
DELETE FROM test_group_analytes 
WHERE analyte_id IN (
  SELECT a2.id
  FROM analytes a2
  JOIN (
    SELECT LOWER(TRIM(name)) AS norm_name, MIN(created_at) AS min_created
    FROM analytes
    WHERE id IN (
      SELECT tga.analyte_id FROM test_group_analytes tga
      JOIN test_groups tg ON tg.id = tga.test_group_id
      WHERE tg.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
    )
    GROUP BY LOWER(TRIM(name))
    HAVING COUNT(*) > 1
  ) sub ON LOWER(TRIM(a2.name)) = sub.norm_name AND a2.created_at != sub.min_created
)
AND test_group_id IN (SELECT id FROM test_groups WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58');
*/

-- =====================================================
-- STEP 4: CLEAN ORPHAN LAB_ANALYTES
-- =====================================================
-- Delete lab_analytes that reference analytes no longer in any test group

DELETE FROM lab_analytes
WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
  AND NOT EXISTS (
    SELECT 1 FROM test_group_analytes tga 
    WHERE tga.analyte_id = lab_analytes.analyte_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM result_values rv 
    WHERE rv.analyte_id = lab_analytes.analyte_id
  );

-- =====================================================
-- VERIFICATION
-- =====================================================

SELECT 'AFTER CLEANUP' AS report, 'Total test groups' AS category, 
  COUNT(*) AS count
FROM test_groups WHERE lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'

UNION ALL

SELECT 'AFTER CLEANUP', 'Orphan test groups (no analytes)', COUNT(*)
FROM test_groups tg
WHERE tg.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id)

UNION ALL

SELECT 'AFTER CLEANUP', 'Orphan lab_analytes', COUNT(*)
FROM lab_analytes la
WHERE la.lab_id = '113bf166-ca18-40cd-9b5e-552958be0d58'
  AND NOT EXISTS (SELECT 1 FROM test_group_analytes tga WHERE tga.analyte_id = la.analyte_id)
  AND NOT EXISTS (SELECT 1 FROM result_values rv WHERE rv.analyte_id = la.analyte_id);

-- =====================================================
-- If everything looks good:
COMMIT;
-- If something went wrong:
-- ROLLBACK;
