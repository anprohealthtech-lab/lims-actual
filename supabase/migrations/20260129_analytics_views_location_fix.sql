-- =============================================
-- ANALYTICS VIEWS FIX - LOCATION FILTERING WITH ROLLUP
-- Created: 2026-01-29
-- Description: Adding location_id with ROLLUP to support both specific and global analytics
-- =============================================

-- Drop existing views to allow schema changes
DROP VIEW IF EXISTS public.v_analytics_kpi_summary CASCADE;
DROP VIEW IF EXISTS public.v_analytics_orders_by_department CASCADE;
DROP VIEW IF EXISTS public.v_analytics_orders_by_status CASCADE;
DROP VIEW IF EXISTS public.v_analytics_test_popularity CASCADE;
DROP VIEW IF EXISTS public.v_analytics_tat_summary CASCADE;
DROP VIEW IF EXISTS public.v_analytics_account_performance CASCADE;
DROP VIEW IF EXISTS public.v_analytics_outsourced_summary CASCADE;
DROP VIEW IF EXISTS public.v_analytics_critical_alerts CASCADE;
DROP VIEW IF EXISTS public.v_analytics_patient_demographics CASCADE;
DROP VIEW IF EXISTS public.v_analytics_hourly_distribution CASCADE;
DROP VIEW IF EXISTS public.v_analytics_payment_methods CASCADE;


-- 1. KPI Summary (Using CTEs to avoid JOIN multiplication)
CREATE VIEW public.v_analytics_kpi_summary AS
WITH order_revenue AS (
  -- Pre-aggregate invoice totals per order (prevents multiplication)
  SELECT order_id, SUM(total) AS revenue
  FROM invoices
  GROUP BY order_id
),
order_reports AS (
  -- Pre-aggregate report counts per order
  SELECT order_id, COUNT(*) AS report_count
  FROM reports
  WHERE status = 'final'
  GROUP BY order_id
),
order_critical AS (
  -- Pre-aggregate critical flags per order
  SELECT DISTINCT r.order_id
  FROM results r
  JOIN result_values rv ON rv.result_id = r.id
  WHERE rv.flag = 'C'
),
order_tat_breach AS (
  -- Pre-calculate TAT breaches per order
  SELECT DISTINCT o.id AS order_id
  FROM orders o
  JOIN order_tests ot ON ot.order_id = o.id
  JOIN test_groups tg ON tg.id = ot.test_group_id
  WHERE tg.tat_hours IS NOT NULL
    AND COALESCE(o.sample_received_at, o.sample_collected_at) IS NOT NULL
    AND NOW() > (COALESCE(o.sample_received_at, o.sample_collected_at) + (tg.tat_hours || ' hours')::interval)
    AND o.status NOT IN ('Completed', 'Delivered')
)
SELECT 
  o.lab_id,
  o.location_id,
  DATE(COALESCE(o.sample_collected_at, o.created_at)) AS date,
  COUNT(DISTINCT o.id) AS total_orders,
  COALESCE(SUM(orv.revenue), 0) AS total_revenue,
  CASE 
    WHEN COUNT(DISTINCT o.id) > 0 
    THEN ROUND(COALESCE(SUM(orv.revenue), 0) / COUNT(DISTINCT o.id), 2)
    ELSE 0 
  END AS avg_order_value,
  COUNT(DISTINCT CASE WHEN o.sample_collected_at IS NOT NULL THEN o.id END) AS samples_collected,
  COUNT(DISTINCT CASE WHEN orp.order_id IS NOT NULL THEN o.id END) AS reports_generated,
  COUNT(DISTINCT CASE WHEN o.status = 'Pending Approval' THEN o.id END) AS pending_reports,
  COUNT(DISTINCT CASE WHEN oc.order_id IS NOT NULL THEN o.id END) AS critical_results,
  COUNT(DISTINCT CASE WHEN otb.order_id IS NOT NULL THEN o.id END) AS tat_breaches
FROM orders o
LEFT JOIN order_revenue orv ON orv.order_id = o.id
LEFT JOIN order_reports orp ON orp.order_id = o.id
LEFT JOIN order_critical oc ON oc.order_id = o.id
LEFT JOIN order_tat_breach otb ON otb.order_id = o.id
WHERE o.lab_id IS NOT NULL AND o.location_id IS NOT NULL
GROUP BY o.lab_id, DATE(COALESCE(o.sample_collected_at, o.created_at)), ROLLUP(o.location_id);

