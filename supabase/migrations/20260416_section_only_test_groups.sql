-- Migration: Section-Only Test Groups
-- Date: 2026-04-16
-- Adds is_section_only flag to test_groups.
-- Fixes panel_ready logic (Gap 1) and all_analytes_approved (Gap 2) for groups with no analytes.

-- ─── 1. Add is_section_only column ───────────────────────────────────────────
ALTER TABLE public.test_groups
  ADD COLUMN IF NOT EXISTS is_section_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.test_groups.is_section_only IS
  'When true, this test group has no analytes — doctors fill report sections only. Approval skips analyte verification.';

-- ─── 2. Fix v_result_panel_status (Gap 1) ────────────────────────────────────
-- panel_ready was: result exists AND approved >= expected AND expected > 0
-- New:             result exists AND (
--                    (has analytes AND all approved)
--                    OR is_section_only = true   ← no analytes needed
--                  )
-- Effect on regular groups: zero — the first branch is identical to before.

CREATE OR REPLACE VIEW public.v_result_panel_status AS
WITH all_order_tests AS (
  SELECT
    ot.id AS order_test_id,
    ot.order_id,
    ot.test_group_id,
    tg.name AS test_group_name,
    tg.is_section_only,
    o.patient_id,
    p.name AS patient_name,
    o.order_date,
    o.lab_id,
    o.location_id
  FROM order_tests ot
  JOIN orders o ON o.id = ot.order_id
  JOIN test_groups tg ON tg.id = ot.test_group_id
  LEFT JOIN patients p ON p.id = o.patient_id
),
latest_results AS (
  SELECT DISTINCT ON (r.order_id, r.test_group_id)
    r.id AS result_id,
    r.order_id,
    r.test_group_id
  FROM results r
  LEFT JOIN result_values rv ON rv.result_id = r.id
  ORDER BY
    r.order_id,
    r.test_group_id,
    -- Prefer results that actually have data
    CASE WHEN rv.id IS NOT NULL THEN 0 ELSE 1 END,
    r.created_at DESC
),
analyte_counts AS (
  SELECT
    rv.result_id,
    COUNT(*)                                                              AS expected_analytes,
    COUNT(CASE WHEN rv.value IS NOT NULL AND rv.value != '' THEN 1 END)  AS entered_analytes,
    COUNT(CASE WHEN rv.verify_status = 'approved'           THEN 1 END)  AS approved_analytes
  FROM result_values rv
  GROUP BY rv.result_id
)
SELECT
  COALESCE(lr.result_id, gen_random_uuid())    AS result_id,
  aot.order_id,
  aot.test_group_id,
  aot.test_group_name,
  COALESCE(ac.expected_analytes,  0)           AS expected_analytes,
  COALESCE(ac.entered_analytes,   0)           AS entered_analytes,
  COALESCE(ac.approved_analytes,  0)           AS approved_analytes,
  -- panel_ready logic:
  --   Regular groups : result exists + all analytes approved
  --   Section-only   : result exists (sections filled = ready)
  (
    lr.result_id IS NOT NULL
    AND (
      (NOT aot.is_section_only
        AND COALESCE(ac.expected_analytes, 0) > 0
        AND COALESCE(ac.approved_analytes, 0) >= COALESCE(ac.expected_analytes, 1))
      OR
      (aot.is_section_only)
    )
  )                                            AS panel_ready,
  aot.patient_id,
  aot.patient_name,
  aot.order_date,
  aot.lab_id,
  aot.location_id,
  aot.is_section_only
FROM all_order_tests aot
LEFT JOIN latest_results lr
  ON lr.order_id = aot.order_id AND lr.test_group_id = aot.test_group_id
LEFT JOIN analyte_counts ac
  ON ac.result_id = lr.result_id
ORDER BY aot.order_date DESC, aot.patient_name;

GRANT SELECT ON public.v_result_panel_status TO authenticated;
GRANT SELECT ON public.v_result_panel_status TO anon;

-- ─── 3. Fix v_report_template_context — all_analytes_approved (Gap 2) ─────────
-- BOOL_AND over zero rows = NULL → PDF is always draft for section-only groups.
-- Fix: if no result_values exist, treat as true (vacuous approval).

