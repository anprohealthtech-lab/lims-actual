# Bi-Directional AI Machine Interface Architecture

## Overview

A quick, resilient, AI-powered interface connecting LIMS to laboratory analyzers with intelligent code mapping, automatic learning, and comprehensive audit trails.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        LIMS v2 - AI Machine Interface                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐     OUTBOUND (Orders)      ┌─────────────────────────┐   │
│  │   LIMS      │ ─────────────────────────► │  dispatch-order-to-     │   │
│  │   Orders    │                            │  analyzer               │   │
│  │   Queue     │  1. Check mapping cache    │  (Edge Function)        │   │
│  └─────────────┘  2. AI maps unknown codes  └───────────┬─────────────┘   │
│        │         3. Generate HL7/ASTM                   │                  │
│        │         4. Queue for transmission              │                  │
│        │                                                ▼                  │
│        │                                    ┌─────────────────────────┐   │
│        │                                    │  analyzer_order_queue   │   │
│        │                                    │  (Status: pending →     │   │
│        │                                    │   mapped → sent → ack)  │   │
│        │                                    └───────────┬─────────────┘   │
│        │                                                │                  │
│        │         ┌──────────────────────────────────────┼──────────────┐  │
│        │         │           BRIDGE UTILITY              │              │  │
│        │         │  (Local Windows Service / Docker)    │              │  │
│        │         │                                      │              │  │
│        │         │  • Polls order queue                 │              │  │
│        │         │  • Manages TCP/Serial connections    ▼              │  │
│        │         │  • Sends HL7 to analyzer     ┌──────────────┐      │  │
│        │         │  • Receives results          │   ANALYZER   │      │  │
│        │         │  • Posts to raw_messages     │  (Physical)  │      │  │
│        │         │                              └──────┬───────┘      │  │
│        │         │                                     │              │  │
│        │         └─────────────────────────────────────┼──────────────┘  │
│        │                                               │                  │
│        │                                               ▼                  │
│        │         INBOUND (Results)          ┌─────────────────────────┐   │
│        │                                    │  analyzer_raw_messages  │   │
│        │  ◄──────────────────────────────── │  (Webhook trigger)      │   │
│        │         1. Parse message type      └───────────┬─────────────┘   │
│        ▼         2. Handle ACK/NAK                      │                  │
│  ┌─────────────┐ 3. AI extracts results                 ▼                  │
│  │   Results   │ 4. Match to order/sample   ┌─────────────────────────┐   │
│  │   Storage   │ 5. Store result_values     │  receive-analyzer-      │   │
│  └─────────────┘                            │  result (Edge Function) │   │
│                                             └─────────────────────────┘   │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                            AI LEARNING LAYER                                │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  test_mappings (Persistent Cache)                                    │   │
│  │  • LIMS code ↔ Analyzer code translations                           │   │
│  │  • Confidence scores from AI                                        │   │
│  │  • Usage counts (auto-verify after N uses)                          │   │
│  │  • Human verification flag                                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  analyzer_knowledge (RAG Memory)                                     │   │
│  │  • Protocol documentation embeddings                                │   │
│  │  • Successful parsing patterns                                      │   │
│  │  • Error corrections                                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Database Schema

### Core Tables

| Table | Purpose |
|-------|---------|
| `analyzer_profiles` | Analyzer type configurations (Sysmex, Beckman, etc.) |
| `analyzer_connections` | Physical machine connections per lab |
| `test_mappings` | AI-learned LIMS ↔ Analyzer code translations |
| `analyzer_order_queue` | Outbound orders waiting for analyzer |
| `analyzer_raw_messages` | Inbound raw HL7/ASTM data lake |
| `analyzer_knowledge` | RAG memory with embeddings for AI |
| `ai_mapping_cache` | Fast cache for AI decisions |
| `analyzer_comm_log` | Audit trail for all communications |

### Key Views

| View | Purpose |
|------|---------|
| `v_analyzer_status` | Dashboard: connection status + pending counts |
| `v_order_queue_summary` | Queue metrics by status |

## Edge Functions

### `dispatch-order-to-analyzer`
**Purpose**: Send orders to analyzers with AI-powered code mapping

**Flow**:
1. Receive order with LIMS test codes
2. Check `test_mappings` cache for known translations
3. Call Gemini AI to map unknown codes
4. Save new mappings for future use
5. Generate HL7 ORM^O01 message
6. Queue for Bridge utility to transmit

