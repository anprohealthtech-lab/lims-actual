-- Expose real result presence/status on the verification queue view.
-- The UI should not infer a result exists from entered analyte counts.

DROP VIEW IF EXISTS public.v_result_panel_status CASCADE;

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
  FROM public.order_tests ot
  JOIN public.orders o ON o.id = ot.order_id
  JOIN public.test_groups tg ON tg.id = ot.test_group_id
  LEFT JOIN public.patients p ON p.id = o.patient_id
),
latest_results AS (
  SELECT DISTINCT ON (r.order_id, r.test_group_id)
    r.id AS result_id,
    r.order_id,
    r.test_group_id,
    r.verification_status
  FROM public.results r
  LEFT JOIN public.result_values rv ON rv.result_id = r.id
  ORDER BY
    r.order_id,
    r.test_group_id,
    CASE WHEN rv.id IS NOT NULL THEN 0 ELSE 1 END,
    r.created_at DESC
),
analyte_counts AS (
  SELECT
    rv.result_id,
    COUNT(*) AS expected_analytes,
    COUNT(CASE WHEN rv.value IS NOT NULL AND rv.value != '' THEN 1 END) AS entered_analytes,
    COUNT(CASE WHEN rv.verify_status = 'approved' THEN 1 END) AS approved_analytes,
    COUNT(CASE WHEN COALESCE(rv.is_hidden_from_report, false) THEN 1 END) AS hidden_analytes,
    COUNT(CASE
      WHEN COALESCE(rv.is_hidden_from_report, false)
        OR rv.verify_status = 'approved'
        OR (rv.value IS NOT NULL AND rv.value != '')
      THEN 1
    END) AS handled_analytes
  FROM public.result_values rv
  GROUP BY rv.result_id
)
SELECT
  COALESCE(lr.result_id, gen_random_uuid()) AS result_id,
  lr.result_id IS NOT NULL AS has_result,
  lr.verification_status AS result_verification_status,
  aot.order_id,
  aot.test_group_id,
  aot.test_group_name,
  COALESCE(ac.expected_analytes, 0) AS expected_analytes,
  COALESCE(ac.entered_analytes, 0) AS entered_analytes,
  COALESCE(ac.approved_analytes, 0) AS approved_analytes,
  COALESCE(ac.hidden_analytes, 0) AS hidden_analytes,
  COALESCE(ac.handled_analytes, 0) AS handled_analytes,
  (
    lr.result_id IS NOT NULL
    AND (
      (NOT aot.is_section_only
        AND COALESCE(ac.expected_analytes, 0) > 0
        AND (COALESCE(ac.approved_analytes, 0) + COALESCE(ac.hidden_analytes, 0)) >= COALESCE(ac.expected_analytes, 1))
      OR aot.is_section_only
    )
  ) AS panel_ready,
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

COMMENT ON VIEW public.v_result_panel_status IS
'Shows panel readiness for order tests, including whether a real results row exists and its verification_status.';