DROP VIEW IF EXISTS public.v_report_template_context;
CREATE VIEW public.v_report_template_context AS
SELECT
    o.id AS order_id,
    o.order_number,
    o.order_date,
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

    p.name              AS patient_name,
    p.display_id        AS patient_display_id,
    p.patient_number    AS patient_number,
    p.age,
    p.gender,
    p.phone             AS patient_phone,
    p.date_of_birth,
    p.registration_date,

    l.name              AS location_name,
    d.name              AS referring_doctor_name,
    COALESCE(u_collector.name, u_collector.email) AS sample_collected_by,

    (SELECT s.barcode FROM public.samples s
     WHERE s.order_id = o.id AND s.barcode IS NOT NULL
     ORDER BY s.created_at LIMIT 1) AS sample_barcode,

    MAX(rv.verified_at) AS approved_at,

    -- Gap 2 fix: BOOL_AND returns NULL when no rows → treat as true for section-only groups
    CASE
      WHEN COUNT(rv.id) FILTER (WHERE rv.id IS NOT NULL) = 0
      THEN true   -- no analytes = vacuously approved (section-only group)
      ELSE BOOL_AND(
        CASE
          WHEN rv.verify_status IS NULL    THEN false
          WHEN rv.verify_status = 'approved' THEN true
          ELSE false
        END
      )
    END AS all_analytes_approved,

    jsonb_agg(
        DISTINCT jsonb_build_object(
            'result_id',           rv.result_id,
            'analyte_id',          rv.analyte_id,
            'parameter',           COALESCE(la.display_name, la.lab_specific_name, a.name),
            'value',               rv.value,
            'unit',                COALESCE(la.lab_specific_unit, a.unit),
            'method',              COALESCE(rv.method, la.lab_specific_method, la.method),
            'reference_range',     COALESCE(rv.reference_range, la.lab_specific_reference_range, a.reference_range),
            'flag',                rv.flag,
            'verify_status',       rv.verify_status,
            'test_group_id',       tg.id,
            'test_name',           tg.name,
            'normal_range_min',    COALESCE(rv.normal_range_min, la.normal_range_min),
            'normal_range_max',    COALESCE(rv.normal_range_max, la.normal_range_max),
            'low_critical',        COALESCE(rv.low_critical,  la.low_critical,  la.critical_low,  a.low_critical),
            'high_critical',       COALESCE(rv.high_critical, la.high_critical, la.critical_high, a.high_critical),
            'reference_range_male',   COALESCE(rv.reference_range_male,   la.reference_range_male,   a.reference_range_male),
            'reference_range_female', COALESCE(rv.reference_range_female, la.reference_range_female, a.reference_range_female),
            'value_type',          COALESCE(rv.value_type, la.value_type, a.value_type),
            'expected_normal_values', COALESCE(la.expected_normal_values, a.expected_normal_values),
            'code',                a.code,
            'interpretation_low',    COALESCE(la.lab_specific_interpretation_low,    la.interpretation_low,    a.interpretation_low),
            'interpretation_normal', COALESCE(la.lab_specific_interpretation_normal, la.interpretation_normal, a.interpretation_normal),
            'interpretation_high',   COALESCE(la.lab_specific_interpretation_high,   la.interpretation_high,   a.interpretation_high),
            'ai_interpretation',            rv.ai_interpretation,
            'ai_suggested_flag',            rv.ai_suggested_flag,
            'ai_suggested_interpretation',  rv.ai_suggested_interpretation,
            'is_auto_calculated',  rv.is_auto_calculated,
            'is_calculated',       a.is_calculated,
            'sort_order',          tga.sort_order,
            'section_heading',     tga.section_heading
        )
    ) FILTER (WHERE rv.id IS NOT NULL) AS analytes,

    array_agg(DISTINCT COALESCE(la.display_name, la.lab_specific_name, a.name))
        FILTER (WHERE a.name IS NOT NULL) AS analyte_parameters,

    array_agg(DISTINCT tg.id) FILTER (WHERE tg.id IS NOT NULL) AS test_group_ids

FROM orders o
LEFT JOIN patients       p            ON o.patient_id             = p.id
LEFT JOIN locations      l            ON o.location_id            = l.id
LEFT JOIN doctors        d            ON o.referring_doctor_id    = d.id
LEFT JOIN users          u_collector  ON o.sample_collected_by    = u_collector.email
LEFT JOIN order_tests    ot           ON o.id                     = ot.order_id
LEFT JOIN test_groups    tg           ON ot.test_group_id         = tg.id
LEFT JOIN test_group_analytes tga     ON tg.id                    = tga.test_group_id
LEFT JOIN analytes       a            ON tga.analyte_id           = a.id
LEFT JOIN lab_analytes   la           ON a.id                     = la.analyte_id AND o.lab_id = la.lab_id
LEFT JOIN result_values  rv           ON rv.order_id              = o.id AND rv.analyte_id = a.id

GROUP BY
    o.id, o.order_number, o.order_date, o.status, o.total_amount,
    o.sample_collected_at, o.sample_received_at, o.sample_id,
    o.color_code, o.color_name, o.qr_code_data, o.created_at,
    o.lab_id, o.patient_id, o.location_id, o.referring_doctor_id, o.approved_by,
    p.name, p.display_id, p.patient_number, p.age, p.gender, p.phone,
    p.date_of_birth, p.registration_date,
    l.name, d.name, u_collector.name, u_collector.email;

GRANT SELECT ON public.v_report_template_context TO authenticated;

COMMENT ON VIEW public.v_report_template_context IS
  'Report template context — all_analytes_approved is true when no analytes exist (section-only groups).';
