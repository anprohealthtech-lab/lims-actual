-- ============================================================================
-- Quality Control Module for NABL Accreditation
-- ============================================================================
-- This migration creates tables for:
-- 1. QC Lot Management (reagent lots, control materials)
-- 2. QC Run Tracking (daily/periodic QC runs)
-- 3. QC Results with Westgard Rules validation
-- 4. EQC (External Quality Control) tracking
-- 5. Calibration records
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. QC Materials / Control Lots
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.qc_lots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,

    -- Lot identification
    lot_number TEXT NOT NULL,
    material_name TEXT NOT NULL,
    manufacturer TEXT,
    catalog_number TEXT,

    -- Lot type: internal_control, calibrator, reagent
    lot_type TEXT NOT NULL DEFAULT 'internal_control'
        CHECK (lot_type IN ('internal_control', 'calibrator', 'reagent', 'external_control')),

    -- Level for multi-level controls (L1, L2, L3, etc.)
    level TEXT,

    -- Validity
    received_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expiry_date DATE NOT NULL,
    opened_date DATE,
    stability_days_after_opening INTEGER,

    -- Storage
    storage_temperature TEXT,
    storage_location TEXT,

    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,

    -- Metadata
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES public.users(id),

    CONSTRAINT qc_lots_unique_lot UNIQUE (lab_id, lot_number, material_name)
);

CREATE INDEX idx_qc_lots_lab ON public.qc_lots(lab_id);
CREATE INDEX idx_qc_lots_active ON public.qc_lots(lab_id, is_active) WHERE is_active = true;

-- View to include dynamic expiry status
CREATE OR REPLACE VIEW public.v_qc_lots AS
SELECT
    *,
    (expiry_date < CURRENT_DATE) as is_expired
FROM public.qc_lots;

-- ============================================================================
-- 2. QC Target Values (Expected ranges per lot per analyte)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.qc_target_values (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qc_lot_id UUID NOT NULL REFERENCES public.qc_lots(id) ON DELETE CASCADE,
    analyte_id UUID NOT NULL REFERENCES public.analytes(id) ON DELETE CASCADE,
    test_group_id UUID REFERENCES public.test_groups(id) ON DELETE SET NULL,

    -- Target statistics (from manufacturer or calculated)
    target_mean NUMERIC NOT NULL,
    target_sd NUMERIC NOT NULL,
    target_cv_percent NUMERIC GENERATED ALWAYS AS (
        CASE WHEN target_mean != 0 THEN (target_sd / target_mean) * 100 ELSE 0 END
    ) STORED,

    -- Acceptable ranges
    range_1sd_low NUMERIC GENERATED ALWAYS AS (target_mean - target_sd) STORED,
    range_1sd_high NUMERIC GENERATED ALWAYS AS (target_mean + target_sd) STORED,
    range_2sd_low NUMERIC GENERATED ALWAYS AS (target_mean - (2 * target_sd)) STORED,
    range_2sd_high NUMERIC GENERATED ALWAYS AS (target_mean + (2 * target_sd)) STORED,
    range_3sd_low NUMERIC GENERATED ALWAYS AS (target_mean - (3 * target_sd)) STORED,
    range_3sd_high NUMERIC GENERATED ALWAYS AS (target_mean + (3 * target_sd)) STORED,

    -- Unit
    unit TEXT,

    -- Source of target values
    source TEXT DEFAULT 'manufacturer' CHECK (source IN ('manufacturer', 'calculated', 'peer_group')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT qc_target_unique UNIQUE (qc_lot_id, analyte_id)
);

CREATE INDEX idx_qc_targets_lot ON public.qc_target_values(qc_lot_id);
CREATE INDEX idx_qc_targets_analyte ON public.qc_target_values(analyte_id);

-- ============================================================================
-- 3. QC Runs (Daily/Periodic QC execution)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.qc_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,

    -- Run identification
    run_date DATE NOT NULL DEFAULT CURRENT_DATE,
    run_time TIME,
    run_number INTEGER, -- For multiple runs per day

    -- Equipment/Analyzer
    analyzer_id UUID, -- Could reference an analyzers table if exists
    analyzer_name TEXT,

    -- Operator
    operator_id UUID REFERENCES public.users(id),
    operator_name TEXT,

    -- Run type
    run_type TEXT NOT NULL DEFAULT 'routine'
        CHECK (run_type IN ('routine', 'calibration_verification', 'new_lot', 'maintenance', 'troubleshooting')),

    -- Status
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'completed', 'reviewed', 'rejected')),

    -- Review
    reviewed_by UUID REFERENCES public.users(id),
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,

    -- Overall result
    overall_pass BOOLEAN,
    westgard_violations TEXT[], -- Array of violation codes

    -- Metadata
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT qc_runs_unique_daily UNIQUE (lab_id, run_date, run_number, analyzer_name)
);

