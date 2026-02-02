# CRITICAL SECURITY AUDIT - Location Filtering Issues

**Date**: 2026-01-21  
**Priority**: 🚨 **HIGH - IMMEDIATE ACTION REQUIRED**  
**Status**: ⚠️ **SECURITY VULNERABILITIES IDENTIFIED**

## Executive Summary

**CRITICAL FINDING**: Users assigned to specific locations can view data from ALL locations in multiple pages, violating location-based access control.

### Affected Pages
1. ❌ **Analytics Dashboard** (`/analytics`)
2. ❌ **Financial Reports** (`/financial-reports`) 
3. ❌ **Reports Page** (`/reports`)
4. ❌ **Result Verification Console** (`/verification`)
5. ⚠️ **User Management** (`/users`) - *Displays all users, not filtered*
6. ⚠️ **Settings** (`/settings`) - *Needs review*

### Pages WITH Proper Filtering ✅
- Dashboard  
- Orders
- Billing
- Results (Result Entry)

## Detailed Findings

### 1. Reports Page (`src/pages/Reports.tsx`)

**Line 302-308**: Queries from `view_approved_results`
```tsx
const { data, error } = await supabase
  .from('view_approved_results')
  .select('*')
  .eq('lab_id', lab_id)
  .gte('verified_at', dateRange.start.toISOString())
  .lte('verified_at', dateRange.end.toISOString())
  .order('verified_at', { ascending: false });
```

**Issue**: NO location filtering  
**Impact**: Users see approved results from ALL locations  
**Severity**: 🔴 **CRITICAL** - Patient data exposure

---

### 2. Result Verification Console (`src/pages/ResultVerificationConsole.tsx`)

**Line 471-477**: Queries from `v_result_panel_status`
```tsx
const { data, error } = await supabase
  .from("v_result_panel_status")
  .select("*")
  .eq("lab_id", labId)
  .gte("order_date", from)
  .lte("order_date", to)
  .order("order_date", { ascending: false });
```

**Issue**: NO location filtering  
**Impact**: Verifiers can approve results from ANY location  
**Severity**: 🔴 **CRITICAL** - Workflow violation, data integrity

---

### 3. Analytics Dashboard (`src/pages/Analytics.tsx`) 

**Line 91-101**: User can select any location in filter
```tsx
const analyticsFilters = {
  lab_id: labId,
  date_range: filters.dateRange,
  location_id: filters.locationId || undefined, // ⚠️ User controlled
  department: filters.department || undefined,
  account_id: filters.accountId || undefined,
};
```

**Issue**: User can manually select ANY location ID from dropdown  
**Impact**: Can view analytics for locations they're not assigned to  
**Severity**: 🔴 **CRITICAL** - Business intelligence data exposure

---

### 4. Financial Reports (`src/pages/FinancialReports.tsx`)

**Line 106-120**: Outsourced costs query
```tsx
const { data, error: fetchError } = await supabase
  .from('invoice_items')
  .select(`...`)
  .eq('invoice.lab_id', labId)
  .not('outsourced_lab_id', 'is', null)
  .gte('invoice.invoice_date', dateFrom)
  .lte('invoice.invoice_date', dateTo);
```

**Line 219-240**: Location receivables query
```tsx
const { data, error: fetchError } = await supabase
  .from('invoice_items')
  .select(`...`)
  .eq('invoice.lab_id', labId)
  .gte('invoice.invoice_date', dateFrom)
  .lte('invoice.invoice_date', dateTo);
```

**Issue**: NO location filtering on either tab  
**Impact**: Can see financial data from ALL locations  
**Severity**: 🔴 **CRITICAL** - Financial data exposure

---

### 5. User Management (`src/pages/UserManagement.tsx`)

**Line 97-101**: Loads all users for the lab
```tsx
const { data, error } = await supabase
  .from('v_users_with_permissions')
  .select('*')
  .eq('lab_id', currentLabId)
  .order('name');
```

