const fetch = globalThis.fetch;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: 'ok' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
  }

  try {
    const base = process.env.VITE_WHATSAPP_API_BASE_URL || 'https://lionfish-app-nmodi.ondigitalocean.app';
    const apiKey = process.env.WHATSAPP_API_KEY || 'whatsapp-lims-secure-api-key-2024';
    const body = event.body ? JSON.parse(event.body) : {};

    // Map LIMS user fields to what the WhatsApp backend expects
    if (body.user) {
      if (!body.user.id && body.user.auth_id) body.user.id = body.user.auth_id;
      if (!body.user.email && body.user.username) body.user.email = body.user.username;
    }

    // Proxy to backend user sync - use the correct external API endpoint
    const upstream = await fetch(new URL('/api/external/users/sync', base), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(body),
    });

    const data = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': upstream.headers.get('content-type') || 'application/json' },
      body: data,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: String(err) }),
    };
  }
};