CREATE INDEX idx_qc_runs_lab_date ON public.qc_runs(lab_id, run_date DESC);
CREATE INDEX idx_qc_runs_status ON public.qc_runs(lab_id, status);

-- ============================================================================
-- 4. QC Results (Individual QC measurements)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.qc_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qc_run_id UUID NOT NULL REFERENCES public.qc_runs(id) ON DELETE CASCADE,
    qc_lot_id UUID NOT NULL REFERENCES public.qc_lots(id) ON DELETE RESTRICT,
    analyte_id UUID NOT NULL REFERENCES public.analytes(id) ON DELETE RESTRICT,
    test_group_id UUID REFERENCES public.test_groups(id) ON DELETE SET NULL,

    -- Measurement
    observed_value NUMERIC NOT NULL,
    unit TEXT,

    -- Target comparison (snapshot at time of measurement)
    target_mean NUMERIC NOT NULL,
    target_sd NUMERIC NOT NULL,

    -- Calculated statistics
    z_score NUMERIC GENERATED ALWAYS AS (
        CASE WHEN target_sd != 0 THEN (observed_value - target_mean) / target_sd ELSE 0 END
    ) STORED,
    deviation_percent NUMERIC GENERATED ALWAYS AS (
        CASE WHEN target_mean != 0 THEN ((observed_value - target_mean) / target_mean) * 100 ELSE 0 END
    ) STORED,

    -- Westgard rule evaluation
    pass_fail TEXT NOT NULL DEFAULT 'pending' CHECK (pass_fail IN ('pass', 'fail', 'warning', 'pending')),
    westgard_flags TEXT[], -- Array: ['1_2s', '2_2s', 'R_4s', etc.]

    -- Manual override
    override_pass_fail TEXT CHECK (override_pass_fail IN ('pass', 'fail', 'warning')),
    override_reason TEXT,
    override_by UUID REFERENCES public.users(id),
    override_at TIMESTAMPTZ,

    -- Linked to workflow (if QC done via workflow)
    workflow_instance_id UUID REFERENCES public.order_workflow_instances(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT qc_results_unique UNIQUE (qc_run_id, qc_lot_id, analyte_id)
);

CREATE INDEX idx_qc_results_run ON public.qc_results(qc_run_id);
CREATE INDEX idx_qc_results_lot ON public.qc_results(qc_lot_id);
CREATE INDEX idx_qc_results_analyte ON public.qc_results(analyte_id);
CREATE INDEX idx_qc_results_date ON public.qc_results(created_at DESC);

-- ============================================================================
-- 5. Westgard Rules Configuration
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.westgard_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,

    rule_code TEXT NOT NULL, -- '1_2s', '1_3s', '2_2s', 'R_4s', '4_1s', '10x'
    rule_name TEXT NOT NULL,
    description TEXT,

    -- Rule behavior
    is_warning BOOLEAN NOT NULL DEFAULT false, -- Warning vs Rejection rule
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    priority INTEGER NOT NULL DEFAULT 100, -- Lower = higher priority

    -- Rule parameters (for configurable rules)
    parameters JSONB DEFAULT '{}',

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT westgard_rules_unique UNIQUE (lab_id, rule_code)
);

