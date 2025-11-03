const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const getSupabaseClient = () => {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error('Supabase environment variables not configured');
  }

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};

const extractBearerToken = (headers = {}) => {
  const rawAuth = headers.authorization || headers.Authorization || headers['AUTHORIZATION'];
  if (rawAuth && typeof rawAuth === 'string') {
    const matches = rawAuth.match(/^Bearer\s+(.*)$/i);
    if (matches && matches[1]) {
      return matches[1].trim();
    }
  }

  const fallback = headers['x-supabase-auth'] || headers['x-supabase-access-token'];
  if (fallback && typeof fallback === 'string') {
    return fallback.trim();
  }

  return null;
};

const resolveUserContext = async (accessToken) => {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data?.user) {
    throw new Error('Invalid Supabase session');
  }

  const user = data.user;
  const metadata = user.user_metadata || {};
  const appMetadata = user.app_metadata || {};

  return {
    id: user.id,
    role: metadata.role || appMetadata.role || 'user',
    labId: metadata.lab_id || appMetadata.lab_id || null,
    email: user.email || null,
  };
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: 'ok',
    };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const environmentId = process.env.CKBOX_ENVIRONMENT_ID;
    const accessKey = process.env.CKBOX_ACCESS_KEY;

    if (!environmentId || !accessKey) {
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'CKBox environment not configured' }),
      };
    }

    const accessToken = extractBearerToken(event.headers || {});
    if (!accessToken) {
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Missing authorization token' }),
      };
    }

    const userContext = await resolveUserContext(accessToken);

    const payload = {
      aud: environmentId,
      sub: userContext.id,
      auth: {
        ckbox: {
          role: userContext.role,
          // Folder context helps segregate uploads per lab when available.
          defaultPath: userContext.labId ? `/labs/${userContext.labId}` : undefined,
        },
      },
      metadata: {
        labId: userContext.labId,
        email: userContext.email,
      },
    };

    const token = jwt.sign(payload, accessKey, {
      algorithm: 'HS256',
      expiresIn: '1h',
    });

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, expiresIn: 3600 }),
    };
  } catch (error) {
    console.error('Failed to generate CKBox token:', error);
    const status = error.message === 'Invalid Supabase session' ? 401 : 500;
    return {
      statusCode: status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: status === 401 ? 'Unauthorized' : 'Internal server error' }),
    };
  }
};
