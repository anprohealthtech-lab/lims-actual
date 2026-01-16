# Machine Interface with AI-Powered Parsing & Mapping - Complete Implementation Plan

**Version:** 1.0  
**Date:** January 16, 2026  
**Status:** Planning Phase

---

## Executive Summary

This document outlines a **complete bidirectional machine interface system** for laboratory analyzers using industry-standard protocols (HL7/ASTM/LIS2-A2) with an **AI-powered intelligent layer** for automatic result parsing, analyte mapping, and error recovery.

### Key Features
✅ **Industry Standard Protocols**: HL7 v2.x, ASTM E1394, LIS2-A2  
✅ **Bidirectional Communication**: Order download + Result upload  
✅ **AI-Powered Parsing**: Gemini 2.5 Flash for intelligent result extraction  
✅ **Self-Learning Mapping**: Automatic analyte name resolution with memory  
✅ **Error Recovery**: AI-assisted troubleshooting and correction  
✅ **Multi-Analyzer Support**: Sysmex, Beckman Coulter, Roche, Abbott, etc.  
✅ **Real-time Monitoring**: Live connection status and message tracking  

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Communication Protocols](#communication-protocols)
3. [Database Schema](#database-schema)
4. [AI Layer Design](#ai-layer-design)
5. [Message Flow](#message-flow)
6. [Implementation Phases](#implementation-phases)
7. [Error Handling](#error-handling)
8. [Security & Compliance](#security--compliance)
9. [Testing Strategy](#testing-strategy)
10. [Deployment Guide](#deployment-guide)

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Laboratory Analyzers                          │
│  (Sysmex, Beckman Coulter, Roche, Abbott, etc.)                │
└────────────┬────────────────────────────────────────────────────┘
             │ RS-232 / Ethernet / USB
             │
┌────────────▼────────────────────────────────────────────────────┐
│              Machine Interface Gateway (Node.js)                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Protocol Handlers (HL7/ASTM/LIS2-A2)                    │  │
│  │  - Message Parser                                         │  │
│  │  - Protocol Validator                                     │  │
│  │  │  - Connection Manager                                   │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────┬────────────────────────────────────────────────────┘
             │ HTTP/WebSocket
             │
┌────────────▼────────────────────────────────────────────────────┐
│           Supabase Edge Function: process-analyzer-result        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  AI Processing Layer (Gemini 2.5 Flash)                   │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │ 1. Raw Message Parser                              │  │  │
│  │  │ 2. Analyte Name Mapper (with learning)             │  │  │
│  │  │ 3. Unit Converter                                  │  │  │
│  │  │ 4. Quality Control Validator                       │  │  │
│  │  │ 5. Error Recovery Agent                            │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────┬────────────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────────┐
│                    Supabase Database                             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Core Tables:                                             │  │
│  │  - analyzer_connections                                   │  │
│  │  - analyzer_messages (inbox/outbox)                       │  │
│  │  - analyzer_mappings (learned mappings)                   │  │
│  │  - analyzer_results (parsed results)                      │  │
│  │  - samples (barcode tracking)                             │  │
│  │  - results + result_values (final storage)                │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Communication Protocols

### 1. HL7 v2.x (Health Level 7)

**Most Common Protocol** - Used by 70% of modern analyzers

#### Message Types

##### Order Request (ORM^O01)
```hl7
MSH|^~\&|LIMS|LAB001|ANALYZER|SYSMEX|20260116151500||ORM^O01|MSG001|P|2.5
PID|1||PAT12345^^^LIMS||Doe^John||19900101|M|||123 Main St^^Mumbai^^400001
ORC|NW|ORD20260116001||||||20260116151500
OBR|1|ORD20260116001|SAMPLE001|CBC^Complete Blood Count^LOINC|||20260116151500
OBX|1|ST|WBC^White Blood Count||||||||||F
OBX|2|ST|RBC^Red Blood Count||||||||||F
OBX|3|ST|HGB^Hemoglobin||||||||||F
OBX|4|ST|PLT^Platelets||||||||||F
```

##### Result Upload (ORU^R01)
```hl7
MSH|^~\&|ANALYZER|SYSMEX|LIMS|LAB001|20260116152000||ORU^R01|MSG002|P|2.5
PID|1||PAT12345^^^LIMS||Doe^John||19900101|M
OBR|1|ORD20260116001|SAMPLE001|CBC^Complete Blood Count|||20260116151500|||||||20260116152000||DR001
OBX|1|NM|WBC^White Blood Count||7.5|10^9/L|4.5-11.0||||F
OBX|2|NM|RBC^Red Blood Count||5.2|10^12/L|4.5-5.9|H|||F
OBX|3|NM|HGB^Hemoglobin||15.2|g/dL|13.5-17.5||||F
OBX|4|NM|PLT^Platelets||250|10^9/L|150-400||||F
```

### 2. ASTM E1394 (Older Systems)

**Legacy Protocol** - Used by older analyzers

#### Message Structure
```
H|\^&|||Analyzer^Model123^1.0|||||||P|1|20260116152000
P|1|||PAT12345||Doe^John||19900101|M
O|1|SAMPLE001||^^^WBC\^^^RBC\^^^HGB|R||20260116151500
R|1|^^^WBC^White Blood Count|7.5|10^9/L|4.5-11.0||||F
R|2|^^^RBC^Red Blood Count|5.2|10^12/L|4.5-5.9|H|||F
R|3|^^^HGB^Hemoglobin|15.2|g/dL|13.5-17.5||||F
L|1|N
```

### 3. LIS2-A2 (CLSI Standard)

**Modern Standard** - Newer analyzers

#### Features
- Bidirectional communication
- Real-time status updates
- QC data transmission
- Calibration data exchange

---

## Database Schema

### New Tables for Machine Interface

```sql
-- ============================================
-- ANALYZER CONNECTIONS
-- ============================================
CREATE TABLE public.analyzer_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL REFERENCES labs(id),
  
  -- Analyzer Info
  analyzer_name text NOT NULL,                    -- "Sysmex XN-1000"
  analyzer_model text,                            -- "XN-1000"
  manufacturer text,                              -- "Sysmex"
  serial_number text,
  
  -- Connection Details
  connection_type text NOT NULL                   -- 'serial', 'tcp', 'usb'
    CHECK (connection_type IN ('serial', 'tcp', 'usb', 'file_watch')),
  protocol text NOT NULL                          -- 'hl7', 'astm', 'lis2a2', 'custom'
    CHECK (protocol IN ('hl7', 'astm', 'lis2a2', 'custom')),
  
  -- Serial/TCP Settings
  connection_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  /* Example for Serial:
  {
    "port": "COM3",
    "baudRate": 9600,
    "dataBits": 8,
    "stopBits": 1,
    "parity": "none"
  }
  */
  /* Example for TCP:
  {
    "host": "192.168.1.100",
    "port": 5000,
    "timeout": 30000
  }
  */
  
  -- Protocol Settings
  protocol_version text,                          -- "2.5" for HL7
  message_encoding text DEFAULT 'UTF-8',
  field_separator text DEFAULT '|',
  component_separator text DEFAULT '^',
  
  -- Status
  status text NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('connected', 'disconnected', 'error', 'maintenance')),
  last_connected_at timestamptz,
  last_message_at timestamptz,
  error_message text,
  
  -- Features
  supports_bidirectional boolean DEFAULT true,
  supports_qc boolean DEFAULT false,
  auto_download_orders boolean DEFAULT true,
  auto_upload_results boolean DEFAULT true,
  
  -- AI Configuration
  use_ai_parsing boolean DEFAULT true,
  ai_confidence_threshold numeric DEFAULT 0.85,
  require_manual_review_below_threshold boolean DEFAULT true,
  
  -- Metadata
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES users(id)
);

CREATE INDEX idx_analyzer_connections_lab_id ON analyzer_connections(lab_id);
CREATE INDEX idx_analyzer_connections_status ON analyzer_connections(status);

-- ============================================
-- ANALYZER MESSAGES (Inbox/Outbox)
-- ============================================
CREATE TABLE public.analyzer_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analyzer_connection_id uuid NOT NULL REFERENCES analyzer_connections(id),
  lab_id uuid NOT NULL REFERENCES labs(id),
  
  -- Message Info
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_type text NOT NULL,                     -- 'ORM^O01', 'ORU^R01', etc.
  message_id text,                                -- From MSH-10
  
  -- Raw Data
  raw_message text NOT NULL,                      -- Original HL7/ASTM message
  parsed_message jsonb,                           -- Structured JSON
  
  -- Processing Status
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'parsing', 'parsed', 'mapping', 'mapped', 
                      'validating', 'validated', 'committed', 'error', 'rejected')),
  
  -- AI Processing
  ai_processed boolean DEFAULT false,
  ai_processing_started_at timestamptz,
  ai_processing_completed_at timestamptz,
  ai_confidence numeric,
  ai_issues jsonb DEFAULT '[]'::jsonb,
  
  -- Linking
  sample_id uuid REFERENCES samples(id),
  order_id uuid REFERENCES orders(id),
  result_id uuid REFERENCES results(id),
  
  -- Error Handling
  error_code text,
  error_message text,
  retry_count integer DEFAULT 0,
  max_retries integer DEFAULT 3,
  
  -- Audit
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz,
  acknowledged_at timestamptz
);

CREATE INDEX idx_analyzer_messages_connection ON analyzer_messages(analyzer_connection_id);
CREATE INDEX idx_analyzer_messages_status ON analyzer_messages(status);
CREATE INDEX idx_analyzer_messages_direction ON analyzer_messages(direction);
CREATE INDEX idx_analyzer_messages_sample ON analyzer_messages(sample_id);

-- ============================================
-- ANALYZER MAPPINGS (Learned Mappings)
-- ============================================
CREATE TABLE public.analyzer_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analyzer_connection_id uuid NOT NULL REFERENCES analyzer_connections(id),
  lab_id uuid NOT NULL REFERENCES labs(id),
  
  -- Mapping Type
  mapping_type text NOT NULL 
    CHECK (mapping_type IN ('analyte', 'unit', 'flag', 'test_code')),
  
  -- Source (from analyzer)
  source_value text NOT NULL,                     -- "WBC", "HGB", "g/dL"
  source_context jsonb DEFAULT '{}'::jsonb,       -- Additional context
  
  -- Target (in LIMS)
  target_analyte_id uuid REFERENCES analytes(id),
  target_value text,                              -- Mapped value
  
  -- AI Learning
  ai_suggested boolean DEFAULT false,
  ai_confidence numeric,
  ai_reasoning text,
  
  -- Validation
  verified boolean DEFAULT false,
  verified_by uuid REFERENCES users(id),
  verified_at timestamptz,
  
  -- Usage Stats
  usage_count integer DEFAULT 0,
  last_used_at timestamptz,
  success_rate numeric DEFAULT 1.0,
  
  -- Metadata
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES users(id),
  
  UNIQUE(analyzer_connection_id, mapping_type, source_value)
);

CREATE INDEX idx_analyzer_mappings_connection ON analyzer_mappings(analyzer_connection_id);
CREATE INDEX idx_analyzer_mappings_type ON analyzer_mappings(mapping_type);
CREATE INDEX idx_analyzer_mappings_verified ON analyzer_mappings(verified);

-- ============================================
-- ANALYZER RESULTS (Staging Area)
-- ============================================
CREATE TABLE public.analyzer_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analyzer_message_id uuid NOT NULL REFERENCES analyzer_messages(id),
  analyzer_connection_id uuid NOT NULL REFERENCES analyzer_connections(id),
  lab_id uuid NOT NULL REFERENCES labs(id),
  
  -- Sample Identification
  sample_barcode text NOT NULL,
  sample_id uuid REFERENCES samples(id),
  order_id uuid REFERENCES orders(id),
  patient_id uuid REFERENCES patients(id),
  
  -- Result Data (Raw from Analyzer)
  raw_results jsonb NOT NULL,
  /* Example:
  [
    {
      "test_code": "WBC",
      "test_name": "White Blood Count",
      "value": "7.5",
      "unit": "10^9/L",
      "reference_range": "4.5-11.0",
      "flag": "N"
    }
  ]
  */
  
  -- Mapped Results (After AI Processing)
  mapped_results jsonb,
  /* Example:
  [
    {
      "analyte_id": "uuid",
      "analyte_name": "White Blood Count",
      "value": "7.5",
      "unit": "10^9/L",
      "reference_range": "4.5-11.0",
      "flag": "Normal",
      "mapping_confidence": 0.95
    }
  ]
  */
  
  -- QC Data
  qc_status text CHECK (qc_status IN ('passed', 'failed', 'warning', 'not_run')),
  qc_data jsonb,
  
  -- Processing Status
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'mapped', 'validated', 
                      'committed', 'error', 'requires_review')),
  
  -- AI Processing
  ai_processed boolean DEFAULT false,
  ai_confidence_score numeric,
  ai_issues jsonb DEFAULT '[]'::jsonb,
  requires_manual_review boolean DEFAULT false,
  review_reason text,
  
  -- Validation
  validated boolean DEFAULT false,
  validated_by uuid REFERENCES users(id),
  validated_at timestamptz,
  
  -- Commit to Results
  committed_to_result_id uuid REFERENCES results(id),
  committed_at timestamptz,
  
  -- Metadata
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX idx_analyzer_results_message ON analyzer_results(analyzer_message_id);
CREATE INDEX idx_analyzer_results_sample ON analyzer_results(sample_id);
CREATE INDEX idx_analyzer_results_status ON analyzer_results(status);
CREATE INDEX idx_analyzer_results_review ON analyzer_results(requires_manual_review);

-- ============================================
-- ANALYZER AI RUNS (AI Processing Audit)
-- ============================================
CREATE TABLE public.analyzer_ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analyzer_message_id uuid REFERENCES analyzer_messages(id),
  analyzer_result_id uuid REFERENCES analyzer_results(id),
  
  -- AI Task
  task_type text NOT NULL 
    CHECK (task_type IN ('parse_message', 'map_analyte', 'convert_unit', 
                         'validate_result', 'error_recovery')),
  
  -- AI Request/Response
  model text NOT NULL DEFAULT 'gemini-2.5-flash',
  prompt text NOT NULL,
  request_payload jsonb NOT NULL,
  response_payload jsonb,
  
  -- Results
  success boolean,
  confidence_score numeric,
  suggestions jsonb,
  issues jsonb DEFAULT '[]'::jsonb,
  
  -- Performance
  duration_ms integer,
  tokens_used integer,
  
  -- Metadata
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_analyzer_ai_runs_message ON analyzer_ai_runs(analyzer_message_id);
CREATE INDEX idx_analyzer_ai_runs_task ON analyzer_ai_runs(task_type);
```

---

## AI Layer Design

### AI Agent Architecture

```typescript
// Edge Function: process-analyzer-result
interface AIAnalyzerAgent {
  // 1. Message Parser
  parseMessage(rawMessage: string, protocol: string): Promise<ParsedMessage>;
  
  // 2. Analyte Mapper (with learning)
  mapAnalyte(
    sourceCode: string,
    sourceName: string,
    context: AnalyzerContext
  ): Promise<AnalyteMapping>;
  
  // 3. Unit Converter
  convertUnit(
    value: string,
    sourceUnit: string,
    targetUnit: string
  ): Promise<ConvertedValue>;
  
  // 4. Quality Validator
  validateResult(
    result: AnalyzerResult,
    rules: ValidationRules
  ): Promise<ValidationResult>;
  
  // 5. Error Recovery
  recoverFromError(
    error: ParsingError,
    rawMessage: string
  ): Promise<RecoveryAction>;
}
```

### AI Prompts

#### 1. Message Parser Prompt
```typescript
const MESSAGE_PARSER_PROMPT = `
You are an expert in laboratory analyzer communication protocols (HL7, ASTM, LIS2-A2).

Task: Parse the following analyzer message and extract structured result data.

Message Protocol: {protocol}
Raw Message:
{rawMessage}

Extract and return JSON with:
{
  "sampleId": "barcode from message",
  "patientId": "patient identifier",
  "results": [
    {
      "testCode": "analyzer test code",
      "testName": "test name from analyzer",
      "value": "numeric or text value",
      "unit": "unit of measurement",
      "referenceRange": "normal range if provided",
      "flag": "H/L/N or other flags",
      "timestamp": "result timestamp"
    }
  ],
  "qcStatus": "QC pass/fail if available",
  "instrumentInfo": {
    "model": "analyzer model",
    "serialNumber": "serial if available"
  }
}

If any field is unclear or missing, include it with null value and add to "parsingIssues" array.
`;
```

#### 2. Analyte Mapper Prompt
```typescript
const ANALYTE_MAPPER_PROMPT = `
You are an expert in clinical laboratory test nomenclature and standardization.

Task: Map the analyzer's test code/name to the correct LIMS analyte.

Analyzer Test:
- Code: {sourceCode}
- Name: {sourceName}
- Context: {context}

Available LIMS Analytes:
{analyteCatalog}

Previous Mappings for this Analyzer:
{existingMappings}

Return JSON:
{
  "mappedAnalyteId": "uuid of best match",
  "mappedAnalyteName": "canonical name",
  "confidence": 0.0-1.0,
  "reasoning": "why this mapping",
  "alternatives": [
    {"analyteId": "uuid", "name": "name", "confidence": 0.0-1.0}
  ],
  "suggestNewMapping": boolean,
  "issues": ["any concerns"]
}

Confidence scoring:
- 1.0: Exact match (code or standard name)
- 0.9: Strong synonym match
- 0.7-0.8: Probable match with minor differences
- <0.7: Uncertain, requires review
`;
```

#### 3. Unit Converter Prompt
```typescript
const UNIT_CONVERTER_PROMPT = `
You are an expert in clinical laboratory units and conversions.

Task: Convert the value from analyzer unit to LIMS standard unit.

Value: {value}
Source Unit: {sourceUnit}
Target Unit: {targetUnit}
Analyte: {analyteName}

Return JSON:
{
  "convertedValue": "numeric value in target unit",
  "conversionFactor": "factor used",
  "formula": "conversion formula applied",
  "confidence": 0.0-1.0,
  "requiresReview": boolean,
  "notes": "any important notes"
}

Common conversions:
- g/dL ↔ g/L (×10)
- mg/dL ↔ mmol/L (depends on analyte)
- 10^9/L ↔ 10^3/µL (×1)
`;
```

#### 4. Error Recovery Prompt
```typescript
const ERROR_RECOVERY_PROMPT = `
You are an expert troubleshooter for laboratory analyzer interfaces.

Task: Analyze the parsing error and suggest recovery actions.

Error Type: {errorType}
Error Message: {errorMessage}
Raw Message: {rawMessage}
Protocol: {protocol}

Return JSON:
{
  "errorCategory": "protocol_violation|malformed_data|missing_field|unknown_code",
  "severity": "critical|high|medium|low",
  "rootCause": "likely cause of error",
  "recoveryActions": [
    {
      "action": "retry|manual_review|auto_correct|skip",
      "description": "what to do",
      "confidence": 0.0-1.0
    }
  ],
  "suggestedFix": "if auto-correctable, the fixed message",
  "requiresConfiguration": boolean,
  "configurationSuggestion": "what config to add"
}
`;
```

---

## Message Flow

### Inbound Flow (Result Upload from Analyzer)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Analyzer sends result message (HL7/ASTM)                     │
└────────────┬────────────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────────┐
│ 2. Gateway receives message                                      │
│    - Validate protocol format                                    │
│    - Store in analyzer_messages (status: 'received')             │
│    - Extract sample barcode                                      │
└────────────┬────────────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────────┐
│ 3. Lookup sample in database                                     │
│    - Find by barcode → sample_id → order_id → patient_id        │
│    - If not found: Create "unmatched_result" alert               │
└────────────┬────────────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────────┐
│ 4. AI Message Parser (Edge Function)                             │
│    - Parse HL7/ASTM message structure                            │
│    - Extract: tests, values, units, flags, QC data              │
│    - Store in analyzer_results (raw_results)                     │
│    - Log in analyzer_ai_runs                                     │
└────────────┬────────────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────────┐
│ 5. AI Analyte Mapper (for each test)                             │
│    ┌──────────────────────────────────────────────────────┐    │
│    │ Check analyzer_mappings cache                         │    │
│    │   ├─ Found → Use cached mapping                       │    │
│    │   └─ Not found → AI mapping                           │    │
│    │       ├─ Gemini suggests mapping                      │    │
│    │       ├─ Confidence >= threshold → Auto-accept        │    │
│    │       ├─ Confidence < threshold → Flag for review     │    │
│    │       └─ Store in analyzer_mappings                   │    │
│    └──────────────────────────────────────────────────────┘    │
│    - Update analyzer_results (mapped_results)                    │
└────────────┬────────────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────────┐
│ 6. Unit Conversion (if needed)                                   │
│    - Check if source unit matches target unit                    │
│    - If different: AI unit converter                             │
│    - Update mapped values                                        │
└────────────┬────────────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────────┐
│ 7. Quality Validation                                             │
│    - Check QC status from analyzer                               │
│    - Validate value ranges                                       │
│    - Check for critical values                                   │
│    - Flag anomalies                                              │
└────────────┬────────────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────────┐
│ 8. Decision Point                                                 │
│    ├─ All validations passed + confidence high                   │
│    │  → Auto-commit to results table                             │
│    │                                                              │
│    ├─ Low confidence or validation issues                        │
│    │  → Mark requires_manual_review = true                       │
│    │  → Send notification to lab staff                           │
│    │                                                              │
│    └─ Critical errors                                            │
│       → Status = 'error'                                         │
│       → AI Error Recovery attempt                                │
└────────────┬────────────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────────┐
│ 9. Commit to Results (if approved)                               │
│    - Create/Update result record                                 │
│    - Create result_values for each analyte                       │
│    - Update sample status                                        │
│    - Update order status                                         │
│    - Send acknowledgment to analyzer                             │
└─────────────────────────────────────────────────────────────────┘
```

### Outbound Flow (Order Download to Analyzer)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Order created in LIMS                                         │
│    - Sample collected                                            │
│    - Barcode generated                                           │
│    - Tests selected                                              │
└────────────┬────────────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────────┐
│ 2. Check if tests require this analyzer                          │
│    - Match test_groups to analyzer capabilities                  │
│    - If match: Queue for download                                │
└────────────┬────────────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────────┐
│ 3. Build HL7/ASTM Order Message                                  │
│    - Patient demographics                                        │
│    - Sample barcode                                              │
│    - Test codes (mapped to analyzer codes)                       │
│    - Priority                                                    │
│    - Store in analyzer_messages (direction: 'outbound')          │
└────────────┬────────────────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────────────────┐
│ 4. Gateway sends to analyzer                                     │
│    - Establish connection                                        │
│    - Send message                                                │
│    - Wait for ACK                                                │
│    - Update message status                                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Foundation (Weeks 1-2)

**Goal:** Set up basic infrastructure

#### Tasks:
- [ ] Create database tables (analyzer_connections, analyzer_messages, etc.)
- [ ] Set up Node.js Gateway service
- [ ] Implement basic HL7 parser (using `simple-hl7` library)
- [ ] Create connection manager (serial/TCP)
- [ ] Build admin UI for analyzer configuration

#### Deliverables:
- Database schema deployed
- Gateway service running
- Can receive and store raw HL7 messages
- Admin can configure analyzer connections

### Phase 2: AI Integration (Weeks 3-4)

**Goal:** Add AI-powered parsing and mapping

#### Tasks:
- [ ] Create Edge Function: `process-analyzer-result`
- [ ] Implement AI Message Parser with Gemini
- [ ] Build Analyte Mapper with learning
- [ ] Create analyzer_mappings management UI
- [ ] Implement confidence-based auto-commit logic

#### Deliverables:
- AI can parse HL7/ASTM messages
- AI suggests analyte mappings
- Mappings are cached and reused
- Low-confidence results flagged for review

### Phase 3: Bidirectional Communication (Weeks 5-6)

**Goal:** Enable order download to analyzers

#### Tasks:
- [ ] Implement HL7 message builder
- [ ] Create order queue system
- [ ] Build test code mapping (LIMS → Analyzer)
- [ ] Implement acknowledgment handling
- [ ] Add retry logic for failed sends

#### Deliverables:
- Orders automatically sent to analyzers
- Sample barcodes transmitted
- Analyzer acknowledges receipt
- Failed messages retry automatically

### Phase 4: Quality & Monitoring (Weeks 7-8)

**Goal:** Add QC, monitoring, and error handling

#### Tasks:
- [ ] Implement QC data processing
- [ ] Build real-time connection monitor
- [ ] Create error recovery system
- [ ] Add manual review interface
- [ ] Implement audit logging

#### Deliverables:
- QC failures trigger alerts
- Dashboard shows connection status
- Errors auto-recover or escalate
- Lab staff can review/approve uncertain results
- Complete audit trail

### Phase 5: Multi-Analyzer Support (Weeks 9-10)

**Goal:** Support multiple analyzer types

#### Tasks:
- [ ] Add ASTM protocol handler
- [ ] Implement custom protocol adapters
- [ ] Create analyzer-specific configurations
- [ ] Build protocol testing tools
- [ ] Document integration procedures

#### Deliverables:
- Support for 3+ major analyzer brands
- Protocol-agnostic architecture
- Easy addition of new analyzers
- Integration documentation

---

## Error Handling

### Error Categories

#### 1. Connection Errors
```typescript
{
  "errorType": "CONNECTION_FAILED",
  "severity": "HIGH",
  "autoRecovery": {
    "action": "retry",
    "maxRetries": 3,
    "retryDelay": 5000
  },
  "notification": {
    "channels": ["email", "sms"],
    "recipients": ["lab_manager"]
  }
}
```

#### 2. Protocol Errors
```typescript
{
  "errorType": "INVALID_HL7_FORMAT",
  "severity": "MEDIUM",
  "autoRecovery": {
    "action": "ai_parse_attempt",
    "fallback": "manual_review"
  }
}
```

#### 3. Mapping Errors
```typescript
{
  "errorType": "UNKNOWN_ANALYTE_CODE",
  "severity": "LOW",
  "autoRecovery": {
    "action": "ai_suggest_mapping",
    "requireApproval": true
  }
}
```

#### 4. Validation Errors
```typescript
{
  "errorType": "VALUE_OUT_OF_RANGE",
  "severity": "CRITICAL",
  "autoRecovery": {
    "action": "flag_for_review",
    "blockCommit": true
  }
}
```

---

## Security & Compliance

### 1. Data Security
- ✅ All messages encrypted in transit (TLS)
- ✅ Database encryption at rest
- ✅ Access control via RLS policies
- ✅ Audit logging for all operations

### 2. HIPAA Compliance
- ✅ PHI data handling procedures
- ✅ Audit trails for all data access
- ✅ Secure transmission protocols
- ✅ Data retention policies

### 3. Quality Standards
- ✅ ISO 15189 compliance
- ✅ CAP/CLIA requirements
- ✅ 21 CFR Part 11 (if applicable)

---

## Testing Strategy

### 1. Unit Tests
```typescript
// Test HL7 parser
test('parses HL7 ORU message correctly', () => {
  const message = 'MSH|^~\\&|...';
  const parsed = parseHL7Message(message);
  expect(parsed.messageType).toBe('ORU^R01');
});

// Test AI mapper
test('maps WBC to correct analyte', async () => {
  const mapping = await mapAnalyte('WBC', 'White Blood Count');
  expect(mapping.confidence).toBeGreaterThan(0.9);
});
```

### 2. Integration Tests
- Test complete message flow (analyzer → LIMS)
- Test bidirectional communication
- Test error recovery scenarios
- Test AI learning over time

### 3. Analyzer Simulation
```typescript
// Simulate analyzer sending results
class HL7Simulator {
  sendResult(sampleId: string, results: TestResult[]) {
    const message = buildHL7ORU(sampleId, results);
    sendToGateway(message);
  }
}
```

---

## Deployment Guide

### 1. Gateway Service (Node.js)

```bash
# Install dependencies
cd machine-interface-gateway
npm install

# Configure
cp .env.example .env
# Edit .env with connection details

# Run
npm run start

# Or with PM2
pm2 start ecosystem.config.js
```

### 2. Edge Function

```bash
# Deploy to Supabase
supabase functions deploy process-analyzer-result

# Set secrets
supabase secrets set ALLGOOGLE_KEY=your_gemini_key
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_key
```

### 3. Database Migration

```bash
# Run migrations
supabase db push

# Seed analyzer configurations
npm run seed:analyzers
```

---

## Monitoring & Maintenance

### Key Metrics to Track

1. **Connection Health**
   - Uptime percentage
   - Last successful message
   - Error rate

2. **AI Performance**
   - Mapping confidence distribution
   - Manual review rate
   - Learning curve (mappings over time)

3. **Message Throughput**
   - Messages per hour
   - Processing time
   - Queue depth

4. **Quality Metrics**
   - Auto-commit rate
   - Error recovery success rate
   - QC failure rate

---

## Next Steps

1. **Review and approve this plan**
2. **Set up development environment**
3. **Begin Phase 1 implementation**
4. **Select pilot analyzer for testing**
5. **Schedule training sessions for lab staff**

---

**End of Document**

For questions or clarifications, please contact the development team.
