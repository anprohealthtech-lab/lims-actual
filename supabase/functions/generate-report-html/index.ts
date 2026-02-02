// Supabase Edge Function: Full Server-Side PDF Generation with PDF.co
// Complete pipeline: Context → Templates → HTML → PDF.co → Storage

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'
import { fetchHeaderFooter, fetchFrontBackPages } from './headerFooterHelper.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Custom domain for reports storage (configured via Deno environment variable)
const CUSTOM_REPORTS_DOMAIN = Deno.env.get('CUSTOM_STORAGE_DOMAIN') || '';

/**
 * Get public URL for storage file with custom domain support
 */
function getPublicStorageUrl(bucket: string, path: string): string {
  if (bucket === 'reports' && CUSTOM_REPORTS_DOMAIN) {
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    return `${CUSTOM_REPORTS_DOMAIN}/${cleanPath}`;
  }
  
  // Fallback to Supabase default URL
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}

// ============================================================
// SECTION: Configuration & Constants
// ============================================================

const PDFCO_API_URL = 'https://api.pdf.co/v1/pdf/convert/from/html'
const PDFCO_JOB_STATUS_URL = 'https://api.pdf.co/v1/job/check'

// Default PDF settings (fallback if not in lab settings)
const DEFAULT_PDF_SETTINGS = {
  margins: '180px 20px 150px 20px',  // top right bottom left
  headerHeight: '90px',
  footerHeight: '80px',
  scale: 1.0,
  paperSize: 'A4',
  displayHeaderFooter: true,
  mediaType: 'screen',
  printBackground: true
}

// Comprehensive baseline CSS for report styling (server-side)
const BASELINE_CSS = `
/* LIMS Report Baseline CSS - Server-Side */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans:wght@400;700&family=Noto+Sans+Devanagari&family=Noto+Sans+Gujarati&family=Noto+Sans+Tamil&family=Noto+Sans+Telugu&family=Noto+Sans+Kannada&family=Noto+Sans+Bengali&family=Noto+Sans+Gurmukhi&family=Noto+Sans+Malayalam&family=Noto+Sans+Oriya&display=swap');

:root {
  --report-font-family: "Inter", "Noto Sans", "Noto Sans Gujarati", "Noto Sans Devanagari", "Noto Sans Tamil", "Noto Sans Telugu", "Noto Sans Kannada", "Noto Sans Bengali", "Noto Sans Gurmukhi", "Noto Sans Malayalam", "Noto Sans Oriya", Arial, sans-serif;
  --report-text-color: #1f2937;
  --report-muted-color: #4b5563;
  --report-heading-color: #111827;
  --report-border-color: #d1d5db;
  --report-accent-color: #2563eb;
  --report-background-color: #ffffff;
}

.limsv2-report {
  position: relative;
  font-family: var(--report-font-family);
  color: var(--report-text-color);
  background-color: var(--report-background-color);
  font-size: 14px;
  line-height: 1.6;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.limsv2-report * {
  box-sizing: border-box;
}

.limsv2-report-body {
  padding: 15px 20px;
  position: relative;
  z-index: 2;
}

.limsv2-report-body--pdf {
  padding: 0 20px;
}

/* Typography */
.limsv2-report h1, .limsv2-report h2, .limsv2-report h3,
.limsv2-report h4, .limsv2-report h5, .limsv2-report h6 {
  font-family: var(--report-font-family);
  color: var(--report-heading-color);
  margin: 0 0 0.25rem;
  line-height: 1.3;
}

.limsv2-report h1 { font-size: 2rem; }
.limsv2-report h2 { font-size: 1.5rem; }
.limsv2-report h3 { font-size: 1.25rem; }
.limsv2-report h4 { font-size: 1.1rem; }

.limsv2-report p {
  margin: 0 0 0.5rem;
  color: var(--report-text-color);
}

.limsv2-report p:last-child {
  margin-bottom: 0;
}

/* Images */
.limsv2-report img {
  max-width: 100%;
  height: auto;
  display: block;
}

/* Tables */
.limsv2-report table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.75rem 0;
  font-size: 0.95rem;
}

.limsv2-report table thead th {
  background-color: #f1f5f9;
  color: var(--report-heading-color);
}

.limsv2-report table th,
.limsv2-report table td {
  border: 1px solid var(--report-border-color);
  padding: 10px 12px;
  text-align: left;
  vertical-align: top;
}

.limsv2-report table tbody tr:nth-child(even) {
  background-color: #f8fafc;
}

/* Abnormal values highlighting & Flags */
.result-abnormal, .abnormal, .flag-abnormal {
  color: #dc2626; /* Red-600 */
  font-weight: bold;
}

.result-high, .flag-high, .result-critical_high {
  color: #dc2626 !important; /* Red */
  font-weight: bold;
}

.result-low, .flag-low, .result-critical_low {
  color: #ea580c !important; /* Orange-600 */
  font-weight: bold;
}

.result-normal, .normal, .flag-normal {
  color: #16a34a !important; /* Green-600 */
}

/* Report Header & Titles */
/* Ensures headers on dark backgrounds are white */
.report-header-title,
.report-title,
.header-dark h1,
.header-dark h2,
.header-dark h3,
[style*="background-color: #"] h1,
[style*="background-color: rgb"] h1 {
  color: #ffffff !important;
}

/* Info grid for patient/order details */
.limsv2-report .info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.75rem 1.25rem;
  margin-bottom: 1.5rem;
}

.limsv2-report .info-grid .label {
  display: block;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--report-muted-color);
}

.limsv2-report .info-grid .value {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--report-heading-color);
}

/* Signature section styling - no forced spacing, let templates control */
.limsv2-report .signature-section,
.limsv2-report [class*="signature"],
.limsv2-report [id*="signature"] {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  text-align: right;
}

.limsv2-report .signature-section img,
.limsv2-report [class*="signature"] img,
.limsv2-report [id*="signature"] img {
  max-width: 150px;
  max-height: 50px;
  height: auto;
  margin-left: auto;
  display: block;
}

/* Section helpers */
.limsv2-report .report-section {
  margin-bottom: 1.5rem;
}

.limsv2-report hr {
  border: 0;
  border-top: 1px solid var(--report-border-color);
  margin: 1.5rem 0;
}

/* Watermark */
.report-watermark {
  position: absolute !important;
  top: 50% !important;
  left: 50% !important;
  transform: translate(-50%, -50%) !important;
  z-index: 1 !important;
  opacity: 0.15 !important;
  pointer-events: none !important;
  max-width: 80% !important;
}

/* Draft watermark */
.draft-watermark {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-45deg);
  font-size: 100px;
  color: rgba(200, 200, 200, 0.3);
  pointer-events: none;
  z-index: 1000;
}

/* =========================================
   CRITICAL PDF RENDERING FIXES 
   ========================================= */

/* Ensure containers don't clip content */
.limsv2-report .report-container,
.limsv2-report .report-body,
.report-container, 
.report-body,
.report-region,
.report-region--body {
  height: auto !important;
  min-height: auto !important;
  overflow: visible !important;
  display: block !important;
  max-width: none !important; /* Allow full width for PDF */
  border: none !important; /* Remove border to avoid box visuals in print */
  box-shadow: none !important; /* Remove shadow */
  margin: 0 !important;
  padding: 0 !important;
}

/* Ensure sections outside container are visible */
.limsv2-report section,
.limsv2-report > div {
  overflow: visible !important;
}

/* Handle page breaks better */
.section-header {
  page-break-after: avoid;
}

.report-table, .patient-info {
  page-break-inside: avoid;
}

/* Ensure tables are visible */
figure.table {
  display: block;
  overflow: visible !important;
  margin: 1em 0;
}

/* Report extras */
.report-extras-section {
  margin-top: 30px;
  padding: 15px;
}

.clinical-summary-section {
  padding: 15px;
  background: #f8fafc;
  border: 1px solid var(--report-border-color);
  border-radius: 8px;
  margin-top: 15px;
}

.clinical-summary-title {
  font-size: 1rem;
  color: var(--report-heading-color);
  border-bottom: 1px solid var(--report-border-color);
  padding-bottom: 8px;
  margin-bottom: 12px;
}

/* Page break helpers */
.avoid-break {
  break-inside: avoid;
  page-break-inside: avoid;
}

.page-break-before {
  break-before: page;
  page-break-before: always;
}

/* Section content (doctor-filled sections) */
.section-content {
  font-family: var(--report-font-family);
  color: var(--report-text-color);
  font-size: 14px;
  line-height: 1.6;
  margin: 0.75rem 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  position: relative;
  z-index: 2;
}

.section-content p {
  margin: 0.5rem 0;
  color: var(--report-text-color);
  line-height: 1.6;
}

.section-content p:first-child {
  margin-top: 0;
}

.section-content p:last-child {
  margin-bottom: 0;
}

.section-content strong,
.section-content b {
  font-weight: 600;
  color: var(--report-heading-color);
}

.section-content em,
.section-content i {
  font-style: italic;
}
`

// ============================================================
// SECTION: Flag Determination System
// ============================================================

type FlagValue = 'normal' | 'high' | 'low' | 'critical_high' | 'critical_low' | 'abnormal' | null

interface ParsedRange {
  low: number | null
  high: number | null
  type: 'range' | 'less_than' | 'greater_than' | 'single' | 'none'
}

// Known normal text patterns
const NORMAL_TEXT_PATTERNS = [
  /^negative$/i,
  /^non[\s-]?reactive$/i,
  /^normal$/i,
  /^nil$/i,
  /^absent$/i,
  /^not[\s-]?detected$/i,
  /^nd$/i,
  /^none[\s-]?seen$/i,
  /^within[\s-]?normal[\s-]?limits$/i,
  /^wnl$/i,
  /^unremarkable$/i,
  /^clear$/i,
  /^no[\s-]?growth$/i,
  /^sterile$/i
]

// Known abnormal text patterns
const ABNORMAL_TEXT_PATTERNS = [
  /^positive$/i,
  /^reactive$/i,
  /^detected$/i,
  /^present$/i,
  /^abnormal$/i,
  /^growth$/i
]

// Semi-quantitative normal values
const SEMI_QUANT_NORMAL = ['nil', 'negative', 'trace', '±', '+-', 'neg']
const SEMI_QUANT_ABNORMAL_ORDER = ['1+', '+', '2+', '++', '3+', '+++', '4+', '++++']

/**
 * Parse reference range string into numeric bounds
 */
function parseReferenceRange(refRange: string | null | undefined): ParsedRange {
  if (!refRange || typeof refRange !== 'string') {
    return { low: null, high: null, type: 'none' }
  }

  const cleaned = refRange
    .replace(/\([^)]*\)/g, '') // Remove parenthetical notes
    .replace(/[a-zA-Z%\/]+/g, ' ') // Remove units
    .replace(/,/g, '') // Remove commas
    .trim()

  // Pattern: "< X" or "≤ X"
  const lessThanMatch = cleaned.match(/[<≤]\s*([\d.]+)/)
  if (lessThanMatch) {
    return { low: null, high: parseFloat(lessThanMatch[1]), type: 'less_than' }
  }

  // Pattern: "> X" or "≥ X"
  const greaterThanMatch = cleaned.match(/[>≥]\s*([\d.]+)/)
  if (greaterThanMatch) {
    return { low: parseFloat(greaterThanMatch[1]), high: null, type: 'greater_than' }
  }

  // Pattern: "X - Y" or "X – Y" or "X to Y"
  const rangeMatch = cleaned.match(/([\d.]+)\s*[-–—~to]+\s*([\d.]+)/i)
  if (rangeMatch) {
    const low = parseFloat(rangeMatch[1])
    const high = parseFloat(rangeMatch[2])
    return { low: Math.min(low, high), high: Math.max(low, high), type: 'range' }
  }

  // Single number
  const singleMatch = cleaned.match(/^([\d.]+)$/)
  if (singleMatch) {
    return { low: null, high: parseFloat(singleMatch[1]), type: 'single' }
  }

  return { low: null, high: null, type: 'none' }
}

/**
 * Extract numeric value from string
 */
function extractNumericValue(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return value
  
  const cleaned = String(value).replace(/[,<>≤≥]/g, '').trim()
  const match = cleaned.match(/^-?([\d.]+)/)
  if (match) {
    const num = parseFloat(match[0])
    return isNaN(num) ? null : num
  }
  return null
}

/**
 * Detect value type
 */
function detectValueType(value: string): 'numeric' | 'qualitative' | 'semi_quantitative' | 'descriptive' {
  const num = extractNumericValue(value)
  if (num !== null) return 'numeric'
  
  const lower = value.toLowerCase().trim()
  
  if (/^[+-]+$/.test(value) || /^[1-4]\+$/.test(value) || lower === 'trace') {
    return 'semi_quantitative'
  }
  
  if (NORMAL_TEXT_PATTERNS.some(p => p.test(lower)) || 
      ABNORMAL_TEXT_PATTERNS.some(p => p.test(lower))) {
    return 'qualitative'
  }
  
  if (value.split(/\s+/).length > 3) {
    return 'descriptive'
  }
  
  return 'qualitative'
}

/**
 * Determine flag for a result value
 */
