/**
 * AI-First Inventory Input Parser
 *
 * Parses voice/text/OCR input into structured inventory actions using Claude AI.
 *
 * Supported actions:
 * - add_stock: Add inventory (purchase, receive)
 * - use_stock: Consume inventory (test, QC, damage)
 * - adjust: Stock adjustment
 * - query: Search/query inventory
 * - create_order: Create purchase order from voice/OCR
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

interface InventoryInputRequest {
  input: string                    // Voice transcript or text input
  inputType: 'voice' | 'text' | 'ocr'
  labId: string
  userId?: string

  // For OCR invoice parsing
  ocrData?: {
    fullText: string
    confidence?: number
  }

  // Context for better parsing
  existingItems?: Array<{
    id: string
    name: string
    code?: string
    unit: string
    current_stock: number
  }>
}

interface ParsedAction {
  action: 'add_stock' | 'use_stock' | 'adjust' | 'query' | 'create_order' | 'unknown'

  // For stock actions
  item_name?: string
  item_code?: string
  matched_item_id?: string
  quantity?: number
  unit?: string

  // For add_stock (AI extracts batch & expiry from voice/OCR)
  supplier_name?: string
  invoice_number?: string
  batch_number?: string             // Batch/lot number (AI extracts from OCR)
  expiry_date?: string              // YYYY-MM-DD format
  unit_price?: number

  // For use_stock
  reason?: string

  // For query
  query_type?: 'low_stock' | 'expiring' | 'search' | 'history'
  search_term?: string

  // For create_order (from invoice OCR)
  order_items?: Array<{
    item_name: string
    quantity: number
    unit: string
    unit_price?: number
  }>
  order_total?: number

  // AI metadata
  confidence: number
  clarification_needed?: string
  original_input: string
  parsed_at: string
}

const SYSTEM_PROMPT = `You are an AI assistant for a diagnostic laboratory inventory system.
Your job is to parse natural language input (voice or text) into structured inventory actions.

ALWAYS respond with valid JSON in this exact format:
{
  "action": "add_stock" | "use_stock" | "adjust" | "query" | "create_order" | "unknown",
  "item_name": "string or null",
  "item_code": "string or null",
  "quantity": number or null,
  "unit": "string or null",
  "supplier_name": "string or null",
  "invoice_number": "string or null",
  "batch_number": "string or null",
  "expiry_date": "YYYY-MM-DD or null",
  "unit_price": number or null,
  "reason": "string or null",
  "query_type": "low_stock" | "expiring" | "search" | "history" | null,
  "search_term": "string or null",
  "order_items": [{"item_name": "...", "quantity": ..., "unit": "...", "unit_price": ..., "batch_number": ..., "expiry_date": ...}] or null,
  "order_total": number or null,
  "confidence": 0.0-1.0,
  "clarification_needed": "string or null"
}

## Action Guidelines:

### add_stock
Use when user mentions: receiving, adding, purchased, got, arrived, new stock
IMPORTANT: Extract batch_number and expiry_date when mentioned (from voice or OCR)
Examples:
- "Add 5 boxes of CBC reagent" → add_stock
- "Received 10 kits from Roche" → add_stock with supplier
- "Got HbA1c controls, expires March 2025" → add_stock with expiry_date: "2025-03-01"
- "Received batch ABC123, expires Dec 2025" → add_stock with batch_number: "ABC123", expiry_date: "2025-12-01"
- "5 boxes glucose strips lot L2024-456" → add_stock with batch_number: "L2024-456"

### use_stock
Use when user mentions: used, consumed, for test, for QC, damaged, expired, wasted
Examples:
- "Used 2 controls for QC" → use_stock, reason: "QC"
- "1 CBC kit expired" → use_stock, reason: "Expired"
- "Consumed 5 ml serum for testing" → use_stock

### adjust
Use for corrections: adjustment, correction, actual count, physical count
Examples:
- "Adjust CBC reagent to 10 boxes" → adjust
- "Physical count shows 5 kits" → adjust

### query
Use for questions: show, what, how many, check, find, list
Examples:
- "What's running low?" → query, query_type: low_stock
- "Show items expiring this month" → query, query_type: expiring
- "Find glucose strips" → query, query_type: search

### create_order (for OCR invoice parsing)
Use when parsing invoice/delivery note OCR text

## Unit Standardization:
- boxes, box → box
- kits, kit → kit
- pieces, pcs, nos → pcs
- bottles, bottle → bottle
- ml, mL → ml
- L, liters → L
- tests → test

## Matching Items:
When existing items are provided, try to match the spoken/typed item name to existing items.
Be flexible with spelling and abbreviations (e.g., "CBC" matches "Complete Blood Count").

## Confidence Guidelines:
- 0.9-1.0: Clear, unambiguous input
- 0.7-0.9: Reasonable interpretation but some assumptions made
- 0.5-0.7: Multiple interpretations possible
- <0.5: Very unclear, set clarification_needed

If unclear, set clarification_needed with a helpful question.`

const OCR_INVOICE_PROMPT = `You are parsing an invoice/delivery note OCR text for a diagnostic laboratory.
Extract the following information:

1. Supplier name (look for company name at top)
2. Invoice number
3. List of items with quantities, units, prices, BATCH NUMBERS, and EXPIRY DATES
4. Total amount

IMPORTANT: Look for batch/lot numbers (e.g., "Batch: ABC123", "Lot No: L2024-456", "B/N: XYZ")
IMPORTANT: Look for expiry dates (e.g., "Exp: 12/2025", "Expiry: Mar 2025", "Best Before: 2025-06")

ALWAYS respond with valid JSON:
{
  "action": "create_order",
  "supplier_name": "string or null",
  "invoice_number": "string or null",
  "order_items": [
    {
      "item_name": "string",
      "quantity": number,
      "unit": "string",
      "unit_price": number or null,
      "batch_number": "string or null",
      "expiry_date": "YYYY-MM-DD or null"
    }
  ],
  "order_total": number or null,
  "confidence": 0.0-1.0,
  "clarification_needed": "string or null"
}

Be flexible with OCR errors - interpret misspellings intelligently.
Common lab items: reagents, kits, controls, calibrators, consumables, tips, tubes, etc.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Validate API key
    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const body: InventoryInputRequest = await req.json()
    const { input, inputType, labId, userId, ocrData, existingItems } = body

    if (!input && !ocrData?.fullText) {
      return new Response(
        JSON.stringify({ error: 'Missing input or ocrData' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!labId) {
      return new Response(
        JSON.stringify({ error: 'Missing labId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`\n🎤 Inventory AI Input Processing`)
    console.log(`  - Input type: ${inputType}`)
    console.log(`  - Lab ID: ${labId}`)
    console.log(`  - Input: "${input?.substring(0, 100)}..."`)

    // Build context for AI
    let itemContext = ''
    if (existingItems && existingItems.length > 0) {
      const itemList = existingItems
        .slice(0, 30) // Limit for context size
        .map(i => `- ${i.name}${i.code ? ` (${i.code})` : ''}: ${i.current_stock} ${i.unit}`)
        .join('\n')
      itemContext = `\n\nExisting items in lab inventory:\n${itemList}`
    }

    // Choose prompt based on input type
    const isInvoiceOCR = inputType === 'ocr' && ocrData?.fullText
    const systemPrompt = isInvoiceOCR ? OCR_INVOICE_PROMPT : SYSTEM_PROMPT
    const userInput = isInvoiceOCR
      ? `OCR Text from invoice:\n\n${ocrData.fullText}`
      : `${inputType === 'voice' ? 'Voice' : 'Text'} input: "${input}"${itemContext}`

    // Call Claude AI
    console.log('  📡 Calling Claude API...')
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userInput }],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Claude API error:', errorText)
      return new Response(
        JSON.stringify({ error: 'AI processing failed', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const aiResponse = await response.json()
    const aiText = aiResponse.content[0]?.text || ''

    console.log('  🤖 AI Response:', aiText.substring(0, 200))

    // Parse AI response
    let parsed: ParsedAction
    try {
      // Try to extract JSON from response
      const jsonMatch = aiText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No JSON found in response')
      }
      parsed = JSON.parse(jsonMatch[0])
      parsed.original_input = input || ocrData?.fullText || ''
      parsed.parsed_at = new Date().toISOString()
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError)
      parsed = {
        action: 'unknown',
        confidence: 0,
        clarification_needed: 'Could not understand the input. Please try again with clearer instructions.',
        original_input: input || ocrData?.fullText || '',
        parsed_at: new Date().toISOString(),
      }
    }

    // Try to match to existing items
    if (parsed.item_name && existingItems && existingItems.length > 0) {
      const match = findBestMatch(parsed.item_name, existingItems)
      if (match) {
        parsed.matched_item_id = match.id
        console.log(`  ✅ Matched to existing item: ${match.name} (${match.id})`)
      }
    }

    // If action is add_stock or use_stock and we have high confidence, optionally execute
    // For now, just return the parsed result for UI confirmation

    console.log(`  ✅ Parsed action: ${parsed.action}, confidence: ${parsed.confidence}`)

    return new Response(
      JSON.stringify({
        success: true,
        parsed,
        requiresConfirmation: true, // UI should show confirmation before executing
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Inventory AI Input error:', error)
    return new Response(
      JSON.stringify({ error: 'Processing failed', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

/**
 * Find best matching item using fuzzy matching
 */
