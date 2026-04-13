-- Fix: analyzer_order_queue was missing updated_at column required by
-- the update_updated_at_column() trigger applied to it.
ALTER TABLE analyzer_order_queue
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
