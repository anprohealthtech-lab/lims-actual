# Doctor Sharing Portal - Implementation Plan

## Executive Summary

Create a Doctor Commission/Sharing system similar to the B2B Portal, with:
1. **Sharing Settings** - Configure per-doctor sharing percentages (blanket + test-wise)
2. **Commission Calculation** - Date-wise report with 3 configurable parameters
3. **Doctor Portal** (Phase 2) - Doctor login to view earnings and referred patients

---

## Current Status (Updated: January 2025)

### ✅ COMPLETED

| Feature | Location | Notes |
|---------|----------|-------|
| Doctor Master CRUD | `src/components/Masters/DoctorMaster.tsx` | Full add/edit/delete/search |
| Doctor API | `database.doctors` in supabase.ts | getAll, getById, create, update, search |
| Doctor selection in OrderForm | `src/components/Orders/OrderForm.tsx` | Searchable dropdown |
| Doctor on invoices | `invoices.referring_doctor_id` | FK exists |
| Doctor default discount | `doctors.default_discount_percent` | Used in CreateInvoiceModal |
| Location sharing pattern | `location_test_prices`, `receivable_type` | Reference implementation |
| **Migration File** | `supabase/migrations/20260126000000_add_doctor_sharing.sql` | Tables defined |
| **Doctor Sharing Login** | `src/pages/DoctorSharingLogin.tsx` | Admin-only login |
| **Doctor Sharing Layout** | `src/pages/DoctorSharingLayout.tsx` | Portal layout with sidebar |
| **Doctor Sharing Dashboard** | `src/pages/DoctorSharingDashboard.tsx` | Overview stats page |
| **Doctor Sharing Settings** | `src/pages/DoctorSharingSettings.tsx` | Per-doctor sharing config |
| **Commission Report** | `src/pages/DoctorCommissionReport.tsx` | Calculate commissions |
| **Routes in App.tsx** | `/doctor-sharing/*` routes | All portal routes added |

### ⚠️ PARTIAL

| Feature | Done | Missing |
|---------|------|---------|
| Discount source tracking | Type defined in CreateInvoiceModal | No DB column, no UI selector |

### 🔜 PENDING

| Feature | Purpose |
|---------|---------|
| Apply migration | Run SQL to create tables in database |
| Doctor Portal (Phase 2) | Doctor login/dashboard (separate from admin) |

---

## How to Access the Portal

1. Navigate to `/doctor-sharing` 
2. Login with admin credentials
3. Use sidebar to navigate:
   - **Dashboard**: Overview and stats
   - **Settings**: Configure per-doctor sharing
   - **Commission**: Calculate and export reports

---

## Phase 1: Database Migration

### New Tables

