-- Add bridge-side HTML to PDF generation support.
-- The Bridge claims these jobs, renders supplied HTML locally, and ACKs with
-- bridge_result metadata for eCopy, print, and optional local archive paths.

ALTER TABLE public.print_jobs
  DROP CONSTRAINT IF EXISTS print_jobs_printer_role_check;

ALTER TABLE public.print_jobs
  ADD CONSTRAINT print_jobs_printer_role_check CHECK (
    printer_role IN (
      'barcode_label',
      'report',
      'invoice_thermal',
      'bulk_pdf_merge',
      'report_pdf_generate'
    )
  );

ALTER TABLE public.print_jobs
  DROP CONSTRAINT IF EXISTS print_jobs_job_type_check;

ALTER TABLE public.print_jobs
  ADD CONSTRAINT print_jobs_job_type_check CHECK (
    job_type IN (
      'raw_zpl',
      'pdf_url',
      'pdf_base64',
      'html',
      'bulk_merge',
      'bulk_pdf_merge',
      'html_to_pdf'
    )
  );

COMMENT ON CONSTRAINT print_jobs_printer_role_check ON public.print_jobs IS
  'Allowed printer roles: barcode_label, report, invoice_thermal, bulk_pdf_merge, report_pdf_generate';

COMMENT ON CONSTRAINT print_jobs_job_type_check ON public.print_jobs IS
  'Allowed job types: raw_zpl, pdf_url, pdf_base64, html, bulk_merge, bulk_pdf_merge, html_to_pdf';

COMMENT ON COLUMN public.print_jobs.payload IS
  'Small JSON payload for Bridge jobs. ACK metadata is appended under bridge_result without replacing the original payload.';

CREATE INDEX IF NOT EXISTS idx_print_jobs_report_pdf_generate
  ON public.print_jobs(lab_id, status, created_at)
  WHERE printer_role = 'report_pdf_generate';
