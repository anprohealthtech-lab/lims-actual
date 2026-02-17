-- ============================================================================
-- Fix inventory_test_mapping uniqueness for NULL analyte/test columns
-- Migration: 20260206_inventory_mapping_uniqueness_fix.sql
--
-- Problem:
-- Existing UNIQUE NULLS NOT DISTINCT constraints make analyte_id NULL rows
-- conflict across same item_id, blocking multiple test_group mappings.
--
-- Solution:
-- Replace with partial unique indexes:
-- - unique (test_group_id, item_id) where test_group_id is not null
-- - unique (analyte_id, item_id) where analyte_id is not null
-- ============================================================================

ALTER TABLE public.inventory_test_mapping
  DROP CONSTRAINT IF EXISTS inventory_test_mapping_test_unique;

ALTER TABLE public.inventory_test_mapping
  DROP CONSTRAINT IF EXISTS inventory_test_mapping_analyte_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_test_mapping_test_item_unique
  ON public.inventory_test_mapping(test_group_id, item_id)
  WHERE test_group_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_test_mapping_analyte_item_unique
  ON public.inventory_test_mapping(analyte_id, item_id)
  WHERE analyte_id IS NOT NULL;
