-- =============================================
-- AI-First Quality Control Module
-- Extends the existing QC schema with AI capabilities
-- NABL/ISO 15189:2022 Compliant
-- =============================================

-- =============================================
-- 1. QC Evidence Table - OCR/Scan Audit Trail
-- =============================================
CREATE TABLE IF NOT EXISTS public.qc_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qc_run_id UUID NOT NULL REFERENCES public.qc_runs(id) ON DELETE CASCADE,
    qc_result_id UUID REFERENCES public.qc_results(id) ON DELETE SET NULL,
    lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,

    -- Source identification
    source_type TEXT NOT NULL CHECK (source_type IN ('camera', 'pdf_upload', 'analyzer_screenshot', 'manual')),

    -- File storage
    file_url TEXT,
    file_path TEXT,
    original_filename TEXT,
    file_type TEXT,
    file_size INTEGER,

    -- OCR extraction data
    ocr_json JSONB, -- Raw OCR output from Gemini Vision
    extraction_confidence NUMERIC CHECK (extraction_confidence >= 0 AND extraction_confidence <= 1),
    extracted_values JSONB, -- Structured extracted values: {analyzer, lot, level, results[]}

    -- Matching results
    matched_lot_id UUID REFERENCES public.qc_lots(id) ON DELETE SET NULL,
    matched_analyte_ids UUID[], -- Array of matched analyte IDs
    matching_suggestions JSONB, -- {analyte_name: [{id, name, confidence}]}

    -- Correction tracking (NABL audit requirement)
    correction_json JSONB, -- [{field, original_value, corrected_value, corrected_at}]
    corrected_by UUID REFERENCES public.users(id),
    corrected_at TIMESTAMPTZ,
    correction_reason TEXT,

    -- AI processing metadata
    ai_model_used TEXT,
    ai_processing_time_ms INTEGER,
    ai_prompt_used TEXT,
    ai_raw_response JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES public.users(id)
);

-- Indexes for qc_evidence
CREATE INDEX idx_qc_evidence_run ON public.qc_evidence(qc_run_id);
CREATE INDEX idx_qc_evidence_lab ON public.qc_evidence(lab_id);
CREATE INDEX idx_qc_evidence_source ON public.qc_evidence(source_type);
CREATE INDEX idx_qc_evidence_created ON public.qc_evidence(created_at DESC);

-- RLS Policy for qc_evidence
ALTER TABLE public.qc_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY qc_evidence_lab_policy ON public.qc_evidence
    FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

COMMENT ON TABLE public.qc_evidence IS 'Stores OCR/scan evidence for QC data entry with full audit trail for NABL compliance';


