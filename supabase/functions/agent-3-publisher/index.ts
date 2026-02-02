import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PublisherRequest {
  protocol_id: string;
  workflow_version_id: string;
  lab_id: string;
  test_group_id?: string | null;
  test_code?: string | null;
  overrides?: {
    name?: string;
    description?: string;
    publish_results?: boolean;
  };
}

interface PublisherResponse {
  workflow_id: string;
  test_code: string;
  ui_config: any;
  result_mapping: any;
  publication_status: 'success' | 'partial' | 'failed';
  deployment_notes: string[];
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('No authorization header')
    }

    // Initialize Supabase client with service role for publishing operations
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    )

    // Verify user authentication first with anon key
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    )

    const { data: { user }, error: authError } = await anonClient.auth.getUser()
    if (authError || !user) {
      throw new Error('Invalid authentication')
    }

    // Parse request body
    const { 
      protocol_id, 
      workflow_version_id, 
      lab_id, 
      test_group_id, 
      test_code,
      overrides = {}
    }: PublisherRequest = await req.json()

    if (!protocol_id || !workflow_version_id || !lab_id) {
      throw new Error('Protocol ID, workflow version ID, and lab ID are required')
    }

    // Fetch workflow version details
    const { data: workflowVersion, error: versionError } = await supabaseClient
      .from('workflow_versions')
      .select(`
        *,
        workflows(*)
      `)
      .eq('id', workflow_version_id)
      .single()

    if (versionError || !workflowVersion) {
      throw new Error('Workflow version not found')
    }

    // Fetch protocol details
    const { data: protocol, error: protocolError } = await supabaseClient
      .from('ai_protocols')
      .select('*')
      .eq('id', protocol_id)
      .single()

    if (protocolError || !protocol) {
      throw new Error('AI protocol not found')
    }

    // Determine test code
    const finalTestCode = test_code || 
                         workflowVersion.metadata?.test_code || 
                         protocol.config?.test_meta?.testCode ||
                         `WF_${Date.now()}`

    // Generate UI config for the workflow configurator
    const uiConfig = {
      workflow_type: 'test_procedure',
      display_name: overrides.name || workflowVersion.metadata?.display_name || `${finalTestCode} Workflow`,
      description: overrides.description || workflowVersion.workflows?.description || 'Auto-generated test workflow',
      test_code: finalTestCode,
      lab_id: lab_id,
      version: workflowVersion.version,
      created_from: 'manual_ingestion',
      auto_publish_results: overrides.publish_results ?? true,
      requires_approval: true,
      supports_mobile: true,
      theme: {
        primary_color: '#3b82f6',
        accent_color: '#10b981'
      }
    }

    // Generate result mapping configuration
    const aiSpec = workflowVersion.definition?.ai_spec || {};
    const resultMapping = {
      test_code: finalTestCode,
      lab_id: lab_id,
      extraction_rules: aiSpec?.steps || [],
      validation_settings: {
        require_all_fields: true,
        auto_flag_critical: true,
        confidence_threshold: 0.8
      },
      output_format: {
        result_table: 'results',
        value_table: 'result_values',
        status_field: 'verify_status',
        confidence_field: 'ai_confidence'
      },
      analyte_mappings: extractAnalyteMappings(aiSpec),
      post_processing: {
        auto_calculate: true,
        apply_flags: true,
        validate_ranges: true
      }
    }

    // Get Gemini API key for final validation
    const geminiApiKey = Deno.env.get('ALLGOOGLE_KEY')
    if (!geminiApiKey) {
      throw new Error('Gemini API key not configured')
    }

    // Perform final publication validation
    const validationPrompt = getPublicationValidationPrompt()
    const validationData = {
      workflow_version: workflowVersion,
      protocol: protocol,
      ui_config: uiConfig,
      result_mapping: resultMapping,
      test_code: finalTestCode
    }

    const fullPrompt = `${validationPrompt}

PUBLICATION DATA:
${JSON.stringify(validationData, null, 2)}

Validate this workflow for production deployment and return publication assessment.`

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: fullPrompt
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2048,
            responseMimeType: "application/json"
          }
        })
      }
    )

    let validationResult = { deployment_safe: true, notes: [] }
    if (geminiResponse.ok) {
      const geminiData = await geminiResponse.json()
      if (geminiData.candidates?.[0]?.content?.parts?.[0]?.text) {
        try {
          validationResult = JSON.parse(geminiData.candidates[0].content.parts[0].text)
        } catch (e) {
          console.warn('Failed to parse validation result:', e)
        }
      }
    }

    // Update workflow version with test_group_id if provided
    if (test_group_id) {
      const { error: updateError } = await supabaseClient
        .from('workflow_versions')
        .update({ test_group_id: test_group_id })
        .eq('id', workflow_version_id)
      
      if (updateError) {
        console.warn('Failed to update workflow_versions with test_group_id:', updateError)
      } else {
        console.log(`Successfully linked workflow_version ${workflow_version_id} to test_group ${test_group_id}`)

        // Also update test_workflow_map to make this the active/default workflow for the test group
        // First, unset any existing default for this test group
        await supabaseClient
          .from('test_workflow_map')
          .update({ is_default: false })
          .eq('test_group_id', test_group_id)
          .eq('lab_id', lab_id);

        // Then insert/update the mapping for this new version
        const { error: mapError } = await supabaseClient
          .from('test_workflow_map')
          .insert({
            lab_id: lab_id,
            test_group_id: test_group_id,
            test_code: finalTestCode,
            workflow_version_id: workflow_version_id,
            is_default: true
          });

        if (mapError) {
           console.error('Failed to update test_workflow_map:', mapError);
           // Not throwing error to allow partial success, but logging it
        } else {
           console.log(`Successfully mapped workflow to test group ${test_group_id} in test_workflow_map`);
        }
      }
    }

    // Log publication activity
    await supabaseClient
      .from('ai_usage_logs')
      .insert({
        user_id: user.id,
        lab_id: lab_id,
        processing_type: 'workflow_publisher',
        input_data: { 
          protocol_id, 
          workflow_version_id, 
          test_code: finalTestCode 
        },
        confidence: validationResult.deployment_safe ? 0.95 : 0.7,
        created_at: new Date().toISOString()
      })

    const response: PublisherResponse = {
      workflow_id: workflowVersion.workflows?.id || workflow_version_id,
      test_code: finalTestCode,
      ui_config: uiConfig,
      result_mapping: resultMapping,
      publication_status: validationResult.deployment_safe ? 'success' : 'partial',
      deployment_notes: validationResult.notes || []
    }

    return new Response(
      JSON.stringify(response),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )

  } catch (error) {
    console.error('Error in publisher:', error)
    
    return new Response(
      JSON.stringify({
        error: error.message,
        workflow_id: null,
        test_code: null,
        ui_config: null,
        result_mapping: null,
        publication_status: 'failed',
        deployment_notes: [`Publication failed: ${error.message}`]
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      },
    )
  }
})