```sql
-- Migration: 20260126000000_add_doctor_sharing.sql

BEGIN;

-- ============================================================
-- 1. Doctor Sharing Settings (per-doctor configuration)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.doctor_sharing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  
  -- Sharing configuration
  sharing_type text NOT NULL DEFAULT 'percentage'
    CHECK (sharing_type IN ('percentage', 'test_wise')),
  default_sharing_percent numeric(5,2) DEFAULT 0
    CHECK (default_sharing_percent BETWEEN 0 AND 100),
  
  -- Calculation options (3 parameters)
  exclude_dr_discount boolean NOT NULL DEFAULT true,    -- Remove doctor-given discount from sharing
  share_discount_50_50 boolean NOT NULL DEFAULT false,  -- If not excluded, split discount 50-50
  exclude_outsource_cost boolean NOT NULL DEFAULT false, -- Exclude outsource cost from sharing base
  exclude_package_diff boolean NOT NULL DEFAULT false,   -- Exclude package savings (sum of tests - package price)
  
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE(doctor_id)
);

-- ============================================================
-- 2. Doctor Test-wise Sharing (override default % per test)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.doctor_test_sharing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  test_group_id uuid NOT NULL REFERENCES public.test_groups(id) ON DELETE CASCADE,
  
  sharing_percent numeric(5,2) NOT NULL
    CHECK (sharing_percent BETWEEN 0 AND 100),
  
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE(doctor_id, test_group_id)
);

-- ============================================================
-- 3. Doctor Package-wise Sharing (override default % per package)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.doctor_package_sharing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  
  sharing_percent numeric(5,2) NOT NULL
    CHECK (sharing_percent BETWEEN 0 AND 100),
  
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE(doctor_id, package_id)
);

-- ============================================================
-- 4. Add discount_source to invoices
-- ============================================================
ALTER TABLE public.invoices 
  ADD COLUMN IF NOT EXISTS discount_source text
    CHECK (discount_source IN ('doctor', 'lab', 'location', 'account'));

-- ============================================================
-- 5. Indexes for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_doctor_sharing_doctor_id ON public.doctor_sharing(doctor_id);
CREATE INDEX IF NOT EXISTS idx_doctor_sharing_lab_id ON public.doctor_sharing(lab_id);
CREATE INDEX IF NOT EXISTS idx_doctor_test_sharing_doctor_id ON public.doctor_test_sharing(doctor_id);
CREATE INDEX IF NOT EXISTS idx_doctor_package_sharing_doctor_id ON public.doctor_package_sharing(doctor_id);

-- ============================================================
-- 6. RLS Policies
-- ============================================================
ALTER TABLE public.doctor_sharing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_test_sharing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_package_sharing ENABLE ROW LEVEL SECURITY;

-- Lab-scoped access for doctor_sharing
CREATE POLICY "Users can view their lab's doctor sharing" ON public.doctor_sharing
  FOR SELECT USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can insert their lab's doctor sharing" ON public.doctor_sharing
  FOR INSERT WITH CHECK (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can update their lab's doctor sharing" ON public.doctor_sharing
  FOR UPDATE USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

-- Lab-scoped access for doctor_test_sharing
CREATE POLICY "Users can view their lab's doctor test sharing" ON public.doctor_test_sharing
  FOR SELECT USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can insert their lab's doctor test sharing" ON public.doctor_test_sharing
  FOR INSERT WITH CHECK (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can update their lab's doctor test sharing" ON public.doctor_test_sharing
  FOR UPDATE USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can delete their lab's doctor test sharing" ON public.doctor_test_sharing
  FOR DELETE USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

-- Lab-scoped access for doctor_package_sharing
CREATE POLICY "Users can view their lab's doctor package sharing" ON public.doctor_package_sharing
  FOR SELECT USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can insert their lab's doctor package sharing" ON public.doctor_package_sharing
  FOR INSERT WITH CHECK (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can update their lab's doctor package sharing" ON public.doctor_package_sharing
  FOR UPDATE USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can delete their lab's doctor package sharing" ON public.doctor_package_sharing
  FOR DELETE USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

COMMIT;
```

---

## Phase 2: API Layer (supabase.ts)

### Add to database object

