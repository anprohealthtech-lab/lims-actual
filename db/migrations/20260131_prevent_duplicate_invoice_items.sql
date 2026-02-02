-- Migration: Prevent duplicate billing of the same order_test
-- Problem: Same order_test_id can appear in multiple invoice_items, causing double billing
-- Solution: Add unique constraint on order_test_id (partial - only for non-null values)

-- First, identify and clean up any existing duplicates (keep the first one per order_test_id)
WITH duplicates AS (
  SELECT id, 
         order_test_id,
         ROW_NUMBER() OVER (PARTITION BY order_test_id ORDER BY created_at ASC) as rn
  FROM invoice_items 
  WHERE order_test_id IS NOT NULL
)
DELETE FROM invoice_items 
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Add unique partial index on order_test_id (only for non-null values)
-- This allows multiple NULL values but prevents duplicates for actual order_test references
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_items_order_test_id_unique 
ON invoice_items (order_test_id) 
WHERE order_test_id IS NOT NULL;

-- Add comment for documentation
COMMENT ON INDEX idx_invoice_items_order_test_id_unique IS 
'Prevents the same order_test from being billed multiple times. NULL order_test_ids are allowed for legacy/manual entries.';

-- Also ensure order_tests.is_billed is synced with invoice_items existence
-- Update any order_tests that have invoice_items but aren't marked as billed
UPDATE order_tests ot
SET is_billed = true,
    invoice_id = ii.invoice_id
FROM invoice_items ii
WHERE ii.order_test_id = ot.id
  AND ot.is_billed = false;
