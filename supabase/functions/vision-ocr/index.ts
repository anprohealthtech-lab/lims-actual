const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-attachment-id, x-order-id, x-test-group-id, x-batch-id',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
}

/**
 * Get AI prompt with hierarchical fallback (same as process-trf)
 */
async function getAIPrompt(
  supabaseUrl: string,
  supabaseAnonKey: string,
  authToken: string,
  processingType: string,
  labId?: string,
  testGroupId?: string
): Promise<string | null> {
  try {
    console.log(`\n🔍 AI Prompt Lookup Starting...`);
    console.log(`  - Type: ${processingType}`);
    console.log(`  - Lab ID: ${labId || 'not provided'}`);
    console.log(`  - Test Group ID: ${testGroupId || 'not provided'}`);

    const headers = {
      'apikey': supabaseAnonKey,
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    };

    // Try: Lab + Test specific
    if (labId && testGroupId) {
      console.log('  → Trying: Lab + Test specific prompt...');
      const params = new URLSearchParams({
        select: 'prompt',
        lab_id: `eq.${labId}`,
        test_id: `eq.${testGroupId}`,
        ai_processing_type: `eq.${processingType}`,
        analyte_id: 'is.null',
      });

      const response = await fetch(`${supabaseUrl}/rest/v1/ai_prompts?${params.toString()}`, { headers });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0 && data[0].prompt) {
          console.log('  ✅ FOUND: Lab + Test specific prompt');
          console.log(`     Length: ${data[0].prompt.length} chars`);
          return data[0].prompt;
        }
      }
      console.log('  ❌ Not found: Lab + Test specific prompt');
    }

    // Try: Test-specific
    if (testGroupId) {
      console.log('  → Trying: Test-specific prompt...');
      const params = new URLSearchParams({
        select: 'prompt',
        test_id: `eq.${testGroupId}`,
        ai_processing_type: `eq.${processingType}`,
        lab_id: 'is.null',
        analyte_id: 'is.null',
      });

      const response = await fetch(`${supabaseUrl}/rest/v1/ai_prompts?${params.toString()}`, { headers });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0 && data[0].prompt) {
          console.log('  ✅ FOUND: Test-specific prompt');
          console.log(`     Length: ${data[0].prompt.length} chars`);
          return data[0].prompt;
        }
      }
      console.log('  ❌ Not found: Test-specific prompt');
    }

    // Try: Test group level prompt
    if (testGroupId) {
      console.log('  → Trying: Test Group level prompt...');
      const params = new URLSearchParams({
        select: 'group_level_prompt',
        id: `eq.${testGroupId}`,
      });

      const response = await fetch(`${supabaseUrl}/rest/v1/test_groups?${params.toString()}`, { headers });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0 && data[0].group_level_prompt) {
          console.log('  ✅ FOUND: Test Group level prompt');
          console.log(`     Length: ${data[0].group_level_prompt.length} chars`);
          return data[0].group_level_prompt;
        }
      }
      console.log('  ❌ Not found: Test Group level prompt');
    }

    // Try: Default prompt
    console.log('  → Trying: Default prompt from database...');
    const params = new URLSearchParams({
      select: 'prompt',
      ai_processing_type: `eq.${processingType}`,
      default: 'eq.true',
      lab_id: 'is.null',
      test_id: 'is.null',
      analyte_id: 'is.null',
    });

    const response = await fetch(`${supabaseUrl}/rest/v1/ai_prompts?${params.toString()}`, { headers });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0 && data[0].prompt) {
        console.log('  ✅ FOUND: Default prompt from database');
        console.log(`     Length: ${data[0].prompt.length} chars`);
        return data[0].prompt;
      }
    }
    console.log('  ❌ Not found: Default prompt in database');

    // No custom prompt found - will use hardcoded
    console.log('  ⚠️  No custom prompt found - will use hardcoded default');
    return null;
  } catch (error) {
    console.error('❌ Error fetching AI prompt:', error);
    return null;
  }
}

/**
 * Intelligently detect the best AI processing type for a test group
 * by checking which processing types have custom prompts configured
 */
