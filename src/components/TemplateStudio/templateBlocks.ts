/**
 * Pre-built Template Blocks for Lab Report Templates
 *
 * These blocks use the correct placeholder patterns that match the backend RPC:
 * - Patient placeholders: {{patientName}}, {{patientAge}}, etc.
 * - Analyte placeholders: {{ANALYTE_[CODE]_VALUE}}, {{ANALYTE_[CODE]_UNIT}}, etc.
 * - Section placeholders: {{impression}}, {{findings}}, etc.
 * - Signature placeholders: {{approverName}}, {{approverSignature}}, etc.
 */

export interface TemplateBlock {
  id: string;
  name: string;
  description: string;
  category: 'structure' | 'patient' | 'results' | 'clinical' | 'signature';
  html: string;
  css?: string;
  requiredPlaceholders: string[];
  optionalPlaceholders?: string[];
}

export interface AnalyteInfo {
  label: string;
  code: string;
  defaultUnit?: string;
  defaultReference?: string;
}

// ============================================
// PATIENT INFORMATION BLOCKS
// ============================================

export const PATIENT_INFO_TABLE: TemplateBlock = {
  id: 'patient-info-table',
  name: 'Patient Information Table',
  description: 'Standard patient details table with name, ID, age, gender, sample info',
  category: 'patient',
  html: `
<div class="patient-info-section" style="margin-bottom: 20px;">
  <table class="patient-info-table" style="width: 100%; border-collapse: collapse; font-size: 12px;">
    <tbody>
      <tr>
        <td style="padding: 6px 12px; border: 1px solid #e5e7eb; background: #f9fafb; font-weight: 600; width: 25%;">Patient Name</td>
        <td style="padding: 6px 12px; border: 1px solid #e5e7eb; width: 25%;">{{patientName}}</td>
        <td style="padding: 6px 12px; border: 1px solid #e5e7eb; background: #f9fafb; font-weight: 600; width: 25%;">Patient ID</td>
        <td style="padding: 6px 12px; border: 1px solid #e5e7eb; width: 25%;">{{patientId}}</td>
      </tr>
      <tr>
        <td style="padding: 6px 12px; border: 1px solid #e5e7eb; background: #f9fafb; font-weight: 600;">Age / Gender</td>
        <td style="padding: 6px 12px; border: 1px solid #e5e7eb;">{{patientAge}} / {{patientGender}}</td>
        <td style="padding: 6px 12px; border: 1px solid #e5e7eb; background: #f9fafb; font-weight: 600;">Sample ID</td>
        <td style="padding: 6px 12px; border: 1px solid #e5e7eb;">{{sampleId}}</td>
      </tr>
      <tr>
        <td style="padding: 6px 12px; border: 1px solid #e5e7eb; background: #f9fafb; font-weight: 600;">Ref. Doctor</td>
        <td style="padding: 6px 12px; border: 1px solid #e5e7eb;">{{referringDoctorName}}</td>
        <td style="padding: 6px 12px; border: 1px solid #e5e7eb; background: #f9fafb; font-weight: 600;">Collected On</td>
        <td style="padding: 6px 12px; border: 1px solid #e5e7eb;">{{sampleCollectedAtFormatted}}</td>
      </tr>
    </tbody>
  </table>
</div>
`.trim(),
  requiredPlaceholders: ['patientName', 'patientId', 'patientAge', 'patientGender', 'sampleId'],
  optionalPlaceholders: ['referringDoctorName', 'sampleCollectedAtFormatted'],
};

export const PATIENT_INFO_COMPACT: TemplateBlock = {
  id: 'patient-info-compact',
  name: 'Patient Info (Compact)',
  description: 'Compact single-row patient information',
  category: 'patient',
  html: `
<div class="patient-info-compact" style="margin-bottom: 15px; padding: 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px; font-size: 11px;">
  <span><strong>Patient:</strong> {{patientName}}</span>
  <span style="margin-left: 20px;"><strong>ID:</strong> {{patientId}}</span>
  <span style="margin-left: 20px;"><strong>Age/Gender:</strong> {{patientAge}}/{{patientGender}}</span>
  <span style="margin-left: 20px;"><strong>Sample:</strong> {{sampleId}}</span>
</div>
`.trim(),
  requiredPlaceholders: ['patientName', 'patientId', 'patientAge', 'patientGender', 'sampleId'],
};

// ============================================
// TEST RESULTS BLOCKS
// ============================================

export const RESULTS_TABLE_HEADER: TemplateBlock = {
  id: 'results-table-header',
  name: 'Test Results Table',
  description: 'Results table with header row - add analyte rows inside',
  category: 'results',
  html: `
<div class="results-section" style="margin: 20px 0;">
  <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 10px; color: #1f2937;">Test Results</h3>
  <table id="results-table" class="results-table" style="width: 100%; border-collapse: collapse; font-size: 12px;">
    <thead>
      <tr style="background: #2563eb; color: white;">
        <th style="padding: 10px 12px; text-align: left; font-weight: 600; border: 1px solid #1d4ed8;">Test Parameter</th>
        <th style="padding: 10px 12px; text-align: center; font-weight: 600; border: 1px solid #1d4ed8;">Result</th>
        <th style="padding: 10px 12px; text-align: center; font-weight: 600; border: 1px solid #1d4ed8;">Unit</th>
        <th style="padding: 10px 12px; text-align: center; font-weight: 600; border: 1px solid #1d4ed8;">Reference Range</th>
        <th style="padding: 10px 12px; text-align: center; font-weight: 600; border: 1px solid #1d4ed8;">Flag</th>
      </tr>
    </thead>
    <tbody id="results-tbody">
      <!-- Analyte rows will be inserted here -->
    </tbody>
  </table>
</div>
`.trim(),
  requiredPlaceholders: [],
};