function extractAnalyteMappings(aiSpec: any): any[] {
  if (!aiSpec?.steps) return []
  
  return aiSpec.steps
    .filter((step: any) => step.step_type === 'map_to_analyte' && step.parameters?.target_analyte_id)
    .map((step: any) => ({
      analyte_id: step.parameters.target_analyte_id,
      workflow_field: step.parameters.target_fields?.[0] || 'unknown',
      unit_conversion: step.parameters.units || null,
      validation_rule: step.parameters.validation_rules || []
    }))
}

function getPublicationValidationPrompt(): string {
  return `You are an AI agent responsible for validating laboratory workflows before production deployment. Assess the workflow for safety, completeness, and compliance.

OUTPUT FORMAT:
{
  "deployment_safe": boolean,
  "confidence_score": number,
  "notes": [
    "string - deployment note or warning"
  ],
  "required_reviews": [
    "string - area requiring manual review before deployment"
  ],
  "compliance_checks": {
    "has_quality_controls": boolean,
    "has_safety_warnings": boolean,
    "has_proper_validation": boolean,
    "analyte_mappings_complete": boolean
  }
}

VALIDATION CRITERIA:

1. SAFETY VALIDATION:
   - All critical steps have proper validation
   - Safety warnings are present where needed
   - Error handling is adequate
   - Critical value flagging is configured

2. COMPLETENESS CHECK:
   - All required workflow steps are present
   - Analyte mappings are complete and accurate
   - Result extraction rules cover all outputs
   - UI configuration is production-ready

3. COMPLIANCE VALIDATION:
   - Quality control steps are included
   - Traceability is maintained
   - Audit trail requirements are met
   - Data integrity safeguards are in place

4. INTEGRATION READINESS:
   - Result mapping aligns with database schema
   - UI configuration is valid
   - Test code is unique and appropriate
   - Lab-specific customizations are preserved

Return deployment recommendation and any areas requiring attention before going live.`
}