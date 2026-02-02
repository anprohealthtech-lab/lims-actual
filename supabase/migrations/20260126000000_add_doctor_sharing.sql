-- Migration: Add Doctor Sharing/Commission System
-- Date: 2026-01-26
-- Purpose: Create tables for doctor commission/sharing configuration and tracking

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
  
  -- Doctor Discount Options
  -- Mode: 'none' = no adjustment, 'exclude_from_base' = reduce shareable amount, 'deduct_from_commission' = deduct from final commission
  dr_discount_mode text NOT NULL DEFAULT 'deduct_from_commission'
    CHECK (dr_discount_mode IN ('none', 'exclude_from_base', 'deduct_from_commission', 'split_50_50')),
  
  -- Outsource Cost Options  
  -- Mode: 'none' = no adjustment, 'exclude_from_base' = reduce shareable amount, 'deduct_from_commission' = deduct from final commission
  outsource_cost_mode text NOT NULL DEFAULT 'exclude_from_base'
    CHECK (outsource_cost_mode IN ('none', 'exclude_from_base', 'deduct_from_commission')),
  
  -- Package Diff Options
  -- Mode: 'none' = no adjustment, 'exclude_from_base' = reduce shareable amount, 'deduct_from_commission' = deduct from final commission  
  package_diff_mode text NOT NULL DEFAULT 'none'
    CHECK (package_diff_mode IN ('none', 'exclude_from_base', 'deduct_from_commission')),
  
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
CREATE INDEX IF NOT EXISTS idx_doctor_test_sharing_lab_id ON public.doctor_test_sharing(lab_id);
CREATE INDEX IF NOT EXISTS idx_doctor_package_sharing_doctor_id ON public.doctor_package_sharing(doctor_id);
CREATE INDEX IF NOT EXISTS idx_doctor_package_sharing_lab_id ON public.doctor_package_sharing(lab_id);
CREATE INDEX IF NOT EXISTS idx_invoices_discount_source ON public.invoices(discount_source);

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

CREATE POLICY "Users can delete their lab's doctor sharing" ON public.doctor_sharing
  FOR DELETE USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

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
