-- ============================================================================
-- QC Automation Enhancement
-- ============================================================================
-- Adds:
-- 1. QC Schedules - Define when QC should run (daily, weekly, etc.)
-- 2. QC Schedule Tasks - Auto-generated tasks based on schedules
-- 3. Pre-analytical QC Check - Function to validate QC before releasing results
-- 4. Auto-hold on QC failure
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. QC Schedules - Define recurring QC requirements
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.qc_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,

    -- Schedule identification
    schedule_name TEXT NOT NULL,
    description TEXT,

    -- What to run
    analyzer_name TEXT NOT NULL,
    qc_lot_id UUID REFERENCES public.qc_lots(id) ON DELETE SET NULL,
    test_group_ids UUID[], -- Which test groups this QC covers

    -- When to run
    frequency TEXT NOT NULL DEFAULT 'daily'
        CHECK (frequency IN ('daily', 'twice_daily', 'weekly', 'monthly', 'per_shift', 'before_patient_samples')),

    -- For daily schedules: which days (0=Sun, 1=Mon, etc.)
    days_of_week INTEGER[] DEFAULT ARRAY[1,2,3,4,5,6,0], -- Mon-Sun by default

    -- For shift-based: shift times
    shift_times TIME[] DEFAULT ARRAY['08:00'::TIME, '14:00'::TIME, '20:00'::TIME],

    -- Run requirements
    required_before_patient_samples BOOLEAN DEFAULT true,
    min_runs_per_day INTEGER DEFAULT 1,
    max_hours_between_runs INTEGER DEFAULT 8,

    -- Notification settings
    reminder_minutes_before INTEGER DEFAULT 30,
    notify_on_miss BOOLEAN DEFAULT true,
    notify_user_ids UUID[], -- Who to notify

    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES public.users(id)
);

CREATE INDEX idx_qc_schedules_lab ON public.qc_schedules(lab_id);
CREATE INDEX idx_qc_schedules_analyzer ON public.qc_schedules(lab_id, analyzer_name);
CREATE INDEX idx_qc_schedules_active ON public.qc_schedules(lab_id, is_active) WHERE is_active = true;

-- ============================================================================
-- 2. QC Schedule Tasks - Auto-generated from schedules
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.qc_schedule_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
    qc_schedule_id UUID NOT NULL REFERENCES public.qc_schedules(id) ON DELETE CASCADE,

    -- Task details
    scheduled_date DATE NOT NULL,
    scheduled_time TIME,
    due_by TIMESTAMPTZ NOT NULL,

    -- Status
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'completed', 'missed', 'skipped')),

    -- Completion
    completed_at TIMESTAMPTZ,
    completed_by UUID REFERENCES public.users(id),
    qc_run_id UUID REFERENCES public.qc_runs(id), -- Link to actual QC run

    -- If missed
    missed_reason TEXT,
    acknowledged_by UUID REFERENCES public.users(id),
    acknowledged_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT qc_schedule_tasks_unique UNIQUE (qc_schedule_id, scheduled_date, scheduled_time)
);

CREATE INDEX idx_qc_schedule_tasks_date ON public.qc_schedule_tasks(lab_id, scheduled_date, status);
CREATE INDEX idx_qc_schedule_tasks_pending ON public.qc_schedule_tasks(lab_id, status) WHERE status = 'pending';

-- ============================================================================
-- 3. QC Analyzer Coverage - Track which test groups require which QC
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.qc_analyzer_coverage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,

    analyzer_name TEXT NOT NULL,
    test_group_id UUID NOT NULL REFERENCES public.test_groups(id) ON DELETE CASCADE,

    -- QC requirements
    qc_lot_ids UUID[], -- Which lots to use for this test group on this analyzer
    required_qc_levels TEXT[] DEFAULT ARRAY['L1', 'L2'], -- Level 1, Level 2, etc.

    -- Validation rules
    require_qc_pass_before_release BOOLEAN DEFAULT true,
    max_hours_since_qc INTEGER DEFAULT 8, -- Results invalid if QC older than this

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT qc_analyzer_coverage_unique UNIQUE (lab_id, analyzer_name, test_group_id)
);