function determineFlag(
  value: string | number | null | undefined,
  referenceRange: string | null | undefined,
  lowCritical?: string | number | null,
  highCritical?: string | number | null,
  patientGender?: string,
  referenceRangeMale?: string | null,
  referenceRangeFemale?: string | null,
  expectedNormalValues?: string[]
): { flag: FlagValue; displayFlag: string } {
  if (value === null || value === undefined || value === '') {
    return { flag: null, displayFlag: '' }
  }

  const strValue = String(value).trim()
  const valueType = detectValueType(strValue)

  // Get appropriate reference range based on gender
  let effectiveRefRange = referenceRange
  if (patientGender === 'Male' && referenceRangeMale) {
    effectiveRefRange = referenceRangeMale
  } else if (patientGender === 'Female' && referenceRangeFemale) {
    effectiveRefRange = referenceRangeFemale
  }

  let flag: FlagValue = null

  if (valueType === 'numeric') {
    const numValue = extractNumericValue(strValue)
    if (numValue !== null) {
      const lowCrit = extractNumericValue(lowCritical)
      const highCrit = extractNumericValue(highCritical)
      const { low, high, type } = parseReferenceRange(effectiveRefRange)

      // Critical checks first
      if (highCrit !== null && numValue >= highCrit) {
        flag = 'critical_high'
      } else if (lowCrit !== null && numValue <= lowCrit) {
        flag = 'critical_low'
      } else if (type === 'range' && low !== null && high !== null) {
        if (numValue < low) flag = 'low'
        else if (numValue > high) flag = 'high'
        else flag = 'normal'
      } else if (type === 'less_than' && high !== null) {
        flag = numValue > high ? 'high' : 'normal'
      } else if (type === 'greater_than' && low !== null) {
        flag = numValue < low ? 'low' : 'normal'
      }
    }
  } else if (valueType === 'qualitative') {
    const lower = strValue.toLowerCase()
    
    // Check expected normal values first
    if (expectedNormalValues && expectedNormalValues.length > 0) {
      const normalVals = expectedNormalValues.map(v => v.toLowerCase())
      flag = normalVals.some(nv => lower === nv || lower.includes(nv)) ? 'normal' : 'abnormal'
    } else {
      // Pattern matching
      if (NORMAL_TEXT_PATTERNS.some(p => p.test(lower))) {
        flag = 'normal'
      } else if (ABNORMAL_TEXT_PATTERNS.some(p => p.test(lower))) {
        flag = 'abnormal'
      }
    }
  } else if (valueType === 'semi_quantitative') {
    const normalized = strValue.toLowerCase()
    if (SEMI_QUANT_NORMAL.includes(normalized)) {
      flag = 'normal'
    } else {
      const upperValue = strValue.toUpperCase()
      if (SEMI_QUANT_ABNORMAL_ORDER.some(v => v === upperValue || v === strValue)) {
        const index = SEMI_QUANT_ABNORMAL_ORDER.findIndex(v => v === upperValue || v === strValue)
        flag = index >= 4 ? 'high' : 'abnormal'
      }
    }
  }

  // Convert to display string
  const displayMap: Record<string, string> = {
    'normal': '',
    'high': 'H',
    'low': 'L',
    'critical_high': 'H*',
    'critical_low': 'L*',
    'abnormal': 'A'
  }

  return { 
    flag, 
    displayFlag: flag ? (displayMap[flag] || '') : '' 
  }
}

// ============================================================
// SECTION: Analyte Placeholder Generation (Hardcoded Support)
// ============================================================

/**
 * Generate a short key from analyte name for placeholder purposes
 */
function generateAnalyteShortKey(name: string): string {
  if (!name) return '';
  
  // Common abbreviations mapping
  const abbreviations: Record<string, string> = {
    'C-Reactive Protein (CRP), Quantitative': 'CREACT',
    'C-Reactive Protein (CRP)': 'CREACT',
    'C-Reactive Protein': 'CRP',
    'Hemoglobin': 'HB',
    'Hb (Hemoglobin)': 'HB',
    'Hematocrit': 'HCT',
    'Total White Blood Cell Count': 'WBC',
    'Red Blood Cell Count': 'RBC',
    'Platelet Count': 'PLT',
    'Mean Corpuscular Volume': 'MCV',
    'Alanine Aminotransferase (ALT/SGPT)': 'ALT',
    'ALT (SGPT)': 'ALT',
  };
  
  if (abbreviations[name]) return abbreviations[name];
  
  // Check for abbreviations in parentheses
  const parenthesesMatch = name.match(/\(([A-Z]{2,})\)/);
  if (parenthesesMatch) return parenthesesMatch[1];
  
  // Generate from initials
  const cleaned = name.replace(/[^a-zA-Z0-9\s-]/g, '');
  const words = cleaned.split(/\s+/).filter(w => w.length > 0);
  
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].substring(0, Math.min(4, words[0].length)).toUpperCase();
  
  const initials = words.map(w => w[0]).join('').toUpperCase();
  if (initials.length < 3 && words[0].length > 1) {
    return (words[0].substring(0, 3) + initials.substring(1)).toUpperCase();
  }
  
  return initials;
}

/**
 * Generate individual analyte placeholders for hardcoded template support
 */
function generateAnalytePlaceholders(analytes: any[]): Record<string, any> {
  const placeholders: Record<string, any> = {};
  
  if (!analytes || analytes.length === 0) return placeholders;
  
  analytes.forEach((analyte) => {
    const shortKey = generateAnalyteShortKey(analyte.parameter || analyte.name || analyte.test_name || '');
    if (!shortKey) return;
    
    placeholders[`ANALYTE_${shortKey}_VALUE`] = analyte.value || '';
    placeholders[`ANALYTE_${shortKey}_UNIT`] = analyte.unit || '';
    placeholders[`ANALYTE_${shortKey}_REFERENCE`] = analyte.reference_range || '';
    placeholders[`ANALYTE_${shortKey}_FLAG`] = analyte.flag || '';
    placeholders[`ANALYTE_${shortKey}_DISPLAYFLAG`] = analyte.displayFlag || '';
  });
  
  console.log('📋 Generated analyte placeholders for keys:', Object.keys(placeholders).filter(k => k.endsWith('_VALUE')).map(k => k.replace('ANALYTE_', '').replace('_VALUE', '')));
  
  return placeholders;
}

// ============================================================
// SECTION: Template Rendering (Simple Nunjucks-like)
// ============================================================

/**
 * Simple template rendering with {{ variable }} placeholders
 * Handles nested objects like {{ patient.name }} and arrays
 */
function renderTemplate(html: string, context: Record<string, any>): string {
  if (!html) return ''
  
  let result = html
  
  // Replace {{ variable }} patterns
  result = result.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, key) => {
    const trimmedKey = key.trim()
    const value = getNestedValue(context, trimmedKey)
    
    if (value === undefined || value === null) {
      return '' // Empty string for missing values
    }
    
    if (typeof value === 'object') {
      return JSON.stringify(value)
    }
    
    return String(value)
  })
  
  return result
}

/**
 * Inject signature image into rendered HTML - ROBUST VERSION
 * Always injects into .signatures or .report-footer if present, never truncates content
 */
function injectSignatureImage(html: string, signatoryImageUrl: string, signatoryName: string = '', signatoryDesignation: string = ''): string {
  if (!html || !signatoryImageUrl) {
    console.log('  ⚠️ Missing required params for signature injection')
    return html
  }

  // Already present?
  if (html.includes(`src="${signatoryImageUrl}"`)) {
    console.log('  ✅ Signature image already present')
    return html
  }

  // Build complete signature block with image and text
  const signatureBlockHtml = `
    <div style="margin-top: 10px;">
      <img src="${signatoryImageUrl}" alt="Signature" style="display:block;max-height:40px;max-width:120px;width:auto;height:auto;object-fit:contain;margin-top:5px;margin-bottom:0px;" />
      ${signatoryName ? `<p style="margin-top:8px;margin-bottom:4px;font-weight:600;font-size:14px;">${signatoryName}</p>` : ''}
      ${signatoryDesignation ? `<p style="margin-top:0;color:#64748b;font-size:12px;">${signatoryDesignation}</p>` : ''}
    </div>
  `.trim()

  console.log(`  🔍 Looking for .signatures or .report-footer block (name: ${signatoryName})`)

  // 1. PRIORITY: Inject into .signatures block (most common)
  const signaturesPattern = /(<div[^>]*class="[^"]*signatures[^"]*"[^>]*>)/i
  if (signaturesPattern.test(html)) {
    console.log('  ✅ Found .signatures block - injecting signature')
    return html.replace(signaturesPattern, `$1${signatureBlockHtml}`)
  }

  // 2. Inject into .report-footer block
  const footerPattern = /(<div[^>]*class="[^"]*report-footer[^"]*"[^>]*>)/i
  if (footerPattern.test(html)) {
    console.log('  ✅ Found .report-footer block - injecting signature')
    return html.replace(footerPattern, `$1${signatureBlockHtml}`)
  }

  // 3. Look for any signatory/approver related classes
  const signatoryPattern = /(<div[^>]*class="[^"]*(?:signatory|signature-block|approver|signer)[^"]*"[^>]*>)/i
  if (signatoryPattern.test(html)) {
    console.log('  ✅ Found signatory-related block - injecting signature')
    return html.replace(signatoryPattern, `$1${signatureBlockHtml}`)
  }

  // 4. Fallback: inject before closing </section> with report-region--body class
  const sectionPattern = /(<\/section>)/i
  if (sectionPattern.test(html)) {
    console.log('  ⚠️ Fallback: injecting before </section>')
    return html.replace(sectionPattern, `<div style="margin-top:20px;">${signatureBlockHtml}</div>$1`)
  }

  // 5. Last resort: inject before closing </body>
  if (html.includes('</body>')) {
    console.log('  ⚠️ Last resort: injecting before </body>')
    return html.replace('</body>', `<div style="margin:20px;">${signatureBlockHtml}</div></body>`)
  }

  console.log('  ⚠️ Could not find suitable location for signature injection')
  console.log('  💡 Tip: Add class="signatures" or class="report-footer" to your signatory container')
  return html
}

/**
 * Get nested value from object using dot notation
 * e.g., getNestedValue({patient: {name: 'John'}}, 'patient.name') => 'John'
 */
function getNestedValue(obj: Record<string, any>, path: string): any {
  const keys = path.split('.')
  let current = obj
  
  for (const key of keys) {
    if (current === undefined || current === null) {
      return undefined
    }
    current = current[key]
  }
  
  return current
}

// ============================================================
// SECTION: HTML Document Builders
// ============================================================

/**
 * Generate dynamic CSS based on lab settings (colors, fonts, etc.)
 */
function generateDynamicCss(settings: any): string {
  if (!settings || (!settings.resultColors && !settings.headerTextColor)) return ''
  
  let css = '/* Dynamic PDF Settings */\n'
  
  // Header Text Color - target all possible header classes
  if (settings.headerTextColor && settings.headerTextColor !== 'inherit') {
    const color = settings.headerTextColor === 'white' ? '#ffffff' : settings.headerTextColor
    css += `
      /* Header text styling for white on dark backgrounds */
      .report-header, 
      .report-header *, 
      .report-header h1, 
      .report-header h2, 
      .report-header h3, 
      .report-header p,
      .report-header .report-subtitle,
      .report-header-title, 
      .report-title, 
      .header-content,
      .header-content h1,
      .header-content h2,
      .header-content h3,
      .header-dark h1, 
      .header-dark h2, 
      .header-dark h3,
      .header-dark p,
      [class*="report-header"] h1,
      [class*="report-header"] h2,
      [class*="report-header"] p,
      [class*="report-header"] div { 
        color: ${color} !important; 
      }
    `
  }
  
  // Result Colors
  if (settings.resultColors && settings.resultColors.enabled) {
    const { high, low, normal } = settings.resultColors
    if (high) {
      css += `.result-high, .flag-high, .result-critical_high, .result-critical-high, .result-H, .result-HH { color: ${high} !important; }\n`
      css += `.result-abnormal, .flag-abnormal, .result-A { color: ${high} !important; }\n`
    }
    if (low) {
      css += `.result-low, .flag-low, .result-critical_low, .result-critical-low, .result-L, .result-LL { color: ${low} !important; }\n`
    }
    if (normal) {
      css += `.result-normal, .flag-normal, .result-N { color: ${normal} !important; }\n`
    }
  }
  
  return css
}

/**
 * Build PDF body HTML document (main content)
 */
