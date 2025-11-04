import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);

export default async function handler(req, context) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { question, workflow, ai_spec, context: requestContext } = await req.json();
    
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    
    const systemPrompt = `You are a workflow assistant for a Laboratory Information Management System (LIMS). 
    
Your role is to explain workflow steps and AI processing logic in simple, clear language for lab technicians and reviewers.

Given this workflow data:
- Technician Workflow: ${JSON.stringify(workflow, null, 2)}
- AI Processing Spec: ${JSON.stringify(ai_spec, null, 2)}

Guidelines:
- Explain technical concepts in simple terms
- Focus on what the user needs to do vs what AI does automatically
- Highlight timing requirements, image capture points, and validation steps
- If asked about specific steps, reference step numbers and names
- For AI processing, explain the purpose and expected outcomes
- Be concise but thorough
- Use emojis to make explanations more engaging
- Always start responses with a relevant emoji

Answer the user's question about this workflow.`;

    const prompt = `${systemPrompt}\n\nUser Question: ${question}`;
    
    const result = await model.generateContent(prompt);
    const explanation = result.response.text();
    
    return new Response(
      JSON.stringify({ explanation }),
      { 
        status: 200,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        } 
      }
    );
    
  } catch (error) {
    console.error('Error in workflow explainer:', error);
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
    );
  }
}

export const config = {
  runtime: 'edge'
};