-- =============================================
-- 2. QC Investigations Table - CAPA/RCA Tracking
-- =============================================
CREATE TABLE IF NOT EXISTS public.qc_investigations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
    qc_run_id UUID REFERENCES public.qc_runs(id) ON DELETE SET NULL,

    -- Investigation identification
    investigation_number TEXT, -- Auto-generated: INV-YYYYMMDD-0001
    title TEXT NOT NULL,
    description TEXT,

    -- Severity and scope
    severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    impacted_test_group_ids UUID[], -- Array of affected test groups
    impacted_analyte_ids UUID[], -- Array of affected analytes
    impacted_order_ids UUID[], -- Orders that may need result hold

    -- Westgard violation details (from qc_run)
    westgard_violations TEXT[], -- ['1:3s', '2:2s', etc.]
    violation_details JSONB, -- {analyte_id: {rule, z_score, action_required}}

    -- AI-generated content (suggested, not final - NABL requires human review)
    ai_summary TEXT, -- "What happened" plain language
    ai_likely_causes JSONB, -- [{cause, probability: high|medium|low, evidence: []}]
    ai_recommendations JSONB, -- [{action, priority: immediate|soon|scheduled, rationale, task_type}]
    ai_impact_assessment JSONB, -- {affected_tests, orders_to_hold, recommendation}
    ai_context_used JSONB, -- Records used for AI analysis (audit trail)
    ai_model_used TEXT,
    ai_generated_at TIMESTAMPTZ,

    -- Human-reviewed final content (required for NABL)
    final_problem_statement TEXT,
    final_root_cause TEXT,
    final_immediate_correction TEXT,
    final_corrective_action TEXT,
    final_preventive_action TEXT,
    verification_plan TEXT,
    verification_evidence JSONB, -- [{type, description, date, file_url}]
    effectiveness_check TEXT,

    -- Status workflow
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'pending_review', 'closed', 'cancelled')),

    -- Result hold control (critical for patient safety)
    hold_patient_results BOOLEAN DEFAULT false,
    hold_reason TEXT,
    hold_scope TEXT, -- 'all_pending' | 'specific_tests' | 'time_range'
    hold_applied_by UUID REFERENCES public.users(id),
    hold_applied_at TIMESTAMPTZ,
    hold_released_by UUID REFERENCES public.users(id),
    hold_released_at TIMESTAMPTZ,
    release_justification TEXT,

    -- Assignment and review
    assigned_to UUID REFERENCES public.users(id),
    assigned_by UUID REFERENCES public.users(id),
    assigned_at TIMESTAMPTZ,

    reviewed_by UUID REFERENCES public.users(id),
    reviewed_at TIMESTAMPTZ,
    reviewer_notes TEXT,

    -- Closure (requires reviewer sign-off)
    closed_by UUID REFERENCES public.users(id),
    closed_at TIMESTAMPTZ,
    closure_summary TEXT,

    -- Timestamps
    due_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES public.users(id)
);

-- Indexes for qc_investigations
CREATE INDEX idx_qc_investigations_lab ON public.qc_investigations(lab_id);
CREATE INDEX idx_qc_investigations_status ON public.qc_investigations(lab_id, status);
CREATE INDEX idx_qc_investigations_severity ON public.qc_investigations(lab_id, severity);
CREATE INDEX idx_qc_investigations_run ON public.qc_investigations(qc_run_id);
CREATE INDEX idx_qc_investigations_assigned ON public.qc_investigations(assigned_to) WHERE status NOT IN ('closed', 'cancelled');
CREATE INDEX idx_qc_investigations_hold ON public.qc_investigations(lab_id) WHERE hold_patient_results = true;

-- Auto-generate investigation number
CREATE OR REPLACE FUNCTION generate_investigation_number()
RETURNS TRIGGER AS $$
DECLARE
    seq_num INTEGER;
BEGIN
    -- Get the next sequence number for this lab today
    SELECT COALESCE(MAX(
        CASE
            WHEN investigation_number ~ '^INV-[0-9]{8}-[0-9]{4}$'
            THEN CAST(SUBSTRING(investigation_number FROM 14 FOR 4) AS INTEGER)
            ELSE 0
        END
    ), 0) + 1 INTO seq_num
    FROM public.qc_investigations
    WHERE lab_id = NEW.lab_id
    AND investigation_number LIKE 'INV-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-%';

    NEW.investigation_number := 'INV-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(seq_num::TEXT, 4, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_investigation_number
    BEFORE INSERT ON public.qc_investigations
    FOR EACH ROW
    WHEN (NEW.investigation_number IS NULL)
    EXECUTE FUNCTION generate_investigation_number();

-- Auto-update updated_at
CREATE TRIGGER trg_investigations_updated_at
    BEFORE UPDATE ON public.qc_investigations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS Policy for qc_investigations
ALTER TABLE public.qc_investigations ENABLE ROW LEVEL SECURITY;
CREATE POLICY qc_investigations_lab_policy ON public.qc_investigations
    FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

COMMENT ON TABLE public.qc_investigations IS 'Tracks QC failure investigations with AI-assisted CAPA generation and human review workflow';


