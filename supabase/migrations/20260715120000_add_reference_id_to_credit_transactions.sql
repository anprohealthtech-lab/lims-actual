-- The billing UI (ReceivePaymentModal, MonthlyAccountBilling) links payments to a
-- consolidated invoice or account via reference_type + reference_id, but only
-- reference_type was ever added to credit_transactions. Add the missing column.
ALTER TABLE public.credit_transactions
  ADD COLUMN IF NOT EXISTS reference_id uuid;

-- reference_id is polymorphic (consolidated_invoices.id or accounts.id depending
-- on reference_type), so no FK — just an index for the payment-allocation lookups.
CREATE INDEX IF NOT EXISTS idx_credit_transactions_reference
  ON public.credit_transactions (reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

-- Refresh PostgREST's schema cache so the new column is immediately visible.
NOTIFY pgrst, 'reload schema';
