-- ============================================================================
-- AI-First Lean Inventory System for Small-Medium Diagnostic Labs
-- Migration: 20260202_inventory_lean.sql
--
-- Philosophy: Material is 15-25% of lab costs. Don't over-engineer.
-- Tables: 6 total (3 core + 3 optional)
-- ============================================================================

-- ============================================================================
-- CORE MODULE (Required) - 3 Tables
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. INVENTORY ITEMS - Single source of truth for all inventory
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,

  -- Basic Info (AI can auto-fill)
  name text NOT NULL,
  code text,                              -- Optional item code, AI can generate
  type text NOT NULL DEFAULT 'consumable'
    CHECK (type IN ('reagent', 'consumable', 'calibrator', 'control', 'general')),

  -- Stock Management (Simple!)
  current_stock numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'pcs',       -- pcs, ml, box, kit, test, L, g
  min_stock numeric DEFAULT 0,            -- Alert when stock falls below this

  -- Batch & Expiry (Simple - just current batch, not full batch tracking)
  batch_number text,                      -- Current batch/lot number in stock (AI extracts via OCR)
  expiry_date date,                       -- Nearest expiry date in current stock
  storage_temp text,                      -- "2-8°C", "Room Temp", "-20°C"
  storage_location text,                  -- "Fridge A", "Shelf B2"

  -- ==========================================================================
  -- CONSUMPTION RULES (Natural language rules for 80-90% accurate auto-consumption)
  -- ==========================================================================
  --
  -- Examples:
  -- | Item               | scope       | per_use | pack_contains | Behavior                              |
  -- |--------------------|-------------|---------|---------------|---------------------------------------|
  -- | Vacutainer         | per_sample  | 1       | 100           | 1 tube per sample, pack has 100       |
  -- | Pipette Tip        | per_test    | 1       | 1000          | 1 tip per test, box has 1000          |
  -- | Cover Slip         | per_test    | 1       | 100           | 1 slip per test, pack has 100         |
  -- | CBC Reagent (ml)   | per_test    | 0.5     | NULL          | 0.5 ml per test, track in ml          |
  -- | TSH Kit (20 tests) | per_test    | 1       | 20            | 1 test per test, kit has 20 tests     |
  -- | Urine Container    | per_sample  | 1       | 50            | 1 container per sample, pack has 50   |
  -- | Printer Paper      | general     | NULL    | NULL          | Manual consumption only               |
  --
  consumption_scope text DEFAULT 'manual'
    CHECK (consumption_scope IN (
      'per_test',      -- Consumed for each test (use mapping table for test-specific)
      'per_sample',    -- Consumed once per sample collected (vacutainer, container)
      'per_order',     -- Consumed once per order (general consumables)
      'general',       -- General lab use, not tied to tests (manual tracking)
      'manual'         -- No auto-consumption, manual entry only
    )),

  consumption_per_use numeric DEFAULT 1,  -- Amount consumed each time (1 tip, 0.5 ml, etc.)

  pack_contains numeric,                  -- Tests/uses per pack (20 for TSH kit, 100 for containers, NULL for ml-based)
  -- When pack_contains is set: tests_remaining = current_stock * pack_contains
  -- When NULL: use current_stock directly (for ml, L, g based items)

  -- Pricing (Simple - just track last price)
  unit_price numeric,                     -- Last purchase price per unit

  -- Supplier Info (Denormalized for simplicity)
  supplier_name text,                     -- Quick reference, no FK needed
  supplier_contact text,

  -- AI Data (Flexible JSONB for AI features)
  ai_data jsonb DEFAULT '{}'::jsonb,
  -- Stores: {
  --   "suggested_category": "...",
  --   "consumption_pattern": {...},
  --   "reorder_prediction": {...},
  --   "last_ai_analysis": "2026-01-15"
  -- }

  -- Meta
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id),

  -- Constraints
  CONSTRAINT inventory_items_lab_code_unique UNIQUE (lab_id, code)
);

