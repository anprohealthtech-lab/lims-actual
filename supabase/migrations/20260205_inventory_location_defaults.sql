-- ============================================================================
-- Inventory Location Defaults
-- Migration: 20260205_inventory_location_defaults.sql
--
-- Changes:
-- 1) One-time backfill for missing location_id on inventory tables
-- 2) Triggers to auto-fill location_id on insert/update
-- ============================================================================

-- =============================================================================
-- PART 1: One-time backfill for missing location_id
-- =============================================================================

-- inventory_items: lab default processing location, else first location created
UPDATE public.inventory_items i
SET location_id = COALESCE(
  l.default_processing_location_id,
  (
    SELECT loc.id
    FROM public.locations loc
    WHERE loc.lab_id = i.lab_id
    ORDER BY loc.created_at ASC
    LIMIT 1
  )
)
FROM public.labs l
WHERE i.lab_id = l.id
  AND i.location_id IS NULL;

-- inventory_transactions: from item, else lab default, else first location created
UPDATE public.inventory_transactions t
SET location_id = COALESCE(
  i.location_id,
  l.default_processing_location_id,
  (
    SELECT loc.id
    FROM public.locations loc
    WHERE loc.lab_id = t.lab_id
    ORDER BY loc.created_at ASC
    LIMIT 1
  )
)
FROM public.inventory_items i, public.labs l
WHERE t.item_id = i.id
  AND l.id = t.lab_id
  AND t.location_id IS NULL;

-- stock_alerts: from item, else lab default, else first location created
UPDATE public.stock_alerts s
SET location_id = COALESCE(
  i.location_id,
  l.default_processing_location_id,
  (
    SELECT loc.id
    FROM public.locations loc
    WHERE loc.lab_id = s.lab_id
    ORDER BY loc.created_at ASC
    LIMIT 1
  )
)
FROM public.inventory_items i, public.labs l
WHERE s.item_id = i.id
  AND l.id = s.lab_id
  AND s.location_id IS NULL;

-- =============================================================================
-- PART 2: Trigger to set default location_id for inventory_items
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_inventory_items_set_default_location()
RETURNS TRIGGER AS $$
DECLARE
  v_location_id uuid;
BEGIN
  IF NEW.location_id IS NULL THEN
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

DROP TRIGGER IF EXISTS trg_inventory_items_set_default_location ON public.inventory_items;
CREATE TRIGGER trg_inventory_items_set_default_location
BEFORE INSERT OR UPDATE ON public.inventory_items
FOR EACH ROW
EXECUTE FUNCTION public.fn_inventory_items_set_default_location();

-- =============================================================================
-- PART 3: Trigger to set default location_id for inventory_transactions
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_inventory_transactions_set_default_location()
RETURNS TRIGGER AS $$
DECLARE
  v_item_location uuid;
  v_location_id uuid;
BEGIN
  IF NEW.location_id IS NULL THEN
    SELECT i.location_id
    INTO v_item_location
    FROM public.inventory_items i
    WHERE i.id = NEW.item_id;

    IF v_item_location IS NULL THEN
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
    END IF;

    NEW.location_id := COALESCE(v_item_location, v_location_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_transactions_set_default_location ON public.inventory_transactions;
CREATE TRIGGER trg_inventory_transactions_set_default_location
BEFORE INSERT OR UPDATE ON public.inventory_transactions
FOR EACH ROW
EXECUTE FUNCTION public.fn_inventory_transactions_set_default_location();

-- =============================================================================
-- PART 4: Trigger to set default location_id for stock_alerts
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_stock_alerts_set_default_location()
RETURNS TRIGGER AS $$
DECLARE
  v_item_location uuid;
  v_location_id uuid;
BEGIN
  IF NEW.location_id IS NULL THEN
    SELECT i.location_id
    INTO v_item_location
    FROM public.inventory_items i
    WHERE i.id = NEW.item_id;

    IF v_item_location IS NULL THEN
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
    END IF;

    NEW.location_id := COALESCE(v_item_location, v_location_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_alerts_set_default_location ON public.stock_alerts;
CREATE TRIGGER trg_stock_alerts_set_default_location
BEFORE INSERT OR UPDATE ON public.stock_alerts
FOR EACH ROW
EXECUTE FUNCTION public.fn_stock_alerts_set_default_location();