async function detectProcessingType(
  supabaseUrl: string,
  supabaseAnonKey: string,
  authToken: string,
  labId?: string,
  testGroupId?: string
): Promise<string | null> {
  if (!testGroupId) return null;

  const processingTypes = ['vision_color', 'vision_card', 'ocr_report', 'nlp_extraction'];
  
  console.log('\n🔍 Auto-detecting best AI processing type...');
  console.log(`  - Lab ID: ${labId || 'not provided'}`);
  console.log(`  - Test Group ID: ${testGroupId}`);

  const headers = {
    'apikey': supabaseAnonKey,
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  };

  // Check each processing type in priority order
  for (const type of processingTypes) {
    console.log(`\n  → Checking for ${type} prompts...`);
    
    // Try Lab + Test specific
    if (labId && testGroupId) {
      console.log(`     Lab + Test specific lookup:`);
      console.log(`       - lab_id: ${labId}`);
      console.log(`       - test_id: ${testGroupId}`);
      console.log(`       - ai_processing_type: ${type}`);
      
      const params = new URLSearchParams({
        select: 'prompt',
        lab_id: `eq.${labId}`,
        test_id: `eq.${testGroupId}`,
        ai_processing_type: `eq.${type}`,
        analyte_id: 'is.null',
      });

      const url = `${supabaseUrl}/rest/v1/ai_prompts?${params.toString()}`;
      console.log(`     Query URL: ${url}`);
      
      const response = await fetch(url, { headers });
      console.log(`     HTTP Status: ${response.status}`);
      
      if (response.ok) {
        const data = await response.json();
        console.log(`     Response: ${data.length} rows found`);
        if (data.length > 0) {
          console.log(`     First row:`, JSON.stringify(data[0]).substring(0, 200));
        }
        if (Array.isArray(data) && data.length > 0 && data[0].prompt) {
          console.log(`  ✅ FOUND: Lab + Test specific prompt for ${type}`);
          return type;
        } else {
          console.log(`  ❌ No matching rows (or prompt field is null)`);
        }
      } else {
        const errorText = await response.text();
        console.log(`     HTTP Error: ${response.status} ${response.statusText}`);
        console.log(`     Error details: ${errorText}`);
      }
    } else {
      console.log(`     Skipping Lab + Test specific (labId: ${!!labId}, testGroupId: ${!!testGroupId})`);
    }

    // Try Test-specific
    if (testGroupId) {
      const params = new URLSearchParams({
        select: 'prompt',
        test_id: `eq.${testGroupId}`,
        ai_processing_type: `eq.${type}`,
        lab_id: 'is.null',
        analyte_id: 'is.null',
      });

      const url = `${supabaseUrl}/rest/v1/ai_prompts?${params.toString()}`;
      console.log(`     Query: ${url}`);
      
      const response = await fetch(url, { headers });
      if (response.ok) {
        const data = await response.json();
        console.log(`     Response: ${data.length} rows found`);
        if (Array.isArray(data) && data.length > 0 && data[0].prompt) {
          console.log(`  ✅ Found custom prompt for type: ${type} (Test specific)`);
          return type;
        }
      } else {
        console.log(`     HTTP Error: ${response.status} ${response.statusText}`);
      }
    }
  }

  console.log('  ℹ️  No custom prompts found - will use default detection');
  return null;
}

interface VisionRequest {
  attachmentId?: string;
  base64Image?: string;
  documentType?: string;
  testType?: string;
  aiProcessingType?: string;
  analysisType?: 'text' | 'objects' | 'colors' | 'all';
  orderId?: string;
  testGroupId?: string;
  analyteIds?: string[];
  batchId?: string;
  referenceImages?: Array<{
    url: string;
    type?: string;
    description?: string;
  }>;
  customInstruction?: string;
}

interface VisionResponse {
  fullText?: string;
  objects?: any[];
  colors?: any[];
  confidence?: number;
  error?: string;
}

interface TestContext {
  order?: {
    id: string;
    lab_id?: string | null;
    patient?: {
      id?: string;
      age?: number | null;
      gender?: string | null;
    } | null;
  };
  testGroup?: {
    id: string;
    name?: string | null;
    code?: string | null;
    lab_id?: string | null;
    ai_processing_type?: string | null;
    ai_prompt_override?: string | null;
  };
  analytes?: Array<{
    id?: string;
    name?: string | null;
    unit?: string | null;
    reference_range?: string | null;
    code?: string | null;
    ai_processing_type?: string | null;
    ai_prompt_override?: string | null;
  }>;
  labOverrides?: any[];
}