-- Comments
COMMENT ON TABLE public.inventory_items IS 'Master inventory items - reagents, consumables, controls, etc.';
COMMENT ON COLUMN public.inventory_items.ai_data IS 'Flexible storage for AI suggestions, patterns, and analysis results';
COMMENT ON COLUMN public.inventory_items.min_stock IS 'Alert threshold - triggers low stock warning when current_stock falls below';
COMMENT ON COLUMN public.inventory_items.consumption_scope IS 'When item is consumed: per_test (test-specific via mapping), per_sample (every sample), per_order (every order), general (manual), manual (no auto)';
COMMENT ON COLUMN public.inventory_items.consumption_per_use IS 'Amount consumed each time (1 for discrete items, 0.5 for ml-based, etc.)';
COMMENT ON COLUMN public.inventory_items.pack_contains IS 'Tests/uses per pack. TSH kit with 20 tests = 20. NULL for ml/L/g based items where current_stock IS the usable amount';

-- ----------------------------------------------------------------------------
-- 2. INVENTORY TRANSACTIONS - Simple log of all stock movements
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,

  -- What happened (Simple: in, out, or adjust)
  type text NOT NULL CHECK (type IN ('in', 'out', 'adjust')),
  quantity numeric NOT NULL,              -- Positive for 'in', negative for 'out'

  -- Stock snapshot
  stock_before numeric,
  stock_after numeric,

  -- Context
  reason text,                            -- "Purchase", "Test: CBC", "Expired", "Damaged", "QC", "Adjustment"
  reference text,                         -- Invoice number, Order ID, etc.

  -- Batch info for this transaction (AI extracts via OCR when adding stock)
  batch_number text,                      -- Batch/lot number for this stock movement
  expiry_date date,                       -- Expiry date for this batch
  unit_price numeric,                     -- Price per unit for this transaction

  -- For consumption tracking (links to orders/tests)
  order_id uuid REFERENCES public.orders(id),
  result_id uuid REFERENCES public.results(id),
  test_group_id uuid REFERENCES public.test_groups(id),

  -- AI-parsed input (stores original voice/OCR input)
  ai_input jsonb,
  -- Stores: {
  --   "original_text": "Add 5 boxes CBC reagent",
  --   "input_type": "voice",
  --   "parsed_at": "2026-01-15T10:30:00Z",
  --   "confidence": 0.95
  -- }

  -- Meta
  performed_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Comments
COMMENT ON TABLE public.inventory_transactions IS 'Log of all stock movements - purchases, consumption, adjustments';
COMMENT ON COLUMN public.inventory_transactions.ai_input IS 'Original AI-parsed input (voice/OCR) for audit trail';

-- ----------------------------------------------------------------------------
-- 3. STOCK ALERTS - Auto-generated alerts for attention
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.stock_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,

  -- Alert type
  type text NOT NULL CHECK (type IN ('low_stock', 'out_of_stock', 'expiring', 'expired')),
  message text NOT NULL,

  -- Values for context
  current_value numeric,                  -- Current stock or days to expiry
  threshold_value numeric,                -- The threshold that was crossed

  -- AI recommendation
  ai_suggestion text,                     -- "Order 5 boxes from ABC Supplier, est. ₹2,500"

  -- Status
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dismissed', 'resolved')),

  -- Resolution tracking
  dismissed_by uuid REFERENCES public.users(id),
  dismissed_at timestamptz,
  resolved_at timestamptz,
  resolution_note text,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Comments
COMMENT ON TABLE public.stock_alerts IS 'Auto-generated alerts for low stock, out of stock, and expiring items';

-- ============================================================================
-- OPTIONAL MODULE: CONSUMPTION TRACKING - 1 Table
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 4. INVENTORY TEST MAPPING - Links tests/analytes to items consumed
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.inventory_test_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,

  -- The mapping (can be at test_group OR analyte level - at least one required)
  test_group_id uuid REFERENCES public.test_groups(id) ON DELETE CASCADE,
  analyte_id uuid REFERENCES public.analytes(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,

  -- Consumption details
  quantity_per_test numeric NOT NULL DEFAULT 1,
  unit text,                              -- Override unit if different from item default

  -- AI tracking
  ai_suggested boolean NOT NULL DEFAULT false,
  ai_confidence numeric,                  -- 0.0 to 1.0
  ai_reasoning text,                      -- Why AI suggested this mapping

  -- Status
  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id),

  -- At least one of test_group_id or analyte_id must be set
  CONSTRAINT inventory_mapping_has_target CHECK (
    test_group_id IS NOT NULL OR analyte_id IS NOT NULL
  ),

  -- Unique per test_group + item (when test_group mapping)
  CONSTRAINT inventory_test_mapping_test_unique UNIQUE NULLS NOT DISTINCT (test_group_id, item_id),
  -- Unique per analyte + item (when analyte mapping)
  CONSTRAINT inventory_test_mapping_analyte_unique UNIQUE NULLS NOT DISTINCT (analyte_id, item_id)
);

