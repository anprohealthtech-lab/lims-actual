-- Migration: Section-Only Test Progress Tracking
-- Date: 2026-06-16
-- Problem: Section-only tests (e.g., Ultrasound, X-Ray reports) show 0% progress
--          on Orders/Dashboard pages because v_order_test_progress_enhanced only
--          tracks analyte-based progress, not section content.
--
-- Solution:
-- 1. Add is_section_only flag to progress view
-- 2. Add has_section_content check (content saved in result_section_content)
-- 3. Add section_verification_status for approval tracking
-- 4. Adjust expected/entered/verified counts for section-only tests (1/1 model)
-- 5. Fix approved_at in report context for section-only tests

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Update v_order_test_progress_enhanced to support section-only tests
-- ═══════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS v_order_test_progress_enhanced CASCADE;

CREATE VIEW v_order_test_progress_enhanced AS
WITH section_content_check AS (
  -- Pre-compute which (order_id, test_group_id) pairs have saved section content
  SELECT DISTINCT
    r.order_id,
    r.test_group_id,
    r.id AS result_id,
    r.verification_status,
    r.verified_at,
    true AS has_content
  FROM results r
  WHERE EXISTS (
    SELECT 1 FROM result_section_content rsc
    WHERE rsc.result_id = r.id
      AND rsc.final_content IS NOT NULL
      AND btrim(rsc.final_content) != ''
  )
)
SELECT
    o.id AS order_id,
    o.patient_id,
    o.patient_name,
    o.sample_id,
    o.color_code,
    o.color_name,
    o.status AS order_status,
    o.priority,
    o.order_date,
    o.created_at,
    o.sample_collected_at,
    o.sample_received_at,
    COALESCE(o.sample_collected_at, o.created_at) AS work_date,
    o.lab_id,
    o.location_id,
    ot.id AS order_test_id,
    tg.id AS test_group_id,
    tg.name AS test_group_name,
    tg.department,
    tg.tat_hours,
    tg.sample_type,
    tg.sample_color,

    -- NEW: Section-only flag
    COALESCE(tg.is_section_only, false) AS is_section_only,

    -- NEW: Has saved section content
    COALESCE(scc.has_content, false) AS has_section_content,

    -- NEW: Section verification status (for section-only tests)
    scc.verification_status AS section_verification_status,

    -- NEW: Section verified timestamp
    scc.verified_at AS section_verified_at,

    -- UPDATED: For section-only, use 1 as expected; otherwise count analytes
    CASE
      WHEN COALESCE(tg.is_section_only, false) THEN 1
      ELSE COUNT(DISTINCT tga.analyte_id)
    END AS total_analytes,

    CASE
      WHEN COALESCE(tg.is_section_only, false) THEN 1
      ELSE COUNT(DISTINCT tga.analyte_id)
    END AS expected_analytes,

    -- UPDATED: For section-only, 1 if content saved; otherwise count entered values
    CASE
      WHEN COALESCE(tg.is_section_only, false) THEN
        CASE WHEN scc.has_content THEN 1 ELSE 0 END
      ELSE COUNT(DISTINCT CASE
          WHEN rv.value IS NOT NULL AND rv.value != ''
          THEN tga.analyte_id
      END)
    END AS completed_analytes,

    CASE
      WHEN COALESCE(tg.is_section_only, false) THEN
        CASE WHEN scc.has_content THEN 1 ELSE 0 END
      ELSE COUNT(DISTINCT CASE
          WHEN rv.value IS NOT NULL AND rv.value != ''
          THEN tga.analyte_id
      END)
    END AS entered_analytes,

    -- UPDATED: Panel status includes section-only logic
    CASE
      WHEN COALESCE(tg.is_section_only, false) THEN
        CASE
          WHEN scc.verification_status = 'verified' THEN 'verified'
          WHEN scc.has_content THEN 'pending_approval'
          ELSE 'not_started'
        END
      WHEN COUNT(DISTINCT CASE
          WHEN rv.value IS NOT NULL AND rv.value != ''
          THEN tga.analyte_id
      END) = 0 THEN 'not_started'
      WHEN COUNT(DISTINCT CASE
          WHEN rv.value IS NOT NULL AND rv.value != ''
          THEN tga.analyte_id
      END) < COUNT(DISTINCT tga.analyte_id) THEN 'in_progress'
      ELSE 'completed'
    END AS panel_status,

    -- UPDATED: is_verified includes section-only logic
    CASE
      WHEN COALESCE(tg.is_section_only, false) THEN
        COALESCE(scc.verification_status = 'verified', false)
      WHEN COUNT(DISTINCT tga.analyte_id) > 0
           AND COUNT(DISTINCT CASE
              WHEN rv.verify_status = 'approved'
                  AND rv.value IS NOT NULL
                  AND rv.value != ''
              THEN tga.analyte_id
           END) = COUNT(DISTINCT tga.analyte_id) THEN true
      ELSE false
    END AS is_verified,

    -- UPDATED: Completion percentage for section-only
    CASE
      WHEN COALESCE(tg.is_section_only, false) THEN
        CASE WHEN scc.has_content THEN 100 ELSE 0 END
      WHEN COUNT(DISTINCT tga.analyte_id) > 0 THEN
        ROUND(
          (COUNT(DISTINCT CASE
              WHEN rv.value IS NOT NULL AND rv.value != ''
              THEN tga.analyte_id
          END)::numeric / COUNT(DISTINCT tga.analyte_id)::numeric) * 100, 0)
      ELSE 0
    END AS completion_percentage,

    -- Workflow eligibility (unchanged for section-only - they don't use workflows)
    CASE
      WHEN COALESCE(tg.is_section_only, false) THEN false
      WHEN COUNT(DISTINCT CASE
          WHEN rv.value IS NOT NULL AND rv.value != ''
          THEN tga.analyte_id
      END) = 0
           AND EXISTS (
              SELECT 1
              FROM test_workflow_map m
              JOIN workflow_versions wv ON m.workflow_version_id = wv.id
              JOIN workflows w ON wv.workflow_id = w.id
              WHERE m.lab_id = o.lab_id
                AND (m.test_group_id = tg.id OR m.test_code = tg.code::text)
                AND COALESCE(w.active, true) = true
                AND COALESCE(wv.active, true) = true
           ) THEN true
      ELSE false
    END AS workflow_eligible,

    COUNT(DISTINCT CASE WHEN r.status = 'Entered' THEN r.id END) AS entered_count,
    COUNT(DISTINCT CASE WHEN r.status = 'Under Review' THEN r.id END) AS under_review_count,
    COUNT(DISTINCT CASE WHEN r.status = 'Approved' THEN r.id END) AS approved_count,
    COUNT(DISTINCT CASE WHEN r.status = 'Reported' THEN r.id END) AS reported_count,

    COUNT(DISTINCT CASE WHEN rv.flag::text = 'C' THEN r.id END) AS critical_count,
    COUNT(DISTINCT CASE
        WHEN rv.flag::text IN ('H','L','C') THEN r.id
    END) AS abnormal_count,

    GREATEST(
        o.created_at,
        COALESCE(MAX(r.entered_date)::timestamptz, o.created_at),
        COALESCE(MAX(r.reviewed_date)::timestamptz, o.created_at)
    ) AS last_activity,

    (EXTRACT(EPOCH FROM (now() - o.created_at)) / 3600)::numeric AS hours_since_order,

    COALESCE(o.sample_received_at, o.sample_collected_at) AS tat_start_time,

    CASE
        WHEN tg.tat_hours IS NOT NULL AND COALESCE(o.sample_received_at, o.sample_collected_at) IS NOT NULL
            THEN tg.tat_hours - (EXTRACT(EPOCH FROM (now() - COALESCE(o.sample_received_at, o.sample_collected_at))) / 3600)::numeric
        ELSE NULL
    END AS hours_until_tat_breach,

    CASE
        WHEN tg.tat_hours IS NOT NULL AND COALESCE(o.sample_received_at, o.sample_collected_at) IS NOT NULL
            AND (now() > (COALESCE(o.sample_received_at, o.sample_collected_at) + (tg.tat_hours || ' hours')::interval))
            THEN true
        ELSE false
    END AS is_tat_breached

FROM orders o
JOIN order_tests ot ON o.id = ot.order_id
JOIN test_groups tg ON ot.test_group_id = tg.id
LEFT JOIN test_group_analytes tga ON tg.id = tga.test_group_id
LEFT JOIN results r ON r.order_test_id = ot.id
LEFT JOIN result_values rv ON rv.result_id = r.id AND rv.analyte_id = tga.analyte_id
LEFT JOIN section_content_check scc ON scc.order_id = o.id AND scc.test_group_id = tg.id

GROUP BY
    o.id, o.patient_id, o.patient_name, o.sample_id,
    o.status, o.priority, o.order_date, o.created_at,
    o.sample_collected_at, o.sample_received_at,
    o.lab_id, o.location_id, o.color_code, o.color_name,
    ot.id, tg.id, tg.name, tg.department, tg.tat_hours, tg.sample_type, tg.sample_color,
    tg.is_section_only,
    scc.has_content, scc.verification_status, scc.verified_at

ORDER BY
    CASE o.priority
        WHEN 'STAT' THEN 1
        WHEN 'Urgent' THEN 2
        ELSE 3
    END,
    o.order_date DESC;

GRANT SELECT ON v_order_test_progress_enhanced TO authenticated;
GRANT SELECT ON v_order_test_progress_enhanced TO anon;

COMMENT ON VIEW v_order_test_progress_enhanced IS
'Order test progress view with section-only test support. Section-only tests show 100% when content is saved.';


-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Update v_report_template_context to include section-only approved_at
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_report_template_context AS
SELECT
    o.id AS order_id,
    o.order_number,
    o.order_date,
    o.report_date,
    o.status,
    o.total_amount,
    o.sample_collected_at,
    o.sample_received_at,
    o.sample_id,
    o.color_code,
    o.color_name,
    o.qr_code_data,
    o.created_at AS order_created_at,
    o.lab_id,
    o.patient_id,
    o.location_id,
    o.referring_doctor_id,
    o.approved_by,

    p.name AS patient_name,
    p.display_id AS patient_display_id,
    p.patient_number AS patient_number,
    p.age,
    p.gender,
    p.phone AS patient_phone,
    p.date_of_birth,
    p.registration_date,

    l.name AS location_name,
    d.name AS referring_doctor_name,
    COALESCE(u_collector.name, u_collector.email) AS sample_collected_by,

    (SELECT s.barcode FROM public.samples s WHERE s.order_id = o.id AND s.barcode IS NOT NULL ORDER BY s.created_at LIMIT 1) AS sample_barcode,

    -- UPDATED: Include section-only verified_at in approved_at calculation
    GREATEST(
      MAX(rv.verified_at),
      (SELECT MAX(r2.verified_at) FROM results r2
       JOIN test_groups tg2 ON r2.test_group_id = tg2.id
       WHERE r2.order_id = o.id
         AND tg2.is_section_only = true
         AND r2.verification_status = 'verified')
    ) AS approved_at,

    BOOL_AND(
        CASE
            WHEN rv.id IS NULL THEN true
            WHEN COALESCE(rv.is_hidden_from_report, false) THEN true
            WHEN rv.verify_status = 'approved' THEN true
            ELSE false
        END
    ) AS all_analytes_approved,

    jsonb_agg(
        DISTINCT jsonb_build_object(
            'result_id', rv.result_id,
            'analyte_id', rv.analyte_id,
            'parameter', COALESCE(la.display_name, la.lab_specific_name, a.name),
            'value', rv.value,
            'unit', COALESCE(rv.unit, la.lab_specific_unit, a.unit),
            'method', COALESCE(rv.method, la.lab_specific_method, la.method),
            'reference_range', COALESCE(rv.reference_range, la.lab_specific_reference_range, a.reference_range),
            'flag', rv.flag,
            'verify_status', rv.verify_status,
            'test_group_id', tg.id,
            'test_name', tg.name,
            'normal_range_min', COALESCE(rv.normal_range_min, la.normal_range_min),
            'normal_range_max', COALESCE(rv.normal_range_max, la.normal_range_max),
            'low_critical', COALESCE(rv.low_critical, la.low_critical, la.critical_low, a.low_critical),
            'high_critical', COALESCE(rv.high_critical, la.high_critical, la.critical_high, a.high_critical),
            'reference_range_male', COALESCE(rv.reference_range_male, la.reference_range_male, a.reference_range_male),
            'reference_range_female', COALESCE(rv.reference_range_female, la.reference_range_female, a.reference_range_female),
            'value_type', COALESCE(rv.value_type, la.value_type, a.value_type),
            'expected_normal_values', COALESCE(la.expected_normal_values, a.expected_normal_values),
            'code', a.code,
            'interpretation_low', COALESCE(la.lab_specific_interpretation_low, la.interpretation_low, a.interpretation_low),
            'interpretation_normal', COALESCE(la.lab_specific_interpretation_normal, la.interpretation_normal, a.interpretation_normal),
            'interpretation_high', COALESCE(la.lab_specific_interpretation_high, la.interpretation_high, a.interpretation_high),
            'ai_interpretation', rv.ai_interpretation,
            'ai_suggested_flag', rv.ai_suggested_flag,
            'ai_suggested_interpretation', rv.ai_suggested_interpretation,
            'is_auto_calculated', rv.is_auto_calculated,
            'is_calculated', a.is_calculated,
            'sort_order', tga.sort_order,
            'section_heading', tga.section_heading
        )
    ) FILTER (WHERE rv.id IS NOT NULL AND NOT COALESCE(rv.is_hidden_from_report, false)) AS analytes,

    array_agg(DISTINCT COALESCE(la.display_name, la.lab_specific_name, a.name))
        FILTER (WHERE a.name IS NOT NULL AND rv.id IS NOT NULL AND NOT COALESCE(rv.is_hidden_from_report, false)) AS analyte_parameters,

    array_agg(DISTINCT tg.id)
        FILTER (
          WHERE tg.id IS NOT NULL
            AND (
              tg.is_section_only
              OR (rv.id IS NOT NULL AND NOT COALESCE(rv.is_hidden_from_report, false))
            )
        ) AS test_group_ids

FROM orders o
LEFT JOIN patients p ON o.patient_id = p.id
LEFT JOIN locations l ON o.location_id = l.id
LEFT JOIN doctors d ON o.referring_doctor_id = d.id
LEFT JOIN users u_collector ON o.sample_collected_by = u_collector.email
LEFT JOIN order_tests ot ON o.id = ot.order_id
LEFT JOIN test_groups tg ON ot.test_group_id = tg.id
LEFT JOIN test_group_analytes tga ON tg.id = tga.test_group_id
LEFT JOIN analytes a ON tga.analyte_id = a.id
LEFT JOIN lab_analytes la ON a.id = la.analyte_id AND o.lab_id = la.lab_id
LEFT JOIN result_values rv ON rv.order_id = o.id AND rv.analyte_id = a.id

GROUP BY
    o.id, o.order_number, o.order_date, o.report_date, o.status, o.total_amount,
    o.sample_collected_at, o.sample_received_at, o.sample_id,
    o.color_code, o.color_name, o.qr_code_data, o.created_at,
    o.lab_id, o.patient_id, o.location_id, o.referring_doctor_id, o.approved_by,
    p.name, p.display_id, p.patient_number, p.age, p.gender, p.phone,
    p.date_of_birth, p.registration_date,
    l.name, d.name, u_collector.name, u_collector.email;

GRANT SELECT ON public.v_report_template_context TO authenticated;

COMMENT ON VIEW public.v_report_template_context IS
'Report template context with section-only approved_at included in timestamp calculation.';