function buildPdfBodyDocument(bodyHtml: string, customCss: string): string {
  // 🎨 PDF.co compatibility: Expand CSS custom properties (variables) to literal values
  let normalizedCss = customCss
  if (customCss) {
    const cssVarMap = new Map<string, string>()
    
    // Extract :root variables
    const rootMatch = customCss.match(/:root\s*\{([^}]+)\}/)
    if (rootMatch) {
      const rootBlock = rootMatch[1]
      const varMatches = rootBlock.matchAll(/--([a-z-]+)\s*:\s*([^;]+);/g)
      for (const match of varMatches) {
        cssVarMap.set(`--${match[1]}`, match[2].trim())
      }
    }

    // Replace var() references with actual values
    if (cssVarMap.size > 0) {
      normalizedCss = customCss.replace(/var\(--([a-z-]+)\)/g, (_, varName) => {
        const value = cssVarMap.get(`--${varName}`)
        return value || `var(--${varName})` // fallback to original if not found
      })
      
      console.log('🎨 CSS Variables expanded for PDF.co:', {
        variableCount: cssVarMap.size,
        variables: Array.from(cssVarMap.keys()),
      })
    }
  }
  
  // 🐛 Debug CSS inclusion
  console.log('🎨 buildPdfBodyDocument CSS Debug:', {
    hasBaselineCss: !!BASELINE_CSS,
    baselineCssLength: BASELINE_CSS?.length || 0,
    hasCustomCss: !!normalizedCss,
    customCssLength: normalizedCss?.length || 0,
    customCssPreview: normalizedCss?.substring(0, 100) || 'NONE',
  })
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<!-- Load Google Fonts for Indian Languages -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;700&family=Noto+Sans+Bengali:wght@400;700&family=Noto+Sans+Devanagari:wght@400;700&family=Noto+Sans+Gujarati:wght@400;700&family=Noto+Sans+Gurmukhi:wght@400;700&family=Noto+Sans+Kannada:wght@400;700&family=Noto+Sans+Malayalam:wght@400;700&family=Noto+Sans+Oriya:wght@400;700&family=Noto+Sans+Tamil:wght@400;700&family=Noto+Sans+Telugu:wght@400;700&display=swap" rel="stylesheet">
<style id="lims-report-baseline">${BASELINE_CSS}</style>
${normalizedCss ? `<style id="lims-report-custom">${normalizedCss}</style>` : ''}
</head>
<body>
<div class="limsv2-report">
<main class="limsv2-report-body limsv2-report-body--pdf">${bodyHtml || '<p></p>'}</main>
</div>
</body>
</html>`
}

/**
 * Apply styling to flag values AND result values in rendered HTML
 * - Wraps flag text (high, low, H, L, etc.) in styled spans
 * - Also colors the result value in the same table row
 */
function applyFlagStyling(html: string, settings?: any): string {
  if (!html) return html
  
  // Get colors from settings or use defaults
  const highColor = settings?.resultColors?.high || '#dc2626'
  const lowColor = settings?.resultColors?.low || '#ea580c'
  const normalColor = settings?.resultColors?.normal || '#16a34a'
  const enabled = settings?.resultColors?.enabled !== false // Default to enabled
  
  if (!enabled) return html
  
  let styledHtml = html
  
  // Step 1: Process each table row to color both value and flag
  // Match table rows: <tr>...</tr>
  styledHtml = styledHtml.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (trMatch) => {
    // Check if this row contains a high/low/abnormal flag
    const hasHighFlag = /\b(high|H|HH|H\*|critical[_\s-]?high|abnormal)\b/i.test(trMatch)
    const hasLowFlag = /\b(low|L|LL|L\*|critical[_\s-]?low)\b/i.test(trMatch)
    
    // Skip if no flags - but still process individual flag text
    if (!hasHighFlag && !hasLowFlag) {
      return trMatch
    }
    
    // Determine color based on flag type (high takes priority)
    const flagColor = hasHighFlag ? highColor : lowColor
    const flagClass = hasHighFlag ? 'result-high' : 'result-low'
    
    let processedRow = trMatch
    
    // Step 2: Find and color the result value cell (usually 2nd td or td with 'value' class)
    // Pattern: td cell containing just a number (with optional decimal)
    const tdCells = processedRow.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []
    
    for (let i = 0; i < tdCells.length; i++) {
      const cell = tdCells[i]
      
      // Check if this cell contains a numeric value (the result)
      // Look for cells that have 'value' or 'result' in class, or are the 2nd cell (index 1)
      const isValueCell = /class="[^"]*(?:value|result|col-center)[^"]*"/.test(cell) && 
                         /^[\s]*[\d.]+[\s]*$/.test(cell.replace(/<[^>]+>/g, '').trim()) ||
                         (i === 1 && /^[\s]*[\d.]+[\s]*$/.test(cell.replace(/<[^>]+>/g, '').trim()))
      
      if (isValueCell) {
        // Extract the numeric value and wrap it in a styled span
        const coloredCell = cell.replace(
          />(\s*)([\d.]+)(\s*)</,
          `><span class="${flagClass}" style="color: ${flagColor}; font-weight: bold;">$2</span><`
        )
        processedRow = processedRow.replace(cell, coloredCell)
      }
      
      // Also color the flag cell
      const isFlagCell = cell.replace(/<[^>]+>/g, '').trim().match(/^(high|low|H|L|HH|LL|H\*|L\*|abnormal|normal|N)$/i)
      if (isFlagCell) {
        const flagText = isFlagCell[0]
        const coloredFlagCell = cell.replace(
          new RegExp(`>(\\s*)(${flagText})(\\s*)<`, 'i'),
          `><span class="${flagClass}" style="color: ${flagColor}; font-weight: bold;">$2</span><`
        )
        processedRow = processedRow.replace(cell, coloredFlagCell)
      }
    }
    
    return processedRow
  })
  
  console.log('🎨 Applied flag styling to HTML (values and flags)')
  return styledHtml
}

/**
 * Apply header text color inline styles for PDF.co compatibility
 * This directly adds inline style="color: #fff" to h1/h2/div elements in report headers
 */
function applyHeaderTextColor(html: string, settings?: any): string {
  if (!html) return html
  
  const headerColor = settings?.headerTextColor
  if (!headerColor || headerColor === 'inherit') return html
  
  const color = headerColor === 'white' ? '#ffffff' : headerColor
  
  let styledHtml = html
  
  // Strategy: Find the report-header section and identify h1/h2/divs inside it
  // Then add inline color styles
  
  // Check if we have a report-header class in the HTML
  if (!styledHtml.includes('report-header')) {
    console.log('⚠️ No report-header found in HTML, skipping header text color')
    return styledHtml
  }
  
  // Approach: Process the HTML to add inline color to elements within report-header
  // We'll look for the pattern of header section and add styles
  
  // Pattern 1: Find <div class="report-header..."> and add color to children
  // Use a state machine approach to track when we're inside report-header
  
  let insideReportHeader = false
  let depth = 0
  let i = 0
  let result = ''
  
  while (i < styledHtml.length) {
    // Check for opening div with report-header class
    const divMatch = styledHtml.slice(i).match(/^<div[^>]*class="[^"]*report-header[^"]*"[^>]*>/i)
    if (divMatch) {
      insideReportHeader = true
      depth = 1
      result += divMatch[0]
      i += divMatch[0].length
      continue
    }
    
    // Track depth when inside report-header
    if (insideReportHeader) {
      const openDivMatch = styledHtml.slice(i).match(/^<div[^>]*>/i)
      if (openDivMatch) {
        depth++
        result += openDivMatch[0]
        i += openDivMatch[0].length
        continue
      }
      
      const closeDivMatch = styledHtml.slice(i).match(/^<\/div>/i)
      if (closeDivMatch) {
        depth--
        if (depth === 0) {
          insideReportHeader = false
        }
        result += closeDivMatch[0]
        i += closeDivMatch[0].length
        continue
      }
      
      // Add color to h1 inside report-header
      const h1Match = styledHtml.slice(i).match(/^<h1([^>]*)>/i)
      if (h1Match) {
        const attrs = h1Match[1]
        if (attrs.includes('style=')) {
          // Append color to existing style
          const newTag = h1Match[0].replace(/style="([^"]*)"/i, `style="$1; color: ${color} !important;"`)
          result += newTag
        } else {
          // Add new style attribute
          result += `<h1${attrs} style="color: ${color};">`
        }
        i += h1Match[0].length
        continue
      }
      
      // Add color to h2 inside report-header
      const h2Match = styledHtml.slice(i).match(/^<h2([^>]*)>/i)
      if (h2Match) {
        const attrs = h2Match[1]
        if (attrs.includes('style=')) {
          const newTag = h2Match[0].replace(/style="([^"]*)"/i, `style="$1; color: ${color} !important;"`)
          result += newTag
        } else {
          result += `<h2${attrs} style="color: ${color};">`
        }
        i += h2Match[0].length
        continue
      }
      
      // Add color to div with report-subtitle class
      const subtitleMatch = styledHtml.slice(i).match(/^<div([^>]*class="[^"]*report-subtitle[^"]*"[^>]*)>/i)
      if (subtitleMatch) {
        const attrs = subtitleMatch[1]
        if (attrs.includes('style=')) {
          const newTag = subtitleMatch[0].replace(/style="([^"]*)"/i, `style="$1; color: ${color} !important;"`)
          result += newTag
        } else {
          result += `<div${attrs} style="color: ${color};">`
        }
        i += subtitleMatch[0].length
        continue
      }
    }
    
    // Regular character - copy as-is
    result += styledHtml[i]
    i++
  }
  
  console.log('🎨 Applied header text color:', color)
  return result
}

/**
 * Add draft watermark to HTML
 */
function addDraftWatermark(html: string): string {
  const watermarkDiv = '<div class="draft-watermark">DRAFT</div>'
  return html.replace('</body>', `${watermarkDiv}</body>`)
}

// ============================================================
// SECTION: Image Processing
// ============================================================

/**
 * Convert image URLs in HTML to base64 for PDF.co
 */
async function convertHtmlImagesToBase64(html: string): Promise<string> {
  if (!html || html.trim().length === 0) return ''
  
  const imgRegex = /<img([^>]*src=['"]([^'"]+)['"][^>]*)>/gi
  const matches = [...html.matchAll(imgRegex)]
  
  let convertedHtml = html
  
  for (const match of matches) {
    const fullImgTag = match[0]
    const imageUrl = match[2]
    
    // Skip if already base64
    if (imageUrl.startsWith('data:')) continue
    
    try {
      const base64Src = await convertImageUrlToBase64(imageUrl)
      if (base64Src) {
        const newImgTag = fullImgTag.replace(imageUrl, base64Src)
        convertedHtml = convertedHtml.replace(fullImgTag, newImgTag)
        console.log(`✅ Converted image to base64: ${imageUrl.substring(0, 50)}...`)
      }
    } catch (error) {
      console.warn(`⚠️ Failed to convert image ${imageUrl}:`, error)
    }
  }
  
  return convertedHtml
}

/**
 * Fetch image URL and convert to base64 data URL
 */
async function convertImageUrlToBase64(imageUrl: string): Promise<string> {
  try {
    // Strip ImageKit transformations for base64 conversion
    // ImageKit transformations like /tr:w-800,h-600/ can cause issues with base64
    let cleanUrl = imageUrl
    if (imageUrl.includes('ik.imagekit.io') && imageUrl.includes('/tr:')) {
      // Remove transformation parameters: /tr:w-800,h-600/ -> /
      cleanUrl = imageUrl.replace(/\/tr:[^/]+\//, '/')
      console.log(`  🔧 Stripped ImageKit transforms: ${imageUrl} -> ${cleanUrl}`)
    }
    // 1. Parse request body
    const { 
      record, 
      old_record, 
      type, 
      orderId: requestOrderId,
      htmlOverride, // NEW: For Manual Design Studio
      isManualDesign // NEW: Flag
    } = await req.json()
    
    // Determine Order ID
    const orderId = requestOrderId || record?.id
    
    if (!orderId) {
      throw new Error('No order_id provided in request body or record')
    }

    console.log(`\n📄 GENERATING PDF for Order: ${orderId} ${isManualDesign ? '(MANUAL DESIGN MODE)' : '(AUTO MODE)'}`)
    
    // ========================================
    // MANUAL MODE: Bypass Template Logic
    // ========================================
    if (isManualDesign && htmlOverride) {
       console.log('🎨 Manual Design detected. Bypassing template generation.')
       console.log('📝 HTML Content Length:', htmlOverride.length)

       // Validate HTML slightly
       if (!htmlOverride.includes('<!DOCTYPE html>')) {
           console.warn('⚠️ Manual HTML missing DOCTYPE, might cause issues.')
       }

       // Prepare filename
       const filename = `Report_${orderId}_${new Date().getTime()}.pdf`

       // Send directly to PDF.co
       const pdfUrl = await sendHtmlToPdfCo(
          htmlOverride,
          filename,
          PDFCO_API_KEY,
          {
             // For manual design, we assume the HTML is fully formed (A4 sized divs)
             // So we disable margins and headers/footers in PDF.co to let HTML control layout
             margins: '0px 0px 0px 0px', 
             paperSize: 'A4',
             printBackground: true,
             displayHeaderFooter: false 
          }
       )
       
       console.log('✅ PDF generated successfully via Manual Mode:', pdfUrl)

       // Upload to Storage
        const { publicUrl } = await uploadPdfToStorage(
            supabaseClient,
            pdfUrl,
            orderId,
            undefined, // lab_id not strictly needed for path construction if simplified
            'manual_patient',
            filename,
            'final'
        )

        // Update Database (Basic)
        // We might not have all patient details here if we didn't fetch them, 
        // but typically the frontend triggers this AFTER saving the order, so updates strictly to 'reports' table
        // might be needed. For now, just return the URL.
        
        return new Response(
            JSON.stringify({
                success: true,
                pdfUrl: publicUrl,
                status: 'completed'
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

    // ========================================
    // AUTO MODE: Original Logic
    // ========================================
    
    // Initialize job tracking
    job = await createJob(supabaseClient, orderId)
    console.log('✅ Job created:', job.id)
    
    const response = await fetch(cleanUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`)
    }
    
    const arrayBuffer = await response.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    
    // Convert to base64
    let binary = ''
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i])
    }
    const base64 = btoa(binary)
    
    // Detect content type
    const contentType = response.headers.get('content-type') || 'image/png'
    return `data:${contentType};base64,${base64}`
  } catch (error) {
    console.warn('Failed to convert image to base64:', error)
    return ''
  }
}

// ============================================================
// SECTION: PDF.co API Integration
// ============================================================

/**
 * Poll PDF.co async job until completion
 */
async function pollPdfCoJob(jobId: string, apiKey: string, maxAttempts = 60): Promise<string> {
  const pollInterval = 2000 // 2 seconds
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`📊 Polling PDF.co job ${jobId} (attempt ${attempt}/${maxAttempts})...`)
    
    const response = await fetch(`${PDFCO_JOB_STATUS_URL}?jobid=${jobId}`, {
      headers: { 'x-api-key': apiKey }
    })
    
    if (!response.ok) {
      throw new Error(`PDF.co job status check failed: ${response.status}`)
    }
    
    const result = await response.json()
    
    if (result.status === 'success' && result.url) {
      console.log('✅ PDF.co job completed:', result.url)
      return result.url
    }
    
    if (result.status === 'error') {
      throw new Error(`PDF.co job failed: ${result.message}`)
    }
    
    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollInterval))
  }
  
  throw new Error('PDF.co job polling timed out')
}

/**
 * Send HTML to PDF.co API and get PDF URL
 */
