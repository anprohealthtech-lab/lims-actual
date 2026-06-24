-- Fix ambiguous lab_id references hit by hims-order-create during order insert.
-- PostgreSQL can treat unqualified names in PL/pgSQL as either variables/output
-- parameters or table columns. Qualifying the table columns prevents error 42702.

CREATE OR REPLACE FUNCTION public.upsert_external_patient(
  p_lab_id UUID,
  p_external_system_type TEXT,
  p_external_system_id TEXT,
  p_name TEXT,
  p_age INTEGER,
  p_gender TEXT,
  p_phone TEXT,
  p_date_of_birth DATE DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_address TEXT DEFAULT '',
  p_city TEXT DEFAULT '',
  p_state TEXT DEFAULT '',
  p_pincode TEXT DEFAULT ''
) RETURNS UUID AS $$
DECLARE
  v_patient_id UUID;
  v_gender public.gender_type;
BEGIN
  v_gender := CASE LOWER(p_gender)
    WHEN 'male' THEN 'Male'::public.gender_type
    WHEN 'm' THEN 'Male'::public.gender_type
    WHEN 'female' THEN 'Female'::public.gender_type
    WHEN 'f' THEN 'Female'::public.gender_type
    ELSE 'Other'::public.gender_type
  END;

  SELECT p.id INTO v_patient_id
  FROM public.patients p
  WHERE p.lab_id = p_lab_id
    AND p.external_system_type = p_external_system_type
    AND p.external_system_id = p_external_system_id
  LIMIT 1;

  IF v_patient_id IS NOT NULL THEN
    UPDATE public.patients p SET
      name = COALESCE(NULLIF(p_name, ''), p.name),
      age = COALESCE(p_age, p.age),
      gender = v_gender,
      phone = COALESCE(NULLIF(p_phone, ''), p.phone),
      date_of_birth = COALESCE(p_date_of_birth, p.date_of_birth),
      email = COALESCE(NULLIF(p_email, ''), p.email),
      last_visit = CURRENT_DATE,
      updated_at = now()
    WHERE p.id = v_patient_id;

    RETURN v_patient_id;
  END IF;

  INSERT INTO public.patients (
    lab_id,
    external_system_type,
    external_system_id,
    name,
    age,
    gender,
    phone,
    date_of_birth,
    email,
    address,
    city,
    state,
    pincode,
    registration_date,
    last_visit
  ) VALUES (
    p_lab_id,
    p_external_system_type,
    p_external_system_id,
    p_name,
    COALESCE(p_age, 0),
    v_gender,
    COALESCE(p_phone, ''),
    p_date_of_birth,
    p_email,
    COALESCE(p_address, ''),
    COALESCE(p_city, ''),
    COALESCE(p_state, ''),
    COALESCE(p_pincode, ''),
    CURRENT_DATE,
    CURRENT_DATE
  )
  RETURNING id INTO v_patient_id;

  RETURN v_patient_id;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.upsert_external_patient TO service_role;

CREATE OR REPLACE FUNCTION public.get_or_create_default_location(p_lab_id uuid)
RETURNS uuid AS $$
DECLARE
  v_location_id uuid;
  v_lab_record record;
BEGIN
  SELECT l.default_processing_location_id INTO v_location_id
  FROM public.labs l
  WHERE l.id = p_lab_id;

  IF v_location_id IS NOT NULL THEN
    RETURN v_location_id;
  END IF;

  SELECT loc.id INTO v_location_id
  FROM public.locations loc
  WHERE loc.lab_id = p_lab_id
    AND loc.is_main_lab = true
    AND loc.is_active = true
  LIMIT 1;

  IF v_location_id IS NOT NULL THEN
    UPDATE public.labs l
    SET default_processing_location_id = v_location_id
    WHERE l.id = p_lab_id;
    RETURN v_location_id;
  END IF;

  SELECT loc.id INTO v_location_id
  FROM public.locations loc
  WHERE loc.lab_id = p_lab_id
    AND loc.is_active = true
  ORDER BY loc.created_at ASC
  LIMIT 1;

  IF v_location_id IS NOT NULL THEN
    UPDATE public.locations loc
    SET is_main_lab = true
    WHERE loc.id = v_location_id;

    UPDATE public.labs l
    SET default_processing_location_id = v_location_id
    WHERE l.id = p_lab_id;

    RETURN v_location_id;
  END IF;

  SELECT l.name, l.address, l.city, l.state, l.pincode, l.phone, l.email
  INTO v_lab_record
  FROM public.labs l
  WHERE l.id = p_lab_id;

  INSERT INTO public.locations (
    lab_id, name, code, type, address, city, state, pincode,
    phone, email, is_active, is_main_lab,
    is_collection_center, is_processing_center, can_receive_samples,
    supports_cash_collection
  ) VALUES (
    p_lab_id,
    COALESCE(v_lab_record.name, 'Main Lab') || ' - Main',
    'MAIN',
    'diagnostic_center',
    v_lab_record.address,
    v_lab_record.city,
    v_lab_record.state,
    v_lab_record.pincode,
    v_lab_record.phone,
    v_lab_record.email,
    true,
    true,
    true,
    true,
    true,
    true
  )
  RETURNING id INTO v_location_id;

  UPDATE public.labs l
  SET default_processing_location_id = v_location_id
  WHERE l.id = p_lab_id;

  RETURN v_location_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.ensure_order_location()
