-- Simple SQL to trigger PDF generation
-- Run this in Supabase SQL Editor

-- Step 1: Clean up existing job (if any)
DELETE FROM pdf_generation_queue 
WHERE order_id = '6f8b9be5-1a5f-49e4-8e60-5cdf7fcc648b';

-- Step 2: Manually insert job into queue
INSERT INTO pdf_generation_queue (order_id, lab_id, status, priority)
VALUES (
  '6f8b9be5-1a5f-49e4-8e60-5cdf7fcc648b',  -- Your order ID
  '2f8d0329-d584-4423-91f6-9ab326b700ae',  -- Your lab ID
  'pending',
  0
);

-- Step 3: Update order status
UPDATE orders 
SET report_generation_status = 'queued'
WHERE id = '6f8b9be5-1a5f-49e4-8e60-5cdf7fcc648b';

-- Step 4: Check if job was created
SELECT * FROM pdf_generation_queue 
WHERE order_id = '6f8b9be5-1a5f-49e4-8e60-5cdf7fcc648b';

-- Step 5: Now click "Generate Now" button in the UI
-- OR call the edge function manually:
-- SELECT net.http_post(
--   url := 'https://scqhzbkkradflywariem.supabase.co/functions/v1/generate-pdf-auto',
--   headers := jsonb_build_object(
--     'Content-Type', 'application/json',
--     'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
--   ),
--   body := jsonb_build_object('orderId', '6f8b9be5-1a5f-49e4-8e60-5cdf7fcc648b')
-- );

-- Alternatively, to trigger the database trigger, update any result:
UPDATE results 
SET verification_status = 'verified'
WHERE order_id = '6f8b9be5-1a5f-49e4-8e60-5cdf7fcc648b'
AND verification_status = 'verified'; -- This will fire the trigger even though value doesn't change

-- Check job status
SELECT 
  id,
  order_id,
  status,
  progress_stage,
  progress_percent,
  error_message,
  retry_count,
  created_at
FROM pdf_generation_queue 
WHERE order_id = '6f8b9be5-1a5f-49e4-8e60-5cdf7fcc648b';
