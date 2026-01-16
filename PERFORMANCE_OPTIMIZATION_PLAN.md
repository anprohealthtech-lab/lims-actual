# LIMS Performance Optimization Plan
**Date**: January 16, 2026  
**Focus Areas**: Order Creation & Result Submission Flows

## Executive Summary

Current performance analysis reveals **15-22 sequential database calls** for order creation and **10-20+ calls per test group** for result submission. This document outlines optimization strategies to reduce response times by **40-70%** through parallelization, batching, and architectural improvements.

---

## Current Performance Issues

### 1. Order Creation (Dashboard → OrderForm)
- **Current**: 15-22 sequential database calls
- **Time**: ~800ms - 1.5s (depending on network + test count)
- **User Impact**: Long wait after clicking "Create Order"

### 2. Result Submission (OrderDetailsModal → Submit Results)
- **Current**: 10-20+ calls per test group (multiplicative with analyte count)
- **Time**: ~1.2s - 3s for typical order (3-5 test groups)
- **User Impact**: Blocking UI, users clicking multiple times

### 3. Modal Initial Load
- **Current**: 7 sequential data fetches on modal open
- **Time**: ~600-900ms before user can interact
- **User Impact**: Blank modal, perceived slowness

---

## Detailed Analysis

### Order Creation Flow Breakdown

| Step | Operation | File/Function | DB Calls | Time (est) |
|------|-----------|---------------|----------|------------|
| 1 | Get lab_id | `database.getCurrentUserLabId()` | 1 | 50ms |
| 2 | Get auth user | `supabase.auth.getUser()` | 1 | 50ms |
| 3 | Count daily orders | `database.orders.create()` | 1 | 50ms |
| 4 | Insert order | `database.orders.create()` | 1 | 100ms |
| 5 | Update QR code | `database.orders.create()` | 1 | 50ms |
| 6 | Fetch test_groups (if legacy) | `OrderForm.tsx` | 0-1 | 0-50ms |
| 7 | Fetch packages | `OrderForm.tsx` | 0-1 | 0-80ms |
| 8 | Insert order_tests (batch) | `database.orders.create()` | 1 | 100ms |
| 9 | Update package test prices | `database.orders.create()` | 1 | 50ms |
| 10 | Fetch order_tests for recalc | `database.orders.create()` | 1 | 50ms |
| 11 | Update order total | `database.orders.create()` | 1 | 50ms |
| 12 | Insert outsourced results | `database.orders.create()` | 0-1 | 0-50ms |
| 13 | Trigger notifications | `database.orders.create()` | 3-5 | 150-250ms |
| 14 | Update TRF attachments | `OrderForm.tsx` | 0-1 | 0-50ms |
| 15 | Fetch order_tests for samples | `OrderForm.tsx` | 1 | 50ms |
| 16 | Get lab code | `OrderForm.tsx` | 1 | 50ms |
| 17 | Insert samples (per type) | `OrderForm.tsx` | 1-3 | 50-150ms |
| 18 | Link samples to order_tests | `OrderForm.tsx` | N | N×50ms |
| 19 | Insert invoice | `OrderForm.tsx` | 0-1 | 0-50ms |
| 20 | Update billing status | `OrderForm.tsx` | 0-1 | 0-50ms |
| 21 | Insert invoice_items | `OrderForm.tsx` | 0-1 | 0-50ms |
| 22 | Insert payment | `OrderForm.tsx` | 0-1 | 0-50ms |

**Total: ~800-1500ms (15-22 round trips)**

### Result Submission Flow Breakdown

