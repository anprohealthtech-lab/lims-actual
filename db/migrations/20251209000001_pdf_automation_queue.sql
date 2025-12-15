-- PDF Automation Queue System
-- This migration creates the infrastructure for automated PDF report generation

-- 1. PDF Generation Queue Table
CREATE TABLE IF NOT EXISTS pdf_generation_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  lab_id UUID NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  
  -- Job status tracking
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  priority INTEGER DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Progress tracking
  progress_stage TEXT,
  progress_percent INTEGER,
  
  -- Error handling
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  
  -- Processing info
  processing_by TEXT, -- Worker instance identifier
  
  -- Constraints
  UNIQUE(order_id), -- One job per order
  CHECK (progress_percent >= 0 AND progress_percent <= 100)
);

-- Index for efficient job picking
CREATE INDEX IF NOT EXISTS idx_pdf_queue_status_priority 
ON pdf_generation_queue(status, priority DESC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_pdf_queue_order_id 
ON pdf_generation_queue(order_id);

CREATE INDEX IF NOT EXISTS idx_pdf_queue_lab_id 
ON pdf_generation_queue(lab_id);

-- 2. Add PDF generation status to orders table
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS report_generation_status TEXT 
CHECK (report_generation_status IN ('not_started', 'queued', 'processing', 'completed', 'failed'));

ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS report_auto_generated_at TIMESTAMPTZ;

-- Index for orders with generation status
CREATE INDEX IF NOT EXISTS idx_orders_report_generation_status 
ON orders(report_generation_status);

-- 3. Function to queue PDF generation job
CREATE OR REPLACE FUNCTION queue_pdf_generation()
RETURNS TRIGGER AS $$
DECLARE
  all_results_approved BOOLEAN;
  order_lab_id UUID;
BEGIN
  -- Check if all results for this order are verified
  SELECT 
    COUNT(*) = COUNT(CASE WHEN verification_status = 'verified' THEN 1 END) AND COUNT(*) > 0
  INTO all_results_approved
  FROM results
  WHERE order_id = NEW.order_id;

  -- Get lab_id from the order (don't try to MAX() a UUID)
  SELECT lab_id INTO order_lab_id
  FROM orders
  WHERE id = NEW.order_id;

  -- If all results approved and order status is 'Pending Approval' or 'Completed'
  IF all_results_approved AND order_lab_id IS NOT NULL THEN

    -- Insert job into queue (ON CONFLICT DO NOTHING to avoid duplicates)
    INSERT INTO pdf_generation_queue (order_id, lab_id, status, priority)
    VALUES (NEW.order_id, order_lab_id, 'pending', 0)
    ON CONFLICT (order_id) DO NOTHING;

    -- Update order status
    UPDATE orders
    SET report_generation_status = 'queued'
    WHERE id = NEW.order_id;

    -- Note: In production, this could trigger a webhook to Netlify function
    -- For dev, we'll call the function manually from the UI when needed
    RAISE NOTICE 'PDF generation queued for order: % (Call generate-pdf-on-demand function to process)', NEW.order_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Trigger on results table to auto-queue PDF generation
DROP TRIGGER IF EXISTS trigger_queue_pdf_on_approval ON results;

CREATE TRIGGER trigger_queue_pdf_on_approval
AFTER UPDATE OF verification_status ON results
FOR EACH ROW
WHEN (NEW.verification_status = 'verified')
EXECUTE FUNCTION queue_pdf_generation();

-- 5. Function to get next pending job
CREATE OR REPLACE FUNCTION get_next_pdf_job(worker_id TEXT)
RETURNS TABLE (
  job_id UUID,
  order_id UUID,
  lab_id UUID,
  retry_count INTEGER
) AS $$
DECLARE
  selected_job_id UUID;
BEGIN
  -- Select and lock the next pending job
  SELECT id INTO selected_job_id
  FROM pdf_generation_queue
  WHERE status = 'pending'
    AND pdf_generation_queue.retry_count < pdf_generation_queue.max_retries
  ORDER BY priority DESC, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  -- If job found, mark as processing
  IF selected_job_id IS NOT NULL THEN
    UPDATE pdf_generation_queue
    SET status = 'processing',
        started_at = NOW(),
        processing_by = worker_id,
        progress_stage = 'Starting PDF generation...',
        progress_percent = 0
    WHERE id = selected_job_id;

    -- Update order status
    UPDATE orders
    SET report_generation_status = 'processing'
    WHERE id = (SELECT pdf_generation_queue.order_id FROM pdf_generation_queue WHERE id = selected_job_id);

    -- Return job details
    RETURN QUERY
    SELECT 
      pq.id,
      pq.order_id,
      pq.lab_id,
      pq.retry_count
    FROM pdf_generation_queue pq
    WHERE pq.id = selected_job_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 6. Function to complete a job
CREATE OR REPLACE FUNCTION complete_pdf_job(
  job_id UUID,
  pdf_url TEXT
)
RETURNS VOID AS $$
BEGIN
  UPDATE pdf_generation_queue
  SET status = 'completed',
      completed_at = NOW(),
      progress_stage = 'PDF ready for download!',
      progress_percent = 100,
      error_message = NULL
  WHERE id = job_id;

  -- Update order status
  UPDATE orders
  SET report_generation_status = 'completed',
      report_auto_generated_at = NOW()
  WHERE id = (SELECT order_id FROM pdf_generation_queue WHERE id = job_id);
END;
$$ LANGUAGE plpgsql;

-- 7. Function to mark job as failed
CREATE OR REPLACE FUNCTION fail_pdf_job(
  job_id UUID,
  error_msg TEXT
)
RETURNS VOID AS $$
DECLARE
  current_retry_count INTEGER;
  max_retry_count INTEGER;
BEGIN
  -- Get current retry counts
  SELECT retry_count, max_retries
  INTO current_retry_count, max_retry_count
  FROM pdf_generation_queue
  WHERE id = job_id;

  -- Increment retry count
  current_retry_count := current_retry_count + 1;

  -- If max retries reached, mark as failed permanently
  IF current_retry_count >= max_retry_count THEN
    UPDATE pdf_generation_queue
    SET status = 'failed',
        retry_count = current_retry_count,
        error_message = error_msg,
        completed_at = NOW(),
        progress_stage = 'Failed: ' || error_msg
    WHERE id = job_id;

    -- Update order status to failed
    UPDATE orders
    SET report_generation_status = 'failed'
    WHERE id = (SELECT order_id FROM pdf_generation_queue WHERE id = job_id);
  ELSE
    -- Mark as pending for retry
    UPDATE pdf_generation_queue
    SET status = 'pending',
        retry_count = current_retry_count,
        error_message = error_msg,
        processing_by = NULL,
        started_at = NULL,
        progress_stage = 'Queued for retry (attempt ' || (current_retry_count + 1) || ')'
    WHERE id = job_id;

    -- Update order status back to queued
    UPDATE orders
    SET report_generation_status = 'queued'
    WHERE id = (SELECT order_id FROM pdf_generation_queue WHERE id = job_id);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 8. Function to update job progress
CREATE OR REPLACE FUNCTION update_pdf_job_progress(
  job_id UUID,
  stage TEXT,
  percent INTEGER
)
RETURNS VOID AS $$
BEGIN
  UPDATE pdf_generation_queue
  SET progress_stage = stage,
      progress_percent = percent
  WHERE id = job_id;
END;
$$ LANGUAGE plpgsql;

-- 9. Function to manually retry a failed job
CREATE OR REPLACE FUNCTION retry_pdf_job(job_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE pdf_generation_queue
  SET status = 'pending',
      error_message = NULL,
      retry_count = 0,
      processing_by = NULL,
      started_at = NULL,
      completed_at = NULL,
      progress_stage = 'Queued for retry',
      progress_percent = 0
  WHERE id = job_id;

  -- Update order status
  UPDATE orders
  SET report_generation_status = 'queued'
  WHERE id = (SELECT order_id FROM pdf_generation_queue WHERE id = job_id);
END;
$$ LANGUAGE plpgsql;

-- 10. Enable RLS
ALTER TABLE pdf_generation_queue ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view jobs from their lab"
ON pdf_generation_queue
FOR SELECT
USING (lab_id IN (SELECT lab_id FROM users WHERE id = auth.uid()));

CREATE POLICY "System can manage all jobs"
ON pdf_generation_queue
FOR ALL
USING (true)
WITH CHECK (true);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON pdf_generation_queue TO authenticated;
GRANT EXECUTE ON FUNCTION get_next_pdf_job(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION complete_pdf_job(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fail_pdf_job(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION update_pdf_job_progress(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION retry_pdf_job(UUID) TO authenticated;

-- Comments
COMMENT ON TABLE pdf_generation_queue IS 'Queue for automated PDF report generation jobs';
COMMENT ON FUNCTION queue_pdf_generation() IS 'Automatically queues PDF generation when all results are verified';
COMMENT ON FUNCTION get_next_pdf_job(TEXT) IS 'Gets next pending job and marks it as processing (with row locking)';
COMMENT ON FUNCTION complete_pdf_job(UUID, TEXT) IS 'Marks a job as completed and updates order status';
COMMENT ON FUNCTION fail_pdf_job(UUID, TEXT) IS 'Marks a job as failed or queues for retry based on retry count';
