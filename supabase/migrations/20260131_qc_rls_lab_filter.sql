-- ============================================================================
-- QC Tables RLS Policies and Lab ID Column
-- ============================================================================
-- Issue: qc_results doesn't have lab_id, so RLS can't filter properly
-- Fix: Add lab_id to qc_results and create proper RLS policies for all QC tables
-- ============================================================================

-- ============================================================================
-- 1. Add lab_id to qc_results
-- ============================================================================

-- Add lab_id column to qc_results
ALTER TABLE public.qc_results
ADD COLUMN IF NOT EXISTS lab_id UUID REFERENCES public.labs(id) ON DELETE CASCADE;

-- Create index for lab_id
CREATE INDEX IF NOT EXISTS idx_qc_results_lab_id ON public.qc_results(lab_id);

-- Populate lab_id from qc_runs for existing records
UPDATE public.qc_results r
SET lab_id = qr.lab_id
FROM public.qc_runs qr
WHERE r.qc_run_id = qr.id
AND r.lab_id IS NULL;

-- ============================================================================
-- 2. Create trigger to auto-populate lab_id on insert
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_qc_result_lab_id()
RETURNS TRIGGER AS $$
BEGIN
    -- Get lab_id from qc_run if not provided
    IF NEW.lab_id IS NULL AND NEW.qc_run_id IS NOT NULL THEN
        SELECT lab_id INTO NEW.lab_id
        FROM public.qc_runs
        WHERE id = NEW.qc_run_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_qc_result_lab_id_trigger ON public.qc_results;
CREATE TRIGGER set_qc_result_lab_id_trigger
    BEFORE INSERT ON public.qc_results
    FOR EACH ROW
    EXECUTE FUNCTION public.set_qc_result_lab_id();

-- ============================================================================
-- 3. Enable RLS on all QC tables
-- ============================================================================

ALTER TABLE public.qc_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_target_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_results ENABLE ROW LEVEL SECURITY;

-- Enable RLS on other QC tables if they exist
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'qc_investigations') THEN
        EXECUTE 'ALTER TABLE public.qc_investigations ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'qc_tasks') THEN
        EXECUTE 'ALTER TABLE public.qc_tasks ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'qc_drift_alerts') THEN
        EXECUTE 'ALTER TABLE public.qc_drift_alerts ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'qc_evidence') THEN
        EXECUTE 'ALTER TABLE public.qc_evidence ENABLE ROW LEVEL SECURITY';
    END IF;
END $$;

-- ============================================================================
-- 4. Create RLS Policies for qc_lots
-- ============================================================================

