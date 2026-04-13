-- v_order_missing_analytes
-- Returns every analyte expected for an order that has not yet received a result value.
-- Used by process-analyzer-result and receive-analyzer-result to drive AI analyte mapping.
--
-- Joins two paths:
--   A) order_test_groups  → test_group_analytes → analytes   (preferred — has order_test_group_id)
--   B) order_tests        → test_group_analytes → analytes   (fallback for older orders)
-- Both paths are UNION-ed and deduplicated on (order_id, analyte_id).

DROP VIEW IF EXISTS public.v_order_missing_analytes;
CREATE VIEW public.v_order_missing_analytes AS
SELECT DISTINCT ON (ord_analytes.order_id, ord_analytes.analyte_id)
    ord_analytes.order_id,
    ord_analytes.analyte_id,
    COALESCE(tga.analyte_name, a.name) AS analyte_name,
    ord_analytes.test_group_id,
    ord_analytes.order_test_id,
    ord_analytes.order_test_group_id
FROM (
    -- Path A: via order_test_groups (newer orders)
    SELECT
        otg.order_id,
        tga.analyte_id,
        otg.test_group_id,
        NULL::uuid  AS order_test_id,
        otg.id      AS order_test_group_id
    FROM public.order_test_groups otg
    JOIN public.test_group_analytes tga ON tga.test_group_id = otg.test_group_id
    WHERE tga.is_header IS NOT TRUE

    UNION ALL

    -- Path B: via order_tests (older / simple orders)
    SELECT
        ot.order_id,
        tga.analyte_id,
        ot.test_group_id,
        ot.id       AS order_test_id,
        NULL::uuid  AS order_test_group_id
    FROM public.order_tests ot
    JOIN public.test_group_analytes tga ON tga.test_group_id = ot.test_group_id
    WHERE ot.test_group_id IS NOT NULL
      AND ot.is_canceled IS NOT TRUE
      AND tga.is_header IS NOT TRUE
) ord_analytes
JOIN public.test_group_analytes tga
    ON tga.analyte_id = ord_analytes.analyte_id
   AND tga.test_group_id = ord_analytes.test_group_id
JOIN public.analytes a ON a.id = ord_analytes.analyte_id
-- Exclude analytes that already have a result value for this order
WHERE NOT EXISTS (
    SELECT 1
    FROM public.result_values rv
    WHERE rv.order_id = ord_analytes.order_id
      AND rv.analyte_id = ord_analytes.analyte_id
)
ORDER BY ord_analytes.order_id, ord_analytes.analyte_id,
         -- Prefer path A (order_test_group_id not null)
         (ord_analytes.order_test_group_id IS NULL);
