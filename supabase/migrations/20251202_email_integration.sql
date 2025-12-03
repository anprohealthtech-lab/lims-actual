-- Migration: Email Integration & Outsourced Management
-- Date: 2025-12-02
-- Description: Adds tables for email logging, outsourced labs, outsourced reports, and updates test_groups/results.

-- 1. Create email_logs table
CREATE TABLE IF NOT EXISTS public.email_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL,
  recipient text NOT NULL,
  subject text NOT NULL,
  template_id text NOT NULL, -- e.g., 'patient_report', 'b2b_invoice'
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'delivered')),
  provider_id text, -- Resend Email ID
  error_message text,
  metadata jsonb DEFAULT '{}'::jsonb, -- Stores context like { "patient_id": "...", "order_id": "..." }
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT email_logs_pkey PRIMARY KEY (id),
  CONSTRAINT email_logs_lab_id_fkey FOREIGN KEY (lab_id) REFERENCES public.labs(id)
);

-- 2. Create outsourced_labs table
CREATE TABLE IF NOT EXISTS public.outsourced_labs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL, -- The tenant lab
  name text NOT NULL,
  email text, -- For sending orders
  contact_person text,
  phone text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT outsourced_labs_pkey PRIMARY KEY (id),
  CONSTRAINT outsourced_labs_lab_id_fkey FOREIGN KEY (lab_id) REFERENCES public.labs(id)
);

-- 3. Update test_groups table
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'test_groups' AND column_name = 'is_outsourced') THEN
        ALTER TABLE public.test_groups ADD COLUMN is_outsourced boolean DEFAULT false;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'test_groups' AND column_name = 'default_outsourced_lab_id') THEN
        ALTER TABLE public.test_groups ADD COLUMN default_outsourced_lab_id uuid REFERENCES public.outsourced_labs(id);
    END IF;
END $$;

-- 4. Update results table (using results table as per schema, assuming order_tests might be joined or this is where status lives)
-- Note: The plan mentioned order_tests or results. The schema shows 'results' table has status. 
-- Let's add to 'results' table as it seems to be the main place for result tracking.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'results' AND column_name = 'outsourced_to_lab_id') THEN
        ALTER TABLE public.results ADD COLUMN outsourced_to_lab_id uuid REFERENCES public.outsourced_labs(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'results' AND column_name = 'outsourced_status') THEN
        ALTER TABLE public.results ADD COLUMN outsourced_status text DEFAULT 'not_outsourced' CHECK (outsourced_status IN ('not_outsourced', 'pending_send', 'sent', 'awaiting_report', 'received', 'merged'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'results' AND column_name = 'outsourced_tat_estimate') THEN
        ALTER TABLE public.results ADD COLUMN outsourced_tat_estimate timestamp with time zone;
    END IF;
END $$;

-- 5. Create outsourced_reports table
CREATE TABLE IF NOT EXISTS public.outsourced_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'email_forward' CHECK (source IN ('email_forward', 'direct_connect', 'manual_upload')),
  sender_email text,
  subject text,
  received_at timestamp with time zone DEFAULT now(),
  file_url text NOT NULL, -- Path in Supabase Storage (bucket: 'outsourced_reports')
  file_name text,
  status text NOT NULL DEFAULT 'pending_processing' CHECK (status IN ('pending_processing', 'processing', 'processed', 'failed', 'verified')),
  ai_extracted_data jsonb, -- Raw JSON from Gemini
  ai_confidence numeric,
  patient_id uuid, -- Linked after AI extraction or manual review
  order_id uuid,   -- Linked after AI extraction or manual review
  processing_error text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT outsourced_reports_pkey PRIMARY KEY (id),
  CONSTRAINT outsourced_reports_lab_id_fkey FOREIGN KEY (lab_id) REFERENCES public.labs(id),
  CONSTRAINT outsourced_reports_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id),
  CONSTRAINT outsourced_reports_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id)
);

-- Enable RLS (Row Level Security) - Basic setup, assuming standard policies will be added later or exist
ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outsourced_labs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outsourced_reports ENABLE ROW LEVEL SECURITY;

-- Add basic policies (assuming authenticated users can access their lab's data)
-- Policy for email_logs
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_logs' AND policyname = 'Users can view their lab email logs') THEN
        CREATE POLICY "Users can view their lab email logs" ON public.email_logs
        FOR SELECT USING (auth.uid() IN (SELECT id FROM public.users WHERE lab_id = email_logs.lab_id));
    END IF;
END $$;

-- Policy for outsourced_labs
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'outsourced_labs' AND policyname = 'Users can view their lab outsourced labs') THEN
        CREATE POLICY "Users can view their lab outsourced labs" ON public.outsourced_labs
        FOR ALL USING (auth.uid() IN (SELECT id FROM public.users WHERE lab_id = outsourced_labs.lab_id));
    END IF;
END $$;

-- Policy for outsourced_reports
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'outsourced_reports' AND policyname = 'Users can view their lab outsourced reports') THEN
        CREATE POLICY "Users can view their lab outsourced reports" ON public.outsourced_reports
        FOR ALL USING (auth.uid() IN (SELECT id FROM public.users WHERE lab_id = outsourced_reports.lab_id));
    END IF;
END $$;

-- 6. Create storage bucket for outsourced reports
INSERT INTO storage.buckets (id, name, public) 
VALUES ('outsourced_reports', 'outsourced_reports', false) 
ON CONFLICT (id) DO NOTHING;

-- Policy for storage objects (outsourced_reports)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Users can view their lab outsourced report files') THEN
        CREATE POLICY "Users can view their lab outsourced report files" ON storage.objects
        FOR SELECT USING (bucket_id = 'outsourced_reports' AND auth.uid() IN (SELECT id FROM public.users)); -- Simplified for now, ideally link via metadata or folder structure
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Users can upload outsourced report files') THEN
        CREATE POLICY "Users can upload outsourced report files" ON storage.objects
        FOR INSERT WITH CHECK (bucket_id = 'outsourced_reports'); -- Allow service role or authenticated users to upload if needed. For webhook, we use service role.
    END IF;
END $$;