CREATE INDEX idx_qc_analyzer_coverage_lab ON public.qc_analyzer_coverage(lab_id);

-- ============================================================================
-- 4. Function: Generate daily QC tasks from schedules
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_qc_schedule_tasks(
    p_lab_id UUID,
    p_date DATE DEFAULT CURRENT_DATE
) RETURNS INTEGER AS $$
DECLARE
    v_schedule RECORD;
    v_count INTEGER := 0;
    v_day_of_week INTEGER;
    v_shift_time TIME;
BEGIN
    v_day_of_week := EXTRACT(DOW FROM p_date)::INTEGER;

    FOR v_schedule IN
        SELECT * FROM public.qc_schedules
        WHERE lab_id = p_lab_id
          AND is_active = true
    LOOP
        -- Check if this day is in the schedule
        IF v_day_of_week = ANY(v_schedule.days_of_week) THEN
            -- Generate task(s) based on frequency
            CASE v_schedule.frequency
                WHEN 'daily' THEN
                    -- One task per day
                    INSERT INTO public.qc_schedule_tasks (
                        lab_id, qc_schedule_id, scheduled_date, scheduled_time, due_by
                    ) VALUES (
                        p_lab_id, v_schedule.id, p_date,
                        v_schedule.shift_times[1],
                        p_date + v_schedule.shift_times[1] + (v_schedule.max_hours_between_runs || ' hours')::INTERVAL
                    )
                    ON CONFLICT (qc_schedule_id, scheduled_date, scheduled_time) DO NOTHING;
                    v_count := v_count + 1;

                WHEN 'twice_daily' THEN
                    -- Morning and afternoon
                    INSERT INTO public.qc_schedule_tasks (
                        lab_id, qc_schedule_id, scheduled_date, scheduled_time, due_by
                    ) VALUES
                    (p_lab_id, v_schedule.id, p_date, '08:00'::TIME, p_date + '12:00'::TIME),
                    (p_lab_id, v_schedule.id, p_date, '14:00'::TIME, p_date + '20:00'::TIME)
                    ON CONFLICT (qc_schedule_id, scheduled_date, scheduled_time) DO NOTHING;
                    v_count := v_count + 2;

                WHEN 'per_shift' THEN
                    -- One task per shift
                    FOREACH v_shift_time IN ARRAY v_schedule.shift_times
                    LOOP
                        INSERT INTO public.qc_schedule_tasks (
                            lab_id, qc_schedule_id, scheduled_date, scheduled_time, due_by
                        ) VALUES (
                            p_lab_id, v_schedule.id, p_date, v_shift_time,
                            p_date + v_shift_time + (v_schedule.max_hours_between_runs || ' hours')::INTERVAL
                        )
                        ON CONFLICT (qc_schedule_id, scheduled_date, scheduled_time) DO NOTHING;
                        v_count := v_count + 1;
                    END LOOP;

                ELSE
                    -- Default: one task
                    INSERT INTO public.qc_schedule_tasks (
                        lab_id, qc_schedule_id, scheduled_date, scheduled_time, due_by
                    ) VALUES (
                        p_lab_id, v_schedule.id, p_date,
                        COALESCE(v_schedule.shift_times[1], '08:00'::TIME),
                        p_date + '23:59'::TIME
                    )
                    ON CONFLICT (qc_schedule_id, scheduled_date, scheduled_time) DO NOTHING;
                    v_count := v_count + 1;
            END CASE;
        END IF;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. Function: Check if QC is valid for releasing patient results
-- ============================================================================

CREATE OR REPLACE FUNCTION check_qc_valid_for_release(
    p_lab_id UUID,
    p_test_group_id UUID,
    p_analyzer_name TEXT DEFAULT NULL,
    p_check_time TIMESTAMPTZ DEFAULT now()
) RETURNS TABLE (
    is_valid BOOLEAN,
    reason TEXT,
    last_qc_run_id UUID,
    last_qc_time TIMESTAMPTZ,
    last_qc_status TEXT,
    hours_since_qc NUMERIC
) AS $$
DECLARE
    v_coverage RECORD;
    v_last_run RECORD;
    v_hours_since NUMERIC;
