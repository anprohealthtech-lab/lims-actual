-- Prevent duplicate active WhatsApp invoice notifications.
-- Reports already have an idempotent PDF generation queue; invoice notifications
-- need the same protection for multi-click and concurrent-generation cases.

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY lab_id, trigger_type, invoice_id, recipient_phone
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.notification_queue
  WHERE trigger_type = 'invoice_generated'
    AND invoice_id IS NOT NULL
    AND status IN ('pending', 'sending')
)
UPDATE public.notification_queue nq
SET
  status = 'skipped',
  last_error = 'Duplicate active invoice notification skipped',
  updated_at = now()
FROM ranked r
WHERE nq.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_queue_invoice_active_unique
ON public.notification_queue (lab_id, trigger_type, invoice_id, recipient_phone)
WHERE trigger_type = 'invoice_generated'
  AND invoice_id IS NOT NULL
  AND status IN ('pending', 'sending');