```typescript
// Doctor Sharing API
doctorSharing: {
  // Get sharing settings for a doctor
  getByDoctor: async (doctorId: string) => {
    return supabase
      .from('doctor_sharing')
      .select('*')
      .eq('doctor_id', doctorId)
      .single();
  },
  
  // Create or update sharing settings
  upsert: async (doctorId: string, settings: {
    sharing_type: 'percentage' | 'test_wise';
    default_sharing_percent: number;
    exclude_dr_discount: boolean;
    share_discount_50_50: boolean;
    exclude_outsource_cost: boolean;
    exclude_package_diff: boolean;
  }) => {
    const labId = await database.getCurrentUserLabId();
    return supabase
      .from('doctor_sharing')
      .upsert({
        doctor_id: doctorId,
        lab_id: labId,
        ...settings,
        updated_at: new Date().toISOString()
      }, { onConflict: 'doctor_id' });
  },
  
  // Get test-wise sharing for a doctor
  getTestSharing: async (doctorId: string) => {
    return supabase
      .from('doctor_test_sharing')
      .select('*, test_groups(id, name, price)')
      .eq('doctor_id', doctorId)
      .eq('is_active', true);
  },
  
  // Set test-wise sharing
  setTestSharing: async (doctorId: string, testGroupId: string, sharingPercent: number) => {
    const labId = await database.getCurrentUserLabId();
    return supabase
      .from('doctor_test_sharing')
      .upsert({
        doctor_id: doctorId,
        test_group_id: testGroupId,
        lab_id: labId,
        sharing_percent: sharingPercent
      }, { onConflict: 'doctor_id,test_group_id' });
  },
  
  // Delete test-wise sharing
  deleteTestSharing: async (doctorId: string, testGroupId: string) => {
    return supabase
      .from('doctor_test_sharing')
      .delete()
      .eq('doctor_id', doctorId)
      .eq('test_group_id', testGroupId);
  },
  
  // Get package-wise sharing for a doctor
  getPackageSharing: async (doctorId: string) => {
    return supabase
      .from('doctor_package_sharing')
      .select('*, packages(id, name, price)')
      .eq('doctor_id', doctorId)
      .eq('is_active', true);
  },
  
  // Set package-wise sharing
  setPackageSharing: async (doctorId: string, packageId: string, sharingPercent: number) => {
    const labId = await database.getCurrentUserLabId();
    return supabase
      .from('doctor_package_sharing')
      .upsert({
        doctor_id: doctorId,
        package_id: packageId,
        lab_id: labId,
        sharing_percent: sharingPercent
      }, { onConflict: 'doctor_id,package_id' });
  }
},
```

---

## Phase 3: Doctor Sharing Settings UI

### File: `src/pages/DoctorSharingSettings.tsx`

**Features:**
1. Doctor selector dropdown
2. Default sharing % input
3. Sharing type toggle (percentage vs test-wise)
4. 3 Calculation option toggles:
   - ☑️ Exclude doctor-given discount from sharing
   - ☑️ Share discount 50-50 (if not excluded)
   - ☑️ Exclude outsource cost from sharing base
   - ☑️ Exclude package savings from sharing
5. Test-wise sharing grid (like PricingGrid)
6. Package-wise sharing grid

**UI Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│ Doctor Sharing Settings                                      │
├─────────────────────────────────────────────────────────────┤
│ Select Doctor: [Dr. Anand ▼]                                │
├─────────────────────────────────────────────────────────────┤
│ DEFAULT SHARING                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Sharing Type: ○ Blanket %  ○ Test-wise                  │ │
│ │ Default Sharing: [20] %                                  │ │
│ └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ CALCULATION OPTIONS                                          │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ☑️ Exclude doctor-given discount from sharing            │ │
│ │    └ If doctor gives 10% discount, sharing calculated   │ │
│ │      on (revenue - discount), not full revenue          │ │
│ │                                                          │ │
│ │ ☐ Share discount 50-50 with lab                         │ │
│ │    └ Only if above is unchecked                         │ │
│ │                                                          │ │
│ │ ☐ Exclude outsource cost from sharing base              │ │
│ │    └ If test costs ₹500 to outsource, sharing on        │ │
│ │      (revenue - ₹500)                                   │ │
│ │                                                          │ │
│ │ ☐ Exclude package savings from sharing                  │ │
│ │    └ If tests sum to ₹2000 but package is ₹1500,       │ │
│ │      exclude ₹500 savings from sharing base             │ │
│ └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ TEST-WISE SHARING (Override default %)                       │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Test Name                  │ Price   │ Sharing %        │ │
│ ├────────────────────────────┼─────────┼──────────────────┤ │
│ │ CBC                        │ ₹350    │ [25] %           │ │
│ │ Lipid Profile              │ ₹600    │ [30] %           │ │
│ │ Thyroid Panel              │ ₹800    │ [15] %           │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                              [Save Settings] │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 4: Commission Calculation Page

### File: `src/pages/DoctorCommissions.tsx`