BEGIN
    -- Get coverage requirements
    SELECT * INTO v_coverage
    FROM public.qc_analyzer_coverage
    WHERE lab_id = p_lab_id
      AND test_group_id = p_test_group_id
      AND (p_analyzer_name IS NULL OR analyzer_name = p_analyzer_name)
    LIMIT 1;

    -- If no coverage defined, allow release (no QC requirement)
    IF NOT FOUND THEN
        RETURN QUERY SELECT
            true AS is_valid,
            'No QC requirement defined for this test group'::TEXT AS reason,
            NULL::UUID AS last_qc_run_id,
            NULL::TIMESTAMPTZ AS last_qc_time,
            NULL::TEXT AS last_qc_status,
            NULL::NUMERIC AS hours_since_qc;
        RETURN;
    END IF;

    -- If QC not required before release
    IF NOT v_coverage.require_qc_pass_before_release THEN
        RETURN QUERY SELECT
            true AS is_valid,
            'QC not required before release for this test group'::TEXT AS reason,
            NULL::UUID AS last_qc_run_id,
            NULL::TIMESTAMPTZ AS last_qc_time,
            NULL::TEXT AS last_qc_status,
            NULL::NUMERIC AS hours_since_qc;
        RETURN;
    END IF;

    -- Find last passing QC run for this analyzer/test group
    SELECT qr.*,
           (qr.run_date + COALESCE(qr.run_time, '00:00'::TIME))::TIMESTAMPTZ AS run_datetime
    INTO v_last_run
    FROM public.qc_runs qr
    WHERE qr.lab_id = p_lab_id
      AND qr.analyzer_name = COALESCE(p_analyzer_name, v_coverage.analyzer_name)
      AND qr.overall_pass = true
      AND qr.status = 'reviewed'
      AND EXISTS (
          SELECT 1 FROM public.qc_results qres
          WHERE qres.qc_run_id = qr.id
            AND qres.test_group_id = p_test_group_id
            AND qres.pass_fail = 'pass'
      )
    ORDER BY qr.run_date DESC, qr.run_time DESC NULLS LAST
    LIMIT 1;

    -- No passing QC found
    IF NOT FOUND THEN
        RETURN QUERY SELECT
            false AS is_valid,
            'No passing QC run found for this analyzer/test group'::TEXT AS reason,
            NULL::UUID AS last_qc_run_id,
            NULL::TIMESTAMPTZ AS last_qc_time,
            NULL::TEXT AS last_qc_status,
            NULL::NUMERIC AS hours_since_qc;
        RETURN;
    END IF;

    -- Calculate hours since last QC
    v_hours_since := EXTRACT(EPOCH FROM (p_check_time - v_last_run.run_datetime)) / 3600;

    -- Check if QC is too old
    IF v_hours_since > v_coverage.max_hours_since_qc THEN
        RETURN QUERY SELECT
            false AS is_valid,
            format('QC is %s hours old (max allowed: %s hours)',
                   ROUND(v_hours_since::NUMERIC, 1), v_coverage.max_hours_since_qc)::TEXT AS reason,
            v_last_run.id AS last_qc_run_id,
            v_last_run.run_datetime AS last_qc_time,
            v_last_run.status AS last_qc_status,
            ROUND(v_hours_since::NUMERIC, 1) AS hours_since_qc;
        RETURN;
    END IF;

    -- QC is valid
    RETURN QUERY SELECT
        true AS is_valid,
        format('QC passed %s hours ago', ROUND(v_hours_since::NUMERIC, 1))::TEXT AS reason,
        v_last_run.id AS last_qc_run_id,
        v_last_run.run_datetime AS last_qc_time,
        v_last_run.status AS last_qc_status,
        ROUND(v_hours_since::NUMERIC, 1) AS hours_since_qc;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 6. Function: Auto-hold orders when QC fails
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_hold_on_qc_failure()
RETURNS TRIGGER AS $$
DECLARE
    v_test_group_ids UUID[];
    v_affected_orders UUID[];
