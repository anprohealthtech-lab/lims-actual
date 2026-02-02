# LIMS Workflow System Analysis

## Executive Summary

The workflow system is designed for NABL accreditation and quality protocol execution. However, there are **critical gaps** that prevent intelligent order context integration, duplicate components, and structural issues that need addressing.

---

## Current Architecture Overview

### Database Schema
```
workflows                    → Workflow definitions (lab-scoped)
workflow_versions           → Immutable versioned definitions (SurveyJS JSONB)
test_workflow_map           → Maps test groups to workflow versions
order_workflow_instances    → Runtime instances per order
workflow_step_events        → Audit trail of step execution
workflow_results            → Captured results from workflow execution
workflow_ai_config          → AI parsing/validation configuration
```

### Component Structure
```
Pages (6 files):
├── WorkflowManagement.tsx          → Admin hub for workflow mappings
├── WorkflowConfiguratorPage.tsx    → Wrapper for configurator
├── WorkflowDemo.tsx                → Demo/testing page ⚠️ REDUNDANT
├── WorkflowEvaluatorPage.tsx       → Multi-agent pipeline evaluation
├── WorkflowExplainerTestPage.tsx   → Test page ⚠️ REDUNDANT
└── WorkflowExplainerDemo.tsx       → Interactive demo ⚠️ REDUNDANT

Components (Main):
├── WorkflowRunner.tsx              → Full-featured Survey.js executor
├── SimpleWorkflowRunner.tsx        → Simplified executor
├── ModularWorkflowExecutor.tsx     → Modular AI-hooked executor
├── FlowManager.tsx                 → Multi-workflow resolver
├── VisualWorkflowManager.tsx       → Grid/list management UI
└── WorkflowConfigurator/           → Multi-stage configuration pipeline
```

---

## CRITICAL GAP #1: Order Context Not Pre-populated

### The Problem
When running a workflow for an order (e.g., Sample ID: xxx-001), the workflow **asks users to manually fill in fields** that should be **automatically fetched from the order**.

### Example from ALT Workflow Definition
```json
{
  "name": "patientID",
  "type": "text",
  "title": "Patient ID",
  "isRequired": true
},
{
  "name": "collectionDate",
  "type": "text",
  "title": "Collection Date (YYYY-MM-DD)",
  "isRequired": true
},
{
  "name": "sampleIDVerification",
  "type": "text",
  "title": "Verify Sample ID on Analyzer",
  "isRequired": true
}
```

### Current Code (SimpleWorkflowRunner.tsx:97-112)
```javascript
useEffect(() => {
  if (survey && orderId) {
    survey.data = {
      orderId,
      testGroupId,
      patientId,        // ⚠️ Uses camelCase
      patientName,
      testName,
      sampleId,         // ⚠️ Uses camelCase
      labId,
      testCode,
      ...survey.data
    };
  }
}, [survey, orderId, ...]);
```

### Field Name Mismatch
| Workflow Field | Code Pre-populates | Status |
|----------------|-------------------|--------|
| `patientID` | `patientId` | ❌ Case mismatch |
| `collectionDate` | (nothing) | ❌ Missing |
| `collectionTime` | (nothing) | ❌ Missing |
| `sampleIDVerification` | `sampleId` | ❌ Name mismatch |
| `phlebotomistID` | (nothing) | ❌ Missing |

### Missing in WorkflowDemo.tsx
```javascript
<SimpleWorkflowRunner
  workflowDefinition={selectedWorkflow.definition}
  onComplete={handleWorkflowComplete}
  orderId={selectedOrder?.id}
  testGroupId={selectedOrder?.test_group_name ? 'test-group-id' : undefined}
  // ❌ Missing: patientId, patientName, sampleId, labId, testCode, etc.
/>
```

---

## CRITICAL GAP #2: No Intelligent Context Mapping

### Expected Behavior
When executing a workflow for an order:
1. System should fetch all order details (sample_id, patient, collection_date, etc.)
2. Map these to workflow form fields dynamically
3. Pre-populate fields OR mark them as read-only display
4. Only ask for NEW information (QC values, observations, result values)

