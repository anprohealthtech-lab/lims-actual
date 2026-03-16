-- =====================================================
-- DEACTIVATE DUPLICATE TEST GROUPS (ALL LABS)
-- Finds test groups with same code+name within same lab
-- Keeps the "best" one, inactivates the rest
-- Safe: never inactivates a group that has active/pending orders
-- =====================================================
-- Run the SELECT preview first, then run the UPDATE

BEGIN;

-- =====================================================
-- STEP 1: Preview — what will be kept vs inactivated
-- =====================================================

WITH ranked AS (
  SELECT
    tg.id,
    tg.lab_id,
    tg.name,
    tg.code,
    tg.is_active,
    tg.analyte_count,
    tg.tat_hours,
    tg.ai_config,
    tg.group_level_prompt,
    tg.created_at,
    -- Score: higher = better candidate to KEEP
    (
      COALESCE(tg.analyte_count, 0) * 10                             -- more analytes = better
      + CASE WHEN tg.tat_hours IS NOT NULL THEN 5 ELSE 0 END         -- has TAT config
      + CASE WHEN tg.group_level_prompt <> '' AND tg.group_level_prompt IS NOT NULL THEN 3 ELSE 0 END  -- has AI prompt
      + CASE WHEN tg.ai_config <> '{}' AND tg.ai_config IS NOT NULL THEN 2 ELSE 0 END                 -- has AI config
      + CASE WHEN EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = tg.id) THEN 20 ELSE 0 END  -- has orders
      + CASE WHEN EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = tg.id) THEN 15 ELSE 0 END   -- has results
    ) AS keep_score,
    -- Count of duplicates in same lab with same code+name
    COUNT(*) OVER (
      PARTITION BY tg.lab_id, LOWER(TRIM(tg.code)), LOWER(TRIM(tg.name))
    ) AS duplicate_count,
    -- Rank within duplicates: rank 1 = KEEP
    ROW_NUMBER() OVER (
      PARTITION BY tg.lab_id, LOWER(TRIM(tg.code)), LOWER(TRIM(tg.name))
      ORDER BY
        -- prefer group with orders
        (EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = tg.id)) DESC,
        -- prefer group with results
        (EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = tg.id)) DESC,
        -- prefer more analytes
        COALESCE(tg.analyte_count, 0) DESC,
        -- prefer has tat_hours
        (tg.tat_hours IS NOT NULL) DESC,
        -- prefer has ai prompt
        (tg.group_level_prompt IS NOT NULL AND tg.group_level_prompt <> '') DESC,
        -- prefer newer
        tg.created_at DESC
    ) AS rnk
  FROM test_groups tg
  WHERE tg.is_active = true
),
duplicates AS (
  SELECT * FROM ranked WHERE duplicate_count > 1
)
SELECT
  d.lab_id,
  l.name AS lab_name,
  d.name AS test_group_name,
  d.code,
  d.id,
  d.analyte_count,
  d.tat_hours,
  d.created_at,
  d.keep_score,
  d.rnk,
  CASE WHEN d.rnk = 1 THEN '✅ KEEP' ELSE '❌ INACTIVATE' END AS action,
  -- Safety check: has active orders?
  EXISTS (
    SELECT 1 FROM order_test_groups otg
    JOIN orders o ON o.id = otg.order_id
    WHERE otg.test_group_id = d.id
      AND o.status NOT IN ('Completed', 'Delivered', 'Cancelled')
  ) AS has_active_orders,
  (SELECT COUNT(*) FROM order_test_groups otg WHERE otg.test_group_id = d.id) AS total_order_count,
  (SELECT COUNT(*) FROM results r WHERE r.test_group_id = d.id) AS result_count
FROM duplicates d
JOIN labs l ON l.id = d.lab_id
ORDER BY d.lab_id, d.name, d.rnk;


-- =====================================================
-- STEP 2: Inactivate duplicates — SAFE (skips groups with active orders)
-- =====================================================

UPDATE test_groups
SET
  is_active = false,
  updated_at = NOW()
WHERE id IN (
  WITH ranked AS (
    SELECT
      tg.id,
      ROW_NUMBER() OVER (
        PARTITION BY tg.lab_id, LOWER(TRIM(tg.code)), LOWER(TRIM(tg.name))
        ORDER BY
          (EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = tg.id)) DESC,
          (EXISTS (SELECT 1 FROM results r WHERE r.test_group_id = tg.id)) DESC,
          COALESCE(tg.analyte_count, 0) DESC,
          (tg.tat_hours IS NOT NULL) DESC,
          (tg.group_level_prompt IS NOT NULL AND tg.group_level_prompt <> '') DESC,
          tg.created_at DESC
      ) AS rnk,
      COUNT(*) OVER (
        PARTITION BY tg.lab_id, LOWER(TRIM(tg.code)), LOWER(TRIM(tg.name))
      ) AS duplicate_count
    FROM test_groups tg
    WHERE tg.is_active = true
  )
  SELECT id FROM ranked
  WHERE rnk > 1               -- not the "best" one
    AND duplicate_count > 1   -- only actual duplicates
    -- SAFETY: skip if it has any active/pending orders
    AND NOT EXISTS (
      SELECT 1 FROM order_test_groups otg
      JOIN orders o ON o.id = otg.order_id
      WHERE otg.test_group_id = ranked.id
        AND o.status NOT IN ('Completed', 'Delivered', 'Cancelled')
    )
);

-- =====================================================
-- STEP 3: Summary
-- =====================================================

SELECT
  'RESULT' AS report,
  COUNT(*) AS total_inactivated
FROM test_groups
WHERE is_active = false
  AND updated_at >= NOW() - INTERVAL '5 seconds';

-- Show any duplicates that were SKIPPED due to active orders (need manual review)
WITH ranked AS (
  SELECT
    tg.id,
    tg.lab_id,
    tg.name,
    tg.code,
    ROW_NUMBER() OVER (
      PARTITION BY tg.lab_id, LOWER(TRIM(tg.code)), LOWER(TRIM(tg.name))
      ORDER BY
        (EXISTS (SELECT 1 FROM order_test_groups otg WHERE otg.test_group_id = tg.id)) DESC,
        COALESCE(tg.analyte_count, 0) DESC,
        tg.created_at DESC
    ) AS rnk,
    COUNT(*) OVER (
      PARTITION BY tg.lab_id, LOWER(TRIM(tg.code)), LOWER(TRIM(tg.name))
    ) AS duplicate_count
  FROM test_groups tg
  WHERE tg.is_active = true
)
SELECT
  '⚠️ SKIPPED - has active orders' AS status,
  r.id,
  r.lab_id,
  l.name AS lab_name,
  r.name AS test_group_name,
  r.code
FROM ranked r
JOIN labs l ON l.id = r.lab_id
WHERE r.rnk > 1
  AND r.duplicate_count > 1
  AND EXISTS (
    SELECT 1 FROM order_test_groups otg
    JOIN orders o ON o.id = otg.order_id
    WHERE otg.test_group_id = r.id
      AND o.status NOT IN ('Completed', 'Delivered', 'Cancelled')
  );

COMMIT;
-- ROLLBACK; -- uncomment to undo
