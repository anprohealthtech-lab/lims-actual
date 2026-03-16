-- =====================================================
-- FIX: Correct UUID cast in orphan recovery triggers
-- =====================================================
-- Bug: (elem::text)::uuid includes JSON string quotes, producing
--      "978634c6-..." instead of 978634c6-...
-- Fix: use (elem #>> '{}')::uuid to extract the raw text value
-- =====================================================

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
  v_linked integer := 0;
  v_has_orders boolean;
  v_has_results boolean;
  v_global_analytes jsonb;
  v_source_tg_id uuid;
  v_analyte_id uuid;
BEGIN
  -- Only act on DELETE (analyte was removed from a test group)
  v_test_group_id := OLD.test_group_id;

  -- Get current count
  SELECT analyte_count, name, code, lab_id
  INTO v_analyte_count, v_test_group_name, v_test_group_code, v_lab_id
  FROM test_groups
  WHERE id = v_test_group_id;

  -- Only proceed if count is now 0
  IF v_analyte_count IS NULL OR v_analyte_count > 0 THEN
    RETURN OLD;
  END IF;

  -- Double-check with actual count (in case trigger order differs)
  SELECT COUNT(*) INTO v_analyte_count
  FROM test_group_analytes
  WHERE test_group_id = v_test_group_id;

  IF v_analyte_count > 0 THEN
    RETURN OLD;
  END IF;

  RAISE NOTICE 'Test group % (%) has 0 analytes. Attempting auto-link...', v_test_group_name, v_test_group_id;

  -- ==========================================
  -- STRATEGY A: Link from global_test_catalog
  -- ==========================================
  SELECT analytes INTO v_global_analytes
  FROM global_test_catalog
  WHERE LOWER(TRIM(code)) = LOWER(TRIM(v_test_group_code))
  LIMIT 1;

  IF v_global_analytes IS NOT NULL AND jsonb_array_length(v_global_analytes) > 0 THEN
    INSERT INTO test_group_analytes (test_group_id, analyte_id, display_order, is_visible)
    SELECT
      v_test_group_id,
      (elem #>> '{}')::uuid,   -- FIX: use #>> '{}' to extract text without JSON quotes
      ROW_NUMBER() OVER ()::integer,
      true
    FROM jsonb_array_elements(v_global_analytes) AS elem
    WHERE (elem #>> '{}') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      AND EXISTS (SELECT 1 FROM analytes WHERE id = (elem #>> '{}')::uuid)
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_linked = ROW_COUNT;

    IF v_linked > 0 THEN
      RAISE NOTICE 'Linked % analytes from global_test_catalog for test group %', v_linked, v_test_group_name;
      UPDATE test_groups SET analyte_count = v_linked, updated_at = NOW() WHERE id = v_test_group_id;
      RETURN OLD;
    END IF;
  END IF;

  -- ==========================================
  -- STRATEGY B: Copy from sibling in same lab (same name)
  -- ==========================================
  SELECT id INTO v_source_tg_id
  FROM test_groups
  WHERE lab_id = v_lab_id
    AND LOWER(TRIM(name)) = LOWER(TRIM(v_test_group_name))
    AND id != v_test_group_id
    AND analyte_count > 0
  ORDER BY analyte_count DESC, created_at ASC
  LIMIT 1;

  IF v_source_tg_id IS NOT NULL THEN
    INSERT INTO test_group_analytes (test_group_id, analyte_id, display_order, is_visible, is_header, header_name, custom_reference_range, attachment_required)
    SELECT
      v_test_group_id,
      tga.analyte_id,
      tga.display_order,
      tga.is_visible,
      tga.is_header,
      tga.header_name,
      tga.custom_reference_range,
      tga.attachment_required
    FROM test_group_analytes tga
    WHERE tga.test_group_id = v_source_tg_id
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_linked = ROW_COUNT;

    IF v_linked > 0 THEN
      RAISE NOTICE 'Linked % analytes from sibling test group (same lab, same name) for %', v_linked, v_test_group_name;
      UPDATE test_groups SET analyte_count = v_linked, updated_at = NOW() WHERE id = v_test_group_id;
      RETURN OLD;
    END IF;
  END IF;

  -- ==========================================
  -- STRATEGY C: Copy from ANY lab with same code
  -- ==========================================
  SELECT id INTO v_source_tg_id
  FROM test_groups
  WHERE LOWER(TRIM(code)) = LOWER(TRIM(v_test_group_code))
    AND id != v_test_group_id
    AND analyte_count > 0
  ORDER BY analyte_count DESC, created_at ASC
  LIMIT 1;

  IF v_source_tg_id IS NOT NULL THEN
    INSERT INTO test_group_analytes (test_group_id, analyte_id, display_order, is_visible, is_header, header_name, custom_reference_range, attachment_required)
    SELECT
      v_test_group_id,
      tga.analyte_id,
      tga.display_order,
      tga.is_visible,
      tga.is_header,
      tga.header_name,
      tga.custom_reference_range,
      tga.attachment_required
    FROM test_group_analytes tga
    WHERE tga.test_group_id = v_source_tg_id
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_linked = ROW_COUNT;

    IF v_linked > 0 THEN
      RAISE NOTICE 'Linked % analytes from test group in another lab (same code) for %', v_linked, v_test_group_name;
      UPDATE test_groups SET analyte_count = v_linked, updated_at = NOW() WHERE id = v_test_group_id;
      RETURN OLD;
    END IF;
  END IF;

  -- ==========================================
  -- NO SOURCE FOUND: Check if safe to delete
  -- ==========================================
  SELECT
    EXISTS (SELECT 1 FROM order_test_groups WHERE test_group_id = v_test_group_id),
    EXISTS (SELECT 1 FROM results WHERE test_group_id = v_test_group_id)
  INTO v_has_orders, v_has_results;

  IF NOT v_has_orders AND NOT v_has_results THEN
    RAISE NOTICE 'No analyte source found and no orders/results. Deleting orphan test group: % (%)', v_test_group_name, v_test_group_id;

    DELETE FROM account_prices WHERE test_group_id = v_test_group_id;
    DELETE FROM package_test_groups WHERE test_group_id = v_test_group_id;
    DELETE FROM test_workflow_map WHERE test_group_id = v_test_group_id;
    DELETE FROM location_test_prices WHERE test_group_id = v_test_group_id;
    DELETE FROM outsourced_lab_prices WHERE test_group_id = v_test_group_id;
    DELETE FROM lab_templates WHERE test_group_id = v_test_group_id;
    DELETE FROM lab_template_sections WHERE test_group_id = v_test_group_id;
    DELETE FROM test_catalog_embeddings WHERE test_group_id = v_test_group_id;
    DELETE FROM test_mappings WHERE test_group_id = v_test_group_id;
    DELETE FROM doctor_test_sharing WHERE test_group_id = v_test_group_id;
    DELETE FROM workflow_ai_configs WHERE test_group_id = v_test_group_id;
    DELETE FROM workflow_versions WHERE test_group_id = v_test_group_id;
    DELETE FROM ai_prompts WHERE test_id = v_test_group_id;
    DELETE FROM calibration_records WHERE test_group_id = v_test_group_id;
    DELETE FROM inventory_test_mapping WHERE test_group_id = v_test_group_id;
    DELETE FROM qc_analyzer_coverage WHERE test_group_id = v_test_group_id;
    DELETE FROM qc_target_values WHERE test_group_id = v_test_group_id;
    DELETE FROM order_tests WHERE test_group_id = v_test_group_id;
    DELETE FROM order_test_groups WHERE test_group_id = v_test_group_id;

    DELETE FROM test_groups WHERE id = v_test_group_id;
  ELSE
    RAISE WARNING 'Orphan test group % (%) has orders/results but NO analytes. Needs manual review!', v_test_group_name, v_test_group_id;
  END IF;

  RETURN OLD;
END;
$function$;

-- =====================================================
-- Also fix the same cast bug in auto_link_new_test_group
-- =====================================================

CREATE OR REPLACE FUNCTION public.auto_link_new_test_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_linked integer := 0;
  v_global_analytes jsonb;
  v_source_tg_id uuid;
BEGIN
  -- Skip if analytes already exist (e.g., bulk insert scenario)
  IF EXISTS (SELECT 1 FROM test_group_analytes WHERE test_group_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Cannot proceed without lab_id
  IF NEW.lab_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- ==========================================
  -- STRATEGY A: Link from global_test_catalog by code
  -- ==========================================
  SELECT analytes INTO v_global_analytes
  FROM global_test_catalog
  WHERE LOWER(TRIM(code)) = LOWER(TRIM(NEW.code))
  LIMIT 1;

  IF v_global_analytes IS NOT NULL AND jsonb_array_length(v_global_analytes) > 0 THEN
    INSERT INTO test_group_analytes (test_group_id, analyte_id, display_order, is_visible)
    SELECT
      NEW.id,
      (elem #>> '{}')::uuid,   -- FIX: use #>> '{}' to extract text without JSON quotes
      ROW_NUMBER() OVER ()::integer,
      true
    FROM jsonb_array_elements(v_global_analytes) AS elem
    WHERE (elem #>> '{}') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      AND EXISTS (SELECT 1 FROM analytes WHERE id = (elem #>> '{}')::uuid)
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_linked = ROW_COUNT;

    IF v_linked > 0 THEN
      NEW.analyte_count := v_linked;
      RAISE NOTICE 'Auto-linked % analytes from global catalog for new test group % (%)', v_linked, NEW.name, NEW.code;
      RETURN NEW;
    END IF;
  END IF;

  -- ==========================================
  -- STRATEGY B: Copy from sibling in same lab (same name)
  -- ==========================================
  SELECT id INTO v_source_tg_id
  FROM test_groups
  WHERE lab_id = NEW.lab_id
    AND LOWER(TRIM(name)) = LOWER(TRIM(NEW.name))
    AND id != NEW.id
    AND analyte_count > 0
  ORDER BY analyte_count DESC, created_at ASC
  LIMIT 1;

  IF v_source_tg_id IS NOT NULL THEN
    INSERT INTO test_group_analytes (test_group_id, analyte_id, display_order, is_visible, is_header, header_name, custom_reference_range, attachment_required)
    SELECT
      NEW.id,
      tga.analyte_id,
      tga.display_order,
      tga.is_visible,
      tga.is_header,
      tga.header_name,
      tga.custom_reference_range,
      tga.attachment_required
    FROM test_group_analytes tga
    WHERE tga.test_group_id = v_source_tg_id
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_linked = ROW_COUNT;

    IF v_linked > 0 THEN
      NEW.analyte_count := v_linked;
      RAISE NOTICE 'Auto-linked % analytes from sibling for new test group %', v_linked, NEW.name;
      RETURN NEW;
    END IF;
  END IF;

  -- ==========================================
  -- STRATEGY C: Copy from ANY lab with same code
  -- ==========================================
  SELECT id INTO v_source_tg_id
  FROM test_groups
  WHERE LOWER(TRIM(code)) = LOWER(TRIM(NEW.code))
    AND id != NEW.id
    AND analyte_count > 0
  ORDER BY analyte_count DESC, created_at ASC
  LIMIT 1;

  IF v_source_tg_id IS NOT NULL THEN
    INSERT INTO test_group_analytes (test_group_id, analyte_id, display_order, is_visible, is_header, header_name, custom_reference_range, attachment_required)
    SELECT
      NEW.id,
      tga.analyte_id,
      tga.display_order,
      tga.is_visible,
      tga.is_header,
      tga.header_name,
      tga.custom_reference_range,
      tga.attachment_required
    FROM test_group_analytes tga
    WHERE tga.test_group_id = v_source_tg_id
    ON CONFLICT DO NOTHING;

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