interface BatchImageReference {
  sequence: number;
  label?: string | null;
  attachmentId: string;
  fileUrl?: string | null;
  description?: string | null;
}

/**
 * Safely convert Uint8Array to base64 without hitting call stack limits
 */
function uint8ArrayToBase64(array: Uint8Array): string {
  let binary = '';
  const len = array.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(array[i]);
  }
  return btoa(binary);
}

async function getTestContext(orderId?: string, testGroupId?: string, analyteIds?: string[]): Promise<TestContext> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceKey) {
    return {};
  }

  const headers = {
    'Authorization': `Bearer ${supabaseServiceKey}`,
    'apikey': supabaseServiceKey,
    'Content-Type': 'application/json',
  };

  const context: TestContext = {};
  let labId: string | null = null;

  try {
    if (orderId) {
      const orderParams = new URLSearchParams({
        id: `eq.${orderId}`,
        select: 'id,lab_id,patient_id',
        limit: '1'
      });

      const orderResponse = await fetch(`${supabaseUrl}/rest/v1/orders?${orderParams.toString()}`, {
        headers,
      });

      if (orderResponse.ok) {
        const orders = await orderResponse.json();
        if (Array.isArray(orders) && orders.length > 0) {
          const orderRow = orders[0];
          context.order = {
            id: orderRow.id,
            lab_id: orderRow.lab_id,
            patient: orderRow.patient_id ? { id: orderRow.patient_id } : null,
          };
          labId = orderRow.lab_id || null;
        }
      } else {
        console.warn('Failed to fetch order context', await orderResponse.text());
      }
    }

    if (testGroupId) {
      const select = 'id,name,code,lab_id,default_ai_processing_type,test_group_analytes(analyte_id,analytes(id,name,unit,reference_range))';
      const tgParams = new URLSearchParams({
        id: `eq.${testGroupId}`,
        select,
        limit: '1'
      });

      const tgResponse = await fetch(`${supabaseUrl}/rest/v1/test_groups?${tgParams.toString()}`, {
        headers,
      });

      if (tgResponse.ok) {
        const groups = await tgResponse.json();
        if (Array.isArray(groups) && groups.length > 0) {
          const group = groups[0];
          context.testGroup = {
            id: group.id,
            name: group.name,
            code: group.code,
            lab_id: group.lab_id,
            ai_processing_type: group.default_ai_processing_type,
          };

          const analytesFromGroup = Array.isArray(group.test_group_analytes)
            ? group.test_group_analytes.map((tga: any) => ({
                id: tga.analytes?.id || tga.analyte_id,
                name: tga.analytes?.name,
                unit: tga.analytes?.unit,
                reference_range: tga.analytes?.reference_range,
              }))
            : [];

          if (analytesFromGroup.length) {
            context.analytes = analytesFromGroup;
          }

          if (!labId && group.lab_id) {
            labId = group.lab_id;
          }
        }
      } else {
        console.warn('Failed to fetch test group context', await tgResponse.text());
      }
    }

    const analyteIdSet = new Set<string>();
    if (Array.isArray(context.analytes)) {
      context.analytes.forEach((a) => {
        if (a?.id) analyteIdSet.add(a.id);
      });
    }
    if (Array.isArray(analyteIds)) {
      analyteIds.forEach((id) => {
        if (id) analyteIdSet.add(id);
      });
    }

    const analyteIdArray = Array.from(analyteIdSet);

    if (analyteIdArray.length && (!context.analytes || context.analytes.length < analyteIdArray.length)) {
      const analyteParams = new URLSearchParams({
        select: 'id,name,unit,reference_range',
        id: `in.(${analyteIdArray.join(',')})`
      });

      const analyteResponse = await fetch(`${supabaseUrl}/rest/v1/analytes?${analyteParams.toString()}`, {
        headers,
      });

      if (analyteResponse.ok) {
        const analyteRows = await analyteResponse.json();
        if (Array.isArray(analyteRows)) {
          const existing = new Map<string, any>();
          (context.analytes || []).forEach((a) => {
            if (a?.id) existing.set(a.id, a);
          });

          analyteRows.forEach((row: any) => {
            if (!row?.id) return;
            if (!existing.has(row.id)) {
              existing.set(row.id, {
                id: row.id,
                name: row.name,
                unit: row.unit,
                reference_range: row.reference_range,
              });
            } else {
              const current = existing.get(row.id);
              if (current) {
                current.name = current.name || row.name;
                current.unit = current.unit || row.unit;
                current.reference_range = current.reference_range || row.reference_range;
              }
            }
          });

          context.analytes = Array.from(existing.values());
        }
      } else {
        console.warn('Failed to fetch analyte context', await analyteResponse.text());
      }
    }

    if (labId && analyteIdArray.length) {
      const labParams = new URLSearchParams({
        select: '*',
        lab_id: `eq.${labId}`,
        analyte_id: `in.(${analyteIdArray.join(',')})`
      });

      const labResponse = await fetch(`${supabaseUrl}/rest/v1/lab_analytes?${labParams.toString()}`, {
        headers,
      });

      if (labResponse.ok) {
        const labRows = await labResponse.json();
        if (Array.isArray(labRows) && labRows.length) {
          context.labOverrides = labRows;
        }
      }
    }
  } catch (error) {
    console.error('Failed to build test context:', error);
  }

  return context;
}

