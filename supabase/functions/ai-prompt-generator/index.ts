import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const geminiApiKey = Deno.env.get('ALLGOOGLE_KEY');
    if (!geminiApiKey) {
      throw new Error('ALLGOOGLE_KEY not configured');
    }

    const { 
      testGroupName,
      analytes,
      processingType,
      currentPrompt,
      userMessage 
    } = await req.json();

    console.log('AI Prompt Generator Request:', {
      testGroupName,
      analytesCount: analytes?.length || 0,
      processingType,
      userMessage
    });

    // Build context for AI
    const analyteNames = analytes?.map((a: any) => a.name) || [];
    const analyteList = analyteNames.join(', ');

    console.log('Analytes received:', {
      count: analyteNames.length,
      names: analyteNames,
      rawAnalytes: analytes
    });

    // Create system prompt for Gemini
    const systemContext = `You are an expert AI assistant helping laboratory professionals create optimal prompts for automated test result extraction.

**Context:**
- Test: ${testGroupName || 'Laboratory Test'}
- Analytes: ${analyteNames.length} parameters (${analyteList})
- Processing Type: ${processingType}
- Current Prompt: ${currentPrompt ? 'User has an existing prompt' : 'Creating new prompt'}

**Your Role:**
- Guide users in creating effective prompts
- Ensure JSON format matches their analytes
- Provide clear, actionable suggestions
- Be concise and helpful

**Processing Types:**
1. **ocr_report**: Extract from printed lab reports (array format with parameter/value/unit/reference_range)
2. **vision_card**: Analyze rapid test cards (object format with analyte names as keys)
3. **vision_color**: Detect color-based reactions (object format with analyte names as keys)

**Key Rules:**
- Always use EXACT analyte names as JSON keys
- For vision types (card/color): Use object format with analyte names
- For OCR: Use array format with parameter objects
- Include clear JSON structure in prompts
- Add validation instructions`;

    const userPrompt = `User request: "${userMessage}"

Available analytes for ${testGroupName}:
${analyteNames.map((name: string, idx: number) => `${idx + 1}. "${name}"`).join('\n')}

Processing type: ${processingType}

**CRITICAL REQUIREMENTS**:
1. You MUST use the EXACT analyte names listed above in the JSON format
2. Do NOT use generic placeholders like "Analyte1", "Analyte2", "Pad1", "Pad2"
3. Every analyte name should match EXACTLY as shown in the list above

**IMPORTANT**: If the user asks to generate or create a prompt:
1. Wrap the complete prompt in triple backticks (\`\`\`)
2. Use the EXACT analyte names from the list (${analyteNames.map(n => `"${n}"`).join(', ')})
3. Include clear task description, JSON format with EXACT analyte names, and validation rules

Example JSON format for ${processingType}:
${processingType === 'ocr_report' ? `[
  {
    "parameter": "${analyteNames[0] || 'Parameter'}",
    "value": "result",
    "unit": "unit",
    "reference_range": "range"
  }
]` : `{
  ${analyteNames.map(name => `"${name}": "result"`).join(',\n  ')}
}`}

Keep responses concise and actionable.`;

    // Call Gemini API
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: systemContext + '\n\n' + userPrompt }]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 2048,
          }
        })
      }
    );

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API Error:', errorText);
      throw new Error(`Gemini API error: ${geminiResponse.status}`);
    }

    const geminiData = await geminiResponse.json();
    const aiResponse = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'I apologize, I could not generate a response.';

    console.log('AI Response generated successfully');

    // Check if response contains a complete prompt (for generation requests)
    let suggestedPrompt = null;
    let detectedProcessingType = processingType;

    // Extract prompt from various formats
    // Find the main code block that contains the prompt
    // Look for content between the first ``` after "prompt" and the last ```
    const promptStartIndex = aiResponse.toLowerCase().indexOf('```');
    const promptEndIndex = aiResponse.lastIndexOf('```');
    
    if (promptStartIndex !== -1 && promptEndIndex !== -1 && promptEndIndex > promptStartIndex) {
      // Extract everything from first ``` to last ```
      const fullPromptSection = aiResponse.substring(promptStartIndex, promptEndIndex + 3);
      
      // Remove the outer triple backticks while keeping everything inside
      suggestedPrompt = fullPromptSection
        .replace(/^```(?:text|markdown|json)?\n?/, '') // Remove opening ```
        .replace(/\n?```$/, ''); // Remove closing ```
      
      console.log('Extracted full prompt length:', suggestedPrompt.length);
      console.log('First 300 chars:', suggestedPrompt.substring(0, 300));
    }
    
    // Fallback: If no code blocks, try to find the complete prompt after "Here's" or similar
    if (!suggestedPrompt) {
      const promptSectionMatch = aiResponse.match(/(?:Here's|Here is)[\s\S]*?prompt[:\s]+([\s\S]+?)(?:\n\n\*\*|$)/i);
      if (promptSectionMatch) {
        suggestedPrompt = promptSectionMatch[1].trim();
      }
    }
    
    // Last resort: try to find prompts in quotes
    if (!suggestedPrompt) {
      const quoteMatch = aiResponse.match(/"([^"]{100,})"/s);
      if (quoteMatch) {
        suggestedPrompt = quoteMatch[1].trim();
      }
    }
    // 3. If the message seems to contain a prompt instruction (long text with "You are" or "Extract")
    if (!suggestedPrompt && aiResponse.includes('You are') && aiResponse.includes('JSON') && aiResponse.length > 200) {
      // The entire response might be the prompt
      suggestedPrompt = aiResponse.trim();
    }

    return new Response(
      JSON.stringify({
        response: aiResponse,
        suggestedPrompt,
        processingType: detectedProcessingType,
        analyteNames,
        metadata: {
          testGroupName,
          analytesCount: analyteNames.length,
          timestamp: new Date().toISOString()
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('AI Prompt Generator Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        response: "I apologize, but I encountered an error. Please try again or rephrase your request."
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
