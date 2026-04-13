const fetch = globalThis.fetch;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: 'ok' };
  }

  try {
    const base = process.env.WHATSAPP_API_BASE_URL || process.env.VITE_WHATSAPP_API_BASE_URL || 'https://app.limsapp.in/whatsapp';
    const query = new URLSearchParams(event.queryStringParameters || {});
    const userId = query.get('userId');
    const labId = query.get('labId');
    if (!userId) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ success: false, error: 'userId is required' }) };
    }
    const url = new URL(`/api/users/${encodeURIComponent(userId)}/whatsapp/status`, base);
    if (labId) url.searchParams.set('labId', labId);

    const upstream = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': event.headers.authorization || '',
      },
    });

    const data = await upstream.json();

    // Log the response for debugging
    console.log('Backend status response:', JSON.stringify(data, null, 2));

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
