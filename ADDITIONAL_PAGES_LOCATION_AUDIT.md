# Additional Pages - Location Filtering Audit

**Date**: 2026-01-21  
**Status**: ⚠️ **ADDITIONAL PAGES NEED REVIEW**

## Summary

After implementing location filtering for the critical 5 pages, 3 additional pages were identified that may need location filtering:

1. ❓ **Patients** - May be intentionally lab-wide
2. ❌ **Outsourced Tests Queue** - Needs filtering  
3. ❓ **Outsourced Reports Console** - Needs review

---

## Detailed Analysis

### 1. Patients Page (`src/pages/Patients.tsx`)

**Current Implementation** (Line 94-98):
```tsx
const { data, error } = await supabase
  .from('v_patients_with_duplicates')
  .select('*')
  .eq('lab_id', labId)
  .order('registration_date', { ascending: false });
```

**Status**: ❓ **NEEDS BUSINESS DECISION**

**Analysis**:
- Currently shows ALL patients for the lab (no location filter)
- **This might be intentional** because:
  - Patients can visit multiple locations within the same lab
  - Patient records should be lab-wide for continuity of care
  - A patient registered at Location A might get tested at Location B later
  - Medical history needs to be accessible across all locations

**Recommendation**: 
- **DO NOT FILTER** patients by location
- Patients should remain lab-wide entities
- **Rationale**: Medical continuity and patient safety require full patient history access
- **Alternative**: If needed, add a "Registered at Location" field for reference only

**Action Required**: ✅ **NO ACTION** - Keep as lab-wide

---

### 2. Outsourced Tests Queue (`src/pages/OutsourcedTestsQueue.tsx`)

**Current Implementation** (Line 73-93):
```tsx
const fetchQueue = useCallback(async () => {
  setLoading(true);
  setSelectedItems(new Set());

  const filters: any = {};
  if (selectedLab !== 'all') filters.outsourcedLabId = selectedLab;
  if (fromDate) filters.fromDate = fromDate;
  if (toDate) filters.toDate = toDate;

  const { data, error } = await database.outsourcedReports.getPendingTests(filters);
  
  if (error) {
    console.error('Error fetching queue:', error);
    alert('Failed to load queue');
    setQueueItems([]);
  } else {
    setQueueItems(data || []);
  }
  setLoading(false);
}, [selectedLab, fromDate, toDate]);
```

**Status**: ❌ **NEEDS LOCATION FILTERING**

**Issue**: 
- Uses `database.outsourcedReports.getPendingTests(filters)`
- No location filtering applied
- Users can see outsourced tests from ALL locations

**Impact**:
- Users can see which tests are being sent to external labs from locations they're not assigned to
- Potential data leakage of test volume and outsourcing patterns

**Recommended Fix**:
```tsx
const fetchQueue = useCallback(async () => {
  setLoading(true);
  setSelectedItems(new Set());

  // ✅ Apply location filtering
  const { shouldFilter, locationIds } = await database.shouldFilterByLocation();

  const filters: any = {};
  if (selectedLab !== 'all') filters.outsourcedLabId = selectedLab;
  if (fromDate) filters.fromDate = fromDate;
  if (toDate) filters.toDate = toDate;
  
  // ✅ Add location filter
  if (shouldFilter && locationIds.length > 0) {
    filters.locationIds = locationIds;
  }

  const { data, error } = await database.outsourcedReports.getPendingTests(filters);
  
  if (error) {
    console.error('Error fetching queue:', error);
    alert('Failed to load queue');
    setQueueItems([]);
  } else {
    setQueueItems(data || []);
  }
  setLoading(false);
}, [selectedLab, fromDate, toDate]);
```

**Note**: This also requires updating the `database.outsourcedReports.getPendingTests()` function in the database service to accept and apply `locationIds` filter.

**Action Required**: 🔴 **IMPLEMENT FILTERING**

---

### 3. Outsourced Reports Console (`src/pages/OutsourcedReportsConsole.tsx`)

**Current Implementation**: File needs to be reviewed

**Status**: ❓ **NEEDS REVIEW**

**Action Required**: 🟡 **INVESTIGATE**
- Review the data queries in this page
- Determine if it queries outsourced test data
- Apply location filtering if needed

---

##Summary Table

| Page | Current Status | Location Filter | Action Required | Priority |
|------|----------------|-----------------|-----------------|----------|
| **Patients** | ❓ Lab-wide | ❌ None | ✅ Keep as-is | N/A |
| **Outsourced Tests Queue** | ❌ No filter | ❌ None | 🔴 Implement | High |
| **Outsourced Reports Console** | ❓ Unknown | ❓ Unknown | 🟡 Review | Medium |

