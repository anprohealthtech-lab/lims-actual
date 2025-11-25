# Lab Analytes Report Generation Audit

## Current Status

### ✅ Fixed: UI Edit Flow
- `SimpleAnalyteEditor.tsx` now updates `lab_analytes` table ✅
- `Tests.tsx` handleUpdateAnalyte now updates `lab_analytes` table ✅
- `database.labAnalytes.updateLabSpecific()` method extended with all fields ✅

### ✅ Fixed: Database Schema
- Added missing columns to `lab_analytes` table:
  - `category` ✅
  - `method` ✅
  - `description` ✅
  - `is_critical` ✅
  - `normal_range_min` ✅
  - `normal_range_max` ✅
- Created trigger `sync_analyte_updates_to_lab_analytes()` ✅
- Backfilled existing data ✅

---

## ⚠️ CRITICAL: Report Generation Still Uses Global Analytes

### Report Generation Flow
1. **Netlify Function**: `get-template-context.js` 
   - Calls RPC: `get_report_template_context(p_order_id)`
   
2. **RPC Function**: `get_report_template_context` (PostgreSQL)
   - **NEEDS AUDIT**: Check if it queries `analytes` or `lab_analytes`
   - Returns context with analyte data including:
     - `reference_range`
     - `low_critical` / `high_critical`
     - `unit`
     - `interpretation_*` fields

3. **PDF Service**: `src/utils/pdfService.ts`
   - Uses context from RPC function
   - Generates flags (H/L/Critical) based on reference ranges
   - **ISSUE**: If RPC uses global `analytes`, lab-specific customizations won't appear in reports

---

## 🔍 What Needs to Be Checked

### 1. Find the RPC Function
```sql
-- Search in Supabase SQL Editor or migrations for:
CREATE OR REPLACE FUNCTION get_report_template_context(p_order_id uuid)
```

### 2. Check JOIN Logic
The function likely has logic like this:

**❌ WRONG (Uses Global Analytes)**:
```sql
FROM result_values rv
JOIN analytes a ON a.id = rv.analyte_id  -- Uses global analytes
```

**✅ CORRECT (Uses Lab-Specific Analytes)**:
```sql
FROM result_values rv
JOIN orders o ON o.id = rv.order_id
JOIN lab_analytes la ON la.analyte_id = rv.analyte_id AND la.lab_id = o.lab_id
JOIN analytes a ON a.id = la.analyte_id
```

### 3. Field Selection Priority
The function should prioritize lab-specific fields:
```sql
COALESCE(la.lab_specific_reference_range, la.reference_range, a.reference_range) as reference_range,
COALESCE(la.lab_specific_unit, la.unit, a.unit) as unit,
COALESCE(la.lab_specific_name, la.name, a.name) as analyte_name,
la.low_critical,  -- Already lab-specific
la.high_critical  -- Already lab-specific
```

---

## 📋 Action Items

- [ ] **Find RPC Function**: Search Supabase for `get_report_template_context`
- [ ] **Audit JOIN Logic**: Verify it uses `lab_analytes` not `analytes`
- [ ] **Update Field Selection**: Prioritize `lab_specific_*` fields
- [ ] **Test Report Generation**: 
  - Edit analyte reference range for Lab A
  - Generate report for Lab A → Should show custom range
  - Generate report for Lab B → Should show default range
- [ ] **Check Flag Calculation**: Verify H/L/Critical flags use lab-specific critical values

---

## 🎯 Expected Behavior After Fix

### Scenario 1: Lab A Customizes Hemoglobin Reference Range
- **Global**: 12-16 g/dL
- **Lab A Custom**: 13-17 g/dL (edited via `lab_specific_reference_range`)
- **Lab B**: Uses global 12-16 g/dL

### Report Results:
- Patient with Hemoglobin = 12.5 g/dL
  - **Lab A Report**: Shows "Normal" (within 13-17)
  - **Lab B Report**: Shows "Low" (below 12-16)

---

## 🔧 Migration Status

**File**: `supabase/migrations/20250126_add_missing_lab_analytes_columns.sql`
- ✅ Adds missing columns
- ✅ Backfills data from global analytes
- ✅ Creates sync trigger for future updates
- ✅ Creates performance indexes

**Next Step**: Apply migration, then audit RPC function.