-- =============================================
-- 3. QC Tasks Table - Actionable Task Tracking
-- =============================================
CREATE TABLE IF NOT EXISTS public.qc_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,

    -- Task linkage (at least one should be set)
    qc_run_id UUID REFERENCES public.qc_runs(id) ON DELETE SET NULL,
    qc_investigation_id UUID REFERENCES public.qc_investigations(id) ON DELETE SET NULL,
    qc_lot_id UUID REFERENCES public.qc_lots(id) ON DELETE SET NULL,
    calibration_id UUID REFERENCES public.calibration_records(id) ON DELETE SET NULL,

    -- Task details
    task_type TEXT NOT NULL CHECK (task_type IN (
        'repeat_qc', 'recalibrate', 'change_reagent', 'change_lot',
        'service_call', 'review_capa', 'verify_results', 'manual_check',
        'lot_verification', 'maintenance', 'documentation', 'training', 'other'
    )),
    title TEXT NOT NULL,
    description TEXT,
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),

    -- Source of task (manual or AI-generated)
    source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'ai_recommendation', 'westgard_rule', 'drift_alert', 'system')),
    ai_recommendation_json JSONB, -- Original AI recommendation if source = 'ai_recommendation'

    -- Assignment
    assigned_to UUID REFERENCES public.users(id),
    assigned_by UUID REFERENCES public.users(id),
    assigned_at TIMESTAMPTZ,

    -- Due dates
    due_date DATE,
    reminder_date DATE,
    escalation_date DATE, -- When to escalate if not done

    -- Completion
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled', 'overdue', 'escalated')),
    started_at TIMESTAMPTZ,
    completed_by UUID REFERENCES public.users(id),
    completed_at TIMESTAMPTZ,
    completion_notes TEXT,
    completion_evidence JSONB, -- [{type, description, file_url}]

    -- Verification (for critical tasks)
    requires_verification BOOLEAN DEFAULT false,
    verified_by UUID REFERENCES public.users(id),
    verified_at TIMESTAMPTZ,
    verification_notes TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES public.users(id)
);

-- Indexes for qc_tasks
CREATE INDEX idx_qc_tasks_lab ON public.qc_tasks(lab_id);
CREATE INDEX idx_qc_tasks_status ON public.qc_tasks(lab_id, status);
CREATE INDEX idx_qc_tasks_assigned ON public.qc_tasks(assigned_to, status);
CREATE INDEX idx_qc_tasks_due ON public.qc_tasks(lab_id, due_date) WHERE status IN ('pending', 'in_progress');
CREATE INDEX idx_qc_tasks_investigation ON public.qc_tasks(qc_investigation_id);
CREATE INDEX idx_qc_tasks_run ON public.qc_tasks(qc_run_id);
CREATE INDEX idx_qc_tasks_priority ON public.qc_tasks(lab_id, priority) WHERE status = 'pending';

-- Auto-update updated_at
CREATE TRIGGER trg_tasks_updated_at
    BEFORE UPDATE ON public.qc_tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Auto-mark overdue tasks
CREATE OR REPLACE FUNCTION mark_overdue_qc_tasks()
RETURNS void AS $$
BEGIN
    UPDATE public.qc_tasks
    SET status = 'overdue', updated_at = now()
    WHERE status IN ('pending', 'in_progress')
    AND due_date < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;

-- RLS Policy for qc_tasks
ALTER TABLE public.qc_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY qc_tasks_lab_policy ON public.qc_tasks
    FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

COMMENT ON TABLE public.qc_tasks IS 'Tracks actionable QC tasks from AI recommendations, Westgard violations, and manual creation';