RETURNS TRIGGER AS $$
DECLARE
  v_default_location uuid;
BEGIN
  IF NEW.location_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT public.get_or_create_default_location(NEW.lab_id) INTO v_default_location;

  IF v_default_location IS NOT NULL THEN
    NEW.location_id := v_default_location;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS public.assign_order_color(uuid);
CREATE OR REPLACE FUNCTION public.assign_order_color(p_lab_id uuid)
RETURNS TABLE(color_code text, color_name text) AS $$
DECLARE
  v_sequence integer;
BEGIN
  SELECT COALESCE(MAX(o.order_number), 0) + 1
  INTO v_sequence
  FROM public.orders o
  WHERE o.lab_id = p_lab_id
    AND o.order_date::date = CURRENT_DATE;

  color_code := CASE (GREATEST(v_sequence, 1) - 1) % 12
    WHEN 0 THEN '#EF4444'
    WHEN 1 THEN '#3B82F6'
    WHEN 2 THEN '#10B981'
    WHEN 3 THEN '#F59E0B'
    WHEN 4 THEN '#8B5CF6'
    WHEN 5 THEN '#06B6D4'
    WHEN 6 THEN '#EC4899'
    WHEN 7 THEN '#84CC16'
    WHEN 8 THEN '#F97316'
    WHEN 9 THEN '#6366F1'
    WHEN 10 THEN '#14B8A6'
    ELSE '#A855F7'
  END;

  color_name := CASE (GREATEST(v_sequence, 1) - 1) % 12
    WHEN 0 THEN 'Red'
    WHEN 1 THEN 'Blue'
    WHEN 2 THEN 'Green'
    WHEN 3 THEN 'Orange'
    WHEN 4 THEN 'Purple'
    WHEN 5 THEN 'Cyan'
    WHEN 6 THEN 'Pink'
    WHEN 7 THEN 'Lime'
    WHEN 8 THEN 'Amber'
    WHEN 9 THEN 'Indigo'
    WHEN 10 THEN 'Teal'
    ELSE 'Violet'
  END;

  RETURN NEXT;
END;
$$ LANGUAGE plpgsql STABLE;

DROP FUNCTION IF EXISTS public.generate_order_qr_code(uuid, uuid);
CREATE OR REPLACE FUNCTION public.generate_order_qr_code(p_order_id uuid, p_lab_id uuid)
RETURNS text AS $$
BEGIN
  RETURN jsonb_build_object(
    'type', 'order',
    'orderId', p_order_id,
    'labId', p_lab_id,
    'generatedAt', now()
  )::text;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION public.auto_assign_order_identification()
RETURNS TRIGGER AS $$
DECLARE
  lab_id_val uuid;
  v_sequence integer;