### Current Behavior
- User must manually enter sample ID (already known from order)
- User must manually enter patient ID (already known from order)
- User must manually enter collection date (already recorded at sample collection)
- No validation against order data

---

## CRITICAL GAP #3: Multiple Workflow Runners

Three separate implementations exist with overlapping functionality:

| Component | Purpose | Used Where |
|-----------|---------|------------|
| `WorkflowRunner.tsx` | Full-featured with file uploads | FlowManager |
| `SimpleWorkflowRunner.tsx` | Simplified with DB submission | WorkflowDemo |
| `ModularWorkflowExecutor.tsx` | AI hooks for image analysis | Unknown |

**Problem**: Inconsistent behavior, maintenance burden, unclear which to use.

---

## Redundant Pages (Candidates for Removal)

### 1. WorkflowExplainerTestPage.tsx
- **Content**: Hardcoded test workflow data
- **Purpose**: Testing workflow explanation
- **Recommendation**: DELETE - use WorkflowExplainerDemo instead

### 2. WorkflowDemo.tsx
- **Content**: Sample order + workflow selection
- **Purpose**: Demo/testing
- **Recommendation**: CONSOLIDATE into WorkflowManagement or keep as dev tool only

### 3. WorkflowExplainerDemo.tsx
- **Content**: Interactive workflow selection/modification
- **Overlap**: With WorkflowConfiguratorPage
- **Recommendation**: CONSOLIDATE with WorkflowConfiguratorPage

---

## Duplicate Components

### WorkflowConfigurator.tsx (Two Versions)
1. `src/components/Workflow/WorkflowConfigurator.tsx` - Standalone simple version
2. `src/components/Workflow/WorkflowConfigurator/WorkflowConfigurator.tsx` - Multi-stage pipeline

**Recommendation**: Keep the multi-stage pipeline, remove standalone.

---

## Recommended Architecture Improvements

### 1. Order Context Service
Create a service that fetches and maps order context to workflow fields:

```typescript
// Proposed: src/utils/workflowContextService.ts
interface WorkflowContext {
  // From Order
  orderId: string;
  sampleId: string;
  patientId: string;
  patientName: string;
  collectionDate: string;
  collectionTime: string;
  labId: string;
  testGroupId: string;
  testCode: string;

  // From Lab Config
  technicianId: string;
  technicianName: string;

  // Computed
  workingDate: string;
}

async function buildWorkflowContext(orderId: string): Promise<WorkflowContext> {
  const order = await fetchOrderWithDetails(orderId);
  return mapOrderToContext(order);
}

function applyContextToSurvey(survey: Model, context: WorkflowContext) {
  // Map context fields to survey questions using field mapping
  const fieldMap = {
    'patientID': context.patientId,
    'patientId': context.patientId,
    'sampleID': context.sampleId,
    'sampleId': context.sampleId,
    'sampleIDVerification': context.sampleId,
    'collectionDate': context.collectionDate,
    'collectionTime': context.collectionTime,
    // ... etc
  };

  survey.data = { ...fieldMap, ...survey.data };

  // Mark pre-filled fields as readOnly
  survey.getAllQuestions().forEach(q => {
    if (fieldMap[q.name]) {
      q.readOnly = true; // Or add visual indicator
    }
  });
}
```

### 2. Unified Workflow Runner
Merge the three runners into one configurable component:

```typescript
interface UnifiedWorkflowRunnerProps {
  workflowDefinition: any;
  orderId: string;
  mode: 'full' | 'simple' | 'modular';
  features: {
    fileUploads: boolean;
    aiAnalysis: boolean;
    autoContext: boolean;  // NEW: auto-fetch order context
  };
  onComplete: (results: any) => void;
}
```

### 3. Workflow Definition Schema Enhancement
Add field mapping metadata to workflow definitions:

