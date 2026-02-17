const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-attachment-id, x-order-id, x-batch-id, x-multi-image, x-test-group-id',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Validate authentication - check for either JWT token or API key
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    const apiKey = req.headers.get('apikey') || req.headers.get('x-api-key');

    // Allow both anon key and service role key for backward compatibility
    console.log('Gemini NLP function invoked with auth');

    // Check for Gemini API key - try ALLGOOGLE_KEY first, then fallback to GEMINI_API_KEY
    const geminiApiKey = Deno.env.get('ALLGOOGLE_KEY') || Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      console.error('Google API key not configured');
      return new Response(
        JSON.stringify({ 
          error: 'Google API key not configured',
          details: 'Please set ALLGOOGLE_KEY or GEMINI_API_KEY in Supabase secrets'
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Reset per-request caches
    _analytesCache = null;

    const payload = await req.json();

    const {
      rawText,
      visionResults,
      originalBase64Image,
      documentType,
      testType,
      base64Image,
      aiProcessingType,
      aiPromptOverride,
      pipetteDetails,
      expectedColor,
      analyteCatalog,
      analytesToExtract,
      orderId: bodyOrderId,
      testGroupId,
    } = payload as GeminiRequest & {
      analyteCatalog?: Array<{ id?: string; name?: string | null; unit?: string | null; reference_range?: string | null; code?: string | null }>;
      analytesToExtract?: string[];
      orderId?: string;
      testGroupId?: string;
    };
    
    console.log('\n📨 Gemini NLP Request Received:');
    console.log(`  - AI Processing Type: ${aiProcessingType || 'not provided'}`);
    console.log(`  - Document Type: ${documentType || 'not provided'}`);
    console.log(`  - Test Type: ${testType || 'not provided'}`);
    console.log(`  - Has rawText: ${!!rawText} (${rawText?.length || 0} chars)`);
    console.log(`  - Has base64Image: ${!!base64Image}`);
    console.log(`  - Has originalBase64Image: ${!!originalBase64Image}`);
    console.log(`  - Has visionResults: ${!!visionResults}`);
    console.log(`  - Has aiPromptOverride: ${!!aiPromptOverride} (${aiPromptOverride?.length || 0} chars)`);
    console.log(`  - Order ID: ${bodyOrderId || 'not provided'}`);
    console.log(`  - Test Group ID: ${testGroupId || 'not provided'}`);
    console.log(`  - Analytes to extract: ${analytesToExtract?.length || 0}`);

    const focusAnalyteNames = deriveAnalyteFocusList(analyteCatalog, analytesToExtract);
    const extractionTargets = Array.isArray(analytesToExtract)
      ? analytesToExtract.filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
      : [];

    let prompt = '';
    let geminiResponse = '';

    console.log(`\n🤖 Starting Gemini NLP processing for ${aiProcessingType || documentType || testType || 'unknown'} type`);

    // Check if we need to use Gemini Vision fallback for OCR
    const shouldUseFallback = documentType && 
                             (!rawText || rawText.trim().length < 10) && 
                             originalBase64Image;

    if (shouldUseFallback) {
      console.log('Vision OCR extracted insufficient text, using Gemini Vision fallback');
      prompt = applyAnalyteFocus(generatePrompt('vision', documentType, 'fallback'), focusAnalyteNames, extractionTargets);
      geminiResponse = await callGemini(prompt, geminiApiKey, originalBase64Image);
    } else if (aiPromptOverride && aiPromptOverride.trim().length > 0) {
      console.log('Using custom AI prompt override');
      // Enforce JSON-only response for custom prompts with analyte name guidance
      const enforcedPrompt = enforceJsonResponse(aiPromptOverride, extractionTargets);
      prompt = applyAnalyteFocus(enforcedPrompt, focusAnalyteNames, extractionTargets);
      geminiResponse = await callGemini(prompt, geminiApiKey, originalBase64Image);
    } else if (aiProcessingType) {
      // Use aiProcessingType for modern configuration
      console.log('Using aiProcessingType configuration:', aiProcessingType);
      
      if (aiProcessingType === 'ocr_report') {
        if (!rawText) {
          return new Response(
            JSON.stringify({ error: 'Missing rawText for OCR processing' }),
            { 
              status: 400, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        prompt = applyAnalyteFocus(
          generatePrompt('ocr', 'printed-report', rawText),
          focusAnalyteNames,
          extractionTargets,
        );
        geminiResponse = await callGemini(prompt, geminiApiKey);
      } else if (aiProcessingType === 'vision_card') {
        prompt = applyAnalyteFocus(
          generatePrompt('vision', 'test-card', JSON.stringify(visionResults)),
          focusAnalyteNames,
          extractionTargets,
        );
        geminiResponse = await callGemini(prompt, geminiApiKey, base64Image || originalBase64Image);
      } else if (aiProcessingType === 'vision_color') {
        prompt = applyAnalyteFocus(
          generatePrompt('vision', 'color-analysis', JSON.stringify(visionResults)),
          focusAnalyteNames,
          extractionTargets,
        );
        geminiResponse = await callGemini(prompt, geminiApiKey, base64Image || originalBase64Image);
      } else {
        return new Response(
          JSON.stringify({ error: `Unsupported aiProcessingType: ${aiProcessingType}` }),
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
    } else if (documentType) {
      // OCR-based processing (legacy)
      if (!rawText) {
        return new Response(
          JSON.stringify({ error: 'Missing rawText for OCR processing' }),
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
      
      prompt = applyAnalyteFocus(
        generatePrompt('ocr', documentType, rawText),
        focusAnalyteNames,
        extractionTargets,
      );

    if (!geminiResponse) {
      return new Response(
        JSON.stringify({
          error: 'Gemini returned an empty response',
          details: {
            aiProcessingType,
            documentType,
            testType,
            analyteFocusNames: focusAnalyteNames,
            analyteExtractionTargets: extractionTargets,
            orderId: bodyOrderId || null,
            testGroupId: testGroupId || null,
          },
        }),
        {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }
      geminiResponse = await callGemini(prompt, geminiApiKey);
      
    } else if (testType === 'pipette-validation') {
      // Pipette validation processing
      prompt = applyAnalyteFocus(
        generatePrompt('vision', 'pipette-validation', JSON.stringify({visionResults, pipetteDetails, expectedColor})),
        focusAnalyteNames,
        extractionTargets,
      );
      geminiResponse = await callGemini(prompt, geminiApiKey, base64Image);
      
    } else if (testType) {
      // Photo analysis processing
      prompt = applyAnalyteFocus(
        generatePrompt('vision', testType, JSON.stringify(visionResults)),
        focusAnalyteNames,
        extractionTargets,
      );
      geminiResponse = await callGemini(prompt, geminiApiKey, base64Image);
      
    } else {
      return new Response(
        JSON.stringify({ error: 'Missing aiProcessingType, documentType, or testType' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const attachmentIdHeader = req.headers.get('x-attachment-id');
    const orderIdHeader = req.headers.get('x-order-id');
    const requestOrderId = orderIdHeader || bodyOrderId || null;

    console.log(`Gemini processing completed. Type: ${aiProcessingType || documentType || testType}. Response length: ${geminiResponse.length} characters`);

    // Clean and parse Gemini response - handle markdown code blocks
    let cleanedResponse = geminiResponse.trim();
    
    // Remove markdown code block markers if present
    if (cleanedResponse.startsWith('```json')) {
      cleanedResponse = cleanedResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanedResponse.startsWith('```')) {
      cleanedResponse = cleanedResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    
    // Parse Gemini response
    try {
      const jsonResponse = JSON.parse(cleanedResponse);
      
      // Handle different response types
      if (documentType === 'test-request-form') {
        // Test request form response
        const responseWithMetadata = {
          patient_details: jsonResponse.patient_details || {},
          requested_tests: jsonResponse.requested_tests || [],
          doctor_info: jsonResponse.doctor_info || {},
          metadata: {
            documentType: documentType || aiProcessingType,
            aiProcessingType: aiProcessingType || null,
            customPromptUsed: !!aiPromptOverride,
            processingMethod: 'Supabase Edge Functions + Gemini NLP',
            ocrConfidence: visionResults?.confidence || 0.95,
            extractedTextLength: rawText?.length || 0,
            processingTimestamp: new Date().toISOString(),
            analyteFocusNames: focusAnalyteNames,
            analyteExtractionTargets: extractionTargets,
            orderId: requestOrderId,
            testGroupId: testGroupId || null,
            analyteCatalogSize: analyteCatalog?.length || 0,
          }
        };
        
        return new Response(
          JSON.stringify(responseWithMetadata),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
        
      } else if (testType === 'pipette-validation') {
        // Pipette validation response
        const responseWithMetadata = {
          ...jsonResponse,
          metadata: {
            testType: testType || aiProcessingType,
            aiProcessingType: aiProcessingType || null,
            customPromptUsed: !!aiPromptOverride,
            processingMethod: 'Supabase Edge Functions + Gemini Vision',
            pipetteType: pipetteDetails?.name || 'Unknown',
            expectedColor: expectedColor || null,
            processingTimestamp: new Date().toISOString(),
            analyteFocusNames: focusAnalyteNames,
            analyteExtractionTargets: extractionTargets,
            orderId: requestOrderId,
            testGroupId: testGroupId || null,
            analyteCatalogSize: analyteCatalog?.length || 0,
          }
        };
        
        return new Response(
          JSON.stringify(responseWithMetadata),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
        
      } else if (testType) {
        // Photo analysis response
        const responseWithMetadata = {
          ...jsonResponse,
          metadata: {
            testType: testType || aiProcessingType,
            aiProcessingType: aiProcessingType || null,
            customPromptUsed: !!aiPromptOverride,
            processingMethod: 'Supabase Edge Functions + Gemini Vision',
            visionFeaturesUsed: Object.keys(visionResults || {}),
            processingTimestamp: new Date().toISOString(),
            analyteFocusNames: focusAnalyteNames,
            analyteExtractionTargets: extractionTargets,
            orderId: requestOrderId,
            testGroupId: testGroupId || null,
            analyteCatalogSize: analyteCatalog?.length || 0,
          }
        };
        
        return new Response(
          JSON.stringify(responseWithMetadata),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
        
      } else {
        // Default processing - lab results
        // Initial matching for Gemini extraction
        let enhancedParameters = await matchParametersToAnalytes(jsonResponse);
        
        // Optional: Validate and enhance with Claude Haiku 4.5 for OCR reports
        let validationApplied = false;
        if ((aiProcessingType === 'ocr_report' || documentType) && rawText && rawText.length > 10) {
          const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
          if (anthropicKey) {
            try {
              console.log('Applying Claude Haiku 4.5 validation and enhancement...');
              const validatedParams = await validateAndEnhanceWithClaude(
                enhancedParameters,
                rawText,
                focusAnalyteNames,
                anthropicKey
              );
              if (validatedParams && validatedParams.length > 0) {
                enhancedParameters = validatedParams;
                validationApplied = true;
                console.log(`Validation complete. Parameters after validation: ${enhancedParameters.length}`);
                
                // Re-run fuzzy matching on ALL parameters after Claude validation
                // This ensures newly added parameters and renamed ones get matched
                console.log('Re-running fuzzy matching on validated parameters...');
                enhancedParameters = await matchParametersToAnalytes(enhancedParameters);
                console.log(`After re-matching: ${enhancedParameters.filter(p => p.matched).length}/${enhancedParameters.length} matched`);
              }
            } catch (validationError) {
              console.warn('Claude validation failed, using original extraction:', validationError.message);
            }
          }
        }
        
        // ✅ STRICT FILTER: If focusAnalyteNames is specified, ONLY return those analytes
        // This is a safety net in case Gemini/Claude still return extra parameters
        if (focusAnalyteNames.length > 0) {
          const beforeCount = enhancedParameters.length;
          enhancedParameters = enhancedParameters.filter((param: any) => {
            const paramName = (param.parameter || '').toLowerCase();
            // Check if param matches any focus analyte (case-insensitive, partial match)
            return focusAnalyteNames.some(focus => {
              const focusLower = focus.toLowerCase();
              return paramName.includes(focusLower) || 
                     focusLower.includes(paramName) ||
                     paramName === focusLower;
            });
          });
          const afterCount = enhancedParameters.length;
          if (beforeCount !== afterCount) {
            console.log(`Strict filter applied: ${beforeCount} → ${afterCount} parameters (removed ${beforeCount - afterCount} non-matching)`);
          }
        }
        
        const responseWithMetadata = {
          extractedParameters: enhancedParameters,
          metadata: {
            documentType: documentType || aiProcessingType,
            aiProcessingType: aiProcessingType || null,
            customPromptUsed: !!aiPromptOverride,
            processingMethod: validationApplied 
              ? 'Supabase Edge Functions + Gemini NLP + Claude Validation' 
              : 'Supabase Edge Functions + Gemini NLP',
            ocrConfidence: visionResults?.confidence || 0.95,
            extractedTextLength: rawText?.length || 0,
            processingTimestamp: new Date().toISOString(),
            matchedParameters: enhancedParameters.filter(p => p.matched).length,
            totalParameters: enhancedParameters.length,
            validationApplied: validationApplied,
            analyteFocusNames: focusAnalyteNames,
            analyteExtractionTargets: extractionTargets,
            orderId: requestOrderId,
            testGroupId: testGroupId || null,
            analyteCatalogSize: analyteCatalog?.length || 0,
          }
        };

        // If attachmentId and orderId are provided, save AI extraction metadata to results
        const attachmentId = attachmentIdHeader;
        const orderId = requestOrderId;
        
        if (attachmentId && orderId && enhancedParameters.length > 0) {
          const supabaseUrl = Deno.env.get('SUPABASE_URL');
          const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
          
          if (supabaseUrl && supabaseServiceKey) {
            try {
              // Check if result already exists for this order
              const existingResultResponse = await fetch(
                `${supabaseUrl}/rest/v1/results?order_id=eq.${orderId}&select=id`,
                {
                  headers: {
                    'Authorization': `Bearer ${supabaseServiceKey}`,
                    'apikey': supabaseServiceKey,
                  },
                }
              );
              
              const existingResults = await existingResultResponse.json();
              
              if (existingResults && existingResults.length > 0) {
                // Update existing result with AI metadata
                await fetch(
                  `${supabaseUrl}/rest/v1/results?id=eq.${existingResults[0].id}`,
                  {
                    method: 'PATCH',
                    headers: {
                      'Authorization': `Bearer ${supabaseServiceKey}`,
                      'apikey': supabaseServiceKey,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      extracted_by_ai: true,
                      ai_confidence: visionResults?.confidence || 0.95,
                      ai_extraction_metadata: {
                        attachment_id: attachmentId,
                        processing_type: aiProcessingType || documentType,
                        custom_prompt_used: !!aiPromptOverride,
                        extraction_timestamp: new Date().toISOString(),
                        parameters_found: enhancedParameters.length,
                        parameters_matched: enhancedParameters.filter(p => p.matched).length,
                        extracted_parameters: enhancedParameters
                      }
                    })
                  }
                );
                console.log(`Updated existing result ${existingResults[0].id} with AI extraction metadata`);
              }
            } catch (updateError) {
              console.error('Failed to update result with AI metadata:', updateError);
              // Don't fail the request if metadata update fails
            }
          }
        }
        
        return new Response(
          JSON.stringify(responseWithMetadata),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
      
    } catch (jsonError) {
      console.warn('Gemini response was not valid JSON, attempting repair...');
      console.log('Cleaned response that failed to parse:', cleanedResponse.substring(0, 500));

      // ── STEP A: Try to repair truncated JSON ──
      const repaired = tryRepairTruncatedJson(cleanedResponse);
      if (repaired) {
        console.log(`JSON repair succeeded! Recovered ${repaired.length} parameters`);

        // Run the same matching + validation pipeline as the happy path
        let enhancedParameters = await matchParametersToAnalytes(repaired);

        if ((aiProcessingType === 'ocr_report' || documentType) && rawText && rawText.length > 10) {
          const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
          if (anthropicKey) {
            try {
              const validated = await validateAndEnhanceWithClaude(
                enhancedParameters, rawText, focusAnalyteNames, anthropicKey,
              );
              if (validated && validated.length > 0) {
                enhancedParameters = await matchParametersToAnalytes(validated);
              }
            } catch (_e) { /* non-blocking */ }
          }
        }

        if (focusAnalyteNames.length > 0) {
          enhancedParameters = enhancedParameters.filter((param: any) => {
            const pn = (param.parameter || '').toLowerCase();
            return focusAnalyteNames.some(f => {
              const fl = f.toLowerCase();
              return pn.includes(fl) || fl.includes(pn) || pn === fl;
            });
          });
        }

        return new Response(
          JSON.stringify({
            extractedParameters: enhancedParameters,
            metadata: {
              documentType: documentType || aiProcessingType,
              aiProcessingType: aiProcessingType || null,
              customPromptUsed: !!aiPromptOverride,
              processingMethod: 'Supabase Edge Functions + Gemini (JSON repaired)',
              processingTimestamp: new Date().toISOString(),
              matchedParameters: enhancedParameters.filter((p: any) => p.matched).length,
              totalParameters: enhancedParameters.length,
              jsonRepaired: true,
            },
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // ── STEP B: Haiku fallback – send OCR text directly for primary extraction ──
      const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
      if (anthropicKey && rawText && rawText.length > 10) {
        console.log('JSON repair failed. Invoking Haiku fallback for primary extraction...');
        try {
          const haikuParams = await extractWithHaikuFallback(
            rawText,
            focusAnalyteNames,
            extractionTargets,
            prompt, // send original Gemini prompt as context
            cleanedResponse, // send Gemini's broken response as context
            anthropicKey,
          );

          if (haikuParams && haikuParams.length > 0) {
            let enhancedParameters = await matchParametersToAnalytes(haikuParams);

            if (focusAnalyteNames.length > 0) {
              enhancedParameters = enhancedParameters.filter((param: any) => {
                const pn = (param.parameter || '').toLowerCase();
                return focusAnalyteNames.some(f => {
                  const fl = f.toLowerCase();
                  return pn.includes(fl) || fl.includes(pn) || pn === fl;
                });
              });
            }

            console.log(`Haiku fallback succeeded: ${enhancedParameters.length} parameters`);

            return new Response(
              JSON.stringify({
                extractedParameters: enhancedParameters,
                metadata: {
                  documentType: documentType || aiProcessingType,
                  aiProcessingType: aiProcessingType || null,
                  customPromptUsed: !!aiPromptOverride,
                  processingMethod: 'Supabase Edge Functions + Gemini (failed) + Haiku Fallback',
                  processingTimestamp: new Date().toISOString(),
                  matchedParameters: enhancedParameters.filter((p: any) => p.matched).length,
                  totalParameters: enhancedParameters.length,
                  haikuFallback: true,
                },
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
          }
        } catch (haikuError) {
          console.error('Haiku fallback also failed:', haikuError.message);
        }
      }

      // ── STEP C: All repair/fallback failed – return raw text ──
      console.warn('All parsing strategies failed. Returning raw text.');
      return new Response(
        JSON.stringify({
          rawText: cleanedResponse,
          extractedParameters: [],
          originalResponse: geminiResponse,
          metadata: {
            documentType: documentType || testType || aiProcessingType,
            aiProcessingType: aiProcessingType || null,
            customPromptUsed: !!aiPromptOverride,
            processingMethod: 'Supabase Edge Functions + Gemini',
            processingTimestamp: new Date().toISOString(),
            parseError: true,
          },
          message: 'All parsing strategies failed (direct parse, JSON repair, Haiku fallback).'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error) {
    console.error('Gemini NLP function error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Gemini processing failed', 
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

interface GeminiRequest {
  rawText?: string;
  visionResults?: any;
  documentType?: string;
  testType?: string;
  base64Image?: string;
  originalBase64Image?: string;
  pipetteDetails?: any;
  expectedColor?: any;
  aiProcessingType?: string;
  aiPromptOverride?: string;
  analyteCatalog?: AnalyteCatalogEntry[];
  analytesToExtract?: AnalytesToExtract;
  orderId?: string;
  testGroupId?: string;
}

type AnalyteCatalogEntry = {
  id?: string;
  name?: string | null;
  unit?: string | null;
  reference_range?: string | null;
  code?: string | null;
};

type AnalytesToExtract = string[] | string | null | undefined;

/**
 * Prompt template configurations
 */
const PROMPT_TEMPLATES = {
  base: "You are a medical lab assistant AI. Return only a valid JSON object, no additional text.",

  formats: {
    labResult: `[{"parameter": "Name", "value": "15.1", "unit": "g/dL", "reference_range": "12.0-17.5", "flag": "Normal"}]`,
    testCard: `{"testType": "Test Card", "testResult": "Result", "details": {}, "confidenceLevel": 95, "interpretation": "Analysis"}`,
    patientForm: `{"patient_details": {"first_name": "", "last_name": "", "age": 0, "gender": "", "phone": "", "email": ""}, "requested_tests": [], "doctor_info": {"name": ""}}`
  },

  instructions: {
    ocr: `Extract lab parameters with these STRICT rules:
- parameter: Use the FULL analyte name from the mapping below (e.g., "Hemoglobin" NOT "HGB")
- value: ONLY the numeric value WITHOUT any unit, multiplier, or flag letter (e.g., "11.1" NOT "11.1L", "7.4" NOT "7.4 x10^3/uL")
- unit: The complete unit INCLUDING any multiplier (e.g., "x10^3/µL", "g/dL", "x10^6/µL", "%", "fL")
- reference_range: The normal range (e.g., "4.5-11.0", "12.0-17.5")
- flag: "Normal", "High", or "Low". If value has "H" suffix = "High", "L" suffix = "Low", red color = abnormal

CRITICAL RULES:
1. "value" must be NUMERIC ONLY. Strip flag letters (H/L/C) from values (e.g., "11.1L" → value:"11.1", flag:"Low")
2. Never include units or multipliers in the value field
3. Extract ALL parameters shown - do not skip any rows
4. For percentage values in brackets like [19.5 %], extract as separate parameter with unit "%"

HEMATOLOGY ANALYZER CODE MAPPING (use full names in output):
| Analyzer Code | Full Parameter Name |
|---------------|---------------------|
| WBC | White Blood Cell Count |
| RBC | Red Blood Cell Count |
| HGB / Hb | Hemoglobin |
| HCT / PCV | Hematocrit |
| MCV | Mean Corpuscular Volume |
| MCH | Mean Corpuscular Hemoglobin |
| MCHC | Mean Corpuscular Hemoglobin Concentration |
| PLT | Platelet Count |
| RDW / RDW-CV | Red Cell Distribution Width |
| RDW-SD | Red Cell Distribution Width SD |
| MPV | Mean Platelet Volume |
| PDW | Platelet Distribution Width |
| PCT / P-LCR | Plateletcrit |
| NEU / NEUT | Neutrophils |
| LY / LYM | Lymphocytes |
| MO / MON | Monocytes |
| EOS / EO | Eosinophils |
| BAS / BA | Basophils |
| GR / GRAN | Granulocytes |
| NEU% | Neutrophils % |
| LY% / LYM% | Lymphocytes % |
| MO% / MON% | Monocytes % |
| EOS% | Eosinophils % |
| BAS% | Basophils % |
| GR% | Granulocytes % |
| NEU# | Absolute Neutrophil Count |
| LY# / LYM# | Absolute Lymphocyte Count |
| MO# / MON# | Absolute Monocyte Count |
| EOS# | Absolute Eosinophil Count |
| BAS# | Absolute Basophil Count |
| GR# | Absolute Granulocyte Count |
| IG / IG% | Immature Granulocytes |
| NRBC | Nucleated Red Blood Cells |
| RET / RET% | Reticulocyte Count |

3-PART DIFF ANALYZERS: Show LY, MO, GR (or LY%, MO%, GR%) - extract both absolute and % values.
5-PART DIFF ANALYZERS: Show NEU, LY, MO, EOS, BAS - extract both absolute and % values.

BIOCHEMISTRY ANALYZER CODE MAPPING:
| Code | Full Name |
|------|-----------|
| GLU / FBS / RBS / PPBS | Blood Glucose |
| BUN / UREA | Blood Urea / Urea |
| CREAT / CR | Creatinine |
| UA / URIC | Uric Acid |
| CHOL / TC | Total Cholesterol |
| TG / TRIG | Triglycerides |
| HDL | HDL Cholesterol |
| LDL | LDL Cholesterol |
| VLDL | VLDL Cholesterol |
| SGOT / AST | Aspartate Aminotransferase (SGOT) |
| SGPT / ALT | Alanine Aminotransferase (SGPT) |
| ALP | Alkaline Phosphatase |
| GGT / GGTP | Gamma Glutamyl Transferase |
| TBIL / T.BIL | Total Bilirubin |
| DBIL / D.BIL | Direct Bilirubin |
| TP | Total Protein |
| ALB | Albumin |
| GLOB | Globulin |
| A/G | Albumin/Globulin Ratio |
| NA / Na+ | Sodium |
| K / K+ | Potassium |
| CL / Cl- | Chloride |
| CA / Ca++ | Calcium |
| PHOS / PO4 | Phosphorus |
| MG | Magnesium |
| AMY / AMYL | Amylase |
| LIP | Lipase |
| CK / CPK | Creatine Kinase |
| LDH | Lactate Dehydrogenase |
| FE / IRON | Serum Iron |
| TIBC | Total Iron Binding Capacity |
| FERR | Ferritin |

IMMUNOASSAY / HORMONE CODES:
| Code | Full Name |
|------|-----------|
| TSH | Thyroid Stimulating Hormone |
| T3 | Triiodothyronine (T3) |
| T4 | Thyroxine (T4) |
| FT3 | Free T3 |
| FT4 | Free T4 |
| HBA1C / A1C | Glycated Hemoglobin (HbA1c) |
| PSA | Prostate Specific Antigen |
| VIT D / 25OH | Vitamin D (25-Hydroxy) |
| VIT B12 | Vitamin B12 |
| FOL | Folate |
| CRP / hsCRP | C-Reactive Protein |
| ESR | Erythrocyte Sedimentation Rate |
| RF | Rheumatoid Factor |
| ASO | Anti-Streptolysin O |
| PT | Prothrombin Time |
| INR | International Normalized Ratio |
| APTT / PTT | Activated Partial Thromboplastin Time |
| D-DIMER | D-Dimer |
| FIB | Fibrinogen |
| HBsAg | Hepatitis B Surface Antigen |
| HIV | HIV Antibody |
| WIDAL | Widal Test |
| VDRL / RPR | VDRL / Syphilis Screen |
| βhCG / BHCG | Beta HCG |
| PROLACTIN / PRL | Prolactin |
| LH | Luteinizing Hormone |
| FSH | Follicle Stimulating Hormone |
| TESTO | Testosterone |
| CORTISOL | Cortisol |
| INSULIN | Insulin |

URINALYSIS CODES:
| Code | Full Name |
|------|-----------|
| SG / SP.GR | Specific Gravity |
| PH | pH |
| PRO | Protein (Urine) |
| GLU (urine) | Glucose (Urine) |
| KET | Ketones |
| BIL (urine) | Bilirubin (Urine) |
| UBG | Urobilinogen |
| NIT | Nitrite |
| LEU / WBC (urine) | Leukocytes (Urine) |
| RBC (urine) | Red Blood Cells (Urine) |
| EPI | Epithelial Cells |`,
    vision: "Analyze for diagnostic results focusing on: control/test lines, color changes, overall test validity",
    form: "Extract patient details and requested tests from form"
  }
};

/**
 * Enforce JSON-only response for custom prompts
 */
function enforceJsonResponse(customPrompt: string, analyteNames: string[] = []): string {
  // Add strong JSON-only instructions
  let jsonEnforcement = `
CRITICAL INSTRUCTIONS:
1. You MUST respond with ONLY a valid JSON object
2. Do NOT include any explanatory text before or after the JSON
3. Do NOT use markdown code blocks like \`\`\`json
4. Start your response directly with { and end with }
5. Ensure all JSON is properly formatted and parseable

VALUE EXTRACTION RULES:
- "value" must contain ONLY the numeric portion (e.g., "7.4" NOT "7.4 x10^3/uL")
- "unit" must contain the complete unit INCLUDING multipliers (e.g., "x10^3/µL", "g/dL")
- Never combine numeric values with units in the value field

`;

  // If analyte names are provided, instruct Gemini to use them as keys
  if (analyteNames.length > 0) {
    jsonEnforcement += `
PARAMETER NAMING REQUIREMENT:
Use these EXACT parameter names as keys in your JSON response:
${analyteNames.map((name, idx) => `${idx + 1}. "${name}"`).join('\n')}

Your JSON should have this structure:
{
  "${analyteNames[0]}": "extracted value (numeric only)",
  "${analyteNames[1]}": "extracted value (numeric only)",
  ...
}

`;
  }

  return jsonEnforcement + customPrompt + '\n\nRemember: Return ONLY the JSON object with the exact parameter names specified above. Values must be numeric only.';
}

/**
 * Generate optimized prompts
 */
function generatePrompt(type: string, subtype: string, data: string): string {
  const { base, formats, instructions } = PROMPT_TEMPLATES;

  if (type === 'ocr') {
    return `${base}

From this ${subtype} text, ${instructions.ocr}

EXAMPLE - If OCR text shows:
  WBC
  7.4
  x10^3/UL
  4.5-11.0

Return:
  {"parameter": "WBC", "value": "7.4", "unit": "x10^3/µL", "reference_range": "4.5-11.0", "flag": "Normal"}

Notice: value is "7.4" (numeric only), unit is "x10^3/µL" (includes multiplier)

Expected format: ${formats.labResult}

Text to extract from:
${data}`;
  }
  
  if (type === 'vision') {
    return `${base}\n\nAnalyze this ${subtype} image. ${instructions.vision}\n\nExpected format: ${formats.testCard}\n\nVision AI data: ${data}`;
  }
  
  if (type === 'form') {
    return `${base}\n\nFrom this form, ${instructions.form}\n\nExpected format: ${formats.patientForm}\n\nText: ${data}`;
  }
  
  return `${base}\n\nAnalyze this ${subtype} and extract relevant medical data.\n\nExpected format: ${formats.labResult}\n\nData: ${data}`;
}

/**
 * Generate pipette validation prompt
 */
function generatePipettePrompt(visionResults: any, pipetteDetails: any, expectedColor: any): string {
  return `You are a laboratory pipette validation expert. Return only a valid JSON object, no additional text.

Analyze this pipette validation image:

Vision AI detected colors: ${JSON.stringify(visionResults.colors?.slice(0, 3) || [])}
Vision AI detected objects: ${JSON.stringify(visionResults.objects?.slice(0, 5) || [])}

Pipette Details: ${JSON.stringify(pipetteDetails || {})}
Expected Patient Color: ${JSON.stringify(expectedColor || {})}

Expected format:
{
  "volume": 1000,
  "measuredVolume": 995,
  "accuracy": 99.5,
  "precision": 1.2,
  "passFailStatus": "Pass",
  "imageQuality": "Good",
  "validationResults": [
    {
      "volume": 1000,
      "measured": 995,
      "accuracy": 99.5,
      "precision": 1.2,
      "date": "2024-01-20",
      "status": "Pass",
      "imageQuality": "Good",
      "liquidLevel": "Clear detection"
    }
  ]
}

Focus on:
- Liquid volume estimation from meniscus level
- Color validation against expected patient color
- Image quality assessment
- ISO 8655 compliance validation`;
}

/**
 * Call Google Gemini API
 */
async function callGemini(prompt: string, geminiApiKey: string, imageData?: string): Promise<any> {
  // Use updated Gemini models and API endpoint
  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;

  let requestBody;
  
  if (imageData) {
    // Remove data URL prefix if present
    const cleanBase64 = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
    
    // For image-based requests
    requestBody = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: 'image/jpeg',
                data: cleanBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        topK: 32,
        topP: 1,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    };
  } else {
    // For text-only requests
    requestBody = {
      contents: [
        {
          parts: [
            { text: prompt }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        topK: 32,
        topP: 1,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      }
    };
  }

  console.log(`Calling Gemini API with model: ${model}`);
  
  // Retry with exponential backoff for rate limiting (429)
  const MAX_RETRIES = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayMs = Math.min(1000 * Math.pow(2, attempt), 8000) + Math.random() * 1000;
      console.log(`⏳ Gemini 429 retry ${attempt}/${MAX_RETRIES} after ${Math.round(delayMs)}ms...`);
      await new Promise(r => setTimeout(r, delayMs));
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (response.status === 429) {
      const errorText = await response.text();
      console.warn(`Gemini API rate limited (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`, errorText);
      lastError = new Error(`Gemini API error: 429 Too Many Requests - ${errorText}`);
      continue; // retry
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API Error Details:', errorText);
      throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    
    // Check for API errors in response
    if (result.error) {
      throw new Error(`Gemini API response error: ${result.error.message}`);
    }
    
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
      console.error('No text in Gemini response:', JSON.stringify(result, null, 2));
      throw new Error('No response from Gemini');
    }

    return text;
  }

  // All retries exhausted
  throw lastError || new Error('Gemini API rate limited after all retries');
}

/**
 * Match extracted parameters to database analytes
 */
/**
 * Parse numeric value and extract flag character (L/H/C) if present
 * Examples: "11.1L" -> { value: "11.1", flag: "L" }
 *           "4.91" -> { value: "4.91", flag: null }
 *           "10.5H" -> { value: "10.5", flag: "H" }
 */
function parseValueAndFlag(rawValue: string): { value: string; extractedFlag: string | null } {
  if (!rawValue || typeof rawValue !== 'string') {
    return { value: rawValue, extractedFlag: null };
  }

  const trimmed = rawValue.trim();
  
  // Check if value ends with a flag character (L, H, C, LL, HH)
  const flagPattern = /^([\d\.\-\+\s,]+?)([LHC]{1,2})$/i;
  const match = trimmed.match(flagPattern);
  
  if (match) {
    const numericPart = match[1].trim();
    const flagPart = match[2].toUpperCase();
    
    // Validate that the numeric part is actually a valid number
    if (!isNaN(parseFloat(numericPart))) {
      return { 
        value: numericPart, 
        extractedFlag: flagPart 
      };
    }
  }
  
  // No flag found or invalid format, return as-is
  return { value: trimmed, extractedFlag: null };
}

// Per-request cache for analytes to avoid duplicate DB fetches
let _analytesCache: any[] | null = null;

async function matchParametersToAnalytes(extractedParameters: any): Promise<any[]> {
  try {
    // Handle non-array inputs (e.g., custom JSON objects from vision_color)
    if (!Array.isArray(extractedParameters)) {
      console.log('extractedParameters is not an array, converting to parameter format');
      
      // Convert flat object directly to parameter array
      // e.g., { "ABO Blood Group": "A", "Rh Blood Group": "Positive" } 
      // becomes [{ parameter: "ABO Blood Group", value: "A", ... }, ...]
      const parametersArray = [];
      
      for (const [paramName, paramValue] of Object.entries(extractedParameters)) {
        // Skip non-data fields
        if (['testType', 'testResult', 'confidenceLevel', 'interpretation', 'valid', 'controlLine'].includes(paramName)) {
          continue;
        }
        
        // Parse value to extract flag if present
        let cleanValue = typeof paramValue === 'object' ? JSON.stringify(paramValue) : String(paramValue);
        let extractedFlag = null;
        
        if (typeof paramValue === 'string') {
          const parsed = parseValueAndFlag(paramValue);
          cleanValue = parsed.value;
          extractedFlag = parsed.extractedFlag;
        }
        
        parametersArray.push({
          parameter: paramName,
          value: cleanValue,
          unit: '',
          reference_range: '',
          flag: extractedFlag || 'Normal',
          matched: false,
          confidence: 0.95
        });
      }
      
      extractedParameters = parametersArray;
      console.log(`Converted object to ${parametersArray.length} parameters`);
    }

    // Handle empty array
    if (extractedParameters.length === 0) {
      console.log('extractedParameters is empty array');
      return [];
    }

    // Use cached analytes if available (avoids duplicate DB fetch within same request)
    let analytes = _analytesCache;
    if (!analytes) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

      if (!supabaseUrl || !supabaseServiceKey) {
        console.warn('Supabase configuration missing, skipping analyte matching');
        return extractedParameters;
      }

      const analytesResponse = await fetch(
        supabaseUrl + '/rest/v1/analytes?select=id,name,unit,reference_range',
        {
          headers: {
            'Authorization': 'Bearer ' + supabaseServiceKey,
            'apikey': supabaseServiceKey,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!analytesResponse.ok) {
        console.warn('Failed to fetch analytes, skipping matching');
        return extractedParameters;
      }

      analytes = await analytesResponse.json();
      _analytesCache = analytes;
      console.log(`Fetched ${analytes.length} analytes from DB (cached for this request)`);
    } else {
      console.log(`Using cached analytes (${analytes.length} entries)`);
    }

    // Common medical abbreviations mapping
    // Includes standard analyzer codes (WBC, RBC, HGB, etc.) used by hematology analyzers
    const abbreviationMap: Record<string, string[]> = {
      // CBC - Complete Blood Count core parameters
      'wbc': ['white blood cell', 'white blood cell count', 'leukocyte', 'leukocyte count', 'total wbc', 'twbc'],
      'rbc': ['red blood cell', 'red blood cell count', 'erythrocyte', 'erythrocyte count', 'total rbc', 'trbc'],
      'hgb': ['hemoglobin', 'haemoglobin', 'hb', 'hgb'],
      'hct': ['hematocrit', 'haematocrit', 'packed cell volume', 'pcv'],
      'plt': ['platelet', 'platelet count', 'thrombocyte', 'thrombocyte count', 'platelets'],
      'mcv': ['mean corpuscular volume', 'mean cell volume'],
      'mch': ['mean corpuscular hemoglobin', 'mean cell hemoglobin'],
      'mchc': ['mean corpuscular hemoglobin concentration', 'mean cell hemoglobin concentration'],
      'rdw': ['red cell distribution width', 'red blood cell distribution width', 'rdw-cv'],
      'rdw-cv': ['red cell distribution width cv', 'rdw cv', 'red cell distribution width coefficient of variation'],
      'rdw-sd': ['red cell distribution width sd', 'rdw sd', 'red cell distribution width standard deviation'],
      'mpv': ['mean platelet volume'],
      'pdw': ['platelet distribution width'],
      'pct': ['plateletcrit', 'platelet crit', 'thrombocrit'],
      // Granulocytes (3-part diff analyzers use GR)
      'gr': ['granulocyte', 'granulocytes', 'granulocyte count', 'gran', 'gran%'],
      'gr%': ['granulocyte', 'granulocytes', 'granulocyte %', 'granulocyte percentage', 'gran%'],
      'gr#': ['granulocyte', 'granulocytes', 'absolute granulocyte', 'absolute granulocyte count'],
      // Neutrophils - all variations (5-part diff)
      'neu': ['neutrophil', 'neutrophils', 'neutrophil count', 'neut'],
      'neux': ['neutrophil', 'neutrophils', 'neutrophil count', 'neutrophil %', 'neutrophil percentage'],
      'neu%': ['neutrophil', 'neutrophils', 'neutrophil %', 'neutrophil percentage', 'neutrophil percent'],
      'neu#': ['neutrophil', 'neutrophils', 'absolute neutrophil', 'absolute neutrophil count', 'neutrophil count', 'anc'],
      // Lymphocytes - all variations (LY is common on analyzers)
      'ly': ['lymphocyte', 'lymphocytes', 'lymphocyte count', 'lym'],
      'lym': ['lymphocyte', 'lymphocytes', 'lymphocyte count', 'ly'],
      'ly%': ['lymphocyte', 'lymphocytes', 'lymphocyte %', 'lymphocyte percentage', 'lym%'],
      'lym%': ['lymphocyte', 'lymphocytes', 'lymphocyte %', 'lymphocyte percentage', 'lymphocyte percent'],
      'ly#': ['lymphocyte', 'lymphocytes', 'absolute lymphocyte', 'absolute lymphocyte count', 'lym#'],
      'lym#': ['lymphocyte', 'lymphocytes', 'absolute lymphocyte', 'absolute lymphocyte count', 'lymphocyte count'],
      // Monocytes - all variations (MO is common on analyzers)
      'mo': ['monocyte', 'monocytes', 'monocyte count', 'mon'],
      'mon': ['monocyte', 'monocytes', 'monocyte count', 'mo'],
      'mo%': ['monocyte', 'monocytes', 'monocyte %', 'monocyte percentage', 'mon%'],
      'monx': ['monocyte', 'monocytes', 'monocyte count', 'monocyte %', 'monocyte percentage'],
      'mon%': ['monocyte', 'monocytes', 'monocyte %', 'monocyte percentage', 'monocyte percent'],
      'mo#': ['monocyte', 'monocytes', 'absolute monocyte', 'absolute monocyte count', 'mon#'],
      'mon#': ['monocyte', 'monocytes', 'absolute monocyte', 'absolute monocyte count', 'monocyte count'],
      // Eosinophils - all variations
      'eos': ['eosinophil', 'eosinophils', 'eosinophil count', 'eo'],
      'eo': ['eosinophil', 'eosinophils', 'eosinophil count', 'eos'],
      'e05': ['eosinophil', 'eosinophils', 'eosinophil count', 'eosinophil %', 'eosinophil percentage'],
      'eos%': ['eosinophil', 'eosinophils', 'eosinophil %', 'eosinophil percentage', 'eosinophil percent'],
      'eos#': ['eosinophil', 'eosinophils', 'absolute eosinophil', 'absolute eosinophil count', 'eosinophil count', 'aec'],
      // Basophils - all variations
      'bas': ['basophil', 'basophils', 'basophil count', 'ba'],
      'ba': ['basophil', 'basophils', 'basophil count', 'bas'],
      'bas%': ['basophil', 'basophils', 'basophil %', 'basophil percentage', 'basophil percent'],
      'bas#': ['basophil', 'basophils', 'absolute basophil', 'absolute basophil count', 'basophil count'],
      // Chemistry
      'glu': ['glucose', 'blood glucose', 'blood sugar'],
      'bun': ['blood urea nitrogen', 'urea nitrogen'],
      'cr': ['creatinine', 'serum creatinine'],
      'na': ['sodium', 'serum sodium'],
      'k': ['potassium', 'serum potassium'],
      'cl': ['chloride', 'serum chloride'],
      'ca': ['calcium', 'serum calcium'],
      'mg': ['magnesium', 'serum magnesium'],
      'alt': ['alanine aminotransferase', 'sgpt', 'alanine transaminase'],
      'ast': ['aspartate aminotransferase', 'sgot', 'aspartate transaminase'],
      'alp': ['alkaline phosphatase'],
      'tbil': ['total bilirubin', 'bilirubin total'],
      'dbil': ['direct bilirubin', 'bilirubin direct'],
      'tp': ['total protein', 'serum protein'],
      'alb': ['albumin', 'serum albumin'],
      'tsh': ['thyroid stimulating hormone', 'thyrotropin'],
      't3': ['triiodothyronine', 'total t3'],
      't4': ['thyroxine', 'total t4'],
      'ft3': ['free triiodothyronine', 'free t3'],
      'ft4': ['free thyroxine', 'free t4'],
      'psa': ['prostate specific antigen'],
      'hba1c': ['hemoglobin a1c', 'glycated hemoglobin', 'glycosylated hemoglobin'],
      'ldl': ['low density lipoprotein', 'ldl cholesterol'],
      'hdl': ['high density lipoprotein', 'hdl cholesterol'],
      'vldl': ['very low density lipoprotein', 'vldl cholesterol'],
      'tg': ['triglyceride', 'triglycerides'],
      'chol': ['cholesterol', 'total cholesterol'],
      'esr': ['erythrocyte sedimentation rate', 'sed rate'],
      'crp': ['c-reactive protein'],
      'pt': ['prothrombin time'],
      'inr': ['international normalized ratio'],
      'aptt': ['activated partial thromboplastin time', 'ptt'],
    };

    // Helper function to find best match
    const findBestMatch = (paramName: string, analytes: any[]): any => {
      const normalizedParam = paramName.toLowerCase().trim();
      
      // 1. Exact match (case-insensitive)
      let match = analytes.find((a: any) => 
        a.name.toLowerCase().trim() === normalizedParam
      );
      if (match) return match;
      
      // 2. Check abbreviation map
      const possibleFullNames = abbreviationMap[normalizedParam] || [];
      for (const fullName of possibleFullNames) {
        match = analytes.find((a: any) => 
          a.name.toLowerCase().includes(fullName.toLowerCase())
        );
        if (match) return match;
      }
      
      // 3. Reverse lookup - check if param is in any analyte's abbreviation list
      for (const [abbrev, fullNames] of Object.entries(abbreviationMap)) {
        if (fullNames.some(fn => normalizedParam.includes(fn.toLowerCase()))) {
          match = analytes.find((a: any) => 
            a.name.toLowerCase().includes(abbrev) || 
            fullNames.some(fn => a.name.toLowerCase().includes(fn.toLowerCase()))
          );
          if (match) return match;
        }
      }
      
      // 4. Partial match - param contains analyte name or vice versa
      match = analytes.find((a: any) => {
        const analyteName = a.name.toLowerCase().trim();
        return analyteName.includes(normalizedParam) || normalizedParam.includes(analyteName);
      });
      if (match) return match;
      
      // 5. Word-based fuzzy match (check if key words match)
      const paramWords = normalizedParam.split(/\s+/).filter(w => w.length > 2);
      if (paramWords.length > 0) {
        match = analytes.find((a: any) => {
          const analyteWords = a.name.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
          return paramWords.some(pw => analyteWords.some((aw: string) => aw.includes(pw) || pw.includes(aw)));
        });
        if (match) return match;
      }
      
      return null;
    };

    // Match each extracted parameter to analytes
    const enhancedParameters = extractedParameters.map(param => {
      // Parse value to extract flag if present in value string
      let cleanValue = param.value;
      let extractedFlag = param.flag;
      
      if (typeof param.value === 'string') {
        const parsed = parseValueAndFlag(param.value);
        cleanValue = parsed.value;
        // Use extracted flag if no explicit flag was provided
        if (!extractedFlag || extractedFlag === 'Normal') {
          extractedFlag = parsed.extractedFlag || extractedFlag;
        }
      }
      
      const matchedAnalyte = findBestMatch(param.parameter, analytes);

      if (matchedAnalyte) {
        return {
          ...param,
          value: cleanValue,
          flag: extractedFlag,
          analyte_id: matchedAnalyte.id,
          matched: true,
          matched_to: matchedAnalyte.name, // Track what it matched to
          reference_range: param.reference_range || matchedAnalyte.reference_range,
          unit: param.unit || matchedAnalyte.unit
        };
      }

      return {
        ...param,
        value: cleanValue,
        flag: extractedFlag,
        matched: false
      };
    });

    console.log(`Matched ${enhancedParameters.filter(p => p.matched).length} of ${extractedParameters.length} parameters to database analytes`);

    return enhancedParameters;

  } catch (error) {
    console.warn('Error matching parameters to analytes:', error);
    return extractedParameters;
  }
}

function deriveAnalyteFocusList(
  catalog: AnalyteCatalogEntry[] = [],
  requestedAnalytes: AnalytesToExtract,
): string[] {
  const catalogEntries = catalog.filter((entry) => (entry?.name || '').trim().length > 0);
  const catalogNames = uniqueStrings(
    catalogEntries.map((entry) => (entry.name || '').trim()),
  );

  const requestedList = normalizeAnalyteList(requestedAnalytes);

  if (requestedList.length === 0) {
    return catalogNames;
  }

  const nameLookup = new Map<string, string>();
  const codeLookup = new Map<string, string>();

  catalogEntries.forEach((entry) => {
    const normalizedName = normalizeIdentifier(entry.name);
    const normalizedCode = normalizeIdentifier(entry.code);

    if (normalizedName) {
      nameLookup.set(normalizedName, (entry.name || '').trim());
    }

    if (normalizedCode && entry.name) {
      codeLookup.set(normalizedCode, entry.name.trim());
    }
  });

  const resolvedNames = requestedList
    .map((identifier) => {
      const normalized = normalizeIdentifier(identifier);
      if (!normalized) {
        return null;
      }

      return nameLookup.get(normalized) || codeLookup.get(normalized) || identifier;
    })
    .filter((value): value is string => !!value && value.trim().length > 0);

  return resolvedNames.length > 0 ? uniqueStrings(resolvedNames) : catalogNames;
}

function normalizeIdentifier(value?: string | null): string {
  return (value || '').trim().toLowerCase();
}

function normalizeAnalyteList(input: AnalytesToExtract): string[] {
  if (!input) {
    return [];
  }

  if (Array.isArray(input)) {
    return uniqueStrings(
      input
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0),
    );
  }

  if (typeof input === 'string') {
    return uniqueStrings(
      input
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    );
  }

  return [];
}

function uniqueStrings(values: string[]): string[] {
  return [
    ...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  ];
}

function applyAnalyteFocus(
  basePrompt: string,
  focusAnalytes: string[],
  extractionTargets: string[],
): string {
  if (focusAnalytes.length === 0 && extractionTargets.length === 0) {
    return basePrompt;
  }

  const focusInstructions: string[] = [];

  // STRICT filtering - only extract the specified analytes
  if (focusAnalytes.length > 0) {
    focusInstructions.push(
      `CRITICAL: ONLY extract results for these specific analytes (IGNORE ALL OTHERS): ${focusAnalytes.join(', ')}`,
    );
    focusInstructions.push(
      `If a parameter in the image/text is NOT in the above list, DO NOT include it in your response.`,
    );
  }

  if (extractionTargets.length > 0) {
    focusInstructions.push(
      `STRICT: Return structured output ONLY for these analytes: ${extractionTargets.join(', ')}`,
    );
  }

  // Add common CBC code mappings to help AI understand abbreviations
  focusInstructions.push(`
COMMON ANALYZER CODES (use these to match parameters):
- WBC = White Blood Cell Count (Leukocyte)
- RBC = Red Blood Cell Count (Erythrocyte)
- HGB/Hb = Hemoglobin
- HCT/PCV = Hematocrit
- MCV = Mean Corpuscular Volume
- MCH = Mean Corpuscular Hemoglobin
- MCHC = Mean Corpuscular Hemoglobin Concentration
- PLT = Platelet Count
- RDW = Red Cell Distribution Width
- MPV = Mean Platelet Volume
- PDW = Platelet Distribution Width
- PCT = Plateletcrit
- LY/LYM = Lymphocyte
- MO/MON = Monocyte
- GR/GRAN = Granulocyte (3-part diff)
- NEU = Neutrophil (5-part diff)
- EOS/EO = Eosinophil
- BAS/BA = Basophil
`);

  return `${basePrompt}\n\n${focusInstructions.join('\n')}`;
}

/**
 * Validate and enhance extracted parameters using Claude 3.5 Haiku
 * This function:
 * 1. Validates medical accuracy of extracted parameters
 * 2. Finds missing parameters from the original OCR text
 * 3. Corrects obvious errors in units, values, or flags
 */
async function validateAndEnhanceWithClaude(
  extractedParams: any[],
  originalOcrText: string,
  focusAnalytes: string[],
  anthropicKey: string
): Promise<any[]> {
  // Truncate OCR text if too long (keep first 3000 chars to stay within token limits)
  const truncatedOcr = originalOcrText.length > 3000 
    ? originalOcrText.substring(0, 3000) + '...[truncated]'
    : originalOcrText;

  // Determine if we should strictly filter to focus analytes
  const strictFilter = focusAnalytes.length > 0;

  const validationPrompt = `You are a medical laboratory validation AI. Your task is to validate and enhance extracted lab parameters.

EXTRACTED PARAMETERS (from initial AI extraction):
${JSON.stringify(extractedParams, null, 2)}

ORIGINAL OCR TEXT:
${truncatedOcr}

${strictFilter ? `
⚠️ STRICT FILTER MODE - VERY IMPORTANT ⚠️
You MUST ONLY return parameters from this list: ${focusAnalytes.join(', ')}
DO NOT add any parameters that are NOT in the above list, even if they appear in the OCR text.
If a parameter is not in the allowed list, REMOVE it from the output.
` : ''}

VALIDATION TASKS:
1. **Medical Validation**: Check if values, units, and reference ranges are medically plausible
${strictFilter ? '2. **Filter Check**: REMOVE any parameters NOT in the allowed list above' : '2. **Missing Parameters**: Find any parameters in the OCR text that were not extracted'}
3. **Error Correction**: Fix obvious errors in:
   - Units (e.g., "x10^3/µL" vs "x10^3/uL")
   - Values (ensure numeric only, no units mixed in)
   - Flags (Normal/High/Low based on reference range)
   - Reference ranges (proper format like "4.5-11.0")

RULES:
${strictFilter ? '- ONLY include parameters that match the allowed list above\n- REMOVE any parameter not in the allowed list\n' : '- Keep all correctly extracted parameters\n- Add any missing parameters found in OCR text\n'}- Fix errors but preserve the original structure
- Return ONLY valid JSON array with this exact format:
[{
  "parameter": "string",
  "value": "string (numeric only)",
  "unit": "string",
  "reference_range": "string",
  "flag": "Normal|High|Low|Abnormal",
  "matched": boolean,
  "analyte_id": "string or null",
  "validation_notes": "string (optional, only if corrected)"
}]

Return the complete validated array. Do not include explanatory text.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10000,
        temperature: 0.3,
        messages: [{ role: 'user', content: validationPrompt }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.content?.[0]?.text) {
      throw new Error('Invalid response from Claude');
    }

    let responseText = data.content[0].text.trim();
    
    // Clean markdown if present
    if (responseText.startsWith('```json')) {
      responseText = responseText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (responseText.startsWith('```')) {
      responseText = responseText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    // Find JSON array
    const jsonStart = responseText.indexOf('[');
    const jsonEnd = responseText.lastIndexOf(']');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      responseText = responseText.substring(jsonStart, jsonEnd + 1);
    }

    const validatedParams = JSON.parse(responseText);
    
    if (!Array.isArray(validatedParams)) {
      throw new Error('Claude did not return an array');
    }

    console.log(`Claude validation: ${extractedParams.length} → ${validatedParams.length} parameters`);
    
    return validatedParams;

  } catch (error) {
    console.error('Claude validation error:', error);
    throw error;
  }
}

/**
 * Try to repair truncated JSON arrays.
 * Gemini sometimes hits token limit and returns incomplete JSON like:
 *   [{"parameter":"WBC","value":"10.5","unit":"x10^3/µL","reference_range":"","flag":"Normal"},{"parameter":"Hb","value":"11.1","unit":"g/dL","reference_range":"",
 * We try to salvage the complete objects before the truncation point.
 */
function tryRepairTruncatedJson(text: string): any[] | null {
  try {
    let cleaned = text.trim();

    // Remove markdown fences if leftover
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\s*/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\s*/, '');
    }
    cleaned = cleaned.replace(/\s*```$/, '');

    // Must look like an array start
    if (!cleaned.startsWith('[')) return null;

    // Strategy 1: Find the last complete object by looking for "},"  or "}"
    // and close the array there
    const lastCompleteObj = cleaned.lastIndexOf('},');
    const lastObj = cleaned.lastIndexOf('}');

    let candidate = '';

    if (lastCompleteObj > 0) {
      // Cut after the last complete "}, " and close array
      candidate = cleaned.substring(0, lastCompleteObj + 1) + ']';
    } else if (lastObj > 0) {
      // Try cutting after last "}"
      candidate = cleaned.substring(0, lastObj + 1) + ']';
    } else {
      return null;
    }

    const parsed = JSON.parse(candidate);
    if (Array.isArray(parsed) && parsed.length > 0) {
      console.log(`tryRepairTruncatedJson: recovered ${parsed.length} items from truncated JSON`);
      return parsed;
    }

    return null;
  } catch (_e) {
    // Strategy 2: progressively remove trailing characters until it parses
    let cleaned = text.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json\s*/, '');
    else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\s*/, '');
    cleaned = cleaned.replace(/\s*```$/, '');

    if (!cleaned.startsWith('[')) return null;

    for (let i = cleaned.length; i > 10; i--) {
      const slice = cleaned.substring(0, i);
      // Try closing as array
      const attempts = [slice + ']', slice + '"}]', slice + '"}]', slice + '"} ]'];
      for (const attempt of attempts) {
        try {
          const result = JSON.parse(attempt);
          if (Array.isArray(result) && result.length > 0) {
            console.log(`tryRepairTruncatedJson (progressive): recovered ${result.length} items`);
            return result;
          }
        } catch { /* keep trying */ }
      }
    }

    return null;
  }
}

/**
 * Haiku fallback: when Gemini fails to return valid JSON,
 * send the original OCR text + Gemini context to Haiku for primary extraction.
 */
async function extractWithHaikuFallback(
  ocrText: string,
  focusAnalytes: string[],
  extractionTargets: string[],
  originalGeminiPrompt: string,
  brokenGeminiResponse: string,
  anthropicKey: string,
): Promise<any[]> {
  const truncatedOcr = ocrText.length > 4000
    ? ocrText.substring(0, 4000) + '...[truncated]'
    : ocrText;

  // Include partial Gemini response as hint (first 1500 chars)
  const geminiHint = brokenGeminiResponse.length > 1500
    ? brokenGeminiResponse.substring(0, 1500) + '...[truncated]'
    : brokenGeminiResponse;

  const strictFilter = focusAnalytes.length > 0;

  const fallbackPrompt = `You are a medical laboratory data extraction AI. Extract lab test parameters from OCR text.

${strictFilter ? `STRICT FILTER: ONLY extract these parameters: ${focusAnalytes.join(', ')}
DO NOT include any parameters not in this list.\n` : ''}
OCR TEXT FROM LAB REPORT:
${truncatedOcr}

PARTIAL AI EXTRACTION (incomplete/broken, use as hints):
${geminiHint}

EXTRACTION RULES:
1. Extract EVERY test parameter with: parameter name, numeric value (no units in value), unit, reference_range, flag
2. "value" must be NUMERIC ONLY (e.g. "7.4" not "7.4 x10^3/uL")
3. "unit" must include multipliers (e.g. "x10^3/µL", "g/dL")
4. "flag" must be one of: "Normal", "High", "Low", "Abnormal"
5. Use the partial extraction above as hints - it may have correct values even if the JSON was truncated

Return ONLY a valid JSON array:
[{"parameter": "Name", "value": "15.1", "unit": "g/dL", "reference_range": "12.0-17.5", "flag": "Normal"}]

No markdown, no explanation, ONLY the JSON array.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8000,
      temperature: 0.1,
      messages: [{ role: 'user', content: fallbackPrompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Haiku fallback API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  if (!data.content?.[0]?.text) {
    throw new Error('Empty response from Haiku fallback');
  }

  let responseText = data.content[0].text.trim();

  // Clean markdown
  if (responseText.startsWith('```json')) {
    responseText = responseText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (responseText.startsWith('```')) {
    responseText = responseText.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  // Find JSON array boundaries
  const jsonStart = responseText.indexOf('[');
  const jsonEnd = responseText.lastIndexOf(']');
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    responseText = responseText.substring(jsonStart, jsonEnd + 1);
  }

  const parsed = JSON.parse(responseText);
  if (!Array.isArray(parsed)) {
    throw new Error('Haiku fallback did not return an array');
  }

  console.log(`Haiku fallback extracted ${parsed.length} parameters from OCR text`);
  return parsed;
}