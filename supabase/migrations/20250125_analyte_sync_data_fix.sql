-- =====================================================
-- ANALYTE SYNC SYSTEM - DATA FIX
-- =====================================================
-- This script fixes lab_analytes records that have NULL values
-- but incorrectly marked as customized
-- Run this AFTER the initial migration

-- =====================================================
-- STEP 1: Identify the problem
-- =====================================================

SELECT 
  '==== PROBLEM ANALYSIS ====' as section;

-- Show records with NULL values but marked as customized
SELECT 
  COUNT(*) as affected_records
FROM lab_analytes
WHERE (
  -- Has NULL actual values
  (name IS NULL OR unit IS NULL OR reference_range IS NULL)
  -- But has non-NULL lab_specific markers
  AND (
    lab_specific_name IS NOT NULL OR
    lab_specific_unit IS NOT NULL OR
    lab_specific_reference_range IS NOT NULL
  )
);

-- =====================================================
-- STEP 2: Fix the data
-- =====================================================

DO $$
DECLARE
  v_fixed_count INT := 0;
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Starting data fix for lab_analytes...';
  RAISE NOTICE '========================================';
  
  -- Clear lab_specific fields where actual values are NULL
  UPDATE lab_analytes
  SET 
    lab_specific_name = NULL,
    lab_specific_unit = NULL,
    lab_specific_reference_range = NULL,
    lab_specific_interpretation_low = NULL,
    lab_specific_interpretation_normal = NULL,
    lab_specific_interpretation_high = NULL
  WHERE (
    -- Has NULL actual values
    (name IS NULL OR unit IS NULL OR reference_range IS NULL)
    -- But has non-NULL lab_specific markers
    AND (
      lab_specific_name IS NOT NULL OR
      lab_specific_unit IS NOT NULL OR
      lab_specific_reference_range IS NOT NULL OR
      lab_specific_interpretation_low IS NOT NULL OR
      lab_specific_interpretation_normal IS NOT NULL OR
      lab_specific_interpretation_high IS NOT NULL
    )
  );
  
  GET DIAGNOSTICS v_fixed_count = ROW_COUNT;
  
  RAISE NOTICE 'Fixed % lab_analytes records', v_fixed_count;
  
  -- Now sync from global analytes to populate the NULL values
  UPDATE lab_analytes la
  SET
    name = a.name,
    unit = a.unit,
    reference_range = a.reference_range,
    reference_range_male = a.reference_range_male,
    reference_range_female = a.reference_range_female,
    low_critical = a.low_critical,
    high_critical = a.high_critical,
    critical_low = a.low_critical,
    critical_high = a.high_critical,
    interpretation_low = a.interpretation_low,
    interpretation_normal = a.interpretation_normal,
    interpretation_high = a.interpretation_high,
    updated_at = NOW()
  FROM analytes a
  WHERE la.analyte_id = a.id
    AND (la.name IS NULL OR la.unit IS NULL OR la.reference_range IS NULL)
    AND la.lab_specific_reference_range IS NULL;
  
  GET DIAGNOSTICS v_fixed_count = ROW_COUNT;
  
  RAISE NOTICE 'Synced % lab_analytes from global analytes', v_fixed_count;
  
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ Data fix completed!';
  RAISE NOTICE '========================================';
END $$;

-- =====================================================
-- STEP 3: Verify the fix
-- =====================================================

SELECT 
  '==== VERIFICATION AFTER FIX ====' as section;

-- Count records with NULL values
SELECT 
  'Records with NULL reference_range' as metric,
  COUNT(*)::TEXT as count
FROM lab_analytes
WHERE reference_range IS NULL

UNION ALL

SELECT 
  'Records with NULL unit',
  COUNT(*)::TEXT
FROM lab_analytes
WHERE unit IS NULL

UNION ALL

SELECT 
  'Records with NULL name',
  COUNT(*)::TEXT
FROM lab_analytes
WHERE name IS NULL

UNION ALL

SELECT 
  'Records incorrectly marked as customized',
  COUNT(*)::TEXT
FROM lab_analytes
WHERE (
  (name IS NULL OR unit IS NULL OR reference_range IS NULL)
  AND (
    lab_specific_name IS NOT NULL OR
    lab_specific_unit IS NOT NULL OR
    lab_specific_reference_range IS NOT NULL
  )
);

-- Show sample data after fix
SELECT 
  '==== SAMPLE DATA AFTER FIX ====' as section;

SELECT 
  la.id,
  l.name as lab_name,
  a.name as analyte_name,
  la.name as lab_analyte_name,
  la.reference_range,
  la.unit,
  la.is_active,
  la.visible,
  CASE 
    WHEN la.lab_specific_reference_range IS NOT NULL THEN '🔧 Customized'
    WHEN la.reference_range IS NULL THEN '⚠️ Missing Data'
    ELSE '📋 Default (from global)'
  END as status
FROM lab_analytes la
JOIN labs l ON l.id = la.lab_id
JOIN analytes a ON a.id = la.analyte_id
ORDER BY l.name, a.name
LIMIT 15;

-- =====================================================
-- SUCCESS MESSAGE
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ DATA FIX COMPLETE!';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'All lab_analytes should now have:';
  RAISE NOTICE '1. Valid reference_range, unit, and name from global analytes';
  RAISE NOTICE '2. NULL lab_specific_* fields (unless truly customized)';
  RAISE NOTICE '3. Correct customization status';
  RAISE NOTICE '';
  RAISE NOTICE 'Next: Review the sample data above to verify';
  RAISE NOTICE '';
END $$;
