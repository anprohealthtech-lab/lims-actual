-- ============================================================================
-- Inventory Fixes + Location Scoping
-- Migration: 20260204_inventory_location_and_fixes.sql
--
-- Changes (no new tables):
-- 1) Fix stock update logic for in/out/adjust
-- 2) Add location_id to inventory tables
-- 3) Add priority + location_id to helper views
-- 4) Strengthen SECURITY DEFINER functions with auth checks
-- 5) Update RLS to honor lab location restrictions
-- ============================================================================

-- =============================================================================
-- PART 1: Add location_id columns
-- =============================================================================

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id);

ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id);

ALTER TABLE public.stock_alerts
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id);

-- Backfill inventory_items.location_id from lab default processing location
UPDATE public.inventory_items i
SET location_id = l.default_processing_location_id
FROM public.labs l
WHERE i.lab_id = l.id
  AND i.location_id IS NULL
  AND l.default_processing_location_id IS NOT NULL;

-- Backfill transaction/alerts location_id from item
UPDATE public.inventory_transactions t
SET location_id = i.location_id
FROM public.inventory_items i
WHERE t.item_id = i.id
  AND t.location_id IS NULL;

UPDATE public.stock_alerts s
SET location_id = i.location_id
FROM public.inventory_items i
WHERE s.item_id = i.id
  AND s.location_id IS NULL;

-- Indexes for location filtering
CREATE INDEX IF NOT EXISTS idx_inventory_items_location
  ON public.inventory_items(location_id) WHERE location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_location
  ON public.inventory_transactions(location_id) WHERE location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_alerts_location
  ON public.stock_alerts(location_id) WHERE location_id IS NOT NULL;

-- =============================================================================
-- PART 1B: Default location_id for new inventory_items (if missing)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_inventory_set_default_location()
RETURNS TRIGGER AS $$
DECLARE
  v_location_id uuid;
BEGIN
  IF NEW.location_id IS NULL THEN
    -- Prefer lab default processing location, otherwise first location created for lab
    SELECT l.default_processing_location_id
    INTO v_location_id
    FROM public.labs l
    WHERE l.id = NEW.lab_id;

    IF v_location_id IS NULL THEN
      SELECT loc.id
      INTO v_location_id
      FROM public.locations loc
      WHERE loc.lab_id = NEW.lab_id
      ORDER BY loc.created_at ASC
      LIMIT 1;
    END IF;

    NEW.location_id := v_location_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_set_default_location ON public.inventory_items;
CREATE TRIGGER trg_inventory_set_default_location
BEFORE INSERT OR UPDATE ON public.inventory_items
FOR EACH ROW
EXECUTE FUNCTION public.fn_inventory_set_default_location();

-- =============================================================================
-- PART 2: Fix stock update trigger logic + set location_id on transactions
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_inventory_update_stock()
RETURNS TRIGGER AS $$
DECLARE
  v_stock_before numeric;
  v_item_location uuid;
  v_stock_after numeric;