```json
{
  "meta": {
    "fieldMappings": {
      "patientID": { "source": "order.patient_id", "readOnly": true },
      "collectionDate": { "source": "order.collection_date", "readOnly": true },
      "sampleIDVerification": { "source": "order.sample_id", "display": true },
      "altResult": { "source": null, "required": true }
    }
  }
}
```

### 4. Quality Control Module (Future)
Structure for IQC/EQC tracking:

```sql
-- QC Runs
CREATE TABLE qc_runs (
  id UUID PRIMARY KEY,
  lab_id UUID NOT NULL,
  run_date DATE NOT NULL,
  analyzer_id UUID,
  operator_id UUID,
  status TEXT DEFAULT 'pending'
);

-- QC Results per Run
CREATE TABLE qc_results (
  id UUID PRIMARY KEY,
  qc_run_id UUID REFERENCES qc_runs,
  test_group_id UUID,
  analyte_id UUID,
  level TEXT, -- 'low', 'normal', 'high'
  lot_number TEXT,
  expected_value NUMERIC,
  observed_value NUMERIC,
  sd NUMERIC,
  cv_percent NUMERIC,
  pass_fail TEXT,
  westgard_flags TEXT[]
);
```

---

## Proposed File Structure After Cleanup

```
src/pages/
├── WorkflowManagement.tsx          # Keep - admin hub
├── WorkflowConfiguratorPage.tsx    # Keep - configuration
└── WorkflowEvaluatorPage.tsx       # Keep - AI pipeline

# REMOVE:
# - WorkflowDemo.tsx (merge into dev tools)
# - WorkflowExplainerTestPage.tsx (delete)
# - WorkflowExplainerDemo.tsx (merge into configurator)

src/components/Workflow/
├── UnifiedWorkflowRunner.tsx       # NEW - replaces 3 runners
├── FlowManager.tsx                 # Keep - multi-workflow resolver
├── VisualWorkflowManager.tsx       # Keep - management UI
├── SurveyJSFormBuilder.tsx         # Keep - form builder
└── WorkflowConfigurator/           # Keep - multi-stage config
    ├── WorkflowConfigurator.tsx
    ├── WorkflowProgress.tsx
    └── ...

# REMOVE:
# - WorkflowRunner.tsx (merge into UnifiedWorkflowRunner)
# - SimpleWorkflowRunner.tsx (merge into UnifiedWorkflowRunner)
# - ModularWorkflowExecutor.tsx (merge into UnifiedWorkflowRunner)
# - WorkflowConfigurator.tsx (standalone - use nested version)
```

---

## Implementation Priority

### Phase 1: Fix Context Pre-population (HIGH PRIORITY)
1. Create `workflowContextService.ts`
2. Update SimpleWorkflowRunner to use context service
3. Add field name mapping for existing workflows

### Phase 2: Consolidate Runners (MEDIUM)
1. Design UnifiedWorkflowRunner interface
2. Migrate functionality from 3 runners
3. Update all usages

### Phase 3: Remove Redundant Pages (LOW)
1. Archive demo pages
2. Consolidate functionality into main pages

### Phase 4: Quality Module (FUTURE)
1. Design QC tracking schema
2. Integrate with workflow execution
3. Add Westgard rules validation

---

## Sample Workflow Execution Flow (Proposed)

```
1. User selects Order → Test Group
   ↓
2. System resolves workflow from test_workflow_map
   ↓
3. NEW: WorkflowContextService fetches order details:
   - Sample ID: xxx-001
   - Patient: John Doe (ID: abc-123)
   - Collection Date: 2026-01-31
   - Collection Time: 09:30
   - Technician: Current User
   ↓
4. Survey.js model initialized with pre-populated context
   ↓
5. Pre-filled fields marked as readOnly/verified
   ↓
6. User only enters NEW data:
   - QC values (IQC Low/Medium/High)
   - Calibration verification
   - Test result (ALT value)
   - Observations
   ↓
7. Submit → workflow_results → AI processing → result_values
```

---

## Questions to Resolve

