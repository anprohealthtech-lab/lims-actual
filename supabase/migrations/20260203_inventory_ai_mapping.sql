-- ============================================================================
-- AI-Powered Inventory-Test Mapping System
-- Migration: 20260203_inventory_ai_mapping.sql
--
-- Adds AI classification and mapping capabilities to inventory items
-- Phase 1: AI classifies items without test context
-- Phase 2: AI maps test-specific items to actual tests with consumption rules
-- ============================================================================

-- ============================================================================
-- PHASE 1: AI CLASSIFICATION COLUMNS
-- ============================================================================

-- Add AI classification columns to inventory_items
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS ai_category text
    CHECK (ai_category IN ('qc_control', 'test_specific', 'general', NULL)),
  ADD COLUMN IF NOT EXISTS ai_suggested_tests text[],
  ADD COLUMN IF NOT EXISTS ai_consumption_hint text,
  ADD COLUMN IF NOT EXISTS ai_classification_confidence numeric,
  ADD COLUMN IF NOT EXISTS ai_classification_status text DEFAULT 'pending'
    CHECK (ai_classification_status IN ('pending', 'classified', 'mapped', 'confirmed', 'skipped')),
  ADD COLUMN IF NOT EXISTS ai_classified_at timestamptz,
  ADD COLUMN IF NOT EXISTS primary_mapping_instruction text;

-- Add QC lot linkage for control items
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS qc_lot_id uuid REFERENCES public.qc_lots(id) ON DELETE SET NULL;

-- Comments
COMMENT ON COLUMN public.inventory_items.ai_category IS 'AI-classified category: qc_control (QC materials), test_specific (reagents/kits for tests), general (not test-linked)';
COMMENT ON COLUMN public.inventory_items.ai_suggested_tests IS 'AI-suggested test names (inference without test context)';
COMMENT ON COLUMN public.inventory_items.ai_consumption_hint IS 'AI-suggested consumption pattern, e.g., "1 kit = 100 tests"';
COMMENT ON COLUMN public.inventory_items.ai_classification_confidence IS 'Confidence score 0.0-1.0 for AI classification';
COMMENT ON COLUMN public.inventory_items.ai_classification_status IS 'pending → classified (Phase 1) → mapped (Phase 2) → confirmed (user verified)';
COMMENT ON COLUMN public.inventory_items.primary_mapping_instruction IS 'User hint to help AI classify/map this item';
COMMENT ON COLUMN public.inventory_items.qc_lot_id IS 'Link to QC lot for control/calibrator items';

-- Index for classification status
CREATE INDEX IF NOT EXISTS idx_inventory_items_ai_status
  ON public.inventory_items(lab_id, ai_classification_status)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_inventory_items_ai_category
  ON public.inventory_items(lab_id, ai_category)
  WHERE is_active = true AND ai_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_items_qc_lot
  ON public.inventory_items(qc_lot_id)
  WHERE qc_lot_id IS NOT NULL;

-- ============================================================================
-- PHASE 2: ENHANCED TEST MAPPING
-- ============================================================================

-- Add columns to inventory_test_mapping for better AI tracking
ALTER TABLE public.inventory_test_mapping
  ADD COLUMN IF NOT EXISTS ai_mapped_at timestamptz,
  ADD COLUMN IF NOT EXISTS user_confirmed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS user_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS user_confirmed_by uuid REFERENCES public.users(id);

COMMENT ON COLUMN public.inventory_test_mapping.ai_mapped_at IS 'When AI created this mapping';
COMMENT ON COLUMN public.inventory_test_mapping.user_confirmed IS 'True if user has verified this AI-suggested mapping';

-- ============================================================================
-- VIEW: Items pending AI classification
-- ============================================================================

CREATE OR REPLACE VIEW public.v_inventory_pending_classification AS
SELECT
  i.id,
  i.lab_id,
  i.name,
  i.code,
  i.type,
  i.current_stock,
  i.unit,
  i.consumption_scope,
  i.primary_mapping_instruction,
  i.ai_classification_status,
  i.ai_category,
  i.ai_suggested_tests,
  i.ai_consumption_hint,
  i.ai_classification_confidence,
  i.created_at
FROM public.inventory_items i
WHERE i.is_active = true
  AND (i.ai_classification_status = 'pending' OR i.ai_classification_status IS NULL)
