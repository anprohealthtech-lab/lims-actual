/**
 * Report to Template - Netlify Function
 *
 * Analyzes uploaded report images/PDFs using Claude AI vision
 * and generates HTML template with proper analyte placeholders.
 */

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Analyte {
  id: string;
  name: string;
  code: string;
  unit?: string | null;
  reference_range?: string | null;
}

interface RequestPayload {
  /** Base64 encoded image or PDF page */
  imageBase64: string;
  /** MIME type of the image (image/png, image/jpeg, application/pdf) */
  mimeType: string;
  /** Available analytes from the selected test group */
  analytes: Analyte[];
  /** Test group name for context */
  testGroupName: string;
  /** Optional: existing HTML to enhance/modify */
  existingHtml?: string;
}

const SYSTEM_PROMPT = `You are an expert at analyzing laboratory report images and creating HTML templates that replicate their visual layout EXACTLY.

Your task is to:
1. Analyze the uploaded report image carefully
2. Identify ALL sections, subsections, headers, and the complete structure
3. Create clean HTML that replicates the report's appearance EXACTLY including all section headers
4. Replace actual result values with the appropriate analyte placeholders

CRITICAL RULES:

1. PLACEHOLDER FORMAT - Use EXACTLY these placeholder patterns:
   - Patient info: {{patientName}}, {{patientAge}}, {{patientGender}}, {{patientId}}, {{sampleId}}
   - Order info: {{orderId}}, {{registrationDate}}, {{collectionDate}}, {{sampleCollectedAt}}, {{approvedAt}}, {{reportDate}}
   - Lab info: {{labName}}, {{labAddress}}, {{labPhone}}, {{labEmail}}
   - Doctor: {{referringDoctorName}}
   - Location: {{locationName}}
   - Signatory: {{signatoryName}}, {{signatoryDesignation}}, {{signatoryImageUrl}}
   - Images: {{headerImageUrl}}, {{footerImageUrl}}

2. ANALYTE PLACEHOLDERS - For test results, use:
   - {{ANALYTE_[code]_VALUE}} - for the result value
   - {{ANALYTE_[code]_UNIT}} - for the unit
   - {{ANALYTE_[code]_REFERENCE}} - for reference range
   - {{ANALYTE_[code]_FLAG}} - for H/L/Normal flag

   Use the EXACT analyte codes provided in the analyte list.

3. **COMPLETE HTML TEMPLATE STRUCTURE** - Use this EXACT format:

<div class="report-container">
  <div class="report-header">
    <h1>TEST_GROUP_NAME_HERE</h1>
    <div class="report-subtitle">Laboratory Test Report</div>
  </div>

  <div class="report-body">
    <div class="section-header">Patient Information</div>
    <table class="patient-info">
      <tbody>
        <tr>
          <td class="label">Patient Name</td><td class="value">{{patientName}}</td>
          <td class="label">Patient ID</td><td class="value">{{patientId}}</td>
        </tr>
        <tr>
          <td class="label">Age / Gender</td><td class="value">{{patientAge}} / {{patientGender}}</td>
          <td class="label">Sample ID</td><td class="value">{{sampleId}}</td>
        </tr>
        <tr>
          <td class="label">Ref. Doctor</td><td class="value">{{referringDoctorName}}</td>
          <td class="label">Collected On</td><td class="value">{{collectionDate}}</td>
        </tr>
      </tbody>
    </table>

    <div class="section-header">Test Results</div>
    <!-- RESULTS TABLE WITH SUBSECTIONS -->
    <table class="report-table">
      <thead>
        <tr>
          <th>Test Parameter</th>
          <th class="col-center">Result</th>
          <th class="col-center">Unit</th>
          <th>Reference Range</th>
          <th class="col-center">Flag</th>
        </tr>
      </thead>
      <tbody>
        <!-- For subsections within results, use: -->
        <tr class="section-header">
          <td colspan="5" style="background:#0b4aa2;color:#fff;font-weight:bold;padding:8px 12px;">SUBSECTION NAME (e.g., BLOOD COUNT AND INDICES)</td>
        </tr>
        <tr>
          <td class="param-name">Test Name</td>
          <td class="col-center">{{ANALYTE_CODE_VALUE}}</td>
          <td class="col-center">{{ANALYTE_CODE_UNIT}}</td>
          <td>{{ANALYTE_CODE_REFERENCE}}</td>
          <td class="col-center">{{ANALYTE_CODE_FLAG}}</td>
        </tr>
        <!-- More subsections and rows... -->
      </tbody>
    </table>

    <!-- If there are interpretation notes or remarks -->
    <div class="section-header">Clinical Interpretation</div>
    <figure class="table">
      <table class="tbl-interpretation">
        <thead>
          <tr><th>Level</th><th>Meaning & Potential Causes</th></tr>
        </thead>
        <tbody>
          <!-- interpretation rows -->
        </tbody>
      </table>
    </figure>

    <!-- Notes section if present -->
    <div class="note">
      <strong>Note:</strong> Any notes or remarks from the report...
    </div>

    <!-- Footer with signature -->
    <div class="report-footer">
      <div class="signatures">
        <p style="font-weight:bold;margin-bottom:4px;">{{signatoryName}}</p>
        <p style="font-size:11px;color:#64748b;">{{signatoryDesignation}}</p>
      </div>
    </div>
  </div>
</div>

4. **SECTION HEADERS ARE CRITICAL**:
   - PRESERVE ALL section/subsection headers exactly as shown in the report
   - Examples: "BLOOD COUNT AND INDICES", "DIFFERENTIAL WBC COUNT", "PLATELET INDICES", "PERIPHERAL SMEAR EXAMINATION", etc.
   - Use <tr class="section-header"><td colspan="5" style="background:#0b4aa2;color:#fff;font-weight:bold;padding:8px 12px;">SECTION NAME</td></tr>
   - Keep the EXACT section names as shown in the image

5. **CLASS NAMES TO USE** (CSS is pre-defined):
   - Container: class="report-container"
   - Header: class="report-header"
   - Body: class="report-body"
   - Section headers: class="section-header"
   - Patient info table: class="patient-info"
   - Results table: class="report-table"
   - Interpretation table: class="tbl-interpretation"
   - Notes: class="note"
   - Footer: class="report-footer"
   - Signatures: class="signatures"

   IMPORTANT: Do NOT include <style> tags. CSS is already applied globally.
   Do NOT include <script> tags, event handlers, or javascript: URLs.

6. CAPTURE ALL CONTENT:
   - Include ALL test parameters shown in the image
   - Include ALL subsection headers (BLOOD COUNT, DIFFERENTIAL WBC, PLATELET INDICES, etc.)
   - Include columns for Expected Values, Absolute values if shown
   - Include peripheral smear remarks, notes, interpretations
   - For text-only rows (like "Normochromic and Normocytic"), use colspan

7. MATCHING ANALYTES:
   - Match test parameter names to the provided analyte list (case-insensitive, fuzzy match OK)
   - Use the provided analyte CODE for placeholders
   - If a test doesn't match any analyte, include it with <!-- UNMATCHED: Test Name -->

8. OUTPUT FORMAT:
   Return ONLY valid JSON:
   {
     "html": "complete HTML template - NO <style> tags",
     "matchedAnalytes": ["code1", "code2"],
     "unmatchedTests": ["Test Name 1"],
     "notes": "conversion notes"
   }

Remember:
- Put TEST GROUP NAME in the <h1> header
- Include ALL section headers and ALL parameters from the image
- Use the exact class names specified
- Do NOT include any <style> tags`;

