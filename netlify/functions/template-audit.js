// ==================== VALID PLACEHOLDERS LIST ====================
const VALID_STATIC_PLACEHOLDERS = [
  // Patient
  'patientName', 'patientAge', 'patientGender', 'patientId', 'patientPhone', 'patientEmail', 'patientAddress',
  // Sample/Order
  'sampleId', 'orderId', 'collectionDate', 'reportDate', 'registrationDate', 'sampleCollectedAt', 'approvedAt', 'sampleType',
  // Lab
  'labName', 'labAddress', 'labPhone', 'labEmail', 'headerImageUrl', 'footerImageUrl',
  // Doctor
  'referringDoctorName',
  // Location
  'locationName',
  // Signatory
  'signatoryName', 'signatoryDesignation', 'signatoryImageUrl',
];

// Required CSS classes for flag/value coloring
const REQUIRED_FLAG_CSS_CLASSES = [
  '.value-high', '.value-low', '.value-normal',
  '.flag-high', '.flag-low', '.flag-normal',
  '.value-critical_h', '.value-critical_l',
  '.flag-critical_h', '.flag-critical_l',
  '.value-abnormal', '.flag-abnormal'
];

const AUDIT_PROMPT = `You are a template validator for laboratory report HTML templates. Focus ONLY on technical validation - placeholder format, CSS, and HTML structure.

You receive:
- templateName: name of the template
- html: full HTML string
- css: stylesheet string
- placeholders: array of placeholder tokens found in html

═══════════════════════════════════════════════════════════════════════════════
TASK 1: PLACEHOLDER FORMAT VALIDATION (CRITICAL)
═══════════════════════════════════════════════════════════════════════════════

VALID FORMATS:
✅ Static placeholders (camelCase): {{patientName}}, {{sampleId}}, {{reportDate}}, {{signatoryName}}
✅ Analyte placeholders (UPPER_SNAKE_CASE): 
   - {{ANALYTE_WHITE_BLOOD_CELL_COUNT_VALUE}}
   - {{ANALYTE_HEMOGLOBIN_VALUE}}, {{ANALYTE_HEMOGLOBIN_UNIT}}, {{ANALYTE_HEMOGLOBIN_REFERENCE}}, {{ANALYTE_HEMOGLOBIN_FLAG}}
   - {{ANALYTE_RBC_VALUE}}, {{ANALYTE_WBC_VALUE}}, {{ANALYTE_PLT_VALUE}}

INVALID FORMATS (MUST FLAG AS ERRORS):
❌ {{Hemoglobin}} - Missing ANALYTE_ prefix and _VALUE suffix
❌ {{RBC}}, {{WBC}}, {{PLT}} - Missing ANALYTE_ prefix and field suffix
❌ {{Hemoglobin_value}} - Wrong format, use {{ANALYTE_HEMOGLOBIN_VALUE}}
❌ {{patient_name}} - snake_case not valid, use {{patientName}}
❌ {{#results}}/{{/results}} - Loop syntax NOT supported

For each invalid placeholder, provide the CORRECT format.

═══════════════════════════════════════════════════════════════════════════════
TASK 2: CSS VALIDATION
═══════════════════════════════════════════════════════════════════════════════

CHECK if CSS includes these required flag/value coloring classes:
- .value-high, .value-low, .value-normal (for result value coloring)
- .flag-high, .flag-low, .flag-normal (for flag text coloring)
- .value-critical_h, .value-critical_l (for critical values)
- .flag-critical_h, .flag-critical_l (for critical flags)
- .value-abnormal, .flag-abnormal (for abnormal values)

If missing, recommend adding them with appropriate colors (red for high/critical, amber/orange for low, green for normal).

Also check for:
- Print version QR spacing: CSS should have spacing for QR code in print version
- Recommended: .patient-info { margin-right: 100px; } or similar to avoid QR overlap

═══════════════════════════════════════════════════════════════════════════════
TASK 3: HTML STRUCTURE VALIDATION (CRITICAL FOR QR POSITIONING)
═══════════════════════════════════════════════════════════════════════════════

CHECK for REQUIRED HTML structure for proper PDF/QR positioning:

1. **CRITICAL - Report Header Structure** (for proper QR positioning in print version):
   Template MUST have this structure:
   \`\`\`html
   <div class="report-container">
     <div class="report-header">
       <h1>Test Name Here</h1>
       <div class="report-subtitle">Laboratory Test Report</div>
     </div>
     <div class="report-body">
       <!-- content -->
     </div>
   </div>
   \`\`\`
   
   If missing report-header with h1, QR code will overlap patient table in print version!

2. **Patient Info Section**: Must have class="patient-info" or "patient-meta"

3. **Results Table**: Must have class="tbl-results" or "report-table"

4. **Signature Section**: Must have class="signatures" or "report-footer"

5. **Tables Wrapped**: Tables should be wrapped in <figure class="table"> or <div>

═══════════════════════════════════════════════════════════════════════════════

Return JSON strictly in this shape:
{
  "status": "pass" | "attention" | "fail",
  "summary": "Concise summary of validation results",
  "placeholderValidation": {
    "totalPlaceholders": number,
    "validPlaceholders": string[],
    "invalidPlaceholders": [
      { "found": "{{Hemoglobin}}", "correctedFormat": "{{ANALYTE_HEMOGLOBIN_VALUE}}", "issue": "Missing prefix and suffix" }
    ],
    "unknownPlaceholders": string[]
  },
  "cssValidation": {
    "hasFlagColoring": boolean,
    "missingFlagClasses": string[],
    "hasQRSpacing": boolean,
    "recommendations": string[]
  },
  "htmlStructure": {
    "hasReportContainer": boolean,
    "hasReportHeader": boolean,
    "hasHeaderTitle": boolean,
    "hasReportBody": boolean,
    "hasPatientInfo": boolean,
    "hasResultsTable": boolean,
    "hasSignatureSection": boolean,
    "structureIssues": string[]
  },
  "recommendations": string[]
}

Rules:
- "pass": All placeholders valid format, proper header structure, HTML properly structured
- "attention": Minor CSS issues or optional improvements needed
- "fail": 
  * Invalid placeholder formats found (will cause empty values in PDF)
  * Missing report-header with h1 (will cause QR overlap in print version)
`;