/**
 * Generate an analyte row block for a specific analyte
 */
export function generateAnalyteRowBlock(analyte: AnalyteInfo): TemplateBlock {
  const code = analyte.code.toUpperCase();
  return {
    id: `analyte-row-${code.toLowerCase()}`,
    name: `${analyte.label} Row`,
    description: `Result row for ${analyte.label}`,
    category: 'results',
    html: `
      <tr data-analyte="${code}">
        <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${analyte.label}</td>
        <td style="padding: 8px 12px; border: 1px solid #e5e7eb; text-align: center; font-weight: 500;">{{ANALYTE_${code}_VALUE}}</td>
        <td style="padding: 8px 12px; border: 1px solid #e5e7eb; text-align: center;">{{ANALYTE_${code}_UNIT}}</td>
        <td style="padding: 8px 12px; border: 1px solid #e5e7eb; text-align: center;">{{ANALYTE_${code}_REFERENCE}}</td>
        <td style="padding: 8px 12px; border: 1px solid #e5e7eb; text-align: center;"><span class="{{ANALYTE_${code}_FLAG_CLASS}}">{{ANALYTE_${code}_FLAG}}</span></td>
      </tr>
    `.trim(),
    requiredPlaceholders: [
      `ANALYTE_${code}_VALUE`,
      `ANALYTE_${code}_UNIT`,
      `ANALYTE_${code}_REFERENCE`,
      `ANALYTE_${code}_FLAG`,
    ],
  };
}

/**
 * Generate all analyte rows for a test group
 */
export function generateAllAnalyteRows(analytes: AnalyteInfo[]): string {
  return analytes
    .map((analyte) => generateAnalyteRowBlock(analyte).html)
    .join('\n');
}

// ============================================
// CLINICAL FINDINGS BLOCKS
// ============================================

export const CLINICAL_IMPRESSION: TemplateBlock = {
  id: 'clinical-impression',
  name: 'Clinical Impression',
  description: 'Section for doctor\'s clinical impression/interpretation',
  category: 'clinical',
  html: `
<div class="clinical-section" style="margin: 20px 0; padding: 15px; background: #fefce8; border: 1px solid #fde047; border-radius: 4px;">
  <h3 style="font-size: 13px; font-weight: 600; margin-bottom: 10px; color: #854d0e;">Clinical Interpretation</h3>
  <div class="impression-content" style="font-size: 12px; line-height: 1.6; color: #1f2937;">{{impression}}</div>
</div>
`.trim(),
  requiredPlaceholders: ['impression'],
};

export const CLINICAL_FINDINGS: TemplateBlock = {
  id: 'clinical-findings',
  name: 'Findings Section',
  description: 'Section for detailed findings',
  category: 'clinical',
  html: `
<div class="findings-section" style="margin: 20px 0;">
  <h3 style="font-size: 13px; font-weight: 600; margin-bottom: 10px; color: #1f2937;">Findings</h3>
  <div class="findings-content" style="font-size: 12px; line-height: 1.6; padding: 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px;">{{findings}}</div>
</div>
`.trim(),
  requiredPlaceholders: ['findings'],
};

export const CLINICAL_RECOMMENDATION: TemplateBlock = {
  id: 'clinical-recommendation',
  name: 'Recommendations',
  description: 'Section for doctor\'s recommendations',
  category: 'clinical',
  html: `
<div class="recommendation-section" style="margin: 20px 0;">
  <h3 style="font-size: 13px; font-weight: 600; margin-bottom: 10px; color: #1f2937;">Recommendations</h3>
  <div class="recommendation-content" style="font-size: 12px; line-height: 1.6; padding: 10px; background: #ecfdf5; border: 1px solid #6ee7b7; border-radius: 4px;">{{recommendation}}</div>
</div>
`.trim(),
  requiredPlaceholders: ['recommendation'],
};

export const CLINICAL_HISTORY: TemplateBlock = {
  id: 'clinical-history',
  name: 'Clinical History',
  description: 'Section for patient\'s clinical history',
  category: 'clinical',
  html: `
<div class="history-section" style="margin: 20px 0;">
  <h3 style="font-size: 13px; font-weight: 600; margin-bottom: 10px; color: #1f2937;">Clinical History</h3>
  <div class="history-content" style="font-size: 12px; line-height: 1.6; padding: 10px; background: #f0f9ff; border: 1px solid #7dd3fc; border-radius: 4px;">{{clinical_history}}</div>
</div>
`.trim(),
  requiredPlaceholders: ['clinical_history'],
};

// ============================================
// SIGNATURE BLOCKS
// ============================================

export const SIGNATURE_BLOCK: TemplateBlock = {
  id: 'signature-block',
  name: 'Approval Signature',
  description: 'Signature block with image, name, role, and date',
  category: 'signature',
  html: `
<div class="signature-section" style="margin-top: 30px; text-align: right;">
  <div class="signature-block" style="display: inline-block; text-align: center; min-width: 200px;">
    <img src="{{approverSignature}}" alt="Signature" style="max-height: 60px; max-width: 150px; margin-bottom: 5px;" />
    <div class="signatory-name" style="font-size: 13px; font-weight: 600; color: #1f2937;">{{approverName}}</div>
    <div class="signatory-role" style="font-size: 11px; color: #6b7280;">{{approverRole}}</div>
    <div class="approved-date" style="font-size: 10px; color: #9ca3af; margin-top: 5px;">{{approvedAtFormatted}}</div>
  </div>
</div>
`.trim(),
  requiredPlaceholders: ['approverSignature', 'approverName', 'approverRole', 'approvedAtFormatted'],
};

