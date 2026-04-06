-- Manual invoice number sequence per lab.
--
-- Adds prefix + sequence counter to labs so each lab can configure their own
-- invoice numbering (e.g., prefix "Bill No-" starting from 8081 → next: Bill No-8082).
--
-- generate_invoice_number uses an atomic UPDATE on the labs row — row-level
-- locking makes this race-condition-free without advisory locks.

ALTER TABLE public.labs
  ADD COLUMN IF NOT EXISTS invoice_prefix           TEXT NOT NULL DEFAULT 'INV-',
  ADD COLUMN IF NOT EXISTS invoice_sequence_current INT  NOT NULL DEFAULT 0;

-- Replace generate_invoice_number with the atomic sequence approach.
-- UPDATE ... RETURNING holds a row lock for the duration of the transaction,
-- so concurrent inserts serialize automatically — no advisory lock needed.
CREATE OR REPLACE FUNCTION public.generate_invoice_number(p_lab_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_prefix TEXT;
  v_seq    INT;
BEGIN
  UPDATE public.labs
  SET invoice_sequence_current = invoice_sequence_current + 1
  WHERE id = p_lab_id
  RETURNING invoice_prefix, invoice_sequence_current
  INTO v_prefix, v_seq;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lab not found: %', p_lab_id;
  END IF;

  RETURN v_prefix || v_seq::TEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN public.labs.invoice_prefix IS
  'Prefix for auto-generated invoice numbers (e.g. "INV-", "Bill No-"). Default: INV-';
COMMENT ON COLUMN public.labs.invoice_sequence_current IS
  'Last used invoice sequence number. Incremented atomically on each invoice insert.';
COMMENT ON FUNCTION public.generate_invoice_number(UUID) IS
  'Atomically increments labs.invoice_sequence_current and returns prefix||seq. Row-level lock prevents duplicate numbers under concurrent inserts.';
