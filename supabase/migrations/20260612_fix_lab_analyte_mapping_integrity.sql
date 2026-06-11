-- Preserve exact lab_analyte identity in the missing-analytes view and remove
-- the superseded seven-argument save_ai_mapping overload.

DROP VIEW IF EXISTS public.v_order_missing_analytes;
CREATE VIEW public.v_order_missing_analytes AS
SELECT DISTINCT ON (
    ord_analytes.order_id,
    COALESCE(ord_analytes.lab_analyte_id, ord_analytes.analyte_id)
)
    ord_analytes.order_id,
    ord_analytes.analyte_id,
    ord_analytes.lab_analyte_id,
    COALESCE(tga.analyte_name, a.name) AS analyte_name,
    ord_analytes.test_group_id,
    ord_analytes.order_test_id,
    ord_analytes.order_test_group_id
FROM (
    SELECT
        otg.order_id,
        tga.analyte_id,
        tga.lab_analyte_id,
        otg.test_group_id,
        NULL::uuid AS order_test_id,
        otg.id AS order_test_group_id
    FROM public.order_test_groups otg
    JOIN public.test_group_analytes tga ON tga.test_group_id = otg.test_group_id
    WHERE tga.is_header IS NOT TRUE

    UNION ALL

    SELECT
        ot.order_id,
        tga.analyte_id,
        tga.lab_analyte_id,
        ot.test_group_id,
        ot.id AS order_test_id,
        NULL::uuid AS order_test_group_id
    FROM public.order_tests ot
    JOIN public.test_group_analytes tga ON tga.test_group_id = ot.test_group_id
    WHERE ot.test_group_id IS NOT NULL
      AND ot.is_canceled IS NOT TRUE
      AND tga.is_header IS NOT TRUE
) ord_analytes
JOIN public.test_group_analytes tga
  ON tga.analyte_id = ord_analytes.analyte_id
 AND tga.test_group_id = ord_analytes.test_group_id
 AND tga.lab_analyte_id IS NOT DISTINCT FROM ord_analytes.lab_analyte_id
JOIN public.analytes a ON a.id = ord_analytes.analyte_id
WHERE NOT EXISTS (
    SELECT 1
    FROM public.result_values rv
    WHERE rv.order_id = ord_analytes.order_id
      AND (
          rv.lab_analyte_id = ord_analytes.lab_analyte_id
          OR (
              rv.lab_analyte_id IS NULL
              AND rv.analyte_id = ord_analytes.analyte_id
          )
      )
)
ORDER BY
    ord_analytes.order_id,
    COALESCE(ord_analytes.lab_analyte_id, ord_analytes.analyte_id),
    (ord_analytes.order_test_group_id IS NULL);

DROP FUNCTION IF EXISTS public.save_ai_mapping(
    uuid,
    text,
    text,
    text,
    double precision,
    uuid,
    text
);
