-- Allow the same barcode to be used by more than one sample.
ALTER TABLE public.samples
  DROP CONSTRAINT IF EXISTS samples_barcode_key;

-- Preserve efficient barcode lookups without enforcing uniqueness.
CREATE INDEX IF NOT EXISTS idx_samples_barcode
  ON public.samples (barcode);
