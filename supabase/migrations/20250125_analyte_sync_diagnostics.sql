-- =====================================================
-- ANALYTE SYNC SYSTEM - DIAGNOSTIC QUERIES
-- =====================================================
-- Run these queries to diagnose issues with lab_analytes sync

-- =====================================================
-- QUERY 1: Check for NULL values in lab_analytes
-- =====================================================

SELECT 
  '==== NULL VALUES CHECK ====' as section;

SELECT 
  COUNT(*) as total_lab_analytes,
  COUNT(CASE WHEN name IS NULL THEN 1 END) as null_name,
  COUNT(CASE WHEN unit IS NULL THEN 1 END) as null_unit,
  COUNT(CASE WHEN reference_range IS NULL THEN 1 END) as null_reference_range,
  COUNT(CASE WHEN name IS NOT NULL AND unit IS NOT NULL AND reference_range IS NOT NULL THEN 1 END) as complete_records
FROM lab_analytes;

-- =====================================================
-- QUERY 2: Compare lab_analytes with global analytes
-- =====================================================

SELECT 
  '==== DATA SYNC CHECK ====' as section;

SELECT 
  l.name as lab_name,
  a.name as global_analyte_name,
  a.reference_range as global_ref_range,
  a.unit as global_unit,
  la.reference_range as lab_ref_range,
  la.unit as lab_unit,
  la.lab_specific_reference_range,
  CASE 
    WHEN la.reference_range IS NULL AND a.reference_range IS NOT NULL THEN '❌ NOT SYNCED'
    WHEN la.lab_specific_reference_range IS NOT NULL THEN '🔧 CUSTOMIZED'
    WHEN la.reference_range = a.reference_range THEN '✅ SYNCED'
    ELSE '⚠️ MISMATCH'
  END as sync_status
FROM lab_analytes la
JOIN analytes a ON a.id = la.analyte_id
JOIN labs l ON l.id = la.lab_id
ORDER BY sync_status, l.name, a.name
LIMIT 20;

-- =====================================================
-- QUERY 3: Check lab_specific_* field consistency
-- =====================================================

SELECT 
  '==== CUSTOMIZATION CONSISTENCY CHECK ====' as section;

-- Records with lab_specific fields but NULL actual values (PROBLEM)
SELECT 
  COUNT(*) as inconsistent_records,
  'Records with lab_specific_* set but NULL actual values' as issue
FROM lab_analytes
WHERE (
  (reference_range IS NULL AND lab_specific_reference_range IS NOT NULL) OR
  (unit IS NULL AND lab_specific_unit IS NOT NULL) OR
  (name IS NULL AND lab_specific_name IS NOT NULL)
)

UNION ALL

-- Records with actual values different from global but no lab_specific marker (POTENTIAL ISSUE)
SELECT 
  COUNT(*) as potentially_customized,
  'Records with different values but no lab_specific marker' as issue
FROM lab_analytes la
JOIN analytes a ON a.id = la.analyte_id
WHERE (
  (la.reference_range IS DISTINCT FROM a.reference_range AND la.lab_specific_reference_range IS NULL) OR
  (la.unit IS DISTINCT FROM a.unit AND la.lab_specific_unit IS NULL) OR
  (la.name IS DISTINCT FROM a.name AND la.lab_specific_name IS NOT NULL)
);

-- =====================================================
-- QUERY 4: Detailed view of problematic records
-- =====================================================

SELECT 
  '==== PROBLEMATIC RECORDS DETAIL ====' as section;

SELECT 
  l.name as lab_name,
  a.name as global_analyte,
  la.name as lab_analyte_name,
  la.reference_range as lab_ref_range,
  la.lab_specific_reference_range,
  la.unit as lab_unit,
  la.lab_specific_unit,
  CASE 
    WHEN la.reference_range IS NULL AND la.lab_specific_reference_range IS NOT NULL 
      THEN '❌ NULL value but marked as customized'
    WHEN la.reference_range IS NULL AND a.reference_range IS NOT NULL 
      THEN '⚠️ Not synced from global'
    ELSE 'OK'
  END as issue
FROM lab_analytes la
JOIN analytes a ON a.id = la.analyte_id
JOIN labs l ON l.id = la.lab_id
WHERE (
  -- Has NULL values
  la.reference_range IS NULL OR
  la.unit IS NULL OR
  la.name IS NULL
)
ORDER BY issue, l.name, a.name
LIMIT 20;

-- =====================================================
-- QUERY 5: Global analytes missing from lab_analytes
-- =====================================================