-- Comments
COMMENT ON TABLE public.inventory_test_mapping IS 'Maps which inventory items are consumed when a test or analyte is performed. Supports both test-group level and analyte-level granularity.';
COMMENT ON COLUMN public.inventory_test_mapping.test_group_id IS 'Map at test group level (e.g., CBC test uses 1 kit)';
COMMENT ON COLUMN public.inventory_test_mapping.analyte_id IS 'Map at analyte level for finer control (e.g., Hemoglobin uses 0.5ml reagent)';
COMMENT ON COLUMN public.inventory_test_mapping.ai_suggested IS 'True if this mapping was suggested by AI based on test methodology';

-- ============================================================================
-- OPTIONAL MODULE: PROCUREMENT - 2 Tables
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 5. INVENTORY SUPPLIERS - Simple supplier directory
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.inventory_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,

  -- Basic info
  name text NOT NULL,
  code text,                              -- SUP001, etc.

  -- Contact
  contact_person text,
  phone text,
  email text,
  address text,

  -- Business (Simple)
  gst_number text,
  payment_terms text,                     -- "Net 30", "COD", etc.

  -- AI-extracted data from invoices
  ai_data jsonb DEFAULT '{}'::jsonb,
  -- Stores: {
  --   "extracted_from_invoices": [...],
  --   "common_items": ["item1", "item2"],
  --   "avg_delivery_days": 3
  -- }

  -- Status
  is_active boolean NOT NULL DEFAULT true,
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT inventory_suppliers_lab_code_unique UNIQUE (lab_id, code)
);

-- Comments
COMMENT ON TABLE public.inventory_suppliers IS 'Simple supplier/vendor directory';

-- ----------------------------------------------------------------------------
-- 6. INVENTORY ORDERS - Simple purchase tracking (items in JSONB)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.inventory_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,

  -- Order info
  order_number text,
  order_date date NOT NULL DEFAULT CURRENT_DATE,

  -- Supplier (can link or just store name)
  supplier_id uuid REFERENCES public.inventory_suppliers(id),
  supplier_name text,                     -- Denormalized for quick display

  -- Items as JSONB array (NO separate line items table!)
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Format: [
  --   {"item_id": "uuid", "name": "CBC Reagent", "quantity": 5, "unit": "box", "unit_price": 1000, "total": 5000},
  --   {"item_id": "uuid", "name": "Control Serum", "quantity": 10, "unit": "ml", "unit_price": 200, "total": 2000}
  -- ]

  -- Totals
  subtotal numeric,
  tax_amount numeric,
  total_amount numeric,

  -- Status (Simple workflow)
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ordered', 'received', 'cancelled')),

  -- Invoice reference (when received)
  invoice_number text,
  invoice_date date,

  -- When received
  received_at timestamptz,
  received_by uuid REFERENCES public.users(id),

  -- AI-parsed from invoice photo
  ai_parsed jsonb,
  -- Stores: {
  --   "image_url": "...",
  --   "ocr_text": "...",
  --   "extracted_items": [...],
  --   "confidence": 0.92
  -- }

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id)
);