DROP POLICY IF EXISTS "Users can view qc_lots for their lab" ON public.qc_lots;
CREATE POLICY "Users can view qc_lots for their lab"
    ON public.qc_lots FOR SELECT
    USING (
        lab_id IN (
            SELECT u.lab_id FROM public.users u
            WHERE u.id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can insert qc_lots for their lab" ON public.qc_lots;
CREATE POLICY "Users can insert qc_lots for their lab"
    ON public.qc_lots FOR INSERT
    WITH CHECK (
        lab_id IN (
            SELECT u.lab_id FROM public.users u
            WHERE u.id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can update qc_lots for their lab" ON public.qc_lots;
CREATE POLICY "Users can update qc_lots for their lab"
    ON public.qc_lots FOR UPDATE
    USING (
        lab_id IN (
            SELECT u.lab_id FROM public.users u
            WHERE u.id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can delete qc_lots for their lab" ON public.qc_lots;
CREATE POLICY "Users can delete qc_lots for their lab"
    ON public.qc_lots FOR DELETE
    USING (
        lab_id IN (
            SELECT u.lab_id FROM public.users u
            WHERE u.id = auth.uid()
        )
    );

-- ============================================================================
-- 5. Create RLS Policies for qc_target_values (via qc_lots join)
-- ============================================================================

DROP POLICY IF EXISTS "Users can view qc_target_values for their lab" ON public.qc_target_values;
CREATE POLICY "Users can view qc_target_values for their lab"
    ON public.qc_target_values FOR SELECT
    USING (
        qc_lot_id IN (
            SELECT l.id FROM public.qc_lots l
            JOIN public.users u ON u.lab_id = l.lab_id
            WHERE u.id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can insert qc_target_values for their lab" ON public.qc_target_values;
CREATE POLICY "Users can insert qc_target_values for their lab"
    ON public.qc_target_values FOR INSERT
    WITH CHECK (
        qc_lot_id IN (
            SELECT l.id FROM public.qc_lots l
            JOIN public.users u ON u.lab_id = l.lab_id
            WHERE u.id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can update qc_target_values for their lab" ON public.qc_target_values;
CREATE POLICY "Users can update qc_target_values for their lab"
    ON public.qc_target_values FOR UPDATE
    USING (
        qc_lot_id IN (
            SELECT l.id FROM public.qc_lots l
            JOIN public.users u ON u.lab_id = l.lab_id
            WHERE u.id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can delete qc_target_values for their lab" ON public.qc_target_values;
CREATE POLICY "Users can delete qc_target_values for their lab"
    ON public.qc_target_values FOR DELETE
    USING (
        qc_lot_id IN (
            SELECT l.id FROM public.qc_lots l
            JOIN public.users u ON u.lab_id = l.lab_id
            WHERE u.id = auth.uid()
        )
    );

-- ============================================================================
-- 6. Create RLS Policies for qc_runs
-- ============================================================================

DROP POLICY IF EXISTS "Users can view qc_runs for their lab" ON public.qc_runs;
CREATE POLICY "Users can view qc_runs for their lab"
    ON public.qc_runs FOR SELECT
    USING (
        lab_id IN (
            SELECT u.lab_id FROM public.users u
            WHERE u.id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can insert qc_runs for their lab" ON public.qc_runs;
CREATE POLICY "Users can insert qc_runs for their lab"
    ON public.qc_runs FOR INSERT
    WITH CHECK (
        lab_id IN (
            SELECT u.lab_id FROM public.users u
            WHERE u.id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can update qc_runs for their lab" ON public.qc_runs;
CREATE POLICY "Users can update qc_runs for their lab"
    ON public.qc_runs FOR UPDATE
    USING (
        lab_id IN (
            SELECT u.lab_id FROM public.users u
            WHERE u.id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can delete qc_runs for their lab" ON public.qc_runs;
CREATE POLICY "Users can delete qc_runs for their lab"
    ON public.qc_runs FOR DELETE
    USING (
        lab_id IN (
            SELECT u.lab_id FROM public.users u
            WHERE u.id = auth.uid()
        )
    );

-- ============================================================================
-- 7. Create RLS Policies for qc_results (now has lab_id)
-- ============================================================================

DROP POLICY IF EXISTS "Users can view qc_results for their lab" ON public.qc_results;
CREATE POLICY "Users can view qc_results for their lab"
    ON public.qc_results FOR SELECT
    USING (
        lab_id IN (
            SELECT u.lab_id FROM public.users u
            WHERE u.id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can insert qc_results for their lab" ON public.qc_results;
CREATE POLICY "Users can insert qc_results for their lab"
    ON public.qc_results FOR INSERT
    WITH CHECK (
        -- Allow insert if lab_id matches user's lab, or if it will be set by trigger
        lab_id IS NULL OR lab_id IN (
            SELECT u.lab_id FROM public.users u
            WHERE u.id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can update qc_results for their lab" ON public.qc_results;
CREATE POLICY "Users can update qc_results for their lab"
    ON public.qc_results FOR UPDATE
    USING (
        lab_id IN (
            SELECT u.lab_id FROM public.users u
            WHERE u.id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can delete qc_results for their lab" ON public.qc_results;
CREATE POLICY "Users can delete qc_results for their lab"
    ON public.qc_results FOR DELETE
    USING (
        lab_id IN (
            SELECT u.lab_id FROM public.users u
            WHERE u.id = auth.uid()
        )
    );

-- ============================================================================
-- 8. Create RLS Policies for qc_investigations (if exists)
-- ============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'qc_investigations') THEN
        EXECUTE 'DROP POLICY IF EXISTS "Users can view qc_investigations for their lab" ON public.qc_investigations';
        EXECUTE 'CREATE POLICY "Users can view qc_investigations for their lab"
            ON public.qc_investigations FOR SELECT
            USING (lab_id IN (SELECT u.lab_id FROM public.users u WHERE u.id = auth.uid()))';

        EXECUTE 'DROP POLICY IF EXISTS "Users can insert qc_investigations for their lab" ON public.qc_investigations';
        EXECUTE 'CREATE POLICY "Users can insert qc_investigations for their lab"
            ON public.qc_investigations FOR INSERT
            WITH CHECK (lab_id IN (SELECT u.lab_id FROM public.users u WHERE u.id = auth.uid()))';

        EXECUTE 'DROP POLICY IF EXISTS "Users can update qc_investigations for their lab" ON public.qc_investigations';
        EXECUTE 'CREATE POLICY "Users can update qc_investigations for their lab"
            ON public.qc_investigations FOR UPDATE
            USING (lab_id IN (SELECT u.lab_id FROM public.users u WHERE u.id = auth.uid()))';
    END IF;
END $$;

-- ============================================================================
-- 9. Create RLS Policies for qc_tasks (if exists)
-- ============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'qc_tasks') THEN
        EXECUTE 'DROP POLICY IF EXISTS "Users can view qc_tasks for their lab" ON public.qc_tasks';
        EXECUTE 'CREATE POLICY "Users can view qc_tasks for their lab"
            ON public.qc_tasks FOR SELECT
            USING (lab_id IN (SELECT u.lab_id FROM public.users u WHERE u.id = auth.uid()))';

        EXECUTE 'DROP POLICY IF EXISTS "Users can insert qc_tasks for their lab" ON public.qc_tasks';
        EXECUTE 'CREATE POLICY "Users can insert qc_tasks for their lab"
            ON public.qc_tasks FOR INSERT
            WITH CHECK (lab_id IN (SELECT u.lab_id FROM public.users u WHERE u.id = auth.uid()))';

        EXECUTE 'DROP POLICY IF EXISTS "Users can update qc_tasks for their lab" ON public.qc_tasks';
        EXECUTE 'CREATE POLICY "Users can update qc_tasks for their lab"
            ON public.qc_tasks FOR UPDATE
            USING (lab_id IN (SELECT u.lab_id FROM public.users u WHERE u.id = auth.uid()))';
    END IF;
END $$;

-- ============================================================================
-- 10. Create RLS Policies for qc_drift_alerts (if exists)
-- ============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'qc_drift_alerts') THEN
        EXECUTE 'DROP POLICY IF EXISTS "Users can view qc_drift_alerts for their lab" ON public.qc_drift_alerts';
        EXECUTE 'CREATE POLICY "Users can view qc_drift_alerts for their lab"
            ON public.qc_drift_alerts FOR SELECT
            USING (lab_id IN (SELECT u.lab_id FROM public.users u WHERE u.id = auth.uid()))';

        EXECUTE 'DROP POLICY IF EXISTS "Users can insert qc_drift_alerts for their lab" ON public.qc_drift_alerts';
        EXECUTE 'CREATE POLICY "Users can insert qc_drift_alerts for their lab"
            ON public.qc_drift_alerts FOR INSERT
            WITH CHECK (lab_id IN (SELECT u.lab_id FROM public.users u WHERE u.id = auth.uid()))';

        EXECUTE 'DROP POLICY IF EXISTS "Users can update qc_drift_alerts for their lab" ON public.qc_drift_alerts';
        EXECUTE 'CREATE POLICY "Users can update qc_drift_alerts for their lab"
            ON public.qc_drift_alerts FOR UPDATE
            USING (lab_id IN (SELECT u.lab_id FROM public.users u WHERE u.id = auth.uid()))';
    END IF;
END $$;

-- ============================================================================
-- 11. Verify the update worked
-- ============================================================================

-- Check if any qc_results still have NULL lab_id
DO $$
DECLARE
    null_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO null_count
    FROM public.qc_results
    WHERE lab_id IS NULL;

    IF null_count > 0 THEN
        RAISE NOTICE 'Warning: % qc_results records still have NULL lab_id', null_count;
    ELSE
        RAISE NOTICE 'Success: All qc_results have lab_id set';
    END IF;
END $$;