-- Insert default Westgard rules for each lab (will be copied per lab)
CREATE OR REPLACE FUNCTION setup_default_westgard_rules(p_lab_id UUID)
RETURNS void AS $$
BEGIN
    INSERT INTO public.westgard_rules (lab_id, rule_code, rule_name, description, is_warning, priority)
    VALUES
        (p_lab_id, '1_2s', '1:2s Warning', 'One control exceeds mean ± 2SD (warning only)', true, 10),
        (p_lab_id, '1_3s', '1:3s Rejection', 'One control exceeds mean ± 3SD', false, 20),
        (p_lab_id, '2_2s', '2:2s Rejection', 'Two consecutive controls exceed mean + 2SD or mean - 2SD', false, 30),
        (p_lab_id, 'R_4s', 'R:4s Rejection', 'One control exceeds +2SD and another exceeds -2SD (range > 4SD)', false, 40),
        (p_lab_id, '4_1s', '4:1s Rejection', 'Four consecutive controls exceed mean + 1SD or mean - 1SD', false, 50),
        (p_lab_id, '10x', '10x Rejection', 'Ten consecutive controls on same side of mean', false, 60)
    ON CONFLICT (lab_id, rule_code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 6. External Quality Control (EQC/EQAS) Programs
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.eqc_programs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,

    program_name TEXT NOT NULL, -- 'RIQAS', 'CAP', 'EQAS', etc.
    provider TEXT NOT NULL,
    enrollment_id TEXT, -- Lab's enrollment ID with provider

    -- Cycle information
    cycle_year INTEGER NOT NULL,
    cycle_name TEXT,

    -- Tests covered
    test_group_ids UUID[], -- Array of test group IDs

    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_eqc_programs_lab ON public.eqc_programs(lab_id);

-- ============================================================================
-- 7. EQC Survey Results
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.eqc_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    eqc_program_id UUID NOT NULL REFERENCES public.eqc_programs(id) ON DELETE CASCADE,

    -- Survey identification
    survey_number TEXT NOT NULL,
    sample_id TEXT NOT NULL,

    -- Submission
    submission_date DATE,
    submitted_by UUID REFERENCES public.users(id),

    -- Results
    analyte_id UUID REFERENCES public.analytes(id),
    analyte_name TEXT NOT NULL,
    submitted_value NUMERIC,
    submitted_unit TEXT,

    -- Peer group comparison (from provider)
    peer_mean NUMERIC,
    peer_sd NUMERIC,
    peer_cv_percent NUMERIC,
    peer_n INTEGER,

    -- Performance
    z_score NUMERIC,
    bias_percent NUMERIC,
    performance_grade TEXT, -- 'Acceptable', 'Unacceptable', etc.

    -- Status
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'submitted', 'results_received', 'reviewed')),

    -- Review
    reviewed_by UUID REFERENCES public.users(id),
    reviewed_at TIMESTAMPTZ,
    corrective_action TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT eqc_results_unique UNIQUE (eqc_program_id, survey_number, sample_id, analyte_name)
);

CREATE INDEX idx_eqc_results_program ON public.eqc_results(eqc_program_id);
CREATE INDEX idx_eqc_results_status ON public.eqc_results(status);

-- ============================================================================
-- 8. Calibration Records
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.calibration_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,

    -- Equipment
    analyzer_name TEXT NOT NULL,
    analyzer_serial TEXT,

    -- Calibration info
    calibration_date DATE NOT NULL DEFAULT CURRENT_DATE,
    calibration_time TIME,
    calibrator_lot_id UUID REFERENCES public.qc_lots(id),
    calibrator_lot_number TEXT,

    -- Test/Analyte
    test_group_id UUID REFERENCES public.test_groups(id),
    analyte_id UUID REFERENCES public.analytes(id),
    analyte_name TEXT,

    -- Calibration results
    calibration_type TEXT DEFAULT 'two_point'
        CHECK (calibration_type IN ('blank', 'one_point', 'two_point', 'multi_point', 'full')),
    slope NUMERIC,
    intercept NUMERIC,
    correlation_r2 NUMERIC,

    -- Status
    status TEXT NOT NULL DEFAULT 'completed'
        CHECK (status IN ('pending', 'completed', 'failed', 'expired')),
    pass_fail TEXT CHECK (pass_fail IN ('pass', 'fail')),

    -- Next calibration
    next_calibration_date DATE,

    -- Performer
    performed_by UUID REFERENCES public.users(id),
    verified_by UUID REFERENCES public.users(id),
    verified_at TIMESTAMPTZ,

    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_calibration_lab_date ON public.calibration_records(lab_id, calibration_date DESC);
CREATE INDEX idx_calibration_analyzer ON public.calibration_records(lab_id, analyzer_name);

-- ============================================================================
-- 9. QC Summary View (for dashboards)
-- ============================================================================

CREATE OR REPLACE VIEW public.v_qc_summary AS
SELECT
    qr.lab_id,
    qr.run_date,
    qr.analyzer_name,
    COUNT(DISTINCT qres.id) as total_results,
    COUNT(DISTINCT qres.id) FILTER (WHERE qres.pass_fail = 'pass') as passed,
    COUNT(DISTINCT qres.id) FILTER (WHERE qres.pass_fail = 'fail') as failed,
    COUNT(DISTINCT qres.id) FILTER (WHERE qres.pass_fail = 'warning') as warnings,
    ROUND(
        (COUNT(DISTINCT qres.id) FILTER (WHERE qres.pass_fail = 'pass')::NUMERIC /
         NULLIF(COUNT(DISTINCT qres.id), 0) * 100), 2
    ) as pass_rate,
    (
        SELECT array_agg(DISTINCT violation)
        FROM (
            SELECT unnest(qres2.westgard_flags) as violation
            FROM public.qc_results qres2
            WHERE qres2.qc_run_id = qr.id
              AND qres2.westgard_flags IS NOT NULL
        ) v
    ) as violations
FROM public.qc_runs qr
LEFT JOIN public.qc_results qres ON qres.qc_run_id = qr.id
GROUP BY qr.lab_id, qr.run_date, qr.analyzer_name, qr.id;

-- ============================================================================
-- 10. Function to evaluate Westgard rules
-- ============================================================================

