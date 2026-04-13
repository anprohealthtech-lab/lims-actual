import { createClient } from '@supabase/supabase-js';

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

const DEFAULT_TABLE_CONFIG = {
  statusColumn: 'status',
  statusMap: { processing: 'processing', ready: 'ready', error: 'error' },
  updatedAtColumn: 'updated_at',
  processedAtColumn: 'processed_at',
  errorColumn: 'last_error',
  imagekitFileIdColumn: 'imagekit_file_id',
  imagekitUrlColumn: 'imagekit_url',
  variantsColumn: 'variants',
  processedUrlColumn: null,
  fileUrlColumn: 'file_url',
  overrideFileUrl: true,
  sizeColumn: 'file_size',
  dimensionsColumn: 'dimensions',
};

const TABLE_CONFIG = {
  attachments: {
    statusColumn: 'processing_status',
    statusMap: { processing: 'processing', ready: 'processed', error: 'failed' },
    updatedAtColumn: null,
    processedAtColumn: 'image_processed_at',
    errorColumn: 'image_processing_error',
    imagekitFileIdColumn: 'imagekit_file_id',
    imagekitUrlColumn: 'imagekit_url',
    variantsColumn: 'variants',
    processedUrlColumn: 'processed_url',
    fileUrlColumn: null,
    overrideFileUrl: false,
    sizeColumn: null,
    dimensionsColumn: null,
  },
  lab_branding_assets: {
    ...DEFAULT_TABLE_CONFIG,
  },
  lab_user_signatures: {
    ...DEFAULT_TABLE_CONFIG,
  },
};

const getTableConfig = (tableName) => TABLE_CONFIG[tableName] || DEFAULT_TABLE_CONFIG;

const buildSuccessUpdateFields = (config, uploadResult, baseUrl, variants, processedAt) => {
  const updateFields = {};

  if (config.imagekitFileIdColumn) {
    updateFields[config.imagekitFileIdColumn] = uploadResult.fileId;
  }

  if (config.imagekitUrlColumn) {
    updateFields[config.imagekitUrlColumn] = baseUrl;
  }

  if (config.variantsColumn) {
    updateFields[config.variantsColumn] = variants;
  }

  if (config.processedAtColumn) {
    updateFields[config.processedAtColumn] = processedAt;
  }

  if (config.processedUrlColumn) {
    updateFields[config.processedUrlColumn] = baseUrl;
  }

  if (config.overrideFileUrl && config.fileUrlColumn) {
    updateFields[config.fileUrlColumn] = baseUrl;
  }

  if (config.sizeColumn && typeof uploadResult.size === 'number') {
    updateFields[config.sizeColumn] = uploadResult.size;
  }

  if (config.dimensionsColumn && uploadResult.width && uploadResult.height) {
    updateFields[config.dimensionsColumn] = { width: uploadResult.width, height: uploadResult.height };
  }

  if (config.errorColumn) {
    updateFields[config.errorColumn] = null;
  }

  return updateFields;
};

const buildErrorUpdateFields = (config, message) => {
  if (!config.errorColumn) {
    return {};
  }

  return { [config.errorColumn]: message };
};

export const handler = async (event) => {
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
  const tableConfig = getTableConfig(tableName);

  const updateStatus = async (status, extra = {}) => {
    const updatePayload = { ...extra };
    const mappedStatus = (tableConfig.statusMap && tableConfig.statusMap[status]) || status;

    if (tableConfig.statusColumn) {
      updatePayload[tableConfig.statusColumn] = mappedStatus;
    }

    if (tableConfig.updatedAtColumn) {
      updatePayload[tableConfig.updatedAtColumn] = new Date().toISOString();
    }

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
      await updateStatus('error', buildErrorUpdateFields(tableConfig, 'Unable to fetch original file from storage'));
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
      await updateStatus('error', buildErrorUpdateFields(tableConfig, `ImageKit upload failed: ${errorText}`));
      return buildErrorResponse(502, 'ImageKit upload failed');
    }

    const uploadResult = await response.json();
    const baseUrl = uploadResult.url || `${IMAGEKIT_ENDPOINT.replace(/\/$/, '')}/${uploadResult.filePath}`;
    const variants = buildVariantUrls(baseUrl, assetType, tableName);
    const processedAt = new Date().toISOString();
    const updateFields = buildSuccessUpdateFields(tableConfig, uploadResult, baseUrl, variants, processedAt);

    await updateStatus('ready', updateFields);

    // Warm up ImageKit variant URLs so on-demand transformations (e.g. e-removedotbg)
    // are pre-processed and cached before any PDF generation requests them.
    // Fire-and-forget — we don't await or block on these.
    if (variants && typeof variants === 'object') {
      for (const url of Object.values(variants)) {
        if (typeof url === 'string' && url.startsWith('http')) {
          fetch(url, { method: 'HEAD' }).catch(() => {});
        }
      }
      console.log(`imagekit-process: warming up ${Object.keys(variants).length} variant URL(s)`);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, assetId, variants }),
    };
  } catch (err) {
    console.error('Unexpected image processing error', err);
    await updateStatus('error', buildErrorUpdateFields(tableConfig, err?.message || 'Unexpected error'));
    return buildErrorResponse(500, 'Unexpected processing error');
  }
};
