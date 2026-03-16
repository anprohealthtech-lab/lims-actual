-- Add collection_charge to test_groups
-- This optional per-test charge is added as a line item when sample collection is required (e.g. home visit)
ALTER TABLE test_groups
  ADD COLUMN IF NOT EXISTS collection_charge numeric(10,2) DEFAULT NULL;

COMMENT ON COLUMN test_groups.collection_charge IS 'Optional sample collection charge applied per test group (e.g. for home collection visits)';

-- Add collection_charge to orders for recording the total collection charge applied
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS collection_charge numeric(10,2) DEFAULT NULL;

COMMENT ON COLUMN orders.collection_charge IS 'Total sample collection charge applied to this order';

-- Add collection_charge to invoices for tracking on the invoice record
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS collection_charge numeric(10,2) DEFAULT NULL;

COMMENT ON COLUMN invoices.collection_charge IS 'Sample collection charge included in this invoice total';
