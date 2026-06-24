-- Diagnostic only: run this in Supabase SQL Editor if hims-order-create still
-- fails on orders.insert with "column reference lab_id is ambiguous".
--
-- It lists every trigger attached to public.orders and its function body so the
-- live function that still contains an unqualified lab_id can be identified.

SELECT
  t.tgname AS trigger_name,
  CASE
    WHEN (t.tgtype & 2) = 2 THEN 'BEFORE'
    WHEN (t.tgtype & 64) = 64 THEN 'INSTEAD OF'
    ELSE 'AFTER'
  END AS timing,
  concat_ws(
    ' OR ',
    CASE WHEN (t.tgtype & 4) = 4 THEN 'INSERT' END,
    CASE WHEN (t.tgtype & 8) = 8 THEN 'DELETE' END,
    CASE WHEN (t.tgtype & 16) = 16 THEN 'UPDATE' END,
    CASE WHEN (t.tgtype & 32) = 32 THEN 'TRUNCATE' END
  ) AS events,
  p.proname AS function_name,
  pg_get_triggerdef(t.oid) AS trigger_definition,
  pg_get_functiondef(p.oid) AS function_definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public'
  AND c.relname = 'orders'
  AND NOT t.tgisinternal
ORDER BY trigger_name;

-- Use this narrower search after the first query if the output is too large.
SELECT
  p.proname AS function_name,
  regexp_matches(pg_get_functiondef(p.oid), '.{0,80}\blab_id\b.{0,80}', 'gi') AS lab_id_context
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public'
  AND c.relname = 'orders'
  AND NOT t.tgisinternal;

-- Helpers called by the live auto_assign_order_identification() trigger function.
SELECT
  p.proname AS function_name,
  pg_get_function_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid) AS result_type,
  pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'auto_assign_order_identification',
    'assign_order_color',
    'generate_order_qr_code'
  )
ORDER BY p.proname, pg_get_function_arguments(p.oid);