**Features:**
1. Date range filter
2. Doctor filter (single or all)
3. Summary KPIs
4. Detailed table with calculation breakdown
5. Export to Excel

**Calculation Logic:**

```typescript
function calculateDoctorCommission(invoice: Invoice, settings: DoctorSharing): CommissionResult {
  let sharingBase = invoice.total;  // Start with full invoice amount
  
  // 1. Handle discount
  if (invoice.discount > 0) {
    if (invoice.discount_source === 'doctor') {
      if (settings.exclude_dr_discount) {
        // Subtract doctor discount from sharing base
        sharingBase -= invoice.discount;
      } else if (settings.share_discount_50_50) {
        // Share discount 50-50: reduce sharing base by half the discount
        sharingBase -= (invoice.discount / 2);
      }
      // If neither option: lab bears full discount, sharing on gross
    }
    // Lab/location/account discounts: not deducted from doctor sharing
  }
  
  // 2. Handle outsource cost
  if (settings.exclude_outsource_cost) {
    const outsourceCost = invoice.items
      .filter(item => item.outsourced_cost)
      .reduce((sum, item) => sum + item.outsourced_cost, 0);
    sharingBase -= outsourceCost;
  }
  
  // 3. Handle package savings
  if (settings.exclude_package_diff) {
    const packageItems = invoice.items.filter(item => item.is_package);
    for (const pkg of packageItems) {
      const sumOfTests = pkg.component_tests.reduce((sum, t) => sum + t.price, 0);
      const packagePrice = pkg.amount;
      const savings = sumOfTests - packagePrice;
      if (savings > 0) {
        sharingBase -= savings;
      }
    }
  }
  
  // 4. Calculate sharing amount
  let sharingPercent = settings.default_sharing_percent;
  
  // Check for test-wise override
  if (settings.sharing_type === 'test_wise') {
    // Use weighted average of test-wise percentages
    // Or calculate per-item and sum
  }
  
  const sharingAmount = (sharingBase * sharingPercent) / 100;
  
  return {
    grossRevenue: invoice.total,
    discount: invoice.discount,
    discountSource: invoice.discount_source,
    outsourceCost: outsourceCost,
    packageSavings: packageSavings,
    sharingBase: sharingBase,
    sharingPercent: sharingPercent,
    sharingAmount: sharingAmount,
    labNetRevenue: invoice.total - invoice.discount - sharingAmount
  };
}
```

**UI Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│ Doctor Commission Report                                     │
├─────────────────────────────────────────────────────────────┤
│ Date Range: [01-Jan-2026] to [26-Jan-2026]  Doctor: [All ▼] │
│                                              [Generate Report]│
├─────────────────────────────────────────────────────────────┤
│ SUMMARY                                                      │
│ ┌────────────┬────────────┬────────────┬────────────┐       │
│ │ Total Rev  │ Total Disc │ Total Share│ Net to Lab │       │
│ │ ₹1,50,000  │ ₹12,000    │ ₹27,600    │ ₹1,10,400  │       │
│ └────────────┴────────────┴────────────┴────────────┘       │
├─────────────────────────────────────────────────────────────┤
│ DETAILED BREAKDOWN                                           │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │Date    │Patient    │Tests      │Revenue│Disc│Out │Share│ │
│ ├────────┼───────────┼───────────┼───────┼────┼────┼─────┤ │
│ │26-Jan  │John Doe   │CBC,Lipid  │₹950   │₹95 │₹0  │₹171 │ │
│ │26-Jan  │Jane Smith │Thyroid    │₹800   │₹0  │₹200│₹120 │ │
│ │...     │...        │...        │...    │... │... │...  │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                              [Export Excel]  │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 5: Order Form - Discount Source

### Update `OrderForm.tsx`

Add discount source selector when discount is applied:

```tsx
{discountValue > 0 && (
  <div className="flex items-center gap-2">
    <label className="text-sm font-medium">Discount Given By:</label>
    <select 
      value={discountSource}
      onChange={(e) => setDiscountSource(e.target.value)}
      className="border rounded px-2 py-1"
    >
      <option value="lab">Lab Discount</option>
      <option value="doctor">Doctor Discount</option>
    </select>
  </div>
)}
```

