-- ============================================================
-- fix_all_labs_report_sections_from_global.sql
-- Seeds lab_template_sections for ALL labs from
-- global_test_catalog_sections.
--
-- UUID resolution: matches test_groups.name = global_test_catalog.name
-- per lab — never relies on stored UUIDs.
-- Non-destructive: only inserts where a lab has no section of
-- that type for that test group.
-- ============================================================

DO $$
DECLARE
  v_inserted INT := 0;
BEGIN

  INSERT INTO lab_template_sections (
    lab_id,
    test_group_id,
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
    tg.lab_id,
    tg.id,
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
                               AND tg.lab_id IS NOT NULL
  WHERE NOT EXISTS (
    SELECT 1
    FROM lab_template_sections lts
    WHERE lts.lab_id        = tg.lab_id
      AND lts.test_group_id = tg.id
      AND lts.section_type  = gcs.section_type
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'ALL LABS — report sections backfill';
  RAISE NOTICE '  Report sections inserted : %', v_inserted;
  RAISE NOTICE '========================================';

END $$;


-- ── Verify: count per lab ────────────────────────────────────
/*
SELECT
  l.name AS lab_name,
  COUNT(*) AS sections_seeded
FROM lab_template_sections lts
JOIN labs l ON l.id = lts.lab_id
WHERE lts.test_group_id IS NOT NULL
GROUP BY l.name
ORDER BY l.name;
*/