export const SIGNATURE_SIMPLE: TemplateBlock = {
  id: 'signature-simple',
  name: 'Simple Signature',
  description: 'Simple text-only signature without image',
  category: 'signature',
  html: `
<div class="signature-section" style="margin-top: 30px; text-align: right;">
  <div class="signature-line" style="border-top: 1px solid #1f2937; width: 200px; display: inline-block; padding-top: 10px;">
    <div class="signatory-name" style="font-size: 13px; font-weight: 600; color: #1f2937;">{{approverName}}</div>
    <div class="signatory-role" style="font-size: 11px; color: #6b7280;">{{approverRole}}</div>
  </div>
</div>
`.trim(),
  requiredPlaceholders: ['approverName', 'approverRole'],
};

// ============================================
// STRUCTURE BLOCKS
// ============================================

export const REPORT_HEADER: TemplateBlock = {
  id: 'report-header',
  name: 'Report Header',
  description: 'Header with lab branding placeholder',
  category: 'structure',
  html: `
<div class="report-header" style="margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #2563eb;">
  <div class="lab-branding" style="text-align: center;">
    <img src="{{labLogoUrl}}" alt="Lab Logo" style="max-height: 80px; margin-bottom: 10px;" />
    <h1 style="font-size: 18px; font-weight: 700; color: #1f2937; margin: 0;">{{labName}}</h1>
    <p style="font-size: 11px; color: #6b7280; margin: 5px 0 0 0;">{{labAddress}}</p>
  </div>
</div>
`.trim(),
  requiredPlaceholders: ['labName'],
  optionalPlaceholders: ['labLogoUrl', 'labAddress'],
};

export const REPORT_TITLE: TemplateBlock = {
  id: 'report-title',
  name: 'Report Title',
  description: 'Centered report title with test name',
  category: 'structure',
  html: `
<div class="report-title" style="text-align: center; margin: 20px 0;">
  <h2 style="font-size: 16px; font-weight: 700; color: #1f2937; text-transform: uppercase; letter-spacing: 1px;">Laboratory Test Report</h2>
</div>
`.trim(),
  requiredPlaceholders: [],
};

export const HORIZONTAL_DIVIDER: TemplateBlock = {
  id: 'horizontal-divider',
  name: 'Divider Line',
  description: 'Horizontal line separator',
  category: 'structure',
  html: `<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />`,
  requiredPlaceholders: [],
};

export const REPORT_FOOTER: TemplateBlock = {
  id: 'report-footer',
  name: 'Report Footer',
  description: 'Footer with lab contact info',
  category: 'structure',
  html: `
<div class="report-footer" style="margin-top: 30px; padding-top: 15px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 10px; color: #6b7280;">
  <p style="margin: 0;">{{labName}} | {{labPhone}} | {{labEmail}}</p>
  <p style="margin: 5px 0 0 0;">This is a computer-generated report. Please contact the laboratory for any queries.</p>
</div>
`.trim(),
  requiredPlaceholders: ['labName'],
  optionalPlaceholders: ['labPhone', 'labEmail'],
};

// ============================================
// COMPLETE TEMPLATE STARTER
// ============================================

