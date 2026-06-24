-- HIMS Integration: External system tracking for patients and orders
-- Allows HIMS/EMR systems to create orders via API and receive PDF reports

-- 1. Add external system tracking to patients
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS external_system_id text,
  ADD COLUMN IF NOT EXISTS external_system_type text;

COMMENT ON COLUMN public.patients.external_system_id IS 'Patient ID in external system (HIMS/EMR)';
COMMENT ON COLUMN public.patients.external_system_type IS 'Type of external system: hims, emr, his, etc.';

CREATE INDEX IF NOT EXISTS idx_patients_external_system
  ON public.patients(lab_id, external_system_type, external_system_id)
  WHERE external_system_id IS NOT NULL;

-- 2. Add external system tracking to orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS external_order_id text,
  ADD COLUMN IF NOT EXISTS external_system_type text,
  ADD COLUMN IF NOT EXISTS pdf_callback_url text,
  ADD COLUMN IF NOT EXISTS pdf_callback_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS pdf_callback_attempts integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pdf_callback_last_error text,
  ADD COLUMN IF NOT EXISTS pdf_callback_sent_at timestamptz;

COMMENT ON COLUMN public.orders.external_order_id IS 'Order ID in external system (HIMS/EMR)';
COMMENT ON COLUMN public.orders.external_system_type IS 'Type of external system: hims, emr, his, etc.';
COMMENT ON COLUMN public.orders.pdf_callback_url IS 'Webhook URL to POST final PDF report';
COMMENT ON COLUMN public.orders.pdf_callback_status IS 'pending, sent, failed, not_required';

CREATE INDEX IF NOT EXISTS idx_orders_external_system
  ON public.orders(lab_id, external_system_type, external_order_id)
  WHERE external_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_pdf_callback_pending
  ON public.orders(lab_id, pdf_callback_status)
  WHERE pdf_callback_url IS NOT NULL AND pdf_callback_status = 'pending';

-- 3. Add unique index to prevent duplicate external orders per lab (only when external_order_id is set)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_external_order_per_lab
  ON public.orders(lab_id, external_system_type, external_order_id)
  WHERE external_order_id IS NOT NULL;

-- 4. Function to find or create patient from external system
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
  -- Normalize gender
  v_gender := CASE LOWER(p_gender)
    WHEN 'male' THEN 'Male'::public.gender_type
    WHEN 'm' THEN 'Male'::public.gender_type
    WHEN 'female' THEN 'Female'::public.gender_type
    WHEN 'f' THEN 'Female'::public.gender_type
    ELSE 'Other'::public.gender_type
  END;

  -- Try to find existing patient by external ID
  SELECT id INTO v_patient_id
  FROM public.patients
  WHERE lab_id = p_lab_id
    AND external_system_type = p_external_system_type
    AND external_system_id = p_external_system_id
  LIMIT 1;

  IF v_patient_id IS NOT NULL THEN
    -- Update existing patient
    UPDATE public.patients SET
      name = COALESCE(NULLIF(p_name, ''), name),
      age = COALESCE(p_age, age),
      gender = v_gender,
      phone = COALESCE(NULLIF(p_phone, ''), phone),
      date_of_birth = COALESCE(p_date_of_birth, date_of_birth),
      email = COALESCE(NULLIF(p_email, ''), email),
      last_visit = CURRENT_DATE,
      updated_at = now()
    WHERE id = v_patient_id;

    RETURN v_patient_id;
  END IF;

  -- Create new patient
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

-- 5. Grant execute to authenticated users (edge functions use service role)
GRANT EXECUTE ON FUNCTION public.upsert_external_patient TO service_role;

-- 6. Trigger to auto-send PDF callback when order is approved/delivered
CREATE OR REPLACE FUNCTION public.fn_trigger_hims_report_callback()
RETURNS TRIGGER AS $$
DECLARE
  v_reportable_statuses TEXT[] := ARRAY['Approved', 'Delivered', 'Report Ready', 'Completed'];
  v_supabase_url TEXT;
  v_service_key TEXT;
BEGIN
  -- Only trigger if:
  -- 1. Has external order ID (from HIMS)
  -- 2. Has callback URL
  -- 3. Callback not yet sent
  -- 4. Status changed to a reportable status
  IF NEW.external_order_id IS NOT NULL
     AND NEW.pdf_callback_url IS NOT NULL
     AND NEW.pdf_callback_status = 'pending'
     AND NEW.status = ANY(v_reportable_statuses)
     AND (OLD.status IS NULL OR OLD.status <> NEW.status)
  THEN
    -- Get secrets from vault
    SELECT decrypted_secret INTO v_supabase_url
      FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL';
    SELECT decrypted_secret INTO v_service_key
      FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY';

    -- Queue the callback via pg_net (async HTTP call)
    PERFORM net.http_post(
      url     := v_supabase_url || '/functions/v1/hims-report-callback',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body    := jsonb_build_object('order_id', NEW.id)
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Don't fail the order update if callback fails
  RAISE WARNING 'HIMS callback trigger failed: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Only create trigger if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_hims_report_callback'
  ) THEN
    CREATE TRIGGER trigger_hims_report_callback
      AFTER UPDATE OF status ON public.orders
      FOR EACH ROW
      EXECUTE FUNCTION public.fn_trigger_hims_report_callback();
  END IF;
END;
$$;

-- 7. Add index for pending callbacks (for retry job)
CREATE INDEX IF NOT EXISTS idx_orders_hims_callback_retry
  ON public.orders(lab_id, pdf_callback_status, pdf_callback_attempts)
  WHERE external_order_id IS NOT NULL
    AND pdf_callback_url IS NOT NULL
    AND pdf_callback_status = 'pending'
    AND pdf_callback_attempts < 3;
