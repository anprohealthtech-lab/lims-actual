-- Keep analyzer orders retryable while a local bridge or analyzer connection is
-- temporarily unavailable. Actual analyzer NAK responses remain rejected.

CREATE INDEX IF NOT EXISTS idx_analyzer_order_queue_due_delivery
  ON public.analyzer_order_queue (lab_id, priority, created_at, next_retry_at)
  WHERE status = 'mapped' AND flow_type = 'lims_push';

-- Recover rows that the old ACK endpoint incorrectly made terminal when the
-- bridge had no live socket for the configured analyzer connection.
UPDATE public.analyzer_order_queue
SET
  status = 'mapped',
  next_retry_at = now(),
  sending_started_at = NULL,
  sent_at = NULL
WHERE status = 'rejected'
  AND flow_type = 'lims_push'
  AND sent_at IS NULL
  AND (
    lower(COALESCE(last_error, '')) LIKE '%no connection found%'
    OR lower(COALESCE(last_error, '')) LIKE '%not connected%'
    OR lower(COALESCE(last_error, '')) LIKE '%connection unavailable%'
    OR lower(COALESCE(last_error, '')) LIKE '%connection closed%'
    OR lower(COALESCE(last_error, '')) LIKE '%timed out%'
    OR lower(COALESCE(last_error, '')) LIKE '%etimedout%'
    OR lower(COALESCE(last_error, '')) LIKE '%econnrefused%'
    OR lower(COALESCE(last_error, '')) LIKE '%ehostunreach%'
    OR lower(COALESCE(last_error, '')) LIKE '%enetunreach%'
  );
