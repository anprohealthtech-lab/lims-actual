import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

const buildCorsHeaders = (event) => {
  const origin = event.headers?.origin || '*';
  const requestedHeaders = event.headers?.['access-control-request-headers'];
  const requestedMethod = event.headers?.['access-control-request-method'];

  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': requestedMethod || 'GET, POST, OPTIONS',
    'Vary': 'Origin, Access-Control-Request-Headers, Access-Control-Request-Method',
  };

  if (requestedHeaders) {
    headers['Access-Control-Allow-Headers'] = requestedHeaders;
  } else {
    headers['Access-Control-Allow-Headers'] = 'authorization, x-client-info, apikey, content-type';
  }

  return headers;
};

const jsonResponse = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  const corsHeaders = buildCorsHeaders(event);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (!['POST', 'GET'].includes(event.httpMethod)) {
    return jsonResponse(405, { success: false, error: 'Method Not Allowed' }, corsHeaders);
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Missing Supabase configuration');
      return jsonResponse(500, { success: false, error: 'Server configuration error' }, corsHeaders);
    }

    const authHeader = event.headers?.authorization || event.headers?.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse(401, { success: false, error: 'Unauthorized' }, corsHeaders);
    }

    const token = authHeader.replace('Bearer ', '').trim();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: userResult, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userResult?.user) {
      console.error('Auth validation failed', userError);
      return jsonResponse(401, { success: false, error: 'Unauthorized' }, corsHeaders);
    }

    const userId = userResult.user.id;

    let orderId = null;
    if (event.httpMethod === 'GET') {
      orderId = event.queryStringParameters?.orderId || null;
    } else if (event.body) {
      try {
        const parsed = event.isBase64Encoded ? JSON.parse(Buffer.from(event.body, 'base64').toString('utf8')) : JSON.parse(event.body);
        orderId = parsed?.orderId ?? null;
      } catch (parseError) {
        console.error('Failed to parse request body', parseError);
        return jsonResponse(400, { success: false, error: 'Invalid JSON payload' }, corsHeaders);
      }
    }

    if (!orderId) {
      return jsonResponse(400, { success: false, error: 'orderId is required' }, corsHeaders);
    }

    const { data: userRecord, error: userRecordError } = await supabase
      .from('users')
      .select('lab_id')
      .eq('id', userId)
      .maybeSingle();

    if (userRecordError) {
      console.error('Failed to fetch user record', userRecordError);
      return jsonResponse(403, { success: false, error: 'Unable to resolve lab context' }, corsHeaders);
    }

    const resolvedLabId = userRecord?.lab_id || userResult.user.user_metadata?.lab_id || null;

    const { data: orderRecord, error: orderError } = await supabase
      .from('orders')
      .select('id, lab_id')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError || !orderRecord) {
      console.error('Order lookup failed', orderError);
      return jsonResponse(404, { success: false, error: 'Order not found' }, corsHeaders);
    }

    if (resolvedLabId && orderRecord.lab_id && orderRecord.lab_id !== resolvedLabId) {
      return jsonResponse(403, { success: false, error: 'Order does not belong to current lab' }, corsHeaders);
    }

    const { data: context, error: contextError } = await supabase.rpc('get_report_template_context', {
      p_order_id: orderId,
    });

    if (contextError) {
      console.error('RPC get_report_template_context failed', contextError);
      return jsonResponse(500, { success: false, error: 'Failed to load report context' }, corsHeaders);
    }

    return jsonResponse(200, { success: true, context }, corsHeaders);
  } catch (error) {
    console.error('Unexpected error in Netlify get-template-context function', error);
    return jsonResponse(500, { success: false, error: 'Unexpected server error' }, corsHeaders);
  }
};