BEGIN
  SELECT current_stock, location_id
  INTO v_stock_before, v_item_location
  FROM public.inventory_items
  WHERE id = NEW.item_id;

  NEW.stock_before := v_stock_before;

  -- Ensure quantity is positive for in/out (UI sends positive values)
  IF NEW.type IN ('in', 'out') THEN
    NEW.quantity := abs(NEW.quantity);
  END IF;

  -- Calculate stock_after based on transaction type
  IF NEW.type = 'in' THEN
    v_stock_after := v_stock_before + NEW.quantity;
  ELSIF NEW.type = 'out' THEN
    v_stock_after := v_stock_before - NEW.quantity;
  ELSE
    -- adjust = absolute stock set
    v_stock_after := NEW.quantity;
  END IF;

  -- Set location_id on transaction if missing (use item location)
  IF NEW.location_id IS NULL THEN
    NEW.location_id := v_item_location;
  END IF;

  -- Update item stock + metadata
  UPDATE public.inventory_items
  SET
    current_stock = v_stock_after,
    batch_number = CASE
      WHEN NEW.type = 'in' THEN COALESCE(NEW.batch_number, batch_number)
      ELSE batch_number
    END,
    expiry_date = CASE
      WHEN NEW.type = 'in'
       AND NEW.expiry_date IS NOT NULL
       AND (expiry_date IS NULL OR NEW.expiry_date < expiry_date)
      THEN NEW.expiry_date
      ELSE expiry_date
    END,
    unit_price = CASE
      WHEN NEW.type = 'in' THEN COALESCE(NEW.unit_price, unit_price)
      ELSE unit_price
    END,
    updated_at = now()
  WHERE id = NEW.item_id;

  NEW.stock_after := v_stock_after;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- PART 3: Include location_id in alerts
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_inventory_check_alerts()
RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
BEGIN
  SELECT * INTO v_item
  FROM public.inventory_items
  WHERE id = NEW.item_id;

  IF NOT FOUND OR NOT v_item.is_active THEN
    RETURN NEW;
  END IF;

  IF v_item.current_stock <= 0 THEN
    INSERT INTO public.stock_alerts (lab_id, item_id, location_id, type, message, current_value, threshold_value)
    VALUES (
      v_item.lab_id,
      v_item.id,
      v_item.location_id,
      'out_of_stock',
      v_item.name || ' is OUT OF STOCK!',
      v_item.current_stock,
      0
    )
    ON CONFLICT DO NOTHING;
  ELSIF v_item.min_stock > 0 AND v_item.current_stock <= v_item.min_stock THEN
    INSERT INTO public.stock_alerts (lab_id, item_id, location_id, type, message, current_value, threshold_value)
    VALUES (
      v_item.lab_id,
      v_item.id,
      v_item.location_id,
      'low_stock',
      v_item.name || ' is running low (' || v_item.current_stock || ' ' || v_item.unit || ' remaining)',
      v_item.current_stock,
      v_item.min_stock
    )
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_item.current_stock > 0 THEN
    UPDATE public.stock_alerts
    SET status = 'resolved', resolved_at = now()
    WHERE item_id = v_item.id AND type = 'out_of_stock' AND status = 'active';
  END IF;

  IF v_item.min_stock > 0 AND v_item.current_stock > v_item.min_stock THEN
    UPDATE public.stock_alerts
    SET status = 'resolved', resolved_at = now()
    WHERE item_id = v_item.id AND type = 'low_stock' AND status = 'active';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- PART 4: Update helper views (add location_id + priority)
-- =============================================================================

-- Drop views first to avoid column rename errors
DROP VIEW IF EXISTS public.v_inventory_attention;
DROP VIEW IF EXISTS public.v_inventory_with_tests;
DROP VIEW IF EXISTS public.v_inventory_consumption_summary;

CREATE OR REPLACE VIEW public.v_inventory_attention AS
SELECT
  i.id,
  i.lab_id,
  i.location_id,
  i.name,
  i.code,
  i.type,
  i.current_stock,
  i.unit,
  i.min_stock,
  i.expiry_date,
  i.unit_price,
  i.supplier_name,
  i.consumption_scope,
  i.consumption_per_use,
  i.pack_contains,
  CASE
    WHEN i.pack_contains IS NOT NULL AND i.consumption_per_use > 0
    THEN FLOOR((i.current_stock * i.pack_contains) / i.consumption_per_use)
    WHEN i.consumption_per_use > 0
    THEN FLOOR(i.current_stock / i.consumption_per_use)
    ELSE i.current_stock
  END AS tests_remaining,
  CASE
    WHEN i.current_stock <= 0 THEN 'out_of_stock'
    WHEN i.current_stock <= i.min_stock THEN 'low_stock'
    ELSE 'normal'
  END AS stock_status,
  CASE
    WHEN i.expiry_date IS NULL THEN NULL
    WHEN i.expiry_date < CURRENT_DATE THEN 'expired'
    WHEN i.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'expiring_soon'
    ELSE 'ok'
  END AS expiry_status,
  i.expiry_date - CURRENT_DATE AS days_to_expiry,
  CASE
    WHEN i.current_stock <= 0 THEN 1
    WHEN i.expiry_date IS NOT NULL AND i.expiry_date < CURRENT_DATE THEN 2
    WHEN i.current_stock <= i.min_stock THEN 3
    WHEN i.expiry_date IS NOT NULL AND i.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 4
    ELSE 5
  END AS priority
FROM public.inventory_items i
WHERE i.is_active = true
  AND (
    i.current_stock <= COALESCE(i.min_stock, 0)
    OR i.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
  )
ORDER BY
  priority,
  i.expiry_date NULLS LAST,
  i.current_stock;