async function sendHtmlToPdfCo(
  html: string,
  filename: string,
  apiKey: string,
  options: {
    headerHtml?: string
    footerHtml?: string
    margins?: string
    headerHeight?: string
    footerHeight?: string
    scale?: number
    displayHeaderFooter?: boolean
    paperSize?: string
    mediaType?: string
    printBackground?: boolean
    grayscale?: boolean  // Convert to black & white for print versions
  } = {}
): Promise<string> {
  console.log('📤 Sending HTML to PDF.co API...')
  console.log('  Filename:', filename)
  console.log('  HTML length:', html.length)
  console.log('  Header length:', options.headerHtml?.length || 0)
  console.log('  Footer length:', options.footerHtml?.length || 0)
  
  const payload: Record<string, any> = {
    name: filename,
    html: html,
    async: true, // Use async for large documents
    margins: options.margins || DEFAULT_PDF_SETTINGS.margins,
    paperSize: options.paperSize || DEFAULT_PDF_SETTINGS.paperSize,
    displayHeaderFooter: options.displayHeaderFooter ?? DEFAULT_PDF_SETTINGS.displayHeaderFooter,
    header: options.headerHtml || '',
    footer: options.footerHtml || '',
    headerHeight: options.headerHeight || DEFAULT_PDF_SETTINGS.headerHeight,
    footerHeight: options.footerHeight || DEFAULT_PDF_SETTINGS.footerHeight,
    scale: options.scale ?? DEFAULT_PDF_SETTINGS.scale,
    mediaType: options.mediaType || DEFAULT_PDF_SETTINGS.mediaType,
    printBackground: options.printBackground ?? DEFAULT_PDF_SETTINGS.printBackground
  }
  
  // Add grayscale filter for print versions (converts colors to B&W)
  // PDF.co expects profiles as a JSON string with specific format
  if (options.grayscale) {
    // Use CSS filter instead since PDF.co profiles format is complex
    // We'll inject grayscale CSS into the HTML instead
    console.log('  🖨️ Grayscale mode requested - will apply via CSS filter')
  }
  
  const response = await fetch(PDFCO_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey
    },
    body: JSON.stringify(payload)
  })
  
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`PDF.co API error: ${response.status} ${response.statusText} - ${errorText}`)
  }
  
  const result = await response.json()
  
  if (result.error) {
    throw new Error(`PDF.co API error: ${result.message}`)
  }
  
  // Handle synchronous response
  if (result.url) {
    console.log('✅ PDF generated synchronously:', result.url)
    return result.url
  }
  
  // Handle async response (poll for completion)
  if (result.jobId) {
    console.log('📋 PDF.co async job queued:', result.jobId)
    return pollPdfCoJob(result.jobId, apiKey)
  }
  
  throw new Error('PDF.co API did not return a result URL or jobId')
}

// ============================================================
// SECTION: Section Content Injection (PBS/Radiology findings, impressions)
// ============================================================

/**
 * Fetch section content for a result and return as a map of placeholder_key -> final_content
 */
async function fetchSectionContent(
  supabaseClient: any,
  resultIds: string[]
): Promise<Record<string, string>> {
  if (!resultIds || resultIds.length === 0) return {}
  
  try {
    const { data, error } = await supabaseClient
      .from('result_section_content')
      .select(`
        final_content,
        lab_template_sections!inner(
          placeholder_key
        )
      `)
      .in('result_id', resultIds)
      .not('lab_template_sections.placeholder_key', 'is', null)
    
    if (error || !data) {
      console.warn('Failed to fetch section content:', error?.message)
      return {}
    }
    
    // Build map of placeholder_key -> final_content
    const sectionMap: Record<string, string> = {}
    for (const item of data) {
      const key = item.lab_template_sections?.placeholder_key
      if (key && item.final_content) {
        sectionMap[key] = item.final_content
      }
    }
    
    return sectionMap
  } catch (err) {
    console.warn('Error fetching section content:', err)
    return {}
  }
}

/**
 * Inject section content into HTML by replacing placeholders
 * Supports {{section:key}}, {{key}}, and {{section:key}} stored as placeholder_key
 */
function normalizeSectionKey(key: string): { rawKey: string; originalKey: string } {
  const trimmed = (key || '').trim()
  if (!trimmed) {
    return { rawKey: '', originalKey: '' }
  }
  if (trimmed.toLowerCase().startsWith('section:')) {
    return { rawKey: trimmed.slice(8), originalKey: trimmed }
  }
  return { rawKey: trimmed, originalKey: trimmed }
}