function findBestMatch(
  searchTerm: string,
  items: Array<{ id: string; name: string; code?: string }>
): { id: string; name: string } | null {
  const search = searchTerm.toLowerCase().trim()

  // Exact match on code
  const codeMatch = items.find(i => i.code?.toLowerCase() === search)
  if (codeMatch) return { id: codeMatch.id, name: codeMatch.name }

  // Exact match on name
  const exactMatch = items.find(i => i.name.toLowerCase() === search)
  if (exactMatch) return { id: exactMatch.id, name: exactMatch.name }

  // Contains match
  const containsMatch = items.find(i =>
    i.name.toLowerCase().includes(search) ||
    search.includes(i.name.toLowerCase())
  )
  if (containsMatch) return { id: containsMatch.id, name: containsMatch.name }

  // Fuzzy match - check if most words match
  const searchWords = search.split(/\s+/)
  let bestMatch: { id: string; name: string; score: number } | null = null

  for (const item of items) {
    const itemWords = item.name.toLowerCase().split(/\s+/)
    let matchCount = 0

    for (const searchWord of searchWords) {
      if (itemWords.some(w => w.includes(searchWord) || searchWord.includes(w))) {
        matchCount++
      }
    }

    const score = matchCount / Math.max(searchWords.length, itemWords.length)
    if (score > 0.5 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { id: item.id, name: item.name, score }
    }
  }

  return bestMatch ? { id: bestMatch.id, name: bestMatch.name } : null
}