-- =============================================
-- 4. QC Drift Alerts Table - AI Trend Detection
-- =============================================
CREATE TABLE IF NOT EXISTS public.qc_drift_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,

    -- Scope
    analyzer_id UUID,
    analyzer_name TEXT,
    qc_lot_id UUID REFERENCES public.qc_lots(id) ON DELETE SET NULL,
    analyte_id UUID REFERENCES public.analytes(id) ON DELETE SET NULL,
    test_group_id UUID REFERENCES public.test_groups(id) ON DELETE SET NULL,

    -- Alert identification
    alert_code TEXT, -- Auto-generated: DFT-YYYYMMDD-0001
    alert_type TEXT NOT NULL CHECK (alert_type IN (
        'slow_drift', 'sudden_shift', 'lot_change', 'analyzer_variation',
        'operator_effect', 'cusum_alert', 'ewma_alert', 'trend_warning',
        'calibration_drift', 'reagent_degradation'
    )),
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),

    -- Alert content
    title TEXT NOT NULL,
    description TEXT NOT NULL,

    -- Statistical data
    analysis_period_start DATE,
    analysis_period_end DATE,
    data_points_analyzed INTEGER,
    trend_data JSONB, -- {dates: [], z_scores: [], values: [], target_mean, target_sd}
    statistical_summary JSONB, -- {mean_bias, cusum_value, ewma_value, trend_slope, r_squared}

    -- Risk assessment
    risk_score NUMERIC CHECK (risk_score >= 0 AND risk_score <= 100),
    risk_factors JSONB, -- [{factor, weight, contribution}]

    -- AI analysis
    ai_analysis TEXT, -- Plain language explanation
    ai_recommendations JSONB, -- [{action, priority, rationale}]
    ai_predicted_impact JSONB, -- {days_until_failure, confidence}
    ai_model_used TEXT,
    ai_generated_at TIMESTAMPTZ,

    -- Status workflow
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'investigating', 'resolved', 'dismissed', 'false_positive')),

    -- Acknowledgment
    acknowledged_by UUID REFERENCES public.users(id),
    acknowledged_at TIMESTAMPTZ,
    acknowledgment_notes TEXT,

    -- Resolution
    resolution_action TEXT, -- What was done
    resolved_by UUID REFERENCES public.users(id),
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,

    -- Link to investigation if escalated
    investigation_id UUID REFERENCES public.qc_investigations(id) ON DELETE SET NULL,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ -- Auto-dismiss after this time if not acted upon
);

-- Indexes for qc_drift_alerts
CREATE INDEX idx_qc_drift_alerts_lab ON public.qc_drift_alerts(lab_id);
CREATE INDEX idx_qc_drift_alerts_active ON public.qc_drift_alerts(lab_id, status) WHERE status = 'active';
CREATE INDEX idx_qc_drift_alerts_analyzer ON public.qc_drift_alerts(lab_id, analyzer_name);
CREATE INDEX idx_qc_drift_alerts_analyte ON public.qc_drift_alerts(analyte_id);
CREATE INDEX idx_qc_drift_alerts_severity ON public.qc_drift_alerts(lab_id, severity) WHERE status = 'active';
CREATE INDEX idx_qc_drift_alerts_created ON public.qc_drift_alerts(created_at DESC);

-- Auto-generate alert code
CREATE OR REPLACE FUNCTION generate_drift_alert_code()
RETURNS TRIGGER AS $$
DECLARE
    seq_num INTEGER;
BEGIN
    SELECT COALESCE(MAX(
        CASE
            WHEN alert_code ~ '^DFT-[0-9]{8}-[0-9]{4}$'
            THEN CAST(SUBSTRING(alert_code FROM 14 FOR 4) AS INTEGER)
            ELSE 0
        END
    ), 0) + 1 INTO seq_num
    FROM public.qc_drift_alerts
    WHERE lab_id = NEW.lab_id
    AND alert_code LIKE 'DFT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-%';

    NEW.alert_code := 'DFT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(seq_num::TEXT, 4, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_drift_alert_code
    BEFORE INSERT ON public.qc_drift_alerts
    FOR EACH ROW
    WHEN (NEW.alert_code IS NULL)
    EXECUTE FUNCTION generate_drift_alert_code();

-- RLS Policy for qc_drift_alerts
ALTER TABLE public.qc_drift_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY qc_drift_alerts_lab_policy ON public.qc_drift_alerts
    FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

COMMENT ON TABLE public.qc_drift_alerts IS 'Stores AI-detected drift alerts with CUSUM/EWMA analysis and trend prediction';


-- =============================================
-- 5. Views for Dashboard and Reporting
-- =============================================

