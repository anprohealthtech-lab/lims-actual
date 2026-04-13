-- Migration: Bulk Corporate Registration Support
-- Adds batch tracking, bulk PDF download queue, and corporate employee ID

-- 1. Bulk registration batch tracking
CREATE TABLE public.bulk_registration_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES public.labs(id),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  package_id uuid REFERENCES public.packages(id),
  test_group_ids uuid[] DEFAULT '{}',
  batch_source text NOT NULL DEFAULT 'manual'
    CHECK (batch_source = ANY (ARRAY['manual'::text, 'excel_upload'::text])),
  total_patients integer NOT NULL DEFAULT 0,
  created_orders integer NOT NULL DEFAULT 0,
  failed_orders integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'partial'::text, 'failed'::text])),
  excel_filename text,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT bulk_registration_batches_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_bulk_batches_lab_id ON public.bulk_registration_batches(lab_id, created_at DESC);
CREATE INDEX idx_bulk_batches_account_id ON public.bulk_registration_batches(account_id);

-- 2. Add bulk_batch_id to orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS bulk_batch_id uuid REFERENCES public.bulk_registration_batches(id);

CREATE INDEX IF NOT EXISTS idx_orders_bulk_batch_id
  ON public.orders(bulk_batch_id)
  WHERE bulk_batch_id IS NOT NULL;

-- 3. Add corporate employee ID to patients
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS corporate_employee_id text;

CREATE INDEX IF NOT EXISTS idx_patients_corporate_employee_id
  ON public.patients(lab_id, corporate_employee_id)
  WHERE corporate_employee_id IS NOT NULL;

-- 4. Bulk PDF download request queue
CREATE TABLE public.bulk_pdf_download_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES public.labs(id),
  account_id uuid REFERENCES public.accounts(id),
  bulk_batch_id uuid REFERENCES public.bulk_registration_batches(id),
  order_ids uuid[] NOT NULL DEFAULT '{}',
  date_from date,
  date_to date,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])),
  zip_url text,
  total_orders integer NOT NULL DEFAULT 0,
  processed_orders integer NOT NULL DEFAULT 0,
  failed_orders integer NOT NULL DEFAULT 0,
  error_message text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz,
  CONSTRAINT bulk_pdf_download_requests_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_bulk_pdf_requests_lab_id ON public.bulk_pdf_download_requests(lab_id, created_at DESC);
CREATE INDEX idx_bulk_pdf_requests_status ON public.bulk_pdf_download_requests(status)
  WHERE status IN ('pending', 'processing');

-- 5. Performance indexes for account-based order lookups
CREATE INDEX IF NOT EXISTS idx_orders_account_date
  ON public.orders(lab_id, account_id, order_date DESC)
  WHERE account_id IS NOT NULL;

-- 6. RLS for bulk_registration_batches
ALTER TABLE public.bulk_registration_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Bulk batches are viewable by users in same lab" ON public.bulk_registration_batches;
DROP POLICY IF EXISTS "Bulk batches are insertable by users in same lab" ON public.bulk_registration_batches;
DROP POLICY IF EXISTS "Bulk batches are updatable by users in same lab" ON public.bulk_registration_batches;
DROP POLICY IF EXISTS "Bulk batches are deletable by users in same lab" ON public.bulk_registration_batches;

CREATE POLICY "Bulk batches are viewable by users in same lab"
ON public.bulk_registration_batches FOR SELECT
TO authenticated
USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Bulk batches are insertable by users in same lab"
ON public.bulk_registration_batches FOR INSERT
TO authenticated
WITH CHECK (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Bulk batches are updatable by users in same lab"
ON public.bulk_registration_batches FOR UPDATE
TO authenticated
USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()))
WITH CHECK (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Bulk batches are deletable by users in same lab"
ON public.bulk_registration_batches FOR DELETE
TO authenticated
USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

-- 7. RLS for bulk_pdf_download_requests
ALTER TABLE public.bulk_pdf_download_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Bulk PDF requests are viewable by users in same lab" ON public.bulk_pdf_download_requests;
DROP POLICY IF EXISTS "Bulk PDF requests are insertable by users in same lab" ON public.bulk_pdf_download_requests;
DROP POLICY IF EXISTS "Bulk PDF requests are updatable by users in same lab" ON public.bulk_pdf_download_requests;

CREATE POLICY "Bulk PDF requests are viewable by users in same lab"
ON public.bulk_pdf_download_requests FOR SELECT
TO authenticated
USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Bulk PDF requests are insertable by users in same lab"
ON public.bulk_pdf_download_requests FOR INSERT
TO authenticated
WITH CHECK (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Bulk PDF requests are updatable by users in same lab"
ON public.bulk_pdf_download_requests FOR UPDATE
TO authenticated
USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()))
WITH CHECK (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));
