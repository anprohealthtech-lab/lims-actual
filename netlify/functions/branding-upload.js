import { createClient } from '@supabase/supabase-js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_BUCKET = process.env.SUPABASE_BRANDING_BUCKET || 'attachments';
const ASSET_TYPES = new Set(['header', 'footer', 'watermark', 'logo', 'letterhead', 'front_page', 'last_page']);

const errorResponse = (statusCode, message) => ({
  statusCode,
  headers: {
    ...CORS_HEADERS,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ success: false, error: message }),
});

const successResponse = (payload) => ({
  statusCode: 200,
  headers: {
    ...CORS_HEADERS,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ success: true, ...payload }),
});

const getSupabaseClient = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase environment variables not configured');
  }
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};

const getExtensionFromName = (fileName = '') => {
  const parts = fileName.split('.');
  if (parts.length < 2) return '';
  return parts.pop().toLowerCase();
};

const resolveInvokeUrl = (event) => {
  // Priority 1: Use the request origin if available (works for subdomain deployments)
  if (event && event.headers && event.headers.origin) {
    return event.headers.origin;
  }

  // Priority 2: Use the host header
  if (event && event.headers && event.headers.host) {
    const protocol = event.headers['x-forwarded-proto'] || 'https';
    return `${protocol}://${event.headers.host}`;
  }

  // Priority 3: Netlify environment variables
  return process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.DEPLOY_URL ||
    'http://localhost:8888';
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: 'ok',
    };
  }

  if (event.httpMethod !== 'POST') {
    return errorResponse(405, 'Method not allowed');
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    console.error('Failed to parse request body', err);
    return errorResponse(400, 'Request body must be valid JSON');
  }

  const {
    labId,
    assetType,
    fileName,
    contentType,
    base64Data,
    userId,
    signatureType = 'digital',
    assetName,
    description,
    usageContext,
  } = payload;

  if (!labId) {
    return errorResponse(400, 'labId is required');
  }

  if (!base64Data || typeof base64Data !== 'string') {
    return errorResponse(400, 'base64Data is required');
  }

  if (!contentType || !contentType.startsWith('image/')) {
    return errorResponse(400, 'contentType must be an image MIME type');
  }

  const buffer = Buffer.from(base64Data, 'base64');
  if (!buffer.length) {
    return errorResponse(400, 'Uploaded file is empty');
  }

  const supabase = getSupabaseClient();

  const now = new Date();
  const extension = getExtensionFromName(fileName) || contentType.split('/')[1] || 'png';
  const safeName = assetName || fileName || `${assetType || signatureType}.${extension}`;

  let tableName;
  let scopePath;
  let insertData;

  if (userId) {
    // User-specific signature upload
    tableName = 'lab_user_signatures';
    scopePath = `labs/${labId}/users/${userId}/signature/original`;
    insertData = {
      lab_id: labId,
      user_id: userId,
      signature_type: signatureType,
      signature_name: safeName,
      file_type: contentType,
      file_size: buffer.length,
      storage_bucket: SUPABASE_BUCKET,
      status: 'pending',
      description: description || null,
      usage_context: Array.isArray(usageContext) ? usageContext : null,
      created_by: payload.requestUserId || null,
      updated_by: payload.requestUserId || null,
    };
  } else {
    if (!assetType || !ASSET_TYPES.has(assetType)) {
      return errorResponse(400, 'assetType must be one of header, footer, watermark, logo, letterhead, front_page, last_page');
    }
    tableName = 'lab_branding_assets';
    scopePath = `labs/${labId}/branding/${assetType}/original`;
    insertData = {
      lab_id: labId,
      asset_type: assetType,
      asset_name: safeName,
      file_type: contentType,
      file_size: buffer.length,
      storage_bucket: SUPABASE_BUCKET,
      status: 'pending',
      description: description || null,
      usage_context: Array.isArray(usageContext) ? usageContext : null,
      created_by: payload.requestUserId || null,
      updated_by: payload.requestUserId || null,
    };
  }

  const uniqueFileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
  const storagePath = `${scopePath}/${uniqueFileName}`;

  try {
    const { error: uploadError } = await supabase.storage.from(SUPABASE_BUCKET).upload(storagePath, buffer, {
      contentType,
      upsert: false,
    });

    if (uploadError) {
      console.error('Supabase storage upload failed', uploadError);
      return errorResponse(500, 'Failed to store file');
    }

    const publicUrl = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(storagePath).data?.publicUrl || null;

    insertData.file_path = storagePath;
    insertData.storage_path = storagePath;
    insertData.file_url = publicUrl || `supabase://${SUPABASE_BUCKET}/${storagePath}`;

    const { data: insertResult, error: insertError } = await supabase.from(tableName).insert(insertData).select('id').single();
    if (insertError) {
      console.error('Database insert failed', insertError);
      return errorResponse(500, 'Failed to record branding asset');
    }

    const jobPayload = {
      assetId: insertResult.id,
      tableName,
      labId,
      userId: userId || null,
      assetType: assetType || signatureType,
      fileName: fileName || safeName,
      contentType,
      storageBucket: SUPABASE_BUCKET,
      storagePath,
    };

    try {
      const invokeUrl = resolveInvokeUrl(event);
      await fetch(`${invokeUrl}/.netlify/functions/imagekit-process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-netlify-background': 'true',
        },
        body: JSON.stringify(jobPayload),
      });
    } catch (bgError) {
      console.warn('Failed to invoke background processor; leaving asset pending', bgError);
    }

    return successResponse({ id: insertResult.id, status: 'pending', storagePath });
  } catch (err) {
    console.error('Unexpected error during branding upload', err);
    return errorResponse(500, 'Unexpected server error');
  }
};
