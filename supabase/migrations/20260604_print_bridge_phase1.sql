-- Phase 1 print bridge queue.
-- Browser/LIMS enqueues print work here; the desktop LIMS Bridge Utility
-- polls the print-bridge Edge Function, prints locally, then ACKs.

CREATE TABLE IF NOT EXISTS public.print_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  print_device_id text,
  printer_role text NOT NULL,
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  priority integer NOT NULL DEFAULT 5,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  copies integer NOT NULL DEFAULT 1,
  requested_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  sample_id text REFERENCES public.samples(id) ON DELETE SET NULL,
  report_id uuid REFERENCES public.reports(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  idempotency_key text,
  claimed_by_device_id text,
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT print_jobs_printer_role_check CHECK (
    printer_role IN ('barcode_label', 'report', 'invoice_thermal')
  ),
  CONSTRAINT print_jobs_job_type_check CHECK (
    job_type IN ('raw_zpl', 'pdf_url', 'pdf_base64', 'html')
  ),
  CONSTRAINT print_jobs_status_check CHECK (
    status IN ('pending', 'claimed', 'printing', 'completed', 'failed', 'cancelled')
  ),
  CONSTRAINT print_jobs_copies_check CHECK (copies > 0 AND copies <= 100)
);

CREATE INDEX IF NOT EXISTS idx_print_jobs_pending
  ON public.print_jobs(lab_id, location_id, status, priority, created_at);

CREATE INDEX IF NOT EXISTS idx_print_jobs_status
  ON public.print_jobs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_print_jobs_order
  ON public.print_jobs(order_id);

CREATE INDEX IF NOT EXISTS idx_print_jobs_sample
  ON public.print_jobs(sample_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_print_jobs_idempotency
  ON public.print_jobs(lab_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.update_print_jobs_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_print_jobs_updated_at ON public.print_jobs;
CREATE TRIGGER trg_print_jobs_updated_at
  BEFORE UPDATE ON public.print_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_print_jobs_updated_at();

ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lab users can view their print jobs" ON public.print_jobs;
CREATE POLICY "Lab users can view their print jobs"
  ON public.print_jobs
  FOR SELECT
  USING (
    lab_id IN (
      SELECT users.lab_id
      FROM public.users
      WHERE users.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Lab users can create print jobs" ON public.print_jobs;
CREATE POLICY "Lab users can create print jobs"
  ON public.print_jobs
  FOR INSERT
  WITH CHECK (
    lab_id IN (
      SELECT users.lab_id
      FROM public.users
      WHERE users.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Lab users can cancel their print jobs" ON public.print_jobs;
CREATE POLICY "Lab users can cancel their print jobs"
  ON public.print_jobs
  FOR UPDATE
  USING (
    lab_id IN (
      SELECT users.lab_id
      FROM public.users
      WHERE users.id = auth.uid()
    )
  )
  WITH CHECK (
    lab_id IN (
      SELECT users.lab_id
      FROM public.users
      WHERE users.id = auth.uid()
    )
  );

COMMENT ON TABLE public.print_jobs IS
  'Queue of local printer jobs consumed by the LIMS Bridge Utility.';

COMMENT ON COLUMN public.print_jobs.payload IS
  'Small JSON payload for the print job, such as ZPL, PDF URL, or thermal HTML.';
