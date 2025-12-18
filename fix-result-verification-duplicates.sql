-- Fix Result Verification Console Duplicates
-- Issue: v_result_panel_status shows both workflow-level AND individual analyte results
-- Solution: Deduplicate to show only test_group level results

BEGIN;

-- Drop existing view
DROP VIEW IF EXISTS v_result_panel_status CASCADE;

-- Recreate with deduplication: ONE row per order_id + test_group_id combination
CREATE OR REPLACE VIEW v_result_panel_status AS
WITH distinct_results AS (
  -- Get distinct combinations of order_id + test_group_id from results table
  -- Prioritize workflow-level results (test_name contains 'Workflow') over individual analyte results
  SELECT DISTINCT ON (r.order_id, r.test_group_id)
    r.id as result_id,
    r.order_id,
    r.test_group_id,
    r.patient_id,
    r.patient_name,
    o.order_date,
    o.lab_id,
    -- Prioritize workflow names over individual analyte names
    CASE 
      WHEN r.test_name LIKE '%Workflow%' THEN r.test_name
      WHEN r.test_name LIKE '%Panel%' THEN r.test_name
      ELSE COALESCE(tg.name, r.test_name)
    END as test_group_name
  FROM results r
  INNER JOIN orders o ON o.id = r.order_id
  LEFT JOIN test_groups tg ON tg.id = r.test_group_id
  WHERE r.test_group_id IS NOT NULL
  ORDER BY 
    r.order_id,
    r.test_group_id,
    -- Prioritize workflow entries first
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
  dr.result_id,
  dr.order_id,
  dr.test_group_id,
  dr.test_group_name,
  COALESCE(ac.expected_analytes, 0) as expected_analytes,
  COALESCE(ac.entered_analytes, 0) as entered_analytes,
  COALESCE(ac.approved_analytes, 0) as approved_analytes,
  -- Panel is ready when all analytes are approved
  (COALESCE(ac.approved_analytes, 0) >= COALESCE(ac.expected_analytes, 1)) as panel_ready,
  dr.patient_id,
  dr.patient_name,
  dr.order_date,
  dr.lab_id
FROM distinct_results dr
LEFT JOIN analyte_counts ac ON ac.result_id = dr.result_id
ORDER BY dr.order_date DESC, dr.patient_name;

-- Grant necessary permissions
GRANT SELECT ON v_result_panel_status TO authenticated;
GRANT SELECT ON v_result_panel_status TO anon;

COMMIT;

-- Test query to verify deduplication
-- Should show only 1 row per test group per order
/*
SELECT 
  patient_name,
  test_group_name,
  expected_analytes,
  entered_analytes,
  approved_analytes,
  panel_ready
FROM v_result_panel_status
WHERE patient_name = 'Ramesh Kumar'
  AND order_date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY order_date DESC;
*/
