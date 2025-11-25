-- Script to audit report generation for lab_analytes usage
-- Run this in Supabase SQL Editor and share the output

-- 1. Check if the RPC function exists
SELECT 
  routine_schema,
  routine_name,
  routine_type,
  data_type as return_type
FROM information_schema.routines
WHERE routine_name LIKE '%report%context%'
   OR routine_name LIKE '%template%context%';

-- 2. Get the function definition
SELECT 
  p.proname as function_name,
  pg_get_functiondef(p.oid) as function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE (p.proname LIKE '%report%context%'
   OR p.proname LIKE '%template%context%')
  AND n.nspname = 'public'
ORDER BY p.proname;

-- 3. Check all views that use analytes table
SELECT 
  schemaname,
  viewname,
  definition
FROM pg_views
WHERE definition ILIKE '%analytes%'
  AND schemaname = 'public'
ORDER BY viewname;

-- 4. Check if any functions use analytes table directly
SELECT 
  p.proname as function_name,
  pg_get_functiondef(p.oid) as definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND pg_get_functiondef(p.oid) ILIKE '%FROM%analytes%'
  AND p.proname NOT LIKE 'pg_%'
ORDER BY p.proname;

-- 5. List all functions in public schema (to find the right one)
SELECT 
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  CASE 
    WHEN pg_get_functiondef(p.oid) ILIKE '%analytes%' AND pg_get_functiondef(p.oid) NOT ILIKE '%lab_analytes%' THEN 'Uses analytes (NEEDS FIX)'
    WHEN pg_get_functiondef(p.oid) ILIKE '%lab_analytes%' THEN 'Uses lab_analytes (OK)'
    ELSE 'No analyte reference'
  END as analyte_usage
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND (
    p.proname ILIKE '%report%'
    OR p.proname ILIKE '%template%'
    OR p.proname ILIKE '%context%'
  )
ORDER BY p.proname;
