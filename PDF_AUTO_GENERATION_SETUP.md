# PDF Auto-Generation System - Setup Guide

## Overview

The PDF auto-generation system automatically creates PDF reports when all results for an order are verified. The entire PDF generation process happens **server-side** via Supabase Edge Functions and PDF.co API.

## Architecture Flow

```
1. Result Verified (UI/API)
   ↓
2. Database Trigger Fires (AFTER UPDATE ON results)
   ↓
3. Queue Entry Created (pdf_generation_queue table)
   ↓
4. Client Polls & Triggers Edge Function (auto in Reports page)
   ↓
5. Edge Function (generate-pdf-auto) handles everything:
   - Fetches template context via RPC
   - Fetches lab template (gjs_html)
   - Fetches lab settings (header/footer, PDF settings)
   - Fetches report extras (trends, clinical summary)
   - Fetches attachments
   - Renders HTML with placeholders
   - Calls PDF.co API directly
   - Uploads PDF to Supabase Storage
   - Updates reports table and queue status
   ↓
6. Client receives PDF URL
```

## Setup Steps

### 1. Apply Database Migration

Run the migration to create the queue table, triggers, and functions:

```sql
-- Apply: db/migrations/20251209000001_pdf_automation_queue.sql
```

This creates:
- `pdf_generation_queue` table
- `queue_pdf_generation()` trigger function
- `get_next_pdf_job()` function
- `complete_pdf_job()` function
- `fail_pdf_job()` function
- Trigger on `results` table (fires when `verification_status = 'verified'`)

### 2. Set Up Edge Function Secrets

**CRITICAL**: You must set the `PDFCO_API_KEY` secret for the edge function:

```bash
# Using Supabase CLI
supabase secrets set PDFCO_API_KEY="your-pdf-co-api-key-here"

# Or via Supabase Dashboard:
# Project Settings → Edge Functions → Secrets
# Add: PDFCO_API_KEY = your-api-key
```

Required secrets:
| Secret Name | Description |
|-------------|-------------|
| `PDFCO_API_KEY` | Your PDF.co API key |
| `SUPABASE_URL` | Auto-provided by Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-provided by Supabase |

### 3. Deploy Edge Function

```bash
# From project root
supabase functions deploy generate-pdf-auto
```

### 4. Verify Database RPC

Ensure the `get_report_template_context` RPC function exists and works:

```sql
SELECT * FROM get_report_template_context('your-order-uuid-here'::uuid);
```

### 5. Test the Flow

1. Go to an order with pending results
2. Verify all results for the order
3. Monitor the `pdf_generation_queue` table:
   ```sql
   SELECT * FROM pdf_generation_queue ORDER BY created_at DESC LIMIT 5;
   ```
4. Check the edge function logs in Supabase Dashboard
5. Verify PDF appears in `reports` table and Supabase Storage

## Configuration

### Lab PDF Settings

PDF layout can be customized per lab via the `pdf_layout_settings` JSONB column in the `labs` table:

```json
{
  "margins": {
    "top": 180,
    "right": 20,
    "bottom": 150,
    "left": 20
  },
  "headerHeight": 90,
  "footerHeight": 80,
  "scale": 1.0,
  "displayHeaderFooter": true,
  "paperSize": "A4",
  "mediaType": "screen",
  "printBackground": true
}
```

### Lab Header/Footer

HTML for headers and footers is stored in:
- `labs.default_report_header_html`
- `labs.default_report_footer_html`

Images in headers/footers are automatically converted to base64 for PDF.co compatibility.

## Troubleshooting

### Job Stuck in "pending"

1. Check if the trigger fired:
   ```sql
   SELECT trigger_name, event_manipulation 
   FROM information_schema.triggers 
   WHERE trigger_schema = 'public' AND event_object_table = 'results';
   ```

2. Manually trigger for an order:
   ```sql
   SELECT queue_pdf_generation('your-order-uuid');
   ```

### Job Stuck in "processing"

1. Check edge function logs in Supabase Dashboard
2. Reset the job:
   ```sql
   UPDATE pdf_generation_queue 
   SET status = 'pending', retry_count = 0, error_message = NULL 
   WHERE order_id = 'your-order-uuid';
   ```

### PDF.co API Errors

1. Verify API key is set correctly
2. Check PDF.co dashboard for rate limits
3. Check edge function logs for specific error messages

### Missing Context Data

1. Test the RPC directly:
   ```sql
   SELECT * FROM get_report_template_context('your-order-uuid'::uuid);
   ```
2. Ensure order has:
   - Associated patient
   - Lab ID
   - At least one verified result

### Storage Upload Fails

1. Check Supabase Storage policies for `attachments` bucket
2. Ensure bucket allows uploads via service role key
3. Verify path structure: `reports/{lab_id}/{patient_id}/{order_id}/`

## API Reference

### Client-Side Trigger

```typescript
import { database } from '@/utils/supabase';

// Trigger PDF generation
const { data, error } = await database.pdfQueue.triggerGeneration(
  orderId,
  (stage, percent) => console.log(`${stage}: ${percent}%`)
);

if (data?.success) {
  console.log('PDF URL:', data.pdfUrl);
}
```

### Queue Status Check

```typescript
const { data: status } = await database.pdfQueue.getQueueStatus(orderId);
// status: { status: 'pending'|'processing'|'completed'|'failed', progress_percent, ... }
```

## Files Reference

| File | Purpose |
|------|---------|
| `db/migrations/20251209000001_pdf_automation_queue.sql` | Database migration |
| `supabase/functions/generate-pdf-auto/index.ts` | Edge function |
| `src/utils/supabase.ts` → `pdfQueue` namespace | Client API |
| `src/pages/Reports.tsx` | Auto-trigger UI |
