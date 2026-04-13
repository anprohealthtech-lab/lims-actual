-- ============================================================================
-- Add auto-print settings to labs and locations tables
-- Enables QZ Tray auto-printing: barcode on order creation, report on approval
--
-- Strategy:
--   - labs columns = lab-wide defaults (fallback)
--   - locations columns = per-center overrides (take priority when set)
--   QZTrayContext resolves: location value → lab fallback → disabled
-- ============================================================================

-- Lab-level defaults (fallback for all centers)
ALTER TABLE public.labs
  ADD COLUMN IF NOT EXISTS auto_print_barcode_on_order    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_print_report_on_approval  boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.labs.barcode_printer_name IS
'Default barcode/label printer name for the lab. Overridden per location if location.barcode_printer_name is set.';

COMMENT ON COLUMN public.labs.report_printer_name IS
'Default report printer name for the lab. Overridden per location if location.report_printer_name is set.';

COMMENT ON COLUMN public.labs.auto_print_barcode_on_order IS
'Lab-wide default: auto-send ZPL barcode label via QZ Tray on order creation. Can be overridden per location.';

COMMENT ON COLUMN public.labs.auto_print_report_on_approval IS
'Lab-wide default: auto-send report PDF via QZ Tray on result approval. Can be overridden per location.';

-- Per-location overrides (NULL = inherit from lab)
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS barcode_printer_name           text,
  ADD COLUMN IF NOT EXISTS report_printer_name            text,
  ADD COLUMN IF NOT EXISTS auto_print_barcode_on_order    boolean,
  ADD COLUMN IF NOT EXISTS auto_print_report_on_approval  boolean;

COMMENT ON COLUMN public.locations.barcode_printer_name IS
'Location-specific barcode/label printer. NULL = use lab default.';

COMMENT ON COLUMN public.locations.report_printer_name IS
'Location-specific report printer. NULL = use lab default.';

COMMENT ON COLUMN public.locations.auto_print_barcode_on_order IS
'Location-specific auto-print barcode toggle. NULL = inherit lab default.';

COMMENT ON COLUMN public.locations.auto_print_report_on_approval IS
'Location-specific auto-print report toggle. NULL = inherit lab default.';
