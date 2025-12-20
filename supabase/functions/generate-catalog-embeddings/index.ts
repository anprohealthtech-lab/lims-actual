import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleGenerativeAI } from 'npm:@google/generative-ai'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface EmbeddingRequest {
  labId: string
  analyteId?: string // If provided, only regenerate this analyte
  limit?: number // For testing, limit number of analytes to process
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    const { labId, analyteId, limit }: EmbeddingRequest = await req.json()

    if (!labId) {
      return new Response(
        JSON.stringify({ success: false, error: 'labId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Generating embeddings for lab: ${labId}${analyteId ? `, analyte: ${analyteId}` : ' (all analytes)'}${limit ? ` [LIMIT: ${limit}]` : ''}`)

    // 1. Fetch lab's test catalog
    let query = supabaseClient
      .from('lab_analytes')
      .select(`
        id,
        lab_id,
        analyte_id,
        lab_specific_reference_range,
        analyte:analytes!inner(
          id,
          name,
          code,
          unit,
          category,
          description
        )
      `)
      .eq('lab_id', labId)
      .eq('is_active', true)

    if (analyteId) {
      query = query.eq('analyte_id', analyteId)
    }

    if (limit) {
      query = query.limit(limit)
    }

    const { data: labAnalytes, error: fetchError } = await query

    if (fetchError) {
      console.error('Failed to fetch lab analytes:', fetchError)
      throw new Error(`Failed to fetch lab analytes: ${fetchError.message}`)
    }

    if (!labAnalytes || labAnalytes.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No analytes found for this lab',
          count: 0 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Found ${labAnalytes.length} analytes to process`)

    // 2. Generate embeddings for each analyte (multiple placeholder types)
    const placeholderTypes = ['value', 'flag', 'unit', 'range', 'method', 'comment']
    const embeddingRecords = []
    const GOOGLE_API_KEY = Deno.env.get('ALLGOOGLE_KEY')

    if (!GOOGLE_API_KEY) {
      throw new Error('ALLGOOGLE_KEY not configured')
    }

    const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY)
    const model = genAI.getGenerativeModel({ model: 'text-embedding-004' })

    // Track used placeholder names to handle duplicates
    const usedPlaceholders = new Map<string, number>() // placeholder -> count

    for (const labAnalyte of labAnalytes) {
      const analyte = labAnalyte.analyte

      if (!analyte) {
        console.warn(`Skipping lab_analyte ${labAnalyte.id}: No analyte data`)
        continue
      }

      // Build comprehensive searchable text with context and variations
      const searchTexts = [
        // Primary names
        analyte.name, // "Hemoglobin"
        analyte.name.toLowerCase(), // "hemoglobin"
        
        // Categories
        analyte.category, // "hematology"
        
        // Descriptive
        `${analyte.name} test`, // "Hemoglobin test"
        `${analyte.name} level`, // "Hemoglobin level"
        `${analyte.name} value`, // "Hemoglobin value"
      ]

      const searchText = searchTexts.filter(Boolean).join(' ')

      // Generate embedding via Gemini
      try {
        const result = await model.embedContent(searchText)
        const embedding = result.embedding.values

        // Create embedding records for each placeholder type
        for (const type of placeholderTypes) {
          // Use code if available, otherwise generate from name
          const analyteCode = analyte.code || analyte.name.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()
          let basePlaceholder = `ANALYTE_${analyteCode}_${type.toUpperCase()}`
          
          // Check for duplicates and add counter if needed
          const count = usedPlaceholders.get(basePlaceholder) || 0
          usedPlaceholders.set(basePlaceholder, count + 1)
          
          // If this is a duplicate, add suffix _2, _3, etc.
          const placeholderName = count === 0 ? basePlaceholder : `${basePlaceholder}_${count + 1}`
          
          console.log(`  → Creating: ${placeholderName} for "${analyte.name}"${count > 0 ? ' (duplicate #' + (count + 1) + ')' : ''}`)
          
          embeddingRecords.push({
            lab_id: labId,
            test_group_id: null,
            analyte_id: analyte.id,
            lab_analyte_id: labAnalyte.id,
            search_text: searchText,
            placeholder_name: placeholderName, // Keep placeholder readable
            placeholder_type: type,
            embedding: JSON.stringify(embedding),
            display_name: `${analyte.name} (${type.charAt(0).toUpperCase() + type.slice(1)})`,
            description: analyte.description || '',
            unit: type === 'unit' ? analyte.unit : null,
            reference_range: type === 'range' ? (labAnalyte.lab_specific_reference_range || null) : null,
            example_value: type === 'value' ? '14.5' : null,
            category: analyte.category || 'general',
            test_group_name: null,
            analyte_code: analyte.name,
          })
        }

        // Small delay to respect Gemini rate limits (1500 req/day free tier)
        await new Promise(resolve => setTimeout(resolve, 50))

      } catch (error) {
        console.error(`Failed to generate embedding for ${analyte.name}:`, error)
      }
    }

    console.log(`Generated ${embeddingRecords.length} embedding records`)

    // 3. Upsert embeddings in batches (insert or update if exists)
    if (embeddingRecords.length > 0) {
      const BATCH_SIZE = 100
      for (let i = 0; i < embeddingRecords.length; i += BATCH_SIZE) {
        const batch = embeddingRecords.slice(i, i + BATCH_SIZE)
        console.log(`  Inserting batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(embeddingRecords.length/BATCH_SIZE)}...`)
        
        const { error: insertError } = await supabaseClient
          .from('test_catalog_embeddings')
          .upsert(batch, {
            onConflict: 'lab_id,placeholder_name',
            ignoreDuplicates: false,
          })

        if (insertError) {
          console.error('Failed to insert embeddings:', insertError)
          throw new Error(`Failed to insert embeddings: ${insertError.message}`)
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Generated ${embeddingRecords.length} embeddings for lab ${labId}`,
        count: embeddingRecords.length,
        analytesProcessed: labAnalytes.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Edge function error:', error)
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Unknown error' 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

// Helper function to format reference ranges
function formatRefRange(ranges: any): string | null {
  if (!ranges || typeof ranges !== 'object') return null
  
  try {
    const entries = Object.entries(ranges)
    if (entries.length === 0) return null
    
    if ('min' in ranges && 'max' in ranges) {
      return `${ranges.min} - ${ranges.max}`
    }
    
    // Gender-specific or other categories
    return entries.map(([key, value]) => `${key}: ${value}`).join(', ')
  } catch {
    return null
  }
}
