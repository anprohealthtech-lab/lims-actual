# Location Filtering Audit Report - Analytics & Financial Reports

**Date**: 2026-01-21  
**Status**: ⚠️ **SECURITY ISSUE IDENTIFIED**

## Executive Summary

**CRITICAL FINDING**: Users assigned to specific locations can currently view data from ALL locations when accessing:
- Analytics Dashboard (`/analytics`)
- Financial Reports (`/financial-reports`)

This is a **data access control issue** that violates location-based permissions.

## Detailed Findings

### ✅ Pages WITH Proper Location Filtering

1. **Dashboard** (`src/pages/Dashboard.tsx` - Line 327-330)
   ```tsx
   const { shouldFilter, locationIds } = await database.shouldFilterByLocation();
   if (shouldFilter && locationIds.length > 0) {
     q = q.in("location_id", locationIds);
   }
   ```

2. **Orders** (`src/pages/Orders.tsx`)
   ```tsx
   const { shouldFilter, locationIds } = await database.shouldFilterByLocation();
   ```

3. **Billing** (`src/pages/Billing.tsx`)
   ```tsx
   const userLocInfo = await database.shouldFilterByLocation();
   ```

4. **Results** (`src/pages/Results.tsx`)
   ```tsx
   const { shouldFilter, locationIds } = await database.shouldFilterByLocation();
   ```

### ❌ Pages WITHOUT Location Filtering

1. **Analytics Dashboard** (`src/pages/Analytics.tsx`)
   - **Line 91-154**: `loadData()` function
   - **Issue**: Passes `location_id` from filters but does NOT enforce user's assigned locations
   - **Impact**: Users can see analytics for ALL locations by selecting them in the filter

2. **Financial Reports** (`src/pages/Financial  Reports.tsx`)
   - **Line 97-207**: `loadOutsourcedCosts()` function
   - **Line 209-327**: `loadLocationReceivables()` function
   - **Issue**: Queries all data for the lab without checking user's location assignments
   - **Impact**: Users can see financial data from ALL locations

## Security Implications

### Scenario: Location-Restricted User
- **User**: Dr. Ahmed assigned ONLY to "Downtown Branch"
- **Expected**: Should see data ONLY for Downtown Branch
- **Current Behavior**: Can see data for ALL branches (Downtown, Airport, Mall, etc.)

### Data Exposure
1. **Analytics Page**: Can see:
   - Revenue from all locations
   - Order counts from all locations
   - Test popularity across all locations
   - TAT performance for all locations
   - Critical alerts from all locations

2. **Financial Reports Page**: Can see:
   - Outsourced lab costs for all locations
   - Location receivables for all locations
   - Revenue distribution across all locations

## How Location Filtering Should Work

### The `database.shouldFilterByLocation()` Function
Returns an object with:
- `shouldFilter` (boolean): Whether to apply location filtering
- `locationIds` (string[]): Array of location IDs the user has access to
- `canViewAll` (boolean): Whether user can view all locations

### Usage Pattern
```tsx
const { shouldFilter, locationIds } = await database.shouldFilterByLocation();

if (shouldFilter && locationIds.length > 0) {
  // Filter queries by location_id
  query = query.in("location_id", locationIds);
}
```

## Recommended Fixes

### Fix 1: Analytics Dashboard (`Analytics.tsx`)

**Current Code** (Line 91-101):
```tsx
const loadData = useCallback(async () => {
  if (!labId) return;
  
  setIsLoading(true);
  const analyticsFilters = {
    lab_id: labId,
    date_range: filters.dateRange,
    location_id: filters.locationId || undefined,
    department: filters.department || undefined,
    account_id: filters.accountId || undefined,
  };
```

**Fixed Code**:
```tsx
const loadData = useCallback(async () => {
  if (!labId) return;
  
  setIsLoading(true);
  
  // Apply location filtering
  const { shouldFilter, locationIds } = await database.shouldFilterByLocation();
  
  const analyticsFilters = {
    lab_id: labId,
    date_range: filters.dateRange,
    // If user is restricted, override their filter selection
    location_id: shouldFilter && locationIds.length > 0
      ? (filters.locationId && locationIds.includes(filters.locationId) 
          ? filters.locationId 
          : locationIds[0]) // Default to first assigned location
      : filters.locationId || undefined,
    department: filters.department || undefined,
    account_id: filters.accountId || undefined,
  };
  
  // Additional filter: Restrict available locations in UI
  if (shouldFilter && locationIds.length > 0) {
    // Pass locationIds to AnalyticsFilters component to restrict dropdown
  }
```