ORDER BY i.created_at DESC;

-- ============================================================================
-- VIEW: Items classified but not mapped (ready for Phase 2)
-- ============================================================================

CREATE OR REPLACE VIEW public.v_inventory_pending_mapping AS
SELECT
  i.id,
  i.lab_id,
  i.name,
  i.code,
  i.type,
  i.current_stock,
  i.unit,
  i.ai_category,
  i.ai_suggested_tests,
  i.ai_consumption_hint,
  i.ai_classification_confidence,
  i.ai_classification_status,
  i.primary_mapping_instruction,
  i.consumption_scope,
  i.consumption_per_use,
  i.pack_contains,
  i.qc_lot_id,
  (SELECT COUNT(*) FROM public.inventory_test_mapping m WHERE m.item_id = i.id AND m.is_active = true) AS mapping_count
FROM public.inventory_items i
WHERE i.is_active = true
  AND i.ai_classification_status = 'classified'
  AND i.ai_category = 'test_specific'
ORDER BY i.ai_classification_confidence DESC, i.name;

-- ============================================================================
-- VIEW: Mapping summary with test names
-- ============================================================================

CREATE OR REPLACE VIEW public.v_inventory_mapping_summary AS
SELECT
  i.id AS item_id,
  i.lab_id,
  i.name AS item_name,
  i.code AS item_code,
  i.type AS item_type,
  i.ai_category,
  i.ai_classification_status,
  i.current_stock,
  i.unit,
  i.pack_contains,
  i.consumption_per_use,
  -- Aggregated mapping info
  COUNT(m.id) AS total_mappings,
  COUNT(m.id) FILTER (WHERE m.ai_suggested = true) AS ai_suggested_mappings,
  COUNT(m.id) FILTER (WHERE m.user_confirmed = true) AS confirmed_mappings,
  ARRAY_AGG(DISTINCT tg.name) FILTER (WHERE tg.name IS NOT NULL) AS mapped_test_names,
  ARRAY_AGG(DISTINCT a.name) FILTER (WHERE a.name IS NOT NULL) AS mapped_analyte_names,
  -- QC lot info
  i.qc_lot_id,
  ql.lot_number AS qc_lot_number,
  ql.material_name AS qc_material_name
FROM public.inventory_items i
LEFT JOIN public.inventory_test_mapping m ON m.item_id = i.id AND m.is_active = true
LEFT JOIN public.test_groups tg ON tg.id = m.test_group_id
LEFT JOIN public.analytes a ON a.id = m.analyte_id
LEFT JOIN public.qc_lots ql ON ql.id = i.qc_lot_id
WHERE i.is_active = true
GROUP BY i.id, i.lab_id, i.name, i.code, i.type, i.ai_category, i.ai_classification_status,
         i.current_stock, i.unit, i.pack_contains, i.consumption_per_use, i.qc_lot_id,
         ql.lot_number, ql.material_name;

