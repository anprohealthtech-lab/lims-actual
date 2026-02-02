-- Add smart report columns to orders table
-- These columns store the generated Smart Report PDF URL and timestamp

ALTER TABLE orders ADD COLUMN IF NOT EXISTS smart_report_url TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS smart_report_generated_at TIMESTAMPTZ;

-- Add comments for clarity
COMMENT ON COLUMN orders.smart_report_url IS 'URL of the generated Smart Report PDF (AI-enhanced with Gamma)';
COMMENT ON COLUMN orders.smart_report_generated_at IS 'Timestamp when the Smart Report was generated';

-- Create index for faster lookup
CREATE INDEX IF NOT EXISTS idx_orders_smart_report_url ON orders(smart_report_url) WHERE smart_report_url IS NOT NULL;
