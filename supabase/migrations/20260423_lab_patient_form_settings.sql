-- ============================================================
-- Feature: Per-lab patient registration form field configuration
-- Controls which built-in fields are shown/hidden/required
-- in both OrderForm inline modal and PatientForm.tsx
-- ============================================================

CREATE TABLE IF NOT EXISTS public.lab_patient_form_settings (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id                  UUID        NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,

  -- Salutation / name prefix (Mr. Mrs. Ms. Dr. ...)
  show_salutation         BOOLEAN     NOT NULL DEFAULT false,
  salutation_options      JSONB       NOT NULL DEFAULT '["Mr.","Mrs.","Ms.","Dr.","Master","Baby","Prof.","Shri.","Smt.","Ku."]'::jsonb,

  -- Name layout
  show_middle_name        BOOLEAN     NOT NULL DEFAULT true,

  -- Age / DOB
  -- 'age'  → only age input
  -- 'dob'  → only DOB picker (age auto-calculated, stored)
  -- 'both' → both fields shown
  age_mode                TEXT        NOT NULL DEFAULT 'both' CHECK (age_mode IN ('age','dob','both')),

  -- Gender
  show_gender             BOOLEAN     NOT NULL DEFAULT true,
  gender_options          JSONB       NOT NULL DEFAULT '["Male","Female","Other"]'::jsonb,

  -- Contact
  phone_required          BOOLEAN     NOT NULL DEFAULT true,
  show_email              BOOLEAN     NOT NULL DEFAULT true,
  email_required          BOOLEAN     NOT NULL DEFAULT false,

  -- Address block
  show_address            BOOLEAN     NOT NULL DEFAULT false,
  show_city               BOOLEAN     NOT NULL DEFAULT false,
  show_state              BOOLEAN     NOT NULL DEFAULT false,
  show_pincode            BOOLEAN     NOT NULL DEFAULT false,

  -- Emergency contact block
  show_emergency_contact  BOOLEAN     NOT NULL DEFAULT false,

  -- Medical info (shown in PatientForm only, not the quick inline modal)
  show_blood_group        BOOLEAN     NOT NULL DEFAULT false,
  show_allergies          BOOLEAN     NOT NULL DEFAULT false,
  show_medical_history    BOOLEAN     NOT NULL DEFAULT false,

  -- Referring doctor
  show_referring_doctor   BOOLEAN     NOT NULL DEFAULT true,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (lab_id)
);

-- RLS
ALTER TABLE public.lab_patient_form_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lab_members_read_own_form_settings"
  ON public.lab_patient_form_settings FOR SELECT
  USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "lab_admins_manage_form_settings"
  ON public.lab_patient_form_settings FOR ALL
  USING (lab_id IN (SELECT lab_id FROM public.users WHERE id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_patient_form_settings TO authenticated;

COMMENT ON TABLE public.lab_patient_form_settings IS
  'Per-lab configuration for which built-in patient registration fields are shown, hidden, or required.';