| Step | Operation | File/Function | DB Calls | Time (est) |
|------|-----------|---------------|----------|------------|
| **Initial Modal Load** | | | | |
| 1 | Fetch attachments | `fetchAttachments()` | 1 | 50ms |
| 2 | Fetch order analytes | `fetchOrderAnalytes()` | 2 | 100ms |
| 3 | Fetch progress view | `fetchProgressView()` | 1 | 50ms |
| 4 | Fetch readonly results | `fetchReadonlyResults()` | 1 | 50ms |
| 5 | Fetch upload batches | `fetchUploadBatches()` | 1 | 50ms |
| 6 | Fetch existing result | `fetchExistingResult()` | 1 | 50ms |
| **Per Test Group (on submit)** | | | | |
| 1 | Get auth user | `handleSubmitResults()` | 1 | 50ms |
| 2 | Get lab_id | `handleSubmitResults()` | 1 | 50ms |
| 3 | Find existing result row | `findExistingResultsRowId()` | 1 | 50ms |
| 4 | Upsert results record | `handleSubmitResults()` | 1 | 100ms |
| 5 | Delete existing result_values | `handleSubmitResults()` | 1 | 50ms |
| 6 | Insert new result_values | `handleSubmitResults()` | 1 | 100ms |
| 7 | Run AI flag analysis | `runAIAnalyteInterpretation()` | 5-10 | 200-500ms |
| 8 | Fetch readonly results | `fetchReadonlyResults()` | 1 | 50ms |
| 9 | Fetch progress view | `fetchProgressView()` | 1 | 50ms |

**Initial Load: ~350ms (6 sequential calls)**  
**Per Test Group Submit: ~700-1150ms × N test groups**  
**Total for 3 test groups: ~2.1-3.5 seconds**

---

## Optimization Strategies

### Phase 1: Quick Wins (Low Effort, High Impact)

#### 1.1 Parallelize Auth & Context Fetches
**Impact**: -100-150ms per operation  
**Effort**: Low (30 minutes)  
**Files**: `src/utils/supabase.ts`, `src/components/Orders/OrderDetailsModal.tsx`

```typescript
// BEFORE (Sequential - 100ms)
const lab_id = await database.getCurrentUserLabId();
const { data: auth } = await supabase.auth.getUser();

// AFTER (Parallel - 50ms)
const [lab_id, { data: auth }] = await Promise.all([
  database.getCurrentUserLabId(),
  supabase.auth.getUser()
]);
```

**Locations to Update**:
- `src/utils/supabase.ts` - `database.orders.create()` (line ~2300)
- `src/components/Orders/OrderDetailsModal.tsx` - `handleSubmitResults()` (line ~1050)

---

#### 1.2 Parallelize Modal Initial Data Loads
**Impact**: -250-400ms on modal open  
**Effort**: Low (15 minutes)  
**Files**: `src/components/Orders/OrderDetailsModal.tsx`

```typescript
// BEFORE (Sequential - 350ms)
useEffect(() => {
  fetchOrderAnalytes();
  fetchProgressView();
  fetchReadonlyResults();
  fetchUploadBatches();
}, [orderId]);

// AFTER (Parallel - 100ms)
useEffect(() => {
  Promise.all([
    fetchOrderAnalytes(),
    fetchProgressView(),
    fetchReadonlyResults(),
    fetchUploadBatches()
  ]).catch(error => {
    console.error('Error loading modal data:', error);
  });
}, [orderId]);
```

**Location**: `src/components/Orders/OrderDetailsModal.tsx` (around line 260-280)

---

#### 1.3 Pre-generate QR Code (Single Insert)
**Impact**: -50-100ms per order  
**Effort**: Medium (1 hour)  
**Files**: `src/utils/supabase.ts`

```typescript
// BEFORE (Insert then Update - 150ms)
const { data: order } = await supabase
  .from('orders')
  .insert([orderData])
  .select()
  .single();

const qrCodeData = generateOrderQRCodeData(order);
await supabase
  .from('orders')
  .update({ qr_code_data: qrCodeData })
  .eq('id', order.id);

// AFTER (Single Insert - 100ms)
const orderId = crypto.randomUUID();
const qrCodeData = generateOrderQRCodeData({
  id: orderId,
  sample_id: sampleId,
  // ... other pre-calculated fields
});

const { data: order } = await supabase
  .from('orders')
  .insert([{ 
    id: orderId,
    ...orderData, 
    qr_code_data: qrCodeData 
  }])
  .select()
  .single();
```