---

## Implementation Plan for Outsourced Tests Queue

### Step 1: Update Frontend (OutsourcedTestsQueue.tsx)

**File**: `src/pages/OutsourcedTestsQueue.tsx`  
**Line**: 73

```tsx
const fetchQueue = useCallback(async () => {
  setLoading(true);
  setSelectedItems(new Set());

  // ✅ Apply location filtering for access control
  const { shouldFilter, locationIds } = await database.shouldFilterByLocation();

  const filters: any = {};
  if (selectedLab !== 'all') filters.outsourcedLabId = selectedLab;
  if (fromDate) filters.fromDate = fromDate;
  if (toDate) filters.toDate = toDate;
  
  // ✅ Add location filter
  if (shouldFilter && locationIds.length > 0) {
    filters.locationIds = locationIds;
  }

  const { data, error } = await database.outsourcedReports.getPendingTests(filters);
  
  if (error) {
    console.error('Error fetching queue:', error);
    alert('Failed to load queue');
    setQueueItems([]);
  } else {
    setQueueItems(data || []);
  }
  setLoading(false);
}, [selectedLab, fromDate, toDate]);
```

### Step 2: Update Backend Service (database.ts or outsourcedReports service)

The `getPendingTests()` function needs to be updated to accept and apply `locationIds` filter.

**Location**: Check `src/utils/supabase.ts` or the outsourced reports service file

**Required Change**:
```typescript
// In the outsourcedReports service
getPendingTests: async (filters: {
  outsourcedLabId?: string;
  fromDate?: string;
  toDate?: string;
  locationIds?: string[]; // ✅ Add this
}) => {
  let query = supabase
    .from('results')
    .select(`
      *,
      order:orders!inner(location_id, ...),
      // ... other fields
    `)
    .not('outsourced_lab_id', 'is', null);
  
  // Apply filters
  if (filters.outsourcedLabId) {
    query = query.eq('outsourced_lab_id', filters.outsourcedLabId);
  }
  
  if (filters.fromDate) {
    query = query.gte('created_at', filters.fromDate);
  }
  
  if (filters.toDate) {
    query = query.lte('created_at', filters.toDate);
  }
  
  // ✅ Apply location filter
  if (filters.locationIds && filters.locationIds.length > 0) {
    query = query.in('order.location_id', filters.locationIds);
  }
  
  const { data, error } = await query;
  return { data, error };
}
```

---

## Testing Checklist

### Test OutsourcedTestsQueue with Location Filtering

1. ✅ **Create restricted user** assigned to ONLY "Downtown Branch"
2. ✅ **Create outsourced tests** at multiple locations:
   - 2 tests at Downtown Branch
   - 2 tests at Airport Lab
3. ✅ **Test as restricted user**:
   - Navigate to `/outsourced-queue`
   - **Expected**: See ONLY the 2 tests from Downtown Branch
   - **Verify**: No tests from Airport Lab visible
4. ✅ **Test as admin**:
   - Navigate to `/outsourced-queue`
   - **Expected**: See ALL 4 tests (Downtown + Airport)

---

## Business Considerations

### Patients - Why NOT Filter?

**Medical/Legal Reasons**:
1. **Continuity of Care**: Doctors need full patient history regardless of where patient was registered
2. **Patient Safety**: Critical information (allergies, medical history) must be accessible everywhere
3. **Regulatory Compliance**: Medical records must be complete and accessible for legal/audit purposes
4. **Multi-Location Visits**: Patients often visit different locations of the same lab

**Example Scenario**:
- Patient registers at "Downtown Branch" on Monday
- Patient visits "Airport Lab" on Tuesday for emergency test
- Airport Lab staff MUST see patient's allergy information from Downtown registration

**Conclusion**: Patients should remain lab-wide, not location-specific.

---

## Next Steps

1. ⏳ **Implement** location filtering for Outsourced Tests Queue
2. ⏳ **Review** Outsourced Reports Console page
3. ⏳ **Test** implementation with restricted users
4. ✅ **Document** decision to keep Patients lab-wide
5. ✅ **Update** overall security audit summary

---

## Files Requiring Updates

1. **Frontend**: `src/pages/OutsourcedTestsQueue.tsx` (Line 73)
2. **Backend**: `src/utils/supabase.ts` or outsourced reports service file
3. **Documentation**: Update security audit with these findings

---

**Estimated Implementation Time**: 30-45 minutes  
**Priority**: Medium (not as critical as patient data, but should be fixed)  
**Impact**: Prevents users from seeing outsourcing patterns of other locations

---

**Created**: 2026-01-21  
**Status**: Pending Implementation