-- View: QC Dashboard Summary
CREATE OR REPLACE VIEW public.v_qc_dashboard AS
SELECT
    lab_id,
    run_date,
    COUNT(*) as total_runs,
    COUNT(*) FILTER (WHERE overall_pass = true) as passed_runs,
    COUNT(*) FILTER (WHERE overall_pass = false) as failed_runs,
    COUNT(*) FILTER (WHERE status = 'pending') as pending_review,
    ROUND(
        COUNT(*) FILTER (WHERE overall_pass = true)::NUMERIC /
        NULLIF(COUNT(*)::NUMERIC, 0) * 100,
        1
    ) as pass_rate,
    array_agg(DISTINCT unnest) FILTER (WHERE unnest IS NOT NULL) as violation_types
FROM public.qc_runs
LEFT JOIN LATERAL unnest(westgard_violations) ON true
GROUP BY lab_id, run_date;

-- View: Active Investigations Summary
CREATE OR REPLACE VIEW public.v_qc_active_investigations AS
SELECT
    i.*,
    u.full_name as assigned_to_name,
    r.run_date,
    r.analyzer_name,
    CASE
        WHEN i.due_date < CURRENT_DATE AND i.status NOT IN ('closed', 'cancelled') THEN true
        ELSE false
    END as is_overdue
FROM public.qc_investigations i
LEFT JOIN public.users u ON i.assigned_to = u.id
LEFT JOIN public.qc_runs r ON i.qc_run_id = r.id
WHERE i.status NOT IN ('closed', 'cancelled');

-- View: Pending Tasks Summary
CREATE OR REPLACE VIEW public.v_qc_pending_tasks AS
SELECT
    t.*,
    u.full_name as assigned_to_name,
    i.investigation_number,
    r.run_date,
    CASE
        WHEN t.due_date < CURRENT_DATE AND t.status = 'pending' THEN true
        ELSE false
    END as is_overdue
FROM public.qc_tasks t
LEFT JOIN public.users u ON t.assigned_to = u.id
LEFT JOIN public.qc_investigations i ON t.qc_investigation_id = i.id
LEFT JOIN public.qc_runs r ON t.qc_run_id = r.id
WHERE t.status IN ('pending', 'in_progress');

-- View: Expiring Lots
CREATE OR REPLACE VIEW public.v_qc_expiring_lots AS
SELECT
    l.*,
    CASE
        WHEN l.opened_date IS NOT NULL AND l.stability_days_after_opening IS NOT NULL
        THEN l.opened_date + (l.stability_days_after_opening || ' days')::INTERVAL
        ELSE l.expiry_date::TIMESTAMP
    END as effective_expiry,
    CASE
        WHEN l.opened_date IS NOT NULL AND l.stability_days_after_opening IS NOT NULL
        THEN (l.opened_date + (l.stability_days_after_opening || ' days')::INTERVAL)::DATE - CURRENT_DATE
        ELSE l.expiry_date - CURRENT_DATE
    END as days_until_expiry
FROM public.qc_lots l
WHERE l.is_active = true
AND (
    (l.opened_date IS NOT NULL AND l.stability_days_after_opening IS NOT NULL
     AND l.opened_date + (l.stability_days_after_opening || ' days')::INTERVAL <= CURRENT_DATE + INTERVAL '30 days')
    OR
    (l.expiry_date <= CURRENT_DATE + 30)
);


-- =============================================
-- 6. Functions for QC Operations
-- =============================================

