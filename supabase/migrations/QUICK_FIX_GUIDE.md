# Analyte Sync System - Quick Fix Guide

## 🔴 Problem: NULL values with "Customized" status

### What you're seeing:
```json
{
  "analyte_name": "ALP",
  "reference_range": null,
  "unit": null,
  "customization_status": "🔧 Customized"  // ❌ Wrong!
}
```

### Root cause:
The `lab_specific_reference_range` column has non-NULL values even though the actual `reference_range` is NULL. This happens when:
1. Lab_analytes were created before the sync system
2. Manual data entry left fields incomplete
3. Previous migration didn't properly initialize values

## ✅ Solution: Run the Data Fix Script

### Quick fix (copy/paste into Supabase SQL Editor):

```sql
-- Run this in Supabase SQL Editor
\i supabase/migrations/20250125_analyte_sync_data_fix.sql
```

Or run the commands manually:

```sql
-- Step 1: Clear incorrect lab_specific markers
UPDATE lab_analytes
SET 
  lab_specific_name = NULL,
  lab_specific_unit = NULL,
  lab_specific_reference_range = NULL,
  lab_specific_interpretation_low = NULL,
  lab_specific_interpretation_normal = NULL,
  lab_specific_interpretation_high = NULL
WHERE (
  (name IS NULL OR unit IS NULL OR reference_range IS NULL)
  AND (
    lab_specific_name IS NOT NULL OR
    lab_specific_unit IS NOT NULL OR
    lab_specific_reference_range IS NOT NULL
  )
);

-- Step 2: Sync from global analytes
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
```

## 🔍 Verify the fix worked:

```sql
-- Should return 0
SELECT COUNT(*) as should_be_zero
FROM lab_analytes
WHERE reference_range IS NULL;

-- Check sample data
SELECT 
  l.name as lab_name,
  a.name as analyte_name,
  la.reference_range,
  la.unit,
  CASE 
    WHEN la.lab_specific_reference_range IS NOT NULL THEN '🔧 Customized'
    WHEN la.reference_range IS NULL THEN '⚠️ Missing Data'
    ELSE '📋 Default (from global)'
  END as status
FROM lab_analytes la
JOIN labs l ON l.id = la.lab_id
JOIN analytes a ON a.id = la.analyte_id
ORDER BY status, l.name
LIMIT 10;
```

## 📊 Expected result after fix:

```json
{
  "analyte_name": "ALP",
  "reference_range": "30-120 U/L",  // ✅ Populated!
  "unit": "U/L",                     // ✅ Populated!
  "customization_status": "📋 Default (from global)"  // ✅ Correct!
}
```

## 🔄 How to truly customize a lab_analyte:

After the fix, if you want to set lab-specific values:

```sql
-- Example: Customize ALP reference range for a specific lab
UPDATE lab_analytes
SET 
  reference_range = '25-115 U/L',  -- Set your custom value
  lab_specific_reference_range = '25-115 U/L'  -- Mark as customized
WHERE lab_id = 'your-lab-id'
  AND analyte_id = (SELECT id FROM analytes WHERE name = 'ALP');
```

Now it will show:
```json
{
  "reference_range": "25-115 U/L",
  "lab_specific_reference_range": "25-115 U/L",
  "customization_status": "🔧 Customized"  // ✅ Correct!
}
```

## 📝 Migration execution order:

1. ✅ `20250125_analyte_sync_system.sql` (creates triggers/functions)
2. ✅ `20250125_analyte_sync_verification.sql` (initial check)
3. ⚠️ `20250125_analyte_sync_diagnostics.sql` (detailed analysis) ← You are here
4. 🔧 `20250125_analyte_sync_data_fix.sql` (fixes NULL values) ← Run this next
5. ✅ Re-run verification to confirm fix

## 🆘 Still having issues?

Run the full diagnostics:
```sql
\i supabase/migrations/20250125_analyte_sync_diagnostics.sql
```

This will show:
- NULL value counts
- Inconsistent customization markers
- Missing lab_analytes
- Data integrity issues
- Per-lab statistics
