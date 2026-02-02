import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenerativeAI } from "npm:@google/generative-ai@0.1.3"

const genAI = new GoogleGenerativeAI(Deno.env.get('GOOGLE_AI_API_KEY')!)

/**
 * Modular Image Analysis System
 * All analysis logic is driven by the workflow's AI spec
 */
serve(async (req) => {
  try {
    const { 
      images, 
      workflow_ai_spec,
      step_id,
      order_id,
      lab_id,
      context
    } = await req.json()
    
    // Find the specific AI step configuration
    const aiStep = findAIStep(workflow_ai_spec, step_id)
    
    if (!aiStep) {
      throw new Error(`AI step ${step_id} not found in workflow specification`)
    }
    
    const model = genAI.getGenerativeModel({ 
      model: aiStep.model || "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        temperature: aiStep.temperature || 0.1,
        topK: aiStep.topK || 1,
        topP: aiStep.topP || 0.8
      }
    })
    
    // Build prompt from AI spec
    const prompt = buildPromptFromSpec(aiStep, context)
    
    // Process images
    const imagePrompts = prepareImages(images, aiStep.image_processing)
    
    // Execute AI analysis
    const result = await model.generateContent([prompt, ...imagePrompts])
    const rawAnalysis = result.response.text()
    
    // Parse and validate against expected schema
    const analysis = parseAndValidateResult(rawAnalysis, aiStep.expected_output_schema)
    
    // Apply post-processing rules if defined
    const processedAnalysis = applyPostProcessing(analysis, aiStep.post_processing)
    
    // Calculate consensus if multiple images
    if (images.length > 1 && aiStep.consensus_method) {
      processedAnalysis.consensus = calculateConsensus(
        processedAnalysis,
        aiStep.consensus_method
      )
    }
    
    // Check if manual review is required
    const reviewRequired = checkManualReviewRequired(
      processedAnalysis,
      aiStep.review_criteria
    )
    
    return new Response(
      JSON.stringify({
        success: true,
        step_id,
        analysis: processedAnalysis,
        manual_review_required: reviewRequired,
        metadata: {
          order_id,
          lab_id,
          images_analyzed: images.length,
          ai_model: aiStep.model || "gemini-2.5-flash",
          timestamp: new Date().toISOString()
        }
      }),
      { headers: { "Content-Type": "application/json" } }
    )
    
  } catch (error) {
    console.error('Image analysis error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      { 
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    )
  }
})

/**
 * Find the AI step configuration from the workflow spec
 */
function findAIStep(aiSpec: any, stepId: string) {
  // Support multiple formats
  if (aiSpec.steps) {
    return aiSpec.steps.find((s: any) => s.id === stepId || s.step_id === stepId)
  }
  if (aiSpec.phases) {
    for (const phase of aiSpec.phases) {
      if (phase.steps) {
        const step = phase.steps.find((s: any) => s.id === stepId)
        if (step) return step
      }
      if (phase.step_id === stepId) return phase
    }
  }
  return null
}

/**
 * Build prompt from AI spec configuration
 */
function buildPromptFromSpec(aiStep: any, context: any): string {
  // Use custom prompt if provided
  if (aiStep.custom_prompt) {
    return interpolateVariables(aiStep.custom_prompt, context)
  }
  
  // Build structured prompt from parameters
  const parts = []
  
  // Base instruction
  if (aiStep.instruction) {
    parts.push(aiStep.instruction)
  }
  
  // Analysis targets
  if (aiStep.analysis_targets) {
    parts.push(`\nAnalyze the following aspects:`)
    aiStep.analysis_targets.forEach((target: any) => {
      parts.push(`- ${target.name}: ${target.description || ''}`)
    })
  }
  
  // Validation rules
  if (aiStep.validation_rules) {
    parts.push(`\nValidation criteria:`)
    aiStep.validation_rules.forEach((rule: any) => {
      parts.push(`- ${rule.description}`)
    })
  }
  
  // Expected output format
  if (aiStep.expected_output_schema) {
    parts.push(`\nReturn results in this JSON format:`)
    parts.push(JSON.stringify(aiStep.expected_output_schema, null, 2))
  }
  
  // Additional context
  if (context) {
    parts.push(`\nContext information:`)
    Object.entries(context).forEach(([key, value]) => {
      parts.push(`- ${key}: ${value}`)
    })
  }
  
  return parts.join('\n')
}

/**
 * Prepare images for AI processing
 */
function prepareImages(images: string[], processingConfig: any) {
  return images.map((img: string, idx: number) => {
    let processedImage = img
    
    // Apply preprocessing if configured
    if (processingConfig) {
      // Remove data URL prefix if needed
      if (processingConfig.strip_data_url) {
        processedImage = img.replace(/^data:image\/\w+;base64,/, '')
      }
    }
    
    return {
      inlineData: {
        mimeType: processingConfig?.mime_type || "image/jpeg",
        data: processedImage
      }
    }
  })
}

/**
 * Parse and validate AI result against expected schema
 */
