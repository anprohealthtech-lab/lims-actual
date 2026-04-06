-- Fix v_result_panel_status to include analyzer interface results.
--
-- Problem: instrument results come in via process-analyzer-result which creates a
-- `results` row without test_group_id (it isn't known at insert time).
-- The old view had WHERE r.test_group_id IS NOT NULL in latest_results, so those
-- rows were invisible to the verification console.
--
-- Fix: drop the IS NOT NULL guard and instead let the join to all_order_tests
-- (which is already keyed on order_id + test_group_id) do the filtering.
-- Rows with null test_group_id on the results table can now surface if the edge
-- function backfills test_group_id after AI mapping (see process-analyzer-result fix).

BEGIN;

DROP VIEW IF EXISTS v_result_panel_status CASCADE;

CREATE OR REPLACE VIEW v_result_panel_status AS
WITH all_order_tests AS (
  SELECT
    ot.id       AS order_test_id,
    ot.order_id,
    ot.test_group_id,
    tg.name     AS test_group_name,
    o.patient_id,
    p.name      AS patient_name,
    o.order_date,
    o.lab_id,
    o.location_id
  FROM order_tests ot
  INNER JOIN orders   o  ON o.id  = ot.order_id
  LEFT  JOIN patients p  ON p.id  = o.patient_id
  LEFT  JOIN test_groups tg ON tg.id = ot.test_group_id
  WHERE ot.test_group_id IS NOT NULL
),
latest_results AS (
  -- Most-recent result per (order_id, test_group_id).
  -- NULL test_group_id rows are now included so that analyzer results
  -- (which get test_group_id backfilled after AI mapping) are not dropped.
  SELECT DISTINCT ON (r.order_id, r.test_group_id)
    r.id            AS result_id,
    r.order_id,
    r.test_group_id
  FROM results r
  ORDER BY
    r.order_id,
    r.test_group_id,
    CASE
      WHEN r.test_name LIKE '%Workflow%' THEN 1
      WHEN r.test_name LIKE '%Panel%'    THEN 2
      ELSE 3
    END,
    r.created_at DESC
),
analyte_counts AS (
  SELECT
    rv.result_id,
    COUNT(*)                                                             AS expected_analytes,
    COUNT(CASE WHEN rv.value IS NOT NULL AND rv.value != '' THEN 1 END) AS entered_analytes,
    COUNT(CASE WHEN rv.verify_status = 'approved'           THEN 1 END) AS approved_analytes
  FROM result_values rv
  GROUP BY rv.result_id
)
SELECT
  COALESCE(lr.result_id, gen_random_uuid())   AS result_id,
  aot.order_id,
  aot.test_group_id,
  aot.test_group_name,
  COALESCE(ac.expected_analytes,  0)          AS expected_analytes,
  COALESCE(ac.entered_analytes,   0)          AS entered_analytes,
  COALESCE(ac.approved_analytes,  0)          AS approved_analytes,
  (
    lr.result_id IS NOT NULL
    AND COALESCE(ac.approved_analytes, 0) >= GREATEST(COALESCE(ac.expected_analytes, 1), 1)
    AND COALESCE(ac.expected_analytes,  0) > 0
  )                                           AS panel_ready,
  aot.patient_id,
  aot.patient_name,
  aot.order_date,
  aot.lab_id,
  aot.location_id
FROM all_order_tests aot
LEFT JOIN latest_results  lr ON lr.order_id = aot.order_id
                             AND lr.test_group_id = aot.test_group_id
LEFT JOIN analyte_counts  ac ON ac.result_id = lr.result_id
ORDER BY aot.order_date DESC, aot.patient_name;

GRANT SELECT ON v_result_panel_status TO authenticated;
GRANT SELECT ON v_result_panel_status TO anon;

COMMIT;

COMMENT ON VIEW v_result_panel_status IS
'Shows panel readiness for ALL test groups in orders. Includes analyzer-interface results
 whose test_group_id is backfilled by process-analyzer-result after AI mapping.';
