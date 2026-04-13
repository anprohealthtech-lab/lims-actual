-- Add workflow settings to labs table:
-- 1. barcode_printer_name  — preferred printer name for barcode labels
-- 2. report_printer_name   — preferred printer name for reports
-- 3. auto_collect_on_registration — skip collection step; mark sample collected at order creation

ALTER TABLE public.labs
  ADD COLUMN IF NOT EXISTS barcode_printer_name TEXT,
  ADD COLUMN IF NOT EXISTS report_printer_name TEXT,
  ADD COLUMN IF NOT EXISTS auto_collect_on_registration BOOLEAN NOT NULL DEFAULT FALSE;