**Issue**: Shows users from ALL locations  
**Impact**: Location managers can see all staff (may not be desired)  
**Severity**: 🟡 **MEDIUM** - Depends on business requirements

**Note**: This might be INTENTIONAL for HR/admin purposes, but should be reviewed.

---

## Security Impact Analysis

### Scenario: Location-Restricted User
**User Profile**: Dr. Sarah, assigned ONLY to "Downtown Branch"  
**Expected Behavior**: See data ONLY for Downtown Branch  
**Current Behavior**: Can see data from ALL branches

### Data Exposure Matrix

| Page | Data Type | Exposure Level | Risk |
|------|-----------|----------------|------|
| Reports | Patient results, verified tests | ALL locations | 🔴 CRITICAL |
| Result Verification | Pending verifications, test results | ALL locations | 🔴 CRITICAL |
| Analytics | Revenue, orders, KPIs | ALL locations | 🔴 CRITICAL |
| Financial Reports | Costs, profits, receivables | ALL locations | 🔴 CRITICAL |
| User Management | Staff information | ALL locations | 🟡 MEDIUM |

## Recommended Fixes

### Fix Template
All fixes follow this pattern:

```tsx
// 1. Get location filtering info
const { shouldFilter, locationIds } = await database.shouldFilterByLocation();

// 2. Apply to query
if (shouldFilter && locationIds.length > 0) {
  query = query.in("location_id", locationIds);
}
```

### Priority 1: Reports Page

**File**: `src/pages/Reports.tsx`  
**Line**: 302

```tsx
const loadApprovedResults = useCallback(async () => {
  try {
    setLoading(true);

    const lab_id = await database.getCurrentUserLabId();
    if (!lab_id) {
      console.error('No lab context available');
      setLoading(false);
      return;
    }

    // ✅ ADD LOCATION FILTERING
    const { shouldFilter, locationIds } = await database.shouldFilterByLocation();

    // Get date range...
    let dateRange = { /*...*/ };
    
    // Build base query
    let query = supabase
      .from('view_approved_results')
      .select('*')
      .eq('lab_id', lab_id)
      .gte('verified_at', dateRange.start.toISOString())
      .lte('verified_at', dateRange.end.toISOString())
      .order('verified_at', { ascending: false });

    // ✅ APPLY LOCATION FILTER
    if (shouldFilter && locationIds.length > 0) {
      // Note: view_approved_results must have location_id column
      query = query.in('location_id', locationIds);
    }

    const { data, error } = await query;
    // ... rest of function
```

---

### Priority 2: Result Verification Console

**File**: `src/pages/ResultVerificationConsole.tsx`  
**Line**: 471

```tsx
const loadPanels = async () => {
  setLoading(true);
  setErr(null);

  const labId = currentLabId || await database.getCurrentUserLabId();
  if (!labId) {
    setErr("No lab context found. Please log in again.");
    setPanels([]);
    setLoading(false);
    return;
  }

  // ✅ ADD LOCATION FILTERING
  const { shouldFilter, locationIds } = await database.shouldFilterByLocation();

  let query = supabase
    .from("v_result_panel_status")
    .select("*")
    .eq("lab_id", labId)
    .gte("order_date", from)
    .lte("order_date", to)
    .order("order_date", { ascending: false });

  // ✅ APPLY LOCATION FILTER
  if (shouldFilter && locationIds.length > 0) {
    query = query.in("location_id", locationIds);
  }

  const { data, error } = await query;
  // ... rest of function
```

---

### Priority 3: Analytics Dashboard

**File**: `src/pages/Analytics.tsx`  
**Line**: 91

