-- =============================================
-- Fix: approving a refund erased the invoice's "Refund Pending" status
-- =============================================
-- update_invoice_refund_totals() only counts refunds with status='paid'.
-- When approve_refund updated the request (pending_approval -> approved),
-- the trigger recomputed total_refunded = 0 and reset invoices.refund_status
-- to 'not_requested', wiping the 'pending' flag set at request creation.
-- The invoice then showed no refund indicator until the refund was marked paid.
--
-- This version preserves 'pending' while any open (pending_approval/approved)
-- request exists for the invoice.

CREATE OR REPLACE FUNCTION update_invoice_refund_totals()
RETURNS TRIGGER AS $$
DECLARE
  total_refunded NUMERIC(10,2);
  paid_amt NUMERIC(10,2);
  has_open_requests BOOLEAN;
  inv_id UUID;
BEGIN
  -- Determine which invoice to update
  inv_id := COALESCE(NEW.invoice_id, OLD.invoice_id);

  IF inv_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Calculate total refunded amount for this invoice (only 'paid' refunds count)
  SELECT COALESCE(SUM(refund_amount), 0) INTO total_refunded
  FROM refund_requests
  WHERE invoice_id = inv_id AND status = 'paid';

  -- Any request still in the approval/disbursement pipeline?
  SELECT EXISTS (
    SELECT 1 FROM refund_requests
    WHERE invoice_id = inv_id AND status IN ('pending_approval', 'approved')
  ) INTO has_open_requests;

  -- Get paid amount from invoice
  SELECT amount_paid INTO paid_amt FROM invoices WHERE id = inv_id;

  -- Update invoice with new totals
  UPDATE invoices
  SET
    total_refunded_amount = total_refunded,
    refund_status = CASE
      WHEN total_refunded > 0 AND total_refunded >= COALESCE(paid_amt, 0) THEN 'fully_refunded'
      WHEN total_refunded > 0 THEN 'partially_refunded'
      WHEN has_open_requests THEN 'pending'
      ELSE 'not_requested'
    END,
    updated_at = now()
  WHERE id = inv_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Backfill invoices whose 'pending' flag was wiped by the old trigger:
-- they have open refund requests but refund_status says 'not_requested'.
UPDATE invoices i
SET refund_status = 'pending', updated_at = now()
WHERE i.refund_status = 'not_requested'
  AND EXISTS (
    SELECT 1 FROM refund_requests rr
    WHERE rr.invoice_id = i.id
      AND rr.status IN ('pending_approval', 'approved')
  );

COMMENT ON FUNCTION update_invoice_refund_totals() IS
'Updates invoice total_refunded_amount and refund_status when refund_requests change; keeps refund_status=pending while open (pending_approval/approved) requests exist';
