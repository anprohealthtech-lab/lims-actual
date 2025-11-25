# Analyte Sync System Migration

## Overview

This migration implements a comprehensive 3-tier analyte sync system for multi-lab architecture:

```
analytes (global) → lab_analytes (lab-specific) → test_group_analytes (junction)
```

## Architecture

### Tables
- **`analytes`**: Global master data (is_global = true)
- **`lab_analytes`**: Lab-specific copies with custom reference ranges
- **`test_group_analytes`**: Junction table linking test groups to analytes

### Automatic Sync Features

1. **Auto-create lab_analytes** when test groups link to analytes
2. **Propagate global updates** to all lab_analytes
3. **Preserve lab customizations** (lab_specific_* fields)

## Migration Files

### 1. `20250125_analyte_sync_system.sql`
Creates the database triggers and functions:
- `sync_lab_analyte_from_global()` - Auto-creates lab_analytes on INSERT
- `sync_lab_analytes_on_analyte_update()` - Propagates global updates
- `bulk_sync_lab_analytes_for_existing_test_groups()` - One-time migration

### 2. `20250125_analyte_sync_verification.sql`
Executes the bulk sync and runs verification queries

## Installation Steps

### Step 1: Run the Migration
```sql
-- In Supabase SQL Editor
\i supabase/migrations/20250125_analyte_sync_system.sql
```

Or copy/paste the entire contents of `20250125_analyte_sync_system.sql` into Supabase SQL Editor.

### Step 2: Run Verification
```sql
-- In Supabase SQL Editor
\i supabase/migrations/20250125_analyte_sync_verification.sql
```

Or copy/paste the entire contents of `20250125_analyte_sync_verification.sql` into Supabase SQL Editor.

### Step 3: Run Diagnostics (if issues found)
```sql
-- In Supabase SQL Editor
\i supabase/migrations/20250125_analyte_sync_diagnostics.sql
```

This will show detailed analysis of any data issues.

### Step 4: Apply Data Fix (if needed)
If you see NULL values or inconsistent customization markers:

```sql
-- In Supabase SQL Editor
\i supabase/migrations/20250125_analyte_sync_data_fix.sql
```

This will:
- Clear incorrect `lab_specific_*` markers on NULL values
- Sync all missing data from global analytes
- Fix the "🔧 Customized" status showing on NULL records

### Step 5: Review Results
The verification script will output:
- ✅ Number of lab_analytes created
- ✅ Orphaned mappings check (should be 0)
- ✅ Trigger status validation
- ✅ Sample data preview

## Key Fixes

### Ambiguous Column Reference Error (FIXED)
**Issue**: PostgreSQL couldn't distinguish between `lab_id` variable and `lab_id` column.

**Solution**: Qualified all column references with table names:
```sql
-- ❌ Before (ambiguous)
WHERE lab_id = v_lab_id

-- ✅ After (explicit)
WHERE lab_analytes.lab_id = v_lab_id
```

## Testing the Sync System

### Test 1: Auto-create lab_analytes
```sql
-- Create a new test group
INSERT INTO test_group_analytes (test_group_id, analyte_id)
VALUES ('your-test-group-id', 'your-analyte-id');

-- Verify lab_analytes was auto-created
SELECT * FROM lab_analytes
WHERE analyte_id = 'your-analyte-id';
```

### Test 2: Propagate global updates
```sql
-- Update a global analyte
UPDATE analytes
SET reference_range = '10-20 mg/dL'
WHERE id = 'your-analyte-id';

-- Verify all lab_analytes were updated (if not customized)
SELECT lab_id, reference_range
FROM lab_analytes
WHERE analyte_id = 'your-analyte-id';
```

### Test 3: Preserve lab customizations
```sql
-- Customize a lab_analyte
UPDATE lab_analytes
SET reference_range = '12-18 mg/dL',
    lab_specific_reference_range = '12-18 mg/dL'
WHERE lab_id = 'your-lab-id'
  AND analyte_id = 'your-analyte-id';

-- Update global analyte
UPDATE analytes
SET reference_range = '8-22 mg/dL'
WHERE id = 'your-analyte-id';

-- Verify lab customization was preserved
SELECT reference_range, lab_specific_reference_range
FROM lab_analytes
WHERE lab_id = 'your-lab-id'
  AND analyte_id = 'your-analyte-id';
-- Should still be '12-18 mg/dL'
```

