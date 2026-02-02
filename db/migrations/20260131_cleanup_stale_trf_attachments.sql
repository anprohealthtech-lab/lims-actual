-- Migration: Clean up orphaned/stale TRF attachments
-- Problem: TRF attachments with related_id = '00000000-0000-0000-0000-000000000000' that were never linked to orders
-- These can accidentally get linked to wrong orders

-- Delete stale TRF attachments older than 24 hours that were never linked to an order
DELETE FROM attachments
WHERE related_table = 'orders'
  AND related_id = '00000000-0000-0000-0000-000000000000'
  AND description = 'Test Request Form for order creation'
  AND upload_timestamp < NOW() - INTERVAL '24 hours';

-- Also fix any attachments where order_id doesn't match related_id (data inconsistency)
UPDATE attachments
SET order_id = related_id::uuid
WHERE related_table = 'orders'
  AND related_id != '00000000-0000-0000-0000-000000000000'
  AND (order_id IS NULL OR order_id != related_id::uuid);

-- Delete the specific stale attachment from Jan 30 that got incorrectly linked
-- (Run this manually if needed for the specific case)
-- DELETE FROM attachments WHERE id = '581aa0f9-066f-4665-8d46-c2884b7f111a';
