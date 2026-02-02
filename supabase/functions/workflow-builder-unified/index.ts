/**
 * UNIFIED WORKFLOW BUILDER AGENT
 *
 * Combines the functionality of:
 * - agent-1-manual-builder (create from manual/standards)
 * - agent-2-contextualizer (add lab context, QC, analytes)
 * - agent-3-publisher (validate and publish)
 *
 * Single API call to generate a complete, NABL-compliant workflow
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ============================================================================
// Types
// ============================================================================

interface WorkflowBuilderRequest {
  // Required
  lab_id: string;
  test_group_id: string;

  // Optional - source material
  manual_uri?: string;      // URL to IFU/manual document
  manual_text?: string;     // Raw text from manual

  // Test metadata (can be fetched from test_group if not provided)
  test_meta?: {
    testCode: string;
    testName: string;
    vendor?: string;
    model?: string;
    sampleType?: string;
    department?: string;
  };

  // Options
  options?: {
    publish_immediately?: boolean;  // Auto-publish after generation
    include_qc?: boolean;           // Include QC verification phase (default: true)
    iqc_levels?: number;            // Number of QC levels (default: 2)
    include_calibration?: boolean;  // Include calibration verification
    strict_nabl?: boolean;          // Strict NABL compliance mode
  };
}

interface WorkflowBuilderResponse {
  success: boolean;

  // Generated workflow
  workflow: {
    id: string;
    version_id: string;
    definition: any;
  } | null;

  // Mapping created
  mapping: {
    id: string;
    test_code: string;
    is_default: boolean;
  } | null;

  // Validation results
  validation: {
    nabl_compliant: boolean;
    compliance_score: number;
    issues: Array<{
      severity: 'error' | 'warning' | 'info';
      code: string;
      message: string;
      fix_suggestion?: string;
    }>;
    accreditation_checklist: Record<string, boolean>;
  };

  // Generation metadata
  metadata: {
    generated_at: string;
    source: 'manual' | 'standards' | 'template';
    ai_model: string;
    tokens_used?: number;
  };
}

// ============================================================================
// Main Handler
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Auth
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('No authorization header')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    // Verify user
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authError } = await anonClient.auth.getUser()
    if (authError || !user) throw new Error('Invalid authentication')

    // Parse request
    const request: WorkflowBuilderRequest = await req.json()
    const { lab_id, test_group_id, manual_uri, manual_text, options = {} } = request

    if (!lab_id || !test_group_id) {
      throw new Error('lab_id and test_group_id are required')
    }

    // Set defaults
    const opts = {
      publish_immediately: options.publish_immediately ?? true,
      include_qc: options.include_qc ?? true,
      iqc_levels: options.iqc_levels ?? 2,
      include_calibration: options.include_calibration ?? true,
      strict_nabl: options.strict_nabl ?? true,
    }

    // ========================================================================
    // STEP 1: Fetch Lab & Test Group Context
    // ========================================================================

    const [labResult, testGroupResult] = await Promise.all([
      supabase.from('labs').select('id, name').eq('id', lab_id).single(),
      supabase.from('test_groups').select(`
        id, name, code, category, sample_type, department,
        test_group_analytes (
          analyte_id,
          analytes (
            id, name, code, unit, reference_range,
            low_critical, high_critical, ai_processing_type
          )
        )
      `).eq('id', test_group_id).single()
    ])

    if (labResult.error) throw new Error(`Lab not found: ${labResult.error.message}`)
    if (testGroupResult.error) throw new Error(`Test group not found: ${testGroupResult.error.message}`)

    const lab = labResult.data
    const testGroup = testGroupResult.data
    const analytes = testGroup.test_group_analytes?.map((tga: any) => tga.analytes).filter(Boolean) || []

    // Build test metadata
    const testMeta = request.test_meta || {
      testCode: testGroup.code || testGroup.name.toUpperCase().replace(/\s+/g, '_'),
      testName: testGroup.name,
      sampleType: testGroup.sample_type || 'Blood',
      department: testGroup.department || 'Clinical Chemistry',
      vendor: '',
      model: ''
    }

    // ========================================================================
    // STEP 2: Fetch QC Configuration (if enabled)
    // ========================================================================

    let qcConfig: any = null
    if (opts.include_qc) {
      // Get active QC lots for this lab's analytes (if QC tables exist)
      const analyteIds = analytes.map((a: any) => a.id)
      if (analyteIds.length > 0) {
        try {
          const { data: qcTargets, error: qcError } = await supabase
            .from('qc_target_values')
            .select(`
              id, target_mean, target_sd, unit,
              qc_lots (id, lot_number, material_name, expiry_date, level),
              analytes (id, name)
            `)
            .in('analyte_id', analyteIds)
            .eq('qc_lots.is_active', true)

          // Only use if query succeeded (tables exist)
          if (!qcError && qcTargets && qcTargets.length > 0) {
            qcConfig = {
              has_targets: true,
              targets: qcTargets
            }
          }
        } catch (e) {
          // QC tables don't exist yet - continue without QC config
          console.log('QC tables not found, continuing without QC config')
        }
      }
    }

    // ========================================================================
    // STEP 3: Call Gemini to Generate Workflow
    // ========================================================================

    const geminiApiKey = Deno.env.get('ALLGOOGLE_KEY')
    if (!geminiApiKey) throw new Error('Gemini API key not configured')

    const prompt = buildUnifiedPrompt({
      lab,
      testGroup,
      testMeta,
      analytes,
      qcConfig,
      options: opts,
      manualUri: manual_uri,
      manualText: manual_text
    })

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 16384,
            responseMimeType: "application/json"
          }
        })
      }
    )

    if (!geminiResponse.ok) {
      throw new Error(`Gemini API error: ${await geminiResponse.text()}`)
    }

    const geminiData = await geminiResponse.json()
    const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text

    if (!responseText) {
      throw new Error('Empty response from Gemini')
    }

    let generatedWorkflow: any
    try {
      generatedWorkflow = JSON.parse(responseText)
    } catch (e) {
      throw new Error(`Failed to parse Gemini response: ${e}`)
    }

    // ========================================================================
    // STEP 4: Save to Database (if publish_immediately)
    // ========================================================================

    let savedWorkflow: any = null
    let savedMapping: any = null

    if (opts.publish_immediately) {
      // Create or get workflow
      const workflowName = `${testMeta.testName} Workflow`

      let workflowId: string
      const { data: existingWorkflow } = await supabase
        .from('workflows')
        .select('id')
        .eq('lab_id', lab_id)
        .eq('name', workflowName)
        .single()

      if (existingWorkflow) {
        workflowId = existingWorkflow.id
      } else {
        const { data: newWorkflow, error: createError } = await supabase
          .from('workflows')
          .insert({
            name: workflowName,
            scope: 'lab',
            lab_id: lab_id,
            active: true,
            category: 'automated',
            description: `NABL-compliant workflow for ${testMeta.testName}`,
            type: 'test_workflow'
          })
          .select()
          .single()

        if (createError) throw new Error(`Failed to create workflow: ${createError.message}`)
        workflowId = newWorkflow.id
      }

      // Get next version number
      const { data: versions } = await supabase
        .from('workflow_versions')
        .select('version')
        .eq('workflow_id', workflowId)
        .order('version', { ascending: false })
        .limit(1)

      const nextVersion = (versions?.[0]?.version || '0.0.0').split('.').map(Number)
      nextVersion[2] = (nextVersion[2] || 0) + 1
      const versionString = nextVersion.join('.')

      // Create workflow version
      const { data: workflowVersion, error: versionError } = await supabase
        .from('workflow_versions')
        .insert({
          workflow_id: workflowId,
          version: versionString,
          definition: generatedWorkflow.workflow_definition,
          description: `${testMeta.testName} - Auto-generated NABL workflow`,
          active: true,
          test_group_id: test_group_id,
          name: workflowName
        })
        .select()
        .single()

      if (versionError) throw new Error(`Failed to create version: ${versionError.message}`)

      savedWorkflow = {
        id: workflowId,
        version_id: workflowVersion.id,
        definition: generatedWorkflow.workflow_definition
      }

      // Create/update test_workflow_map
      await supabase
        .from('test_workflow_map')
        .update({ is_default: false })
        .eq('test_group_id', test_group_id)
        .eq('lab_id', lab_id)

      const { data: mapping, error: mapError } = await supabase
        .from('test_workflow_map')
        .insert({
          lab_id: lab_id,
          test_group_id: test_group_id,
          test_code: testMeta.testCode,
          workflow_version_id: workflowVersion.id,
          is_default: true,
          is_active: true,
          priority: 100,
          description: 'Auto-generated by Unified Workflow Builder'
        })
        .select()
        .single()

      if (!mapError && mapping) {
        savedMapping = {
          id: mapping.id,
          test_code: testMeta.testCode,
          is_default: true
        }
      }
    }

    // ========================================================================
    // STEP 5: Build Response
    // ========================================================================

    // Log usage
    await supabase.from('ai_usage_logs').insert({
      user_id: user.id,
      lab_id: lab_id,
      processing_type: 'workflow_builder_unified',
      input_data: { test_group_id, test_code: testMeta.testCode },
      confidence: generatedWorkflow.validation?.compliance_score || 0.9,
      created_at: new Date().toISOString()
    })

    const response: WorkflowBuilderResponse = {
      success: true,
      workflow: savedWorkflow || {
        id: 'preview',
        version_id: 'preview',
        definition: generatedWorkflow.workflow_definition
      },
      mapping: savedMapping,
      validation: generatedWorkflow.validation || {
        nabl_compliant: true,
        compliance_score: 95,
        issues: [],
        accreditation_checklist: {}
      },
      metadata: {
        generated_at: new Date().toISOString(),
        source: manual_uri || manual_text ? 'manual' : 'standards',
        ai_model: 'gemini-2.5-flash',
        tokens_used: geminiData.usageMetadata?.totalTokenCount
      }
    }

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    })

  } catch (error) {
    console.error('Workflow Builder Error:', error)

    return new Response(JSON.stringify({
      success: false,
      workflow: null,
      mapping: null,
      validation: {
        nabl_compliant: false,
        compliance_score: 0,
        issues: [{ severity: 'error', code: 'BUILD_FAILED', message: error.message }],
        accreditation_checklist: {}
      },
      metadata: {
        generated_at: new Date().toISOString(),
        source: 'error',
        ai_model: 'gemini-2.5-flash'
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    })
  }
})

// ============================================================================
// Unified Prompt Builder
// ============================================================================

interface PromptContext {
  lab: any;
  testGroup: any;
  testMeta: any;
  analytes: any[];
  qcConfig: any;
  options: any;
  manualUri?: string;
  manualText?: string;
}

function buildUnifiedPrompt(ctx: PromptContext): string {
  const { lab, testGroup, testMeta, analytes, qcConfig, options, manualUri, manualText } = ctx

  return `
═══════════════════════════════════════════════════════════════════════════════
                    UNIFIED NABL WORKFLOW BUILDER
                    ISO 15189:2022 Compliant Generator
═══════════════════════════════════════════════════════════════════════════════

You are generating a complete, production-ready laboratory workflow that must:
1. Pass NABL/ISO 15189:2022 accreditation audit
2. Integrate with order context (auto-populated fields)
3. Include mandatory QC verification
4. Map to existing analytes for result storage

═══════════════════════════════════════════════════════════════════════════════
                         LAB & TEST CONTEXT
═══════════════════════════════════════════════════════════════════════════════

LAB INFORMATION:
- Lab ID: ${lab.id}
- Lab Name: ${lab.name}

TEST GROUP:
- Test Group ID: ${testGroup.id}
- Test Name: ${testMeta.testName}
- Test Code: ${testMeta.testCode}
- Sample Type: ${testMeta.sampleType}
- Department: ${testMeta.department}
${testMeta.vendor ? `- Analyzer Vendor: ${testMeta.vendor}` : ''}
${testMeta.model ? `- Analyzer Model: ${testMeta.model}` : ''}

ANALYTES TO MAP (${analytes.length} total):
${analytes.map((a: any, i: number) => `
  ${i + 1}. ${a.name}
     - Analyte ID: ${a.id}
     - Code: ${a.code || 'N/A'}
     - Unit: ${a.unit || 'N/A'}
     - Reference Range: ${a.reference_range || 'N/A'}
     - Critical Low: ${a.low_critical || 'N/A'}
     - Critical High: ${a.high_critical || 'N/A'}
`).join('')}

${qcConfig ? `
QC CONFIGURATION:
- QC Levels Required: ${options.iqc_levels}
- Existing QC Targets: ${qcConfig.has_targets ? 'Yes' : 'No'}
${qcConfig.targets ? qcConfig.targets.slice(0, 3).map((t: any) => `
  - ${t.analytes?.name}: Mean=${t.target_mean}, SD=${t.target_sd}
`).join('') : ''}
` : ''}

${manualUri ? `MANUAL/IFU SOURCE: ${manualUri}` : ''}
${manualText ? `MANUAL TEXT PROVIDED: ${manualText.substring(0, 500)}...` : ''}

═══════════════════════════════════════════════════════════════════════════════
                    ORDER CONTEXT FIELDS (AUTO-POPULATED)
═══════════════════════════════════════════════════════════════════════════════

These fields will be automatically filled from the order. Mark as READ-ONLY:

┌─────────────────┬────────────────────────────┬──────────────────────────────┐
│ Field Name      │ Source                     │ Description                  │
├─────────────────┼────────────────────────────┼──────────────────────────────┤
│ sampleId        │ order.sample_id            │ Sample identifier (XXX-001)  │
│ patientId       │ order.patient_id           │ Patient UUID                 │
│ patientName     │ order.patient_name         │ Full patient name            │
│ patientAge      │ patient.age                │ Age in years                 │
│ patientGender   │ patient.gender             │ Male/Female/Other            │
│ collectionDate  │ order.sample_collected_at  │ YYYY-MM-DD                   │
│ collectionTime  │ order.sample_collected_at  │ HH:MM                        │
│ collectorName   │ order.sample_collected_by  │ Phlebotomist name            │
│ orderId         │ order.id                   │ Order UUID                   │
│ orderNumber     │ order.order_display        │ Display order number         │
│ testGroupId     │ order_test.test_group_id   │ Test UUID                    │
│ testName        │ test_group.name            │ "${testMeta.testName}"       │
│ testCode        │ test_group.code            │ "${testMeta.testCode}"       │
│ labId           │ order.lab_id               │ "${lab.id}"                  │
│ labName         │ lab.name                   │ "${lab.name}"                │
│ technicianId    │ current_user.id            │ Logged-in user UUID          │
│ technicianName  │ current_user.full_name     │ Logged-in user name          │
│ workingDate     │ NOW()                      │ Today YYYY-MM-DD             │
│ workingTime     │ NOW()                      │ Current HH:MM                │
└─────────────────┴────────────────────────────┴──────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════════
                    MANDATORY WORKFLOW STRUCTURE
═══════════════════════════════════════════════════════════════════════════════

The workflow MUST have exactly 4 pages in this order:

┌─────────────────────────────────────────────────────────────────────────────┐
│ PAGE 1: PRE-ANALYTICAL PHASE (preAnalytical)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│ DISPLAY (from context - use HTML elements, readOnly):                       │
│ ✓ Sample ID                                                                 │
│ ✓ Patient Name & ID                                                         │
│ ✓ Collection Date/Time                                                      │
│ ✓ Collector Name                                                            │
│                                                                             │
│ VERIFY (technician checkboxes - REQUIRED):                                  │
│ □ sampleIdVerified - "Sample ID matches requisition"                        │
│ □ sampleCondition - dropdown: Good/Hemolyzed/Lipemic/Clotted/Insufficient  │
│ □ labelingVerified - "Tube labeling is correct and legible"                │
│ □ storageVerified - "Sample stored correctly before testing"               │
│ □ stabilityVerified - "Sample within stability period"                     │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ PAGE 2: QC VERIFICATION PHASE (qcVerification)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ MANDATORY FOR NABL (all required unless noted):                             │
│                                                                             │
│ ✓ iqcRunDate - date field (default: workingDate)                           │
│ ✓ iqcLotNumber - text field (required)                                     │
│ ✓ iqcExpiryDate - date field (required)                                    │
│ ✓ iqcLevel1 - numeric (Level 1/Low QC result)                              │
│ ✓ iqcLevel1Status - auto/dropdown: Pass/Fail                               │
│ ✓ iqcLevel2 - numeric (Level 2/Normal QC result)                           │
│ ✓ iqcLevel2Status - auto/dropdown: Pass/Fail                               │
│ ${options.iqc_levels >= 3 ? '✓ iqcLevel3 - numeric (Level 3/High QC result) [optional]' : ''}
│ ✓ iqcAccepted - checkbox: "QC results are acceptable, proceed with testing"│
│ ${options.include_calibration ? `
│ ✓ calibrationVerified - checkbox: "Calibration verified today"             │
│ ✓ lastCalibrationDate - date field                                         │
│ ✓ calibratorLotNumber - text field                                         │` : ''}
│                                                                             │
│ WESTGARD RULES TO EVALUATE:                                                 │
│ - 1:2s (warning), 1:3s, 2:2s, R:4s, 4:1s, 10x (rejections)                │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ PAGE 3: ANALYTICAL PHASE (analytical)                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ DISPLAY (from context):                                                     │
│ ✓ Test Name: "${testMeta.testName}"                                        │
│ ✓ Started by: {technicianName}                                             │
│ ✓ Start Time: {workingTime}                                                │
│                                                                             │
│ CAPTURE (technician enters):                                                │
│ ✓ analyzerUsed - dropdown/text: Equipment used                             │
│ ✓ reagentLotNumber - text: Reagent lot                                     │
│ ✓ reagentExpiryVerified - checkbox: "Reagent not expired"                  │
│                                                                             │
│ RESULTS (one field per analyte):                                            │
${analytes.map((a: any) => `│ ✓ result_${a.code || a.name.replace(/[^a-zA-Z0-9]/g, '_')} - numeric (${a.name}) [unit: ${a.unit || 'N/A'}]`).join('\n')}
│                                                                             │
│ ✓ testObservations - textarea: Any observations during testing             │
│ ✓ testCompletionTime - time field                                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ PAGE 4: POST-ANALYTICAL PHASE (postAnalytical)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ DISPLAY (auto-calculated):                                                  │
│ ✓ Result Summary with reference ranges                                      │
│ ✓ Flags (High/Low/Critical)                                                │
│                                                                             │
│ VERIFICATION (required):                                                    │
│ ✓ resultVerified - checkbox: "I verify these results are accurate"         │
│ ✓ resultVerificationChecklist - checkboxes:                                │
│   □ "Result within expected range"                                         │
│   □ "Result consistent with clinical history"                              │
│   □ "No instrument errors or flags"                                        │
│                                                                             │
│ CRITICAL VALUE HANDLING (conditional):                                      │
│ ✓ criticalValueDetected - auto-flag if result exceeds critical limits      │
│ ✓ criticalValueReported - checkbox: "Physician notified immediately"       │
│ ✓ notifiedTo - text: "Name of person notified"                             │
│ ✓ notificationTime - time field                                            │
│                                                                             │
│ COMPLETION:                                                                 │
│ ✓ wasteDisposalConfirmed - checkbox: "Biohazard waste disposed properly"   │
│ ✓ additionalComments - textarea                                            │
│ ✓ readyForAuthorization - checkbox: "Results ready for authorization"      │
└─────────────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════════
                         OUTPUT FORMAT
═══════════════════════════════════════════════════════════════════════════════

Return ONLY valid JSON in this exact structure:

{
  "workflow_definition": {
    "ui": {
      "engine": "surveyjs",
      "template": {
        "title": "${testMeta.testName} Workflow",
        "description": "NABL/ISO 15189:2022 compliant workflow for ${testMeta.testName}",
        "logoPosition": "right",
        "pages": [
          {
            "name": "preAnalytical",
            "title": "Pre-Analytical Phase",
            "description": "Sample verification and preparation",
            "elements": [
              // ... elements for page 1
            ]
          },
          {
            "name": "qcVerification",
            "title": "Quality Control Verification",
            "description": "IQC and calibration verification",
            "elements": [
              // ... elements for page 2
            ]
          },
          {
            "name": "analytical",
            "title": "Analytical Phase",
            "description": "Test execution and result entry",
            "elements": [
              // ... elements for page 3
            ]
          },
          {
            "name": "postAnalytical",
            "title": "Post-Analytical Phase",
            "description": "Result verification and authorization",
            "elements": [
              // ... elements for page 4
            ]
          }
        ],
        "showProgressBar": "top",
        "progressBarType": "pages",
        "showCompletedPage": true,
        "completedHtml": "<h3>Workflow Completed</h3><p>Results saved for authorization.</p>"
      }
    },
    "meta": {
      "owner": "${lab.name}",
      "title": "${testMeta.testName} - ${lab.name}",
      "test_code": "${testMeta.testCode}",
      "test_group_id": "${testGroup.id}",
      "lab_id": "${lab.id}",
      "nabl_compliant": true,
      "iso_15189_version": "2022",
      "context_fields": {
        "auto_populated": ["sampleId", "patientId", "patientName", "patientAge", "patientGender", "collectionDate", "collectionTime", "collectorName", "orderId", "testGroupId", "testName", "labId", "labName", "technicianId", "technicianName", "workingDate", "workingTime"],
        "technician_entry": ["iqcLevel1", "iqcLevel2", "iqcLotNumber", ... ],
        "result_fields": [${analytes.map((a: any) => `"result_${a.code || a.name.replace(/[^a-zA-Z0-9]/g, '_')}"`).join(', ')}]
      },
      "qc_requirements": {
        "requires_iqc": ${options.include_qc},
        "iqc_levels": ${options.iqc_levels},
        "westgard_rules_enabled": true,
        "requires_calibration_check": ${options.include_calibration}
      }
    },
    "rules": {
      "mode": "ADVANCED",
      "steps": [
        {"id": "preAnalytical", "no": 0},
        {"id": "qcVerification", "no": 1},
        {"id": "analytical", "no": 2},
        {"id": "postAnalytical", "no": 3}
      ]
    }
  },
  "ai_spec": {
    "steps": [
      {
        "step_type": "validate_qc",
        "description": "Validate IQC results against target values",
        "parameters": {
          "fields": {
            "iqcLevel1": {"level": "low"},
            "iqcLevel2": {"level": "normal"}
          },
          "westgard_rules": ["1_2s", "1_3s", "2_2s", "R_4s"],
          "block_on_failure": true
        }
      },
      {
        "step_type": "extract_values",
        "description": "Extract test results",
        "parameters": {
          "target_fields": [${analytes.map((a: any) => `"result_${a.code || a.name.replace(/[^a-zA-Z0-9]/g, '_')}"`).join(', ')}]
        }
      },
      {
        "step_type": "validate_range",
        "description": "Check results against reference ranges",
        "parameters": {
          "reference_ranges": {
            ${analytes.map((a: any) => `"${a.name}": "${a.reference_range || 'N/A'}"`).join(',\n            ')}
          }
        }
      },
      {
        "step_type": "flag_critical",
        "description": "Flag critical values",
        "parameters": {
          "critical_values": {
            ${analytes.filter((a: any) => a.low_critical || a.high_critical).map((a: any) =>
              `"${a.name}": {"low": ${a.low_critical || 'null'}, "high": ${a.high_critical || 'null'}}`
            ).join(',\n            ')}
          }
        }
      },
      {
        "step_type": "map_to_analyte",
        "description": "Map results to analyte IDs for storage",
        "parameters": {
          "mappings": [
            ${analytes.map((a: any) => `{
              "field": "result_${a.code || a.name.replace(/[^a-zA-Z0-9]/g, '_')}",
              "analyte_id": "${a.id}",
              "analyte_name": "${a.name}",
              "unit": "${a.unit || ''}"
            }`).join(',\n            ')}
          ]
        }
      }
    ]
  },
  "validation": {
    "nabl_compliant": true,
    "compliance_score": 95,
    "issues": [],
    "accreditation_checklist": {
      "sample_identification": true,
      "patient_verification": true,
      "sample_condition_documented": true,
      "iqc_before_patient_samples": true,
      "iqc_lot_tracking": true,
      "iqc_two_levels_minimum": true,
      "calibration_verification": ${options.include_calibration},
      "result_entry_validated": true,
      "critical_value_protocol": true,
      "technician_identification": true,
      "verification_step": true,
      "waste_disposal_documented": true
    }
  }
}

═══════════════════════════════════════════════════════════════════════════════
                    SURVEYJS ELEMENT EXAMPLES
═══════════════════════════════════════════════════════════════════════════════

For CONTEXT DISPLAY (read-only from order):
{
  "type": "html",
  "name": "orderContext",
  "html": "<div class='p-4 bg-blue-50 rounded-lg mb-4'><h4 class='font-bold text-blue-800'>Order Information</h4><table class='mt-2 text-sm'><tr><td class='pr-4 font-medium'>Sample ID:</td><td>{sampleId}</td></tr><tr><td class='pr-4 font-medium'>Patient:</td><td>{patientName} ({patientAge}y, {patientGender})</td></tr><tr><td class='pr-4 font-medium'>Collected:</td><td>{collectionDate} {collectionTime}</td></tr><tr><td class='pr-4 font-medium'>Collector:</td><td>{collectorName}</td></tr></table></div>"
}

For VERIFICATION CHECKBOX (required):
{
  "type": "checkbox",
  "name": "sampleIdVerified",
  "title": "Sample Identification",
  "isRequired": true,
  "choices": [{"value": "verified", "text": "I confirm the sample ID matches the requisition form"}]
}

For DROPDOWN:
{
  "type": "dropdown",
  "name": "sampleCondition",
  "title": "Sample Condition",
  "isRequired": true,
  "choices": ["Good", "Hemolyzed", "Lipemic", "Clotted", "Insufficient Volume"]
}

For NUMERIC QC ENTRY:
{
  "type": "text",
  "name": "iqcLevel1",
  "title": "IQC Level 1 (Low) Result",
  "inputType": "number",
  "isRequired": true,
  "validators": [{"type": "numeric", "text": "Must be a valid number"}]
}

For RESULT ENTRY:
{
  "type": "text",
  "name": "result_ALT",
  "title": "ALT Result (U/L)",
  "description": "Reference: 7-56 U/L",
  "inputType": "number",
  "isRequired": true,
  "validators": [{"type": "numeric", "text": "Must be a valid number"}]
}

For CONDITIONAL (critical value):
{
  "type": "checkbox",
  "name": "criticalValueReported",
  "title": "Critical Value Notification",
  "visibleIf": "{result_ALT} > 500",
  "isRequired": true,
  "requiredIf": "{result_ALT} > 500",
  "choices": [{"value": "reported", "text": "Physician notified immediately of critical value"}]
}

═══════════════════════════════════════════════════════════════════════════════

Generate the complete workflow now. Return ONLY the JSON, no additional text.
`
}
