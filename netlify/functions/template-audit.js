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
  // Loop markers
  '#results', '/results',
  // Inside results loop
  'analyteName', 'value', 'unit', 'referenceRange', 'flag', 'flagClass'
];

const AUDIT_PROMPT = `You are an auditing assistant for laboratory report HTML templates. Your job is to evaluate if the template satisfies the required layout contract and if placeholders match the provided data context.

You receive:
- templateName: human readable name of the template.
- labId: identifier of the lab using the template (for context only).
- html: full HTML string currently used in GrapesJS.
- css: stylesheet string applied to the template.
- placeholders: array of placeholder tokens exactly as found in the html (double curly braces syntax).
- requiredPlaceholders: mapping of semantic slots -> expected placeholder tokens (they may or may not exist yet).
- testGroup: optional object with test group name and analyte array (each analyte has name, unit, reference_range, flag support, etc.).
- availablePlaceholders: array of placeholder descriptors that authors can insert (each includes placeholder token, label, group, unit, referenceRange).

IMPORTANT: Only audit placeholders from these groups: "patient", "test", "signature", "section". 
DO NOT audit placeholders from these groups: "header", "footer", "lab", "branding". These are optional styling elements and should be ignored during validation.
DO NOT check for structural elements like header images, footer images, or signature blocks. These are optional design elements.

═══════════════════════════════════════════════════════════════════════════════
CRITICAL: VALID PLACEHOLDER VALIDATION
═══════════════════════════════════════════════════════════════════════════════

VALID STATIC PLACEHOLDERS (these are the ONLY allowed placeholders):
- Patient: {{patientName}}, {{patientAge}}, {{patientGender}}, {{patientId}}, {{patientPhone}}, {{patientEmail}}, {{patientAddress}}
- Sample: {{sampleId}}, {{orderId}}, {{collectionDate}}, {{reportDate}}, {{registrationDate}}, {{sampleCollectedAt}}, {{approvedAt}}, {{sampleType}}
- Lab: {{labName}}, {{labAddress}}, {{labPhone}}, {{labEmail}}, {{headerImageUrl}}, {{footerImageUrl}}
- Doctor: {{referringDoctorName}}
- Location: {{locationName}}
- Signatory: {{signatoryName}}, {{signatoryDesignation}}, {{signatoryImageUrl}}

VALID ANALYTE PLACEHOLDER PATTERN:
ANALYTE_[Code]_VALUE         - Result value for the analyte
ANALYTE_[Code]_UNIT          - Unit of measurement
ANALYTE_[Code]_REFERENCE     - Reference range
ANALYTE_[Code]_FLAG          - Abnormality flag (H/L/empty)
ANALYTE_[Code]_METHOD        - Test method/remarks

Examples: {{ANALYTE_Hemoglobin_VALUE}}, {{ANALYTE_RBC_UNIT}}, {{ANALYTE_WBC_REFERENCE}}

INVALID PLACEHOLDER PATTERNS (MUST FLAG AS ERRORS):
❌ {{Hemoglobin}}, {{RBC}}, {{WBC}} - Missing field suffix (_VALUE, _UNIT, etc.)
❌ {{Hemoglobin_value}}, {{RBC_unit}} - Use uppercase: ANALYTE_Hemoglobin_VALUE, ANALYTE_RBC_UNIT
❌ {{patient_name}}, {{lab_name}} - snake_case NOT valid (use camelCase)
❌ Loop markers {{#results}}/{{/results}} - NOT supported in PDF rendering

When you find malformed analyte placeholders:
1. Flag them as "invalidAnalytePlaceholders"
2. Recommend using proper format: ANALYTE_[Code]_VALUE, ANALYTE_[Code]_UNIT, etc.
3. If critical, set status to "fail"

═══════════════════════════════════════════════════════════════════════════════

Your evaluation must:
1. **Patient Metadata**: Confirm the patient metadata table exists and includes key patient information (patientName, patientAge, patientGender, patientId, registrationDate, locationName, sampleCollectedAt, approvedAt, referringDoctorName, orderId).

2. **Required Placeholders**: Validate that placeholders listed in requiredPlaceholders are present in the HTML. If they are absent suggest which placeholder to add. ONLY CHECK PLACEHOLDERS WITH group="patient", "test", "signature", or "section".

3. **CRITICAL - Analyte Placeholders**: Check that analyte placeholders use the correct format: ANALYTE_[Code]_VALUE, ANALYTE_[Code]_UNIT, ANALYTE_[Code]_REFERENCE, ANALYTE_[Code]_FLAG. Flag any malformed analyte placeholders like {{Hemoglobin}}, {{RBC_value}}, {{WBC_unit}}.

4. **CRITICAL - Analyte Coverage**: If a testGroup is provided with analytes, verify that EVERY analyte from the test group has placeholders in the template. For each analyte, use its 'code' field from the database (e.g., 'WBC', 'HB', 'RBC'). Check for: ANALYTE_[CODE]_VALUE (required), ANALYTE_[CODE]_UNIT, ANALYTE_[CODE]_REFERENCE, ANALYTE_[CODE]_FLAG. List ALL missing analytes with their exact codes and required placeholders.

5. **Test Results Table**: Verify the template has a results table (class="tbl-results") with individual rows for each analyte using the ANALYTE_[Code]_[Field] placeholders.

6. **Section Content Validation**: Check for section content placeholders (group="section") like {{impression}}, {{findings}}, {{conclusion}}, {{recommendation}}. These are doctor-filled content areas.

7. **Approval/Signature Validation**: Verify that approval/signature placeholders are present (group="signature").

8. **Malformed Placeholders**: Highlight any other missing or malformed placeholders (e.g., malformed braces, duplicates, inconsistent casing) ONLY for "patient", "test", "signature", and "section" groups.

**IMPORTANT**: All placeholder strings in arrays MUST include the {{}} wrapper. For example:
- foundSectionPlaceholders: ["{{impression}}", "{{findings}}"]  NOT ["impression", "findings"]
- invalidAnalytePlaceholders: ["{{Hemoglobin}}"]  NOT ["Hemoglobin"]
- recommendedSectionPlaceholders: ["{{impression}}"]  NOT ["impression"]

Return JSON strictly in this shape (no prose, no markdown):
{
  "status": "pass" | "attention" | "fail",
  "summary": "Concise human readable summary",
  "patientMetadata": {
    "tablePresent": boolean,
    "missingColumns": string[]
  },
  "placeholders": {
    "requiredMissing": string[],
    "unknownPlaceholders": string[],
    "invalidAnalytePlaceholders": string[],
    "duplicates": string[],
    "deprecatedPlaceholders": string[]
  },
  "resultsLoop": {
    "hasResultsLoop": boolean,
    "hasAnalyteName": boolean,
    "hasValue": boolean,
    "hasUnit": boolean,
    "hasReferenceRange": boolean,
    "hasFlag": boolean,
    "missingLoopPlaceholders": string[]
  },
  "analyteCoverage": {
    "totalAnalytesInTestGroup": number,
    "analytesFoundInTemplate": number,
    "missingAnalytes": string[],
    "missingAnalytePlaceholders": string[],
    "invalidIndividualPlaceholders": string[],
    "recommendation": string
  },
  "sectionContent": {
    "hasAnySectionPlaceholder": boolean,
    "foundSectionPlaceholders": string[],
    "deprecatedSectionPlaceholders": string[],
    "recommendedSectionPlaceholders": string[]
  },
  "approvalSignature": {
    "hasSignatoryName": boolean,
    "hasSignatoryDesignation": boolean,
    "hasSignatoryImage": boolean,
    "missingSignaturePlaceholders": string[]
  },
  "recommendations": string[]
}

Rules:
- "pass" only when ALL of these conditions are met:
  * All required patient placeholders exist and patient metadata table is present
  * Template uses individual ANALYTE_[Code]_[Field] placeholders with proper format
  * ALL analytes from the test group have at least ANALYTE_[Code]_VALUE in the template
  * At least one signature placeholder exists
  
- "attention" when minor issues exist that can be fixed quickly:
  * Missing optional placeholders
  * Some analyte field placeholders missing (e.g., _FLAG not present for an analyte)
  * Deprecated placeholders present
  
- "fail" when critical issues exist:
  * Malformed analyte placeholders ({{Hemoglobin}}, {{RBC_value}} instead of ANALYTE_RBC_VALUE)
  * Missing analytes from test group (not all analytes have placeholders)
  * Required patient placeholders missing
  * Patient metadata table is absent
  
- NEVER flag missing header/footer/lab/branding placeholders as errors. These are optional styling elements.
- **ALWAYS** flag malformed analyte placeholders:
  * {{Hemoglobin}}, {{RBC}}, {{WBC}} → "Use {{ANALYTE_HB_VALUE}}, {{ANALYTE_RBC_VALUE}}, {{ANALYTE_WBC_VALUE}} (with analyte code from database)"
  * {{ANALYTE_WhiteBloodCellCount_VALUE}} → "Use analyte code: {{ANALYTE_WBC_VALUE}}"
  * {{Hemoglobin_value}}, {{RBC_unit}} → "Use uppercase with code: {{ANALYTE_HB_VALUE}}, {{ANALYTE_RBC_UNIT}}"
- **ALWAYS** check that EVERY analyte from testGroup has corresponding placeholders in the template
- **ALWAYS** list ALL missing analytes clearly in the response
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