-- 2. Orders by Department
CREATE VIEW public.v_analytics_orders_by_department AS
WITH dept_totals AS (
  SELECT 
    o.lab_id,
    o.location_id,
    DATE(COALESCE(o.sample_collected_at, o.created_at)) AS date,
    tg.department,
    COUNT(DISTINCT o.id) AS order_count,
    COUNT(DISTINCT ot.id) AS test_count,
    COALESCE(SUM(
      CASE 
        WHEN ot.price IS NOT NULL THEN ot.price
        ELSE tg.price 
      END
    ), 0) AS revenue
  FROM orders o
  JOIN order_tests ot ON ot.order_id = o.id
  JOIN test_groups tg ON tg.id = ot.test_group_id
  WHERE o.lab_id IS NOT NULL AND tg.department IS NOT NULL AND o.location_id IS NOT NULL
  GROUP BY o.lab_id, DATE(COALESCE(o.sample_collected_at, o.created_at)), tg.department, ROLLUP(o.location_id)
),
daily_totals AS (
  SELECT lab_id, location_id, date, SUM(order_count) AS total_orders, SUM(revenue) AS total_revenue
  FROM dept_totals
  GROUP BY lab_id, location_id, date
)
SELECT 
  dt.lab_id,
  dt.location_id,
  dt.date,
  dt.department,
  dt.order_count,
  dt.test_count,
  dt.revenue,
  COALESCE(ROUND((dt.order_count::numeric / NULLIF(tot.total_orders, 0)) * 100, 1), 0) AS order_percentage,
  COALESCE(ROUND((dt.revenue::numeric / NULLIF(tot.total_revenue, 0)) * 100, 1), 0) AS revenue_percentage
FROM dept_totals dt
JOIN daily_totals tot ON tot.lab_id = dt.lab_id 
  AND (tot.location_id = dt.location_id OR (tot.location_id IS NULL AND dt.location_id IS NULL))
  AND tot.date = dt.date
ORDER BY dt.date DESC, dt.revenue DESC;

-- 3. Orders by Status
CREATE VIEW public.v_analytics_orders_by_status AS
WITH status_counts AS (
  SELECT 
    lab_id,
    location_id,
    DATE(COALESCE(sample_collected_at, created_at)) AS date,
    status,
    COUNT(*) AS count
  FROM orders
  WHERE lab_id IS NOT NULL AND location_id IS NOT NULL
  GROUP BY lab_id, DATE(COALESCE(sample_collected_at, created_at)), status, ROLLUP(location_id)
),
daily_totals AS (
  SELECT lab_id, location_id, date, SUM(count) AS total
  FROM status_counts
  GROUP BY lab_id, location_id, date
)
SELECT 
  sc.lab_id,
  sc.location_id,
  sc.date,
  sc.status,
  sc.count,
  COALESCE(ROUND((sc.count::numeric / NULLIF(dt.total, 0)) * 100, 1), 0) AS percentage
FROM status_counts sc
JOIN daily_totals dt ON dt.lab_id = sc.lab_id 
  AND (dt.location_id = sc.location_id OR (dt.location_id IS NULL AND sc.location_id IS NULL))
  AND dt.date = sc.date
ORDER BY sc.date DESC, sc.count DESC;

-- 4. Test Popularity
CREATE VIEW public.v_analytics_test_popularity AS
SELECT 
  o.lab_id,
  o.location_id,
  tg.id AS test_group_id,
  tg.name AS test_name,
  tg.department,
  COUNT(DISTINCT ot.id) AS order_count,
  COALESCE(SUM(COALESCE(ot.price, tg.price)), 0) AS revenue,
  ROUND(AVG(COALESCE(ot.price, tg.price)), 2) AS avg_price,
  ROW_NUMBER() OVER (
    PARTITION BY o.lab_id, o.location_id
    ORDER BY COUNT(DISTINCT ot.id) DESC
  ) AS rank_by_volume,
  ROW_NUMBER() OVER (
    PARTITION BY o.lab_id, o.location_id
    ORDER BY COALESCE(SUM(COALESCE(ot.price, tg.price)), 0) DESC
  ) AS rank_by_revenue
