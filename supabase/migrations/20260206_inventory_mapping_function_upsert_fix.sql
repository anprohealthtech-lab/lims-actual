-- ============================================================================
-- Make fn_inventory_create_ai_mapping handle analyte-level upsert correctly
-- Migration: 20260206_inventory_mapping_function_upsert_fix.sql
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
  IF p_analyte_id IS NOT NULL THEN
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
    ON CONFLICT (analyte_id, item_id)
    DO UPDATE SET
      test_group_id = EXCLUDED.test_group_id,
      quantity_per_test = EXCLUDED.quantity_per_test,
      ai_confidence = EXCLUDED.ai_confidence,
      ai_reasoning = EXCLUDED.ai_reasoning,
      ai_mapped_at = now(),
      updated_at = now(),
      is_active = true
    RETURNING id INTO v_mapping_id;
  ELSE
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
      NULL,
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
      updated_at = now(),
      is_active = true
    RETURNING id INTO v_mapping_id;
  END IF;

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
    'test_group_id', p_test_group_id,
    'analyte_id', p_analyte_id
  );
END;
$$;
