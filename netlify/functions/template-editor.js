// ==================== OLD PROMPT (ROLLBACK) ====================
// To rollback: Replace PROMPT_INTRO with PROMPT_INTRO_OLD
const PROMPT_INTRO_OLD = `You are an expert HTML template assistant for laboratory reports.
You receive:
- currentHtml: the existing GrapesJS HTML template (no scripts allowed).
- currentCss: optional CSS string for the template.
- instructions: user instructions describing desired modifications.
Return JSON with { html: string, css?: string, summary?: string, warnings?: string[] }.

CRITICAL SECURITY RULES (MUST FOLLOW):
- NEVER include <script> tags in the HTML
- NEVER include inline event handlers (onload, onerror, onclick, etc.)
- NEVER include javascript: URLs
- NEVER include <iframe> tags
- ONLY return pure HTML markup with CSS styling

Global layout contract (always enforce, even if the user does not mention it):
1. Immediately after the header logo/banner include a two-column table covering Patient Name, Patient Age, Registration Date, Location/Collection Centre, Sample Collected At, Approved/Verified At, and Referring Doctor. Use existing placeholders when present (e.g. {{patientName}}, {{patientAge}}, {{registrationDate}}, {{locationName}}, {{sampleCollectedAt}}, {{approvedAt}}, {{referringDoctorName}}) and otherwise introduce clearly named placeholders in the same {{snakeCase}} pattern.
2. Preserve or add a header image/logo container at the very top (use a <div> or <figure> with a placeholder <img> whose src is something like {{headerImageUrl}}).
3. Ensure a printable friendly footer image container exists before closing the document, plus a signature block with an <img> placeholder such as {{signatoryImageUrl}} and text placeholders for name/title.
4. Keep placeholders and blocks accessible (semantic headings, table headers, no inline event handlers).
Constraints:
1. Modify only what the user asks for in addition to enforcing the contract above while keeping existing double-curly placeholders exactly intact.
2. Avoid <script>, inline event handlers, javascript: URLs, or remote assets.
3. Keep layout printable and accessible.
If the request is unclear, respond with a summary asking for clarification and leave html empty.

IMPORTANT: Your response must be valid JSON. Do NOT include any <script> tags or JavaScript code in the html field.`;