async function analyzeReportWithClaude(
  imageBase64: string,
  mimeType: string,
  analytes: Analyte[],
  testGroupName: string,
  existingHtml?: string
): Promise<{ html: string; matchedAnalytes: string[]; unmatchedTests: string[]; notes: string }> {
  const startTime = Date.now();
  console.log(`[report-to-template] Starting analysis for test group: ${testGroupName}`);
  console.log(`[report-to-template] Image size: ${Math.round(imageBase64.length / 1024)}KB, MIME: ${mimeType}`);
  console.log(`[report-to-template] Analytes count: ${analytes.length}`);

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error('[report-to-template] ANTHROPIC_API_KEY not configured');
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  // Build analyte context
  const analyteContext = analytes.map(a =>
    `- ${a.name} (Code: ${a.code}, Unit: ${a.unit || 'N/A'}, Reference: ${a.reference_range || 'N/A'})`
  ).join('\n');

  const userMessage = `Analyze this laboratory report image and create an HTML template that EXACTLY replicates its structure.

TEST GROUP NAME: ${testGroupName}
(Use this name in the <h1> header of the template)

AVAILABLE ANALYTES (use these exact codes for placeholders):
${analyteContext}

${existingHtml ? `EXISTING TEMPLATE TO ENHANCE:\n${existingHtml}\n\nModify this template to match the uploaded report's layout while keeping the placeholder structure.` : 'Create a new HTML template from scratch based on this report image.'}

CRITICAL INSTRUCTIONS:
1. Put "${testGroupName}" in the <h1> header at the top
2. Include ALL section/subsection headers exactly as shown (e.g., "BLOOD COUNT AND INDICES", "DIFFERENTIAL WBC COUNT", "PLATELET INDICES", "PERIPHERAL SMEAR EXAMINATION")
3. Include EVERY test parameter visible in the image - do not skip any
4. Preserve the table structure with all columns (Parameter, Results, Unit, Reference, Flag/Expected values, Absolute values if present)
5. Include any text descriptions, remarks, or peripheral smear findings
6. Use the exact analyte codes provided above for {{ANALYTE_[code]_VALUE}} etc.
7. For tests not in the analyte list, still include them with <!-- UNMATCHED: TestName --> comment
8. Include signature section at the bottom with {{signatoryName}} and {{signatoryDesignation}}`;

  // Determine media type for Claude API
  let mediaType = mimeType;
  if (mimeType === 'application/pdf') {
    mediaType = 'image/png'; // PDF should be converted to image before sending
  }

  // Use Haiku for faster response (vision processing can be slow)
  // Haiku is fast and capable enough for layout analysis and HTML generation
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55000); // 55s timeout (function has 60s)

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 8192,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: imageBase64,
                },
              },
              {
                type: 'text',
                text: userMessage,
              },
            ],
          },
        ],
        system: SYSTEM_PROMPT,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const apiDuration = Date.now() - startTime;
    console.log(`[report-to-template] Claude API responded in ${apiDuration}ms`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[report-to-template] Claude API error (${response.status}):`, errorText);
      throw new Error(`Claude API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log(`[report-to-template] Response received, processing...`);

    // Extract text content from Claude's response
    const textContent = result.content?.find((c: any) => c.type === 'text')?.text;

    if (!textContent) {
      throw new Error('No text content in Claude response');
    }

    // Parse JSON from response (Claude might include markdown code blocks)
    let jsonStr = textContent;

    // Try to extract JSON from markdown code block
    const jsonMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    // Try to find JSON object in the response
    const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      jsonStr = objectMatch[0];
    }

    try {
      const parsed = JSON.parse(jsonStr);
      const totalDuration = Date.now() - startTime;
      console.log(`[report-to-template] Success! Matched ${parsed.matchedAnalytes?.length || 0} analytes in ${totalDuration}ms`);
      return {
        html: parsed.html || '',
        matchedAnalytes: parsed.matchedAnalytes || [],
        unmatchedTests: parsed.unmatchedTests || [],
        notes: parsed.notes || '',
      };
    } catch (parseError) {
      console.error('[report-to-template] Failed to parse Claude response as JSON:', parseError);
      console.log('[report-to-template] Raw response (first 500 chars):', textContent?.slice(0, 500));
      // If parsing fails, return the raw text as HTML
      return {
        html: textContent,
        matchedAnalytes: [],
        unmatchedTests: [],
        notes: 'Response was not in expected JSON format, returning raw output',
      };
    }
  } catch (fetchError: any) {
    clearTimeout(timeoutId);
    const errorDuration = Date.now() - startTime;
    console.error(`[report-to-template] Fetch error after ${errorDuration}ms:`, fetchError.message);
    if (fetchError.name === 'AbortError') {
      throw new Error('Request timed out. Please try with a smaller image or try again.');
    }
    throw fetchError;
  }
}

export async function handler(event: any) {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: 'ok',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const payload: RequestPayload = JSON.parse(event.body || '{}');

    // Validate required fields
    if (!payload.imageBase64) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'imageBase64 is required' }),
      };
    }

    if (!payload.analytes || !Array.isArray(payload.analytes) || payload.analytes.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'analytes array is required and must not be empty' }),
      };
    }

    if (!payload.testGroupName) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'testGroupName is required' }),
      };
    }

    // Analyze the report with Claude
    const result = await analyzeReportWithClaude(
      payload.imageBase64,
      payload.mimeType || 'image/png',
      payload.analytes,
      payload.testGroupName,
      payload.existingHtml
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        ...result,
      }),
    };
  } catch (error: any) {
    console.error('Report to template error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: error.message || 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      }),
    };
  }
}
