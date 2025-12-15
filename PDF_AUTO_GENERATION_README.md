# PDF Auto-Generation System

## Overview

This system automatically generates PDF reports when all results for an order are approved. It uses a queue-based architecture with a Netlify scheduled worker that processes pending jobs.

## Architecture

```
[Result Approval] → [Database Trigger] → [Queue Job] → [Netlify Worker] → [PDF Generation] → [Storage]
```

### Components

1. **Database Tables & Functions** (`db/migrations/20251209000001_pdf_automation_queue.sql`)
   - `pdf_generation_queue` - Job queue table
   - `orders.report_generation_status` - Order-level status tracking
   - `queue_pdf_generation()` - Trigger function that queues jobs
   - `get_next_pdf_job()` - Fetches next pending job with row locking
   - `complete_pdf_job()` - Marks job as completed
   - `fail_pdf_job()` - Handles failed jobs with retry logic

2. **Database API** (`src/utils/supabase.ts`)
   - `database.pdfQueue.getNextJob(workerId)` - Get next job
   - `database.pdfQueue.markComplete(jobId, pdfUrl)` - Mark complete
   - `database.pdfQueue.markFailed(jobId, errorMessage)` - Mark failed
   - `database.pdfQueue.updateProgress(jobId, stage, percent)` - Update progress
   - `database.pdfQueue.retryJob(jobId)` - Retry failed job
   - `database.pdfQueue.getJobForOrder(orderId)` - Get job by order ID
   - `database.pdfQueue.getQueueStatus()` - Get all jobs for lab
   - `database.pdfQueue.getStatistics()` - Get queue statistics

3. **Netlify Worker** (`netlify/functions/pdf-worker.ts`)
   - Scheduled function running every minute (Netlify minimum interval)
   - Fetches next pending job from queue
   - Calls existing PDF generation logic
   - Updates job status and progress
   - Handles errors with retry logic (max 3 retries)

4. **UI Components** (`src/pages/Reports.tsx`)
   - Real-time status badges showing:
     - **Queued** - Yellow badge with clock icon
     - **Processing** - Blue badge with spinner and progress
     - **Completed** - Green badge with checkmark
     - **Failed** - Red badge with error message and retry button
   - Auto-polling every 5 seconds when active jobs exist
   - Manual retry button for failed jobs

## Workflow

### 1. Automatic Trigger
When all results for an order are approved:
```sql
-- Trigger on results table
WHEN (NEW.verify_status = 'approved')
→ Check if all results approved
→ INSERT INTO pdf_generation_queue (status = 'pending')
→ UPDATE orders SET report_generation_status = 'queued'
```

### 2. Worker Processing
Every minute, the Netlify worker:
```typescript
1. Call get_next_pdf_job(worker_id)
   - Locks next pending job (FOR UPDATE SKIP LOCKED)
   - Marks as 'processing'
   
2. Fetch template context via Netlify function
   
3. Call PDF generation function
   - Uses existing generateAndSavePDFReportWithProgress()
   - PDF.co API for generation
   - Saves to Supabase storage
   
4. On success: complete_pdf_job(job_id, pdf_url)
   - Marks as 'completed'
   - Updates order status
   
5. On failure: fail_pdf_job(job_id, error_msg)
   - Increments retry_count
   - Requeues if < max_retries (3)
   - Marks as 'failed' if max retries reached
```

### 3. UI Status Display
Reports page polls for job status:
```typescript
- On load: Fetch job status for all orders
- Every 5 seconds: Poll if active jobs exist
- Display badge based on job status
- Show progress percentage and stage
- Allow manual retry for failed jobs
```

## Database Schema

### pdf_generation_queue
```sql
id                UUID PRIMARY KEY
order_id          UUID UNIQUE (one job per order)
lab_id            UUID
status            TEXT (pending|processing|completed|failed)
priority          INTEGER (for future use)
created_at        TIMESTAMPTZ
started_at        TIMESTAMPTZ
completed_at      TIMESTAMPTZ
progress_stage    TEXT (human-readable stage description)
progress_percent  INTEGER (0-100)
error_message     TEXT
retry_count       INTEGER (current retry attempt)
max_retries       INTEGER (default 3)
processing_by     TEXT (worker instance identifier)
```

### orders (new columns)
```sql
report_generation_status  TEXT (not_started|queued|processing|completed|failed)
report_auto_generated_at  TIMESTAMPTZ
```