SELECT 
  '==== MISSING LAB_ANALYTES CHECK ====' as section;

SELECT 
  tg.name as test_group_name,
  l.name as lab_name,
  a.name as analyte_name,
  a.reference_range as global_ref_range,
  '❌ Missing in lab_analytes' as status
FROM test_group_analytes tga
JOIN test_groups tg ON tg.id = tga.test_group_id
JOIN analytes a ON a.id = tga.analyte_id
JOIN labs l ON l.id = tg.lab_id
LEFT JOIN lab_analytes la ON la.lab_id = tg.lab_id AND la.analyte_id = tga.analyte_id
WHERE la.id IS NULL
ORDER BY l.name, tg.name, a.name
LIMIT 10;

-- =====================================================
-- QUERY 6: Statistics by lab
-- =====================================================

SELECT 
  '==== STATISTICS BY LAB ====' as section;

SELECT 
  l.name as lab_name,
  COUNT(la.id) as total_lab_analytes,
  COUNT(CASE WHEN la.reference_range IS NOT NULL THEN 1 END) as with_ref_range,
  COUNT(CASE WHEN la.unit IS NOT NULL THEN 1 END) as with_unit,
  COUNT(CASE WHEN la.lab_specific_reference_range IS NOT NULL THEN 1 END) as customized,
  ROUND(
    COUNT(CASE WHEN la.reference_range IS NOT NULL THEN 1 END)::NUMERIC / 
    NULLIF(COUNT(la.id), 0) * 100, 
    2
  ) || '%' as completion_rate
FROM labs l
LEFT JOIN lab_analytes la ON la.lab_id = l.id
GROUP BY l.id, l.name
ORDER BY COUNT(la.id) DESC;

-- =====================================================
-- QUERY 7: Test data integrity
-- =====================================================

SELECT 
  '==== DATA INTEGRITY CHECK ====' as section;

-- Check for duplicate lab_analytes
SELECT 
  COUNT(*) as duplicate_count,
  'Duplicate lab_analytes (lab_id + analyte_id)' as check_type
FROM (
  SELECT lab_id, analyte_id, COUNT(*) as cnt
  FROM lab_analytes
  GROUP BY lab_id, analyte_id
  HAVING COUNT(*) > 1
) duplicates

UNION ALL

-- Check for orphaned lab_analytes (analyte_id not in analytes)
SELECT 
  COUNT(*),
  'Orphaned lab_analytes (invalid analyte_id)'
FROM lab_analytes la
LEFT JOIN analytes a ON a.id = la.analyte_id
WHERE a.id IS NULL

UNION ALL

-- Check for orphaned lab_analytes (lab_id not in labs)
SELECT 
  COUNT(*),
  'Orphaned lab_analytes (invalid lab_id)'
FROM lab_analytes la
LEFT JOIN labs l ON l.id = la.lab_id
WHERE l.id IS NULL;

-- =====================================================
-- SUMMARY
-- =====================================================

DO $$
DECLARE
  v_null_count INT;
  v_inconsistent_count INT;
  v_missing_count INT;
BEGIN
  SELECT COUNT(*) INTO v_null_count
  FROM lab_analytes
  WHERE reference_range IS NULL OR unit IS NULL;
  
  SELECT COUNT(*) INTO v_inconsistent_count
  FROM lab_analytes
  WHERE (
    (reference_range IS NULL AND lab_specific_reference_range IS NOT NULL) OR
    (unit IS NULL AND lab_specific_unit IS NOT NULL)
  );
  
  SELECT COUNT(*) INTO v_missing_count
  FROM test_group_analytes tga
  JOIN test_groups tg ON tg.id = tga.test_group_id
  LEFT JOIN lab_analytes la ON la.lab_id = tg.lab_id AND la.analyte_id = tga.analyte_id
  WHERE tg.lab_id IS NOT NULL AND la.id IS NULL;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '📊 DIAGNOSTIC SUMMARY';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Records with NULL values: %', v_null_count;
  RAISE NOTICE 'Inconsistent lab_specific markers: %', v_inconsistent_count;
  RAISE NOTICE 'Missing lab_analytes: %', v_missing_count;
  RAISE NOTICE '';
  
  IF v_null_count > 0 OR v_inconsistent_count > 0 OR v_missing_count > 0 THEN
    RAISE NOTICE '⚠️ ISSUES DETECTED - Run the data fix script!';
    RAISE NOTICE 'Execute: 20250125_analyte_sync_data_fix.sql';
  ELSE
    RAISE NOTICE '✅ All checks passed!';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
END $$;
