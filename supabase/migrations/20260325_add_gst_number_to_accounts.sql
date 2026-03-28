-- Add gst_number column to accounts table for B2B billing
ALTER TABLE public.accounts
ADD COLUMN IF NOT EXISTS gst_number text;

COMMENT ON COLUMN public.accounts.gst_number IS 'GST Identification Number (GSTIN) for B2B account invoicing';