1. Should pre-populated fields be **read-only** or **editable with warning**?
2. How to handle workflow definitions that don't match order schema?
3. Should there be a "workflow migration" tool to update field names?
4. Integration with existing QC tracking (quality_control_results table)?

---

## Implementation Status (2026-01-31)

### Completed

1. **workflowContextService.ts** - Created
   - Auto-fetches order, patient, test, lab context
   - Field name mapping for common variations (patientID/patientId etc.)
   - Applies context to Survey.js with read-only option
   - Location: [src/utils/workflowContextService.ts](src/utils/workflowContextService.ts)

2. **UnifiedWorkflowRunner.tsx** - Created
   - Consolidates WorkflowRunner, SimpleWorkflowRunner, ModularWorkflowExecutor
   - Configurable features (autoContext, fileUploads, aiAnalysis)
   - Automatic context pre-population on load
   - Location: [src/components/Workflow/UnifiedWorkflowRunner.tsx](src/components/Workflow/UnifiedWorkflowRunner.tsx)

3. **QC Module Schema** - Created
   - qc_lots (control materials)
   - qc_target_values (expected ranges)
   - qc_runs (daily QC execution)
   - qc_results (measurements with Westgard evaluation)
   - westgard_rules (configurable rule sets)
   - eqc_programs / eqc_results (external QC)
   - calibration_records
   - Auto-trigger for Westgard rule evaluation
   - Location: [supabase/migrations/20260131_quality_control_module.sql](supabase/migrations/20260131_quality_control_module.sql)

4. **WorkflowManagement.tsx** - Updated
   - Added "Execute Workflow" tab
   - Order selection with search
   - Automatic context loading
   - Uses UnifiedWorkflowRunner
   - Location: [src/pages/WorkflowManagement.tsx](src/pages/WorkflowManagement.tsx)

5. **Redundant Pages Deprecated**
   - WorkflowDemo.tsx - Routes commented out
   - WorkflowExplainerDemo.tsx - Routes commented out
   - WorkflowExplainerTestPage.tsx - Routes commented out
   - Files retained for reference but not accessible via routing

### Migration Required

Run the QC module migration:
```bash
supabase db push
# or
psql -f supabase/migrations/20260131_quality_control_module.sql
```

---

## Workflow AI Builder Improvements (2026-01-31)

### Updated Components

6. **agent-1-manual-builder** - Enhanced
   - NABL/ISO 15189:2022 compliant prompt
   - Order context field integration (sampleId, patientId, collectionDate, etc.)
   - Mandatory QC verification phase
   - Four-phase structure (Pre-analytical, QC, Analytical, Post-analytical)
   - Accreditation checklist output
   - Location: [supabase/functions/agent-1-manual-builder/index.ts](supabase/functions/agent-1-manual-builder/index.ts)

7. **agent-2-contextualizer** - Enhanced
   - QC database integration (qc_lots, qc_target_values, qc_results)
   - Westgard rules configuration
   - Analyte ID mapping
   - Field name standardization
   - NABL compliance validation
   - Location: [supabase/functions/agent-2-contextualizer/index.ts](supabase/functions/agent-2-contextualizer/index.ts)

8. **workflowNABLConfig.ts** - Created
   - Context field mappings (50+ field name variations)
   - NABL requirements checklist (17 requirements)
   - Workflow phase definitions
   - QC field mappings to database
   - Westgard rules configuration
   - Validation functions
   - Location: [src/config/workflowNABLConfig.ts](src/config/workflowNABLConfig.ts)

### Order Context Integration

Workflows now receive pre-populated context:

| Field | Source | Behavior |
|-------|--------|----------|
| sampleId | order.sample_id | Read-only display |
| patientId | order.patient_id | Read-only |
| patientName | order.patient_name | Read-only |
| collectionDate | order.sample_collected_at | Read-only |
| collectionTime | order.sample_collected_at | Read-only |
| technicianId | current_user.id | Auto-filled |
| technicianName | current_user.full_name | Auto-filled |
| workingDate | NOW() | Auto-filled |

