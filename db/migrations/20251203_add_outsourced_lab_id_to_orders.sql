-- Migration: Add outsourced_lab_id column to orders table
-- Date: 2025-12-03
-- Purpose: Support tracking which external lab an order/test is outsourced to

-- Add outsourced_lab_id column to orders table
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS outsourced_lab_id uuid REFERENCES public.outsourced_labs(id);

-- Add outsourced_lab_id column to order_tests table (per-test tracking)
ALTER TABLE public.order_tests
ADD COLUMN IF NOT EXISTS outsourced_lab_id uuid REFERENCES public.outsourced_labs(id);

-- Add index for better query performance on orders
CREATE INDEX IF NOT EXISTS idx_orders_outsourced_lab_id 
ON public.orders(outsourced_lab_id) 
WHERE outsourced_lab_id IS NOT NULL;

-- Add index for better query performance on order_tests
CREATE INDEX IF NOT EXISTS idx_order_tests_outsourced_lab_id 
ON public.order_tests(outsourced_lab_id) 
WHERE outsourced_lab_id IS NOT NULL;

-- Add comments to document the columns
COMMENT ON COLUMN public.orders.outsourced_lab_id IS 'References the outsourced lab where this order is being sent for processing';
COMMENT ON COLUMN public.order_tests.outsourced_lab_id IS 'References the outsourced lab where this specific test is being sent for processing';

-- Optional: Add RLS policy if needed (uncomment if you want to enforce lab-scoped access)
-- ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY IF NOT EXISTS "orders_outsourced_lab_access" 
-- ON public.orders 
-- FOR ALL 
-- USING (lab_id = auth.uid()::uuid OR outsourced_lab_id IS NULL);
