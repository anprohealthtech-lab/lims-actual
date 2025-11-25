-- =====================================================
-- ANALYTE SYNC SYSTEM - VERIFICATION AND EXECUTION
-- =====================================================
-- Run this AFTER executing 20250125_analyte_sync_system.sql
-- This script:
-- 1. Executes the bulk sync for existing data
-- 2. Runs verification queries
-- 3. Provides migration statistics

-- =====================================================
-- STEP 1: Execute bulk sync for existing data
-- =====================================================

DO $$
DECLARE
  sync_count INT;
  error_count INT;
  skip_count INT;
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Starting bulk sync of lab_analytes...';
  RAISE NOTICE '========================================';
  
  -- Get counts before sync
  SELECT COUNT(*) INTO sync_count FROM lab_analytes;
  RAISE NOTICE 'lab_analytes before sync: %', sync_count;
  
  -- Execute the bulk sync (results will be shown separately)
  PERFORM * FROM bulk_sync_lab_analytes_for_existing_test_groups();
  
  -- Get counts after sync
  SELECT COUNT(*) INTO sync_count FROM lab_analytes;
  RAISE NOTICE 'lab_analytes after sync: %', sync_count;
  
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Bulk sync completed!';
  RAISE NOTICE '========================================';
END $$;

-- Show detailed sync results
SELECT * FROM bulk_sync_lab_analytes_for_existing_test_groups()
ORDER BY action DESC, test_group_name;

-- =====================================================
-- STEP 2: Verification Queries
-- =====================================================

-- Check for orphaned test_group_analytes (test groups with analytes but no lab_analytes entry)
SELECT 
  '==== ORPHANED MAPPINGS CHECK ====' as section;

SELECT 
  tg.id as test_group_id,
  tg.name as test_group_name,
  tg.lab_id,
  a.id as analyte_id,
  a.name as analyte_name,
  CASE 
    WHEN la.id IS NULL THEN '❌ MISSING lab_analytes'
    ELSE '✅ OK'
  END as status
FROM test_group_analytes tga
JOIN test_groups tg ON tg.id = tga.test_group_id
JOIN analytes a ON a.id = tga.analyte_id
LEFT JOIN lab_analytes la ON la.lab_id = tg.lab_id AND la.analyte_id = tga.analyte_id
WHERE tg.lab_id IS NOT NULL
ORDER BY status DESC, tg.name;

-- Summary statistics
SELECT 
  '==== MIGRATION SUMMARY ====' as section;

SELECT 
  'Total test_group_analytes' as metric,
  COUNT(*)::TEXT as count
FROM test_group_analytes

UNION ALL

SELECT 
  'Test groups with lab_id',
  COUNT(DISTINCT tga.test_group_id)::TEXT
FROM test_group_analytes tga
JOIN test_groups tg ON tg.id = tga.test_group_id
WHERE tg.lab_id IS NOT NULL

UNION ALL

SELECT 
  'Unique lab_analytes created',
  COUNT(*)::TEXT
FROM lab_analytes

UNION ALL

SELECT 
  'Orphaned mappings (should be 0)',
  COUNT(*)::TEXT
FROM test_group_analytes tga
JOIN test_groups tg ON tg.id = tga.test_group_id
LEFT JOIN lab_analytes la ON la.lab_id = tg.lab_id AND la.analyte_id = tga.analyte_id
WHERE tg.lab_id IS NOT NULL AND la.id IS NULL

UNION ALL

SELECT 
  'Total analytes (global)',
  COUNT(*)::TEXT
FROM analytes
WHERE is_global = true

UNION ALL

SELECT 
  'Lab_analytes with NULL reference_range',
  COUNT(*)::TEXT
FROM lab_analytes
WHERE reference_range IS NULL

UNION ALL

SELECT 
  'Lab_analytes with NULL unit',
  COUNT(*)::TEXT
FROM lab_analytes
WHERE unit IS NULL

UNION ALL

SELECT 
  'Lab_analytes truly customized',
  COUNT(*)::TEXT
FROM lab_analytes
WHERE lab_specific_reference_range IS NOT NULL
  AND reference_range IS NOT NULL;

-- =====================================================
-- STEP 3: Test the triggers
-- =====================================================

SELECT 
  '==== TRIGGER VALIDATION ====' as section;

-- Check if triggers exist
SELECT 
  trigger_name,
  event_object_table,
  action_timing,
  event_manipulation,
  action_statement,
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

-- Check if functions exist
SELECT 
  routine_name,
  routine_type,
  data_type as return_type,
  CASE 
    WHEN routine_name IS NOT NULL THEN '✅ Active'
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

-- =====================================================
-- STEP 4: Sample data check (first 10 lab_analytes)
-- =====================================================

SELECT 
  '==== SAMPLE LAB_ANALYTES DATA ====' as section;

SELECT 
  la.id,
  l.name as lab_name,
  a.name as global_analyte_name,
  la.name as lab_analyte_name,
  a.reference_range as global_ref_range,
  la.reference_range as lab_ref_range,
  a.unit as global_unit,
  la.unit as lab_unit,
  la.lab_specific_reference_range,
  la.is_active,
  la.visible,
  CASE 
    WHEN la.lab_specific_reference_range IS NOT NULL THEN '🔧 Customized'
    WHEN la.reference_range IS NULL OR la.unit IS NULL THEN '⚠️ Missing Data'
    ELSE '📋 Default (from global)'
  END as status
FROM lab_analytes la
JOIN labs l ON l.id = la.lab_id
JOIN analytes a ON a.id = la.analyte_id
ORDER BY 
  CASE 
    WHEN la.reference_range IS NULL OR la.unit IS NULL THEN 0
    WHEN la.lab_specific_reference_range IS NOT NULL THEN 1
    ELSE 2
  END,
  l.name, 
  a.name
LIMIT 15;

-- =====================================================
-- SUCCESS MESSAGE
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ MIGRATION COMPLETE!';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Review the verification results above';
  RAISE NOTICE '2. Check that "Orphaned mappings" count is 0';
  RAISE NOTICE '3. Verify triggers are active';
  RAISE NOTICE '4. Test by creating a new test group with analytes';
  RAISE NOTICE '';
  RAISE NOTICE 'The sync system is now active and will:';
  RAISE NOTICE '- Auto-create lab_analytes when test groups link to analytes';
  RAISE NOTICE '- Propagate global analyte updates to all labs';
  RAISE NOTICE '- Preserve lab-specific customizations';
  RAISE NOTICE '';
END $$;