FROM orders o
JOIN order_tests ot ON ot.order_id = o.id
JOIN test_groups tg ON tg.id = ot.test_group_id
WHERE o.lab_id IS NOT NULL AND o.location_id IS NOT NULL
GROUP BY o.lab_id, tg.id, tg.name, tg.department, ROLLUP(o.location_id);

-- 5. TAT Summary
CREATE VIEW public.v_analytics_tat_summary AS
SELECT 
  o.lab_id,
  o.location_id,
  DATE(COALESCE(o.sample_collected_at, o.created_at)) AS date,
  tg.department,
  tg.name AS test_name,
  tg.tat_hours AS target_tat,
  ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(rp.created_at, NOW()) - COALESCE(o.sample_received_at, o.sample_collected_at, o.created_at))) / 3600)::numeric, 1) AS avg_tat_hours,
  ROUND(MIN(EXTRACT(EPOCH FROM (COALESCE(rp.created_at, NOW()) - COALESCE(o.sample_received_at, o.sample_collected_at, o.created_at))) / 3600)::numeric, 1) AS min_tat_hours,
  ROUND(MAX(EXTRACT(EPOCH FROM (COALESCE(rp.created_at, NOW()) - COALESCE(o.sample_received_at, o.sample_collected_at, o.created_at))) / 3600)::numeric, 1) AS max_tat_hours,
  COUNT(CASE WHEN tg.tat_hours IS NOT NULL AND EXTRACT(EPOCH FROM (COALESCE(rp.created_at, NOW()) - COALESCE(o.sample_received_at, o.sample_collected_at, o.created_at))) / 3600 <= tg.tat_hours THEN 1 END) AS within_target,
  COUNT(CASE WHEN tg.tat_hours IS NOT NULL AND EXTRACT(EPOCH FROM (COALESCE(rp.created_at, NOW()) - COALESCE(o.sample_received_at, o.sample_collected_at, o.created_at))) / 3600 > tg.tat_hours THEN 1 END) AS breached,
  COUNT(*) AS total_tests,
  ROUND(COUNT(CASE WHEN tg.tat_hours IS NOT NULL AND EXTRACT(EPOCH FROM (COALESCE(rp.created_at, NOW()) - COALESCE(o.sample_received_at, o.sample_collected_at, o.created_at))) / 3600 > tg.tat_hours THEN 1 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS breach_percentage
FROM orders o
JOIN order_tests ot ON ot.order_id = o.id
JOIN test_groups tg ON tg.id = ot.test_group_id
LEFT JOIN reports rp ON rp.order_id = o.id AND rp.status = 'final'
WHERE o.lab_id IS NOT NULL 
  AND COALESCE(o.sample_received_at, o.sample_collected_at) IS NOT NULL
  AND o.location_id IS NOT NULL
GROUP BY o.lab_id, DATE(COALESCE(o.sample_collected_at, o.created_at)), tg.department, tg.name, tg.tat_hours, ROLLUP(o.location_id);

-- 6. Account Performance
CREATE VIEW public.v_analytics_account_performance AS
SELECT 
  o.lab_id,
  o.location_id,
  o.account_id,
  a.name AS account_name,
  a.type AS account_type,
  DATE(COALESCE(o.sample_collected_at, o.created_at)) AS date,
  COUNT(DISTINCT o.id) AS order_count,
  COUNT(DISTINCT o.patient_id) AS patient_count,
  COALESCE(SUM(i.total), 0) AS revenue,
  COALESCE(SUM(i.amount_paid), 0) AS collected,
  COALESCE(SUM(i.total - COALESCE(i.amount_paid, 0)), 0) AS outstanding_amount,
  ROUND(COALESCE(SUM(i.total), 0)::numeric / NULLIF(COUNT(DISTINCT o.id), 0), 2) AS avg_order_value,
  ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(p.created_at, NOW()) - i.created_at)) / 86400)::numeric, 0) AS avg_payment_days