export const COMPLETE_TEMPLATE_STARTER: TemplateBlock = {
  id: 'complete-starter',
  name: 'Complete Template Starter',
  description: 'Full template with all sections - just add analyte rows',
  category: 'structure',
  html: `
<div class="lab-report" style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">

  <!-- Report Title -->
  <div class="report-title" style="text-align: center; margin-bottom: 20px;">
    <h2 style="font-size: 16px; font-weight: 700; color: #1f2937; text-transform: uppercase; letter-spacing: 1px;">Laboratory Test Report</h2>
  </div>

  <!-- Patient Information -->
  <div class="patient-info-section" style="margin-bottom: 20px;">
    <table class="patient-info-table" style="width: 100%; border-collapse: collapse; font-size: 12px;">
      <tbody>
        <tr>
          <td style="padding: 6px 12px; border: 1px solid #e5e7eb; background: #f9fafb; font-weight: 600; width: 25%;">Patient Name</td>
          <td style="padding: 6px 12px; border: 1px solid #e5e7eb; width: 25%;">{{patientName}}</td>
          <td style="padding: 6px 12px; border: 1px solid #e5e7eb; background: #f9fafb; font-weight: 600; width: 25%;">Patient ID</td>
          <td style="padding: 6px 12px; border: 1px solid #e5e7eb; width: 25%;">{{patientId}}</td>
        </tr>
        <tr>
          <td style="padding: 6px 12px; border: 1px solid #e5e7eb; background: #f9fafb; font-weight: 600;">Age / Gender</td>
          <td style="padding: 6px 12px; border: 1px solid #e5e7eb;">{{patientAge}} / {{patientGender}}</td>
          <td style="padding: 6px 12px; border: 1px solid #e5e7eb; background: #f9fafb; font-weight: 600;">Sample ID</td>
          <td style="padding: 6px 12px; border: 1px solid #e5e7eb;">{{sampleId}}</td>
        </tr>
        <tr>
          <td style="padding: 6px 12px; border: 1px solid #e5e7eb; background: #f9fafb; font-weight: 600;">Ref. Doctor</td>
          <td style="padding: 6px 12px; border: 1px solid #e5e7eb;">{{referringDoctorName}}</td>
          <td style="padding: 6px 12px; border: 1px solid #e5e7eb; background: #f9fafb; font-weight: 600;">Collected On</td>
          <td style="padding: 6px 12px; border: 1px solid #e5e7eb;">{{sampleCollectedAtFormatted}}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Test Results -->
  <div class="results-section" style="margin: 20px 0;">
    <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 10px; color: #1f2937;">Test Results</h3>
    <table id="results-table" class="results-table" style="width: 100%; border-collapse: collapse; font-size: 12px;">
      <thead>
        <tr style="background: #2563eb; color: white;">
          <th style="padding: 10px 12px; text-align: left; font-weight: 600; border: 1px solid #1d4ed8;">Test Parameter</th>
          <th style="padding: 10px 12px; text-align: center; font-weight: 600; border: 1px solid #1d4ed8;">Result</th>
          <th style="padding: 10px 12px; text-align: center; font-weight: 600; border: 1px solid #1d4ed8;">Unit</th>
          <th style="padding: 10px 12px; text-align: center; font-weight: 600; border: 1px solid #1d4ed8;">Reference Range</th>
          <th style="padding: 10px 12px; text-align: center; font-weight: 600; border: 1px solid #1d4ed8;">Flag</th>
        </tr>
      </thead>
      <tbody id="results-tbody">
        <!-- ADD ANALYTE ROWS HERE -->
      </tbody>
    </table>
  </div>

  <!-- Clinical Interpretation (Optional) -->
  <div class="clinical-section" style="margin: 20px 0; padding: 15px; background: #fefce8; border: 1px solid #fde047; border-radius: 4px;">
    <h3 style="font-size: 13px; font-weight: 600; margin-bottom: 10px; color: #854d0e;">Clinical Interpretation</h3>
    <div class="impression-content" style="font-size: 12px; line-height: 1.6; color: #1f2937;">{{impression}}</div>
  </div>

  <!-- Signature -->
  <div class="signature-section" style="margin-top: 30px; text-align: right;">
    <div class="signature-block" style="display: inline-block; text-align: center; min-width: 200px;">
      <img src="{{approverSignature}}" alt="Signature" style="max-height: 60px; max-width: 150px; margin-bottom: 5px;" />
      <div class="signatory-name" style="font-size: 13px; font-weight: 600; color: #1f2937;">{{approverName}}</div>
      <div class="signatory-role" style="font-size: 11px; color: #6b7280;">{{approverRole}}</div>
      <div class="approved-date" style="font-size: 10px; color: #9ca3af; margin-top: 5px;">{{approvedAtFormatted}}</div>
    </div>
  </div>

</div>
`.trim(),
  requiredPlaceholders: [
    'patientName', 'patientId', 'patientAge', 'patientGender', 'sampleId',
    'approverName', 'approverRole', 'approvedAtFormatted'
  ],
  optionalPlaceholders: [
    'referringDoctorName', 'sampleCollectedAtFormatted', 'impression', 'approverSignature'
  ],
};

// ============================================
// BLOCK COLLECTIONS
// ============================================

export const ALL_TEMPLATE_BLOCKS: TemplateBlock[] = [
  COMPLETE_TEMPLATE_STARTER,
  REPORT_HEADER,
  REPORT_TITLE,
  PATIENT_INFO_TABLE,
  PATIENT_INFO_COMPACT,
  RESULTS_TABLE_HEADER,
  CLINICAL_IMPRESSION,
  CLINICAL_FINDINGS,
  CLINICAL_RECOMMENDATION,
  CLINICAL_HISTORY,
  SIGNATURE_BLOCK,
  SIGNATURE_SIMPLE,
  HORIZONTAL_DIVIDER,
  REPORT_FOOTER,
];

export const BLOCKS_BY_CATEGORY = {
  structure: [REPORT_HEADER, REPORT_TITLE, HORIZONTAL_DIVIDER, REPORT_FOOTER, COMPLETE_TEMPLATE_STARTER],
  patient: [PATIENT_INFO_TABLE, PATIENT_INFO_COMPACT],
  results: [RESULTS_TABLE_HEADER],
  clinical: [CLINICAL_IMPRESSION, CLINICAL_FINDINGS, CLINICAL_RECOMMENDATION, CLINICAL_HISTORY],
  signature: [SIGNATURE_BLOCK, SIGNATURE_SIMPLE],
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Extract all placeholders from HTML
 */
export function extractPlaceholders(html: string): string[] {
  const regex = /\{\{\s*([^{}]+)\s*\}\}/g;
  const placeholders: string[] = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    placeholders.push(match[1].trim());
  }
  return [...new Set(placeholders)];
}

/**
 * Check if HTML contains all required placeholders for a block
 */
export function validateBlockPlaceholders(html: string, block: TemplateBlock): {
  valid: boolean;
  missing: string[];
  found: string[];
} {
  const foundPlaceholders = extractPlaceholders(html);
  const missing = block.requiredPlaceholders.filter(
    (p) => !foundPlaceholders.some((f) => f.toLowerCase() === p.toLowerCase())
  );
  return {
    valid: missing.length === 0,
    missing,
    found: foundPlaceholders,
  };
}

/**
 * Get quick actions for building templates
 */
export interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: string;
  category: 'structure' | 'patient' | 'results' | 'clinical' | 'signature';
  block?: TemplateBlock;
  action?: 'insert_block' | 'insert_all_analytes' | 'custom';
}

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'add-complete-starter',
    label: 'Complete Template',
    description: 'Insert full template structure with all sections',
    icon: 'file-text',
    category: 'structure',
    block: COMPLETE_TEMPLATE_STARTER,
    action: 'insert_block',
  },
  {
    id: 'add-patient-table',
    label: 'Patient Info Table',
    description: 'Add patient information table',
    icon: 'user',
    category: 'patient',
    block: PATIENT_INFO_TABLE,
    action: 'insert_block',
  },
  {
    id: 'add-results-table',
    label: 'Results Table',
    description: 'Add test results table header',
    icon: 'table',
    category: 'results',
    block: RESULTS_TABLE_HEADER,
    action: 'insert_block',
  },
  {
    id: 'add-all-analytes',
    label: 'Add All Analytes',
    description: 'Insert rows for all test group analytes',
    icon: 'list-plus',
    category: 'results',
    action: 'insert_all_analytes',
  },
  {
    id: 'add-clinical-impression',
    label: 'Clinical Impression',
    description: 'Add clinical interpretation section',
    icon: 'stethoscope',
    category: 'clinical',
    block: CLINICAL_IMPRESSION,
    action: 'insert_block',
  },
  {
    id: 'add-signature',
    label: 'Signature Block',
    description: 'Add approval signature with image',
    icon: 'pen-tool',
    category: 'signature',
    block: SIGNATURE_BLOCK,
    action: 'insert_block',
  },
  {
    id: 'add-divider',
    label: 'Divider Line',
    description: 'Add horizontal separator',
    icon: 'minus',
    category: 'structure',
    block: HORIZONTAL_DIVIDER,
    action: 'insert_block',
  },
];

// ============================================
// STYLED TEMPLATE GENERATORS
// Matching generate-pdf-letterhead edge function output exactly.
// Returns { html, css } ready to load into gjs_html / gjs_css.
// ============================================

export type TemplateStyle = 'basic' | 'classic' | 'beautiful';

export function generateStyledTemplate(
  style: TemplateStyle,
  analytes: AnalyteInfo[],
  testGroupName: string,
): { html: string; css: string } {
  if (style === 'basic') return _generateBasicTemplate(analytes, testGroupName);
  if (style === 'classic') return _generateClassicTemplate(analytes, testGroupName);
  return _generateBeautifulTemplate(analytes, testGroupName);
}