// ==================== NEW PROMPT (CSS-FREE HTML) ====================
const PROMPT_INTRO = `You are an expert HTML template assistant for laboratory reports.

You receive:
- currentHtml: the existing HTML template (can be empty for new templates).
- currentCss: ignore this - we do NOT use CSS in output anymore.
- instructions: user instructions describing desired modifications OR new template request.

MODES:
1. MODIFY MODE: If currentHtml has content, modify it according to instructions.
2. CREATE MODE: If currentHtml is empty or minimal, create a new template from scratch based on instructions.

Return JSON with { html: string, css: "", summary?: string, warnings?: string[] }.

CRITICAL: CSS-FREE OUTPUT RULES
- NEVER include <style> tags or blocks
- NEVER include inline CSS (style="...")
- NEVER include inline colors, fonts, backgrounds, or theme styles
- Use ONLY structural HTML attributes: width, colspan, rowspan, align, valign
- Use semantic class names for styling hooks (CSS is added by lab in editor)
- Return css field as empty string: css: ""

CRITICAL SECURITY RULES (MUST FOLLOW):
- NEVER include <script> tags in the HTML
- NEVER include inline event handlers (onload, onerror, onclick, etc.)
- NEVER include javascript: URLs
- NEVER include <iframe> tags
- ONLY return pure HTML markup

REQUIRED CLASS NAMES (use these for styling hooks):
- .report-header - Header section with logo
- .lab-info - Lab name and address container
- .patient-meta - Patient information table
- .tbl-meta - Metadata table (patient/order info)
- .tbl-results - Results table
- .section-header - Section header rows in tables
- .tbl-interpretation - Interpretation section
- .report-footer - Footer section
- .signature-block - Signature area
- .flag-high, .flag-low, .flag-normal - Result flag indicators

═══════════════════════════════════════════════════════════════════════════════
CRITICAL: PLACEHOLDER NAMING - USE ONLY THESE EXACT NAMES
═══════════════════════════════════════════════════════════════════════════════

STATIC PLACEHOLDERS (copy exactly, case-sensitive):
───────────────────────────────────────────────────
Patient Info:
  {{patientName}}        {{patientAge}}         {{patientGender}}
  {{patientPhone}}       {{patientEmail}}       {{patientAddress}}
  {{patientId}}

Sample/Order Info:
  {{sampleId}}           {{collectionDate}}     {{reportDate}}
  {{registrationDate}}   {{sampleCollectedAt}}  {{approvedAt}}
  {{sampleType}}         {{orderId}}

Lab Info:
  {{labName}}            {{labAddress}}         {{labPhone}}
  {{labEmail}}           {{headerImageUrl}}     {{footerImageUrl}}

Doctor Info:
  {{referringDoctorName}}

Location Info:
  {{locationName}}

Signatory/Approver Info (use one or both sets):
  {{signatoryImageUrl}}  {{signatoryName}}      {{signatoryDesignation}}
  {{approverSignature}}  {{approverName}}       {{approverRole}}
  {{approvedByName}}     {{approvedAt}}

═══════════════════════════════════════════════════════════════════════════════
RESULTS TABLE - INDIVIDUAL ANALYTE PLACEHOLDERS
═══════════════════════════════════════════════════════════════════════════════

For test results, use INDIVIDUAL ANALYTE PLACEHOLDERS with this naming pattern:

ANALYTE_[AnalyteCode]_VALUE         - Result value
ANALYTE_[AnalyteCode]_UNIT          - Unit of measurement  
ANALYTE_[AnalyteCode]_REFERENCE     - Reference range
ANALYTE_[AnalyteCode]_FLAG          - Abnormality flag (H/L/empty)
ANALYTE_[AnalyteCode]_METHOD        - Test method/remarks

**CRITICAL**: Use the exact 'code' field from the 'analytes' database table.
If analyte code is 'WBC', use {{ANALYTE_WBC_VALUE}}.
If analyte code is 'HB', use {{ANALYTE_HB_VALUE}}.
If analyte code is 'Hemoglobin', use {{ANALYTE_Hemoglobin_VALUE}}.

Example for CBC (Complete Blood Count):

<table class="tbl-results" width="100%">
  <thead>
    <tr>
      <th>Parameter</th>
      <th>Result</th>
      <th>Unit</th>
      <th>Reference Range</th>
      <th>Flag</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Hemoglobin</td>
      <td>{{ANALYTE_Hemoglobin_VALUE}}</td>
      <td>{{ANALYTE_Hemoglobin_UNIT}}</td>
      <td>{{ANALYTE_Hemoglobin_REFERENCE}}</td>
      <td>{{ANALYTE_Hemoglobin_FLAG}}</td>
    </tr>
    <tr>
      <td>RBC Count</td>
      <td>{{ANALYTE_RBC_VALUE}}</td>
      <td>{{ANALYTE_RBC_UNIT}}</td>
      <td>{{ANALYTE_RBC_REFERENCE}}</td>
      <td>{{ANALYTE_RBC_FLAG}}</td>
    </tr>
    <tr>
      <td>WBC Count</td>
      <td>{{ANALYTE_WBC_VALUE}}</td>
      <td>{{ANALYTE_WBC_UNIT}}</td>
      <td>{{ANALYTE_WBC_REFERENCE}}</td>
      <td>{{ANALYTE_WBC_FLAG}}</td>
    </tr>
  </tbody>
</table>

═══════════════════════════════════════════════════════════════════════════════
FORBIDDEN PATTERNS
═══════════════════════════════════════════════════════════════════════════════

❌ {{Hemoglobin}}            - WRONG! Use {{ANALYTE_Hemoglobin_VALUE}} or {{ANALYTE_HB_VALUE}} (based on analyte code)
❌ {{Hemoglobin_value}}      - WRONG! Use {{ANALYTE_Hemoglobin_VALUE}} or {{ANALYTE_HB_VALUE}}
❌ {{ANALYTE_WhiteBloodCellCount_VALUE}} - WRONG! Use analyte code: {{ANALYTE_WBC_VALUE}}
❌ {{patient_name}}          - WRONG! Use {{patientName}} (camelCase)
❌ {{lab_name}}              - WRONG! Use {{labName}} (camelCase)
❌ Loop markers {{#results}}/{{/results}} - NOT supported in PDF rendering

Note: Analyte codes must match the exact 'code' field from the lab's analytes table.
Use the Placeholder Search feature to find available analyte placeholders.

═══════════════════════════════════════════════════════════════════════════════

Global layout contract (always enforce):
1. Header section with class="report-header" containing logo: <img src="{{headerImageUrl}}" alt="Lab Logo">
2. Two-column metadata table with class="tbl-meta" for patient/order info
3. Results table with class="tbl-results" using individual ANALYTE_[Code]_[Field] placeholders
4. Footer section with class="report-footer" and signature block with class="signature-block"
5. Tables must have width="100%" attribute for PDF rendering

Constraints:
1. In MODIFY mode: PRESERVE ALL EXISTING PLACEHOLDERS - only change what user asks for
2. NEVER remove placeholders that are already present unless explicitly asked
3. In CREATE mode: generate complete template following the layout contract
4. Use individual analyte placeholders: ANALYTE_[Code]_VALUE, ANALYTE_[Code]_UNIT, etc.
5. Add one <tr> row per analyte with hardcoded analyte name and placeholders
6. Avoid <script>, inline event handlers, javascript: URLs
7. Keep layout printable and accessible

CRITICAL: When fixing issues, ADD what's missing, don't REMOVE what's present.

If the request is unclear, respond with a summary asking for clarification and leave html empty.

IMPORTANT: Your response must be valid JSON. The css field must be an empty string "".`;

