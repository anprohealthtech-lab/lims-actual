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
    const { userId, labId, forceDisconnect } = body;
    if (!userId) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ success: false, error: 'userId is required' }) };
    }

    // If force disconnect is requested, bypass backend and return success
    if (forceDisconnect) {
      console.log('✅ Force disconnect requested for user:', userId, 'labId:', labId);
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: true, 
          message: 'Force disconnected successfully',
          userId,
          labId,
          forceDisconnect: true
        }),
      };
    }

    console.log('Attempting disconnect for user:', userId, 'at backend:', base);

    const url = new URL(`/api/users/${encodeURIComponent(userId)}/whatsapp/disconnect`, base);
    if (labId) url.searchParams.set('labId', labId);

    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': event.headers.authorization || '',
      },
      body: JSON.stringify({ labId }),
    });

    // If backend returns 404 or 500, treat as successful disconnect
    // (the session might not exist on backend but we can disconnect locally)
    if (upstream.status === 404 || upstream.status >= 500) {
      console.log(`⚠️ Backend returned ${upstream.status} - treating as successful disconnect for user:`, userId);
      console.log('Note: Backend disconnect endpoint may not be implemented yet');
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: true, 
          message: 'Disconnected successfully (backend endpoint not available)',
          userId,
          labId,
          backendStatus: upstream.status,
          note: 'Local disconnect completed - backend session may persist'
        }),
      };
    }

    const data = await upstream.text();
    console.log('✅ Backend disconnect successful for user:', userId);
    return {
      statusCode: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': upstream.headers.get('content-type') || 'application/json' },
      body: data,
    };
  } catch (err) {
    console.error('❌ WhatsApp disconnect error:', err);
    console.log('Treating network error as successful local disconnect');
    // On network error, also treat as successful disconnect
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: true, 
        message: 'Disconnected successfully (backend unreachable)',
        note: 'Local disconnect completed - backend may be offline',
        error: String(err)
      }),
    };
  }
};
