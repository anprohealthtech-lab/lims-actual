-- Migration: Outsourced report manual upload + merge-at-generation support
-- Date: 2026-07-09
-- Description:
--   1. Link outsourced_reports to a specific result (result_id) so a manually
--      uploaded PDF maps to the exact outsourced test, not just the order.
--   2. Track who uploaded manual reports (uploaded_by).
--   3. Indexes used by the PDF-generation merge lookup (by order_id / result_id).
--   4. Storage policies so authenticated lab users can upload directly to the
--      existing public 'outsourced_reports' bucket (email webhook uses service role).

BEGIN;

-- 1. Result-level linkage + uploader metadata
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'outsourced_reports' AND column_name = 'result_id'
    ) THEN
        ALTER TABLE public.outsourced_reports
        ADD COLUMN result_id uuid REFERENCES public.results(id) ON DELETE SET NULL;
        COMMENT ON COLUMN public.outsourced_reports.result_id IS 'Specific outsourced result/test this report belongs to (set on manual upload from result entry)';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'outsourced_reports' AND column_name = 'uploaded_by'
    ) THEN
        ALTER TABLE public.outsourced_reports
        ADD COLUMN uploaded_by uuid REFERENCES public.users(id);
        COMMENT ON COLUMN public.outsourced_reports.uploaded_by IS 'User who manually uploaded this report (null for email-forwarded reports)';
    END IF;
END $$;

-- 2. Indexes for merge-at-generation lookups
CREATE INDEX IF NOT EXISTS idx_outsourced_reports_order_id
    ON public.outsourced_reports(order_id)
    WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_outsourced_reports_result_id
    ON public.outsourced_reports(result_id)
    WHERE result_id IS NOT NULL;

-- 3. Ensure bucket exists (idempotent; originally created in 20251202_email_integration.sql)
INSERT INTO storage.buckets (id, name, public)
VALUES ('outsourced_reports', 'outsourced_reports', true)
ON CONFLICT (id) DO NOTHING;

-- 4. Storage policies for client-side uploads (webhook uses service role and bypasses RLS)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Authenticated users can upload outsourced reports'
    ) THEN
        CREATE POLICY "Authenticated users can upload outsourced reports"
            ON storage.objects FOR INSERT TO authenticated
            WITH CHECK (bucket_id = 'outsourced_reports');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Public read access for outsourced reports'
    ) THEN
        CREATE POLICY "Public read access for outsourced reports"
            ON storage.objects FOR SELECT
            USING (bucket_id = 'outsourced_reports');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Authenticated users can delete outsourced reports'
    ) THEN
        CREATE POLICY "Authenticated users can delete outsourced reports"
            ON storage.objects FOR DELETE TO authenticated
            USING (bucket_id = 'outsourced_reports');
    END IF;
END $$;

COMMIT;
