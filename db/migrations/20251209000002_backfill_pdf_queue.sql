-- One-time script to queue PDF generation for existing approved orders
-- Run this to backfill the queue with orders that already have all results approved

-- Insert jobs for orders where all results are approved but no job exists yet
INSERT INTO pdf_generation_queue (order_id, lab_id, status, priority)
SELECT DISTINCT
  o.id AS order_id,
  o.lab_id,
  'pending' AS status,
  0 AS priority
FROM orders o
WHERE o.id IN (
  -- Find orders where all results are verified
  SELECT r.order_id
  FROM results r
  GROUP BY r.order_id
  HAVING COUNT(*) = COUNT(CASE WHEN r.verification_status = 'verified' THEN 1 END)
    AND COUNT(*) > 0
)
AND o.id NOT IN (
  -- Exclude orders that already have a job in the queue
  SELECT order_id FROM pdf_generation_queue
)
AND o.report_generation_status IS NULL OR o.report_generation_status = 'not_started';

-- Update order status for newly queued jobs
UPDATE orders
SET report_generation_status = 'queued'
WHERE id IN (
  SELECT order_id FROM pdf_generation_queue WHERE status = 'pending'
)
AND (report_generation_status IS NULL OR report_generation_status = 'not_started');

-- Show summary
SELECT 
  COUNT(*) FILTER (WHERE status = 'pending') as pending_jobs,
  COUNT(*) FILTER (WHERE status = 'processing') as processing_jobs,
  COUNT(*) FILTER (WHERE status = 'completed') as completed_jobs,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_jobs,
  COUNT(*) as total_jobs
FROM pdf_generation_queue;