const GEMINI_MODEL = 'gemini-2.0-flash';

const FORBIDDEN_PATTERNS = [
  /<script/i,
  /javascript:/i,
  /onload\s*=/i,
  /onerror\s*=/i,
  /<iframe/i,
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function sanitizeResponse(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return { warnings: ['AI response was empty or invalid.'] };
  }

  const sanitized = { ...candidate };

  if (sanitized.html) {
    // Check each forbidden pattern individually for better debugging
    const foundPatterns = [];
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(sanitized.html)) {
        foundPatterns.push(pattern.toString());
      }
    }

    if (foundPatterns.length > 0) {
      console.warn('Found forbidden patterns in HTML:', foundPatterns);
      console.warn('HTML preview (first 500 chars):', sanitized.html.substring(0, 500));
      
      sanitized.warnings = [
        ...(Array.isArray(sanitized.warnings) ? sanitized.warnings : []),
        `AI response contained potentially unsafe markup (${foundPatterns.join(', ')}) and was removed.`,
      ];
      sanitized.html = undefined;
    }
  }

  return sanitized;
}

function extractCandidatePayload(rawResponse) {
  if (!rawResponse || typeof rawResponse !== 'object') {
    return null;
  }
  // Try common candidate shapes from different Gemini / GL API versions
  const candidates = Array.isArray(rawResponse.candidates) ? rawResponse.candidates : [];
  for (const candidate of candidates) {
    // Newer responses may include content.parts (array)
    const parts = candidate?.content?.parts || candidate?.content || candidate?.output?.content;
    if (Array.isArray(parts) && parts.length) {
      const textPayload = parts
        .map((part) => {
          if (!part) return '';
          if (typeof part === 'string') return part;
          if (typeof part.text === 'string') return part.text;
          if (typeof part.content === 'string') return part.content;
          return '';
        })
        .join('\n')
        .trim();

      if (textPayload) {
        try {
          return JSON.parse(textPayload);
        } catch (err) {
          // Not JSON — try to return an object with text in case the model returned a plain object
          try {
            // sometimes the model returns a JSON-like string with surrounding text; try to extract JSON
            const jsonMatch = textPayload.match(/({[\s\S]*})/);
            if (jsonMatch) {
              return JSON.parse(jsonMatch[1]);
            }
          } catch (innerErr) {
            /* fall through */
          }
          console.warn('Failed to parse candidate text as JSON, skipping candidate:', err);
        }
      }
    }

    // Some candidates may expose a direct text field
    if (typeof candidate.text === 'string' && candidate.text.trim()) {
      try {
        return JSON.parse(candidate.text.trim());
      } catch (err) {
        console.warn('Failed to parse candidate.text as JSON, skipping:', err);
      }
    }
  }

  // Some Gemini responses may already be in the expected shape.
  if (rawResponse && (rawResponse.html || rawResponse.summary || rawResponse.css)) {
    return rawResponse;
  }

  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: 'ok',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const apiKey = process.env.ALLGOOGLE_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Gemini API key not configured' }),
      };
    }

    const payload = JSON.parse(event.body || '{}');
    const prompt = payload.prompt || payload.instruction || '';
    const html = payload.html || payload.currentHtml || '';
    const css = payload.css || payload.currentCss || '';
    const templateName = payload.templateName || 'Template';
    const labId = payload.labId || payload.labContext || 'lab';
    const history = Array.isArray(payload.history) ? payload.history : [];

    if (!prompt) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Prompt/instruction is required.' }),
      };
    }

    // Allow creating new templates from scratch (empty HTML is OK)
    const isNewTemplate = !html || html.trim() === '';

    const promptParts = [
      {
        role: 'user',
        parts: [{ text: PROMPT_INTRO }],
      },
      ...history.map((entry) => ({
        role: entry.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: Array.isArray(entry.content) ? JSON.stringify(entry.content) : String(entry.content ?? '') }],
      })),
      {
        role: 'user',
        parts: [
          {
            text: JSON.stringify(
              {
                instructions: prompt,
                templateName,
                labId,
                currentHtml: html,
                currentCss: css,
              },
              null,
              2,
            ),
          },
        ],
      },
    ];

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: promptParts,
          generationConfig: {
            temperature: 0.35,
            topP: 0.9,
            maxOutputTokens: 4096,
            responseMimeType: 'application/json',
          },
        }),
      },
    );

    const responseText = await geminiResponse.text();

    if (!geminiResponse.ok) {
      return {
        statusCode: geminiResponse.status,
        headers: CORS_HEADERS,
        body: responseText || JSON.stringify({ error: 'Gemini API error' }),
      };
    }

    let parsed;
    try {
      parsed = responseText ? JSON.parse(responseText) : {};
    } catch (parseErr) {
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: `Failed to parse Gemini response: ${(parseErr && parseErr.message) || 'Unknown error'}` }),
      };
    }

  let candidatePayload = extractCandidatePayload(parsed);
    if (!candidatePayload) {
      // Fallback: try to extract a JSON object embedded anywhere inside the raw response text
      try {
        const jsonMatch = responseText.match(/({[\s\S]*})/);
        if (jsonMatch) {
          candidatePayload = JSON.parse(jsonMatch[1]);
        }
      } catch (err) {
        console.warn('Fallback JSON extraction failed:', err);
      }
    }

    if (!candidatePayload) {
      console.error('Failed to extract candidate payload. Full response:', responseText.substring(0, 1000));
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Gemini response did not include a usable candidate payload.' }),
      };
    }

    console.log('Extracted candidate payload keys:', Object.keys(candidatePayload));
    console.log('Has HTML:', !!candidatePayload.html);
    console.log('Has CSS:', !!candidatePayload.css);
    console.log('Summary:', candidatePayload.summary);
    
    // Log the full HTML response for debugging
    if (candidatePayload.html) {
      console.log('=== FULL HTML RESPONSE (first 2000 chars) ===');
      console.log(candidatePayload.html.substring(0, 2000));
      console.log('=== END HTML RESPONSE ===');
    }

    const result = sanitizeResponse(candidatePayload);

    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(result),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    console.error('Template editor AI function error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: message }),
    };
  }
};
