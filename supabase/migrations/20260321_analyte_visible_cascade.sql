-- Migration: Add visible column to analytes + cascade trigger
-- Only super admin sets visible=false directly in DB.
-- When a global analyte is hidden (visible=false), all linked lab_analytes
-- are also set to visible=false so they no longer appear for linking.
-- is_active is NOT cascaded — analyte stays active for historical orders/results.

-- 1. Add visible column to global analytes table
ALTER TABLE public.analytes
  ADD COLUMN IF NOT EXISTS visible boolean NOT NULL DEFAULT true;

-- 2. Trigger function
CREATE OR REPLACE FUNCTION cascade_analyte_visible_to_lab_analytes()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when visible transitions from true → false
  IF OLD.visible IS DISTINCT FROM false AND NEW.visible = false THEN
    UPDATE public.lab_analytes
    SET visible = false,
        updated_at = now()
    WHERE analyte_id = NEW.id
      AND visible = true;  -- only update those still visible (avoid no-op updates)
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Attach trigger (fires only on visible column changes)
DROP TRIGGER IF EXISTS trg_cascade_analyte_visible ON public.analytes;
CREATE TRIGGER trg_cascade_analyte_visible
  AFTER UPDATE OF visible ON public.analytes
  FOR EACH ROW
  EXECUTE FUNCTION cascade_analyte_visible_to_lab_analytes();
