-- Allow multiple consolidated B2B invoices for the same account and billing period.
-- This supports workflows where only selected patients are billed first and
-- remaining unbilled patients are billed later as a second invoice.
ALTER TABLE public.consolidated_invoices
  DROP CONSTRAINT IF EXISTS unique_account_period;