-- Comments
COMMENT ON TABLE public.inventory_orders IS 'Simple purchase orders - items stored as JSONB, no line items table needed';
COMMENT ON COLUMN public.inventory_orders.items IS 'Array of items: [{item_id, name, quantity, unit, unit_price, total}]';

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Core indexes
CREATE INDEX IF NOT EXISTS idx_inventory_items_lab
  ON public.inventory_items(lab_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_inventory_items_low_stock
  ON public.inventory_items(lab_id, current_stock, min_stock)
  WHERE is_active = true AND min_stock > 0;

CREATE INDEX IF NOT EXISTS idx_inventory_items_expiry
  ON public.inventory_items(lab_id, expiry_date)
  WHERE is_active = true AND expiry_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_items_type
  ON public.inventory_items(lab_id, type) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_item
  ON public.inventory_transactions(item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_lab_date
  ON public.inventory_transactions(lab_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_order
  ON public.inventory_transactions(order_id) WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_alerts_active
  ON public.stock_alerts(lab_id, status, type) WHERE status = 'active';

-- Optional module indexes
CREATE INDEX IF NOT EXISTS idx_inventory_test_mapping_test
  ON public.inventory_test_mapping(test_group_id) WHERE is_active = true AND test_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_test_mapping_analyte
  ON public.inventory_test_mapping(analyte_id) WHERE is_active = true AND analyte_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_test_mapping_item
  ON public.inventory_test_mapping(item_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_inventory_suppliers_lab
  ON public.inventory_suppliers(lab_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_inventory_orders_lab_status
  ON public.inventory_orders(lab_id, status, order_date DESC);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update stock on transaction insert
CREATE OR REPLACE FUNCTION public.fn_inventory_update_stock()
RETURNS TRIGGER AS $$
BEGIN
  -- Get current stock for stock_before
  NEW.stock_before := (
    SELECT current_stock
    FROM public.inventory_items
    WHERE id = NEW.item_id
  );

  -- Update item stock and batch/expiry info
  IF NEW.type = 'in' THEN
    -- When adding stock, also update batch_number and expiry_date if provided
    UPDATE public.inventory_items
    SET
      current_stock = current_stock + NEW.quantity,
      batch_number = COALESCE(NEW.batch_number, batch_number),
      expiry_date = CASE
        -- Update expiry if new batch has earlier expiry or no current expiry
        WHEN NEW.expiry_date IS NOT NULL AND (expiry_date IS NULL OR NEW.expiry_date < expiry_date)
        THEN NEW.expiry_date
        ELSE expiry_date
      END,
      unit_price = COALESCE(NEW.unit_price, unit_price),
      updated_at = now()
    WHERE id = NEW.item_id;
  ELSE
    -- For out/adjust, just update stock
    UPDATE public.inventory_items
    SET
      current_stock = current_stock + NEW.quantity,
      updated_at = now()
    WHERE id = NEW.item_id;
  END IF;

  -- Set stock_after in transaction
  NEW.stock_after := NEW.stock_before + NEW.quantity;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_update_stock ON public.inventory_transactions;
CREATE TRIGGER trg_inventory_update_stock
  BEFORE INSERT ON public.inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventory_update_stock();

-- Auto-generate stock alerts
CREATE OR REPLACE FUNCTION public.fn_inventory_check_alerts()
RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
  v_days_to_expiry integer;
BEGIN
  -- Get updated item
  SELECT * INTO v_item
  FROM public.inventory_items
  WHERE id = NEW.item_id;

  -- Skip if item not found or inactive
  IF NOT FOUND OR NOT v_item.is_active THEN
    RETURN NEW;
  END IF;

  -- Check OUT OF STOCK
  IF v_item.current_stock <= 0 THEN
    INSERT INTO public.stock_alerts (lab_id, item_id, type, message, current_value, threshold_value)
    VALUES (
      v_item.lab_id,
      v_item.id,
      'out_of_stock',
      v_item.name || ' is OUT OF STOCK!',
      v_item.current_stock,
      0
    )
    ON CONFLICT DO NOTHING;

  -- Check LOW STOCK
  ELSIF v_item.min_stock > 0 AND v_item.current_stock <= v_item.min_stock THEN
    INSERT INTO public.stock_alerts (lab_id, item_id, type, message, current_value, threshold_value)
    VALUES (
      v_item.lab_id,
      v_item.id,
      'low_stock',
      v_item.name || ' is running low (' || v_item.current_stock || ' ' || v_item.unit || ' remaining)',
      v_item.current_stock,
      v_item.min_stock
    )
    ON CONFLICT DO NOTHING;
  END IF;

  -- Auto-resolve alerts if stock is back above threshold
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

DROP TRIGGER IF EXISTS trg_inventory_check_alerts ON public.inventory_transactions;
CREATE TRIGGER trg_inventory_check_alerts
  AFTER INSERT ON public.inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventory_check_alerts();

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION public.fn_inventory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_items_updated_at
  BEFORE UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventory_updated_at();

CREATE TRIGGER trg_inventory_test_mapping_updated_at
  BEFORE UPDATE ON public.inventory_test_mapping
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventory_updated_at();

CREATE TRIGGER trg_inventory_suppliers_updated_at
  BEFORE UPDATE ON public.inventory_suppliers
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventory_updated_at();

CREATE TRIGGER trg_inventory_orders_updated_at
  BEFORE UPDATE ON public.inventory_orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventory_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_test_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_orders ENABLE ROW LEVEL SECURITY;

-- Simple lab-scoped policies
CREATE POLICY "inventory_items_lab_access" ON public.inventory_items
  FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "inventory_transactions_lab_access" ON public.inventory_transactions
  FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "stock_alerts_lab_access" ON public.stock_alerts
  FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "inventory_test_mapping_lab_access" ON public.inventory_test_mapping
  FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "inventory_suppliers_lab_access" ON public.inventory_suppliers
  FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "inventory_orders_lab_access" ON public.inventory_orders
  FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

-- ============================================================================
-- HELPER VIEWS
-- ============================================================================

-- View: Items needing attention (low stock + expiring)
CREATE OR REPLACE VIEW public.v_inventory_attention AS
SELECT
  i.id,
  i.lab_id,
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
  -- Calculate tests remaining based on consumption rules
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
  i.expiry_date - CURRENT_DATE AS days_to_expiry
FROM public.inventory_items i
WHERE i.is_active = true
  AND (
    i.current_stock <= COALESCE(i.min_stock, 0)
    OR i.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
  )
ORDER BY
  CASE WHEN i.current_stock <= 0 THEN 0 ELSE 1 END,
  CASE WHEN i.expiry_date < CURRENT_DATE THEN 0 ELSE 1 END,
  i.expiry_date NULLS LAST,
  i.current_stock;

-- View: All inventory items with tests remaining calculation
CREATE OR REPLACE VIEW public.v_inventory_with_tests AS
SELECT
  i.*,
  -- Calculate tests remaining based on consumption rules
  CASE
    WHEN i.pack_contains IS NOT NULL AND i.consumption_per_use > 0
    THEN FLOOR((i.current_stock * i.pack_contains) / i.consumption_per_use)
    WHEN i.consumption_per_use > 0
    THEN FLOOR(i.current_stock / i.consumption_per_use)
    ELSE i.current_stock
  END AS tests_remaining,
  -- Stock status
  CASE
    WHEN i.current_stock <= 0 THEN 'out_of_stock'
    WHEN i.min_stock > 0 AND i.current_stock <= i.min_stock THEN 'low_stock'
    ELSE 'normal'
  END AS stock_status
FROM public.inventory_items i
WHERE i.is_active = true;

-- View: Item consumption summary (last 30 days)
CREATE OR REPLACE VIEW public.v_inventory_consumption_summary AS
SELECT
  i.id AS item_id,
  i.lab_id,
  i.name,
  i.code,
  i.current_stock,
  i.unit,
  i.consumption_scope,
  i.consumption_per_use,
  i.pack_contains,
  -- Tests remaining
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
GROUP BY i.id, i.lab_id, i.name, i.code, i.current_stock, i.unit,
         i.consumption_scope, i.consumption_per_use, i.pack_contains;

-- ============================================================================
-- FUNCTIONS FOR API USE
-- ============================================================================

-- Function: Get inventory dashboard stats
CREATE OR REPLACE FUNCTION public.fn_inventory_dashboard_stats(p_lab_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_items', COUNT(*) FILTER (WHERE is_active),
    'out_of_stock', COUNT(*) FILTER (WHERE is_active AND current_stock <= 0),
    'low_stock', COUNT(*) FILTER (WHERE is_active AND current_stock > 0 AND current_stock <= min_stock),
    'expiring_soon', COUNT(*) FILTER (WHERE is_active AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'),
    'expired', COUNT(*) FILTER (WHERE is_active AND expiry_date < CURRENT_DATE),
    'total_value', COALESCE(SUM(current_stock * COALESCE(unit_price, 0)) FILTER (WHERE is_active), 0)
  ) INTO v_result
  FROM public.inventory_items
  WHERE lab_id = p_lab_id;

  RETURN v_result;
END;
$$;

-- Function: Quick add stock (for AI input)
CREATE OR REPLACE FUNCTION public.fn_inventory_quick_add(
  p_lab_id uuid,
  p_item_name text,
  p_quantity numeric,
  p_unit text DEFAULT 'pcs',
  p_reason text DEFAULT 'Purchase',
  p_ai_input jsonb DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item_id uuid;
  v_item_name text;
  v_transaction_id uuid;
BEGIN
  -- Find or create item
  SELECT id, name INTO v_item_id, v_item_name
  FROM public.inventory_items
  WHERE lab_id = p_lab_id
    AND (
      LOWER(name) = LOWER(p_item_name)
      OR LOWER(code) = LOWER(p_item_name)
    )
    AND is_active = true
  LIMIT 1;

  -- If not found, create new item
  IF v_item_id IS NULL THEN
    INSERT INTO public.inventory_items (lab_id, name, unit, current_stock, created_by)
    VALUES (p_lab_id, p_item_name, p_unit, 0, p_user_id)
    RETURNING id, name INTO v_item_id, v_item_name;
  END IF;

  -- Create transaction (trigger updates stock)
  INSERT INTO public.inventory_transactions (
    lab_id, item_id, type, quantity, reason, ai_input, performed_by
  )
  VALUES (
    p_lab_id, v_item_id, 'in', p_quantity, p_reason, p_ai_input, p_user_id
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

-- Function: Auto-consume for test (called from edge function)
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
BEGIN
  -- Get all active mappings for this test
  FOR v_mapping IN
    SELECT
      m.item_id,
      m.quantity_per_test,
      i.name AS item_name,
      i.current_stock,
      i.min_stock,
      i.unit
    FROM public.inventory_test_mapping m
    JOIN public.inventory_items i ON i.id = m.item_id
    WHERE m.test_group_id = p_test_group_id
      AND m.lab_id = p_lab_id
      AND m.is_active = true
      AND i.is_active = true
  LOOP
    -- Create consumption transaction
    INSERT INTO public.inventory_transactions (
      lab_id, item_id, type, quantity, reason,
      order_id, result_id, test_group_id, performed_by
    )
    VALUES (
      p_lab_id,
      v_mapping.item_id,
      'out',
      -v_mapping.quantity_per_test,
      'Test consumption',
      p_order_id,
      p_result_id,
      p_test_group_id,
      p_user_id
    );

    v_consumed := v_consumed + 1;
  END LOOP;

  -- Count new alerts generated
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

-- Function: Consume general items (per_sample/per_order scope - not test-specific)
-- Call this for every sample collected or order created to consume general consumables
CREATE OR REPLACE FUNCTION public.fn_inventory_consume_general(
  p_lab_id uuid,
  p_scope text,                    -- 'per_sample' or 'per_order'
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
BEGIN
  v_reason := COALESCE(p_reason, 'Auto-consumed: ' || p_scope);

  -- Get all active items with matching consumption_scope
  FOR v_item IN
    SELECT
      id,
      name,
      current_stock,
      consumption_per_use,
      unit
    FROM public.inventory_items
    WHERE lab_id = p_lab_id
      AND consumption_scope = p_scope
      AND is_active = true
      AND consumption_per_use > 0
      AND current_stock > 0  -- Only if stock available
  LOOP
    -- Create consumption transaction
    INSERT INTO public.inventory_transactions (
      lab_id, item_id, type, quantity, reason, order_id, performed_by
    )
    VALUES (
      p_lab_id,
      v_item.id,
      'out',
      -v_item.consumption_per_use,
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

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.fn_inventory_dashboard_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_inventory_quick_add(uuid, text, numeric, text, text, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_inventory_auto_consume(uuid, uuid, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_inventory_consume_general(uuid, text, uuid, text, uuid) TO authenticated;

-- ============================================================================
-- SEED DATA: Default categories as item types
-- ============================================================================
-- Note: We use a simple 'type' column instead of a categories table.
-- Types: reagent, consumable, calibrator, control, general
-- AI will auto-categorize items based on name.

COMMENT ON SCHEMA public IS 'AI-First Lean Inventory System - 6 tables for small-medium diagnostic labs';
