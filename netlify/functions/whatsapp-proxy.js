// Use proper fetch for Node.js compatibility
const fetch = globalThis.fetch;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key, authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

const WHATSAPP_API_BASE_URL = 'https://app.limsapp.in/whatsapp';
// Prefer env var; fallback to constant for local testing
const API_KEY = process.env.WA_BACKEND_KEY || process.env.WHATSAPP_API_KEY || 'whatsapp-lims-secure-api-key-2024';

export const handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { endpoint, method, body } = JSON.parse(event.body || '{}');

    if (!endpoint) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Endpoint is required' }),
      };
    }

    const url = `${WHATSAPP_API_BASE_URL}${endpoint}`;
    
    const config = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,  // Use capitalized header name as shown in curl examples
      },
    };

    if (body && (method === 'POST' || method === 'PUT')) {
      config.body = JSON.stringify(body);
    }

    console.log(`Proxying ${method} request to: ${url}`);
    console.log('API Key being used:', API_KEY ? 'Present' : 'Missing');
    console.log('Request config:', JSON.stringify(config, null, 2));
    
    const response = await fetch(url, config);
    
    let responseData;
    const contentType = response.headers.get('content-type');
    
    if (contentType && contentType.includes('application/json')) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }

    console.log(`Response status: ${response.status}, data:`, responseData);

    return {
      statusCode: response.status,
      headers: corsHeaders,
      body: JSON.stringify({
        success: response.ok,
        data: responseData,
        status: response.status
      }),
    };

  } catch (error) {
    console.error('WhatsApp proxy error:', error);
    
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }),
    };
  }
};
