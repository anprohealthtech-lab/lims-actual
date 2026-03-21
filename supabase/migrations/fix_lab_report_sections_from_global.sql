-- ============================================================
-- fix_lab_report_sections_from_global.sql
-- Seeds lab_template_sections for ONE lab from
-- global_test_catalog_sections.
--
-- UUID resolution: matches test_groups.name = global_test_catalog.name
-- for the target lab — never relies on stored UUIDs.
-- Non-destructive: only inserts where the lab has no section of
-- that type for that test group.
--
-- HOW TO USE:
--   Replace the UUID below and run in Supabase SQL editor.
-- ============================================================

DO $$
DECLARE
  v_lab_id   UUID := 'YOUR-LAB-UUID-HERE';  -- ← put your lab id here
  v_inserted INT  := 0;
BEGIN

  INSERT INTO lab_template_sections (
    lab_id,
    test_group_id,       -- resolved at INSERT time via name match
    section_type,
    section_name,
    display_order,
    default_content,
    predefined_options,
    is_required,
    is_editable,
    placeholder_key,
    allow_images,
    allow_technician_entry
  )
  SELECT
    v_lab_id,
    tg.id,               -- lab-specific UUID resolved here
    gcs.section_type,
    gcs.section_name,
    gcs.display_order,
    gcs.default_content,
    gcs.predefined_options,
    gcs.is_required,
    gcs.is_editable,
    gcs.placeholder_key,
    gcs.allow_images,
    gcs.allow_technician_entry
  FROM global_test_catalog_sections gcs
  JOIN global_test_catalog gtc  ON gtc.id  = gcs.catalog_id
  JOIN test_groups          tg  ON lower(tg.name) = lower(gtc.name)
                               AND tg.lab_id       = v_lab_id
  -- Only insert where this lab does not already have a section
  -- of that type for that test group
  WHERE NOT EXISTS (
    SELECT 1
    FROM lab_template_sections lts
    WHERE lts.lab_id        = v_lab_id
      AND lts.test_group_id = tg.id
      AND lts.section_type  = gcs.section_type
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Lab: %', v_lab_id;
  RAISE NOTICE '  Report sections inserted : %', v_inserted;
  RAISE NOTICE '========================================';

END $$;


-- ── Verify: sections seeded for this lab ─────────────────────
/*
SELECT
  tg.name          AS test_group,
  lts.section_type,
  lts.section_name,
  lts.display_order,
  lts.placeholder_key
FROM lab_template_sections lts
JOIN test_groups tg ON tg.id = lts.test_group_id
WHERE lts.lab_id = 'YOUR-LAB-UUID-HERE'
ORDER BY tg.name, lts.display_order;
*/