**Endpoint**: `POST /functions/v1/dispatch-order-to-analyzer`
```json
{
  "order_id": "uuid",
  "sample_barcode": "31-Jan-2026-001",
  "analyzer_connection_id": "uuid",
  "tests": ["CBC", "WBC", "HGB"],
  "patient": {
    "name": "John Doe",
    "dob": "1990-01-15",
    "gender": "M"
  },
  "priority": 5
}
```

### `receive-analyzer-result`
**Purpose**: Process incoming analyzer data with AI parsing

**Flow**:
1. Webhook triggered on `analyzer_raw_messages` insert
2. Parse message type (ORU, ACK, NAK)
3. Handle ACK/NAK → Update order queue status
4. Handle ORU → AI extracts results
5. Match to order via barcode
6. AI maps analyzer codes to analytes
7. Store in `result_values`

**Trigger**: Database webhook on `analyzer_raw_messages` INSERT

## AI Intelligence Features

### 1. Intelligent Code Mapping
- **First call**: AI analyzes analyzer profile + existing mappings
- **Subsequent calls**: Instant cache lookup (no AI needed)
- **Auto-verification**: Codes used 5+ times marked as verified
- **Confidence scoring**: 1.0 = exact match, 0.7+ = inferred

### 2. Self-Learning
```sql
-- Mapping improves with each use
UPDATE test_mappings 
SET usage_count = usage_count + 1,
    ai_confidence = GREATEST(ai_confidence, NEW_confidence)
WHERE lims_code = 'WBC';
```

### 3. RAG Knowledge Base
```sql
-- Store successful parsing patterns
INSERT INTO analyzer_knowledge (lab_id, knowledge_type, content, embedding)
VALUES (
  'lab-uuid',
  'mapping',
  'Sysmex XN-1000: WBC-X maps to White Blood Cell Count',
  embedding_vector
);
```

## Resilience Features

### 1. Queue-Based Architecture
- Orders queued before sending
- Retries with exponential backoff
- Max retry limits prevent infinite loops

### 2. ACK Tracking
- Every order gets unique `message_control_id`
- ACK/NAK correlated to original order
- Automatic status updates

### 3. Error Handling
```sql
-- Retry logic
UPDATE analyzer_order_queue
SET 
  retry_count = retry_count + 1,
  next_retry_at = now() + (retry_count * interval '1 minute'),
  last_error = 'Connection timeout'
WHERE id = 'queue-uuid' AND retry_count < max_retries;
```

### 4. Audit Trail
- Every message logged in `analyzer_comm_log`
- Raw data preserved in `analyzer_raw_messages`
- Processing time tracked for performance monitoring

## Bridge Utility Integration

The Bridge utility (provided separately) handles physical communication:

```
┌────────────────────────────────────────────────┐
│  LIMS Bridge (Windows Service / Docker)        │
│                                                │
│  • Polls: analyzer_order_queue (status=mapped) │
│  • Sends: HL7 via TCP/Serial to analyzer       │
│  • Listens: TCP port for incoming results      │
│  • Posts: Raw data to analyzer_raw_messages    │
│                                                │
│  Config in: analyzer_connections.config        │
└────────────────────────────────────────────────┘
```

## Quick Start

### 1. Apply Migration
```bash
supabase db push
```

### 2. Deploy Edge Functions
```bash
supabase functions deploy dispatch-order-to-analyzer
supabase functions deploy receive-analyzer-result
```

### 3. Configure Webhooks
In Supabase Dashboard → Database → Webhooks:
- Table: `analyzer_raw_messages`
- Events: `INSERT`
- URL: `https://your-project.supabase.co/functions/v1/receive-analyzer-result`

### 4. Add Analyzer Profile
```sql
INSERT INTO analyzer_connections (lab_id, name, profile_id, connection_type, config)
VALUES (
  'your-lab-uuid',
  'Main Hematology Analyzer',
  'sysmex-xn1000',
  'tcp',
  '{"host": "192.168.1.100", "port": 5000}'
);
```

### 5. Install Bridge Utility
Download and configure the Bridge utility to connect LIMS to your physical analyzer.

## Performance Targets

| Metric | Target |
|--------|--------|
| Cache hit rate | >90% after warmup |
| AI mapping time | <2 seconds |
| Result processing | <5 seconds |
| Queue-to-send | <10 seconds |
| End-to-end order | <30 seconds |

## Security

- **RLS**: All tables lab-scoped
- **Service Role**: Edge functions use service key (never exposed)
- **Audit**: Complete communication log
- **No PHI in logs**: Only barcode + test codes logged
