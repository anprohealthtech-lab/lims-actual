-- Allow registration confirmation messages to be sent to referring doctors.

ALTER TABLE public.lab_notification_settings
  ADD COLUMN IF NOT EXISTS auto_send_registration_to_doctor boolean DEFAULT false;

COMMENT ON COLUMN public.lab_notification_settings.auto_send_registration_to_doctor
  IS 'Automatically send order registration confirmation messages to the referring doctor when available.';

DO $$
BEGIN
  ALTER TYPE public.whatsapp_template_category ADD VALUE IF NOT EXISTS 'doctor_registration_confirmation';
EXCEPTION
  WHEN undefined_object THEN
    NULL;
END $$;