## Lab Customization Fields

Lab-specific overrides are stored in these columns:
- `lab_specific_name`
- `lab_specific_unit`
- `lab_specific_reference_range`
- `lab_specific_interpretation_low`
- `lab_specific_interpretation_normal`
- `lab_specific_interpretation_high`

**If any lab_specific_* field is NOT NULL**, the corresponding field will NOT be updated during global analyte updates.

## Verification Queries

### Check for orphaned mappings
```sql
SELECT 
  tg.name as test_group_name,
  a.name as analyte_name,
  CASE 
    WHEN la.id IS NULL THEN '❌ MISSING'
    ELSE '✅ OK'
  END as status
FROM test_group_analytes tga
JOIN test_groups tg ON tg.id = tga.test_group_id
JOIN analytes a ON a.id = tga.analyte_id
LEFT JOIN lab_analytes la ON la.lab_id = tg.lab_id AND la.analyte_id = tga.analyte_id
WHERE tg.lab_id IS NOT NULL AND la.id IS NULL;
```

### Summary statistics
```sql
SELECT 
  (SELECT COUNT(*) FROM analytes WHERE is_global = true) as total_analytes,
  (SELECT COUNT(*) FROM lab_analytes) as total_lab_analytes,
  (SELECT COUNT(*) FROM test_group_analytes) as total_mappings;
```

## Rollback (if needed)

```sql
-- Drop triggers
DROP TRIGGER IF EXISTS trigger_sync_lab_analyte_on_test_group_link ON test_group_analytes;
DROP TRIGGER IF EXISTS trigger_sync_lab_analyte_on_analyte_update ON analytes;

-- Drop functions
DROP FUNCTION IF EXISTS sync_lab_analyte_from_global();
DROP FUNCTION IF EXISTS sync_lab_analytes_on_analyte_update();
DROP FUNCTION IF EXISTS bulk_sync_lab_analytes_for_existing_test_groups();

-- CAUTION: This will delete all lab_analytes data
-- DELETE FROM lab_analytes;
```

## Monitoring

### Check trigger execution logs
```sql
-- Enable verbose logging
SET client_min_messages = NOTICE;

-- Create a test mapping and watch the logs
INSERT INTO test_group_analytes (test_group_id, analyte_id)
VALUES ('test-group-id', 'analyte-id');
```

### View sync statistics
```sql
SELECT 
  l.name as lab_name,
  COUNT(la.id) as analyte_count
FROM labs l
LEFT JOIN lab_analytes la ON la.lab_id = l.id
GROUP BY l.id, l.name
ORDER BY analyte_count DESC;
```

## Troubleshooting

### Issue: All records show "🔧 Customized" even with NULL values

**Symptom**: Verification script shows records with NULL reference_range/unit marked as customized

**Cause**: The `lab_specific_reference_range` field has non-NULL values even though actual data is NULL

**Solution**: Run the data fix script
```sql
\i supabase/migrations/20250125_analyte_sync_data_fix.sql
```

### Issue: Trigger not firing
```sql
-- Check if trigger exists
SELECT * FROM information_schema.triggers
WHERE trigger_name = 'trigger_sync_lab_analyte_on_test_group_link';
```

### Issue: Duplicate lab_analytes
```sql
-- Find duplicates
SELECT lab_id, analyte_id, COUNT(*)
FROM lab_analytes
GROUP BY lab_id, analyte_id
HAVING COUNT(*) > 1;
```

### Issue: Missing lab_id on test_groups
```sql
-- Find test groups without lab_id
SELECT id, name FROM test_groups WHERE lab_id IS NULL;
```

## Performance Considerations

- Triggers execute synchronously (AFTER INSERT/UPDATE)
- Bulk sync function processes all test_group_analytes in one transaction
- For large datasets (>10,000 records), consider running bulk sync during off-peak hours

## Next Steps

1. ✅ Run migration
2. ✅ Run verification
3. ✅ Review orphaned mappings (should be 0)
4. ✅ Test trigger functionality
5. ✅ Monitor logs for any errors
6. ✅ Update application code to use `lab_analytes` instead of `analytes` for lab-specific data

## Support

For issues or questions:
- Check Supabase logs for trigger execution errors
- Review verification query results
- Test with a single test group before bulk operations
