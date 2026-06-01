-- Phase 1: WhatsApp notifications for loyalty points earned/redeemed

BEGIN;

ALTER TABLE public.lab_notification_settings
ADD COLUMN IF NOT EXISTS auto_send_loyalty_points boolean DEFAULT false;

ALTER TABLE public.lab_notification_settings
ADD COLUMN IF NOT EXISTS auto_send_loyalty_redemption boolean DEFAULT false;

COMMENT ON COLUMN public.lab_notification_settings.auto_send_loyalty_points
  IS 'Automatically send WhatsApp message when loyalty points are earned';

COMMENT ON COLUMN public.lab_notification_settings.auto_send_loyalty_redemption
  IS 'Automatically send WhatsApp message when loyalty points are redeemed';

DO $$
BEGIN
  ALTER TYPE public.whatsapp_template_category ADD VALUE IF NOT EXISTS 'loyalty_points_earned';
  ALTER TYPE public.whatsapp_template_category ADD VALUE IF NOT EXISTS 'loyalty_points_redeemed';
EXCEPTION
  WHEN undefined_object THEN
    NULL;
END $$;

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT c.conname INTO constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'notification_queue'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%trigger_type%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.notification_queue DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE public.notification_queue
ADD CONSTRAINT notification_queue_trigger_type_check
CHECK (
  trigger_type = ANY (
    ARRAY[
      'report_ready'::text,
      'invoice_generated'::text,
      'order_registered'::text,
      'payment_reminder'::text,
      'loyalty_points_earned'::text,
      'loyalty_points_redeemed'::text
    ]
  )
);

COMMIT;