**Location**: `src/utils/supabase.ts` - `database.orders.create()` (line ~2350-2380)

---

#### 1.4 Batch Result Values Insert
**Impact**: -400-800ms per result submission  
**Effort**: Medium (2 hours)  
**Files**: `src/components/Orders/OrderDetailsModal.tsx`

```typescript
// BEFORE (Per Test Group - 400ms × N)
for (const testGroup of testGroups) {
  const resultValues = testGroup.analytes.map(/* ... */);
  
  await supabase
    .from("result_values")
    .delete()
    .eq("result_id", resultId);
    
  await supabase
    .from("result_values")
    .insert(resultValues);
}

// AFTER (Single Batch - 200ms total)
const allResultValues = testGroups.flatMap(testGroup => 
  testGroup.analytes.map(analyte => ({
    result_id: testGroup.resultId,
    order_id: orderId,
    analyte_id: analyte.id,
    analyte_name: analyte.name,
    value: analyte.value,
    unit: analyte.unit,
    reference_range: analyte.reference_range,
    flag: analyte.flag,
    lab_id: lab_id,
  }))
);

const resultIds = [...new Set(testGroups.map(tg => tg.resultId))];

// Single delete for all
await supabase
  .from("result_values")
  .delete()
  .in("result_id", resultIds);

// Single insert for all
await supabase
  .from("result_values")
  .insert(allResultValues);
```

**Location**: `src/components/Orders/OrderDetailsModal.tsx` - `handleSubmitResults()` (line ~1080-1150)

---

#### 1.5 Make AI Flag Analysis Non-Blocking
**Impact**: -200-500ms perceived time  
**Effort**: Low (30 minutes)  
**Files**: `src/components/Orders/OrderDetailsModal.tsx`

```typescript
// BEFORE (Blocking - user waits 500ms)
await runAIAnalyteInterpretation(resultId, analytes);
setSubmitting(false);
alert("Results saved successfully!");

// AFTER (Non-blocking - immediate feedback)
setSubmitting(false);
alert("Results saved successfully!");

// Run AI analysis in background
runAIAnalyteInterpretation(resultId, analytes).catch(error => {
  console.error('AI analysis failed (non-critical):', error);
});
```

**Location**: `src/components/Orders/OrderDetailsModal.tsx` - `handleSubmitResults()` (line ~1160-1180)

---

### Phase 2: Architectural Improvements (Medium Effort, High Impact)

#### 2.1 Batch Sample Linking (Single Update)
**Impact**: -50ms × N test groups  
**Effort**: Medium (1 hour)  
**Files**: `src/components/Orders/OrderForm.tsx`

```typescript
// BEFORE (N individual updates - 50ms each)
for (const orderTest of orderTests) {
  await supabase
    .from('order_tests')
    .update({ sample_id: sampleId })
    .eq('id', orderTest.id);
}

// AFTER (Single batched update - 50ms total)
const orderTestIds = orderTests.map(ot => ot.id);
await supabase
  .from('order_tests')
  .update({ sample_id: sampleId })
  .in('id', orderTestIds);
```

**Location**: `src/components/Orders/OrderForm.tsx` - `handleSubmit()` (line ~450-480)

---

#### 2.2 Pre-calculate Order Total (Skip Refetch)
**Impact**: -100-150ms per order  
**Effort**: Medium (1 hour)  
**Files**: `src/utils/supabase.ts`

```typescript
// BEFORE (Insert, Fetch, Calculate, Update - 250ms)
const { data: orderTests } = await supabase
  .from('order_tests')
  .insert(orderTestsData)
  .select();

// Re-fetch to calculate total
const { data: updatedTests } = await supabase
  .from('order_tests')
  .select('price')
  .eq('order_id', orderId);

const total = updatedTests.reduce((sum, t) => sum + t.price, 0);

await supabase
  .from('orders')
  .update({ total_amount: total })
  .eq('id', orderId);

// AFTER (Pre-calculate, Insert with Total - 150ms)
const total = orderTestsData.reduce((sum, t) => sum + t.price, 0);

const { data: order } = await supabase
  .from('orders')
  .insert([{ 
    ...orderData, 
    total_amount: total 
  }])
  .select()
  .single();

const { data: orderTests } = await supabase
  .from('order_tests')
  .insert(orderTestsData.map(t => ({
    ...t,
    order_id: order.id
  })))
  .select();
```

