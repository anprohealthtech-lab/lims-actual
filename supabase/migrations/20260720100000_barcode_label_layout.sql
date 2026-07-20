-- Store barcode label geometry per lab/location so label size, orientation and
-- N-up sheet layout are configurable instead of hardcoded in the client.
--
-- Shape (see src/utils/labelLayout.ts -> LabelLayout):
--   { preset, widthMm, heightMm, orientation, columns, rows, columnGapMm,
--     rowGapMm, pageWidthMm, pageHeightMm, pageMarginTopMm, pageMarginLeftMm,
--     paddingXMm, paddingYMm, barcodeHeightMm, fontScale, dpi,
--     zplLabelLengthMm }
--
-- NULL means "use the application default", which is the 2" x 1" roll layout
-- that shipped before this migration.

ALTER TABLE public.labs
  ADD COLUMN IF NOT EXISTS barcode_label_layout jsonb;

COMMENT ON COLUMN public.labs.barcode_label_layout IS
  'Barcode label geometry (size, orientation, rows/columns, margins, fonts, dpi). NULL = application default 2" x 1" roll layout.';

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS barcode_label_layout jsonb;

COMMENT ON COLUMN public.locations.barcode_label_layout IS
  'Location-specific barcode label geometry. NULL = inherit the lab layout.';
