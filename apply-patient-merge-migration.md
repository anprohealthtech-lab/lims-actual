# Apply Patient Merge Migration

## The Issue
The error `relation "public.v_patients_with_duplicates" does not exist` means the database view hasn't been created yet.

## How to Fix

### Option 1: Supabase Dashboard (Recommended)
1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Open the file: `db/migrations/20251118_patient_merge_system.sql`
4. Copy the entire SQL content
5. Paste into the SQL Editor
6. Click **Run** to execute

### Option 2: Supabase CLI
```bash
cd "D:\LIMS version 2\project"
supabase db push
```

### Option 3: Direct psql Connection
If you have direct database access:
```bash
psql -h your-db-host -U postgres -d your-database -f db/migrations/20251118_patient_merge_system.sql
```

## What This Migration Creates

1. **Columns on `patients` table:**
   - `master_patient_id` - Links duplicate to master
   - `is_duplicate` - Flags duplicate records
   - `merge_date` - When merge happened
   - `merged_by` - User who merged

2. **View `v_patients_with_duplicates`:**
   - Shows only unique/master patients
   - Includes `duplicate_count`, `duplicate_patient_ids`, `duplicate_patient_names`

3. **RPC Functions:**
   - `merge_patients(master_id, duplicate_id, user_id)` - Merges two patients
   - `unmerge_patient(duplicate_id)` - Undoes a merge
   - `get_patient_with_duplicates(patient_id)` - Gets master + all duplicates

4. **Indexes & Permissions:**
   - Performance indexes on merge columns
   - Row-level security grants

## Verification
After running, test with:
```sql
SELECT * FROM v_patients_with_duplicates LIMIT 5;
```

You should see patient records with `duplicate_count` = 0 (or higher if you've merged patients).

## Patient Merge Flow (After Migration)

### 1. View Patients Page
- Shows unique/master patients only (from `v_patients_with_duplicates` view)
- Each row has a merge button (purple copy icon)

### 2. Click Merge Button on Any Patient
- Opens **PatientMergeModal**
- Selected patient becomes the **Master** (kept)
- Search/select a **Duplicate** patient to merge into master

### 3. Merge Preview
- Shows both patients side-by-side
- Warning: Duplicate will be hidden from main list
- All orders/tests remain with original patient records

### 4. Confirm Merge
- Calls `merge_patients()` RPC function
- Marks duplicate with `is_duplicate = TRUE`
- Links via `master_patient_id = master.id`
- Duplicate disappears from main patient list

### 5. View Duplicates
- If a patient has `duplicate_count > 0`, amber badge shows
- Click the Users icon to open **ViewDuplicatesModal**
- See all linked duplicates
- Option to unmerge any duplicate

### 6. Unmerge (If Needed)
- In ViewDuplicatesModal, click unmerge on any duplicate
- Calls `unmerge_patient()` RPC
- Restores duplicate as independent patient
- Reappears in main patient list

## Code Changes Made

1. **PatientMergeModal.tsx:**
   - Added `lab_id` to Patient interface
   - Added fallback to get `lab_id` from current user if not in patient object

2. **Patients.tsx:**
   - Removed confusing top "Merge Tool" button
   - Merge now triggered only per-row (clearer UX)

## Ready to Test
After applying migration:
1. Refresh your app
2. Go to Patients page
3. Click merge icon on any patient row
4. Search for duplicate
5. Select and merge
6. Verify duplicate disappears from main list
7. Check master patient shows duplicate count badge
