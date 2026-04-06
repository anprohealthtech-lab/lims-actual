# Analyzer Interface — Implementation Plan
_Created: 2026-04-03_

## Context
Two-way instrument interface is fully wired at the backend (Bridge → analyzer-ingest → dispatch-order-to-analyzer → HL7 → analyzer → receive-analyzer-result → process-analyzer-result → result_values). The frontend setup UX and lab-level configuration layer are missing.

---

## Status

### Done ✅
- `AnalyzerConnectionsManager` component — create/list/edit/delete analyzer connections
- `Settings.tsx` — "Analyzer Interface" tab hidden until `labs.lab_interface_enabled = true`
- `process-analyzer-result` — enrichment now tries `order_test_groups` then `order_tests` fallback; blanket fallback if analyte not in test_group_analytes
- `process-analyzer-result` — backfills `results.test_group_id` after AI mapping so verification console can see results
- `process-analyzer-result` — `order_test_group_id` stays null when order uses `order_tests` (FK safety)
- Migration `20260403_fix_panel_status_analyzer_results.sql` — view no longer filters out null test_group_id results

### Pending 🔲

---

## Phase 1 — Lab-Level Interface Settings UI

### 1A. Analyzer Connection → Test Group Linking
**What:** Dropdown in TestGroupForm to assign `analyzer_connection_id`
**Files:** `src/components/Tests/TestGroupForm.tsx`, `src/pages/Tests.tsx`
**Details:**
- Add `analyzer_connection_id` to TestGroup interface
- Fetch `analyzer_connections` for the lab in the form
- Pass field through `handleSubmit` → DB update

### 1B. Lab Interface Settings Panel
**What:** New section in the Analyzer Interface tab for lab-level config
**Fields needed:**
- `result_multiplication_factors` — per-analyte or per-unit multiplier (e.g. instrument sends mg/dL, lab wants mmol/L)
- `unit_conversion_rules` — JSONB map of unit conversions
- `auto_verify_threshold` — confidence % above which AI results auto-approve
- `flag_override_rules` — custom flag logic per analyte
**Table:** Add columns to `labs` or create new `lab_interface_settings` table
**Migration needed:** Yes

---

## Phase 2 — Test Code Mapping Cache / Knowledge UI

### 2A. Test Mapping Review Screen
**What:** UI to review AI-generated test_mappings, approve/reject, set confidence thresholds
**Table:** `test_mappings` (already exists with `ai_confidence`, `verified`, `verified_by`, `verified_at`, `usage_count`)
**Location:** New tab or sub-section inside Analyzer Interface settings
**Features:**
- List all mappings for the lab with confidence score
- Mark as verified / reject
- Edit analyzer_code ↔ lims_code manually
- Filter: unverified, low confidence (<0.7), high usage

### 2B. AI Mapping Cache Warm-up
**What:** "Re-map" button that triggers mapping for all test groups linked to an analyzer
**Endpoint:** Call `dispatch-order-to-analyzer` in dry-run mode to pre-populate `test_mappings`
**Reduces:** AI calls to near-zero after first real order per test group

### 2C. Analyzer Knowledge Base UI
**What:** View/edit `analyzer_knowledge` table entries
**Table:** `analyzer_knowledge` (knowledge_type, content, confidence_score, embedding)
**Features:**
- Add custom parsing hints per analyzer profile
- Record known quirks (e.g. "this analyzer sends WBC as WBC3" )

---

## Phase 3 — Queue Monitor

### 3A. Order Queue Status Panel
**What:** Live view of `analyzer_order_queue` inside Analyzer Interface tab
**Columns to show:** order #, patient, tests, status, sent_at, retry_count, error
**Actions:** Manual retry (reset status to 'mapped'), cancel
**Realtime:** Subscribe to `analyzer_order_queue` changes

### 3B. Stuck Order Detection
**What:** Flag orders stuck in 'sending' for > 5 minutes (sending_started_at exists but unused)
**Options:**
- Scheduled edge function (cron) to reset stuck orders
- Or surface them in Queue Monitor with a "Reset" button

### 3C. Inbound Message Log
**What:** View `analyzer_comm_log` + `analyzer_raw_messages` in the UI
**Filter by:** direction (SEND/RECEIVE), success/failure, date range
**Detail view:** Raw HL7 message, parsed result, processing time

---

## Phase 4 — Multiplication Factor & Unit Conversion

### 4A. Database ✅ Migration created: 20260403_lab_analyte_interface_config.sql
```sql
CREATE TABLE lab_analyte_interface_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id          UUID NOT NULL REFERENCES labs(id),
  lab_analyte_id  UUID NOT NULL REFERENCES lab_analytes(id),  -- lab_analytes is source of truth
  instrument_unit TEXT,
  lims_unit       TEXT,
  multiply_by     NUMERIC NOT NULL DEFAULT 1.0,
  add_offset      NUMERIC NOT NULL DEFAULT 0,
  auto_verify     BOOLEAN NOT NULL DEFAULT false,
  notes           TEXT,
  UNIQUE (lab_id, lab_analyte_id)
);
```

### 4B. UI
- Per-analyte config table in Analyzer Interface settings
- Columns: Analyte, Instrument Unit, LIMS Unit, Multiply By, Offset, Auto-Verify
- Applied in `process-analyzer-result` after parsing, before inserting result_values

### 4C. Edge Function
- After AI parse, before insert: apply `multiply_by` and `add_offset` if config exists
- If `auto_verify = true` and `ai_confidence >= min_auto_verify_confidence`: set `verify_status = 'approved'`

---

## Known Issues to Track

| # | Issue | Status |
|---|---|---|
| 1 | Message control ID uses `Date.now()` — collision risk | Open |
| 2 | Bridge uses service role key instead of lab API key | Open |
| 3 | No stuck order cleanup job | Open |
| 4 | ASTM-only analyzers receive HL7 (Roche Cobas, Bio-Rad D-10) | Open |
| 5 | Barcode generation race condition (same as old invoice number issue) | Open |
| 6 | Webhook for auto-dispatch must be manually set up in Supabase Dashboard | Open |

---

## Build Order (Recommended)
1. **1A** — Test group → analyzer link (unlocks dispatch for real orders)
2. **1B** — Lab interface settings (multiplication factor, auto-verify)
3. **4A/4B/4C** — Unit conversion applied in edge function
4. **2A** — Test mapping review (reduces AI cost)
5. **3A/3B** — Queue monitor + stuck order detection
6. Fix issue #1 (message control ID)
7. Fix issue #3 (stuck order cron)