-- Function: Create investigation from failed QC run
CREATE OR REPLACE FUNCTION create_investigation_from_run(
    p_qc_run_id UUID,
    p_created_by UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_investigation_id UUID;
    v_run RECORD;
BEGIN
    -- Get run details
    SELECT * INTO v_run FROM public.qc_runs WHERE id = p_qc_run_id;

    IF v_run IS NULL THEN
        RAISE EXCEPTION 'QC Run not found: %', p_qc_run_id;
    END IF;

    -- Create investigation
    INSERT INTO public.qc_investigations (
        lab_id,
        qc_run_id,
        title,
        description,
        severity,
        westgard_violations,
        status,
        created_by
    ) VALUES (
        v_run.lab_id,
        p_qc_run_id,
        'QC Failure Investigation - ' || v_run.analyzer_name || ' - ' || v_run.run_date,
        'Automatic investigation created for failed QC run with Westgard violations: ' ||
            COALESCE(array_to_string(v_run.westgard_violations, ', '), 'None specified'),
        CASE
            WHEN '1_3s' = ANY(v_run.westgard_violations) THEN 'high'
            WHEN 'R_4s' = ANY(v_run.westgard_violations) THEN 'high'
            ELSE 'medium'
        END,
        v_run.westgard_violations,
        'open',
        p_created_by
    ) RETURNING id INTO v_investigation_id;

    RETURN v_investigation_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Create task from AI recommendation
CREATE OR REPLACE FUNCTION create_task_from_recommendation(
    p_lab_id UUID,
    p_recommendation JSONB,
    p_qc_run_id UUID DEFAULT NULL,
    p_investigation_id UUID DEFAULT NULL,
    p_created_by UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_task_id UUID;
BEGIN
    INSERT INTO public.qc_tasks (
        lab_id,
        qc_run_id,
        qc_investigation_id,
        task_type,
        title,
        description,
        priority,
        source,
        ai_recommendation_json,
        created_by
    ) VALUES (
        p_lab_id,
        p_qc_run_id,
        p_investigation_id,
        COALESCE(p_recommendation->>'task_type', 'manual_check'),
        COALESCE(p_recommendation->>'action', 'Review QC Issue'),
        p_recommendation->>'rationale',
        CASE p_recommendation->>'priority'
            WHEN 'immediate' THEN 'urgent'
            WHEN 'soon' THEN 'high'
            WHEN 'scheduled' THEN 'medium'
            ELSE 'medium'
        END,
        'ai_recommendation',
        p_recommendation,
        p_created_by
    ) RETURNING id INTO v_task_id;

    RETURN v_task_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Apply result hold for investigation
CREATE OR REPLACE FUNCTION apply_investigation_hold(
    p_investigation_id UUID,
    p_hold_reason TEXT,
    p_applied_by UUID
)
RETURNS void AS $$
BEGIN
    UPDATE public.qc_investigations
    SET
        hold_patient_results = true,
        hold_reason = p_hold_reason,
        hold_applied_by = p_applied_by,
        hold_applied_at = now(),
        updated_at = now()
    WHERE id = p_investigation_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Release investigation hold
CREATE OR REPLACE FUNCTION release_investigation_hold(
    p_investigation_id UUID,
    p_justification TEXT,
    p_released_by UUID
)
RETURNS void AS $$
BEGIN
    UPDATE public.qc_investigations
    SET
        hold_patient_results = false,
        hold_released_by = p_released_by,
        hold_released_at = now(),
        release_justification = p_justification,
        updated_at = now()
    WHERE id = p_investigation_id;
END;
$$ LANGUAGE plpgsql;


-- =============================================
-- 7. Audit Triggers
-- =============================================

-- Trigger: Log investigation status changes
CREATE OR REPLACE FUNCTION log_investigation_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        -- Could insert into an audit log table here
        RAISE NOTICE 'Investigation % status changed from % to % by user',
            NEW.id, OLD.status, NEW.status;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_investigation_status_audit
    AFTER UPDATE ON public.qc_investigations
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION log_investigation_status_change();


-- =============================================
-- 8. Grant Permissions
-- =============================================

-- Grant access to authenticated users (RLS will handle lab-level filtering)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qc_evidence TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qc_investigations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qc_tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qc_drift_alerts TO authenticated;

GRANT SELECT ON public.v_qc_dashboard TO authenticated;
GRANT SELECT ON public.v_qc_active_investigations TO authenticated;
GRANT SELECT ON public.v_qc_pending_tasks TO authenticated;
GRANT SELECT ON public.v_qc_expiring_lots TO authenticated;

-- Grant execute on functions
GRANT EXECUTE ON FUNCTION create_investigation_from_run TO authenticated;
GRANT EXECUTE ON FUNCTION create_task_from_recommendation TO authenticated;
GRANT EXECUTE ON FUNCTION apply_investigation_hold TO authenticated;
GRANT EXECUTE ON FUNCTION release_investigation_hold TO authenticated;
GRANT EXECUTE ON FUNCTION mark_overdue_qc_tasks TO authenticated;
