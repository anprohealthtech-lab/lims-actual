-- ============================================================================
-- Add Test Groups and Analyzer to QC Lots
-- ============================================================================
-- QC lots need to be linked to specific test groups and analyzers so that:
-- 1. The system knows which analytes to validate for a given lot
-- 2. Pre-analytical QC checks can validate results for specific test groups
-- 3. Target values can be filtered by test group
-- ============================================================================

-- Add analyzer_name to qc_lots (which analyzer this lot is used on)
ALTER TABLE public.qc_lots
ADD COLUMN IF NOT EXISTS analyzer_name TEXT;

-- Add test_group_ids to qc_lots (which test groups this lot covers)
ALTER TABLE public.qc_lots
ADD COLUMN IF NOT EXISTS test_group_ids UUID[] DEFAULT '{}';

-- Create index for efficient querying by analyzer
CREATE INDEX IF NOT EXISTS idx_qc_lots_analyzer
ON public.qc_lots(lab_id, analyzer_name)
WHERE analyzer_name IS NOT NULL;

-- Create index for efficient querying by test groups (GIN for array)
CREATE INDEX IF NOT EXISTS idx_qc_lots_test_groups
ON public.qc_lots USING GIN(test_group_ids);

-- ============================================================================
-- Update the QC Lots View to include test group details
-- ============================================================================

DROP VIEW IF EXISTS public.v_qc_lots_with_groups;

CREATE OR REPLACE VIEW public.v_qc_lots_with_groups AS
SELECT
    l.*,
    (l.expiry_date < CURRENT_DATE) as is_expired,
    CASE
        WHEN l.opened_date IS NOT NULL AND l.stability_days_after_opening IS NOT NULL
        THEN LEAST(l.expiry_date, l.opened_date + (l.stability_days_after_opening || ' days')::INTERVAL)
        ELSE l.expiry_date
    END as effective_expiry,
    -- Get test group names as array
    (
        SELECT ARRAY_AGG(tg.name ORDER BY tg.name)
        FROM public.test_groups tg
        WHERE tg.id = ANY(l.test_group_ids)
    ) as test_group_names,
    -- Get test group count
    COALESCE(array_length(l.test_group_ids, 1), 0) as test_group_count
FROM public.qc_lots l;

-- ============================================================================
-- Function to get valid QC lots for a test group
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_qc_lots_for_test_group(
    p_lab_id UUID,
    p_test_group_id UUID,
    p_analyzer_name TEXT DEFAULT NULL
)
RETURNS TABLE (
    lot_id UUID,
    lot_number TEXT,
    material_name TEXT,
    level TEXT,
    analyzer_name TEXT,
    expiry_date DATE,
    is_active BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        l.id as lot_id,
        l.lot_number,
        l.material_name,
        l.level,
        l.analyzer_name,
        l.expiry_date,
        l.is_active
    FROM public.qc_lots l
    WHERE l.lab_id = p_lab_id
      AND l.is_active = true
      AND l.expiry_date >= CURRENT_DATE
      AND p_test_group_id = ANY(l.test_group_ids)
      AND (p_analyzer_name IS NULL OR l.analyzer_name = p_analyzer_name)
    ORDER BY l.level, l.material_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.get_qc_lots_for_test_group IS
'Get all active, non-expired QC lots that cover a specific test group';

-- ============================================================================
-- Function to check if QC is valid for releasing patient results
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_qc_coverage(
    p_lab_id UUID,
    p_test_group_id UUID,
    p_analyzer_name TEXT DEFAULT NULL
)
RETURNS TABLE (
    has_coverage BOOLEAN,
    lot_count INTEGER,
    lots_with_targets INTEGER,
    last_qc_run_date DATE,
    last_qc_status TEXT
) AS $$
DECLARE
    v_lot_count INTEGER;
    v_lots_with_targets INTEGER;
    v_last_run RECORD;
BEGIN
    -- Count active lots that cover this test group
    SELECT COUNT(*)::INTEGER INTO v_lot_count
    FROM public.qc_lots l
    WHERE l.lab_id = p_lab_id
      AND l.is_active = true
      AND l.expiry_date >= CURRENT_DATE
      AND p_test_group_id = ANY(l.test_group_ids)
      AND (p_analyzer_name IS NULL OR l.analyzer_name = p_analyzer_name);

    -- Count lots that have target values configured
    SELECT COUNT(DISTINCT l.id)::INTEGER INTO v_lots_with_targets
    FROM public.qc_lots l
    JOIN public.qc_target_values tv ON tv.qc_lot_id = l.id
    WHERE l.lab_id = p_lab_id
      AND l.is_active = true
      AND l.expiry_date >= CURRENT_DATE
      AND p_test_group_id = ANY(l.test_group_ids)
      AND (p_analyzer_name IS NULL OR l.analyzer_name = p_analyzer_name);

    -- Get last QC run for this test group
    SELECT
        r.run_date,
        r.status
    INTO v_last_run
    FROM public.qc_runs r
    JOIN public.qc_results res ON res.qc_run_id = r.id
    WHERE r.lab_id = p_lab_id
      AND res.test_group_id = p_test_group_id
      AND (p_analyzer_name IS NULL OR r.analyzer_name = p_analyzer_name)
    ORDER BY r.run_date DESC, r.created_at DESC
    LIMIT 1;

    RETURN QUERY
    SELECT
        (v_lot_count > 0 AND v_lots_with_targets > 0) as has_coverage,
        v_lot_count,
        v_lots_with_targets,
        v_last_run.run_date,
        v_last_run.status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.check_qc_coverage IS
'Check if proper QC coverage exists for a test group on an analyzer';