FROM orders o
JOIN accounts a ON a.id = o.account_id
LEFT JOIN invoices i ON i.order_id = o.id
LEFT JOIN payments p ON p.invoice_id = i.id
WHERE o.lab_id IS NOT NULL AND o.account_id IS NOT NULL AND o.location_id IS NOT NULL
GROUP BY o.lab_id, o.account_id, a.name, a.type, DATE(COALESCE(o.sample_collected_at, o.created_at)), ROLLUP(o.location_id);

-- 7. Outsourced Summary
CREATE VIEW public.v_analytics_outsourced_summary AS
SELECT 
  ot.lab_id,
  o.location_id,
  ot.outsourced_lab_id,
  ol.name AS outsourced_lab_name,
  DATE(o.created_at) AS date,
  COUNT(DISTINCT ot.id) AS test_count,
  COUNT(DISTINCT o.id) AS order_count,
  COALESCE(SUM(olp.cost), 0) AS cost,
  COALESCE(SUM(COALESCE(ot.price, tg.price)), 0) AS revenue,
  COALESCE(SUM(COALESCE(ot.price, tg.price)), 0) - COALESCE(SUM(olp.cost), 0) AS margin,
  ROUND((COALESCE(SUM(COALESCE(ot.price, tg.price)), 0) - COALESCE(SUM(olp.cost), 0))::numeric / NULLIF(COALESCE(SUM(COALESCE(ot.price, tg.price)), 0), 0) * 100, 1) AS margin_percentage,
  COUNT(CASE WHEN r.id IS NULL OR r.status NOT IN ('Approved', 'Reported') THEN 1 END) AS pending_results,
  ROUND(AVG(CASE WHEN r.entered_date IS NOT NULL THEN EXTRACT(EPOCH FROM (r.entered_date - o.created_at)) / 3600 END)::numeric, 1) AS avg_tat_hours
FROM order_tests ot
JOIN orders o ON o.id = ot.order_id
JOIN outsourced_labs ol ON ol.id = ot.outsourced_lab_id
LEFT JOIN test_groups tg ON tg.id = ot.test_group_id
LEFT JOIN outsourced_lab_prices olp ON olp.outsourced_lab_id = ot.outsourced_lab_id AND olp.test_group_id = ot.test_group_id
LEFT JOIN results r ON r.order_test_id = ot.id
WHERE ot.outsourced_lab_id IS NOT NULL AND ot.lab_id IS NOT NULL AND o.location_id IS NOT NULL
GROUP BY ot.lab_id, o.location_id, ot.outsourced_lab_id, ol.name, DATE(o.created_at), ROLLUP(o.location_id);

-- 8. Critical Alerts (No ROLLUP needed, just filter)
CREATE VIEW public.v_analytics_critical_alerts AS
SELECT 
  o.lab_id,
  o.location_id,
  o.id AS order_id,
  o.patient_id,
  p.name AS patient_name,
  p.phone AS patient_phone,
  tg.name AS test_name,
  a.name AS analyte_name,
  rv.value,
  rv.unit,
  COALESCE(la.reference_range, a.reference_range) AS reference_range,
  rv.flag,
  r.entered_date AS result_date,
  d.name AS doctor_name,
  d.phone AS doctor_phone,
  ROUND(EXTRACT(EPOCH FROM (NOW() - r.entered_date)) / 3600, 1) AS hours_since_result,
  FALSE AS is_notified
FROM orders o
JOIN patients p ON p.id = o.patient_id
JOIN results r ON r.order_id = o.id
JOIN result_values rv ON rv.result_id = r.id
JOIN analytes a ON a.id = rv.analyte_id
JOIN order_tests ot ON ot.id = r.order_test_id
JOIN test_groups tg ON tg.id = ot.test_group_id
LEFT JOIN lab_analytes la ON la.analyte_id = a.id AND la.lab_id = o.lab_id
LEFT JOIN doctors d ON d.id = o.doctor::uuid
WHERE rv.flag IN ('C', 'H', 'L') AND o.lab_id IS NOT NULL;

