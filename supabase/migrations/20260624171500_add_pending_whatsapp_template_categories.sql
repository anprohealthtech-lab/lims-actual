-- Add WhatsApp template categories used by the existing default templates.

DO $$
BEGIN
  ALTER TYPE public.whatsapp_template_category ADD VALUE IF NOT EXISTS 'doctor_report_ready';
  ALTER TYPE public.whatsapp_template_category ADD VALUE IF NOT EXISTS 'invoice_generated';
  ALTER TYPE public.whatsapp_template_category ADD VALUE IF NOT EXISTS 'registration_confirmation';
EXCEPTION
  WHEN undefined_object THEN
    NULL;
END $$;