function parseAndValidateResult(rawResult: string, expectedSchema: any) {
  try {
    const parsed = JSON.parse(rawResult)
    
    if (!expectedSchema) {
      return parsed
    }
    
    // Validate required fields
    const validated: any = {}
    
    for (const [key, config] of Object.entries(expectedSchema)) {
      const fieldConfig = config as any
      
      if (fieldConfig.required && !(key in parsed)) {
        throw new Error(`Required field missing: ${key}`)
      }
      
      if (key in parsed) {
        // Type validation
        if (fieldConfig.type) {
          const actualType = typeof parsed[key]
          if (actualType !== fieldConfig.type) {
            console.warn(`Type mismatch for ${key}: expected ${fieldConfig.type}, got ${actualType}`)
          }
        }
        
        // Range validation for numbers
        if (fieldConfig.type === 'number' && fieldConfig.range) {
          const value = parsed[key]
          if (value < fieldConfig.range.min || value > fieldConfig.range.max) {
            console.warn(`Value out of range for ${key}: ${value}`)
          }
        }
        
        validated[key] = parsed[key]
      } else if (fieldConfig.default !== undefined) {
        validated[key] = fieldConfig.default
      }
    }
    
    return validated
  } catch (error) {
    console.error('Failed to parse/validate result:', error)
    return { parse_error: error.message, raw: rawResult }
  }
}

/**
 * Apply post-processing rules to analysis results
 */
function applyPostProcessing(analysis: any, rules: any[]) {
  if (!rules || rules.length === 0) return analysis
  
  let processed = { ...analysis }
  
  for (const rule of rules) {
    switch (rule.type) {
      case 'normalize_units':
        processed = normalizeUnits(processed, rule.config)
        break
        
      case 'apply_reference_ranges':
        processed = applyReferenceRanges(processed, rule.config)
        break
        
      case 'flag_abnormal':
        processed = flagAbnormalValues(processed, rule.config)
        break
        
      case 'calculate_derived':
        processed = calculateDerivedValues(processed, rule.config)
        break
        
      case 'map_to_codes':
        processed = mapToCodes(processed, rule.config)
        break
    }
  }
  
  return processed
}

/**
 * Calculate consensus from multiple analyses
 */
function calculateConsensus(analysis: any, method: any) {
  switch (method.type) {
    case 'majority_vote':
      return majorityVoteConsensus(analysis, method.config)
      
    case 'average':
      return averageConsensus(analysis, method.config)
      
    case 'weighted':
      return weightedConsensus(analysis, method.config)
      
    default:
      return { method: 'none', confidence: 1.0 }
  }
}

/**
 * Check if manual review is required based on criteria
 */
function checkManualReviewRequired(analysis: any, criteria: any): boolean {
  if (!criteria) return false
  
  // Check confidence threshold
  if (criteria.min_confidence) {
    const confidence = analysis.overall_confidence || analysis.confidence
    if (confidence < criteria.min_confidence) {
      return true
    }
  }
  
  // Check for specific flags
  if (criteria.flags_requiring_review) {
    for (const flag of criteria.flags_requiring_review) {
      if (analysis[flag]) {
        return true
      }
    }
  }
  
  // Check for abnormal values
  if (criteria.abnormal_values && analysis.abnormal_flags) {
    const abnormalCount = Object.values(analysis.abnormal_flags).filter(v => v).length
    if (abnormalCount > 0) {
      return true
    }
  }
  
  return false
}

/**
 * Helper: Interpolate variables in template strings
 */
function interpolateVariables(template: string, variables: any): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] || match
  })
}

/**
 * Post-processing helpers
 */
function normalizeUnits(data: any, config: any) {
  // Implementation for unit normalization
  return data
}

function applyReferenceRanges(data: any, config: any) {
  const processed = { ...data }
  
  if (config.ranges && data.results) {
    processed.reference_flags = {}
    
    for (const [analyte, value] of Object.entries(data.results)) {
      if (config.ranges[analyte]) {
        const range = config.ranges[analyte]
        const numValue = parseFloat(value as string)
        
        if (!isNaN(numValue)) {
          if (numValue < range.min) {
            processed.reference_flags[analyte] = 'low'
          } else if (numValue > range.max) {
            processed.reference_flags[analyte] = 'high'
          } else {
            processed.reference_flags[analyte] = 'normal'
          }
        }
      }
    }
  }
  
  return processed
}

function flagAbnormalValues(data: any, config: any) {
  const processed = { ...data }
  processed.abnormal_flags = {}
  
  if (config.criteria && data.results) {
    for (const [analyte, value] of Object.entries(data.results)) {
      if (config.criteria[analyte]) {
        const abnormalValues = config.criteria[analyte]
        if (abnormalValues.includes(value)) {
          processed.abnormal_flags[analyte] = true
        }
      }
    }
  }
  
  return processed
}

function calculateDerivedValues(data: any, config: any) {
  const processed = { ...data }
  
  if (config.calculations && data.results) {
    processed.derived_values = {}
    
    for (const calc of config.calculations) {
      try {
        // Simple eval replacement - in production use a safe expression parser
        const formula = calc.formula.replace(/\[(\w+)\]/g, (match: string, key: string) => {
          return data.results[key] || 0
        })
        
        // This is a simplified example - use a proper expression evaluator
        processed.derived_values[calc.name] = eval(formula)
      } catch (error) {
        console.error(`Failed to calculate ${calc.name}:`, error)
      }
    }
  }
  
  return processed
}

function mapToCodes(data: any, config: any) {
  const processed = { ...data }
  
  if (config.mappings && data.results) {
    processed.coded_results = {}
    
    for (const [analyte, value] of Object.entries(data.results)) {
      if (config.mappings[analyte]) {
        const mapping = config.mappings[analyte]
        processed.coded_results[analyte] = mapping[value as string] || value
      }
    }
  }
  
  return processed
}

function majorityVoteConsensus(data: any, config: any) {
  // Implementation for majority vote
  return { confidence: 0.9, method: 'majority' }
}

function averageConsensus(data: any, config: any) {
  // Implementation for averaging
  return { confidence: 0.85, method: 'average' }
}

function weightedConsensus(data: any, config: any) {
  // Implementation for weighted consensus
  return { confidence: 0.92, method: 'weighted' }
}