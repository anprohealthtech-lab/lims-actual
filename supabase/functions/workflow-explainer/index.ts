import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.1.3"

const genAI = new GoogleGenerativeAI(Deno.env.get('GOOGLE_AI_API_KEY'))

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { 
      status: 405,
      headers: {
        'Access-Control-Allow-Origin': '*',
      }
    })
  }

  try {
    const { question, workflow, ai_spec, context, action_type } = await req.json()
    
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" })
    
    // Check if this is a modification request
    const isModificationRequest = action_type === 'modify' || 
      question.toLowerCase().includes('add') ||
      question.toLowerCase().includes('modify') ||
      question.toLowerCase().includes('change') ||
      question.toLowerCase().includes('insert') ||
      question.toLowerCase().includes('timer') ||
      question.toLowerCase().includes('wait')
    
    if (isModificationRequest) {
      // AI Workflow Modification Mode
      const modificationPrompt = `You are an expert SurveyJS workflow editor for a Laboratory Information Management System (LIMS).

Your task is to modify the workflow JSON based on user requests. You must return ONLY valid JSON in this exact format:

{
  "modified_workflow": { ... the complete modified workflow JSON ... },
  "modified_ai_spec": { ... the complete modified AI spec JSON ... },
  "changes_made": ["List of specific changes made"],
  "explanation": "Brief explanation of what was changed"
}

Current Workflow JSON:
${JSON.stringify(workflow, null, 2)}

Current AI Spec JSON:
${JSON.stringify(ai_spec, null, 2)}

User Request: ${question}

IMPORTANT RULES:
1. For timer requests: Add a new page with html countdown timer between procedure and results
2. For image capture: Add file input elements with capture="camera"  
3. For validation: Add validators to form elements
4. For new steps: Insert new pages in logical order
5. Always preserve existing structure - only add/modify as requested
6. Ensure all JSON is valid SurveyJS format
7. Return ONLY the JSON response, no other text

Make the requested changes and return the complete modified workflow:`

      const result = await model.generateContent(modificationPrompt)
      let aiResponse = result.response.text()
      
      // Clean up the response to ensure it's valid JSON
      aiResponse = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      
      try {
        const modificationResult = JSON.parse(aiResponse)
        return new Response(
          JSON.stringify({
            type: 'modification',
            ...modificationResult
          }),
          { 
            status: 200,
            headers: { 
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "POST, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type, Authorization"
            } 
          }
        )
      } catch (parseError) {
        console.error('Failed to parse AI modification response:', parseError)
        return new Response(
          JSON.stringify({
            type: 'error',
            explanation: "🤔 I had trouble generating the modified workflow. Could you try rephrasing your request?"
          }),
          { 
            status: 500,
            headers: { 
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            } 
          }
        )
      }
    } else {
      // Regular explanation mode
      const explanationPrompt = `You are a workflow assistant for a Laboratory Information Management System (LIMS). 
    
Your role is to explain workflow steps and AI processing logic in simple, clear language for lab technicians and reviewers.

Given this workflow data:
- Technician Workflow: ${JSON.stringify(workflow, null, 2)}
- AI Processing Spec: ${JSON.stringify(ai_spec, null, 2)}

Guidelines:
- Explain technical concepts in simple terms
- Focus on what the user needs to do vs what AI does automatically
- Highlight timing requirements, image capture points, and validation steps
- If asked about specific steps, reference step numbers and names from the workflow pages
- For AI processing, explain the purpose and expected outcomes
- Be concise but thorough (2-3 sentences per concept)
- Use emojis to make explanations more engaging
- Always start responses with a relevant emoji
- If workflow has pages, refer to them as "Step 1: [page title]", "Step 2: [page title]", etc.
- For AI steps, explain what each step_type does in practical terms

Answer the user's question about this workflow.

User Question: ${question}`

      const result = await model.generateContent(explanationPrompt)
      const explanation = result.response.text()
      
      return new Response(
        JSON.stringify({ 
          type: 'explanation',
          explanation 
        }),
        { 
          status: 200,
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization"
          } 
        }
      )
    }
    
  } catch (error) {
    console.error('Error in workflow explainer:', error)
    return new Response(
      JSON.stringify({ 
        explanation: "🤔 I'm having trouble processing that question. Could you try rephrasing it or ask about specific workflow steps?" 
      }),
      { 
        status: 500, 
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        } 
      }
    )
  }
})