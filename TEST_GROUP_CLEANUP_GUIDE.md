# Test Group Cleanup System

## Overview
This system identifies and safely deletes test groups that have no analyte mappings in the `test_group_analytes` table. These orphaned test groups are typically created due to errors during test group creation.

## Files Created

1. **`supabase/migrations/20250126_cleanup_unmapped_test_groups.sql`**
   - PostgreSQL functions for finding and deleting unmapped test groups
   - Run this migration first to create the database functions

2. **`cleanup_unmapped_test_groups.sql`**
   - Standalone SQL script for manual cleanup
   - Contains diagnostic queries and step-by-step cleanup process

3. **`cleanup-test-groups.js`**
   - Automated Node.js script for periodic cleanup
   - Can be scheduled with cron or Windows Task Scheduler

## Database Functions

### `find_unmapped_test_groups()`
Finds all test groups that have no analyte mappings.

**Returns:**
- `test_group_id`: UUID of the test group
- `test_group_name`: Name of the test group
- `test_group_code`: Code of the test group
- `lab_id`: Associated lab
- `created_at`: Creation timestamp
- `has_orders`: Whether test group has orders
- `has_results`: Whether test group has results
- `has_workflow_mappings`: Whether test group has workflow mappings

**Usage:**
```sql
SELECT * FROM find_unmapped_test_groups();
```

### `delete_unmapped_test_groups(p_dry_run, p_lab_id)`
Safely deletes unmapped test groups.

**Parameters:**
- `p_dry_run` (boolean, default: true): If true, only previews deletions
- `p_lab_id` (uuid, optional): Filter by specific lab

**Safety Rules:**
- ✅ Deletes test groups with NO orders and NO results
- ⚠️ Skips test groups that have orders or results (data safety)

**Usage:**
```sql
-- Preview what would be deleted (safe)
SELECT * FROM delete_unmapped_test_groups(true, NULL);

-- Actually delete (all labs)
SELECT * FROM delete_unmapped_test_groups(false, NULL);

-- Delete for specific lab only
SELECT * FROM delete_unmapped_test_groups(false, 'lab-uuid-here');
```

## Usage Methods

### Method 1: Apply Migration (First Time Setup)
```bash
# Apply the migration to create the functions
psql -d your_database -f supabase/migrations/20250126_cleanup_unmapped_test_groups.sql

# Or use Supabase CLI
supabase db push
```

### Method 2: Manual SQL Script
```bash
# Open in your SQL client (pgAdmin, DBeaver, etc.)
# Run queries from cleanup_unmapped_test_groups.sql step by step

# Step 1: See what exists (safe)
SELECT * FROM find_unmapped_test_groups();

# Step 2: Preview deletion (safe)
SELECT * FROM delete_unmapped_test_groups(true, NULL);

# Step 3: Actually delete (after review)
SELECT * FROM delete_unmapped_test_groups(false, NULL);
```

### Method 3: Automated Node.js Script
```bash
# Install dependencies (if not already installed)
npm install @supabase/supabase-js dotenv

# Preview only (safe - won't delete anything)
node cleanup-test-groups.js --dry-run

# Actually delete
node cleanup-test-groups.js --execute

# Verbose output with detailed stats
node cleanup-test-groups.js --execute --verbose

# Specific lab only
node cleanup-test-groups.js --execute --lab-id=your-lab-uuid
```

## Scheduling Periodic Cleanup

### Linux/Mac (Cron)
```bash
# Edit crontab
crontab -e

# Add this line to run every Sunday at 2 AM
0 2 * * 0 cd /path/to/project && node cleanup-test-groups.js --execute >> /var/log/test-group-cleanup.log 2>&1
```

### Windows (Task Scheduler)
1. Open Task Scheduler
2. Create Basic Task
3. Name: "LIMS Test Group Cleanup"
4. Trigger: Weekly (Sunday, 2:00 AM)
5. Action: Start a program
   - Program: `node`
   - Arguments: `cleanup-test-groups.js --execute`
   - Start in: `D:\LIMS version 2\project`

### Using PM2 (Process Manager)
```bash
# Install PM2 globally
npm install -g pm2

# Create a cron job with PM2
pm2 start cleanup-test-groups.js --cron "0 2 * * 0" --no-autorestart
```

## Diagnostic Queries

### Count unmapped test groups by lab
```sql
SELECT 
  l.name AS lab_name,
  COUNT(tg.id) AS unmapped_count
FROM labs l
LEFT JOIN test_groups tg ON tg.lab_id = l.id
WHERE NOT EXISTS (
  SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id
)
GROUP BY l.id, l.name
HAVING COUNT(tg.id) > 0;
```

### Find recently created unmapped test groups (last 7 days)
```sql
SELECT 
  tg.name,
  tg.code,
  tg.created_at,
  l.name AS lab_name
FROM test_groups tg
JOIN labs l ON l.id = tg.lab_id
WHERE tg.created_at > NOW() - INTERVAL '7 days'
AND NOT EXISTS (
  SELECT 1 FROM test_group_analytes tga WHERE tga.test_group_id = tg.id
)
ORDER BY tg.created_at DESC;
```

## Safety Features

1. **Dry Run Mode**: Default behavior previews deletions without executing
2. **Data Protection**: Automatically skips test groups with orders or results
3. **Lab Isolation**: Can filter by specific lab to avoid affecting others
4. **Audit Trail**: All actions are logged with detailed messages
5. **Rollback**: If migration is applied, can drop functions if needed

## Rollback (if needed)

```sql
-- Drop the cleanup functions
DROP FUNCTION IF EXISTS delete_unmapped_test_groups(boolean, uuid);
DROP FUNCTION IF EXISTS find_unmapped_test_groups();
```

## Best Practices

1. **Always run dry-run first** to preview what will be deleted
2. **Review the output** before executing actual deletion
3. **Schedule during off-hours** (e.g., 2 AM) to minimize impact
4. **Keep logs** of cleanup operations for audit purposes
5. **Monitor regularly** to catch issues early
6. **Test in staging** before running in production

## Troubleshooting

### Error: "function does not exist"
- Run the migration first: `20250126_cleanup_unmapped_test_groups.sql`

### Error: "permission denied"
- Ensure you're connected with appropriate database permissions
- Functions use SECURITY DEFINER, so they run with creator's permissions

### Script shows no unmapped test groups
- ✅ Good! Your database is clean
- This means all test groups have proper analyte mappings

### Some test groups are skipped
- This is expected for test groups with orders/results
- These test groups have data and should NOT be deleted

## Example Output

```
🧹 Test Group Cleanup Script
================================

Mode: 🔍 DRY RUN (preview only)

📊 Finding unmapped test groups...

Found 5 unmapped test groups:

✅ Safe to delete (5):
  - Test Group ABC (ABC-001)
  - Test Group XYZ (XYZ-002)
  - Sample Test (SAMPLE-003)

🔍 Previewing cleanup...

📋 Would delete (3):
  - Test Group ABC (ABC-001)
  - Test Group XYZ (XYZ-002)
  - Sample Test (SAMPLE-003)

📊 Summary:
  DRY RUN: Would delete 3 test groups, skipped 0

💡 To actually delete these test groups, run:
   node cleanup-test-groups.js --execute
```

## Questions?

For issues or questions, check:
1. Database logs for errors
2. Supabase dashboard for function execution
3. Node.js script output for detailed diagnostics
