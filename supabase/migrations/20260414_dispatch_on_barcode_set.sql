-- Trigger auto-dispatch when a sample barcode is assigned for the first time.
-- Problem: auto-dispatch fires on order creation (webhook), but samples.barcode
-- is often null at that point. The HL7 message goes out with the LIMS sample_id
-- fallback (e.g. MUK2571-14-Apr-2026-001) instead of the numeric tube barcode.
-- Solution: when barcode transitions NULL → value, update any pending queue entry
-- AND call auto-dispatch-analyzer again so a corrected message is sent.

CREATE OR REPLACE FUNCTION fn_dispatch_on_barcode_set()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_interface_enabled boolean;
BEGIN
  -- Only fire when barcode transitions from NULL to a real value
  IF OLD.barcode IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.barcode IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if the lab has the analyzer interface enabled
  SELECT lab_interface_enabled INTO v_interface_enabled
    FROM labs
   WHERE id = NEW.lab_id;

  IF NOT COALESCE(v_interface_enabled, false) THEN
    RETURN NEW;  -- interface disabled for this lab, do nothing
  END IF;

  -- Update any pending/mapped queue entries so they use the correct barcode
  -- before the HL7 message is transmitted
  UPDATE analyzer_order_queue
     SET sample_barcode = NEW.barcode,
         updated_at     = now()
   WHERE order_id       = NEW.order_id
     AND status         IN ('pending', 'mapped');

  -- Call auto-dispatch-analyzer so deferred orders (barcode was null at order creation)
  -- get dispatched now with the correct barcode
  PERFORM net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/auto-dispatch-analyzer',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body    := jsonb_build_object('order_id', NEW.order_id)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dispatch_on_barcode_set ON samples;

CREATE TRIGGER trg_dispatch_on_barcode_set
  AFTER UPDATE OF barcode ON samples
  FOR EACH ROW
  EXECUTE FUNCTION fn_dispatch_on_barcode_set();