### NABL Mandatory Requirements (Enforced by AI)

**Pre-Analytical Phase:**
- Sample identification verification
- Patient identity confirmation
- Sample condition documentation
- Stability verification

**QC Verification Phase:**
- IQC Level 1 (Low) result
- IQC Level 2 (Normal) result
- IQC lot number tracking
- IQC acceptability confirmation
- Calibration verification

**Analytical Phase:**
- Test result value (numeric)
- Reagent lot number
- Analyzer identification

**Post-Analytical Phase:**
- Result verification
- Critical value notification (if applicable)
- Technician signature

### QC Integration Flow

```
Workflow QC Fields → qc_runs (daily run tracking)
                   → qc_results (individual measurements)
                   → Westgard evaluation (automatic)
                   → Block patient testing if QC fails
```

---

## Unified Workflow Builder Agent (2026-01-31)

### Overview

The 3 separate AI agents have been consolidated into a **single unified agent** that handles the complete workflow generation pipeline in one API call.

### Previous Architecture (Deprecated)

```
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│ agent-1-manual-     │───▶│ agent-2-            │───▶│ agent-3-publisher   │
│ builder             │    │ contextualizer      │    │                     │
│                     │    │                     │    │                     │
│ - Parse IFU/manual  │    │ - Add lab context   │    │ - Validate NABL     │
│ - Generate draft    │    │ - Map analytes      │    │ - Save to database  │
│ - Basic structure   │    │ - Add QC config     │    │ - Create mapping    │
└─────────────────────┘    └─────────────────────┘    └─────────────────────┘
        ↓                          ↓                          ↓
    3 API calls              Complex orchestration        Manual publishing
```

### New Architecture (Unified)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     UNIFIED WORKFLOW BUILDER                                 │
│                 supabase/functions/workflow-builder-unified/index.ts        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  INPUT:                              OUTPUT:                                │
│  • lab_id                            • Complete workflow definition         │
│  • test_group_id                     • AI processing spec                  │
│  • manual_uri (optional)             • NABL validation results             │
│  • options {}                        • Saved workflow + mapping            │
│                                                                             │
│  SINGLE PROMPT WITH:                                                        │
│  ╔═════════════════════════════════════════════════════════════════════╗   │
│  ║ 1. Lab & Test Context (auto-fetched)                                ║   │
│  ║ 2. Analyte Configuration (with IDs, units, ranges)                  ║   │
│  ║ 3. QC Targets (from qc_target_values)                               ║   │
│  ║ 4. Order Context Field Mappings (18 auto-populated fields)         ║   │
│  ║ 5. 4-Phase Structure (Pre-Analytical, QC, Analytical, Post)        ║   │
│  ║ 6. NABL/ISO 15189:2022 Requirements Checklist                      ║   │
│  ║ 7. SurveyJS Element Templates                                       ║   │
│  ╚═════════════════════════════════════════════════════════════════════╝   │
│                                                                             │
│  AUTO-PUBLISH: Creates workflow, version, and test_workflow_map            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
        ↓
    1 API call                Simple request                Auto-publishing
```

### Unified Agent Location

**File:** [supabase/functions/workflow-builder-unified/index.ts](supabase/functions/workflow-builder-unified/index.ts)

### API Request

```typescript
POST /functions/v1/workflow-builder-unified