**Location**: `src/utils/supabase.ts` - `database.orders.create()` (line ~2400-2450)

---

#### 2.3 Use Upsert for Result Values
**Impact**: -50ms × N test groups  
**Effort**: Low (30 minutes)  
**Files**: `src/components/Orders/OrderDetailsModal.tsx`

```typescript
// BEFORE (Delete then Insert - 150ms)
await supabase
  .from("result_values")
  .delete()
  .eq("result_id", resultId);
  
await supabase
  .from("result_values")
  .insert(resultValues);

// AFTER (Upsert with conflict resolution - 100ms)
await supabase
  .from("result_values")
  .upsert(resultValues, {
    onConflict: 'result_id,analyte_id',
    ignoreDuplicates: false
  });
```

**Note**: Requires composite unique constraint on `result_values(result_id, analyte_id)`

**Location**: `src/components/Orders/OrderDetailsModal.tsx` - `handleSubmitResults()` (line ~1100-1120)

---

### Phase 3: Server-Side RPC Functions (High Effort, Highest Impact)

#### 3.1 Create Order RPC Function
**Impact**: -600-1000ms per order (15-22 calls → 1 call)  
**Effort**: High (4-6 hours)  
**Files**: New Supabase migration + `src/utils/supabase.ts`

**Migration**: `supabase/migrations/YYYYMMDD_create_order_rpc.sql`

```sql
CREATE OR REPLACE FUNCTION create_order_with_tests_and_invoice(
  p_order_data jsonb,
  p_order_tests jsonb[],
  p_invoice_data jsonb DEFAULT NULL,
  p_payment_data jsonb DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_order_id uuid;
  v_sample_id text;
  v_qr_code_data jsonb;
  v_total_amount numeric;
  v_result jsonb;
BEGIN
  -- Generate IDs and QR code
  v_order_id := gen_random_uuid();
  v_sample_id := /* generate sample ID logic */;
  v_qr_code_data := /* generate QR data */;
  
  -- Calculate total
  SELECT SUM((item->>'price')::numeric) INTO v_total_amount
  FROM unnest(p_order_tests) AS item;
  
  -- Insert order
  INSERT INTO orders (
    id, sample_id, qr_code_data, total_amount, /* ... other fields */
  ) VALUES (
    v_order_id, v_sample_id, v_qr_code_data, v_total_amount, /* ... */
  );
  
  -- Insert order_tests
  INSERT INTO order_tests (order_id, /* ... */)
  SELECT v_order_id, /* map from p_order_tests */
  FROM unnest(p_order_tests);
  
  -- Insert invoice if provided
  IF p_invoice_data IS NOT NULL THEN
    INSERT INTO invoices (/* ... */)
    VALUES (/* ... */);
  END IF;
  
  -- Insert payment if provided
  IF p_payment_data IS NOT NULL THEN
    INSERT INTO payments (/* ... */)
    VALUES (/* ... */);
  END IF;
  
  -- Return complete order data
  SELECT jsonb_build_object(
    'order', row_to_json(o.*),
    'order_tests', array_agg(ot.*)
  ) INTO v_result
  FROM orders o
  LEFT JOIN order_tests ot ON ot.order_id = o.id
  WHERE o.id = v_order_id
  GROUP BY o.id;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Client Usage**:
```typescript
const { data } = await supabase.rpc('create_order_with_tests_and_invoice', {
  p_order_data: orderData,
  p_order_tests: orderTestsData,
  p_invoice_data: invoiceData,
  p_payment_data: paymentData
});
```

**Benefits**:
- Single round trip
- Atomic transaction (rollback on any failure)
- Server-side validation
- Reduced payload size

---

#### 3.2 Submit Results Batch RPC Function
**Impact**: -1000-2000ms per submission (8-12 calls × N groups → 1 call)  
**Effort**: High (4-6 hours)  
**Files**: New Supabase migration + `src/components/Orders/OrderDetailsModal.tsx`

**Migration**: `supabase/migrations/YYYYMMDD_submit_results_batch_rpc.sql`

```sql
CREATE OR REPLACE FUNCTION submit_results_batch(
  p_order_id uuid,
  p_test_groups jsonb[]
) RETURNS jsonb AS $$
DECLARE
  v_test_group jsonb;
  v_result_id uuid;
  v_result jsonb;
