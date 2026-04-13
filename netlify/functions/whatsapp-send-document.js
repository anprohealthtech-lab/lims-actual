// Use proper fetch for Node.js compatibility
const fetch = globalThis.fetch;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: 'ok' };
  }
  
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
  }

  try {
    // Environment validation
    const base = process.env.WHATSAPP_API_BASE_URL || process.env.VITE_WHATSAPP_API_BASE_URL || 'https://app.limsapp.in/whatsapp';
    if (!process.env.WHATSAPP_API_BASE_URL && !process.env.VITE_WHATSAPP_API_BASE_URL) {
      console.warn('WHATSAPP_API_BASE_URL not configured, using default');
    }
    
    // Validate content type
    const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return { 
        statusCode: 400, 
        headers: corsHeaders, 
        body: JSON.stringify({ success: false, error: 'Content-Type must be multipart/form-data' }) 
      };
    }

    // Extract userId from the request body
    let userId;
    const body = event.body;
    const bodyStr = event.isBase64Encoded ? Buffer.from(body, 'base64').toString() : body;
    
    // Try to extract userId or sessionId from form data
    const userIdMatch = bodyStr.match(/name="userId"[\r\n\s]+([^\r\n\s-]+)/);
    const sessionIdMatch = bodyStr.match(/name="sessionId"[\r\n\s]+([^\r\n\s-]+)/);
    
    let sessionId;
    if (sessionIdMatch) {
      sessionId = sessionIdMatch[1].trim();
    } else if (userIdMatch) {
      userId = userIdMatch[1].trim();
      // Map userId to known sessionId for backward compatibility
      sessionId = 'f1e86dc8-fd5a-4719-a94a-e49729d6ac14';
      console.log('Mapping userId to sessionId:', userId, '->', sessionId);
    }

    if (!sessionId) {
      console.error('Neither sessionId nor userId found in form data. Body preview:', bodyStr.substring(0, 500));
      return { 
        statusCode: 400, 
        headers: corsHeaders, 
        body: JSON.stringify({ success: false, error: 'sessionId or userId is required in form data' }) 
      };
    }

    console.log('Using sessionId:', sessionId);

    // Forward the request to the backend with modified multipart data
    const apiUrl = `${base}/api/external/reports/send`;
    console.log('Forwarding to:', apiUrl);
    
    // Replace userId with sessionId in the form data if needed
    let modifiedBody = event.isBase64Encoded ? Buffer.from(body, 'base64') : body;
    if (userId && !sessionIdMatch) {
      // Replace userId field with sessionId field in the multipart data
      const bodyString = modifiedBody.toString();
      const updatedBodyString = bodyString.replace(
        /name="userId"/g, 
        'name="sessionId"'
      ).replace(
        new RegExp(`(name="sessionId"[\\r\\n\\s]+)${userId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
        `$1${sessionId}`
      );
      modifiedBody = Buffer.from(updatedBodyString);
      console.log('Modified form data: userId -> sessionId');
    }

    // Prepare headers with proper authentication (hardcoded like the sample)
    const API_KEY = 'whatsapp-lims-secure-api-key-2024';
    const headers = {
      'Content-Type': event.headers['content-type'] || event.headers['Content-Type'],
      'X-API-Key': API_KEY,  // Use capitalized header name as shown in curl examples
    };
    
    console.log('Using hardcoded API key for authentication');

    const upstream = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: modifiedBody,
    });

    const responseText = await upstream.text();
    let data;
    
    try {
      data = JSON.parse(responseText);
      console.log('Backend response:', JSON.stringify(data, null, 2));
    } catch (parseError) {
      console.error('Failed to parse backend response as JSON:', responseText);
      return {
        statusCode: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: false, 
          error: 'Backend returned invalid JSON response',
          details: responseText.substring(0, 200)
        }),
      };
    }

    // Handle non-2xx responses properly
    if (!upstream.ok) {
      console.error('Backend error:', upstream.status, data);
      return {
        statusCode: upstream.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(data || { 
          success: false, 
          error: `Backend returned ${upstream.status}` 
        }),
      };
    }

    // Success response
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };

  } catch (err) {
    console.error('WhatsApp send document error:', err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false, 
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? String(err) : undefined
      }),
    };
  }
};