-- 9. Patient Demographics
CREATE VIEW public.v_analytics_patient_demographics AS
SELECT 
  o.lab_id,
  o.location_id,
  DATE(COALESCE(o.sample_collected_at, o.created_at)) AS date,
  COALESCE(p.gender::text, 'Unknown') AS gender,
  CASE 
    WHEN p.age IS NULL THEN 'Unknown'
    WHEN p.age::text ~ '^\d+$' THEN
      CASE 
        WHEN p.age::int < 1 THEN 'Infant (<1)'
        WHEN p.age::int BETWEEN 1 AND 12 THEN 'Child (1-12)'
        WHEN p.age::int BETWEEN 13 AND 19 THEN 'Teen (13-19)'
        WHEN p.age::int BETWEEN 20 AND 39 THEN 'Adult (20-39)'
        WHEN p.age::int BETWEEN 40 AND 59 THEN 'Middle Age (40-59)'
        ELSE 'Senior (60+)'
      END
    ELSE 'Unknown'
  END AS age_group,
  COUNT(DISTINCT p.id) AS patient_count,
  COUNT(DISTINCT o.id) AS order_count,
  COALESCE(SUM(i.total), 0) AS revenue
FROM orders o
JOIN patients p ON p.id = o.patient_id
LEFT JOIN invoices i ON i.order_id = o.id
WHERE o.lab_id IS NOT NULL AND o.location_id IS NOT NULL
GROUP BY o.lab_id, DATE(COALESCE(o.sample_collected_at, o.created_at)), 
  COALESCE(p.gender::text, 'Unknown'),
  CASE 
    WHEN p.age IS NULL THEN 'Unknown'
    WHEN p.age::text ~ '^\d+$' THEN
      CASE 
        WHEN p.age::int < 1 THEN 'Infant (<1)'
        WHEN p.age::int BETWEEN 1 AND 12 THEN 'Child (1-12)'
        WHEN p.age::int BETWEEN 13 AND 19 THEN 'Teen (13-19)'
        WHEN p.age::int BETWEEN 20 AND 39 THEN 'Adult (20-39)'
        WHEN p.age::int BETWEEN 40 AND 59 THEN 'Middle Age (40-59)'
        ELSE 'Senior (60+)'
      END
    ELSE 'Unknown'
  END,
  ROLLUP(o.location_id);

-- 10. Hourly Distribution
CREATE VIEW public.v_analytics_hourly_distribution AS
SELECT 
  lab_id,
  location_id,
  DATE(created_at) AS date,
  EXTRACT(HOUR FROM created_at)::int AS hour,
  COUNT(*) AS order_count,
  ROUND(AVG(total_amount), 2) AS avg_order_value
FROM orders
WHERE lab_id IS NOT NULL AND location_id IS NOT NULL
GROUP BY lab_id, DATE(created_at), EXTRACT(HOUR FROM created_at), ROLLUP(location_id);

-- 11. Payment Methods
CREATE VIEW public.v_analytics_payment_methods AS
SELECT 
  p.lab_id,
  i.location_id,
  DATE(p.created_at) AS date,
  p.payment_method,
  COUNT(*) AS transaction_count,
  SUM(p.amount) AS total_amount,
  ROUND(AVG(p.amount), 2) AS avg_amount,
  ROUND(SUM(p.amount)::numeric / NULLIF(SUM(SUM(p.amount)) OVER (PARTITION BY p.lab_id, i.location_id, DATE(p.created_at)), 0) * 100, 1) AS percentage
FROM payments p
JOIN invoices i ON i.id = p.invoice_id
WHERE p.lab_id IS NOT NULL AND i.location_id IS NOT NULL
GROUP BY p.lab_id, DATE(p.created_at), p.payment_method, ROLLUP(i.location_id);

-- GRANT permissions
GRANT SELECT ON v_analytics_kpi_summary TO authenticated, anon;
GRANT SELECT ON v_analytics_orders_by_department TO authenticated, anon;
GRANT SELECT ON v_analytics_orders_by_status TO authenticated, anon;
GRANT SELECT ON v_analytics_test_popularity TO authenticated, anon;
GRANT SELECT ON v_analytics_tat_summary TO authenticated, anon;
GRANT SELECT ON v_analytics_account_performance TO authenticated, anon;
GRANT SELECT ON v_analytics_outsourced_summary TO authenticated, anon;
GRANT SELECT ON v_analytics_critical_alerts TO authenticated, anon;
GRANT SELECT ON v_analytics_patient_demographics TO authenticated, anon;
GRANT SELECT ON v_analytics_hourly_distribution TO authenticated, anon;
GRANT SELECT ON v_analytics_payment_methods TO authenticated, anon;