BEGIN
  -- Process each test group
  FOREACH v_test_group IN ARRAY p_test_groups LOOP
    -- Upsert result record
    INSERT INTO results (
      order_id, 
      test_group_id, 
      status,
      /* ... other fields */
    ) VALUES (
      p_order_id,
      (v_test_group->>'test_group_id')::uuid,
      'Entered',
      /* ... */
    )
    ON CONFLICT (order_id, test_group_id) 
    DO UPDATE SET 
      status = 'Entered',
      entered_date = NOW()
    RETURNING id INTO v_result_id;
    
    -- Upsert result_values (batch)
    INSERT INTO result_values (
      result_id,
      order_id,
      analyte_id,
      analyte_name,
      value,
      unit,
      reference_range,
      flag
    )
    SELECT 
      v_result_id,
      p_order_id,
      (analyte->>'analyte_id')::uuid,
      analyte->>'analyte_name',
      analyte->>'value',
      analyte->>'unit',
      analyte->>'reference_range',
      analyte->>'flag'
    FROM jsonb_array_elements(v_test_group->'analytes') AS analyte
    ON CONFLICT (result_id, analyte_id)
    DO UPDATE SET
      value = EXCLUDED.value,
      unit = EXCLUDED.unit,
      reference_range = EXCLUDED.reference_range,
      flag = EXCLUDED.flag;
  END LOOP;
  
  -- Return summary
  SELECT jsonb_build_object(
    'success', true,
    'results_updated', array_length(p_test_groups, 1)
  ) INTO v_result;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Client Usage**:
```typescript
const testGroupsData = testGroups.map(tg => ({
  test_group_id: tg.id,
  analytes: tg.analytes.map(a => ({
    analyte_id: a.id,
    analyte_name: a.name,
    value: a.value,
    unit: a.unit,
    reference_range: a.reference_range,
    flag: a.flag
  }))
}));

const { data } = await supabase.rpc('submit_results_batch', {
  p_order_id: orderId,
  p_test_groups: testGroupsData
});
```

---

### Phase 4: Caching & Optimization

#### 4.1 Cache Lab ID in Memory
**Impact**: -50ms per operation after first load  
**Effort**: Low (1 hour)  
**Files**: `src/utils/supabase.ts`

```typescript
// Add to supabase.ts
let cachedLabId: string | null = null;
let labIdCacheTime: number = 0;
const LAB_ID_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getCachedLabId(): Promise<string> {
  const now = Date.now();
  
  if (cachedLabId && (now - labIdCacheTime) < LAB_ID_CACHE_TTL) {
    return cachedLabId;
  }
  
  cachedLabId = await database.getCurrentUserLabId();
  labIdCacheTime = now;
  
  return cachedLabId;
}

// Clear cache on logout
export function clearLabIdCache() {
  cachedLabId = null;
  labIdCacheTime = 0;
}
```

---

#### 4.2 Implement Request Debouncing
**Impact**: Prevents duplicate submissions  
**Effort**: Low (30 minutes)  
**Files**: `src/components/Orders/OrderDetailsModal.tsx`

```typescript
const [isSubmitting, setIsSubmitting] = useState(false);

const handleSubmitResults = async () => {
  if (isSubmitting) {
    console.log('Already submitting, ignoring duplicate request');
    return;
  }
  
  setIsSubmitting(true);
  
  try {
    // ... submission logic
  } finally {
    setIsSubmitting(false);
  }
};
```

---

## Implementation Roadmap

