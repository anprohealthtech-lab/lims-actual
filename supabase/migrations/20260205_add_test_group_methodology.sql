-- ============================================================================
-- Add methodology to test_groups
-- Migration: 20260205_add_test_group_methodology.sql
-- ============================================================================

ALTER TABLE public.test_groups
  ADD COLUMN IF NOT EXISTS methodology text;

COMMENT ON COLUMN public.test_groups.methodology IS
  'Test methodology/technique (e.g., ELISA, CLIA, ISE, Photometry).';
