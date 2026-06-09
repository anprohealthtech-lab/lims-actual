# LIMS Print Bridge Implementation Plan

## Goal

Replace QZ Tray printing with our existing LIMS Bridge Utility pattern:

```text
Web LIMS -> Supabase/Edge queue -> Desktop Utility polls -> Local printer -> ACK back to LIMS
```

This keeps printing inside our own infrastructure, avoids QZ licensing/certificate complexity, and gives us queue status, retry, audit logs, and multi-location/device control.

## Current State

The LIMS already has printer settings at lab and location level:

- `barcode_printer_name`
- `report_printer_name`
- `auto_print_barcode_on_order`
- `auto_print_report_on_approval`

The current QZ Tray integration does:

- Sample barcode labels: browser generates raw ZPL and sends it to QZ.
- Reports: browser fetches PDF and sends PDF bytes to QZ.
- Thermal invoice: currently uses browser `window.print()`.

The Bridge Utility already has a cloud polling model for analyzer integration:

- Endpoint URL configured in utility.
- `x-lab-api-key` used for authentication.
- Utility polls Edge Function for pending work.
- Utility posts ACK/failure after local hardware action.

Printers should use the same model.

## Recommended Architecture

Use a new print queue, separate from analyzer queues.

```text
1. User action or automation creates print job.
2. Web LIMS calls Edge Function or inserts print job.
3. Print job waits in Supabase.
4. Utility polls `print-bridge/pending` every 2 seconds.
5. Edge Function claims jobs for that utility/device.
6. Utility prints locally.
7. Utility ACKs success/failure.
8. LIMS displays print status and history.
```

This is simpler and more scalable for our product than browser-to-QZ because the Bridge Utility already exists and because printing can be triggered from any web/mobile session while the actual printer PC handles the job.

## Database Plan

### Phase 1 Minimum

Create `print_jobs`.

Suggested columns:

```sql
id uuid primary key default gen_random_uuid(),
lab_id uuid not null references labs(id),
location_id uuid references locations(id),
print_device_id uuid,
printer_role text not null, -- barcode_label, report, invoice_thermal
job_type text not null, -- raw_zpl, pdf_url, pdf_base64, html
status text not null default 'pending', -- pending, claimed, printing, completed, failed, cancelled
priority integer not null default 5,
payload jsonb not null default '{}'::jsonb,
copies integer not null default 1,
requested_by uuid references users(id),
order_id uuid references orders(id),
sample_id uuid references samples(id),
report_id uuid references reports(id),
invoice_id uuid references invoices(id),
idempotency_key text,
claimed_by_device_id uuid,
claimed_at timestamptz,
started_at timestamptz,
completed_at timestamptz,
failed_at timestamptz,
attempt_count integer not null default 0,
last_error text,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
```

Recommended indexes:

```sql
create index idx_print_jobs_pending
  on print_jobs(lab_id, location_id, status, priority, created_at);

create index idx_print_jobs_related_order
  on print_jobs(order_id);

create unique index idx_print_jobs_idempotency
  on print_jobs(lab_id, idempotency_key)
  where idempotency_key is not null;
```

### Phase 2 Device/Printer Management

Create `print_devices`.

```sql
id uuid primary key default gen_random_uuid(),
lab_id uuid not null references labs(id),
location_id uuid references locations(id),
device_name text not null,
machine_id text,
utility_version text,
status text not null default 'offline',
last_seen_at timestamptz,
metadata jsonb not null default '{}'::jsonb,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
```

Create `printer_profiles`.

```sql
id uuid primary key default gen_random_uuid(),
lab_id uuid not null references labs(id),
location_id uuid references locations(id),
print_device_id uuid references print_devices(id),
printer_role text not null, -- barcode_label, report, invoice_thermal
printer_name text not null,
printer_type text not null, -- zpl, pdf, html, escpos
width_mm integer,
is_default boolean not null default false,
is_active boolean not null default true,
metadata jsonb not null default '{}'::jsonb,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
```

Create `print_job_events`.