```tsx
const loadData = useCallback(async () => {
  if (!labId) return;
  
  setIsLoading(true);
  
  // ✅ ADD LOCATION FILTERING
  const { shouldFilter, locationIds } = await database.shouldFilterByLocation();
  
  const analyticsFilters = {
    lab_id: labId,
    date_range: filters.dateRange,
    // ✅ If restricted, validate and override user selection
    location_id: shouldFilter && locationIds.length > 0
      ? (filters.locationId && locationIds.includes(filters.locationId) 
          ? filters.locationId 
          : locationIds[0]) // Default to first assigned location
      : filters.locationId || undefined,
    department: filters.department || undefined,
    account_id: filters.accountId || undefined,
  };
  
  // ... rest of function
```

**ALSO REQUIRED**: Update `AnalyticsFilters` component to hide/disable non-assigned locations in dropdown.

---

### Priority 4: Financial Reports - Outsourced Costs

**File**: `src/pages/FinancialReports.tsx`  
**Line**: 97

```tsx
const loadOutsourcedCosts = async () => {
  setLoading(true);
  setError(null);

  try {
    const labId = await database.getCurrentUserLabId();
    if (!labId) throw new Error('No lab context');
    
    // ✅ ADD LOCATION FILTERING
    const {shouldFilter, locationIds } = await database.shouldFilterByLocation();

    // Strategy: Get allowed invoice IDs first
    let allowedInvoiceIds: string[] | null = null;
    
    if (shouldFilter && locationIds.length > 0) {
      const { data: invoices } = await supabase
        .from('invoices')
        .select('id, order:orders!inner(location_id)')
        .eq('lab_id', labId)
        .in('order.location_id', locationIds)
        .gte('invoice_date', dateFrom)
        .lte('invoice_date', dateTo);
      
      allowedInvoiceIds = (invoices || [])map(inv => inv.id);
      
      if (allowedInvoiceIds.length === 0) {
        // No invoices for assigned locations
        setOutsourcedData([]);
        setOutsourcedTotals({ revenue: 0, cost: 0, margin: 0 });
        setLoading(false);
        return;
      }
    }

    // Build query
    let query = supabase
      .from('invoice_items')
      .select(`
        id, test_name, price, outsourced_cost, outsourced_lab_id,
        invoice:invoices!inner(invoice_date, lab_id),
        outsourced_lab:outsourced_labs(id, name)
      `)
      .eq('invoice.lab_id', labId)
      .not('outsourced_lab_id', 'is', null)
      .gte('invoice.invoice_date', dateFrom)
      .lte('invoice.invoice_date', dateTo);
    
    // ✅ APPLY LOCATION FILTER via invoice IDs
    if (allowedInvoiceIds) {
      query = query.in('invoice_id', allowedInvoiceIds);
    }

    const { data, error: fetchError } = await query;
    // ... rest of function
```

---

### Priority 5: Financial Reports - Location Receivables

**File**: `src/pages/FinancialReports.tsx`  
**Line**: 209

```tsx
const loadLocationReceivables = async () => {
  setLoading(true);
  setError(null);

  try {
    const labId = await database.getCurrentUserLabId();
    if (!labId) throw new Error('No lab context');
    
    // ✅ ADD LOCATION FILTERING
    const { shouldFilter, locationIds } = await database.shouldFilterByLocation();

    const { data, error: fetchError } = await supabase
      .from('invoice_items')
      .select(`
        id, price, test_name, location_receivable,
        invoice:invoices!inner(
          id, invoice_number, invoice_date, patient_name, lab_id,
          order:orders(
            location_id,
            location:locations!orders_location_id_fkey(id, name, receivable_type, collection_percentage)
          )
        )
      `)
      .eq('invoice.lab_id', labId)
      .gte('invoice.invoice_date', dateFrom)
      .lte('invoice.invoice_date', dateTo);

    if (fetchError) throw fetchError;

    // ✅ FILTER BY LOCATION in memory (complex join)
    let filteredData = data || [];
    if (shouldFilter && locationIds.length > 0) {
      filteredData = filteredData.filter((item: any) => {
        const locationId = item.invoice?.order?.location?.id;
        return locationId && locationIds.includes(locationId);
      });
    }

    // Group by location using filteredData
    const locationMap = new Map<string, LocationReceivableItem>();
    filteredData.forEach((item: any) => {
      // ... rest of function uses filteredData
```