**Additional Fix**: Update `AnalyticsFilters` component to only show assigned locations in dropdown

### Fix 2: Financial Reports (`FinancialReports.tsx`)

**Fix for Outsourced Costs** (Line 97-207):
```tsx
const loadOutsourcedCosts = async () => {
  setLoading(true);
  setError(null);

  try {
    const labId = await database.getCurrentUserLabId();
    if (!labId) throw new Error('No lab context');
    
    // ✅ ADD LOCATION FILTERING
    const { shouldFilter, locationIds } = await database.shouldFilterByLocation();

    // Get invoice items with outsourced lab info
    let query = supabase
      .from('invoice_items')
      .select(`
        id,
        test_name,
        price,
        outsourced_cost,
        outsourced_lab_id,
        invoice:invoices!inner(invoice_date, lab_id, order_id),
        outsourced_lab:outsourced_labs(id, name)
      `)
      .eq('invoice.lab_id', labId)
      .not('outsourced_lab_id', 'is', null)
      .gte('invoice.invoice_date', dateFrom)
      .lte('invoice.invoice_date', dateTo);
    
    // ✅ FILTER BY LOCATION
    if (shouldFilter && locationIds.length > 0) {
      // Need to join through invoice -> order -> location
      // This requires a subquery or modified query structure
      const { data: allowedInvoiceIds } = await supabase
        .from('invoices')
        .select('id, order:orders!inner(location_id)')
        .eq('lab_id', labId)
        .in('order.location_id', locationIds);
      
      const invoiceIds = (allowedInvoiceIds || []).map((inv: any) => inv.id);
      if (invoiceIds.length > 0) {
        query = query.in('invoice_id', invoiceIds);
      } else {
        // No invoices for assigned locations
        setOutsourcedData([]);
        setOutsourcedTotals({ revenue: 0, cost: 0, margin: 0 });
        setLoading(false);
        return;
      }
    }

    const { data, error: fetchError } = await query;
    // ... rest of the function
```

**Fix for Location Receivables** (Line 209-327):
```tsx
const loadLocationReceivables = async () => {
  setLoading(true);
  setError(null);

  try {
    const labId = await database.getCurrentUserLabId();
    if (!labId) throw new Error('No lab context');
    
    // ✅ ADD LOCATION FILTERING
    const { shouldFilter, locationIds } = await database.shouldFilterByLocation();

    // Get invoice items with location info
    const { data, error: fetchError } = await supabase
      .from('invoice_items')
      .select(`
        id,
        price,
        test_name,
        location_receivable,
        invoice:invoices!inner(
          id,
          invoice_number,
          invoice_date, 
          patient_name,
          lab_id,
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

    // ✅ FILTER BY LOCATION
    let filteredData = data || [];
    if (shouldFilter && locationIds.length > 0) {
      filteredData = filteredData.filter((item: any) => {
        const locationId = item.invoice?.order?.location?.id;
        return locationId && locationIds.includes(locationId);
      });
    }

    // Group by location
    const locationMap = new Map<string, LocationReceivableItem>();

    filteredData.forEach((item: any) => {
      // ... rest of the function uses filteredData instead of data
```

## Implementation Priority

### High Priority (Implement Immediately)
1. **Financial Reports** - Contains sensitive financial data
2. **Analytics Dashboard** - Contains business intelligence data

### Testing Required
1. Create test user assigned to ONLY one location
2. Verify they cannot see other location data in:
   - Analytics filters (dropdown should show only assigned locations)
   - Analytics KPIs (should show only assigned location data)
   - Financial Reports - Outsourced Costs
   - Financial Reports - Location Receivables

### Regression Testing
Ensure admins and users with `can_view_all_locations` still see all data as expected.

## Recommendation

**IMMEDIATE ACTION REQUIRED**: Implement location filtering for both Analytics and Financial Reports pages to prevent unauthorized data access.

**Timeline**: 
- Implementation: 2-4 hours
- Testing: 1 hour  
- Deployment: Immediate (this is a security fix)

---

**Prepared by**: AI Analysis  
**Reviewed by**: [Pending]  
**Approved by**: [Pending]