```sql
id uuid primary key default gen_random_uuid(),
print_job_id uuid not null references print_jobs(id) on delete cascade,
event_type text not null,
message text,
metadata jsonb not null default '{}'::jsonb,
created_at timestamptz not null default now()
```

## Edge Function Plan

Create:

```text
supabase/functions/print-bridge/index.ts
```

Use the same auth style as `analyzer-ingest`:

```http
x-lab-api-key: <lab api key>
```

Recommended API key scopes:

- `analyzer:read`
- `analyzer:write`
- `print:read`
- `print:write`

If we do not add scopes immediately, reuse current active lab API key validation first and add scopes later.

### Routes

```http
POST /print-bridge/register-device
```

Registers or updates the utility PC.

Request:

```json
{
  "device_name": "Reception PC",
  "machine_id": "stable-local-machine-id",
  "location_id": "optional-location-uuid",
  "utility_version": "1.0.0"
}
```

Response:

```json
{
  "success": true,
  "device_id": "uuid"
}
```

```http
POST /print-bridge/heartbeat
```

Updates `last_seen_at`.

```http
POST /print-bridge/sync-printers
```

Utility sends installed printers.

Request:

```json
{
  "device_id": "uuid",
  "printers": [
    {
      "name": "Zebra ZD421",
      "default": false,
      "online": true,
      "driver": "ZDesigner"
    }
  ]
}
```

Store this in `print_devices.metadata.available_printers` or a future `print_device_printers` table.

```http
GET /print-bridge/pending?device_id=<uuid>&limit=10
```

Returns jobs this utility should print.

Claiming rule:

- Match same `lab_id`.
- Match `print_device_id` if job is device-specific.
- Else match active device for same `location_id`.
- Filter `status = pending`.
- Order by `priority asc, created_at asc`.
- Atomically update selected rows to `claimed`.
- Return claimed rows.

Response:

```json
{
  "jobs": [
    {
      "id": "uuid",
      "printer_role": "barcode_label",
      "job_type": "raw_zpl",
      "copies": 1,
      "payload": {
        "zpl": "^XA..."
      }
    }
  ],
  "count": 1
}
```

```http
POST /print-bridge/ack
```

Utility reports result.

Success:

```json
{
  "device_id": "uuid",
  "job_id": "uuid",
  "success": true,
  "printer_name": "Zebra ZD421"
}
```

Failure:

```json
{
  "device_id": "uuid",
  "job_id": "uuid",
  "success": false,
  "error": "Printer offline"
}
```

## Payload Types

### Barcode Label

Use raw ZPL because it is small and reliable.

```json
{
  "zpl": "^XA...",
  "sample_id": "S-1001",
  "sample_barcode": "2601170001",
  "patient_name": "Patient Name",
  "sample_type": "Serum"
}
```

### Report PDF

Prefer `pdf_url` over `pdf_base64`.

```json
{
  "pdf_url": "signed-download-url",
  "paper": "A4",
  "fit_to_page": true
}
```

Do not store large PDF base64 in DB except for small tests/debug jobs.

### Thermal Invoice

Start with HTML payload.

```json
{
  "html": "<!doctype html>...",
  "width_mm": 80
}
```

Later we can generate a PDF/receipt server-side and send a URL.

## LIMS Web App Changes

### Replace QZ Service Boundary

Current files:

- `src/utils/qzTrayService.ts`
- `src/contexts/QZTrayContext.tsx`
- usages in sample label, dashboard/report print, settings

Create a new utility-facing service:

```text
src/utils/printBridgeService.ts
```

High-level methods:

```ts
enqueueBarcodeLabelPrint(data)
enqueueReportPrint(pdfUrl, context)
enqueueThermalInvoicePrint(htmlOrInvoiceId, context)
getPrintJobStatus(jobId)
```

Keep existing UI workflows intact:

- order creation -> enqueue barcode label job
- manual sample label print -> enqueue barcode label job
- report approval/manual report print -> enqueue report job
- invoice thermal print -> enqueue thermal invoice job

### Replace Settings Wording

Replace "Auto-Print via QZ Tray" with "Auto-Print via LIMS Utility".

Show:

- Utility connection status from `print_devices.last_seen_at`
- Assigned print device
- Printer role mappings
- Last synced printer list
- Test print buttons

Existing printer columns can remain during Phase 1. In Phase 2, prefer `printer_profiles` and keep old columns as fallback/backward compatibility.

## Bridge Utility Requirements

Give this section to the Codex agent working on the Bridge Utility.

### Handoff Prompt

```text
Extend the existing LIMS Bridge Utility with a Print Bridge module.

We are replacing QZ Tray with our own queue-based local printing flow.

The utility already has cloud settings:
- Endpoint URL
- API key sent as x-lab-api-key
- polling behavior for analyzer jobs

Add a printer section with:
- Print Bridge Endpoint URL: https://api.limsapp.in/functions/v1/print-bridge
- API key: same x-lab-api-key
- Device name
- Optional location selection/config
- Poll interval, default 2 seconds
- Sync installed Windows printers
- Map printer roles:
  - barcode_label
  - report
  - invoice_thermal
- Buttons:
  - Test endpoint
  - Register device
  - Sync printers
  - Test label print
  - Test report print
  - Save settings

Implement these API calls:

POST /register-device
POST /heartbeat
POST /sync-printers
GET /pending?device_id=<uuid>&limit=10
POST /ack

The utility should poll pending jobs every 2 seconds when online.

Supported job types:

1. raw_zpl
   - Print payload.zpl directly to selected label printer.
   - Used for sample barcode labels.

2. pdf_url
   - Download PDF from payload.pdf_url.
   - Print silently to selected report printer.
   - Used for reports.

3. pdf_base64
   - Print base64 PDF.
   - Mainly for test jobs or small documents.

4. html
   - Render HTML and print silently to thermal printer.
   - Used for 58mm/80mm invoice receipts.
   - Prefer WebView2/Chromium render-to-PDF if native HTML printing is unreliable.

Job lifecycle:

1. Utility polls pending jobs.
2. Utility receives claimed jobs.
3. Utility sets local status to printing.
4. Utility prints.
5. Utility POSTs /ack with success true/false.
6. Utility logs all jobs locally.

Important:

- Do not use QZ Tray.
- Do not require browser-to-localhost.
- Make printing silent where supported.
- Keep local logs visible in utility UI.
- Never print the same job twice after ACK success.
- If utility crashes after claiming, the cloud should reset stale jobs later.
- Support multiple printers on the same utility PC.
- Support one utility PC per location, and later multiple utility PCs per location.
```

## Implementation Phases

### Phase 1: Working Print Queue

LIMS:

- Add `print_jobs` migration.
- Add `print-bridge` Edge Function with API key validation.
- Add create-job route or direct web service for enqueue.
- Add ZPL barcode enqueue.
- Add PDF URL report enqueue.

Utility:

- Configure print endpoint/API key.
- Poll pending jobs.
- Print raw ZPL.
- Print PDF URL.
- ACK success/failure.

### Phase 2: Device And Printer Profiles

LIMS:

- Add `print_devices`.
- Add `printer_profiles`.
- Add printer/device settings UI.
- Show last seen device status.
- Add synced printer dropdowns.
- Add test print actions.

Utility:

- Register device.
- Heartbeat.
- Sync printer list.
- Role-to-printer mapping support.

### Phase 3: Receipts, Audit, Retry

LIMS:

- Add `print_job_events`.
- Add thermal invoice job type.
- Add queue monitor.
- Add reprint button.
- Add stuck job cleanup.

Utility:

- Print HTML receipts.
- Show local job history.
- Better error messages for offline printer, missing printer, bad PDF, and failed rendering.

## Stuck Job Handling

Add cleanup logic:

```text
If status = claimed or printing and claimed_at/started_at older than 5 minutes:
  if attempt_count < max attempts:
    reset to pending
  else:
    mark failed
```

This can be a scheduled Edge Function or admin action first.

## Final Recommendation

Build the print bridge using queue polling through Edge Functions. It matches the analyzer interface model, avoids QZ cost, and gives a better operational system for labs: retry, audit, multi-location support, and hardware independence.