async function getBatchImageContext(batchId?: string): Promise<BatchImageReference[]> {
  if (!batchId) return [];

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceKey) {
    return [];
  }

  const headers = {
    'Authorization': `Bearer ${supabaseServiceKey}`,
    'apikey': supabaseServiceKey,
    'Content-Type': 'application/json',
  };

  try {
    const params = new URLSearchParams({
      batch_id: `eq.${batchId}`,
      select: 'id,batch_sequence,image_label,imagekit_url,processed_url,file_url,description',
      order: 'batch_sequence.asc'
    });

    const response = await fetch(`${supabaseUrl}/rest/v1/attachments?${params.toString()}`, {
      headers,
    });

    if (!response.ok) {
      console.warn('Failed to fetch batch image context', await response.text());
      return [];
    }

    const rows = await response.json();
    if (!Array.isArray(rows)) {
      return [];
    }

    return rows.map((row: any) => ({
      sequence: row.batch_sequence || 0,
      label: row.image_label || null,
      attachmentId: row.id,
      fileUrl: row.imagekit_url || row.processed_url || row.file_url || null,
      description: row.description || null,
    }));
  } catch (error) {
    console.error('Failed to load batch image context:', error);
  }

  return [];
}

function buildContextAwarePrompt(
  aiProcessingType: string | undefined, 
  context: TestContext, 
  customInstruction?: string,
  databasePrompt?: string | null
): string | undefined {
  // Priority 1: Custom instruction from request
  if (customInstruction && customInstruction.trim().length > 0) {
    console.log('  📝 Using custom instruction from request');
    return customInstruction.trim();
  }

  // Priority 2: Database prompt (from AI Prompts Manager)
  if (databasePrompt && databasePrompt.trim().length > 0) {
    console.log('  📝 Using prompt from AI Prompts database');
    console.log(`     Preview: ${databasePrompt.substring(0, 200)}...`);
    return databasePrompt.trim();
  }

  // Priority 3: Generate context-aware prompt (fallback)
  console.log('  📝 Generating context-aware fallback prompt');
  const analyteNames = (context.analytes || [])
    .map((a) => a?.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0);

  if (!analyteNames.length) {
    return undefined;
  }

  const analyteList = analyteNames.join(', ');
  const baseInstruction = `Extract or identify results for the following analytes: ${analyteList}. Return structured data with values and units where applicable.`;

  switch (aiProcessingType) {
    case 'vision_color':
      return `${baseInstruction} Focus on color-based interpretations (e.g., urine strips, reagent cards).`; 
    case 'vision_card':
      return `${baseInstruction} Determine presence/absence or band intensity for card-based rapid tests.`;
    case 'ocr_report':
      return `${baseInstruction} Use OCR to capture numeric values from tables or printed reports.`;
    default:
      return baseInstruction;
  }
}

/**
 * Call Google Cloud Vision AI Text Detection
 */
