-- Migration: Fix auto-link trigger functions to use global_test_catalog_analytes
-- junction table so they carry section_heading, sort_order, is_header, header_name.
--
-- Previously Strategy A in both functions read from the OLD global_test_catalog.analytes
-- JSONB array and only inserted (analyte_id, display_order, is_visible) — losing all
-- section/header metadata. Strategy B/C also missed section_heading and sort_order.
--
-- These CREATE OR REPLACE statements patch both functions in-place.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. auto_link_or_delete_orphan_test_group  (fires AFTER DELETE on test_group_analytes)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_link_or_delete_orphan_test_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_test_group_id uuid;
  v_test_group_name text;
  v_test_group_code text;
  v_lab_id uuid;
  v_analyte_count integer;
  v_has_orders boolean;
  v_has_results boolean;
  v_source_tg_id uuid;
  v_linked integer := 0;
BEGIN
  v_test_group_id := OLD.test_group_id;

  SELECT analyte_count, name, code, lab_id
  INTO v_analyte_count, v_test_group_name, v_test_group_code, v_lab_id
  FROM test_groups WHERE id = v_test_group_id;

  IF v_analyte_count IS NULL OR v_analyte_count > 0 THEN RETURN OLD; END IF;

  SELECT COUNT(*) INTO v_analyte_count
  FROM test_group_analytes WHERE test_group_id = v_test_group_id;
  IF v_analyte_count > 0 THEN RETURN OLD; END IF;

  RAISE NOTICE 'Test group % (%) has 0 analytes. Attempting auto-link...', v_test_group_name, v_test_group_id;

  -- ──────────────────────────────────────────────────────────────────────────
  -- STRATEGY A: Link from global_test_catalog_analytes (junction table — full metadata)
  -- ──────────────────────────────────────────────────────────────────────────
  INSERT INTO test_group_analytes (
    test_group_id, analyte_id,
    sort_order, display_order, is_visible,
    is_header, header_name, section_heading, custom_reference_range
  )
  SELECT
    v_test_group_id,
    gtca.analyte_id,
    gtca.sort_order,
    gtca.display_order,
    COALESCE(gtca.is_visible, true),
    COALESCE(gtca.is_header, false),
    gtca.header_name,
    gtca.section_heading,
    gtca.custom_reference_range
  FROM public.global_test_catalog gtc
  JOIN public.global_test_catalog_analytes gtca ON gtca.catalog_id = gtc.id
  WHERE LOWER(TRIM(gtc.code)) = LOWER(TRIM(v_test_group_code))
    AND EXISTS (SELECT 1 FROM public.analytes a WHERE a.id = gtca.analyte_id)
  ORDER BY gtca.sort_order
  ON CONFLICT (test_group_id, analyte_id) DO NOTHING;

  GET DIAGNOSTICS v_linked = ROW_COUNT;
  IF v_linked > 0 THEN
    RAISE NOTICE 'Linked % analytes from global_test_catalog_analytes for test group %', v_linked, v_test_group_name;
    UPDATE test_groups SET analyte_count = v_linked, updated_at = NOW() WHERE id = v_test_group_id;
    RETURN OLD;
  END IF;

  -- Fallback: old JSONB array (pre-junction-table data)
  INSERT INTO test_group_analytes (test_group_id, analyte_id, display_order, is_visible)
  SELECT
    v_test_group_id,
    (elem::text)::uuid,
    (ROW_NUMBER() OVER ())::integer,
    true
  FROM public.global_test_catalog gtc,
       jsonb_array_elements(
         CASE WHEN jsonb_typeof(gtc.analytes) = 'array' THEN gtc.analytes ELSE '[]'::jsonb END
       ) AS elem
  WHERE LOWER(TRIM(gtc.code)) = LOWER(TRIM(v_test_group_code))
    AND EXISTS (SELECT 1 FROM public.analytes WHERE id = (elem::text)::uuid)
  ON CONFLICT (test_group_id, analyte_id) DO NOTHING;

  GET DIAGNOSTICS v_linked = ROW_COUNT;
  IF v_linked > 0 THEN
    RAISE NOTICE 'Linked % analytes from global_test_catalog JSONB fallback for test group %', v_linked, v_test_group_name;
    UPDATE test_groups SET analyte_count = v_linked, updated_at = NOW() WHERE id = v_test_group_id;
    RETURN OLD;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- STRATEGY B: Copy from sibling in same lab (same name)
  -- ──────────────────────────────────────────────────────────────────────────
  SELECT id INTO v_source_tg_id
  FROM test_groups
  WHERE lab_id = v_lab_id
    AND LOWER(TRIM(name)) = LOWER(TRIM(v_test_group_name))
    AND id != v_test_group_id AND analyte_count > 0
  ORDER BY analyte_count DESC, created_at ASC LIMIT 1;

  IF v_source_tg_id IS NOT NULL THEN
    INSERT INTO test_group_analytes (
      test_group_id, analyte_id,
      sort_order, display_order, is_visible,
      is_header, header_name, section_heading,
      custom_reference_range, attachment_required
    )
    SELECT
      v_test_group_id, tga.analyte_id,
      tga.sort_order, tga.display_order, tga.is_visible,
      tga.is_header, tga.header_name, tga.section_heading,
      tga.custom_reference_range, tga.attachment_required
    FROM test_group_analytes tga WHERE tga.test_group_id = v_source_tg_id
    ON CONFLICT (test_group_id, analyte_id) DO NOTHING;

    GET DIAGNOSTICS v_linked = ROW_COUNT;
    IF v_linked > 0 THEN
      RAISE NOTICE 'Linked % analytes from sibling (same lab, same name) for %', v_linked, v_test_group_name;
      UPDATE test_groups SET analyte_count = v_linked, updated_at = NOW() WHERE id = v_test_group_id;
      RETURN OLD;
    END IF;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- STRATEGY C: Copy from ANY lab with same code
  -- ──────────────────────────────────────────────────────────────────────────
  SELECT id INTO v_source_tg_id
  FROM test_groups
  WHERE LOWER(TRIM(code)) = LOWER(TRIM(v_test_group_code))
    AND id != v_test_group_id AND analyte_count > 0
  ORDER BY analyte_count DESC, created_at ASC LIMIT 1;

  IF v_source_tg_id IS NOT NULL THEN
    INSERT INTO test_group_analytes (
      test_group_id, analyte_id,
      sort_order, display_order, is_visible,
      is_header, header_name, section_heading,
      custom_reference_range, attachment_required
    )
    SELECT
      v_test_group_id, tga.analyte_id,
      tga.sort_order, tga.display_order, tga.is_visible,
      tga.is_header, tga.header_name, tga.section_heading,
      tga.custom_reference_range, tga.attachment_required
    FROM test_group_analytes tga WHERE tga.test_group_id = v_source_tg_id
    ON CONFLICT (test_group_id, analyte_id) DO NOTHING;

    GET DIAGNOSTICS v_linked = ROW_COUNT;
    IF v_linked > 0 THEN
      RAISE NOTICE 'Linked % analytes from cross-lab match (same code) for %', v_linked, v_test_group_name;
      UPDATE test_groups SET analyte_count = v_linked, updated_at = NOW() WHERE id = v_test_group_id;
      RETURN OLD;
    END IF;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- NO SOURCE FOUND: delete orphan if no orders/results
  -- ──────────────────────────────────────────────────────────────────────────
  SELECT
    EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = v_test_group_id),
    EXISTS (SELECT 1 FROM results WHERE test_group_id = v_test_group_id)
  INTO v_has_orders, v_has_results;

  IF NOT v_has_orders AND NOT v_has_results THEN
    RAISE NOTICE 'No analyte source found and no orders/results. Deleting orphan test group: % (%)', v_test_group_name, v_test_group_id;
    DELETE FROM account_prices          WHERE test_group_id = v_test_group_id;
    DELETE FROM package_test_groups     WHERE test_group_id = v_test_group_id;
    DELETE FROM test_workflow_map       WHERE test_group_id = v_test_group_id;
    DELETE FROM location_test_prices    WHERE test_group_id = v_test_group_id;
    DELETE FROM outsourced_lab_prices   WHERE test_group_id = v_test_group_id;
    DELETE FROM lab_templates           WHERE test_group_id = v_test_group_id;
    DELETE FROM lab_template_sections   WHERE test_group_id = v_test_group_id;
    DELETE FROM test_catalog_embeddings WHERE test_group_id = v_test_group_id;
    DELETE FROM test_mappings           WHERE test_group_id = v_test_group_id;
    DELETE FROM doctor_test_sharing     WHERE test_group_id = v_test_group_id;
    DELETE FROM workflow_ai_configs     WHERE test_group_id = v_test_group_id;
    DELETE FROM workflow_versions       WHERE test_group_id = v_test_group_id;
    DELETE FROM ai_prompts              WHERE test_id       = v_test_group_id;
    DELETE FROM calibration_records     WHERE test_group_id = v_test_group_id;
    DELETE FROM inventory_test_mapping  WHERE test_group_id = v_test_group_id;
    DELETE FROM qc_analyzer_coverage    WHERE test_group_id = v_test_group_id;
    DELETE FROM qc_target_values        WHERE test_group_id = v_test_group_id;
    DELETE FROM order_tests             WHERE test_group_id = v_test_group_id;
    DELETE FROM order_test_groups       WHERE test_group_id = v_test_group_id;
    DELETE FROM test_groups             WHERE id            = v_test_group_id;
  ELSE
    RAISE WARNING 'Orphan test group % (%) has orders/results but NO analytes. Needs manual review!', v_test_group_name, v_test_group_id;
  END IF;

  RETURN OLD;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. auto_link_new_test_group  (fires BEFORE INSERT on test_groups)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_link_new_test_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_linked integer := 0;
  v_source_tg_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM test_group_analytes WHERE test_group_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  IF NEW.lab_id IS NULL THEN RETURN NEW; END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- STRATEGY A: Link from global_test_catalog_analytes (junction table — full metadata)
  -- ──────────────────────────────────────────────────────────────────────────
  INSERT INTO test_group_analytes (
    test_group_id, analyte_id,
    sort_order, display_order, is_visible,
    is_header, header_name, section_heading, custom_reference_range
  )
  SELECT
    NEW.id,
    gtca.analyte_id,
    gtca.sort_order,
    gtca.display_order,
    COALESCE(gtca.is_visible, true),
    COALESCE(gtca.is_header, false),
    gtca.header_name,
    gtca.section_heading,
    gtca.custom_reference_range
  FROM public.global_test_catalog gtc
  JOIN public.global_test_catalog_analytes gtca ON gtca.catalog_id = gtc.id
  WHERE LOWER(TRIM(gtc.code)) = LOWER(TRIM(NEW.code))
    AND EXISTS (SELECT 1 FROM public.analytes a WHERE a.id = gtca.analyte_id)
  ORDER BY gtca.sort_order
  ON CONFLICT (test_group_id, analyte_id) DO NOTHING;

  GET DIAGNOSTICS v_linked = ROW_COUNT;
  IF v_linked > 0 THEN
    NEW.analyte_count := v_linked;
    RAISE NOTICE 'Auto-linked % analytes from global_test_catalog_analytes for new test group % (%)', v_linked, NEW.name, NEW.code;
    RETURN NEW;
  END IF;

  -- Fallback: old JSONB array
  INSERT INTO test_group_analytes (test_group_id, analyte_id, display_order, is_visible)
  SELECT
    NEW.id,
    (elem::text)::uuid,
    (ROW_NUMBER() OVER ())::integer,
    true
  FROM public.global_test_catalog gtc,
       jsonb_array_elements(
         CASE WHEN jsonb_typeof(gtc.analytes) = 'array' THEN gtc.analytes ELSE '[]'::jsonb END
       ) AS elem
  WHERE LOWER(TRIM(gtc.code)) = LOWER(TRIM(NEW.code))
    AND EXISTS (SELECT 1 FROM public.analytes WHERE id = (elem::text)::uuid)
  ON CONFLICT (test_group_id, analyte_id) DO NOTHING;

  GET DIAGNOSTICS v_linked = ROW_COUNT;
  IF v_linked > 0 THEN
    NEW.analyte_count := v_linked;
    RAISE NOTICE 'Auto-linked % analytes from JSONB fallback for new test group % (%)', v_linked, NEW.name, NEW.code;
    RETURN NEW;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- STRATEGY B: Copy from sibling in same lab (same name)
  -- ──────────────────────────────────────────────────────────────────────────
  SELECT id INTO v_source_tg_id
  FROM test_groups
  WHERE lab_id = NEW.lab_id
    AND LOWER(TRIM(name)) = LOWER(TRIM(NEW.name))
    AND id != NEW.id AND analyte_count > 0
  ORDER BY analyte_count DESC, created_at ASC LIMIT 1;

  IF v_source_tg_id IS NOT NULL THEN
    INSERT INTO test_group_analytes (
      test_group_id, analyte_id,
      sort_order, display_order, is_visible,
      is_header, header_name, section_heading,
      custom_reference_range, attachment_required
    )
    SELECT
      NEW.id, tga.analyte_id,
      tga.sort_order, tga.display_order, tga.is_visible,
      tga.is_header, tga.header_name, tga.section_heading,
      tga.custom_reference_range, tga.attachment_required
    FROM test_group_analytes tga WHERE tga.test_group_id = v_source_tg_id
    ON CONFLICT (test_group_id, analyte_id) DO NOTHING;

    GET DIAGNOSTICS v_linked = ROW_COUNT;
    IF v_linked > 0 THEN
      NEW.analyte_count := v_linked;
      RAISE NOTICE 'Auto-linked % analytes from sibling for new test group %', v_linked, NEW.name;
      RETURN NEW;
    END IF;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- STRATEGY C: Copy from ANY lab with same code
  -- ──────────────────────────────────────────────────────────────────────────
  SELECT id INTO v_source_tg_id
  FROM test_groups
  WHERE LOWER(TRIM(code)) = LOWER(TRIM(NEW.code))
    AND id != NEW.id AND analyte_count > 0
  ORDER BY analyte_count DESC, created_at ASC LIMIT 1;

  IF v_source_tg_id IS NOT NULL THEN
    INSERT INTO test_group_analytes (
      test_group_id, analyte_id,
      sort_order, display_order, is_visible,
      is_header, header_name, section_heading,
      custom_reference_range, attachment_required
    )
    SELECT
      NEW.id, tga.analyte_id,
      tga.sort_order, tga.display_order, tga.is_visible,
      tga.is_header, tga.header_name, tga.section_heading,
      tga.custom_reference_range, tga.attachment_required
    FROM test_group_analytes tga WHERE tga.test_group_id = v_source_tg_id
    ON CONFLICT (test_group_id, analyte_id) DO NOTHING;

    GET DIAGNOSTICS v_linked = ROW_COUNT;
    IF v_linked > 0 THEN
      NEW.analyte_count := v_linked;
      RAISE NOTICE 'Auto-linked % analytes from cross-lab match for new test group %', v_linked, NEW.name;
      RETURN NEW;
    END IF;
  END IF;

  RAISE NOTICE 'New test group % (%) created with 0 analytes. No auto-link source found.', NEW.name, NEW.code;
  RETURN NEW;
END;
$function$;