CREATE OR REPLACE FUNCTION evaluate_westgard_rules(
    p_qc_result_id UUID
) RETURNS TEXT[] AS $$
DECLARE
    v_result RECORD;
    v_violations TEXT[] := '{}';
    v_z NUMERIC;
    v_prev_results NUMERIC[];
BEGIN
    -- Get the result
    SELECT * INTO v_result FROM public.qc_results WHERE id = p_qc_result_id;

    IF NOT FOUND THEN
        RETURN v_violations;
    END IF;

    v_z := v_result.z_score;

    -- 1:3s rule - Immediate rejection
    IF ABS(v_z) > 3 THEN
        v_violations := array_append(v_violations, '1_3s');
    END IF;

    -- 1:2s rule - Warning
    IF ABS(v_z) > 2 THEN
        v_violations := array_append(v_violations, '1_2s');
    END IF;

    -- Get previous results for consecutive rules
    SELECT array_agg(z_score ORDER BY created_at DESC)
    INTO v_prev_results
    FROM (
        SELECT z_score, created_at
        FROM public.qc_results
        WHERE qc_lot_id = v_result.qc_lot_id
          AND analyte_id = v_result.analyte_id
          AND id != p_qc_result_id
        ORDER BY created_at DESC
        LIMIT 9
    ) sub;

    -- 2:2s rule - Two consecutive > 2SD same side
    IF v_prev_results IS NOT NULL AND array_length(v_prev_results, 1) >= 1 THEN
        IF (v_z > 2 AND v_prev_results[1] > 2) OR (v_z < -2 AND v_prev_results[1] < -2) THEN
            v_violations := array_append(v_violations, '2_2s');
        END IF;
    END IF;

    -- R:4s rule - Range > 4SD
    IF v_prev_results IS NOT NULL AND array_length(v_prev_results, 1) >= 1 THEN
        IF (v_z > 2 AND v_prev_results[1] < -2) OR (v_z < -2 AND v_prev_results[1] > 2) THEN
            v_violations := array_append(v_violations, 'R_4s');
        END IF;
    END IF;

    -- 4:1s rule - Four consecutive > 1SD same side
    IF v_prev_results IS NOT NULL AND array_length(v_prev_results, 1) >= 3 THEN
        IF (v_z > 1 AND v_prev_results[1] > 1 AND v_prev_results[2] > 1 AND v_prev_results[3] > 1) OR
           (v_z < -1 AND v_prev_results[1] < -1 AND v_prev_results[2] < -1 AND v_prev_results[3] < -1) THEN
            v_violations := array_append(v_violations, '4_1s');
        END IF;
    END IF;

    -- 10x rule - Ten consecutive same side of mean
    IF v_prev_results IS NOT NULL AND array_length(v_prev_results, 1) >= 9 THEN
        DECLARE
            v_all_positive BOOLEAN := v_z > 0;
            v_all_negative BOOLEAN := v_z < 0;
            i INTEGER;
        BEGIN
            FOR i IN 1..9 LOOP
                v_all_positive := v_all_positive AND v_prev_results[i] > 0;
                v_all_negative := v_all_negative AND v_prev_results[i] < 0;
            END LOOP;

            IF v_all_positive OR v_all_negative THEN
                v_violations := array_append(v_violations, '10x');
            END IF;
        END;
    END IF;

    -- Update the result with violations
    UPDATE public.qc_results
    SET westgard_flags = v_violations,
        pass_fail = CASE
            WHEN '1_3s' = ANY(v_violations) OR '2_2s' = ANY(v_violations) OR
                 'R_4s' = ANY(v_violations) OR '4_1s' = ANY(v_violations) OR
                 '10x' = ANY(v_violations) THEN 'fail'
            WHEN '1_2s' = ANY(v_violations) THEN 'warning'
            ELSE 'pass'
        END
    WHERE id = p_qc_result_id;

    RETURN v_violations;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 11. Trigger to auto-evaluate Westgard rules on insert
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_evaluate_westgard()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM evaluate_westgard_rules(NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_qc_results_westgard
    AFTER INSERT ON public.qc_results
    FOR EACH ROW
    EXECUTE FUNCTION trigger_evaluate_westgard();

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE public.qc_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_target_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.westgard_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eqc_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eqc_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calibration_records ENABLE ROW LEVEL SECURITY;

-- Basic RLS: Users can only see their lab's data
CREATE POLICY qc_lots_lab_policy ON public.qc_lots
    FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY qc_runs_lab_policy ON public.qc_runs
    FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY westgard_rules_lab_policy ON public.westgard_rules
    FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY eqc_programs_lab_policy ON public.eqc_programs
    FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY calibration_lab_policy ON public.calibration_records
    FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

COMMIT;
