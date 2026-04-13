-- Trigger: auto-populate order_test_id on result_values INSERT
-- When a result value is inserted without order_test_id, look it up from order_tests
-- using the analyte's test_group_id. This ensures results from the analyzer interface
-- are always linked back to the correct order_test row.

CREATE OR REPLACE FUNCTION public.fn_fill_order_test_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Only run if order_test_id is missing but we have order_id + analyte_id
  IF NEW.order_test_id IS NULL AND NEW.order_id IS NOT NULL AND NEW.analyte_id IS NOT NULL THEN
    SELECT ot.id INTO NEW.order_test_id
    FROM public.order_tests ot
    JOIN public.test_group_analytes tga ON tga.test_group_id = ot.test_group_id
    WHERE ot.order_id = NEW.order_id
      AND tga.analyte_id = NEW.analyte_id
      AND ot.is_canceled IS NOT TRUE
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_order_test_id ON public.result_values;

CREATE TRIGGER trg_fill_order_test_id
  BEFORE INSERT ON public.result_values
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_fill_order_test_id();
