-- ============================================================
-- fix_all_labs_test_groups_from_global.sql
-- Fills section_heading, sort_order, and group_interpretation
-- for ALL labs using test_group_name × analyte_name matching.
-- UUID-independent — works even when analyte IDs differ.
-- ============================================================

DO $$
DECLARE
  v_metadata_updated INT := 0;
  v_interp_filled    INT := 0;
BEGIN

  -- STEP 1: Fill analyte link metadata — match by test group name + analyte name
  UPDATE test_group_analytes tga
  SET
    section_heading        = COALESCE(tga.section_heading, gtca.section_heading),
    sort_order             = CASE WHEN tga.sort_order    IS NULL OR tga.sort_order    = 0
                                  THEN gtca.sort_order    ELSE tga.sort_order    END,
    display_order          = CASE WHEN tga.display_order IS NULL OR tga.display_order = 0
                                  THEN COALESCE(gtca.display_order, gtca.sort_order)
                                  ELSE tga.display_order END,
    is_header              = COALESCE(tga.is_header,   gtca.is_header, false),
    header_name            = COALESCE(tga.header_name, gtca.header_name),
    custom_reference_range = COALESCE(tga.custom_reference_range, gtca.custom_reference_range)
  FROM test_groups tg,
       analytes a_lab,
       global_test_catalog_analytes gtca
  WHERE tga.test_group_id           = tg.id
    AND tga.analyte_id              = a_lab.id
    AND lower(gtca.test_group_name) = lower(tg.name)
    AND lower(gtca.analyte_name)    = lower(a_lab.name)
    AND tg.lab_id IS NOT NULL
    AND (
      tga.section_heading        IS NULL
      OR tga.sort_order          IS NULL OR tga.sort_order    = 0
      OR tga.display_order       IS NULL OR tga.display_order = 0
      OR tga.is_header           IS NULL
      OR (tga.header_name            IS NULL AND gtca.header_name            IS NOT NULL)
      OR (tga.custom_reference_range IS NULL AND gtca.custom_reference_range IS NOT NULL)
    );

  GET DIAGNOSTICS v_metadata_updated = ROW_COUNT;

  -- STEP 2: Fill group_interpretation for all labs
  UPDATE test_groups tg
  SET    group_interpretation = gtc.group_interpretation
  FROM   global_test_catalog gtc
  WHERE  lower(tg.name) = lower(gtc.name)
    AND  tg.lab_id IS NOT NULL
    AND  (tg.group_interpretation IS NULL OR tg.group_interpretation = '')
    AND  gtc.group_interpretation IS NOT NULL
    AND  gtc.group_interpretation <> '';

  GET DIAGNOSTICS v_interp_filled = ROW_COUNT;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'ALL LABS — name-based backfill complete';
  RAISE NOTICE '  Analyte links back-filled  : %', v_metadata_updated;
  RAISE NOTICE '  Interpretation filled      : %', v_interp_filled;
  RAISE NOTICE '========================================';

END $$;