async function getVisionText(base64Image: string, apiKey: string): Promise<any> {
  // Validate base64 image
  if (!base64Image || base64Image.length === 0) {
    throw new Error('Invalid base64 image data');
  }

  // Remove data URL prefix if present
  const cleanBase64 = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');
  
  // Check if base64 is valid
  try {
    atob(cleanBase64);
  } catch (error) {
    throw new Error('Invalid base64 encoding');
  }

  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            image: {
              content: cleanBase64,
            },
            features: [
              { type: 'DOCUMENT_TEXT_DETECTION' },
              { type: 'TEXT_DETECTION' }
            ],
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Vision API Error Details:', errorText);
    throw new Error(`Vision API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const result = await response.json();
  const annotations = result.responses[0];
  
  // Check for API errors in response
  if (annotations.error) {
    throw new Error(`Vision API response error: ${annotations.error.message}`);
  }
  
  return {
    fullText: annotations.fullTextAnnotation?.text || '',
    textAnnotations: annotations.textAnnotations || [],
    confidence: annotations.textAnnotations?.[0]?.confidence || 0,
  };
}

/**
 * Call Google Cloud Vision AI Object Detection
 */
async function getVisionObjects(base64Image: string, apiKey: string): Promise<any> {
  // Validate base64 image
  if (!base64Image || base64Image.length === 0) {
    throw new Error('Invalid base64 image data');
  }

  // Remove data URL prefix if present
  const cleanBase64 = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');

  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            image: {
              content: cleanBase64,
            },
            features: [
              { type: 'OBJECT_LOCALIZATION', maxResults: 20 },
              { type: 'LABEL_DETECTION', maxResults: 20 }
            ],
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Vision API Error Details:', errorText);
    throw new Error(`Vision API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const result = await response.json();
  const annotations = result.responses[0];
  
  // Check for API errors in response
  if (annotations.error) {
    throw new Error(`Vision API response error: ${annotations.error.message}`);
  }
  
  return {
    objects: annotations.localizedObjectAnnotations || [],
    labels: annotations.labelAnnotations || [],
    objectCount: annotations.localizedObjectAnnotations?.length || 0,
    labelCount: annotations.labelAnnotations?.length || 0,
  };
}

/**
 * Call Google Cloud Vision AI Color Detection
 */
async function getVisionColors(base64Image: string, apiKey: string): Promise<any> {
  // Validate base64 image
  if (!base64Image || base64Image.length === 0) {
    throw new Error('Invalid base64 image data');
  }

  // Remove data URL prefix if present
  const cleanBase64 = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');

  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            image: {
              content: cleanBase64,
            },
            features: [
              { type: 'IMAGE_PROPERTIES' }
            ],
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Vision API Error Details:', errorText);
    throw new Error(`Vision API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const result = await response.json();
  const annotations = result.responses[0];
  
  // Check for API errors in response
  if (annotations.error) {
    throw new Error(`Vision API response error: ${annotations.error.message}`);
  }
  
  const colors = annotations.imagePropertiesAnnotation?.dominantColors?.colors || [];
  
  return {
    dominantColors: colors.map((colorInfo: any) => ({
      color: {
        red: colorInfo.color.red || 0,
        green: colorInfo.color.green || 0,
        blue: colorInfo.color.blue || 0
      },
      score: colorInfo.score || 0,
      pixelFraction: colorInfo.pixelFraction || 0,
      hexColor: rgbToHex(
        colorInfo.color.red || 0,
        colorInfo.color.green || 0,
        colorInfo.color.blue || 0
      )
    })),
    colorCount: colors.length
  };
}

/**
 * Helper function to convert RGB to HEX
 */
function rgbToHex(r: number, g: number, b: number): string {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/**
 * Get image from Supabase Storage
 */
async function getImageFromStorage(attachmentId: string): Promise<string> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Supabase configuration missing');
  }

  // Get attachment record
  const attachmentResponse = await fetch(
    `${supabaseUrl}/rest/v1/attachments?id=eq.${attachmentId}&select=*`,
    {
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'apikey': supabaseServiceKey,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!attachmentResponse.ok) {
    throw new Error('Failed to fetch attachment record');
  }

  const attachments = await attachmentResponse.json();
  if (!attachments || attachments.length === 0) {
    throw new Error('Attachment not found');
  }

  const attachment = attachments[0];

  const candidateUrls = Array.from(new Set([
    typeof attachment.imagekit_url === 'string' ? attachment.imagekit_url.trim() : null,
    typeof attachment.processed_url === 'string' ? attachment.processed_url.trim() : null,
  ].filter((url) => url && url.length > 0))) as string[];

  for (const candidate of candidateUrls) {
    try {
      const processedResponse = await fetch(candidate);
      if (!processedResponse.ok) {
        continue;
      }

      const processedBuffer = await processedResponse.arrayBuffer();
      if (processedBuffer.byteLength === 0) {
        continue;
      }

      const processedBase64 = uint8ArrayToBase64(new Uint8Array(processedBuffer));
      return processedBase64;
    } catch (error) {
      console.warn(`Failed to fetch processed attachment from ${candidate}`, error);
    }
  }

  // Download file from Supabase Storage
  const fileResponse = await fetch(
    `${supabaseUrl}/storage/v1/object/attachments/${attachment.file_path}`,
    {
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
    }
  );

  if (!fileResponse.ok) {
    throw new Error('Failed to download file from storage');
  }

  const fileBlob = await fileResponse.blob();
  const arrayBuffer = await fileBlob.arrayBuffer();
  const base64 = uint8ArrayToBase64(new Uint8Array(arrayBuffer));
  
  return base64;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get Supabase configuration
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const authHeader = req.headers.get('Authorization') || '';
    
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Supabase configuration missing');
      return new Response(
        JSON.stringify({ 
          error: 'Supabase configuration missing',
          details: 'SUPABASE_URL or SUPABASE_ANON_KEY not set'
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }
    
    // Check for API key first - try ALLGOOGLE_KEY first, then fallback to GOOGLE_CLOUD_API_KEY
    const visionApiKey = Deno.env.get('ALLGOOGLE_KEY') || Deno.env.get('GOOGLE_CLOUD_API_KEY');
    if (!visionApiKey) {
      console.error('Google API key not configured');
      return new Response(
        JSON.stringify({ 
          error: 'Google API key not configured',
          details: 'Please set ALLGOOGLE_KEY or GOOGLE_CLOUD_API_KEY in Supabase secrets'
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const requestBody = await req.json();
    const {
      attachmentId,
      base64Image,
      documentType,
      testType,
      analysisType = 'all',
      aiProcessingType,
      orderId,
      testGroupId,
      analyteIds,
      batchId,
      referenceImages,
      customInstruction
    }: VisionRequest = requestBody;

    // Log what the frontend actually sent
    console.log('\n📨 Vision OCR Request Received:');
    console.log('  Raw request body:', JSON.stringify(requestBody, null, 2));
    console.log('  Extracted values:');
    console.log(`    - aiProcessingType: ${aiProcessingType || 'NOT PROVIDED'}`);
    console.log(`    - documentType: ${documentType || 'NOT PROVIDED'}`);
    console.log(`    - testType: ${testType || 'NOT PROVIDED'}`);
    console.log(`    - orderId: ${orderId || 'NOT PROVIDED'}`);
    console.log(`    - testGroupId: ${testGroupId || 'NOT PROVIDED'}`);
    console.log(`    - attachmentId: ${attachmentId || 'NOT PROVIDED'}`);

    // Check if we have any image source
    const hasReferenceImages = Array.isArray(referenceImages) && referenceImages.length > 0;
    
    if (!attachmentId && !base64Image && !hasReferenceImages) {
      return new Response(
        JSON.stringify({ error: 'Missing attachmentId, base64Image, or referenceImages' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Starting Vision AI processing for ${aiProcessingType || documentType || testType || 'unknown'} type`);
    console.log(`  - Has referenceImages: ${hasReferenceImages} (count: ${hasReferenceImages ? referenceImages.length : 0})`);

    // Get image data
    let imageData = base64Image;
    
    // If we have reference images but no attachmentId/base64Image, use the first reference image
    if (!imageData && hasReferenceImages) {
      console.log('  ℹ️  Using first reference image as primary image source');
      const firstRefImage = referenceImages[0];
      
      // If the reference image has a URL, fetch it
      if (firstRefImage.url) {
        try {
          console.log(`  📥 Fetching reference image from: ${firstRefImage.url}`);
          const imageResponse = await fetch(firstRefImage.url);
          if (!imageResponse.ok) {
            throw new Error(`Failed to fetch reference image: ${imageResponse.status}`);
          }
          const imageBuffer = await imageResponse.arrayBuffer();
          
          imageData = uint8ArrayToBase64(new Uint8Array(imageBuffer));
          
          console.log('  ✅ Successfully fetched and converted reference image to base64');
        } catch (error) {
          console.error('  ❌ Error fetching reference image:', error);
          return new Response(
            JSON.stringify({ 
              error: 'Failed to fetch reference image',
              details: error instanceof Error ? error.message : String(error)
            }),
            { 
              status: 400, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
      }
    } else if (attachmentId && !imageData) {
      // Original behavior: fetch from storage if we have attachmentId
      imageData = await getImageFromStorage(attachmentId);
    }

    if (!imageData) {
      return new Response(
        JSON.stringify({ error: 'No image data available' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const testContext = await getTestContext(orderId, testGroupId, analyteIds);
    const batchContext = await getBatchImageContext(batchId);
    const labId = testContext.order?.lab_id || undefined;
    
    console.log('\n📋 Context Summary:');
    console.log(`  - Order ID: ${orderId || 'not provided'}`);
    console.log(`  - Test Group ID: ${testGroupId || 'not provided'}`);
    console.log(`  - Lab ID from context: ${labId || 'not found'}`);
    console.log(`  - AI Processing Type param: ${aiProcessingType || 'not provided'}`);
    
    // Intelligent processing type detection
    // Priority: auto-detect from custom prompts > explicit param > test group config
    let effectiveProcessingType: string | null = null;
    
    console.log(`  - AI Processing Type param: ${aiProcessingType || 'not provided'}`);
    console.log(`  - Test Group config: ${testContext.testGroup?.ai_processing_type || 'not set'}`);
    
    // ALWAYS try auto-detection first if we have test context
    if (testGroupId && labId) {
      console.log('\n🔍 Starting auto-detection for custom prompts...');
      const detectedType = await detectProcessingType(
        supabaseUrl,
        supabaseAnonKey,
        authHeader.replace('Bearer ', ''),
        labId,
        testGroupId
      );
      if (detectedType) {
        effectiveProcessingType = detectedType;
        console.log(`  ✅ Auto-detected processing type: ${detectedType}`);
      } else {
        console.log(`  ℹ️  No custom prompts found, falling back to defaults...`);
      }
    }
    
    // Fallback to explicit params or test group config if auto-detection didn't find anything
    if (!effectiveProcessingType) {
      effectiveProcessingType = aiProcessingType || testContext.testGroup?.ai_processing_type;
      if (effectiveProcessingType) {
        console.log(`  ⏭️  Using fallback processing type: ${effectiveProcessingType}`);
      }
    }
    
    // Fetch AI prompt from database (hierarchical lookup)
    let databasePrompt: string | null = null;
    
    if (effectiveProcessingType && typeof effectiveProcessingType === 'string') {
      console.log('\n📝 Fetching AI prompt for Vision OCR...');
      databasePrompt = await getAIPrompt(
        supabaseUrl,
        supabaseAnonKey,
        authHeader.replace('Bearer ', ''),
        effectiveProcessingType,
        labId,
        testGroupId
      );
    }
    
    const contextPrompt = buildContextAwarePrompt(
      typeof effectiveProcessingType === 'string' ? effectiveProcessingType : undefined,
      testContext,
      customInstruction,
      databasePrompt
    );

    const batchReferenceImages = batchContext
      .filter((reference) => !!reference.fileUrl)
      .map((reference) => ({
        url: reference.fileUrl as string,
        type: 'batch',
        description: reference.description || reference.label || undefined,
      }));

    const combinedReferenceImages = [
      ...(Array.isArray(referenceImages) ? referenceImages : []),
      ...batchReferenceImages,
    ];

    if (contextPrompt) {
      console.log('Context-aware prompt generated for Vision OCR run:', contextPrompt);
    }

    const visionResults: VisionResponse = {};

    // Determine which Vision AI features to use based on document/test type
    const needsText = analysisType === 'all' || analysisType === 'text' ||
                     effectiveProcessingType === 'ocr_report' ||
                     ['instrument-screen', 'printed-report', 'handwritten', 'test-request-form'].includes(documentType || '');
    
    const needsObjects = analysisType === 'all' || analysisType === 'objects' ||
                        effectiveProcessingType === 'vision_card' ||
                        ['blood-group', 'covid-test', 'malaria-test', 'pregnancy-test', 'dengue-test'].includes(testType || '');
    
    const needsColors = analysisType === 'all' || analysisType === 'colors' ||
                       effectiveProcessingType === 'vision_color' ||
                       ['urine-strip', 'blood-group', 'pipette-validation'].includes(testType || documentType || '');

    // Execute Vision AI calls based on requirements
    if (needsText) {
      try {
        console.log('Performing text extraction with Vision AI...');
        const textResult = await getVisionText(imageData, visionApiKey);
        visionResults.fullText = textResult.fullText;
        visionResults.confidence = textResult.confidence;
        console.log(`Text extraction completed. Extracted ${textResult.fullText.length} characters`);
      } catch (error) {
        console.error('Text extraction failed:', error);
        visionResults.error = `Text extraction failed: ${error.message}`;
      }
    }

    if (needsObjects) {
      try {
        console.log('Performing object detection with Vision AI...');
        const objectResult = await getVisionObjects(imageData, visionApiKey);
        visionResults.objects = objectResult.objects;
        console.log(`Object detection completed. Found ${objectResult.objectCount} objects`);
      } catch (error) {
        console.error('Object detection failed:', error);
        if (!visionResults.error) visionResults.error = `Object detection failed: ${error.message}`;
      }
    }

    if (needsColors) {
      try {
        console.log('Performing color analysis with Vision AI...');
        const colorResult = await getVisionColors(imageData, visionApiKey);
        visionResults.colors = colorResult.dominantColors;
        console.log(`Color analysis completed. Found ${colorResult.colorCount} dominant colors`);
      } catch (error) {
        console.error('Color analysis failed:', error);
        if (!visionResults.error) visionResults.error = `Color analysis failed: ${error.message}`;
      }
    }

    // Add metadata
    const responseData = {
      ...visionResults,
      originalBase64Image: imageData,
      testContext,
      batchContext,
      referenceImages: combinedReferenceImages,
      promptUsed: contextPrompt,
      customPrompt: databasePrompt || null, // Include custom prompt from database
      metadata: {
        documentType: documentType || testType || effectiveProcessingType,
        aiProcessingType: effectiveProcessingType || null, // Use detected type, not original param
        customPromptAvailable: !!databasePrompt, // Indicate if custom prompt was found
        analysisType,
        featuresUsed: {
          text: needsText,
          objects: needsObjects,
          colors: needsColors
        },
        processingTimestamp: new Date().toISOString(),
        attachmentId: attachmentId || null,
        orderId: orderId || null,
        testGroupId: testGroupId || testContext.testGroup?.id || null,
        analyteIds: Array.isArray(analyteIds) ? analyteIds : (testContext.analytes?.map((a) => a.id).filter(Boolean) || []),
        batchId: batchId || null,
        referenceImageCount: combinedReferenceImages.length,
        contextPrompt,
      }
    };

    // Update attachment with AI processing metadata if attachmentId provided
    if (attachmentId) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      
      if (supabaseUrl && supabaseServiceKey) {
        try {
          await fetch(
            `${supabaseUrl}/rest/v1/attachments?id=eq.${attachmentId}`,
            {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${supabaseServiceKey}`,
                'apikey': supabaseServiceKey,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                ai_processed: !visionResults.error,
                ai_confidence: visionResults.confidence || null,
                processing_status: visionResults.error ? 'failed' : 'processed',
                ai_processed_at: new Date().toISOString(),
                ai_processing_type: effectiveProcessingType || null, // Use detected type
                ai_metadata: {
                  vision_features_used: {
                    text: needsText,
                    objects: needsObjects,
                    colors: needsColors
                  },
                  text_length: visionResults.fullText?.length || 0,
                  objects_count: visionResults.objects?.length || 0,
                  colors_count: visionResults.colors?.length || 0,
                  error: visionResults.error || null,
                  order_id: orderId || null,
                  test_group_id: testGroupId || testContext.testGroup?.id || null,
                  batch_id: responseData.metadata?.batchId || batchId || null,
                  context_prompt: contextPrompt || null,
                  reference_image_count: combinedReferenceImages.length,
                  analyte_ids: Array.isArray(responseData.metadata?.analyteIds)
                    ? responseData.metadata.analyteIds
                    : [],
                }
              })
            }
          );
          console.log(`Updated attachment ${attachmentId} with AI processing metadata`);
        } catch (updateError) {
          console.error('Failed to update attachment metadata:', updateError);
          // Don't fail the request if metadata update fails
        }
      }
    }

    return new Response(
      JSON.stringify(responseData),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Vision OCR function error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Vision processing failed', 
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
