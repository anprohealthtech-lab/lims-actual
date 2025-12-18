-- Fix duplicate key constraint error on invoice_templates
-- Remove the incorrectly defined UNIQUE constraint and keep only the partial index

-- Drop the problematic constraint if it exists
ALTER TABLE public.invoice_templates 
  DROP CONSTRAINT IF EXISTS unique_default_per_lab;

-- The partial unique index is correct and should remain:
-- CREATE UNIQUE INDEX idx_invoice_templates_default 
--   ON public.invoice_templates(lab_id) 
--   WHERE is_default = true;
-- This ensures only ONE default template per lab

-- Verify the constraint is fixed
SELECT 
  conname as constraint_name,
  contype as constraint_type
FROM pg_constraint
WHERE conname = 'unique_default_per_lab';

-- Should return 0 rows (constraint removed)

-- Verify the index exists
SELECT 
  indexname,
  indexdef
FROM pg_indexes
WHERE indexname = 'idx_invoice_templates_default';

-- Should show the partial index WHERE is_default = true
