const fetch = globalThis.fetch;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: 'ok' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
  }

  try {
  const base = process.env.WHATSAPP_API_BASE_URL || process.env.VITE_WHATSAPP_API_BASE_URL || 'https://app.limsapp.in/whatsapp';
    const q = event.queryStringParameters || {};
    const userId = q.userId;
    const labId = q.labId;
    if (!userId) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ success: false, error: 'userId is required' }) };
    }

    // Try dedicated QR endpoint first
    const candidates = [];
    const add = (path, search = {}) => {
      const u = new URL(path, base);
      Object.entries(search).forEach(([k, v]) => { if (v) u.searchParams.set(k, v); });
      candidates.push(u.toString());
    };

    add(`/api/users/${encodeURIComponent(userId)}/whatsapp/qr`, { labId });
    add(`/api/whatsapp/qr`, { userId, labId });
    // Fallback: status with includeQr flag if backend supports it
    add(`/api/users/${encodeURIComponent(userId)}/whatsapp/status`, { labId, includeQr: '1' });

    let upstream, dataText;
    for (const url of candidates) {
      upstream = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': event.headers.authorization || '',
        },
      });
      if (upstream.ok) {
        dataText = await upstream.text();
        try {
          const json = dataText ? JSON.parse(dataText) : {};
          return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify(json),
          };
        } catch {
          return {
            statusCode: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: dataText || '{}',
          };
        }
      }
    }

    // If none succeed, return last error text
    dataText = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': upstream.headers.get('content-type') || 'application/json' },
      body: dataText || JSON.stringify({ success: false, error: 'QR not available' }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: String(err) }),
    };
  }
};
