-- =====================================================
-- MIGRATION: Add analyte_count column + auto-link trigger
-- =====================================================
-- This migration:
--   1. Adds `analyte_count` column to test_groups (cached count)
--   2. Backfills it from existing test_group_analytes
--   3. Creates trigger on test_group_analytes to keep it in sync
--   4. Creates trigger: when analyte_count = 0, auto-link from
--      global_test_catalog or from a sibling test group, else delete
-- =====================================================

-- =====================================================
-- STEP 1: Add the column
-- =====================================================

ALTER TABLE public.test_groups
ADD COLUMN IF NOT EXISTS analyte_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.test_groups.analyte_count IS 'Cached count of linked analytes from test_group_analytes. Maintained by trigger.';

-- =====================================================
-- STEP 2: Backfill existing counts
-- =====================================================

UPDATE public.test_groups tg
SET analyte_count = sub.cnt
FROM (
  SELECT test_group_id, COUNT(*) AS cnt
  FROM test_group_analytes
  GROUP BY test_group_id
) sub
WHERE tg.id = sub.test_group_id;

-- =====================================================
-- STEP 3: Trigger to keep analyte_count in sync
-- =====================================================
-- Fires on INSERT/DELETE on test_group_analytes

CREATE OR REPLACE FUNCTION public.sync_test_group_analyte_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  target_id uuid;
BEGIN
  -- Determine which test_group_id was affected
  IF TG_OP = 'DELETE' THEN
    target_id := OLD.test_group_id;
  ELSIF TG_OP = 'INSERT' THEN
    target_id := NEW.test_group_id;
  ELSIF TG_OP = 'UPDATE' THEN
    -- If test_group_id changed, update both old and new
    IF OLD.test_group_id != NEW.test_group_id THEN
      UPDATE test_groups
      SET analyte_count = (SELECT COUNT(*) FROM test_group_analytes WHERE test_group_id = OLD.test_group_id),
          updated_at = NOW()
      WHERE id = OLD.test_group_id;
    END IF;
    target_id := NEW.test_group_id;
  END IF;

  -- Update the count
  UPDATE test_groups
  SET analyte_count = (SELECT COUNT(*) FROM test_group_analytes WHERE test_group_id = target_id),
      updated_at = NOW()
  WHERE id = target_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$;

-- Drop existing trigger if any
DROP TRIGGER IF EXISTS trg_sync_analyte_count ON public.test_group_analytes;

-- Create the trigger
CREATE TRIGGER trg_sync_analyte_count
AFTER INSERT OR DELETE OR UPDATE ON public.test_group_analytes
FOR EACH ROW
EXECUTE FUNCTION public.sync_test_group_analyte_count();

-- =====================================================
-- STEP 4: Trigger to auto-link orphan test groups
-- =====================================================
-- When analyte_count drops to 0 (after DELETE on test_group_analytes),
-- try to recover analytes from:
--   A) global_test_catalog (match by code)
--   B) sibling test group in same lab (match by name)
--   C) sibling test group in ANY lab (match by code)
-- If none found and test group has no orders/results, delete it.

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
    -- Insert analytes from global catalog
    INSERT INTO test_group_analytes (test_group_id, analyte_id, display_order, is_visible)
    SELECT 
      v_test_group_id,
      (elem::text)::uuid,    -- analytes stored as JSON array of UUID strings
      ROW_NUMBER() OVER ()::integer,
      true
    FROM jsonb_array_elements(v_global_analytes) AS elem
    WHERE EXISTS (SELECT 1 FROM analytes WHERE id = (elem::text)::uuid)  -- only if analyte exists
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_linked = ROW_COUNT;
    
    IF v_linked > 0 THEN
      RAISE NOTICE 'Linked % analytes from global_test_catalog for test group %', v_linked, v_test_group_name;
      -- Update the count
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
    
    -- Clean up child references before deleting
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
    
    -- Finally delete the test group
    DELETE FROM test_groups WHERE id = v_test_group_id;
  ELSE
    RAISE WARNING 'Orphan test group % (%) has orders/results but NO analytes. Needs manual review!', v_test_group_name, v_test_group_id;
  END IF;

  RETURN OLD;
END;
$function$;

-- Drop existing trigger if any
DROP TRIGGER IF EXISTS trg_auto_link_orphan ON public.test_group_analytes;

-- Create the trigger (fires AFTER the count sync trigger)
CREATE TRIGGER trg_auto_link_orphan
AFTER DELETE ON public.test_group_analytes
FOR EACH ROW
EXECUTE FUNCTION public.auto_link_or_delete_orphan_test_group();

-- =====================================================
-- STEP 5: Also handle new test groups created with 0 analytes
-- =====================================================
-- When a test group is INSERT'd, if it has 0 analytes after a short delay,
-- try to auto-link. (We use a deferred approach for new inserts)

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
      (elem::text)::uuid,
      ROW_NUMBER() OVER ()::integer,
      true
    FROM jsonb_array_elements(v_global_analytes) AS elem
    WHERE EXISTS (SELECT 1 FROM analytes WHERE id = (elem::text)::uuid)
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

-- Drop existing trigger if any
DROP TRIGGER IF EXISTS trg_auto_link_new_test_group ON public.test_groups;

-- Create trigger for new test groups (AFTER INSERT)
CREATE TRIGGER trg_auto_link_new_test_group
AFTER INSERT ON public.test_groups
FOR EACH ROW
EXECUTE FUNCTION public.auto_link_new_test_group();

-- =====================================================
-- STEP 6: Create index for fast orphan detection
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_test_groups_analyte_count 
ON public.test_groups (analyte_count) 
WHERE analyte_count = 0;

CREATE INDEX IF NOT EXISTS idx_test_groups_name_lower
ON public.test_groups (LOWER(TRIM(name)));

CREATE INDEX IF NOT EXISTS idx_test_groups_code_lower
ON public.test_groups (LOWER(TRIM(code)));

-- =====================================================
-- STEP 7: Verify
-- =====================================================

-- Check backfill worked
SELECT 
  'Verification' AS report,
  COUNT(*) AS total_test_groups,
  COUNT(*) FILTER (WHERE analyte_count > 0) AS with_analytes,
  COUNT(*) FILTER (WHERE analyte_count = 0) AS orphans
FROM test_groups;

-- Show orphans per lab
SELECT 
  l.name AS lab_name,
  tg.lab_id,
  COUNT(*) FILTER (WHERE tg.analyte_count = 0) AS orphan_count,
  COUNT(*) AS total_count
FROM test_groups tg
LEFT JOIN labs l ON l.id = tg.lab_id
GROUP BY l.name, tg.lab_id
HAVING COUNT(*) FILTER (WHERE tg.analyte_count = 0) > 0
ORDER BY orphan_count DESC;
