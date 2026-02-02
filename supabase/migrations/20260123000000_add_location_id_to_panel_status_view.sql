-- Add location_id to v_result_panel_status view for location-based filtering
-- Issue: ResultVerificationConsole tries to filter by location_id but view doesn't have it

BEGIN;

DROP VIEW IF EXISTS v_result_panel_status CASCADE;

CREATE OR REPLACE VIEW v_result_panel_status AS
WITH all_order_tests AS (
  -- Get ALL test groups from order_tests (whether they have results or not)
  SELECT
    ot.id as order_test_id,
    ot.order_id,
    ot.test_group_id,
    tg.name as test_group_name,
    o.patient_id,
    p.name as patient_name,
    o.order_date,
    o.lab_id,
    o.location_id  -- Added for location filtering
  FROM order_tests ot
  INNER JOIN orders o ON o.id = ot.order_id
  LEFT JOIN patients p ON p.id = o.patient_id
  LEFT JOIN test_groups tg ON tg.id = ot.test_group_id
  WHERE ot.test_group_id IS NOT NULL
),
latest_results AS (
  -- Get the latest result for each order_test combination
  -- Prioritize workflow-level results over individual analyte results
  SELECT DISTINCT ON (r.order_id, r.test_group_id)
    r.id as result_id,
    r.order_id,
    r.test_group_id
  FROM results r
  WHERE r.test_group_id IS NOT NULL
  ORDER BY
    r.order_id,
    r.test_group_id,
    CASE
      WHEN r.test_name LIKE '%Workflow%' THEN 1
      WHEN r.test_name LIKE '%Panel%' THEN 2
      ELSE 3
    END,
    r.created_at DESC
),
analyte_counts AS (
  -- Count analytes for each result
  SELECT
    rv.result_id,
    COUNT(*) as expected_analytes,
    COUNT(CASE WHEN rv.value IS NOT NULL AND rv.value != '' THEN 1 END) as entered_analytes,
    COUNT(CASE WHEN rv.verify_status = 'approved' THEN 1 END) as approved_analytes
  FROM result_values rv
  GROUP BY rv.result_id
)
SELECT
  COALESCE(lr.result_id, gen_random_uuid()) as result_id,
  aot.order_id,
  aot.test_group_id,
  aot.test_group_name,
  COALESCE(ac.expected_analytes, 0) as expected_analytes,
  COALESCE(ac.entered_analytes, 0) as entered_analytes,
  COALESCE(ac.approved_analytes, 0) as approved_analytes,
  -- Panel is ready ONLY when:
  -- 1. Result exists (lr.result_id IS NOT NULL) AND
  -- 2. All analytes are approved (approved >= expected) AND
  -- 3. At least one analyte exists (expected > 0)
  (lr.result_id IS NOT NULL AND
   COALESCE(ac.approved_analytes, 0) >= GREATEST(COALESCE(ac.expected_analytes, 1), 1) AND
   COALESCE(ac.expected_analytes, 0) > 0) as panel_ready,
  aot.patient_id,
  aot.patient_name,
  aot.order_date,
  aot.lab_id,
  aot.location_id  -- Added for location filtering
FROM all_order_tests aot
LEFT JOIN latest_results lr ON lr.order_id = aot.order_id AND lr.test_group_id = aot.test_group_id
LEFT JOIN analyte_counts ac ON ac.result_id = lr.result_id
ORDER BY aot.order_date DESC, aot.patient_name;

-- Grant permissions
GRANT SELECT ON v_result_panel_status TO authenticated;
GRANT SELECT ON v_result_panel_status TO anon;

COMMIT;

COMMENT ON VIEW v_result_panel_status IS
'Shows panel readiness for ALL test groups in orders, including those without results yet. Panel is ready only when all analytes are approved. Includes location_id for filtering.';