CREATE OR REPLACE VIEW public.v_inventory_with_tests AS
SELECT
  i.*,
  CASE
    WHEN i.pack_contains IS NOT NULL AND i.consumption_per_use > 0
    THEN FLOOR((i.current_stock * i.pack_contains) / i.consumption_per_use)
    WHEN i.consumption_per_use > 0
    THEN FLOOR(i.current_stock / i.consumption_per_use)
    ELSE i.current_stock
  END AS tests_remaining,
  CASE
    WHEN i.current_stock <= 0 THEN 'out_of_stock'
    WHEN i.min_stock > 0 AND i.current_stock <= i.min_stock THEN 'low_stock'
    ELSE 'normal'
  END AS stock_status
FROM public.inventory_items i
WHERE i.is_active = true;

CREATE OR REPLACE VIEW public.v_inventory_consumption_summary AS
SELECT
  i.id AS item_id,
  i.lab_id,
  i.location_id,
  i.name,
  i.code,
  i.current_stock,
  i.unit,
  i.consumption_scope,
  i.consumption_per_use,
  i.pack_contains,
  CASE
    WHEN i.pack_contains IS NOT NULL AND i.consumption_per_use > 0
    THEN FLOOR((i.current_stock * i.pack_contains) / i.consumption_per_use)
    WHEN i.consumption_per_use > 0
    THEN FLOOR(i.current_stock / i.consumption_per_use)
    ELSE i.current_stock
  END AS tests_remaining,
  COUNT(DISTINCT m.test_group_id) FILTER (WHERE m.test_group_id IS NOT NULL) AS mapped_tests_count,
  COUNT(DISTINCT m.analyte_id) FILTER (WHERE m.analyte_id IS NOT NULL) AS mapped_analytes_count,
  COALESCE(SUM(ABS(t.quantity)) FILTER (
    WHERE t.type = 'out'
    AND t.created_at >= CURRENT_DATE - INTERVAL '30 days'
  ), 0) AS consumption_30_days,
  COALESCE(SUM(ABS(t.quantity)) FILTER (
    WHERE t.type = 'out'
    AND t.created_at >= CURRENT_DATE - INTERVAL '7 days'
  ), 0) AS consumption_7_days,
  CASE
    WHEN SUM(ABS(t.quantity)) FILTER (WHERE t.type = 'out' AND t.created_at >= CURRENT_DATE - INTERVAL '30 days') > 0
    THEN ROUND(i.current_stock / (SUM(ABS(t.quantity)) FILTER (WHERE t.type = 'out' AND t.created_at >= CURRENT_DATE - INTERVAL '30 days') / 30.0), 1)
    ELSE NULL
  END AS estimated_days_remaining
FROM public.inventory_items i
LEFT JOIN public.inventory_test_mapping m ON m.item_id = i.id AND m.is_active = true
LEFT JOIN public.inventory_transactions t ON t.item_id = i.id
WHERE i.is_active = true
GROUP BY i.id, i.lab_id, i.location_id, i.name, i.code, i.current_stock, i.unit,
         i.consumption_scope, i.consumption_per_use, i.pack_contains;