const GEMINI_MODEL = 'gemini-2.0-flash';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
    const {
      templateName = 'Template',
      labId = 'lab',
      html = '',
      css = '',
      placeholders = [],
      requiredPlaceholders = {},
      testGroup = null,
      availablePlaceholders = [],
    } = payload;

    if (!html) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'HTML is required for auditing.' }),
      };
    }

    const placeholderSet = Array.isArray(placeholders) ? Array.from(new Set(placeholders)) : [];
    const availablePlaceholderList = Array.isArray(availablePlaceholders)
      ? Array.from(
        new Map(
          availablePlaceholders
            .filter((item) => item && typeof item.placeholder === 'string')
            .map((item) => [
              item.placeholder,
              {
                placeholder: item.placeholder,
                label: item.label || '',
                group: item.group || 'lab',
                unit: item.unit ?? null,
                referenceRange: item.referenceRange ?? null,
              },
            ])
        ).values()
      )
      : [];

    const prompt = {
      templateName,
      labId,
      html,
      css,
      placeholders: placeholderSet,
      availablePlaceholders: availablePlaceholderList,
      requiredPlaceholders,
      testGroup,
    };

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: AUDIT_PROMPT,
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              text: JSON.stringify(prompt, null, 2),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        topP: 0.8,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    },
    );

const text = await response.text();
if (!response.ok) {
  console.error('Gemini API error:', response.status, text);
  return {
    statusCode: response.status,
    headers: CORS_HEADERS,
    body: text || JSON.stringify({ error: 'Gemini API error' }),
  };
}

console.log('Raw Gemini response length:', text.length);
console.log('Raw Gemini response (first 500 chars):', text.substring(0, 500));

let json;
try {
  json = text ? JSON.parse(text) : {};
} catch (parseErr) {
  console.error('Failed to parse Gemini outer response:', parseErr);
  console.error('Full text (first 1000 chars):', text.substring(0, 1000));
  return {
    statusCode: 502,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: `Failed to parse Gemini response: ${(parseErr && parseErr.message) || 'Unknown error'}`, preview: text.substring(0, 500) }),
  };
}

const candidate = Array.isArray(json.candidates) && json.candidates.length
  ? json.candidates[0]
  : json;

let responseText = candidate?.content?.parts
  ? candidate.content.parts.map((part) => part.text || '').join('\n').trim()
  : candidate?.text || '';

if (!responseText) {
  return {
    statusCode: 502,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: 'Gemini response did not include a usable payload.' }),
  };
}

// Robust JSON extraction: handle ```json fences and embedded JSON
// Sanitize common noise (markdown fences, Netlify log prefixes inside model text)
const stripCodeFences = (t) => t.replace(/```json/gi, '').replace(/```/g, '');
const stripNetlifyLogPrefixes = (t) =>
  t.replace(/Dec\s+\d{1,2},\s+\d{2}:\d{2}:\d{2}\s+(?:AM|PM):\s+[A-Za-z0-9]+\s+(?:WARN|INFO|ERROR)\s*/g, '');
const normalizeWhitespace = (t) => t.replace(/[\r\t]+/g, ' ').replace(/\s+\n/g, '\n').trim();

responseText = normalizeWhitespace(stripNetlifyLogPrefixes(stripCodeFences(responseText)));

let auditResult;
const preview = responseText.substring(0, 300);
try {
  // First try direct parse
  auditResult = JSON.parse(responseText);
} catch (_) {
  try {
    // Try extracting substring between first '{' and last '}'
    const first = responseText.indexOf('{');
    const last = responseText.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      const slice = responseText.substring(first, last + 1);
      auditResult = JSON.parse(slice);
    }
  } catch (_) {
    try {
      // Extract first JSON object from text
      const match = responseText.match(/\{[\s\S]*\}/);
      if (match) {
        auditResult = JSON.parse(match[0]);
      }
    } catch (__) {
      // fallthrough to error below
    }
  }
}

if (!auditResult || typeof auditResult !== 'object') {
  console.error('Audit JSON parse failure.');
  console.error('Response text length:', responseText.length);
  console.error('Full response text:', responseText);
  console.error('Preview:', preview);
  return {
    statusCode: 502,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      error: 'Gemini audit payload was not valid JSON.',
      preview,
      fullLength: responseText.length,
      fullText: responseText.substring(0, 2000)
    }),
  };
}

return {
  statusCode: 200,
  headers: {
    ...CORS_HEADERS,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ audit: auditResult }),
};
  } catch (error) {
  console.error('Template audit error:', error);
  const message = error instanceof Error ? error.message : 'Unexpected error';
  return {
    statusCode: 500,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: message }),
  };
}
};