### Sprint 1: Quick Wins (Week 1)
**Goal**: 40% improvement, minimal risk

- [ ] **Day 1-2**: Parallelize auth & context fetches (1.1)
- [ ] **Day 2-3**: Parallelize modal data loads (1.2)
- [ ] **Day 3-4**: Batch result values insert (1.4)
- [ ] **Day 4-5**: Make AI analysis non-blocking (1.5)

**Expected Improvement**:
- Order Creation: 800ms → 600ms (-25%)
- Result Submission: 2.5s → 1.5s (-40%)
- Modal Load: 350ms → 100ms (-70%)

---

### Sprint 2: Architectural Improvements (Week 2)
**Goal**: 60% improvement, low-medium risk

- [ ] **Day 1-2**: Pre-generate QR code (1.3)
- [ ] **Day 2-3**: Batch sample linking (2.1)
- [ ] **Day 3-4**: Pre-calculate order total (2.2)
- [ ] **Day 4-5**: Use upsert for result values (2.3)

**Expected Improvement**:
- Order Creation: 600ms → 400ms (-50% from baseline)
- Result Submission: 1.5s → 1.0s (-60% from baseline)

---

### Sprint 3: RPC Functions (Week 3-4)
**Goal**: 70% improvement, medium-high risk

- [ ] **Week 3**: Create order RPC function (3.1)
  - Day 1-2: Write SQL migration
  - Day 3-4: Update client code
  - Day 5: Testing & validation
  
- [ ] **Week 4**: Submit results RPC function (3.2)
  - Day 1-2: Write SQL migration
  - Day 3-4: Update client code
  - Day 5: Testing & validation

**Expected Improvement**:
- Order Creation: 400ms → 200ms (-75% from baseline)
- Result Submission: 1.0s → 500ms (-80% from baseline)

---

### Sprint 4: Polish & Monitoring (Week 5)
**Goal**: Monitoring, caching, edge cases

- [ ] **Day 1-2**: Implement lab ID caching (4.1)
- [ ] **Day 2-3**: Add request debouncing (4.2)
- [ ] **Day 3-5**: Add performance monitoring
  - Client-side timing metrics
  - Error tracking for optimizations
  - Dashboard for performance trends

---

## Testing Strategy

### Performance Testing
```typescript
// Add to each optimized function
const startTime = performance.now();
// ... operation
const endTime = performance.now();
console.log(`[PERF] ${operationName}: ${endTime - startTime}ms`);
```

### Regression Testing
- Test with 1 test, 5 tests, 10 tests
- Test with slow network (throttled)
- Test with concurrent users
- Test rollback scenarios (RPC functions)

### A/B Testing Plan
1. Deploy optimizations to staging
2. Measure baseline performance
3. Deploy to 50% of production traffic
4. Monitor for 1 week
5. Full rollout if metrics improve

---

## Monitoring & Metrics

### Key Performance Indicators

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Order Creation Time (P50) | 1000ms | 300ms | Client-side timing |
| Order Creation Time (P95) | 1800ms | 600ms | Client-side timing |
| Result Submission Time (P50) | 2500ms | 800ms | Client-side timing |
| Result Submission Time (P95) | 4000ms | 1500ms | Client-side timing |
| Modal Load Time | 350ms | 100ms | Client-side timing |
| Database Round Trips (Order) | 18 | 5 | Count in code |
| Database Round Trips (Results) | 30 | 8 | Count in code |

### Monitoring Tools
- Browser Performance API
- Supabase Dashboard (query performance)
- Custom logging service
- User feedback surveys

---

## Risk Assessment

### Low Risk (Phase 1)
- **Parallelization**: No data model changes
- **Batching**: Uses existing APIs correctly
- **Non-blocking AI**: Failure doesn't affect result save

### Medium Risk (Phase 2)
- **Pre-calculation**: Must ensure accuracy
- **Upsert**: Requires database constraint
- **Sample linking**: Must handle edge cases

### High Risk (Phase 3)
- **RPC Functions**: Complex server-side logic
- **Transactions**: Must handle all error cases
- **Migration**: Requires careful testing