---

## Database View Requirements

Some views may need to include `location_id` column:

### Check Required
1. `view_approved_results` - Must have `location_id` 
2. `v_result_panel_status` - Must have `location_id`

**Action**: Verify these views include location_id, or add it:

```sql
-- Example fix for view_approved_results
CREATE OR REPLACE VIEW view_approved_results AS
SELECT 
  rv.*,
  r.order_id,
  o.location_id,  -- ✅ ADD THIS
  -- ... other columns
FROM result_values rv
JOIN results r ON rv.result_id = r.id
JOIN orders o ON r.order_id = o.id
-- ... rest of view
```

---

## Testing Checklist

### Test User Setup
Create test account:
- **Email**: `test.restricted@lab.com`
- **Role**: `lab_manager` or `technician`  
- **Assigned Locations**: ONLY "Downtown Branch"

### Test Cases

#### ✅ Test 1: Reports Page
1. Login as restricted user
2. Navigate to `/reports`
3. **Expected**: See only Downtown Branch orders
4. **Verify**: No orders from other locations visible

#### ✅ Test 2: Result Verification
1. Login as restricted user
2. Navigate to `/verification`
3. **Expected**: See only Downtown Branch pending verifications
4. **Verify**: Cannot verify results from other locations

#### ✅ Test 3: Analytics
1. Login as restricted user
2. Navigate to `/analytics`
3. **Expected**: Location dropdown shows ONLY Downtown Branch
4. **Expected**: All KPIs show ONLY Downtown data
5. **Verify**: Cannot manually change location ID

#### ✅ Test 4: Financial Reports
1. Login as restricted user
2. Navigate to `/financial-reports`
3. **Expected**: See ONLY Downtown costs and receivables
4. **Verify**: Other locations not visible

#### ✅ Test 5: Admin User
1. Login as admin/super_admin
2. Navigate to all pages
3. **Expected**: See ALL locations (no restriction)
4. **Verify**: `shouldFilter = false` or `canViewAll = true`

---

## Implementation Timeline

| Priority | Page | Estimated Time | Status |
|----------|------|----------------|--------|
| 🔴 P1 | Reports | 30 min | ⏳ Pending |
| 🔴 P1 | Result Verification | 30 min | ⏳ Pending |
| 🔴 P1 | Analytics | 1 hour | ⏳ Pending |
| 🔴 P1 | Financial Reports | 1 hour | ⏳ Pending |
| 🟡 P2 | Database Views | 30 min | ⏳ Pending |
| 🟡 P2 | Testing | 1 hour | ⏳ Pending |

**Total Estimated Time**: 4-5 hours  
**Recommended Deployment**: ASAP (Security fix)

---

## Compliance & Risk

### HIPAA/PHI Concerns
- ✅ Patient data (Reports, Verification) exposed across locations
- ✅ Violates "minimum necessary" principle
- ✅ Audit trails may not reflect proper access controls

### Business Risk
- 🔴 **Data Breach**: Competitors or unauthorized staff viewing sensitive location data
- 🔴 **Financial Loss**: Revenue/cost data exposed to location managers
- 🔴 **Compliance**: Regulatory violations if audited

### Audit Trail
**Action Required**: After implementing fixes, verify audit logs to ensure:
- Location restrictions are logged
- Access attempts outside assigned locations are recorded
- Compliance reports reflect proper data access patterns

---

## Contact & Approval

**Prepared by**: AI Security Audit  
**Reviewed by**: [Pending]  
**Approved by**: [Pending]  
**Deployment Authorization**: [Pending]

---

**⚠️ RECOMMENDATION**: Treat this as a **CRITICAL SECURITY FIX** and implement immediately. Until fixed, location-restricted users can access data beyond their authorized scope.
