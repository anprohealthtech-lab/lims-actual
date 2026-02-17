-- Migration: Patient Loyalty Points System
-- Date: 2026-02-16
-- Purpose: Track patient loyalty points per lab with configurable conversion rates
-- Default: ₹100 spent = 10 points (conversion_rate = 0.1)

BEGIN;

-- ========================================
-- 1. Lab-level loyalty settings (on labs table)
-- ========================================
ALTER TABLE public.labs
ADD COLUMN IF NOT EXISTS loyalty_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.labs
ADD COLUMN IF NOT EXISTS loyalty_conversion_rate NUMERIC(10,4) NOT NULL DEFAULT 0.1;
-- 0.1 means ₹100 = 10 points (10% conversion)
-- 1.0 means ₹100 = 100 points
-- 0.01 means ₹100 = 1 point

ALTER TABLE public.labs
ADD COLUMN IF NOT EXISTS loyalty_min_redeem_points INTEGER NOT NULL DEFAULT 100;
-- Minimum points needed before a patient can redeem

ALTER TABLE public.labs
ADD COLUMN IF NOT EXISTS loyalty_point_value NUMERIC(10,4) NOT NULL DEFAULT 1.0;
-- ₹ value per point when redeeming (1 point = ₹1 by default)

COMMENT ON COLUMN public.labs.loyalty_enabled IS 'Enable/disable loyalty points program for this lab';
COMMENT ON COLUMN public.labs.loyalty_conversion_rate IS 'Points earned per ₹1 spent. E.g., 0.1 = 10 points per ₹100';
COMMENT ON COLUMN public.labs.loyalty_min_redeem_points IS 'Minimum points a patient must accumulate before redemption';
COMMENT ON COLUMN public.labs.loyalty_point_value IS 'Currency value per point when redeeming. 1.0 means 1 point = ₹1';

-- ========================================
-- 2. Patient loyalty balance (running total)
-- ========================================
CREATE TABLE IF NOT EXISTS public.patient_loyalty_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  total_earned INTEGER NOT NULL DEFAULT 0,
  total_redeemed INTEGER NOT NULL DEFAULT 0,
  current_balance INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(patient_id, lab_id)
);

CREATE INDEX IF NOT EXISTS idx_patient_loyalty_patient ON public.patient_loyalty_points(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_loyalty_lab ON public.patient_loyalty_points(lab_id);

-- RLS
ALTER TABLE public.patient_loyalty_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "patient_loyalty_points_select" ON public.patient_loyalty_points;
CREATE POLICY "patient_loyalty_points_select" ON public.patient_loyalty_points
  FOR SELECT USING (
    lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "patient_loyalty_points_insert" ON public.patient_loyalty_points;
CREATE POLICY "patient_loyalty_points_insert" ON public.patient_loyalty_points
  FOR INSERT WITH CHECK (
    lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "patient_loyalty_points_update" ON public.patient_loyalty_points;
CREATE POLICY "patient_loyalty_points_update" ON public.patient_loyalty_points
  FOR UPDATE USING (
    lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid())
  );

-- ========================================
-- 3. Points transaction ledger
-- ========================================
CREATE TABLE IF NOT EXISTS public.loyalty_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('earned', 'redeemed', 'adjusted', 'expired')),
  points INTEGER NOT NULL,
  -- positive for earned/adjusted-up, negative for redeemed/expired
  balance_after INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_txn_patient ON public.loyalty_transactions(patient_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_txn_lab ON public.loyalty_transactions(lab_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_txn_order ON public.loyalty_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_txn_created ON public.loyalty_transactions(created_at DESC);

-- RLS
ALTER TABLE public.loyalty_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loyalty_transactions_select" ON public.loyalty_transactions;
CREATE POLICY "loyalty_transactions_select" ON public.loyalty_transactions
  FOR SELECT USING (
    lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "loyalty_transactions_insert" ON public.loyalty_transactions;
CREATE POLICY "loyalty_transactions_insert" ON public.loyalty_transactions
  FOR INSERT WITH CHECK (
    lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid())
  );

-- ========================================
-- 4. Track points redeemed on orders
-- ========================================
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS loyalty_points_redeemed INTEGER DEFAULT 0;

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS loyalty_discount_amount NUMERIC(10,2) DEFAULT 0;

COMMENT ON COLUMN public.orders.loyalty_points_redeemed IS 'Number of loyalty points redeemed on this order';
COMMENT ON COLUMN public.orders.loyalty_discount_amount IS 'Currency discount applied from loyalty points';

COMMIT;