### Update `CreateInvoiceModal.tsx`

Pass discount_source when creating invoice:

```typescript
const invoiceData = {
  ...existingData,
  discount_source: discountSource // 'doctor' | 'lab' | 'location' | 'account'
};
```

---

## Phase 6: Doctor Portal (Future)

### Files:
- `src/pages/DoctorLogin.tsx` - Auth page
- `src/pages/DoctorPortal.tsx` - Dashboard
- `src/pages/DoctorPortalLayout.tsx` - Layout wrapper

### Features:
1. **Login** - Doctor authenticates with email/password
2. **Dashboard** - Summary of referrals and earnings
3. **Patients** - View referred patients and their reports
4. **Commissions** - View monthly commission statements
5. **Download Reports** - Download PDF reports for their patients

### Database:
```sql
CREATE TABLE doctor_portal_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id uuid UNIQUE REFERENCES doctors(id),
  auth_user_id uuid REFERENCES auth.users(id),
  portal_enabled boolean DEFAULT false,
  last_login timestamptz,
  created_at timestamptz DEFAULT now()
);
```

---

## Implementation Checklist

### Week 1: Database & API
- [ ] Create migration file `20260126000000_add_doctor_sharing.sql`
- [ ] Run migration on dev database
- [ ] Add `doctorSharing` methods to `supabase.ts`
- [ ] Add `discount_source` to invoice interface
- [ ] Test API methods

### Week 2: Sharing Settings UI
- [ ] Create `DoctorSharingSettings.tsx` page
- [ ] Implement doctor selector
- [ ] Implement default sharing % input
- [ ] Implement 4 calculation option toggles
- [ ] Implement test-wise sharing grid
- [ ] Add route in `App.tsx`
- [ ] Add navigation link

### Week 3: Commission Calculation
- [ ] Create `DoctorCommissions.tsx` page
- [ ] Implement date range filter
- [ ] Implement doctor filter
- [ ] Implement calculation logic with all 3 parameters
- [ ] Implement summary KPIs
- [ ] Implement detailed table
- [ ] Add Excel export
- [ ] Add route and navigation

### Week 4: Order Form Integration
- [ ] Add discount source selector to `OrderForm.tsx`
- [ ] Update `CreateInvoiceModal.tsx` to save discount_source
- [ ] Test end-to-end flow
- [ ] Deploy to production

### Future: Doctor Portal
- [ ] Create portal login page
- [ ] Create portal dashboard
- [ ] Implement patient view
- [ ] Implement commission statement view
- [ ] Implement report download

---

## Key Business Logic

### Discount Handling Matrix

| Discount Source | exclude_dr_discount | share_discount_50_50 | Sharing Base |
|-----------------|---------------------|----------------------|--------------|
| Doctor | ON | - | Revenue - Discount |
| Doctor | OFF | ON | Revenue - (Discount/2) |
| Doctor | OFF | OFF | Revenue (lab bears discount) |
| Lab | - | - | Revenue (discount not deducted) |
| Location | - | - | Revenue (discount not deducted) |

### Outsource Cost Example

| Test | Revenue | Outsource Cost | exclude_outsource | Sharing Base |
|------|---------|----------------|-------------------|--------------|
| CBC | ₹500 | ₹0 | ON | ₹500 |
| Vitamin D | ₹1200 | ₹400 | ON | ₹800 |
| Vitamin D | ₹1200 | ₹400 | OFF | ₹1200 |

### Package Savings Example

| Package | Package Price | Sum of Tests | exclude_package_diff | Sharing Base |
|---------|---------------|--------------|----------------------|--------------|
| Lipid Panel | ₹600 | ₹900 | ON | ₹600 (exclude ₹300 savings) |
| Lipid Panel | ₹600 | ₹900 | OFF | ₹900 |
