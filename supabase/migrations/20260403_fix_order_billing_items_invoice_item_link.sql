-- Trigger: auto-link invoice_item_id on order_billing_items
--
-- Bug: OrderForm batch-inserts invoice_items without writing invoice_item_id
-- back to order_billing_items, leaving is_invoiced=true with invoice_item_id=null.
-- This makes charges invisible in PDFs while showing as "Invoiced" in the UI.
--
-- Fix: AFTER INSERT trigger on invoice_items — whenever a row is inserted with
-- a non-null order_billing_item_id, automatically set invoice_item_id on the
-- matching order_billing_items row. Zero app-side changes needed.

CREATE OR REPLACE FUNCTION public.fn_link_invoice_item_to_billing_item()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.order_billing_item_id IS NOT NULL THEN
    UPDATE public.order_billing_items
    SET
      invoice_item_id = NEW.id,
      updated_at      = NOW()
    WHERE id = NEW.order_billing_item_id
      AND invoice_item_id IS NULL;  -- don't overwrite if already linked
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_invoice_item_to_billing_item ON public.invoice_items;

CREATE TRIGGER trg_link_invoice_item_to_billing_item
  AFTER INSERT ON public.invoice_items
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_link_invoice_item_to_billing_item();

COMMENT ON FUNCTION public.fn_link_invoice_item_to_billing_item() IS
  'After an invoice_item is inserted with order_billing_item_id set, writes the invoice_item.id back to order_billing_items.invoice_item_id. Prevents is_invoiced=true / invoice_item_id=null inconsistency.';

-- Backfill: fix all existing rows where is_invoiced=true but invoice_item_id=null.
-- Matches via invoice_items.order_billing_item_id → order_billing_items.id.
UPDATE public.order_billing_items obi
SET
  invoice_item_id = ii.id,
  updated_at      = NOW()
FROM public.invoice_items ii
WHERE ii.order_billing_item_id = obi.id
  AND obi.invoice_item_id IS NULL
  AND obi.is_invoiced = TRUE;