BEGIN
  IF NEW.lab_id IS NOT NULL THEN
    lab_id_val := NEW.lab_id;
  ELSE
    SELECT u.lab_id INTO lab_id_val
    FROM public.users u
    WHERE u.id = auth.uid();
  END IF;

  IF NEW.color_code IS NULL AND lab_id_val IS NOT NULL THEN
    SELECT COALESCE(MAX(o.order_number), 0) + 1
    INTO v_sequence
    FROM public.orders o
    WHERE o.lab_id = lab_id_val
      AND o.order_date::date = COALESCE(NEW.order_date::date, CURRENT_DATE);

    NEW.color_code := CASE (GREATEST(v_sequence, 1) - 1) % 12
      WHEN 0 THEN '#EF4444'
      WHEN 1 THEN '#3B82F6'
      WHEN 2 THEN '#10B981'
      WHEN 3 THEN '#F59E0B'
      WHEN 4 THEN '#8B5CF6'
      WHEN 5 THEN '#06B6D4'
      WHEN 6 THEN '#EC4899'
      WHEN 7 THEN '#84CC16'
      WHEN 8 THEN '#F97316'
      WHEN 9 THEN '#6366F1'
      WHEN 10 THEN '#14B8A6'
      ELSE '#A855F7'
    END;

    NEW.color_name := CASE (GREATEST(v_sequence, 1) - 1) % 12
      WHEN 0 THEN 'Red'
      WHEN 1 THEN 'Blue'
      WHEN 2 THEN 'Green'
      WHEN 3 THEN 'Orange'
      WHEN 4 THEN 'Purple'
      WHEN 5 THEN 'Cyan'
      WHEN 6 THEN 'Pink'
      WHEN 7 THEN 'Lime'
      WHEN 8 THEN 'Amber'
      WHEN 9 THEN 'Indigo'
      WHEN 10 THEN 'Teal'
      ELSE 'Violet'
    END;
  END IF;

  IF NEW.qr_code_data IS NULL AND lab_id_val IS NOT NULL THEN
    NEW.qr_code_data := public.generate_order_qr_code(NEW.id, lab_id_val);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.assign_patient_number()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_lab_code text;
  v_next_seq integer;
BEGIN
  IF NEW.patient_number IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT l.code INTO v_lab_code
  FROM public.labs l
  WHERE l.id = NEW.lab_id;

  IF v_lab_code IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.lab_id::text));

  SELECT COALESCE(MAX(
    CASE
      WHEN p.patient_number ~ ('^' || v_lab_code || '-P-[0-9]+$')
      THEN CAST(split_part(p.patient_number, '-P-', 2) AS integer)
      ELSE 0
    END
  ), 0) + 1
  INTO v_next_seq
  FROM public.patients p
  WHERE p.lab_id = NEW.lab_id;

  NEW.patient_number := v_lab_code || '-P-' || LPAD(v_next_seq::text, 5, '0');

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_visit_group_id(p_patient_id UUID, p_order_date DATE)
RETURNS VARCHAR(100) AS $$
DECLARE
  patient_display VARCHAR(20);
  date_str VARCHAR(20);
  sequence_num INTEGER;
  visit_id VARCHAR(100);
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

  RETURN visit_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.auto_set_visit_group_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.visit_group_id IS NULL THEN
    NEW.visit_group_id := public.generate_visit_group_id(NEW.patient_id, NEW.order_date::date);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.log_order_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.patient_activity_log (
      patient_id, order_id, activity_type, description, metadata, performed_by, lab_id
    ) VALUES (
      NEW.patient_id,
      NEW.id,
      'order_created',
      CASE
        WHEN NEW.order_type = 'initial' THEN 'Initial order created'
        WHEN NEW.order_type = 'additional' THEN 'Additional tests ordered'
        WHEN NEW.order_type = 'follow_up' THEN 'Follow-up order created'
        WHEN NEW.order_type = 'urgent' THEN 'Urgent order created'
        ELSE 'Order created'
      END,
      jsonb_build_object(
        'order_type', NEW.order_type,
        'priority', NEW.priority,
        'total_amount', NEW.total_amount,
        'visit_group_id', NEW.visit_group_id,
        'parent_order_id', NEW.parent_order_id
      ),
      NEW.created_by,
      NEW.lab_id
    );

    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      INSERT INTO public.patient_activity_log (
        patient_id, order_id, activity_type, description, metadata, lab_id
      ) VALUES (
        NEW.patient_id,
        NEW.id,
        'status_changed',
        'Order status changed from ' || OLD.status || ' to ' || NEW.status,
        jsonb_build_object(
          'old_status', OLD.status,
          'new_status', NEW.status,
          'changed_at', NOW()
        ),
        NEW.lab_id
      );
    END IF;

    IF OLD.can_add_tests = true AND NEW.can_add_tests = false THEN
      INSERT INTO public.patient_activity_log (
        patient_id, order_id, activity_type, description, metadata, lab_id
      ) VALUES (
        NEW.patient_id,
        NEW.id,
        'order_locked',
        'Order locked from further modifications',
        jsonb_build_object(
          'locked_at', NEW.locked_at,
          'reason', 'Sample collected or processing started'
        ),
        NEW.lab_id
      );
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