function _generateBasicTemplate(analytes: AnalyteInfo[], testGroupName: string): { html: string; css: string } {
  const rows = analytes.map((a) => {
    const code = a.code.toUpperCase();
    return `        <tr>
          <td class="test-name-cell"><span class="test-name">${a.label}</span></td>
          <td class="val {{ANALYTE_${code}_FLAG_CLASS}}">{{ANALYTE_${code}_VALUE}}</td>
          <td>{{ANALYTE_${code}_UNIT}}</td>
          <td>{{ANALYTE_${code}_REFERENCE}}</td>
        </tr>`;
  }).join('\n');

  const html = `<div class="basic-report-template">
  <div class="report-title-bar">
    <div class="report-title-spacer"></div>
    <h2 class="report-main-title">TEST REPORT</h2>
    <div class="report-title-barcode"></div>
  </div>

  <figure class="table" style="margin: 0 0 10px;">
    <table class="patient-header-table">
      <tbody>
        <tr>
          <th>Name</th><td>: {{patientName}}</td>
          <th>Reg. No</th><td>: {{patientId}}</td>
        </tr>
        <tr>
          <th>Age / Sex</th><td>: {{patientAge}} / {{patientGender}}</td>
          <th>Reg. Date</th><td>: {{orderDate}}</td>
        </tr>
        <tr>
          <th>Ref. By</th><td>: {{referringDoctorName}}</td>
          <th>Report Date</th><td>: {{reportDate}}</td>
        </tr>
      </tbody>
    </table>
  </figure>

  <div class="test-results">
    <div class="test-group-section">
      <table class="tbl-results" style="margin-top: 0;">
        <thead>
          <tr class="main-group-row">
            <td colspan="4"><div class="center-title">${testGroupName}</div></td>
          </tr>
          <tr>
            <th>Test Name</th>
            <th>Result</th>
            <th>Unit</th>
            <th>Reference Range</th>
          </tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>
  </div>

  {% if showGroupInterpretation %}
  <div class="group-interpretation-block">{{ groupInterpretation }}</div>
  {% endif %}

  <div class="report-footer">
    <div class="qr-verify"></div>
    <div class="signature-box">
      <img src="{{approverSignature}}" alt="Signature" style="max-height:50px;max-width:150px;margin-bottom:5px;object-fit:contain;" />
      <div style="font-weight:700;font-size:12px;color:#000;border-bottom:1px solid #000;padding-bottom:3px;margin-bottom:3px;">{{approverName}}</div>
      <div style="font-size:11px;color:#444;">{{approverRole}}</div>
      <div style="font-size:10px;color:#666;">{{approvedAtFormatted}}</div>
    </div>
  </div>
</div>`;

  const css = `.basic-report-template {
  font-size: 11px;
  line-height: 1.32;
  color: #000;
  font-family: Arial, Helvetica, sans-serif;
  display: flex;
  flex-direction: column;
  min-height: 780px;
}
.basic-report-template table {
  border: none !important;
  border-collapse: collapse !important;
}
.basic-report-template td,
.basic-report-template th {
  color: #000 !important;
  font-weight: normal;
  background-color: #fff !important;
  vertical-align: top !important;
}
.basic-report-template td { padding: 2px 4px !important; }
.basic-report-template th { padding: 3px 4px !important; }
.basic-report-template .report-title-bar {
  display: flex !important;
  align-items: center !important;
  border-top: 1.5px solid #000 !important;
  border-bottom: 1.5px solid #000 !important;
  padding: 4px 0 !important;
  margin: 6px 0 10px !important;
}
.basic-report-template .report-main-title {
  text-align: center !important;
  font-size: 14px !important;
  border: none !important;
  padding: 0 !important;
  margin: 0 !important;
  font-weight: 700 !important;
  color: #000 !important;
  line-height: 1.2 !important;
  flex: 1 !important;
}
.basic-report-template .report-title-spacer,
.basic-report-template .report-title-barcode {
  width: 110px !important;
  flex-shrink: 0 !important;
}
.basic-report-template .patient-header-table {
  width: 100% !important;
  table-layout: fixed !important;
  margin-bottom: 8px !important;
  border: none !important;
}
.basic-report-template .patient-header-table th {
  width: 15% !important;
  font-weight: 700 !important;
  text-align: left !important;
  color: #000 !important;
  padding: 2px 3px !important;
  white-space: nowrap !important;
  border: none !important;
  font-size: 11px !important;
}
.basic-report-template .patient-header-table td {
  width: 35% !important;
  padding: 2px 3px !important;
  border: none !important;
  color: #111 !important;
  word-break: break-word !important;
  font-size: 11px !important;
}
.basic-report-template .tbl-results {
  width: 100% !important;
  table-layout: fixed !important;
  border-collapse: collapse !important;
  border: none !important;
  margin-top: 4px !important;
}
.basic-report-template .tbl-results thead th {
  border-top: 1.5px solid #000 !important;
  border-bottom: 1.5px solid #000 !important;
  border-left: none !important;
  border-right: none !important;
  font-weight: 700 !important;
  color: #000 !important;
  padding: 4px 4px !important;
  font-size: 10px !important;
  vertical-align: middle !important;
}
.basic-report-template .tbl-results thead th:nth-child(1) { width: 38% !important; text-align: left !important; }
.basic-report-template .tbl-results thead th:nth-child(2) { width: 12% !important; text-align: right !important; }
.basic-report-template .tbl-results thead th:nth-child(3) { width: 10% !important; text-align: left !important; }
.basic-report-template .tbl-results thead th:nth-child(4) { width: 40% !important; text-align: left !important; }
.basic-report-template .tbl-results tbody td:nth-child(1) { width: 38% !important; text-align: left !important; color: #111 !important; }
.basic-report-template .tbl-results tbody td:nth-child(2) { width: 12% !important; text-align: right !important; }
.basic-report-template .tbl-results tbody td:nth-child(3) { width: 10% !important; text-align: left !important; color: #444 !important; white-space: nowrap !important; }
.basic-report-template .tbl-results tbody td:nth-child(4) { width: 40% !important; text-align: left !important; color: #666 !important; }
.basic-report-template .tbl-results td,
.basic-report-template .tbl-results th {
  border: none !important;
  padding: 2px 4px !important;
  line-height: 1.28 !important;
  font-size: 11px !important;
}
.basic-report-template .tbl-results tbody tr td {
  border-bottom: 0.5px dotted #e5e5e5 !important;
}
.basic-report-template .test-name-cell { vertical-align: top !important; }
.basic-report-template .test-name {
  font-size: 11px !important;
  font-weight: 600 !important;
  color: #111 !important;
  line-height: 1.22 !important;
}
.basic-report-template .val {
  text-align: right !important;
  vertical-align: top !important;
  font-size: 11px !important;
  font-weight: 600 !important;
  font-variant-numeric: tabular-nums !important;
}
.basic-report-template .val.result-high,
.basic-report-template .val.flag-high { color: #dc2626 !important; font-weight: 700 !important; }
.basic-report-template .val.result-low,
.basic-report-template .val.flag-low { color: #000000 !important; font-weight: 700 !important; }
.basic-report-template .val.result-critical,
.basic-report-template .val.flag-critical { color: #dc2626 !important; font-weight: 900 !important; }
.basic-report-template .val.result-abnormal,
.basic-report-template .val.flag-abnormal { color: #dc2626 !important; font-weight: 700 !important; }
.basic-report-template .center-title {
  text-align: center !important;
  font-weight: 700 !important;
  text-decoration: underline !important;
  font-size: 12px !important;
  margin: 8px 0 0 !important;
  text-transform: uppercase !important;
  line-height: 1.2 !important;
  color: #000 !important;
}
.basic-report-template .main-group-row td {
  padding: 8px 0 5px 0 !important;
  border: none !important;
}
.basic-report-template .group-interpretation-block {
  margin-top: 12px !important;
  page-break-inside: avoid !important;
  color: #111 !important;
  font-size: 11px !important;
}
.basic-report-template .group-interpretation-block .section-header {
  margin: 0 0 6px !important;
  padding: 0 0 4px !important;
  border-bottom: 1px solid #000 !important;
  font-size: 12px !important;
  font-weight: 700 !important;
  color: #000 !important;
}
.basic-report-template .group-interpretation-block .tbl-interpretation {
  width: 100% !important;
  border-collapse: collapse !important;
  margin-top: 8px !important;
}
.basic-report-template .group-interpretation-block .tbl-interpretation th,
.basic-report-template .group-interpretation-block .tbl-interpretation td {
  border: 1px solid #cfcfcf !important;
  padding: 5px 6px !important;
  text-align: left !important;
  vertical-align: top !important;
  font-size: 11px !important;
  color: #111 !important;
}
.basic-report-template .group-interpretation-block .note {
  margin-top: 8px !important;
  padding: 8px 10px !important;
  border-left: 2px solid #000 !important;
  background: #f8f8f8 !important;
  color: #333 !important;
}
.basic-report-template .report-footer {
  margin-top: auto !important;
  padding-top: 30px !important;
  display: flex !important;
  justify-content: space-between !important;
  align-items: flex-end !important;
  page-break-inside: avoid !important;
}
.basic-report-template .signature-box { text-align: right !important; }
@media print {
  .basic-report-template { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .basic-report-template .tbl-results thead th {
    border-top: 1.4px solid #000 !important;
    border-bottom: 1.4px solid #000 !important;
  }
}`;

  return { html, css };
}