-- ============================================================================
-- FUNCTION: Batch classify items (Phase 1)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_inventory_update_classification(
  p_item_id uuid,
  p_category text,
  p_suggested_tests text[],
  p_consumption_hint text,
  p_confidence numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.inventory_items
  SET
    ai_category = p_category,
    ai_suggested_tests = p_suggested_tests,
    ai_consumption_hint = p_consumption_hint,
    ai_classification_confidence = p_confidence,
    ai_classification_status = 'classified',
    ai_classified_at = now(),
    updated_at = now()
  WHERE id = p_item_id;

  RETURN jsonb_build_object(
    'success', true,
    'item_id', p_item_id,
    'category', p_category
  );
END;
$$;

-- ============================================================================
-- FUNCTION: Create AI-suggested mapping (Phase 2)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_inventory_create_ai_mapping(
  p_lab_id uuid,
  p_item_id uuid,
  p_test_group_id uuid,
  p_analyte_id uuid DEFAULT NULL,
  p_quantity_per_test numeric DEFAULT 1,
  p_confidence numeric DEFAULT NULL,
  p_reasoning text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_mapping_id uuid;
BEGIN
  -- Insert mapping
  INSERT INTO public.inventory_test_mapping (
    lab_id,
    item_id,
    test_group_id,
    analyte_id,
    quantity_per_test,
    ai_suggested,
    ai_confidence,
    ai_reasoning,
    ai_mapped_at,
    is_active
  )
  VALUES (
    p_lab_id,
    p_item_id,
    p_test_group_id,
    p_analyte_id,
    p_quantity_per_test,
    true,
    p_confidence,
    p_reasoning,
    now(),
    true
  )
  ON CONFLICT (test_group_id, item_id)
  DO UPDATE SET
    quantity_per_test = EXCLUDED.quantity_per_test,
    ai_confidence = EXCLUDED.ai_confidence,
    ai_reasoning = EXCLUDED.ai_reasoning,
    ai_mapped_at = now(),
    updated_at = now()
  RETURNING id INTO v_mapping_id;

  -- Update item status to mapped
  UPDATE public.inventory_items
  SET
    ai_classification_status = 'mapped',
    updated_at = now()
  WHERE id = p_item_id
    AND ai_classification_status = 'classified';

  RETURN jsonb_build_object(
    'success', true,
    'mapping_id', v_mapping_id,
    'item_id', p_item_id,
    'test_group_id', p_test_group_id
  );
END;
$$;

-- ============================================================================
-- FUNCTION: Link QC item to lot
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_inventory_link_qc_lot(
  p_item_id uuid,
  p_qc_lot_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.inventory_items
  SET
    qc_lot_id = p_qc_lot_id,
    ai_classification_status = CASE
      WHEN ai_classification_status IN ('classified', 'mapped') THEN 'mapped'
      ELSE ai_classification_status
    END,
    updated_at = now()
  WHERE id = p_item_id;

  RETURN jsonb_build_object(
    'success', true,
    'item_id', p_item_id,
    'qc_lot_id', p_qc_lot_id
  );
END;
$$;

-- ============================================================================
-- FUNCTION: Confirm AI mapping (user verification)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_inventory_confirm_mapping(
  p_mapping_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item_id uuid;
BEGIN
  -- Update mapping
  UPDATE public.inventory_test_mapping
  SET
    user_confirmed = true,
    user_confirmed_at = now(),
    user_confirmed_by = p_user_id,
    updated_at = now()
  WHERE id = p_mapping_id
  RETURNING item_id INTO v_item_id;

  -- Check if all mappings for this item are confirmed
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_test_mapping
    WHERE item_id = v_item_id
      AND is_active = true
      AND user_confirmed = false
  ) THEN
    -- All confirmed, update item status
    UPDATE public.inventory_items
    SET
      ai_classification_status = 'confirmed',
      updated_at = now()
    WHERE id = v_item_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'mapping_id', p_mapping_id,
    'item_id', v_item_id
  );
END;
$$;

-- ============================================================================
-- FUNCTION: Get items for batch classification
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_inventory_get_batch_for_classification(
  p_lab_id uuid,
  p_batch_size integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  name text,
  code text,
  type text,
  unit text,
  current_stock numeric,
  primary_mapping_instruction text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    i.id,
    i.name,
    i.code,
    i.type,
    i.unit,
    i.current_stock,
    i.primary_mapping_instruction
  FROM public.inventory_items i
  WHERE i.lab_id = p_lab_id
    AND i.is_active = true
    AND (i.ai_classification_status = 'pending' OR i.ai_classification_status IS NULL)
  ORDER BY i.created_at
  LIMIT p_batch_size;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.fn_inventory_update_classification(uuid, text, text[], text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_inventory_create_ai_mapping(uuid, uuid, uuid, uuid, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_inventory_link_qc_lot(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_inventory_confirm_mapping(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_inventory_get_batch_for_classification(uuid, integer) TO authenticated;

-- ============================================================================
-- COMMENT
-- ============================================================================

COMMENT ON FUNCTION public.fn_inventory_update_classification IS 'Phase 1: Update item with AI classification results';
COMMENT ON FUNCTION public.fn_inventory_create_ai_mapping IS 'Phase 2: Create AI-suggested test mapping';
COMMENT ON FUNCTION public.fn_inventory_link_qc_lot IS 'Link QC/control item to a QC lot';
COMMENT ON FUNCTION public.fn_inventory_confirm_mapping IS 'User confirms AI-suggested mapping';
COMMENT ON FUNCTION public.fn_inventory_get_batch_for_classification IS 'Get batch of items for AI classification';
