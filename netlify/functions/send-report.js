// Netlify Lambda: netlify/functions/send-report.js
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
    // Debugging info
    console.log('isBase64Encoded:', !!event.isBase64Encoded);
    console.log('body typeof:', typeof event.body);
    const contentType = (event.headers && (event.headers['content-type'] || event.headers['Content-Type'])) || '';
    console.log('Incoming Content-Type:', contentType);

    if (!contentType.includes('multipart/form-data')) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Content-Type must be multipart/form-data' }),
      };
    }

    // Ensure we forward raw bytes. If incoming is base64 encoded, decode first.
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'utf8');

    console.log('Raw body byteLength:', rawBody.byteLength);
    console.log('Body preview (utf8, first 300 chars):', rawBody.toString('utf8', 0, 300));

    // Try to extract userId and sessionId for quick validation (non-invasive)
    let userId, sessionId;
    try {
      const s = rawBody.toString('utf8');
      
      // Extract userId
      const userIdMatch = s.match(/name=["']userId["'][\s\S]*?\r\n\r\n([^\r\n]+)/i) || 
                          s.match(/name=["']userId["'][\s\S]*?\n\n([^\n]+)/i);
      if (userIdMatch) userId = userIdMatch[1].trim();
      
      // Extract sessionId (for enhanced WhatsApp functionality)
      const sessionIdMatch = s.match(/name=["']sessionId["'][\s\S]*?\r\n\r\n([^\r\n]+)/i) || 
                             s.match(/name=["']sessionId["'][\s\S]*?\n\n([^\n]+)/i);
      if (sessionIdMatch) sessionId = sessionIdMatch[1].trim();
      
      // Extract phoneNumber for logging (helpful for debugging)
      const phoneMatch = s.match(/name=["']phoneNumber["'][\s\S]*?\r\n\r\n([^\r\n]+)/i) || 
                         s.match(/name=["']phoneNumber["'][\s\S]*?\n\n([^\n]+)/i);
      const phoneNumber = phoneMatch ? phoneMatch[1].trim() : null;
      if (phoneNumber) console.log('Target phone number:', phoneNumber.substring(0, 5) + '***'); // Partially masked for privacy
    } catch (e) {
      console.warn('Field extraction failed:', String(e));
    }

    if (!userId && !sessionId) {
      console.warn('Neither userId nor sessionId found in form data; continuing to forward raw body (backend may parse fields).');
      // If you require one of these here, return error. We're choosing to forward anyway so backend can validate.
      // return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ success:false, error:'userId or sessionId required' }) };
    } else {
      console.log('Extracted fields - userId:', userId, 'sessionId:', sessionId);
    }

    const base = process.env.WHATSAPP_API_BASE_URL || process.env.VITE_WHATSAPP_API_BASE_URL || 'https://lionfish-app-nmodi.ondigitalocean.app';
    if (!process.env.WHATSAPP_API_BASE_URL && !process.env.VITE_WHATSAPP_API_BASE_URL) {
      console.warn('WHATSAPP_API_BASE_URL not configured, using default');
    }
    const apiUrl = `${base}/api/external/reports/send`;
    console.log('Forwarding to:', apiUrl);

    const API_KEY = process.env.WHATSAPP_PROXY_API_KEY || 'whatsapp-lims-secure-api-key-2024';

    // Important: preserve Content-Type exactly (including boundary), but don't forward Content-Length/Host
    const outHeaders = {
      'Content-Type': contentType,
      'X-API-Key': API_KEY,
    };

    // Use global fetch (Node 18+). If unavailable, return error telling to bundle polyfill or use lambda.
    const fetchFn = globalThis.fetch;
    if (!fetchFn) {
      console.error('global fetch not available in this runtime. Bundle a fetch polyfill or use a Node runtime with fetch.');
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Fetch unavailable in runtime' }),
      };
    }

    const upstream = await fetchFn(apiUrl, {
      method: 'POST',
      headers: outHeaders,
      body: rawBody,
    });

    // Log upstream status and headers for debugging
    const upstreamHeaders = {};
    try {
      for (const [k, v] of upstream.headers.entries()) upstreamHeaders[k] = v;
    } catch (e) {
      console.warn('Could not read upstream headers:', String(e));
    }
    console.log('Upstream status:', upstream.status, 'headers:', JSON.stringify(upstreamHeaders));

    const responseText = await upstream.text();
    // Log full upstream body for debugging (trim to 2000 chars)
    console.log('Upstream response text (trim):', responseText ? responseText.substring(0, 2000) : '');

    // Try to parse JSON when possible
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      // If backend returned non-JSON, return 502 with body text
      return {
        statusCode: upstream.ok ? 200 : 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Backend returned non-JSON response',
          status: upstream.status,
          bodyPreview: responseText ? responseText.substring(0, 1000) : null,
        }),
      };
    }

    if (!upstream.ok) {
      // Backend returned an error JSON (like validation error). Return it transparently.
      console.error('Backend error JSON:', JSON.stringify(data));
      return {
        statusCode: upstream.status || 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      };
    }

    // Success: forward parsed JSON
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (err) {
    console.error('Handler error:', err && err.stack ? err.stack : String(err));
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Internal server error', details: process.env.NODE_ENV === 'development' ? String(err) : undefined }),
    };
  }
};