function _generateClassicTemplate(analytes: AnalyteInfo[], testGroupName: string): { html: string; css: string } {
  const rows = analytes.map((a, i) => {
    const code = a.code.toUpperCase();
    const rowBg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
    return `        <tr style="background: ${rowBg};">
          <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${a.label}</td>
          <td class="{{ANALYTE_${code}_FLAG_CLASS}}" style="padding: 8px 12px; border: 1px solid #e5e7eb;">{{ANALYTE_${code}_VALUE}}</td>
          <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">{{ANALYTE_${code}_UNIT}}</td>
          <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">{{ANALYTE_${code}_REFERENCE}}</td>
          <td class="{{ANALYTE_${code}_FLAG_CLASS}}" style="padding: 8px 12px; border: 1px solid #e5e7eb; text-align: center;">{{ANALYTE_${code}_FLAG}}</td>
        </tr>`;
  }).join('\n');

  const html = `<div class="classic-report">
  <div class="patient-info" style="page-break-inside: avoid;">
    <h3 style="font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px;">Patient Information</h3>
    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
      <tbody>
        <tr>
          <td style="padding: 8px 12px; border: 1px solid #e5e7eb; background: #f9fafb; width: 25%; font-weight: 500;">Patient Name</td>
          <td style="padding: 8px 12px; border: 1px solid #e5e7eb; width: 25%;">{{patientName}}</td>
          <td style="padding: 8px 12px; border: 1px solid #e5e7eb; background: #f9fafb; width: 25%; font-weight: 500;">Patient ID</td>
          <td style="padding: 8px 12px; border: 1px solid #e5e7eb; width: 25%;">{{patientId}}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; border: 1px solid #e5e7eb; background: #f9fafb; font-weight: 500;">Age / Gender</td>
          <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">{{patientAge}} / {{patientGender}}</td>
          <td style="padding: 8px 12px; border: 1px solid #e5e7eb; background: #f9fafb; font-weight: 500;">Collected On</td>
          <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">{{collectionDate}}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; border: 1px solid #e5e7eb; background: #f9fafb; font-weight: 500;">Ref. Doctor</td>
          <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">{{referringDoctorName}}</td>
          <td style="padding: 8px 12px; border: 1px solid #e5e7eb; background: #f9fafb; font-weight: 500;">Approved on</td>
          <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">{{approvedAt}}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="test-results" style="margin-top: 20px;">
    <h3 style="font-size: 14px; font-weight: 600; color: #1e40af; margin-bottom: 8px; border-bottom: 2px solid #3b82f6; padding-bottom: 4px;">Test Results</h3>
    <div class="test-group-section" style="margin-bottom: 16px;">
      <h4 style="font-size: 16px; font-weight: 600; color: #1e40af; padding: 6px 0; margin: 0;">${testGroupName}</h4>
      <table class="report-table" style="width: 100%; border-collapse: collapse; font-size: 12px;">
        <thead>
          <tr style="background: #f1f5f9;">
            <th style="padding: 10px 12px; border: 1px solid #e5e7eb; text-align: left; font-weight: 600; width: 30%;">Test Parameter</th>
            <th style="padding: 10px 12px; border: 1px solid #e5e7eb; text-align: left; font-weight: 600; width: 20%;">Result</th>
            <th style="padding: 10px 12px; border: 1px solid #e5e7eb; text-align: left; font-weight: 600; width: 15%;">Unit</th>
            <th style="padding: 10px 12px; border: 1px solid #e5e7eb; text-align: left; font-weight: 600; width: 25%;">Reference Range</th>
            <th style="padding: 10px 12px; border: 1px solid #e5e7eb; text-align: center; font-weight: 600; width: 10%;">Flag</th>
          </tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>
  </div>

  <div style="margin-top: 30px; text-align: right; page-break-inside: avoid;">
    <div style="display: inline-block; text-align: center; min-width: 180px;">
      <img src="{{approverSignature}}" alt="Signature" style="max-height:50px;max-width:150px;margin-bottom:5px;object-fit:contain;" />
      <div style="font-size:14px;font-weight:600;color:#1f2937;border-bottom:1px solid #374151;padding-bottom:4px;margin-bottom:4px;">{{approverName}}</div>
      <div style="font-size:11px;color:#6b7280;">{{approverRole}}</div>
      <div style="font-size:10px;color:#9ca3af;margin-top:4px;">{{approvedAtFormatted}}</div>
    </div>
  </div>
</div>`;

  const css = `.classic-report .result-high, .classic-report .flag-high { color: #dc2626; font-weight: bold; }
.classic-report .result-low, .classic-report .flag-low { color: #ea580c; font-weight: bold; }
.classic-report .result-normal, .classic-report .flag-normal { color: #16a34a; }
.classic-report .result-critical, .classic-report .flag-critical { color: #7c2d12; font-weight: bold; }
.classic-report .result-abnormal, .classic-report .flag-abnormal { color: #dc2626; font-weight: bold; }`;

  return { html, css };
}

