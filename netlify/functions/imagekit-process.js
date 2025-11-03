const { createClient } = require('@supabase/supabase-js');

const SUPABASE_BUCKET = process.env.SUPABASE_BRANDING_BUCKET || 'attachments';
const IMAGEKIT_ENDPOINT = process.env.IMAGEKIT_URL_ENDPOINT;
const IMAGEKIT_PRIVATE_KEY = process.env.IMAGEKIT_PRIVATE_KEY;
const IMAGEKIT_PUBLIC_KEY = process.env.IMAGEKIT_PUBLIC_KEY;

const FormData = globalThis.FormData;
const Blob = globalThis.Blob;

if (!FormData || !Blob) {
  throw new Error('FormData and Blob must be available in the runtime (Node 18+).');
}

const buildErrorResponse = (statusCode, message) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ success: false, error: message }),
});

const getSupabaseClient = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase environment variables not configured');
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
};

const buildVariantUrls = (baseUrl, assetType, tableName) => {
  const baseTransforms = [];
  const isSignatureAsset = tableName === 'lab_user_signatures';
  const isWideBranding = assetType === 'header' || assetType === 'footer' || assetType === 'watermark';

  if (assetType === 'watermark' || isSignatureAsset) {
    baseTransforms.push('e-removedotbg');
  } else {
    baseTransforms.push('e-upscale');
  }

  const targetWidth = isSignatureAsset ? 200 : isWideBranding ? 1000 : 1600;
  const previewWidth = Math.max(isSignatureAsset ? 200 : Math.round(targetWidth / 2), 200);

  const buildUrl = (extraTransforms = []) => {
    const transforms = [...baseTransforms, ...extraTransforms, 'fo-auto'];
    return `${baseUrl}?tr=${transforms.join(',')}`;
  };

  return {
    optimized: buildUrl([`w-${targetWidth}`]),
    preview1x: buildUrl([`w-${previewWidth}`]),
    preview2x: buildUrl([`w-${targetWidth}`]),
    webp: buildUrl(['f-webp', `w-${targetWidth}`]),
  };
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return buildErrorResponse(405, 'Method not allowed');
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    console.error('imagekit-process: invalid JSON body', err);
    return buildErrorResponse(400, 'Request body must be valid JSON');
  }

  const {
    assetId,
    tableName,
    labId,
    storageBucket = SUPABASE_BUCKET,
    storagePath,
    fileName,
    contentType,
    assetType,
  } = payload;

  if (!assetId || !tableName || !labId || !storagePath) {
    return buildErrorResponse(400, 'assetId, tableName, labId, and storagePath are required');
  }

  if (!IMAGEKIT_ENDPOINT || !IMAGEKIT_PRIVATE_KEY || !IMAGEKIT_PUBLIC_KEY) {
    console.error('ImageKit credentials not configured');
    return buildErrorResponse(500, 'ImageKit credentials are missing');
  }

  const supabase = getSupabaseClient();

  const updateStatus = async (status, extra = {}) => {
    const updatePayload = { status, updated_at: new Date().toISOString(), ...extra };
    const { error } = await supabase.from(tableName).update(updatePayload).eq('id', assetId);
    if (error) {
      console.error('Failed to update asset status', error);
    }
  };

  await updateStatus('processing');

  try {
    const { data: downloadData, error: downloadError } = await supabase.storage.from(storageBucket).download(storagePath);
    if (downloadError) {
      console.error('Failed to download original from Supabase storage', downloadError);
      await updateStatus('error', { last_error: 'Unable to fetch original file from storage' });
      return buildErrorResponse(500, 'Failed to fetch original file');
    }

    const arrayBuffer = await downloadData.arrayBuffer();
    const fileBytes = Buffer.from(arrayBuffer);
    const mimeType = contentType || 'application/octet-stream';
    const fallbackExtension = (mimeType.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
    const resolvedFileName = fileName && fileName.includes('.')
      ? fileName
      : `${(fileName || `${assetType || 'asset'}-${Date.now()}`).replace(/\s+/g, '-')}.${fallbackExtension}`;

    const formData = new FormData();
    const fileBlob = new Blob([fileBytes], { type: mimeType });
    formData.append('file', fileBlob, resolvedFileName);
    formData.append('fileName', resolvedFileName);
    formData.append('folder', `/labs/${labId}/${tableName}`);
    formData.append('useUniqueFileName', 'true');

    const authToken = Buffer.from(`${IMAGEKIT_PRIVATE_KEY}:`).toString('base64');

    const response = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authToken}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ImageKit upload failed', errorText);
      await updateStatus('error', { last_error: `ImageKit upload failed: ${errorText}` });
      return buildErrorResponse(502, 'ImageKit upload failed');
    }

  const uploadResult = await response.json();
  const baseUrl = uploadResult.url || `${IMAGEKIT_ENDPOINT.replace(/\/$/, '')}/${uploadResult.filePath}`;
  const variants = buildVariantUrls(baseUrl, assetType, tableName);

    const updateFields = {
      imagekit_file_id: uploadResult.fileId,
      imagekit_url: baseUrl,
      variants,
      processed_at: new Date().toISOString(),
      file_url: baseUrl,
      file_size: uploadResult.size || null,
      dimensions: uploadResult.width && uploadResult.height ? { width: uploadResult.width, height: uploadResult.height } : null,
      last_error: null,
    };

    await updateStatus('ready', updateFields);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, assetId, variants }),
    };
  } catch (err) {
    console.error('Unexpected image processing error', err);
    await updateStatus('error', { last_error: err?.message || 'Unexpected error' });
    return buildErrorResponse(500, 'Unexpected processing error');
  }
};