## Status Flow

```
not_started → queued → processing → completed
                          ↓
                        failed → queued (if retry < max)
                          ↓
                        failed (if retry >= max)
```

## Configuration

### Netlify Function Schedule
Edit `netlify.toml`:
```toml
[[functions]]
  schedule = "*/30 * * * *"  # Every 30 seconds (runs every 1 minute min)
  name = "pdf-worker"
```

### Retry Settings
Edit migration file:
```sql
max_retries INTEGER DEFAULT 3  -- Maximum retry attempts
```

### Polling Interval
Edit `Reports.tsx`:
```typescript
const interval = setInterval(() => {
  pollPDFQueueStatus(orderIds);
}, 5000); // Poll every 5 seconds
```

## Manual Operations

### Retry Failed Job
```typescript
await database.pdfQueue.retryJob(jobId);
```

### View Queue Status
```typescript
const { data: jobs } = await database.pdfQueue.getQueueStatus();
```

### View Statistics
```typescript
const { data: stats } = await database.pdfQueue.getStatistics();
// { pending: 5, processing: 2, completed: 100, failed: 3, total: 110 }
```

## Deployment Steps

1. **Run Migration**
   ```bash
   # Apply the migration to your Supabase database
   psql -h your-db-host -U postgres -d your-db -f db/migrations/20251209000001_pdf_automation_queue.sql
   ```

2. **Deploy to Netlify**
   ```bash
   npm run deploy:prod
   ```

3. **Verify Worker**
   - Check Netlify Functions dashboard
   - Look for `pdf-worker` scheduled function
   - Check execution logs

4. **Test Flow**
   - Approve all results for an order
   - Check job appears in queue: `SELECT * FROM pdf_generation_queue;`
   - Wait for worker to process (1 minute max)
   - Verify PDF generated and status updated

## Monitoring

### Database Queries

**View Active Jobs:**
```sql
SELECT * FROM pdf_generation_queue 
WHERE status IN ('pending', 'processing')
ORDER BY created_at;
```

**View Failed Jobs:**
```sql
SELECT order_id, error_message, retry_count 
FROM pdf_generation_queue 
WHERE status = 'failed';
```

**View Statistics:**
```sql
SELECT status, COUNT(*) 
FROM pdf_generation_queue 
GROUP BY status;
```

### Netlify Logs
```bash
# View worker logs
netlify functions:logs pdf-worker
```

## Troubleshooting

### Job Stuck in Processing
```sql
-- Reset stuck job
UPDATE pdf_generation_queue 
SET status = 'pending', processing_by = NULL 
WHERE id = 'job-id' AND status = 'processing';
```

### Manual Job Creation
```sql
-- Create job manually
INSERT INTO pdf_generation_queue (order_id, lab_id, status)
VALUES ('order-id', 'lab-id', 'pending');
```

### Retry All Failed Jobs
```sql
-- Retry all failed jobs
UPDATE pdf_generation_queue 
SET status = 'pending', retry_count = 0, error_message = NULL 
WHERE status = 'failed';
```

## Limitations

- **Current Implementation:**
  - Single worker (sequential processing)
  - PDF.co API only (no Puppeteer support)
  - No AI clinical summary pre-generation
  - Netlify minimum schedule is 1 minute (not 30 seconds)

- **Future Enhancements:**
  - Parallel worker processing
  - Puppeteer integration for faster generation
  - AI summary pre-generation
  - Priority queue based on order type/urgency
  - Real-time WebSocket updates (replace polling)
  - Admin dashboard for queue management

## Security

- **RLS Policies:** Users can only view jobs from their lab
- **Row Locking:** `FOR UPDATE SKIP LOCKED` prevents race conditions
- **Worker Authentication:** Uses service role key (server-side only)
- **Job Isolation:** One job per order (UNIQUE constraint)

## Performance

- **Expected Load:** 1-10 PDFs per minute per lab
- **Generation Time:** 8-17 seconds per PDF (PDF.co)
- **Queue Capacity:** Unlimited (database-backed)
- **Retry Delay:** Immediate (worker picks up on next cycle)

## Support

For issues or questions:
1. Check Netlify function logs
2. Query `pdf_generation_queue` table
3. Review `orders.report_generation_status` column
4. Check Reports page UI for error messages
