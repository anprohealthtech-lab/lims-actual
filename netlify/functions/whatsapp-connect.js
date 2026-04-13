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
  const base = process.env.WHATSAPP_API_BASE_URL || process.env.VITE_WHATSAPP_API_BASE_URL || 'https://app.limsapp.in/whatsapp';
    const body = event.body ? JSON.parse(event.body) : {};
    const { userId, labId } = body;
    if (!userId) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ success: false, error: 'userId is required' }) };
    }

    const url = new URL(`/api/users/${encodeURIComponent(userId)}/whatsapp/connect`, base);
    if (labId) url.searchParams.set('labId', labId);

    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': event.headers.authorization || '',
      },
      body: JSON.stringify({ labId }),
    });

    const data = await upstream.json();
    
    // Log the response for debugging
    console.log('Backend connect response:', JSON.stringify(data, null, 2));
    
    // Ensure we always return a valid JSON response
    return {
      statusCode: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: String(err) }),
    };
  }
};