{
  "lab_id": "uuid",
  "test_group_id": "uuid",
  "manual_uri": "https://..." | null,     // Optional: IFU/manual URL
  "manual_text": "..." | null,            // Optional: Raw manual text
  "test_meta": {                          // Optional: Auto-fetched if not provided
    "testCode": "ALT",
    "testName": "Alanine Transaminase",
    "vendor": "Beckman Coulter",
    "model": "AU5800",
    "sampleType": "Serum",
    "department": "Clinical Chemistry"
  },
  "options": {
    "publish_immediately": true,          // Default: true
    "include_qc": true,                   // Default: true
    "iqc_levels": 2,                      // Default: 2
    "include_calibration": true,          // Default: true
    "strict_nabl": true                   // Default: true
  }
}
```

### API Response

```typescript
{
  "success": true,
  "workflow": {
    "id": "workflow-uuid",
    "version_id": "version-uuid",
    "definition": { /* SurveyJS template */ }
  },
  "mapping": {
    "id": "mapping-uuid",
    "test_code": "ALT",
    "is_default": true
  },
  "validation": {
    "nabl_compliant": true,
    "compliance_score": 95,
    "issues": [],
    "accreditation_checklist": {
      "sample_identification": true,
      "patient_verification": true,
      "iqc_before_patient_samples": true,
      "iqc_two_levels_minimum": true,
      "calibration_verification": true,
      "critical_value_protocol": true,
      "technician_identification": true,
      "verification_step": true
    }
  },
  "metadata": {
    "generated_at": "2026-01-31T...",
    "source": "standards",
    "ai_model": "gemini-2.5-flash",
    "tokens_used": 2500
  }
}
```

### Key Features

| Feature | Description |
|---------|-------------|
| **Single API Call** | Complete workflow generated and published in one request |
| **Auto Context** | Fetches lab, test group, analytes, QC config automatically |
| **NABL Compliance** | Enforces ISO 15189:2022 requirements with validation |
| **4-Phase Structure** | Mandatory Pre-Analytical → QC → Analytical → Post-Analytical |
| **Analyte Mapping** | Maps result fields to actual analyte UUIDs |
| **QC Integration** | Links to qc_lots, qc_target_values tables |
| **Westgard Rules** | Configures 1:2s, 1:3s, 2:2s, R:4s rule evaluation |
| **Auto-Publish** | Creates workflow version and test_workflow_map |
| **Prominent Prompt** | ASCII art tables for clear AI instructions |

### Usage in Frontend

```typescript
import { supabase } from '@/utils/supabase';

async function generateWorkflow(testGroupId: string) {
  const { data, error } = await supabase.functions.invoke('workflow-builder-unified', {
    body: {
      lab_id: currentLabId,
      test_group_id: testGroupId,
      options: {
        publish_immediately: true,
        include_qc: true,
        iqc_levels: 2
      }
    }
  });

  if (data.success) {
    console.log('Workflow created:', data.workflow.id);
    console.log('NABL Score:', data.validation.compliance_score);
  }
}
```

### Deployment

```bash
# Deploy the unified agent
supabase functions deploy workflow-builder-unified

# The old agents can be kept for backward compatibility or removed:
# supabase functions delete agent-1-manual-builder
# supabase functions delete agent-2-contextualizer
# supabase functions delete agent-3-publisher
```

---

## Summary: What Was Implemented

### Files Created

| File | Purpose |
|------|---------|
| `src/utils/workflowContextService.ts` | Order context auto-population service |
| `src/components/Workflow/UnifiedWorkflowRunner.tsx` | Consolidated workflow executor |
| `src/config/workflowNABLConfig.ts` | NABL requirements & field mappings |
| `supabase/migrations/20260131_quality_control_module.sql` | QC database schema |
| `supabase/functions/workflow-builder-unified/index.ts` | **Unified AI agent** |

### Files Modified

| File | Changes |
|------|---------|
| `src/pages/WorkflowManagement.tsx` | Added "Execute Workflow" tab |
| `src/App.tsx` | Deprecated redundant routes |
| `supabase/functions/agent-1-manual-builder/index.ts` | Enhanced NABL prompts |
| `supabase/functions/agent-2-contextualizer/index.ts` | Enhanced QC integration |

### Architecture Improvements

1. **Order Context**: Workflows now auto-populate 18+ fields from order data
2. **Unified Runner**: Single component replaces 3 separate runners
3. **QC Module**: Complete database schema for NABL QC tracking
4. **Unified Agent**: Single API call replaces 3-agent pipeline
5. **NABL Compliance**: Mandatory 4-phase structure with accreditation checklist

---

*Updated: 2026-01-31*
*Author: Claude Code Analysis*
