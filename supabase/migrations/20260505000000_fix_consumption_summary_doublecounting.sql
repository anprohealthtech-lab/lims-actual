-- Fix v_inventory_consumption_summary double-counting
--
-- Root cause: LEFT JOIN to inventory_test_mapping produced N rows per
-- transaction when an item had N active mappings, causing SUM(quantity)
-- to be multiplied by the number of mappings.
--
-- Fix: aggregate transactions and mappings in separate subqueries before
-- joining, so the cardinality of one does not affect the other.

CREATE OR REPLACE VIEW public.v_inventory_consumption_summary AS
SELECT
  i.id AS item_id,
  i.lab_id,
  i.location_id,
  i.name,
  i.code,
  i.current_stock,
  i.unit,
  i.consumption_scope,
  i.consumption_per_use,
  i.pack_contains,
  CASE
    WHEN i.pack_contains IS NOT NULL AND i.consumption_per_use > 0
      THEN FLOOR((i.current_stock * i.pack_contains) / i.consumption_per_use)
    WHEN i.consumption_per_use > 0
      THEN FLOOR(i.current_stock / i.consumption_per_use)
    ELSE i.current_stock
  END AS tests_remaining,

  -- Mapping counts (isolated subquery — does not affect transaction aggregation)
  COALESCE(mc.mapped_tests_count, 0)    AS mapped_tests_count,
  COALESCE(mc.mapped_analytes_count, 0) AS mapped_analytes_count,

  -- Transaction aggregation (isolated subquery — not multiplied by mapping rows)
  COALESCE(tc.consumption_30_days, 0) AS consumption_30_days,
  COALESCE(tc.consumption_7_days, 0)  AS consumption_7_days,

  CASE
    WHEN COALESCE(tc.consumption_30_days, 0) > 0
      THEN ROUND(i.current_stock / (tc.consumption_30_days / 30.0), 1)
    ELSE NULL
  END AS estimated_days_remaining

FROM public.inventory_items i

-- Mapping counts in a subquery so multiple mappings don't fan out transactions
LEFT JOIN (
  SELECT
    item_id,
    COUNT(DISTINCT test_group_id) FILTER (WHERE test_group_id IS NOT NULL) AS mapped_tests_count,
    COUNT(DISTINCT analyte_id)    FILTER (WHERE analyte_id IS NOT NULL)    AS mapped_analytes_count
  FROM public.inventory_test_mapping
  WHERE is_active = true
  GROUP BY item_id
) mc ON mc.item_id = i.id

-- Transaction sums in a subquery so they are never multiplied by mapping rows
LEFT JOIN (
  SELECT
    item_id,
    COALESCE(SUM(ABS(quantity)) FILTER (
      WHERE type = 'out'
      AND created_at >= CURRENT_DATE - INTERVAL '30 days'
    ), 0) AS consumption_30_days,
    COALESCE(SUM(ABS(quantity)) FILTER (
      WHERE type = 'out'
      AND created_at >= CURRENT_DATE - INTERVAL '7 days'
    ), 0) AS consumption_7_days
  FROM public.inventory_transactions
  GROUP BY item_id
) tc ON tc.item_id = i.id

WHERE i.is_active = true;