function injectSectionContent(html: string, sectionContent: Record<string, string>): string {
  if (!html || Object.keys(sectionContent).length === 0) return html
  
  let resultHtml = html
  for (const [key, content] of Object.entries(sectionContent)) {
    if (!content) continue

    const { rawKey, originalKey } = normalizeSectionKey(key)
    if (!rawKey) continue

    const prefixedPlaceholder = `{{section:${rawKey}}}`
    const simplePlaceholder = `{{${rawKey}}}`
    const originalPlaceholder = originalKey.startsWith('section:') ? `{{${originalKey}}}` : null
    
    // Preserve basic formatting: convert newlines to proper HTML paragraphs/breaks
    // Content comes from doctor input (CKEditor), preserve formatting
    const formattedContent = content
      .trim()
      .split(/\n\n+/)  // Split on double newlines (paragraph breaks)
      .map(para => {
        const cleanPara = para.trim()
        if (!cleanPara) return ''
        // Convert single newlines to <br/> within paragraphs
        const withBreaks = cleanPara.replace(/\n/g, '<br/>')
        return `<p>${withBreaks}</p>`
      })
      .filter(Boolean)
      .join('')
    
    const wrappedContent = `<div class="section-content">${formattedContent}</div>`
    
    const prefixedRegex = new RegExp(prefixedPlaceholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    const simpleRegex = new RegExp(simplePlaceholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    resultHtml = resultHtml.replace(prefixedRegex, wrappedContent)
    resultHtml = resultHtml.replace(simpleRegex, wrappedContent)

    if (originalPlaceholder) {
      const originalRegex = new RegExp(originalPlaceholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      resultHtml = resultHtml.replace(originalRegex, wrappedContent)
    }
  }
  
  console.log(`📝 Injected ${Object.keys(sectionContent).length} section(s):`, Object.keys(sectionContent))
  return resultHtml
}

// ============================================================
// SECTION: Report Extras (Trend Charts, Clinical Summary)
// ============================================================

/**
 * Generate watermark HTML
 */
function generateWatermarkHtml(settings: {
  enabled: boolean
  imageUrl: string
  opacity: number
  position: string
  size: string
  rotation: number
}): string {
  if (!settings.enabled || !settings.imageUrl) return ''
  
  const positionStyles: Record<string, string> = {
    'center': 'top: 50%; left: 50%; transform: translate(-50%, -50%)',
    'top-left': 'top: 10%; left: 10%',
    'top-right': 'top: 10%; right: 10%',
    'bottom-left': 'bottom: 10%; left: 10%',
    'bottom-right': 'bottom: 10%; right: 10%',
  }
  
  const position = positionStyles[settings.position] || positionStyles['center']
  const rotation = settings.rotation ? `rotate(${settings.rotation}deg)` : ''
  const transform = position.includes('translate') 
    ? position.replace(')', ` ${rotation})`)
    : `${position}; transform: ${rotation}`
  
  return `
    <div class="report-watermark" style="
      position: absolute !important;
      ${transform};
      z-index: 1 !important;
      opacity: ${settings.opacity} !important;
      pointer-events: none !important;
      max-width: ${settings.size} !important;
      height: auto !important;
    ">
      <img src="${settings.imageUrl}" alt="watermark" style="width: 100%; height: auto;" />
    </div>
  `
}

/**
 * Format clinical summary text with proper HTML structure
 * Parses structured text with sections, bullets, and formatting
 */
function formatClinicalSummary(text: string): string {
  if (!text) return ''
  
  let html = text
  
  // Convert **Section Headers** to bold with proper styling
  html = html.replace(/\*\*([^*]+)\*\*/g, '<div style="font-weight: bold; color: #1e40af; margin-top: 15px; margin-bottom: 8px; font-size: 14px;">$1</div>')
  
  // Convert bullet points • to proper HTML lists
  const lines = html.split('\n')
  let inList = false
  const processedLines: string[] = []
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    
    if (line.startsWith('•')) {
      if (!inList) {
        processedLines.push('<ul style="margin: 8px 0; padding-left: 20px; list-style-type: disc;">')
        inList = true
      }
      const content = line.substring(1).trim()
      processedLines.push(`<li style="margin: 4px 0; color: #374151;">${content}</li>`)
    } else {
      if (inList) {
        processedLines.push('</ul>')
        inList = false
      }
      if (line) {
        // Check if it's a section header (already converted to div above)
        if (!line.includes('<div style="font-weight: bold')) {
          processedLines.push(`<p style="margin: 8px 0; color: #374151;">${line}</p>`)
        } else {
          processedLines.push(line)
        }
      }
    }
  }
  
  if (inList) {
    processedLines.push('</ul>')
  }
  
  return processedLines.join('\n')
}

/**
 * Generate HTML for report extras (trend charts, clinical summary, AI summaries, patient summary)
 */
function generateReportExtrasHtml(extras: {
  trend_charts?: any[]
  clinical_summary?: string
  trend_graph_data?: any
  ai_clinical_summary?: string
  ai_patient_summary?: string
  patient_summary_language?: string
  ai_doctor_summary?: string
  include_trend_graphs?: boolean
  results_extras?: any[]
}): string {
  if (!extras) return ''
  
  let html = ''
  
  // Trend charts from report_extras table
  if (extras.trend_charts && extras.trend_charts.length > 0) {
    html += '<div class="report-extras-trends" style="margin-top: 20px; page-break-inside: avoid;">'
    html += '<h3 style="margin-bottom: 10px;">Historical Trends</h3>'
    
    for (const chart of extras.trend_charts) {
      if (chart.image_base64) {
        html += `<div class="trend-chart" style="margin: 10px 0;">`
        html += `<img src="${chart.image_base64}" alt="${chart.analyte_name || 'Trend'}" style="max-width: 100%; height: auto;" />`
        if (chart.analyte_name) {
          html += `<p style="font-size: 11px; text-align: center; margin-top: 5px;">${chart.analyte_name}</p>`
        }
        html += `</div>`
      }
    }
    
    html += '</div>'
  }
  
  // Trend graph data from orders table (if include_trend_graphs is true)
  if (extras.include_trend_graphs !== false && extras.trend_graph_data) {
    const trendData = extras.trend_graph_data
    if (trendData.image_base64 || trendData.svg) {
      html += '<div class="report-trend-graph" style="margin-top: 20px; page-break-inside: avoid;">'
      html += '<h3 style="margin-bottom: 10px;">Trend Analysis</h3>'
      if (trendData.image_base64) {
        html += `<img src="${trendData.image_base64}" alt="Trend Graph" style="max-width: 100%; height: auto;" />`
      } else if (trendData.svg) {
        html += trendData.svg
      }
      html += '</div>'
    }
    
    // Analyzer graphs from machine interface (stored in trend_graph_data.analyzer_graphs)
    if (trendData.analyzer_graphs) {
      const analyzerData = trendData.analyzer_graphs;
      
      // Render stored images (histograms, scatter plots, etc.)
      if (analyzerData.images && analyzerData.images.length > 0) {
        html += '<div class="analyzer-graphs-section" style="margin-top: 25px; page-break-inside: avoid;">'
        html += '<h3 style="margin-bottom: 15px; color: #1e40af; border-bottom: 2px solid #3b82f6; padding-bottom: 8px;">Analyzer Graphs</h3>'
        
        html += '<div style="display: flex; flex-wrap: wrap; gap: 15px; justify-content: center;">'
        for (const img of analyzerData.images) {
          html += `<div style="text-align: center; max-width: 45%;">`
          html += `<img src="${img.url}" alt="${img.name}" style="max-width: 100%; height: auto; border: 1px solid #e5e7eb; border-radius: 4px;" />`
          html += `<p style="margin-top: 5px; font-size: 11px; color: #6b7280;">${img.name}</p>`
          html += `</div>`
        }
        html += '</div>'
        
        // AI analysis of the graphs
        if (analyzerData.ai_analysis && analyzerData.ai_analysis.length > 0) {
          html += '<div style="margin-top: 15px; padding: 12px; background: #f0f9ff; border-radius: 6px; border-left: 4px solid #3b82f6;">'
          html += '<p style="margin: 0 0 8px 0; font-weight: bold; color: #1e40af; font-size: 12px;">AI Graph Analysis:</p>'
          for (const analysis of analyzerData.ai_analysis) {
            if (analysis.description) {
              html += `<p style="margin: 4px 0; font-size: 11px; color: #374151;">• <strong>${analysis.name || analysis.type}:</strong> ${analysis.description}</p>`
            }
          }
          html += '</div>'
        }
        
        if (analyzerData.instrument) {
          html += `<p style="margin-top: 10px; font-size: 10px; color: #9ca3af; text-align: right;">Source: ${analyzerData.instrument}</p>`
        }
        
        html += '</div>'
      }
    }
  }
  
  // Clinical summary from report_extras table
  if (extras.clinical_summary) {
    // Format clinical summary with proper HTML structure
    const formattedSummary = formatClinicalSummary(extras.clinical_summary)
    html += '<div class="report-extras-summary clinical-summary-section" style="margin-top: 30px; page-break-inside: avoid; border: 2px solid #3b82f6; border-radius: 8px; padding: 20px; background: #eff6ff;">'
    html += '<h2 class="clinical-summary-title" style="margin: 0 0 15px 0; color: #1e40af; font-size: 18px; font-weight: bold; text-align: center; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">AI Clinical Interpretation</h2>'
    html += `<div class="clinical-summary-content" style="font-size: 13px; line-height: 1.6; color: #1f2937;">${formattedSummary}</div>`
    html += '</div>'
  }
  
  // AI Clinical Summary from orders table
  if (extras.ai_clinical_summary) {
    const formattedAiSummary = formatClinicalSummary(extras.ai_clinical_summary)
    html += '<div class="report-ai-summary" style="margin-top: 30px; page-break-inside: avoid; border: 2px solid #3b82f6; border-radius: 8px; padding: 20px; background: #eff6ff;">'
    html += '<h2 style="margin: 0 0 15px 0; color: #1e40af; font-size: 18px; font-weight: bold; text-align: center; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">AI Clinical Interpretation</h2>'
    html += `<div style="font-size: 13px; line-height: 1.6; color: #1f2937;">${formattedAiSummary}</div>`
    html += '</div>'
  }
  
  // AI Doctor Summary from reports table
  if (extras.ai_doctor_summary) {
    html += '<div class="report-doctor-summary" style="margin-top: 20px; page-break-inside: avoid;">'
    html += '<h3 style="margin-bottom: 10px;">Doctor\'s Summary</h3>'
    html += `<div style="padding: 10px; background: #f9fafb; border-radius: 4px;">${extras.ai_doctor_summary}</div>`
    html += '</div>'
  }
  
  // AI Patient Summary from orders table (patient-friendly explanation)
  if (extras.ai_patient_summary) {
    try {
      const patientSummary = typeof extras.ai_patient_summary === 'string' 
        ? JSON.parse(extras.ai_patient_summary) 
        : extras.ai_patient_summary
      
      const languageLabel = extras.patient_summary_language 
        ? ` (${extras.patient_summary_language.charAt(0).toUpperCase() + extras.patient_summary_language.slice(1)})`
        : ''
      
      html += '<div class="report-patient-summary" style="margin-top: 30px; page-break-inside: avoid; border: 2px solid #db2777; border-radius: 8px; padding: 20px; background: #fdf2f8;">'
      html += `<h2 style="margin: 0 0 15px 0; color: #be185d; font-size: 18px; font-weight: bold; text-align: center; border-bottom: 2px solid #db2777; padding-bottom: 10px;">Your Results Summary${languageLabel}</h2>`
      
      // Health Status
      if (patientSummary.health_status) {
        html += '<div style="margin-bottom: 15px;">'
        html += '<h3 style="margin: 0 0 8px 0; color: #be185d; font-size: 14px; font-weight: bold;">Overall Health Status</h3>'
        html += `<p style="margin: 0; font-size: 13px; line-height: 1.5; color: #1f2937;">${patientSummary.health_status}</p>`
        html += '</div>'
      }
      
      // Normal Findings
      if (patientSummary.normal_findings && patientSummary.normal_findings.length > 0) {
        html += '<div style="margin-bottom: 15px;">'
        html += '<h3 style="margin: 0 0 8px 0; color: #16a34a; font-size: 14px; font-weight: bold;">✓ Normal Findings</h3>'
        html += '<ul style="margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.6; color: #1f2937;">'
        for (const finding of patientSummary.normal_findings) {
          html += `<li>${finding}</li>`
        }
        html += '</ul></div>'
      }
      
      // Abnormal Findings
      if (patientSummary.abnormal_findings && patientSummary.abnormal_findings.length > 0) {
        html += '<div style="margin-bottom: 15px;">'
        html += '<h3 style="margin: 0 0 8px 0; color: #dc2626; font-size: 14px; font-weight: bold;">⚠ Areas Needing Attention</h3>'
        html += '<ul style="margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.6; color: #1f2937;">'
        for (const finding of patientSummary.abnormal_findings) {
          // Handle both string and object formats for abnormal findings
          // Object format may have: test_name, name, parameter, label for the test identifier
          const findingName = typeof finding === 'string' 
            ? finding 
            : (finding.test_name || finding.name || finding.parameter || finding.label || 'Finding')
          const explanation = typeof finding === 'string' ? '' : (finding.explanation || '')
          const text = explanation ? `${findingName}: ${explanation}` : findingName
          html += `<li>${text}</li>`
        }
        html += '</ul></div>'
      }
      
      // Consultation Recommendation
      if (patientSummary.consultation_recommendation) {
        html += '<div style="margin-bottom: 15px; background: #fef2f2; padding: 12px; border-radius: 6px; border-left: 4px solid #dc2626;">'
        html += '<h3 style="margin: 0 0 8px 0; color: #dc2626; font-size: 14px; font-weight: bold;">📋 Doctor Consultation</h3>'
        html += `<p style="margin: 0; font-size: 13px; line-height: 1.5; color: #1f2937;">${patientSummary.consultation_recommendation}</p>`
        html += '</div>'
      }
      
      // Health Tips
      if (patientSummary.health_tips && patientSummary.health_tips.length > 0) {
        html += '<div style="margin-bottom: 10px;">'
        html += '<h3 style="margin: 0 0 8px 0; color: #0891b2; font-size: 14px; font-weight: bold;">💡 Health Tips</h3>'
        html += '<ul style="margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.6; color: #1f2937;">'
        for (const tip of patientSummary.health_tips) {
          html += `<li>${tip}</li>`
        }
        html += '</ul></div>'
      }
      
      html += '<p style="font-size: 11px; color: #6b7280; text-align: center; margin: 15px 0 0 0; font-style: italic;">This summary is for your understanding. Please consult your doctor for medical advice.</p>'
      html += '</div>'
    } catch (e) {
      // If JSON parsing fails, render as plain text
      console.log('Patient summary parsing failed, rendering as text:', e)
      html += '<div class="report-patient-summary" style="margin-top: 30px; page-break-inside: avoid; border: 2px solid #db2777; border-radius: 8px; padding: 20px; background: #fdf2f8;">'
      html += '<h2 style="margin: 0 0 15px 0; color: #be185d; font-size: 18px; font-weight: bold; text-align: center; border-bottom: 2px solid #db2777; padding-bottom: 10px;">Your Results Summary</h2>'
      html += `<div style="font-size: 13px; line-height: 1.6; color: #1f2937;">${extras.ai_patient_summary}</div>`
      html += '</div>'
    }
  }
  
  return html
}

// ============================================================
// SECTION: Attachment Processing
// ============================================================

/**
 * Generate HTML for attachments included in report
 */
function generateAttachmentsHtml(attachments: any[]): string {
  if (!attachments || attachments.length === 0) return ''
  
  const includedAttachments = attachments.filter(a => a.tag === 'include_in_report')
  if (includedAttachments.length === 0) return ''
  
  let html = '<div class="report-attachments" style="margin-top: 20px; page-break-before: always;">'
  html += '<h3 style="margin-bottom: 10px;">Attachments</h3>'
  
  for (const attachment of includedAttachments) {
    const isImage = attachment.file_type?.startsWith('image/')
    
    // Prefer imagekit_url, fallback to file_url
    const imageUrl = attachment.imagekit_url || attachment.file_url
    
    if (isImage && imageUrl) {
      html += `<div class="attachment-item" style="margin: 10px 0; page-break-inside: avoid;">`
      html += `<img src="${imageUrl}" alt="${attachment.file_name || 'Attachment'}" style="max-width: 100%; height: auto;" />`
      if (attachment.file_name) {
        html += `<p style="font-size: 11px; text-align: center; margin-top: 5px;">${attachment.file_name}</p>`
      }
      html += `</div>`
    }
  }
  
  html += '</div>'
  return html
}

// ============================================================
// SECTION: Storage Operations
// ============================================================

type PdfVariant = 'final' | 'draft' | 'print'

/**
 * Download PDF from PDF.co URL and upload to Supabase Storage
 */
async function uploadPdfToStorage(
  supabase: any,
  pdfUrl: string,
  orderId: string,
  labId: string,
  patientId: string,
  filename: string,
  variant: PdfVariant = 'final',
  maxRetries: number = 3
): Promise<{ path: string; publicUrl: string }> {
  console.log('📥 Downloading PDF from PDF.co...')
  
  // Download PDF with retry logic
  let pdfBuffer: ArrayBuffer | null = null
  let lastError: Error | null = null
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`  📥 Download attempt ${attempt}/${maxRetries}...`)
      
      // Add timeout to prevent hanging connections
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout
      
      const pdfResponse = await fetch(pdfUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Supabase-Edge-Function/1.0',
          'Accept': 'application/pdf, */*',
        }
      })
      
      clearTimeout(timeoutId)
      
      if (!pdfResponse.ok) {
        throw new Error(`Failed to download PDF: ${pdfResponse.status}`)
      }
      
      pdfBuffer = await pdfResponse.arrayBuffer()
      console.log(`  ✅ Download successful: ${pdfBuffer.byteLength} bytes`)
      break // Success, exit retry loop
      
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      console.warn(`  ⚠️ Download attempt ${attempt} failed:`, lastError.message)
      
      if (attempt < maxRetries) {
        // Wait before retry with longer delays for PDF.co to finalize
        // PDF.co sometimes needs time to make files available
        const waitTime = variant === 'print' 
          ? Math.min(3000 * attempt, 10000) // Print: 3s, 6s, 9s, 12s (up to 10s max)
          : Math.min(1000 * Math.pow(2, attempt - 1), 5000) // Normal: exponential backoff
        console.log(`  ⏳ Waiting ${waitTime}ms before retry...`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
    }
  }
  
  if (!pdfBuffer) {
    if (pdfUrl) {
      console.warn(`⚠️ FINAL FALLBACK: Failed to download PDF after ${maxRetries} attempts but PDF.co URL exists. Using temporary URL.`);
      return {
        path: '',
        publicUrl: pdfUrl
      };
    }
    throw new Error(`Failed to download PDF after ${maxRetries} attempts: ${lastError?.message}`);
  }
  
  const pdfBlob = new Blob([pdfBuffer], { type: 'application/pdf' })
  
  // Generate storage path - use simple format like normal PDF flow
  // Normal flow uses: {orderId}_{timestamp}_{variant}.pdf in 'reports' bucket
  const timestamp = Date.now()
  const suffix = variant === 'final' ? '' : `_${variant}`
  const storageFileName = `${orderId}_${timestamp}${suffix}.pdf`
  
  console.log('📤 Uploading PDF to Supabase Storage (reports bucket):', storageFileName)
  
  // Upload to Supabase Storage - use 'reports' bucket like normal flow
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('reports')
    .upload(storageFileName, pdfBlob, {
      contentType: 'application/pdf',
      cacheControl: '3600',
      upsert: true  // Allow overwrite
    })
  
  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`)
  }
  
  // Get public URL (using custom domain if configured)
  const publicUrl = getPublicStorageUrl('reports', storageFileName);
  
  console.log('✅ PDF uploaded to storage:', publicUrl)
  console.log('📡 Using custom domain:', !!CUSTOM_REPORTS_DOMAIN)
  
  return {
    path: storageFileName,
    publicUrl
  }
}

// ============================================================
// SECTION: Main Edge Function
// ============================================================

serve(async (req) => {
  // Top-level try-catch to ensure CORS headers are ALWAYS returned
  try {
    console.log('📥 Incoming request:', req.method, req.url)
    
    if (req.method === 'OPTIONS') {
      console.log('📋 Handling OPTIONS preflight request')
      console.log('📋 CORS headers:', corsHeaders)
      return new Response(null, { 
        status: 200,
        headers: corsHeaders 
      })
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: { autoRefreshToken: false, persistSession: false }
      }
    )
    
    const PDFCO_API_KEY = Deno.env.get('PDFCO_API_KEY') ?? ''

    // Inner try-catch for main logic
    try {
      const { orderId, isDraft, htmlOverride, isManualDesign } = await req.json()

      console.log('═══════════════════════════════════════════════════════════')
      console.log('📄 PDF AUTO-GENERATION (SERVER-SIDE)')
      console.log('═══════════════════════════════════════════════════════════')
      console.log('Order ID:', orderId)
      console.log('Is Draft:', !!isDraft)
      console.log('Is Manual Design:', !!isManualDesign)
      console.log('PDF.co API Key:', PDFCO_API_KEY ? '✅ Present' : '❌ MISSING')

      if (!orderId) {
        return new Response(
          JSON.stringify({ error: 'orderId is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

    // ========================================
    // MANUAL MODE: Bypass Template Logic
    // ========================================
    if (isManualDesign && htmlOverride) {
       console.log('🎨 Manual Design detected. Bypassing template generation.')
       
       const filename = `Report_${orderId}_${new Date().getTime()}.pdf`

       // Send directly to PDF.co
       const pdfUrl = await sendHtmlToPdfCo(
          htmlOverride,
          filename,
          PDFCO_API_KEY,
          {
             margins: '0px 0px 0px 0px', 
             paperSize: 'A4',
             printBackground: true,
             displayHeaderFooter: false 
          }
       )
       
       console.log('✅ PDF generated successfully via Manual Mode:', pdfUrl)

       // Upload to Storage
        const { publicUrl } = await uploadPdfToStorage(
            supabaseClient,
            pdfUrl,
            orderId,
            undefined, // lab_id
            'manual_patient', // patient_id placeholder
            filename,
            'final'
        )
        
        return new Response(
            JSON.stringify({
                success: true,
                pdfUrl: publicUrl,
                status: 'completed'
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

    // ========================================
    // PRE-CHECK: Order Readiness (Panel Status)
    // ========================================
    if (!isDraft) {
        console.log('\n🔍 Pre-check: Verifying order readiness...');
        const { data: readinessData, error: readinessError } = await supabaseClient
            .from('v_result_panel_status')
            .select('panel_ready')
            .eq('order_id', orderId);
        
        if (readinessError) {
             console.warn('⚠️ Could not verify panel status (view might be missing), proceeding with caution:', readinessError.message);
        } else if (readinessData) {
             const isReady = readinessData.length > 0 && readinessData.every((r: any) => r.panel_ready);
             console.log(`  → Panel status: ${isReady ? '✅ READY' : '⏳ NOT READY'}`, readinessData);
             
             if (!isReady) {
                 console.log('⛔ Order is not ready for final report. Skipping auto-generation.');
                 
                 // If there's an existing queue item, update it to failed/skipped so it doesn't get stuck
                 await supabaseClient
                    .from('pdf_generation_queue')
                    .update({ 
                        status: 'failed', 
                        error_message: 'Skipped: Order panels not ready',
                        progress_stage: 'Skipped (Not Ready)',
                        updated_at: new Date().toISOString()
                    })
                    .eq('order_id', orderId);

                 return new Response(
                    JSON.stringify({ 
                        success: false, 
                        message: 'Order is not ready (panels incomplete). Pass isDraft=true to force.',
                        status: 'skipped'
                    }),
                    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                 );
             }
        }
    }
    
    if (!PDFCO_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'PDFCO_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ========================================
    // Step 1: Get or Create Job from Queue
    // ========================================
    console.log('\n📋 Step 1: Fetching/creating job in queue...')
    
    // First, try to get existing job
    let { data: job, error: jobError } = await supabaseClient
      .from('pdf_generation_queue')
      .select('*')
      .eq('order_id', orderId)
      .maybeSingle()

    // If no job exists, create one (for manual/direct Edge function calls)
    if (!job) {
      console.log('ℹ️ No queue entry found, fetching lab_id and creating entry...')
      
      // Get lab_id from the order
      const { data: orderData, error: orderError } = await supabaseClient
        .from('orders')
        .select('lab_id')
        .eq('id', orderId)
        .single()
      
      if (orderError || !orderData?.lab_id) {
        console.error('❌ Failed to fetch lab_id for order:', orderError?.message)
        return new Response(
          JSON.stringify({ error: 'Order not found or missing lab_id', details: orderError?.message }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      // Use upsert to handle race conditions (if trigger created entry simultaneously)
      const { data: upsertData, error: upsertError } = await supabaseClient
        .from('pdf_generation_queue')
        .upsert({
          order_id: orderId,
          lab_id: orderData.lab_id,
          status: 'pending',
          priority: 5,
          created_at: new Date().toISOString()
        }, {
          onConflict: 'order_id',
          ignoreDuplicates: false
        })
        .select()
        .single()
      
      if (upsertError) {
        console.error('❌ Failed to upsert queue entry:', upsertError?.message)
        return new Response(
          JSON.stringify({ error: 'Failed to create/update queue entry', details: upsertError?.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      job = upsertData
      console.log('✅ Created/updated queue entry:', job.id, 'for lab:', orderData.lab_id)
    }

    // If job exists but is completed, reset it to pending for regeneration
    if (job.status === 'completed') {
      console.log('♻️ Job already completed, checking if PDF still exists...')
      
      // Check if the PDF still exists in reports table
      const { data: existingReport, error: reportError } = await supabaseClient
        .from('reports')
        .select('id, ecopy_url, print_url, is_draft')
        .eq('order_id', orderId)
        .eq('is_draft', false)
        .maybeSingle()
      
      if (existingReport && existingReport.ecopy_url) {
        console.log('✅ Final PDF already exists in reports table, returning existing URL')
        return new Response(
          JSON.stringify({
            success: true,
            status: 'completed',
            pdfUrl: existingReport.ecopy_url,
            printPdfUrl: existingReport.print_url,
            message: 'PDF already exists',
            cached: true
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      // PDF doesn't exist, reset queue to regenerate
      console.log('⚠️ PDF missing from reports table, regenerating...')
      const { data: resetJob, error: resetError } = await supabaseClient
        .from('pdf_generation_queue')
        .update({
          status: 'pending',
          error_message: null,
          retry_count: 0,
          progress_stage: null,
          progress_percent: 0
        })
        .eq('id', job.id)
        .select()
        .single()
      
      if (resetError) {
        console.error('❌ Failed to reset job status:', resetError?.message)
      } else {
        job = resetJob
        console.log('✅ Job reset to pending')
      }
    }
    
    // Prevent duplicate processing - if already processing, return early
    if (job.status === 'processing') {
      console.log('⏳ Job already processing, skipping duplicate request')
      return new Response(
        JSON.stringify({ message: 'Already processing', status: 'processing', jobId: job.id }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    console.log('✅ Job found:', { id: job.id, status: job.status, labId: job.lab_id })

    // ========================================
    // Step 2: Mark as Processing (Atomic Update)
    // ========================================
    console.log('\n📝 Step 2: Marking job as processing...')
    
    // Use atomic update with status check to prevent race conditions
    const { data: updatedJob, error: updateError } = await supabaseClient
      .from('pdf_generation_queue')
      .update({ 
        status: 'processing', 
        started_at: new Date().toISOString(),
        progress_stage: 'Fetching report context...',
        progress_percent: 5 
      })
      .eq('id', job.id)
      .eq('status', 'pending')  // Only update if still pending
      .select()
      .single()
    
    // If update didn't find a pending job, another process got it first
    if (updateError || !updatedJob) {
      console.log('⏳ Job was claimed by another process, skipping')
      return new Response(
        JSON.stringify({ message: 'Job claimed by another process', status: 'skipped' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ========================================
    // Step 3: Get Template Context (RPC)
    // ========================================
    console.log('\n📊 Step 3: Fetching template context via RPC...')
    const { data: context, error: contextError } = await supabaseClient.rpc(
      'get_report_template_context',
      { p_order_id: orderId }
    )

    if (contextError || !context) {
      console.error('❌ Context fetch failed:', contextError?.message)
      await failJob(supabaseClient, job.id, `Context fetch failed: ${contextError?.message}`)
      return new Response(
        JSON.stringify({ error: 'Context fetch failed', details: contextError?.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    // RPC returns nested structure: context.patient.name, context.order.sampleId, etc.
    console.log('✅ Context fetched (full structure):', JSON.stringify(context, null, 2).substring(0, 2000))
    console.log('✅ Context summary:', {
      patientName: context.patient?.name || context.placeholderValues?.patientName,
      patientId: context.patientId,
      patientAge: context.patient?.age || context.placeholderValues?.age,
      patientGender: context.patient?.gender || context.placeholderValues?.gender,
      sampleId: context.order?.sampleId || context.placeholderValues?.sampleId,
      analytes: context.analytes?.length || 0,
      analytesWithValues: (context.analytes || []).filter((a: any) => a.value != null && a.value !== '').length,
      testGroupIds: context.testGroupIds || [],
      analyteNames: (context.analytes || []).slice(0, 3).map((a: any) => a.parameter || a.test_name || a.name || 'unknown')
    })
    
    // Validate that we have actual test results
    if (!context.analytes || context.analytes.length === 0) {
      console.error('❌ No analytes found in context')
      await failJob(supabaseClient, job.id, 'No test results found for this order')
      return new Response(
        JSON.stringify({ error: 'No test results found for this order' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    // Check if analytes have values
    const analytesWithValues = context.analytes.filter((a: any) => a.value != null && a.value !== '')
    if (analytesWithValues.length === 0) {
      console.warn('⚠️ WARNING: All analytes have empty values!')
    }
    
    await updateProgress(supabaseClient, job.id, 'Fetching lab template...', 15)

    // ========================================
    // Step 3b: Enhance Analytes with Flag Determination
    // ========================================
    console.log('\n🏷️ Step 3b: Enhancing analytes with flag determination...')
    const patientGender = context.patient?.gender || context.placeholderValues?.gender
    
    if (context.analytes && context.analytes.length > 0) {
      context.analytes = context.analytes.map((analyte: any) => {
        // If flag already exists and is valid, keep it
        if (analyte.flag && analyte.flag.trim()) {
          return analyte
        }
        
        // Determine flag using comprehensive system
        const { displayFlag, flag } = determineFlag(
          analyte.value,
          analyte.reference_range,
          analyte.low_critical,
          analyte.high_critical,
          patientGender,
          analyte.reference_range_male,
          analyte.reference_range_female,
          analyte.expected_normal_values
        )
        
        return {
          ...analyte,
          flag: displayFlag,
          flag_code: flag // Expose raw flag code (high, low, etc.) for CSS class generation
        }
      })
      
      const flaggedCount = context.analytes.filter((a: any) => a.flag && a.flag.trim()).length
      console.log(`✅ Flag determination complete: ${flaggedCount}/${context.analytes.length} analytes have flags`)
    }
    
    await updateProgress(supabaseClient, job.id, 'Fetching lab template...', 15)

    // ========================================
    // Step 4: Get Lab Template & Settings
    // ========================================
    console.log('\n🎨 Step 4: Fetching lab templates & settings...')
    
    // Get all templates for this lab
    const { data: allTemplates, error: templateError } = await supabaseClient
      .from('lab_templates')
      .select('*')
      .eq('lab_id', job.lab_id)
    
    const templatesWithHtml = (allTemplates || []).filter((tpl: any) => tpl?.gjs_html)
    
    console.log('📋 Available templates:', templatesWithHtml.map((t: any) => ({
      name: t.template_name,
      testGroupId: t.test_group_id || 'none',
      isDefault: t.is_default
    })))

    await updateProgress(supabaseClient, job.id, 'Fetching lab settings...', 25)

    // ========================================
    // Step 5: Get Lab Settings (Header/Footer/PDF Settings/Watermark)
    // ========================================
    console.log('\n⚙️ Step 5: Fetching lab settings...')
    const { data: labSettings } = await supabaseClient
      .from('labs')
      .select(`
        name,
        default_report_header_html, 
        default_report_footer_html, 
        pdf_layout_settings,
        watermark_enabled,
        watermark_image_url,
        watermark_opacity,
        watermark_position,
        watermark_size,
        watermark_rotation
      `)
      .eq('id', job.lab_id)
      .single()
    
    // FETCH DYNAMIC HEADERS/FOOTERS (Location/Account specific)
    console.log('  🔍 Checking for custom location/account headers...')
    const customHeader = await fetchHeaderFooter(supabaseClient, orderId, 'header')
    const customFooter = await fetchHeaderFooter(supabaseClient, orderId, 'footer')
    
    const headerHtml = customHeader || labSettings?.default_report_header_html || ''
    const footerHtml = customFooter || labSettings?.default_report_footer_html || ''
    
    if (customHeader) console.log('  ✅ Using custom header found via helper')
    if (customFooter) console.log('  ✅ Using custom footer found via helper')
    
    const pdfSettings = labSettings?.pdf_layout_settings || {}
    
    // Watermark settings
    const watermarkSettings = {
      enabled: labSettings?.watermark_enabled || false,
      imageUrl: labSettings?.watermark_image_url || '',
      opacity: labSettings?.watermark_opacity ?? 0.15,
      position: labSettings?.watermark_position || 'center',
      size: labSettings?.watermark_size || '80%',
      rotation: labSettings?.watermark_rotation ?? 0
    }
    
    // ========================================
    // Step 5b: Get Signatory Info (Approver fallback to Lab Default)
    // ========================================
    console.log('\n✍️ Step 5b: Fetching signatory information...')
    
    interface SignatoryInfo {
      signatoryName: string;
      signatoryDesignation: string;
      signatoryImageUrl: string;
    }
    
    // Helper to apply ImageKit transformations for signatures
    // Adds focus:auto and e-removebg for clean signature rendering
    const applySignatureTransformations = (url: string): string => {
      if (!url) return ''
      // If it's an ImageKit URL, add transformations
      if (url.includes('ik.imagekit.io')) {
        // Parse the URL and add transformations
        try {
          const urlObj = new URL(url)
          // Check if transformations already exist
          if (!url.includes('tr=')) {
            // Add transformation path
            const pathParts = urlObj.pathname.split('/')
            // Insert transformations after the imagekit path identifier
            const insertIndex = pathParts.findIndex((p: string) => p && !p.includes('.')) + 1
            pathParts.splice(insertIndex, 0, 'tr:fo-auto,e-removebg,t-true')
            urlObj.pathname = pathParts.join('/')
            return urlObj.toString()
          }
        } catch (e) {
          // If URL parsing fails, return as-is
          console.log('    → Could not apply transformations to signature URL')
        }
      }
      return url
    }
    
    // Try to get the approver/verifier from results for this order
    let signatoryInfo: SignatoryInfo = {
      signatoryName: 'Authorized Signatory',
      signatoryDesignation: '',
      signatoryImageUrl: ''
    }
    
    try {
      // First, get any verified result to find the approver
      const { data: verifiedResult } = await supabaseClient
        .from('result_values')
        .select(`
          verified_by,
          users!result_values_verified_by_fkey(
            id,
            name,
            role,
            department
          )
        `)
        .eq('result_id', orderId)
        .not('verified_by', 'is', null)
        .limit(1)
        .maybeSingle()
      
      // If no result found by result_id, try via results table
      let verifierUserId = verifiedResult?.verified_by as string | null
      let verifierName = (verifiedResult?.users as any)?.name as string | null
      let verifierRole = (verifiedResult?.users as any)?.role as string | null
      let verifierDepartment = (verifiedResult?.users as any)?.department as string | null
      
      if (!verifierUserId) {
        // Try via results table joined with result_values
        const { data: resultWithVerifier } = await supabaseClient
          .from('results')
          .select(`
            id,
            result_values(
              verified_by,
              users!result_values_verified_by_fkey(id, name, role, department)
            )
          `)
          .eq('order_id', orderId)
          .limit(1)
          .maybeSingle()
        
        if (resultWithVerifier?.result_values) {
          const rv = Array.isArray(resultWithVerifier.result_values) 
            ? resultWithVerifier.result_values.find((v: any) => v.verified_by) 
            : resultWithVerifier.result_values
          if (rv?.verified_by) {
            verifierUserId = rv.verified_by
            verifierName = (rv.users as any)?.name
            verifierRole = (rv.users as any)?.role
            verifierDepartment = (rv.users as any)?.department
          }
        }
      }

      // If still no verifier found, check the orders.approved_by field
      if (!verifierUserId) {
         const { data: orderApprover } = await supabaseClient
         .from('orders')
         .select(`
            approved_by,
            users!orders_approved_by_fkey(id, name, role, department)
         `)
         .eq('id', orderId)
         .maybeSingle()

         if (orderApprover?.approved_by) {
             verifierUserId = orderApprover.approved_by
             verifierName = (orderApprover.users as any)?.name
             verifierRole = (orderApprover.users as any)?.role
             verifierDepartment = (orderApprover.users as any)?.department
             console.log('  → Verifier found via orders.approved_by')
         }
      }
      
      console.log('  → Final Verifier ID:', verifierUserId ? `${verifierName} (${verifierUserId})` : 'None')
      
      // If we have a verifier, check if they have a signature (prioritize default)
      if (verifierUserId) {
        const { data: userSignature } = await supabaseClient
          .from('lab_user_signatures')
          .select('imagekit_url, file_url, signature_name, is_default, variants')
          .eq('user_id', verifierUserId)
          .eq('lab_id', job.lab_id)
          .eq('is_active', true)
          .order('is_default', { ascending: false }) // Default first
          .limit(1)
          .maybeSingle()
        
        if (userSignature) {
          // Priority: variants.optimized > imagekit_url with transforms > file_url
          let sigUrl: string | null = null
          
          // Try to get optimized variant first (has background removal)
          if (userSignature.variants) {
            const variants = typeof userSignature.variants === 'string' 
              ? JSON.parse(userSignature.variants) 
              : userSignature.variants
            if (variants?.optimized) {
              sigUrl = variants.optimized
              console.log('  ✅ Using optimized variant (bg removed):', sigUrl)
            }
          }
          
          // Fallback to imagekit_url with transforms
          if (!sigUrl && userSignature.imagekit_url) {
            sigUrl = applySignatureTransformations(userSignature.imagekit_url)
            console.log('  ✅ Using imagekit_url with transforms')
          }
          
          // Final fallback to file_url
          if (!sigUrl && userSignature.file_url) {
            sigUrl = userSignature.file_url
            console.log('  ✅ Using file_url fallback')
          }
          
          if (sigUrl) {
            signatoryInfo = {
              signatoryName: verifierName || userSignature.signature_name || 'Authorized Signatory',
              signatoryDesignation: verifierRole || verifierDepartment || '',
              signatoryImageUrl: sigUrl
            }
            console.log('  ✅ Using verifier signature:', signatoryInfo.signatoryName)
          } else {
            // Verifier exists but has no signature - use their name but get lab default signature
            console.log('  → Verifier has no signature, using name with lab default signature')
            signatoryInfo.signatoryName = verifierName || 'Authorized Signatory'
            signatoryInfo.signatoryDesignation = verifierRole || verifierDepartment || ''
          }
        } else {
          // Verifier exists but has no signature entry
          console.log('  → No signature entry for verifier, using name with lab default signature')
          signatoryInfo.signatoryName = verifierName || 'Authorized Signatory'
          signatoryInfo.signatoryDesignation = verifierRole || verifierDepartment || ''
        }
      }
      
      // If no verifier signature or no verifier, fall back to lab default
      if (!signatoryInfo.signatoryImageUrl) {
        console.log('  → Falling back to lab default signature...')
        
        // Get lab default signature from branding assets (asset_type = 'signature')
        const { data: labSignature } = await supabaseClient
          .from('lab_branding_assets')
          .select('file_url, imagekit_url, asset_metadata')
          .eq('lab_id', job.lab_id)
          .eq('asset_type', 'signature')
          .eq('is_active', true)
          .order('is_default', { ascending: false }) // Default first
          .limit(1)
          .maybeSingle()
        
        if (labSignature) {
          // Prefer ImageKit URL with transformations
          if (labSignature.imagekit_url) {
            signatoryInfo.signatoryImageUrl = applySignatureTransformations(labSignature.imagekit_url)
          } else if (labSignature.file_url) {
            signatoryInfo.signatoryImageUrl = labSignature.file_url
          }
          
          // If we didn't have a verifier name, try to get from lab signature metadata
          if (signatoryInfo.signatoryName === 'Authorized Signatory') {
            const metadata = labSignature.asset_metadata as Record<string, any> | null
            if (metadata?.signatory_name) {
              signatoryInfo.signatoryName = metadata.signatory_name
            }
            if (metadata?.signatory_designation && !signatoryInfo.signatoryDesignation) {
              signatoryInfo.signatoryDesignation = metadata.signatory_designation
            }
          }
          console.log('  ✅ Using lab default signature')
        } else {
          // Try to find ANY user's default signature in this lab as last resort
          const { data: anyUserSig } = await supabaseClient
            .from('lab_user_signatures')
            .select('imagekit_url, file_url, signature_name, user_id, variants')
            .eq('lab_id', job.lab_id)
            .eq('is_active', true)
            .eq('is_default', true) // Only get default signatures
            .limit(1)
            .maybeSingle()
          
          if (anyUserSig) {
            // Priority: variants.optimized > imagekit_url with transforms > file_url
            let sigUrl: string | null = null
            
            if (anyUserSig.variants) {
              const variants = typeof anyUserSig.variants === 'string' 
                ? JSON.parse(anyUserSig.variants) 
                : anyUserSig.variants
              if (variants?.optimized) {
                sigUrl = variants.optimized
                console.log('  ✅ Using optimized variant (bg removed)')
              }
            }
            
            if (!sigUrl && anyUserSig.imagekit_url) {
              sigUrl = applySignatureTransformations(anyUserSig.imagekit_url)
            }
            
            if (!sigUrl && anyUserSig.file_url) {
              sigUrl = anyUserSig.file_url
            }
            
            if (sigUrl) {
              signatoryInfo.signatoryImageUrl = sigUrl
            }
            if (signatoryInfo.signatoryName === 'Authorized Signatory' && anyUserSig.signature_name) {
              signatoryInfo.signatoryName = anyUserSig.signature_name
            }
            console.log('  ✅ Using fallback user default signature')
          } else {
            console.log('  ⚠️ No default signature found - trying any active signature as final resort')
            // FINAL RESORT: Get ANY active signature for this lab
            const { data: desperateSig } = await supabaseClient
            .from('lab_user_signatures')
            .select('imagekit_url, file_url, signature_name, user_id, variants')
            .eq('lab_id', job.lab_id)
            .eq('is_active', true)
            .limit(1)
            .maybeSingle()

            if (desperateSig) {
               // Priority: variants.optimized > imagekit_url with transforms > file_url
               let sigUrl: string | null = null
               
               if (desperateSig.variants) {
                 const variants = typeof desperateSig.variants === 'string' 
                   ? JSON.parse(desperateSig.variants) 
                   : desperateSig.variants
                 if (variants?.optimized) {
                   sigUrl = variants.optimized
                   console.log('  ✅ Using optimized variant (bg removed) - FINAL RESORT')
                 }
               }
               
               if (!sigUrl && desperateSig.imagekit_url) {
                 sigUrl = applySignatureTransformations(desperateSig.imagekit_url)
               }
               
               if (!sigUrl && desperateSig.file_url) {
                 sigUrl = desperateSig.file_url
               }
               
               if (sigUrl) {
                 signatoryInfo.signatoryImageUrl = sigUrl
               }
               if (signatoryInfo.signatoryName === 'Authorized Signatory' && desperateSig.signature_name) {
                  signatoryInfo.signatoryName = desperateSig.signature_name
               }
               console.log('  ✅ Using ANY active signature found (FINAL RESORT)')
            } else {
               console.log('  ❌ Absolutely no signature found for this lab')
            }
          }
        }
      }
    } catch (sigError) {
      console.error('  ❌ Error fetching signatory info:', sigError)
    }
    
    console.log('  → Final signatory:', {
      name: signatoryInfo.signatoryName,
      designation: signatoryInfo.signatoryDesignation,
      hasImage: !!signatoryInfo.signatoryImageUrl
    })
    
    await updateProgress(supabaseClient, job.id, 'Fetching report extras...', 35)

    // ========================================
    // Step 6: Get Report Extras (Multiple Sources)
    // ========================================
    console.log('\n📈 Step 6: Fetching report extras from multiple sources...')
    
    // 6a. Get from report_extras table
    const { data: reportExtrasTable } = await supabaseClient
      .from('report_extras')
      .select('*')
      .eq('order_id', orderId)
      .maybeSingle()
    
    // 6b. Get from orders table (trend_graph_data, ai_clinical_summary, ai_patient_summary)
    const { data: orderExtras } = await supabaseClient
      .from('orders')
      .select('trend_graph_data, ai_clinical_summary, ai_clinical_summary_generated_at, include_clinical_summary_in_report, ai_patient_summary, ai_patient_summary_generated_at, include_patient_summary_in_report, patient_summary_language')
      .eq('id', orderId)
      .single()
    
    // 6c. Get from reports table (ai_doctor_summary, include_trend_graphs)
    const { data: reportRecord } = await supabaseClient
      .from('reports')
      .select('ai_doctor_summary, ai_summary_generated_at, include_trend_graphs')
      .eq('order_id', orderId)
      .order('generated_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    
    // 6d. Get from results table (report_extras field)
    const { data: resultsWithExtras } = await supabaseClient
      .from('results')
      .select('id, report_extras')
      .eq('order_id', orderId)
      .not('report_extras', 'is', null)
    
    // Merge all report extras into one object
    const reportExtras = {
      // From report_extras table
      trend_charts: reportExtrasTable?.trend_charts || [],
      clinical_summary: reportExtrasTable?.clinical_summary || '',
      // From orders table
      trend_graph_data: orderExtras?.trend_graph_data,
      ai_clinical_summary: orderExtras?.include_clinical_summary_in_report ? orderExtras?.ai_clinical_summary : null,
      ai_patient_summary: orderExtras?.include_patient_summary_in_report ? orderExtras?.ai_patient_summary : null,
      patient_summary_language: orderExtras?.patient_summary_language || 'english',
      // From reports table
      ai_doctor_summary: reportRecord?.ai_doctor_summary,
      include_trend_graphs: reportRecord?.include_trend_graphs ?? true,
      // From results table
      results_extras: resultsWithExtras || []
    }
    
    // Merge report extras into context so they are available to templates
    // This fixed the issue where AI summaries were fetched but not compliant with the template data structure
    Object.assign(context, reportExtras);

    // Parse JSON fields if they are strings (TEXT columns in DB)
    const jsonFields = ['ai_patient_summary', 'trend_graph_data', 'ai_clinical_summary', 'ai_doctor_summary'];
    for (const field of jsonFields) {
      if (context[field]) {
          if (typeof context[field] === 'string') {
            try {
              context[field] = JSON.parse(context[field]);
            } catch (e) {
              console.warn(`⚠️ Failed to parse ${field} JSON:`, e);
            }
          }
      }
    }

    // Normalize ai_patient_summary abnormal_findings to support common template accessors
    // We do this OUTSIDE the parsing loop to ensure it runs whether the data was a string or already an object
    if (context.ai_patient_summary && context.ai_patient_summary.abnormal_findings) {
        console.log('  → Normalizing AI patient summary findings...');
        context.ai_patient_summary.abnormal_findings = context.ai_patient_summary.abnormal_findings.map((f: any) => {
          // Determine the best name for this finding (handle all possible field names)
          const findingName = f.test_name || f.name || f.parameter || f.label || f.test || '';
          
          return {
            ...f,
            // Ensure test_name always has a value (this is what PDF template and modal use)
            test_name: findingName,
            // Alias common names to ensure template compatibility
            name: findingName,
            test: findingName,
            parameter: findingName,
            label: findingName,
            // Ensure status/flag is available and capitalized
            // If neither exists, default to empty string but handle the 'undefined' case explicitly
            flag: (f.status || f.flag) ? (f.status || f.flag).charAt(0).toUpperCase() + (f.status || f.flag).slice(1) : '',
            status: f.status || f.flag || 'abnormal',
            // Ensure type exists
            type: f.type || 'Observation',
            // Ensure explanation exists
            explanation: f.explanation || f.description || ''
          };
        });
    }

    console.log('✅ Report extras merged into context:', {
      hasTrendCharts: !!(context.trend_charts?.length),
      hasTrendGraphData: !!context.trend_graph_data,
      hasClinicalSummary: !!context.clinical_summary,
      hasAiClinicalSummary: !!context.ai_clinical_summary,
      hasAiPatientSummary: !!context.ai_patient_summary,
      hasAiDoctorSummary: !!context.ai_doctor_summary,
      resultsWithExtras: context.results_extras?.length || 0,
      patientSummaryLanguage: context.patient_summary_language
    })
    
    await updateProgress(supabaseClient, job.id, 'Fetching attachments...', 40)

    // ========================================
    // Step 7: Get Attachments
    // ========================================
    console.log('\n📎 Step 7: Fetching attachments...')
    const { data: attachments } = await supabaseClient
      .from('attachments')
      .select('*')
      .eq('related_table', 'orders')
      .eq('related_id', orderId)
      .eq('tag', 'include_in_report')
    
    console.log('✅ Attachments found:', attachments?.length || 0)
    
    // ========================================
    // Step 7c: Get Branding Pages (Front/Back)
    // ========================================
    console.log('\n🎨 Step 7c: Fetching front/back pages...')
    const { frontPage, lastPage } = await fetchFrontBackPages(supabaseClient, job.lab_id)
    
    // Note: customHeader and customFooter already fetched in Step 5

    if (customHeader) console.log('✅ Using custom header from DB')
    if (customFooter) console.log('✅ Using custom footer from DB')
    if (frontPage) console.log('✅ Using custom front page')
    if (lastPage) console.log('✅ Using custom last page')
    
    await updateProgress(supabaseClient, job.id, 'Rendering HTML template...', 50)

    // ========================================
    // Step 8: Render HTML Template (Multi-Test Support)
    // ========================================
    console.log('\n🔧 Step 8: Rendering HTML template...')
    
    // Initialize bodyHtml with front page if available
    // We add a specific class to handle page breaks
    let bodyHtml = ''
    
    if (frontPage) {
        bodyHtml += `<div class="report-front-page" style="page-break-after: always; width: 100vw; height: 100vh; margin: 0; padding: 0;">${frontPage}</div>`
    }
    let template = null // Primary template for CSS/Settings
    let fullContext: any = null // Define in outer scope for print version
    let rawHtmlForPrint = '' // Capture HTML before watermark for print version

    // Group analytes by test_group_id
    const contextTestGroupIds = context.testGroupIds || []
    const analytesByGroup = groupAnalytesByTestGroup(context.analytes || [], contextTestGroupIds)
    const effectiveGroupCount = Math.max(contextTestGroupIds.length, analytesByGroup.size)
    
    console.log('📊 Test group analysis:', {
      contextTestGroupIds,
      analytesByGroupKeys: Array.from(analytesByGroup.keys()),
      effectiveGroupCount
    })

    // Helper: Select appropriate template
    const selectTemplate = (ctx: any) => {
      const testGroupId = ctx.testGroupIds?.[0]
      if (testGroupId) {
        const specific = templatesWithHtml.find((t: any) => t.test_group_id === testGroupId)
        if (specific) return specific
      }
      return templatesWithHtml.find((t: any) => t.is_default) || templatesWithHtml[0]
    }

    // Helper: Prepare full context with all extras
    const prepareFullContext = (baseContext: any) => {
      // Generate individual analyte placeholders for hardcoded template support
      const analytePlaceholders = generateAnalytePlaceholders(baseContext.analytes || []);
      
      // Create flat aliases for nested properties (for template compatibility)
      
      const sig = baseContext.signatory || {};
      let sigName = sig.name || '';
      const sigUrl = sig.signature_url || sig.url;

      // Logic to inject signature image directly into the name placeholder
      // This follows "User Request" to look for {{signatoryName}} and inject there.
      if (sigUrl && sigName) {
           const imgHtml = `<img src="${sigUrl}" alt="Signature" style="display:block; max-height:40px; margin-bottom:2px; margin-top:2px;" />`;
           // Wrap name in span to separate it from block image, though block image forces break.
           sigName = `${imgHtml}<span>${sigName}</span>`; 
      }
      
      const flatAliases = {
        // Patient aliases
        patientName: baseContext.patient?.name || '',
        patientId: baseContext.patient?.displayId || baseContext.patient?.id || '',
        patientAge: baseContext.patient?.age || '',
        patientGender: baseContext.patient?.gender || '',
        patientPhone: baseContext.patient?.phone || '',
        
        // Order aliases
        sampleId: baseContext.order?.sampleId || '',
        orderId: baseContext.orderId || '',
        orderDate: baseContext.order?.orderDate || baseContext.meta?.orderDate || '',
        collectionDate: baseContext.order?.sampleCollectedAtFormatted || baseContext.order?.sampleCollectedAt || '',
        referringDoctorName: baseContext.order?.referringDoctorName || '',
        
        // Signatory aliases
        signatoryName: sigName,
        signatoryDesignation: sig.designation || '',
      };
      
      return {
        ...baseContext,
        ...reportExtras,
        ...baseContext.placeholderValues, // ✅ CRITICAL: Spread RPC-provided placeholders to root
        ...analytePlaceholders, // Add locally generated placeholders (fallbacks)
        ...flatAliases, // Add flat aliases
        watermark: watermarkSettings.enabled ? watermarkSettings.imageUrl : null,
        signatory: signatoryInfo,
        lab: { name: labSettings?.name },
        attachments: attachments || []
      };
    };

    // Helper: Generate dynamic CSS
    const generateDynamicCss = (settings: any) => {
      return `
        .limsv2-report {
          font-size: ${settings.fontSize || '14px'};
        }
      `
    }

    // Helper: Build PDF body document
    const buildPdfBodyDocument = (content: string, css: string) => {
      return `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>${BASELINE_CSS}\n${css}</style>
        </head>
        <body class="limsv2-report">
          ${content}
        </body>
        </html>
      `
    }

    if (effectiveGroupCount <= 1) {
      // Single Group Logic
      template = selectTemplate(context)
      if (!template) {
        console.error('❌ No template found for lab')
        await failJob(supabaseClient, job.id, 'No lab template found')
        return new Response(
          JSON.stringify({ error: 'No lab template found' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      console.log('✅ Using single template:', template.template_name)
      fullContext = prepareFullContext(context)
      const dynamicCss = generateDynamicCss(pdfSettings)
      let renderedHtml = renderTemplate(template.gjs_html, fullContext)
      
      // Inject signature image if template doesn't have one
      if (signatoryInfo.signatoryImageUrl) {
        renderedHtml = injectSignatureImage(renderedHtml, signatoryInfo.signatoryImageUrl, signatoryInfo.signatoryName, signatoryInfo.signatoryDesignation)
      }
      
      bodyHtml = buildPdfBodyDocument(renderedHtml, (template.gjs_css || '') + '\n' + dynamicCss)
      rawHtmlForPrint = bodyHtml // Save for print version
    } else {
      // Multi Group Logic
      console.log('🔀 Multi-test group rendering...')
      const renderedSections: string[] = []
      let firstGroupTemplate = null
      
      // Set base context for print version (even if not perfect for all groups)
      fullContext = prepareFullContext(context)

      // Use contextTestGroupIds as the authoritative list of groups to render
      // This ensures we render all test groups even if analytes don't have test_group_id
      const groupsToRender = contextTestGroupIds.length > 0 ? contextTestGroupIds : [...analytesByGroup.keys()]
      console.log(`🔀 Groups to render: ${JSON.stringify(groupsToRender)}`)

      for (const testGroupId of groupsToRender) {
        // Get analytes for this group (may be empty if grouping failed)
        let groupAnalytes = analytesByGroup.get(testGroupId) || []
        
        // If no analytes found for this group, try to find them from ungrouped
        if (groupAnalytes.length === 0 && analytesByGroup.has('ungrouped')) {
          const ungrouped = analytesByGroup.get('ungrouped') || []
          // Distribute ungrouped analytes - take the next one for this group
          const groupIndex = groupsToRender.indexOf(testGroupId)
          if (groupIndex >= 0 && groupIndex < ungrouped.length) {
            groupAnalytes = [ungrouped[groupIndex]]
          }
        }
        
        console.log(`🔧 Rendering test group: ${testGroupId} with ${groupAnalytes.length} analyte(s)`)
        
        // Skip if no analytes for this group
        if (groupAnalytes.length === 0) {
          console.log(`⚠️ No analytes found for test group: ${testGroupId}, skipping`)
          continue
        }
        
        const groupContext = {
          ...context,
          analytes: groupAnalytes,
          testGroupIds: [testGroupId]
        }
        
        // Find specific template for this group
        let groupTemplate = templatesWithHtml.find((t: any) => t.test_group_id === testGroupId)
        if (!groupTemplate) {
          console.log(`⚠️ No specific template for ${testGroupId}, using fallback`)
          groupTemplate = selectTemplate(groupContext)
        } else {
          console.log(`✅ Found specific template for ${testGroupId}: ${groupTemplate.template_name}`)
        }
        
        if (groupTemplate?.gjs_html) {
          if (!firstGroupTemplate) firstGroupTemplate = groupTemplate
          
          const groupFullContext = prepareFullContext(groupContext)
          let renderedHtml = renderTemplate(groupTemplate.gjs_html, groupFullContext)
          
          // Inject signature image if template doesn't have one
          if (signatoryInfo.signatoryImageUrl) {
            renderedHtml = injectSignatureImage(renderedHtml, signatoryInfo.signatoryImageUrl, signatoryInfo.signatoryName, signatoryInfo.signatoryDesignation)
          }
          
          // Extract body content
          const bodyMatch = renderedHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)
          const bodyContent = bodyMatch ? bodyMatch[1] : renderedHtml
          
          // Add separator
          const testName = groupAnalytes[0]?.test_name || groupTemplate.template_name || `Test Group ${renderedSections.length + 1}`
          const sectionHtml = `
            <div class="test-group-section" data-test-group-id="${testGroupId}">
              ${renderedSections.length > 0 ? `
                <div class="test-group-separator" style="page-break-before: always; margin: 40px 0 20px; padding-top: 20px; border-top: 2px solid #2563eb;">
                  <h2 style="color: #2563eb; font-size: 18px; margin: 0;">${testName}</h2>
                </div>
              ` : ''}
              ${bodyContent}
            </div>
          `
          renderedSections.push(sectionHtml)
          console.log(`✅ Rendered section for ${testGroupId}`)
        } else {
          console.log(`⚠️ No template with HTML found for test group: ${testGroupId}`)
        }
      }
      
      if (renderedSections.length === 0) {
        console.error('❌ Failed to render any test group templates')
        await failJob(supabaseClient, job.id, 'Failed to render any test group templates')
        return new Response(
          JSON.stringify({ error: 'Failed to render any test group templates' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      // Use first group's template for outer shell
      template = firstGroupTemplate || selectTemplate(context)
      if (!template) {
        console.error('❌ No template found for lab')
        await failJob(supabaseClient, job.id, 'No lab template found')
        return new Response(
          JSON.stringify({ error: 'No lab template found' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      console.log('✅ Merged multiple templates using base:', template.template_name)
      const dynamicCss = generateDynamicCss(pdfSettings)
      bodyHtml = buildPdfBodyDocument(renderedSections.join('\n'), (template.gjs_css || '') + '\n' + dynamicCss)
      rawHtmlForPrint = bodyHtml // Save for print version
    }

    // Apply flag styling (color-code high/low/normal flags)
    bodyHtml = applyFlagStyling(bodyHtml, pdfSettings)
    rawHtmlForPrint = applyFlagStyling(rawHtmlForPrint, pdfSettings)

    // Apply header text color (white text on dark header backgrounds)
    bodyHtml = applyHeaderTextColor(bodyHtml, pdfSettings)
    rawHtmlForPrint = applyHeaderTextColor(rawHtmlForPrint, pdfSettings)

    // Inject watermark if enabled
    if (watermarkSettings.enabled && watermarkSettings.imageUrl) {
      const watermarkHtml = generateWatermarkHtml(watermarkSettings)
      bodyHtml = bodyHtml.replace('<main', `${watermarkHtml}<main`)
      console.log('✅ Watermark injected')
    }
    
    // Inject report extras (trends, clinical summary, AI summaries)
    const extrasHtml = generateReportExtrasHtml(reportExtras)
    if (extrasHtml) {
      bodyHtml = bodyHtml.replace('</body>', `${extrasHtml}</body>`)
      console.log('✅ Report extras injected')
    }
    
    // Inject attachments
    if (attachments && attachments.length > 0) {
      const attachmentsHtml = generateAttachmentsHtml(attachments)
      if (attachmentsHtml) {
        bodyHtml = bodyHtml.replace('</body>', `${attachmentsHtml}</body>`)
        console.log('✅ Attachments injected:', attachments.length)
      }
    }

    // Inject Last Page if available
    if (lastPage) {
        bodyHtml = bodyHtml.replace('</body>', `<div class="report-last-page" style="page-break-before: always; width: 100vw; height: 100vh; margin: 0; padding: 0;">${lastPage}</div></body>`)
        console.log('✅ Last page injected')
    }
    
    console.log('✅ HTML rendered:', { length: bodyHtml.length })
    
    await updateProgress(supabaseClient, job.id, 'Converting images to base64...', 60)

    // ========================================
    // Step 9: Convert Images to Base64
    // ========================================
    console.log('\n🖼️ Step 9: Converting images to base64...')
    
    const [processedBody, processedHeader, processedFooter] = await Promise.all([
      convertHtmlImagesToBase64(bodyHtml),
      convertHtmlImagesToBase64(headerHtml),
      convertHtmlImagesToBase64(footerHtml)
    ])
    
    console.log('✅ Images converted')
    
    
    console.log('✅ HTML Generation Complete - Returning HTML payload')

    return new Response(
      JSON.stringify({
        success: true,
        html: processedBody,
        header: processedHeader,
        footer: processedFooter,
        settings: pdfSettings,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
    
    // Close the try block manually if needed? 
    // No, endIndex starts with } catch... so we just need to end our logic.

} catch (error) {
    console.error('═══════════════════════════════════════════════════════════')
    console.error('❌ PDF GENERATION ERROR:', error)
    console.error('═══════════════════════════════════════════════════════════')
    
    return new Response(
      JSON.stringify({ 
        error: 'PDF generation failed', 
        details: String(error),
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
  } catch (topError) {
    // Top-level error handler - ensures CORS headers are ALWAYS returned
    console.error('❌ TOP-LEVEL ERROR (before main logic):', topError)
    return new Response(
      JSON.stringify({
        error: 'Request processing failed',
        details: String(topError),
        message: topError instanceof Error ? topError.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ============================================================
// SECTION: Helper Functions
// ============================================================

async function updateProgress(supabase: any, jobId: string, stage: string, percent: number) {
  await supabase
    .from('pdf_generation_queue')
    .update({ progress_stage: stage, progress_percent: percent })
    .eq('id', jobId)
}

async function failJob(supabase: any, jobId: string, errorMessage: string) {
  await supabase
    .from('pdf_generation_queue')
    .update({
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date().toISOString()
    })
    .eq('id', jobId)
}

/**
 * Helper function to group analytes by test_group_id
 * If analytes don't have test_group_id but contextTestGroupIds is provided,
 * distribute analytes across groups based on position or test name matching
 */
function groupAnalytesByTestGroup(analytes: any[], contextTestGroupIds: string[] = []): Map<string, any[]> {
  const grouped = new Map<string, any[]>();
  
  // First pass: group by test_group_id if present on analyte
  const ungroupedAnalytes: any[] = [];
  
  for (const analyte of analytes) {
    const testGroupId = analyte.test_group_id;
    if (testGroupId) {
      if (!grouped.has(testGroupId)) {
        grouped.set(testGroupId, []);
      }
      grouped.get(testGroupId)!.push(analyte);
    } else {
      ungroupedAnalytes.push(analyte);
    }
  }
  
  // If we have ungrouped analytes and context provides testGroupIds,
  // try to match them or distribute evenly
  if (ungroupedAnalytes.length > 0 && contextTestGroupIds.length > 0) {
    console.log(`⚠️ ${ungroupedAnalytes.length} analytes without test_group_id, attempting to match with ${contextTestGroupIds.length} context groups`);
    
    // Ensure all context test group IDs have entries
    for (const tgId of contextTestGroupIds) {
      if (!grouped.has(tgId)) {
        grouped.set(tgId, []);
      }
    }
    
    // Try to match ungrouped analytes to context groups
    // This is a fallback - ideally RPC should return test_group_id on each analyte
    for (const analyte of ungroupedAnalytes) {
      // If only one context group, assign to it
      if (contextTestGroupIds.length === 1) {
        grouped.get(contextTestGroupIds[0])!.push(analyte);
      } else {
        // Otherwise put in 'ungrouped' - the rendering will use contextTestGroupIds
        if (!grouped.has('ungrouped')) {
          grouped.set('ungrouped', []);
        }
        grouped.get('ungrouped')!.push(analyte);
      }
    }
  } else if (ungroupedAnalytes.length > 0) {
    // No context groups, put all ungrouped in one bucket
    grouped.set('ungrouped', ungroupedAnalytes);
  }
  
  return grouped;
}
