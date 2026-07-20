-- Fix corporate bulk order creation for accounts whose display prefix is longer
-- than 20 characters. The previous local variable truncated the function's
-- usable input range even though patients.display_id and orders.visit_group_id
-- are wider.

CREATE OR REPLACE FUNCTION public.generate_visit_group_id(p_patient_id UUID, p_order_date DATE)
RETURNS VARCHAR(100) AS $$
DECLARE
  patient_display TEXT;
  date_str TEXT;
  sequence_num INTEGER;
  visit_id TEXT;
BEGIN
  SELECT COALESCE(
    NULLIF(p.display_id, ''),
    'PAT' || LPAD(extract(day from p_order_date)::text, 2, '0')
  )
  INTO patient_display
  FROM public.patients p
  WHERE p.id = p_patient_id;

  date_str := TO_CHAR(p_order_date, 'DDMONYY');

  SELECT COUNT(DISTINCT o.visit_group_id) + 1
  INTO sequence_num
  FROM public.orders o
  WHERE o.patient_id = p_patient_id
    AND o.order_date::date = p_order_date
    AND o.visit_group_id IS NOT NULL;

  visit_id := patient_display || '-' || date_str;

  IF sequence_num > 1 THEN
    visit_id := visit_id || '-' || LPAD(sequence_num::text, 3, '0');
  END IF;

  RETURN LEFT(visit_id, 100);
END;
$$ LANGUAGE plpgsql;