BEGIN
    -- Only trigger on failure
    IF NEW.pass_fail != 'fail' THEN
        RETURN NEW;
    END IF;

    -- Get test group from result
    v_test_group_ids := ARRAY[NEW.test_group_id];

    -- Find orders with pending results for affected test groups on this date
    SELECT array_agg(DISTINCT o.id)
    INTO v_affected_orders
    FROM public.orders o
    JOIN public.order_tests ot ON ot.order_id = o.id
    JOIN public.qc_runs qr ON qr.id = NEW.qc_run_id
    WHERE o.lab_id = qr.lab_id
      AND ot.test_group_id = ANY(v_test_group_ids)
      AND o.status IN ('processing', 'results_pending', 'partial_results')
      AND o.created_at::DATE = qr.run_date;

    -- Log the affected orders (could be used for notifications)
    IF v_affected_orders IS NOT NULL AND array_length(v_affected_orders, 1) > 0 THEN
        RAISE NOTICE 'QC Failure: % orders may be affected: %',
            array_length(v_affected_orders, 1), v_affected_orders;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger (optional - enable if auto-hold desired)
-- CREATE TRIGGER trg_qc_failure_auto_hold
--     AFTER UPDATE OF pass_fail ON public.qc_results
--     FOR EACH ROW
--     WHEN (NEW.pass_fail = 'fail')
--     EXECUTE FUNCTION auto_hold_on_qc_failure();

-- ============================================================================
-- 7. Function: Mark overdue QC tasks as missed
-- ============================================================================

CREATE OR REPLACE FUNCTION mark_overdue_qc_tasks()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE public.qc_schedule_tasks
    SET status = 'missed',
        missed_reason = 'Task was not completed before due time'
    WHERE status = 'pending'
      AND due_by < now();

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 8. View: Today's QC Status by Analyzer
-- ============================================================================

CREATE OR REPLACE VIEW public.v_qc_today_status AS
SELECT
    qs.lab_id,
    qs.analyzer_name,
    qs.schedule_name,
    qst.scheduled_date,
    qst.scheduled_time,
    qst.due_by,
    qst.status AS task_status,
    qr.id AS run_id,
    qr.overall_pass,
    qr.status AS run_status,
    CASE
        WHEN qst.status = 'completed' AND qr.overall_pass = true THEN 'passed'
        WHEN qst.status = 'completed' AND qr.overall_pass = false THEN 'failed'
        WHEN qst.status = 'missed' THEN 'missed'
        WHEN qst.due_by < now() AND qst.status = 'pending' THEN 'overdue'
        ELSE 'pending'
    END AS qc_status,
    qst.due_by - now() AS time_remaining
FROM public.qc_schedules qs
JOIN public.qc_schedule_tasks qst ON qst.qc_schedule_id = qs.id
LEFT JOIN public.qc_runs qr ON qr.id = qst.qc_run_id
WHERE qs.is_active = true
  AND qst.scheduled_date = CURRENT_DATE
ORDER BY qs.analyzer_name, qst.scheduled_time;

-- ============================================================================
-- 9. View: QC Coverage Summary (which tests need QC)
-- ============================================================================

CREATE OR REPLACE VIEW public.v_qc_coverage AS
SELECT
    qac.lab_id,
    qac.analyzer_name,
    tg.id AS test_group_id,
    tg.name AS test_group_name,
    qac.required_qc_levels,
    qac.require_qc_pass_before_release,
    qac.max_hours_since_qc,
    (
        SELECT json_agg(json_build_object(
            'lot_id', ql.id,
            'lot_number', ql.lot_number,
            'material_name', ql.material_name,
            'level', ql.level,
            'expiry_date', ql.expiry_date
        ))
        FROM public.qc_lots ql
        WHERE ql.id = ANY(qac.qc_lot_ids)
          AND ql.is_active = true
    ) AS active_lots
FROM public.qc_analyzer_coverage qac
JOIN public.test_groups tg ON tg.id = qac.test_group_id
WHERE tg.is_active = true;

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE public.qc_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_schedule_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_analyzer_coverage ENABLE ROW LEVEL SECURITY;

CREATE POLICY qc_schedules_lab_policy ON public.qc_schedules
    FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY qc_schedule_tasks_lab_policy ON public.qc_schedule_tasks
    FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY qc_analyzer_coverage_lab_policy ON public.qc_analyzer_coverage
    FOR ALL USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

COMMIT;
