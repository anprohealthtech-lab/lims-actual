-- ============================================================================
-- Allow explicit QC-only inventory consumption scope
-- ============================================================================

ALTER TABLE public.inventory_items
  DROP CONSTRAINT IF EXISTS inventory_items_consumption_scope_check;

ALTER TABLE public.inventory_items
  ADD CONSTRAINT inventory_items_consumption_scope_check
  CHECK (
    consumption_scope = ANY (
      ARRAY[
        'per_test'::text,
        'per_sample'::text,
        'per_order'::text,
        'general'::text,
        'manual'::text,
        'qc_only'::text
      ]
    )
  );

COMMENT ON COLUMN public.inventory_items.consumption_scope IS
'Inventory event that should auto-consume the item: per_test, per_sample, per_order, qc_only, general, manual';
