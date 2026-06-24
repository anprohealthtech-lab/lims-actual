-- Migration: Bulk PDF Merge via LIMS Bridge
-- Date: 2026-06-16
--
-- Adds 'bulk_pdf_merge' job type to print_jobs table so the LIMS Bridge
-- desktop utility can download and merge PDFs locally instead of using
-- Edge Functions (avoids memory limits, PDF.co costs, large file re-uploads).

-- 1. Update printer_role check constraint to include bulk_pdf_merge
ALTER TABLE public.print_jobs
  DROP CONSTRAINT IF EXISTS print_jobs_printer_role_check;

ALTER TABLE public.print_jobs
  ADD CONSTRAINT print_jobs_printer_role_check CHECK (
    printer_role IN ('barcode_label', 'report', 'invoice_thermal', 'bulk_pdf_merge')
  );

COMMENT ON CONSTRAINT print_jobs_printer_role_check ON public.print_jobs IS
  'Allowed printer roles: barcode_label, report, invoice_thermal, bulk_pdf_merge';

-- 2. Add index for bulk_pdf_merge jobs (they may have larger payloads)
CREATE INDEX IF NOT EXISTS idx_print_jobs_bulk_merge
  ON public.print_jobs(lab_id, status, created_at)
  WHERE printer_role = 'bulk_pdf_merge';