function _generateBeautifulTemplate(analytes: AnalyteInfo[], testGroupName: string): { html: string; css: string } {
  const rows = analytes.map((a) => {
    const code = a.code.toUpperCase();
    return `        <tr style="page-break-inside: avoid;">
          <td style="font-weight: 600; padding: 10px 12px; border: 1px solid #d1d5db; color: #1f2937;">${a.label}</td>
          <td style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: center; font-weight: 700; color: #374151;">{{ANALYTE_${code}_VALUE}}</td>
          <td style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: center; color: #6b7280; font-size: 12px;">{{ANALYTE_${code}_UNIT}}</td>
          <td style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: center; color: #6b7280; font-size: 12px;">{{ANALYTE_${code}_REFERENCE}}</td>
          <td style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: center;">
            <span class="flag-badge {{ANALYTE_${code}_FLAG_CLASS}}">{{ANALYTE_${code}_FLAG}}</span>
          </td>
        </tr>`;
  }).join('\n');

  const html = `<div class="beautiful-report">
  <div style="margin-bottom: 16px; padding: 12px 16px; background: #ffffff; border: 1px solid #d1d5db; border-radius: 4px; page-break-inside: avoid;">
    <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
      <div style="font-size: 16px; font-weight: 700; color: #5a7f3a;">{{patientName}}</div>
      <div style="font-size: 11px; color: #6b7280;">{{approvedAtFormatted}}</div>
    </div>
    <div style="display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: #374151;">
      <span><strong>Patient ID:</strong> {{patientId}}</span>
      <span><strong>Age:</strong> {{patientAge}}</span>
      <span><strong>Gender:</strong> {{patientGender}}</span>
      <span><strong>Physician:</strong> {{referringDoctorName}}</span>
      <span><strong>Collected:</strong> {{collectionDate}}</span>
      <span><strong>Sample ID:</strong> {{sampleId}}</span>
    </div>
  </div>

  <div class="test-results">
    <div class="test-group-section" style="margin-bottom: 20px; page-break-inside: auto;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid #5a7f3a;">
        <h3 style="font-size: 18px; font-weight: 600; color: #5a7f3a; margin: 0;">${testGroupName}</h3>
      </div>
      <table class="report-table" style="width: 100%; border-collapse: collapse; font-size: 13px; background: #ffffff; -webkit-print-color-adjust: exact; print-color-adjust: exact; margin-bottom: 12px;">
        <thead>
          <tr>
            <th style="text-align: left; padding: 8px 12px; border: 1px solid #d1d5db; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: #374151; background-color: #e8efe4; -webkit-print-color-adjust: exact; print-color-adjust: exact;">Test Name</th>
            <th style="text-align: center; padding: 8px 12px; border: 1px solid #d1d5db; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: #374151; background-color: #e8efe4; -webkit-print-color-adjust: exact; print-color-adjust: exact;">Result</th>
            <th style="text-align: center; padding: 8px 12px; border: 1px solid #d1d5db; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: #374151; background-color: #e8efe4; -webkit-print-color-adjust: exact; print-color-adjust: exact;">Unit</th>
            <th style="text-align: center; padding: 8px 12px; border: 1px solid #d1d5db; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: #374151; background-color: #e8efe4; -webkit-print-color-adjust: exact; print-color-adjust: exact;">Ref. Range</th>
            <th style="text-align: center; padding: 8px 12px; border: 1px solid #d1d5db; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: #374151; background-color: #e8efe4; -webkit-print-color-adjust: exact; print-color-adjust: exact;">Flag</th>
          </tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>
  </div>

  <div style="margin-top: 30px; display: flex; justify-content: flex-end; page-break-inside: avoid;">
    <div style="text-align: center; min-width: 180px;">
      <img src="{{approverSignature}}" alt="Signature" style="max-height:50px;max-width:150px;margin-bottom:5px;object-fit:contain;" />
      <div style="font-size:14px;font-weight:600;color:#1f2937;border-bottom:1px solid #374151;padding-bottom:4px;margin-bottom:4px;">{{approverName}}</div>
      <div style="font-size:11px;color:#6b7280;">{{approverRole}}</div>
    </div>
  </div>
</div>`;

  const css = `.beautiful-report .flag-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
  color: white;
  background-color: #6b7280;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.beautiful-report .flag-badge.result-high,
.beautiful-report .flag-badge.flag-high { background-color: #c45454 !important; }
.beautiful-report .flag-badge.result-low,
.beautiful-report .flag-badge.flag-low { background-color: #ea580c !important; }
.beautiful-report .flag-badge.result-normal,
.beautiful-report .flag-badge.flag-normal { background-color: #4a8c4a !important; }
.beautiful-report .flag-badge.result-critical,
.beautiful-report .flag-badge.flag-critical { background-color: #7c2d12 !important; }
.beautiful-report .flag-badge.result-abnormal,
.beautiful-report .flag-badge.flag-abnormal { background-color: #c45454 !important; }`;

  return { html, css };
}
