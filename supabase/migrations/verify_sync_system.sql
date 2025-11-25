-- =====================================================
-- STEP-BY-STEP VERIFICATION
-- =====================================================

-- STEP 1: Check if triggers exist
-- =====================================================
SELECT 
  '=== STEP 1: TRIGGER STATUS ===' as step;

SELECT 
  trigger_name,
  event_object_table as table_name,
  action_timing || ' ' || event_manipulation as trigger_event,
  CASE 
    WHEN trigger_name IS NOT NULL THEN '✅ Active'
    ELSE '❌ Missing'
  END as status
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name IN (
    'trigger_sync_lab_analyte_on_test_group_link',
    'trigger_sync_lab_analyte_on_analyte_update'
  )
ORDER BY trigger_name;

-- STEP 2: Check if functions exist
-- =====================================================
SELECT 
  '=== STEP 2: FUNCTION STATUS ===' as step;

SELECT 
  routine_name as function_name,
  CASE 
    WHEN routine_name IS NOT NULL THEN '✅ Exists'
    ELSE '❌ Missing'
  END as status
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'sync_lab_analyte_from_global',
    'sync_lab_analytes_on_analyte_update',
    'bulk_sync_lab_analytes_for_existing_test_groups'
  )
ORDER BY routine_name;

-- STEP 3: Check for orphaned test_group_analytes
-- =====================================================
SELECT 
  '=== STEP 3: ORPHAN CHECK ===' as step;

SELECT 
  tg.name as test_group_name,
  a.name as analyte_name,
  tg.lab_id,
  CASE 
    WHEN la.id IS NULL THEN '❌ MISSING lab_analyte'
    ELSE '✅ OK'
  END as status
FROM test_group_analytes tga
JOIN test_groups tg ON tg.id = tga.test_group_id
JOIN analytes a ON a.id = tga.analyte_id
LEFT JOIN lab_analytes la ON la.lab_id = tg.lab_id AND la.analyte_id = tga.analyte_id
WHERE tg.lab_id IS NOT NULL
ORDER BY status DESC, tg.name
LIMIT 20;

-- STEP 4: Summary counts
-- =====================================================
SELECT 
  '=== STEP 4: SUMMARY COUNTS ===' as step;

SELECT 
  'Total test_group_analytes' as metric,
  COUNT(*)::TEXT as count
FROM test_group_analytes

UNION ALL

SELECT 
  'Total lab_analytes',
  COUNT(*)::TEXT
FROM lab_analytes

UNION ALL

SELECT 
  'Orphaned (missing lab_analytes)',
  COUNT(*)::TEXT
FROM test_group_analytes tga
JOIN test_groups tg ON tg.id = tga.test_group_id
LEFT JOIN lab_analytes la ON la.lab_id = tg.lab_id AND la.analyte_id = tga.analyte_id
WHERE tg.lab_id IS NOT NULL AND la.id IS NULL

UNION ALL

SELECT 
  'Test groups with lab_id',
  COUNT(DISTINCT tg.id)::TEXT
FROM test_groups tg
WHERE tg.lab_id IS NOT NULL;

-- STEP 5: Sample lab_analytes data
-- =====================================================
SELECT 
  '=== STEP 5: SAMPLE DATA ===' as step;

SELECT 
  l.name as lab_name,
  a.name as analyte_name,
  la.reference_range,
  la.unit,
  la.is_active
FROM lab_analytes la
JOIN labs l ON l.id = la.lab_id
JOIN analytes a ON a.id = la.analyte_id
ORDER BY l.name, a.name
LIMIT 10;
