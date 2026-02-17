-- ============================================================================
-- Inventory PO Request Basics (AI-First, Lean)
-- Migration: 20260206_inventory_po_request_basics.sql
--
-- Goal:
-- 1) Add lightweight PO-request lifecycle fields
-- 2) Ensure order totals are computed from JSONB items
-- 3) Keep schema lean (no separate line-items table)
-- ============================================================================

-- 1) Add lightweight request metadata fields
ALTER TABLE public.inventory_orders
  ADD COLUMN IF NOT EXISTS ai_suggested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS request_source text,
  ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_note text;

COMMENT ON COLUMN public.inventory_orders.ai_suggested IS 'True when PO was created by AI reorder suggestions';
COMMENT ON COLUMN public.inventory_orders.request_source IS 'Source of request: low_stock_reorder, invoice_ocr, manual, voice';
COMMENT ON COLUMN public.inventory_orders.requested_at IS 'When PO request was created/submitted';
COMMENT ON COLUMN public.inventory_orders.approved_at IS 'When PO request was approved';

-- 2) Expand PO status lifecycle to support request flow
ALTER TABLE public.inventory_orders
  DROP CONSTRAINT IF EXISTS inventory_orders_status_check;

ALTER TABLE public.inventory_orders
  ADD CONSTRAINT inventory_orders_status_check
  CHECK (status IN ('draft', 'requested', 'approved', 'ordered', 'received', 'cancelled'));

-- 3) Ensure JSON format integrity for items payload
ALTER TABLE public.inventory_orders
  DROP CONSTRAINT IF EXISTS inventory_orders_items_is_array_check;

ALTER TABLE public.inventory_orders
  ADD CONSTRAINT inventory_orders_items_is_array_check
  CHECK (jsonb_typeof(items) = 'array');

-- 4) Compute subtotal/total from items JSON when not provided, and normalize requested_at
CREATE OR REPLACE FUNCTION public.fn_inventory_orders_normalize()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_subtotal numeric := 0;
  v_item jsonb;
  v_qty numeric;
  v_unit_price numeric;
BEGIN
  IF NEW.items IS NULL THEN
    NEW.items := '[]'::jsonb;
  END IF;

  IF jsonb_typeof(NEW.items) <> 'array' THEN
    RAISE EXCEPTION 'inventory_orders.items must be a JSON array';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.items)
  LOOP
    v_qty := COALESCE((v_item ->> 'quantity')::numeric, 0);
    v_unit_price := COALESCE((v_item ->> 'unit_price')::numeric, 0);

    IF v_qty < 0 THEN
      RAISE EXCEPTION 'inventory_orders.items[].quantity cannot be negative';
    END IF;

    IF v_unit_price < 0 THEN
      RAISE EXCEPTION 'inventory_orders.items[].unit_price cannot be negative';
    END IF;

    v_subtotal := v_subtotal + (v_qty * v_unit_price);
  END LOOP;

  IF NEW.subtotal IS NULL THEN
    NEW.subtotal := v_subtotal;
  END IF;

  IF NEW.tax_amount IS NULL THEN
    NEW.tax_amount := 0;
  END IF;

  IF NEW.total_amount IS NULL THEN
    NEW.total_amount := COALESCE(NEW.subtotal, 0) + COALESCE(NEW.tax_amount, 0);
  END IF;

  IF NEW.status = 'requested' AND NEW.requested_at IS NULL THEN
    NEW.requested_at := now();
  END IF;

  IF NEW.status = 'approved' AND NEW.approved_at IS NULL THEN
    NEW.approved_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_orders_normalize ON public.inventory_orders;
CREATE TRIGGER trg_inventory_orders_normalize
BEFORE INSERT OR UPDATE ON public.inventory_orders
FOR EACH ROW
EXECUTE FUNCTION public.fn_inventory_orders_normalize();

-- 5) Helper view for PO request queue
DROP VIEW IF EXISTS public.v_inventory_po_requests;
CREATE VIEW public.v_inventory_po_requests AS
SELECT
  o.id,
  o.lab_id,
  o.order_number,
  o.order_date,
  o.supplier_id,
  o.supplier_name,
  o.items,
  o.subtotal,
  o.tax_amount,
  o.total_amount,
  o.status,
  o.ai_suggested,
  o.request_source,
  o.requested_by,
  o.requested_at,
  o.approved_by,
  o.approved_at,
  o.invoice_number,
  o.invoice_date,
  o.received_at,
  o.notes,
  o.created_at,
  o.updated_at,
  jsonb_array_length(o.items) AS item_count
FROM public.inventory_orders o
WHERE o.status IN ('requested', 'approved', 'ordered')
ORDER BY o.requested_at DESC NULLS LAST, o.created_at DESC;

-- 6) Fix dashboard stats to include active_alerts_count (was missing in RPC output)
CREATE OR REPLACE FUNCTION public.fn_inventory_dashboard_stats(
  p_lab_id uuid,
  p_location_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
  v_user_lab uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    SELECT lab_id INTO v_user_lab
    FROM public.users
    WHERE auth_user_id = auth.uid();

    IF v_user_lab IS NULL OR v_user_lab <> p_lab_id THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'total_items', COUNT(*) FILTER (WHERE i.is_active),
    'out_of_stock', COUNT(*) FILTER (WHERE i.is_active AND i.current_stock <= 0),
    'low_stock', COUNT(*) FILTER (WHERE i.is_active AND i.current_stock > 0 AND i.current_stock <= i.min_stock),
    'expiring_soon', COUNT(*) FILTER (WHERE i.is_active AND i.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'),
    'expired', COUNT(*) FILTER (WHERE i.is_active AND i.expiry_date < CURRENT_DATE),
    'total_value', COALESCE(SUM(i.current_stock * COALESCE(i.unit_price, 0)) FILTER (WHERE i.is_active), 0),
    'active_alerts_count', (
      SELECT COUNT(*)
      FROM public.stock_alerts s
      WHERE s.lab_id = p_lab_id
        AND s.status = 'active'
        AND (p_location_id IS NULL OR s.location_id = p_location_id)
    )
  ) INTO v_result
  FROM public.inventory_items i
  WHERE i.lab_id = p_lab_id
    AND (p_location_id IS NULL OR i.location_id = p_location_id);

  RETURN v_result;
END;
$$;

