import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface DocumentAnalysisRequest {
  documentType: 'pdf' | 'image' | 'color_card';
  content: string; // Base64 or text content
  testContext?: {
    testId: string;
    analyteIds?: string[];
    expectedFormat?: string;
  };
  customPrompt?: string;
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

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    )

    // Verify user authentication
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
    if (authError || !user) {
      throw new Error('Invalid authentication')
    }

    // Get user's lab_id for context
    const { data: userData } = await supabaseClient
      .from('users')
      .select('lab_id, role')
      .eq('id', user.id)
      .single()

    // Parse request body
    const { documentType, content, testContext, customPrompt }: DocumentAnalysisRequest = await req.json()

    if (!documentType || !content) {
      throw new Error('Document type and content are required')
    }

    // Get AI prompt from database with context-specific fallbacks
    const { data: promptData } = await supabaseClient.rpc('resolve_ai_prompt', {
      p_processing_type: documentType === 'color_card' ? 'color_card' : 
                         documentType === 'pdf' ? 'document_analysis' : 'ocr',
      p_test_id: testContext?.testId || null,
      p_analyte_id: testContext?.analyteIds?.[0] || null,
      p_lab_id: userData?.lab_id || null
    })

    let systemPrompt = promptData?.[0]?.prompt || getDefaultDocumentAnalysisPrompt(documentType)

    // Apply custom prompt override if provided
    if (customPrompt) {
      systemPrompt = customPrompt
    }

    // Add test context to prompt if available
    if (testContext) {
      systemPrompt += `

TEST CONTEXT:
- Test ID: ${testContext.testId}
- Expected Analytes: ${testContext.analyteIds?.join(', ') || 'Not specified'}
- Expected Format: ${testContext.expectedFormat || 'Standard lab report'}`
    }

    systemPrompt += `

DOCUMENT TYPE: ${documentType}

Return ONLY valid JSON with no additional text.`

    // Call Gemini API
    const geminiApiKey = Deno.env.get('ALLGOOGLE_KEY')
    if (!geminiApiKey) {
      throw new Error('Gemini API key not configured')
    }

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
                  text: `${systemPrompt}\n\nCONTENT TO ANALYZE:\n${content}`
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.3, // Lower temperature for more consistent extraction
            maxOutputTokens: 2048,
            responseMimeType: "application/json"
          }
        })
      }
    )

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text()
      throw new Error(`Gemini API error: ${errorText}`)
    }

    const geminiData = await geminiResponse.json()
    
    if (!geminiData.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error('Invalid response format from Gemini API')
    }

    const responseText = geminiData.candidates[0].content.parts[0].text
    let parsedResponse

    try {
      parsedResponse = JSON.parse(responseText)
    } catch (parseError) {
      throw new Error(`Failed to parse AI response: ${parseError}`)
    }

    // Log usage for analytics (optional)
    await supabaseClient
      .from('ai_usage_logs')
      .insert({
        user_id: user.id,
        lab_id: userData?.lab_id,
        processing_type: documentType,
        input_data: { documentType, testContext },
        confidence: parsedResponse.confidence || 0,
        created_at: new Date().toISOString()
      })

    return new Response(
      JSON.stringify({
        success: true,
        data: parsedResponse
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )

  } catch (error) {
    console.error('Error in AI document processor:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      },
    )
  }
})

function getDefaultDocumentAnalysisPrompt(documentType: string): string {
  const basePrompt = `You are a medical laboratory AI assistant specialized in extracting test results from documents.

REQUIREMENTS:
1. Return valid JSON matching this interface:
{
  "extractedData": {
    "analyte_name": {
      "value": number | string,
      "unit": "string",
      "reference_range": "string",
      "flag": "normal|high|low|critical"
    }
  },
  "confidence": number,
  "processingType": "${documentType}",
  "suggestions": ["string"],
  "errors": ["string"]
}

2. Extract numeric values with proper units
3. Identify test names and corresponding results
4. Flag any critical or abnormal values
5. Provide confidence score (0-1) for extraction accuracy`

  switch (documentType) {
    case 'color_card':
      return basePrompt + `

SPECIFIC FOR COLOR CARDS:
- Analyze color patterns against reference charts
- Provide semi-quantitative results (negative, trace, 1+, 2+, 3+, etc.)
- Consider lighting and image quality in confidence scoring
- Flag any critical positive results`

    case 'pdf':
      return basePrompt + `

SPECIFIC FOR PDF DOCUMENTS:
- Parse structured lab reports
- Extract patient demographics when present
- Identify document type (lab report, requisition, result summary)
- Extract all test results in structured format`

    default: // OCR/image
      return basePrompt + `

SPECIFIC FOR OCR/IMAGES:
- Extract text from instrument displays and reports
- Handle various fonts and layouts
- Account for OCR quality in confidence scoring
- Validate extracted numeric values`
  }
}
