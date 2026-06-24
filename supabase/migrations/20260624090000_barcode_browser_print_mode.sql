-- Allow labs/locations to send barcode labels through the browser print dialog
-- instead of queueing them for the desktop LIMS Bridge Utility.

ALTER TABLE public.labs
  ADD COLUMN IF NOT EXISTS barcode_browser_print_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.labs.barcode_browser_print_enabled IS
  'When true, barcode labels open in the browser print dialog instead of being inserted into print_jobs for the Bridge Utility.';

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS barcode_browser_print_enabled boolean;

COMMENT ON COLUMN public.locations.barcode_browser_print_enabled IS
  'Location-specific barcode print mode. NULL = inherit lab default; true = browser print dialog; false = Bridge Utility queue.';
