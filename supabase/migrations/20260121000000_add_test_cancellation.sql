-- Migration: Add test cancellation feature to order_tests
-- This allows tests to be canceled (excluded from PDF) without deleting them
-- Useful when invoice is already generated but test needs to be refunded

-- Add cancellation columns
ALTER TABLE public.order_tests ADD COLUMN IF NOT EXISTS is_canceled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.order_tests ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.order_tests ADD COLUMN IF NOT EXISTS canceled_by UUID REFERENCES public.users(id);
ALTER TABLE public.order_tests ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- Index for performance - filter active tests quickly
CREATE INDEX IF NOT EXISTS idx_order_tests_active ON public.order_tests(order_id) WHERE is_canceled = false;

-- Comment for documentation
COMMENT ON COLUMN public.order_tests.is_canceled IS 'When true, test is excluded from PDF reports but retained for invoice/refund purposes';
COMMENT ON COLUMN public.order_tests.canceled_at IS 'Timestamp when the test was canceled';
COMMENT ON COLUMN public.order_tests.canceled_by IS 'User who canceled the test';
COMMENT ON COLUMN public.order_tests.cancellation_reason IS 'Optional reason for cancellation';