-- =============================================================================
-- PART 5: Strengthen SECURITY DEFINER functions
-- =============================================================================

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
  -- Allow service_role (edge functions)
  IF auth.role() <> 'service_role' THEN
    SELECT lab_id INTO v_user_lab
    FROM public.users
    WHERE auth_user_id = auth.uid();

    IF v_user_lab IS NULL OR v_user_lab <> p_lab_id THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'total_items', COUNT(*) FILTER (WHERE is_active),
    'out_of_stock', COUNT(*) FILTER (WHERE is_active AND current_stock <= 0),
    'low_stock', COUNT(*) FILTER (WHERE is_active AND current_stock > 0 AND current_stock <= min_stock),
    'expiring_soon', COUNT(*) FILTER (WHERE is_active AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'),
    'expired', COUNT(*) FILTER (WHERE is_active AND expiry_date < CURRENT_DATE),
    'total_value', COALESCE(SUM(current_stock * COALESCE(unit_price, 0)) FILTER (WHERE is_active), 0)
  ) INTO v_result
  FROM public.inventory_items
  WHERE lab_id = p_lab_id
    AND (p_location_id IS NULL OR location_id = p_location_id);

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_inventory_quick_add(
  p_lab_id uuid,
  p_item_name text,
  p_quantity numeric,
  p_unit text DEFAULT 'pcs',
  p_reason text DEFAULT 'Purchase',
  p_ai_input jsonb DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_location_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item_id uuid;
  v_item_name text;
  v_transaction_id uuid;
  v_user_lab uuid;
  v_location_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    SELECT lab_id INTO v_user_lab
    FROM public.users
    WHERE auth_user_id = auth.uid();

    IF v_user_lab IS NULL OR v_user_lab <> p_lab_id THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  END IF;

  IF p_location_id IS NULL THEN
    SELECT default_processing_location_id INTO v_location_id
    FROM public.labs
    WHERE id = p_lab_id;
  ELSE
    v_location_id := p_location_id;
  END IF;

  SELECT id, name INTO v_item_id, v_item_name
  FROM public.inventory_items
  WHERE lab_id = p_lab_id
    AND (
      LOWER(name) = LOWER(p_item_name)
      OR LOWER(code) = LOWER(p_item_name)
    )
    AND is_active = true
  LIMIT 1;

  IF v_item_id IS NULL THEN
    INSERT INTO public.inventory_items (lab_id, location_id, name, unit, current_stock, created_by)
    VALUES (p_lab_id, v_location_id, p_item_name, p_unit, 0, p_user_id)
    RETURNING id, name INTO v_item_id, v_item_name;
  END IF;

  INSERT INTO public.inventory_transactions (
    lab_id, item_id, location_id, type, quantity, reason, ai_input, performed_by
  )
  VALUES (
    p_lab_id, v_item_id, v_location_id, 'in', p_quantity, p_reason, p_ai_input, p_user_id
  )
  RETURNING id INTO v_transaction_id;

  RETURN jsonb_build_object(
    'success', true,
    'item_id', v_item_id,
    'item_name', v_item_name,
    'quantity_added', p_quantity,
    'transaction_id', v_transaction_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_inventory_auto_consume(
  p_lab_id uuid,
  p_order_id uuid,
  p_result_id uuid,
  p_test_group_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_mapping RECORD;
  v_consumed integer := 0;
  v_alerts integer := 0;
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

  FOR v_mapping IN
    SELECT
      m.item_id,
      m.quantity_per_test,
      i.name AS item_name,
      i.current_stock,
      i.min_stock,
      i.unit,
      i.location_id
    FROM public.inventory_test_mapping m
    JOIN public.inventory_items i ON i.id = m.item_id
    WHERE m.test_group_id = p_test_group_id
      AND m.lab_id = p_lab_id
      AND m.is_active = true
      AND i.is_active = true
  LOOP
    INSERT INTO public.inventory_transactions (
      lab_id, item_id, location_id, type, quantity, reason,
      order_id, result_id, test_group_id, performed_by
    )
    VALUES (
      p_lab_id,
      v_mapping.item_id,
      v_mapping.location_id,
      'out',
      v_mapping.quantity_per_test,
      'Test consumption',
      p_order_id,
      p_result_id,
      p_test_group_id,
      p_user_id
    );

    v_consumed := v_consumed + 1;
  END LOOP;

  SELECT COUNT(*) INTO v_alerts
  FROM public.stock_alerts
  WHERE lab_id = p_lab_id
    AND status = 'active'
    AND created_at >= now() - INTERVAL '1 second';

  RETURN jsonb_build_object(
    'success', true,
    'items_consumed', v_consumed,
    'alerts_generated', v_alerts
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_inventory_consume_general(
  p_lab_id uuid,
  p_scope text,
  p_order_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item RECORD;
  v_consumed integer := 0;
  v_reason text;
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

  v_reason := COALESCE(p_reason, 'Auto-consumed: ' || p_scope);

  FOR v_item IN
    SELECT
      id,
      name,
      current_stock,
      consumption_per_use,
      unit,
      location_id
    FROM public.inventory_items
    WHERE lab_id = p_lab_id
      AND consumption_scope = p_scope
      AND is_active = true
      AND consumption_per_use > 0
      AND current_stock > 0
  LOOP
    INSERT INTO public.inventory_transactions (
      lab_id, item_id, location_id, type, quantity, reason, order_id, performed_by
    )
    VALUES (
      p_lab_id,
      v_item.id,
      v_item.location_id,
      'out',
      v_item.consumption_per_use,
      v_reason,
      p_order_id,
      p_user_id
    );

    v_consumed := v_consumed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'scope', p_scope,
    'items_consumed', v_consumed
  );
END;
$$;

-- Update grants (include new signature for dashboard stats + quick add)
GRANT EXECUTE ON FUNCTION public.fn_inventory_dashboard_stats(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_inventory_quick_add(uuid, text, numeric, text, text, jsonb, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_inventory_auto_consume(uuid, uuid, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_inventory_consume_general(uuid, text, uuid, text, uuid) TO authenticated;

-- =============================================================================
-- PART 6: Update RLS policies for location enforcement
-- =============================================================================

DROP POLICY IF EXISTS "inventory_items_lab_access" ON public.inventory_items;
DROP POLICY IF EXISTS "inventory_transactions_lab_access" ON public.inventory_transactions;
DROP POLICY IF EXISTS "stock_alerts_lab_access" ON public.stock_alerts;
DROP POLICY IF EXISTS "inventory_test_mapping_lab_access" ON public.inventory_test_mapping;
DROP POLICY IF EXISTS "inventory_suppliers_lab_access" ON public.inventory_suppliers;
DROP POLICY IF EXISTS "inventory_orders_lab_access" ON public.inventory_orders;

CREATE POLICY "inventory_items_location_access" ON public.inventory_items
  FOR ALL USING (
    lab_id IN (SELECT lab_id FROM public.users WHERE auth_user_id = auth.uid())
    AND (
      (SELECT enforce_location_restrictions FROM public.labs WHERE id = lab_id) = false
      OR EXISTS (
        SELECT 1
        FROM public.user_centers uc
        JOIN public.users u ON u.id = uc.user_id
        WHERE u.auth_user_id = auth.uid()
          AND (uc.can_view_all_locations = true OR uc.location_id = public.inventory_items.location_id)
      )
    )
  )
  WITH CHECK (
    lab_id IN (SELECT lab_id FROM public.users WHERE auth_user_id = auth.uid())
    AND (
      (SELECT enforce_location_restrictions FROM public.labs WHERE id = lab_id) = false
      OR EXISTS (
        SELECT 1
        FROM public.user_centers uc
        JOIN public.users u ON u.id = uc.user_id
        WHERE u.auth_user_id = auth.uid()
          AND (uc.can_view_all_locations = true OR uc.location_id = public.inventory_items.location_id)
      )
    )
  );

CREATE POLICY "inventory_transactions_location_access" ON public.inventory_transactions
  FOR ALL USING (
    lab_id IN (SELECT lab_id FROM public.users WHERE auth_user_id = auth.uid())
    AND (
      (SELECT enforce_location_restrictions FROM public.labs WHERE id = lab_id) = false
      OR EXISTS (
        SELECT 1
        FROM public.user_centers uc
        JOIN public.users u ON u.id = uc.user_id
        WHERE u.auth_user_id = auth.uid()
          AND (uc.can_view_all_locations = true OR uc.location_id = public.inventory_transactions.location_id)
      )
    )
  )
  WITH CHECK (
    lab_id IN (SELECT lab_id FROM public.users WHERE auth_user_id = auth.uid())
    AND (
      (SELECT enforce_location_restrictions FROM public.labs WHERE id = lab_id) = false
      OR EXISTS (
        SELECT 1
        FROM public.user_centers uc
        JOIN public.users u ON u.id = uc.user_id
        WHERE u.auth_user_id = auth.uid()
          AND (uc.can_view_all_locations = true OR uc.location_id = public.inventory_transactions.location_id)
      )
    )
  );

CREATE POLICY "stock_alerts_location_access" ON public.stock_alerts
  FOR ALL USING (
    lab_id IN (SELECT lab_id FROM public.users WHERE auth_user_id = auth.uid())
    AND (
      (SELECT enforce_location_restrictions FROM public.labs WHERE id = lab_id) = false
      OR EXISTS (
        SELECT 1
        FROM public.user_centers uc
        JOIN public.users u ON u.id = uc.user_id
        WHERE u.auth_user_id = auth.uid()
          AND (uc.can_view_all_locations = true OR uc.location_id = public.stock_alerts.location_id)
      )
    )
  )
  WITH CHECK (
    lab_id IN (SELECT lab_id FROM public.users WHERE auth_user_id = auth.uid())
    AND (
      (SELECT enforce_location_restrictions FROM public.labs WHERE id = lab_id) = false
      OR EXISTS (
        SELECT 1
        FROM public.user_centers uc
        JOIN public.users u ON u.id = uc.user_id
        WHERE u.auth_user_id = auth.uid()
          AND (uc.can_view_all_locations = true OR uc.location_id = public.stock_alerts.location_id)
      )
    )
  );

-- Keep these lab-scoped (no location dimension)
CREATE POLICY "inventory_test_mapping_lab_access" ON public.inventory_test_mapping
  FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE auth_user_id = auth.uid()));

CREATE POLICY "inventory_suppliers_lab_access" ON public.inventory_suppliers
  FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE auth_user_id = auth.uid()));

CREATE POLICY "inventory_orders_lab_access" ON public.inventory_orders
  FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE auth_user_id = auth.uid()));