### Mitigation Strategies
1. **Feature flags** for all optimizations
2. **Gradual rollout** (10% → 50% → 100%)
3. **Rollback plan** for each phase
4. **Comprehensive testing** before production
5. **Performance monitoring** to detect regressions

---

## Expected Outcomes

### Performance Improvements

| Operation | Before | After Phase 1 | After Phase 2 | After Phase 3 |
|-----------|--------|---------------|---------------|---------------|
| Order Creation | 1000ms | 600ms (-40%) | 400ms (-60%) | 200ms (-80%) |
| Result Submission | 2500ms | 1500ms (-40%) | 1000ms (-60%) | 500ms (-80%) |
| Modal Load | 350ms | 100ms (-70%) | 100ms (-70%) | 100ms (-70%) |

### Business Impact
- **User Satisfaction**: Faster response = better UX
- **Throughput**: More orders/results processed per hour
- **Error Reduction**: Atomic transactions prevent partial saves
- **Cost Savings**: Fewer database queries = lower Supabase costs

---

## Rollback Procedures

### Phase 1 Rollback
1. Revert code changes via Git
2. No database changes to rollback
3. Re-deploy previous version

### Phase 2 Rollback
1. Revert code changes via Git
2. Drop database constraints if added (upsert)
3. Re-deploy previous version

### Phase 3 Rollback
1. Update code to use old flow (feature flag)
2. Mark RPC functions as deprecated
3. Drop RPC functions after validation period
4. Re-deploy previous version

---

## Appendix

### A. Database Indexes to Add
```sql
-- Speed up result_values queries
CREATE INDEX IF NOT EXISTS idx_result_values_result_id 
  ON result_values(result_id);
  
CREATE INDEX IF NOT EXISTS idx_result_values_order_id 
  ON result_values(order_id);

-- Speed up order_tests queries
CREATE INDEX IF NOT EXISTS idx_order_tests_order_id 
  ON order_tests(order_id);

-- Composite unique constraint for upsert
ALTER TABLE result_values 
  ADD CONSTRAINT uq_result_values_result_analyte 
  UNIQUE (result_id, analyte_id);
```

### B. Useful Queries for Monitoring
```sql
-- Find slow queries
SELECT 
  query,
  calls,
  mean_exec_time,
  max_exec_time
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC
LIMIT 20;

-- Count operations per table
SELECT 
  schemaname,
  relname,
  seq_scan,
  seq_tup_read,
  idx_scan,
  idx_tup_fetch
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY seq_tup_read DESC;
```

### C. Performance Testing Script
```javascript
// performance-test.js
async function testOrderCreation() {
  const startTime = performance.now();
  
  const orderData = {
    patient_id: 'test-patient-id',
    tests: [/* ... */],
    // ... other fields
  };
  
  await database.orders.create(orderData);
  
  const endTime = performance.now();
  console.log(`Order creation took: ${endTime - startTime}ms`);
  
  return endTime - startTime;
}

// Run 100 times and get average
async function runBenchmark() {
  const times = [];
  
  for (let i = 0; i < 100; i++) {
    const time = await testOrderCreation();
    times.push(time);
  }
  
  const avg = times.reduce((a, b) => a + b) / times.length;
  const p50 = times.sort()[Math.floor(times.length * 0.5)];
  const p95 = times.sort()[Math.floor(times.length * 0.95)];
  
  console.log(`Average: ${avg}ms, P50: ${p50}ms, P95: ${p95}ms`);
}
```

---

## Conclusion

This optimization plan targets the most impactful performance bottlenecks in the LIMS system. By following a phased approach, we can achieve **40-80% performance improvements** while managing risk effectively.

**Immediate Next Steps**:
1. Review and approve this plan
2. Set up performance monitoring baseline
3. Begin Sprint 1 implementation
4. Schedule weekly progress reviews

**Questions or Concerns**:
- Contact: Dev Team Lead
- Slack Channel: #lims-performance
- Review Meeting: Weekly Fridays 2pm
