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
    <img src="{{approverSignature}}" alt="" style="max-height: 70px; max-width: 180px; width: auto; height: auto; object-fit: contain; margin-bottom: 5px;" onerror="this.style.display='none'" />
    <div class="signatory-name" style="font-size: 13px; font-weight: 600; line-height: 1.35; white-space: pre-line; color: #1f2937;">{{approverName}}</div>
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
    <div class="signatory-name" style="font-size: 13px; font-weight: 600; line-height: 1.35; white-space: pre-line; color: #1f2937;">{{approverName}}</div>
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
      <img src="{{approverSignature}}" alt="" style="max-height: 70px; max-width: 180px; width: auto; height: auto; object-fit: contain; margin-bottom: 5px;" onerror="this.style.display='none'" />
      <div class="signatory-name" style="font-size: 13px; font-weight: 600; line-height: 1.35; white-space: pre-line; color: #1f2937;">{{approverName}}</div>
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
