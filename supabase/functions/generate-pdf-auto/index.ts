// Supabase Edge Function: Full Server-Side PDF Generation with PDF.co
// Complete pipeline: Context → Templates → HTML → PDF.co → Storage

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
:root {
  --report-font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
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

/* Abnormal values highlighting */
.result-abnormal, .abnormal {
  color: #d32f2f;
  font-weight: bold;
}

.result-normal, .normal {
  color: #2e7d32;
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

/* Signature section */
.limsv2-report .signature-section,
.limsv2-report [class*="signature"] {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  text-align: right;
  margin-top: 2rem;
  gap: 0.5rem;
}

.limsv2-report .signature-section img,
.limsv2-report [class*="signature"] img {
  max-width: 200px;
  height: auto;
  margin-left: auto;
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
    const response = await fetch(imageUrl)
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
 * Inject section content into HTML by replacing {{section:key}} placeholders
 */
function injectSectionContent(html: string, sectionContent: Record<string, string>): string {
  if (!html || Object.keys(sectionContent).length === 0) return html
  
  let resultHtml = html
  for (const [key, content] of Object.entries(sectionContent)) {
    if (!content) continue
    
    const placeholder = `{{section:${key}}}`
    
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
    
    // Replace all occurrences (case-insensitive)
    const regex = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    resultHtml = resultHtml.replace(regex, wrappedContent)
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
 * Generate HTML for report extras (trend charts, clinical summary, AI summaries)
 */
function generateReportExtrasHtml(extras: {
  trend_charts?: any[]
  clinical_summary?: string
  trend_graph_data?: any
  ai_clinical_summary?: string
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
  
  const includedAttachments = attachments.filter(a => a.include_in_report)
  if (includedAttachments.length === 0) return ''
  
  let html = '<div class="report-attachments" style="margin-top: 20px; page-break-before: always;">'
  html += '<h3 style="margin-bottom: 10px;">Attachments</h3>'
  
  for (const attachment of includedAttachments) {
    const isImage = attachment.content_type?.startsWith('image/')
    
    if (isImage && attachment.public_url) {
      html += `<div class="attachment-item" style="margin: 10px 0; page-break-inside: avoid;">`
      html += `<img src="${attachment.public_url}" alt="${attachment.file_name || 'Attachment'}" style="max-width: 100%; height: auto;" />`
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
    throw new Error(`Failed to download PDF after ${maxRetries} attempts: ${lastError?.message}`)
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    {
      auth: { autoRefreshToken: false, persistSession: false }
    }
  )
  
  const PDFCO_API_KEY = Deno.env.get('PDFCO_API_KEY') ?? ''

  try {
    const { orderId } = await req.json()

    console.log('═══════════════════════════════════════════════════════════')
    console.log('📄 PDF AUTO-GENERATION (SERVER-SIDE)')
    console.log('═══════════════════════════════════════════════════════════')
    console.log('Order ID:', orderId)
    console.log('PDF.co API Key:', PDFCO_API_KEY ? '✅ Present' : '❌ MISSING')

    if (!orderId) {
      return new Response(
        JSON.stringify({ error: 'orderId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
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
    console.log('✅ Context fetched:', {
      patientName: context.patient?.name || context.placeholderValues?.patientName,
      patientId: context.patientId,
      sampleId: context.order?.sampleId || context.placeholderValues?.sampleId,
      analytes: context.analytes?.length || 0,
      testGroupIds: context.testGroupIds || [],
      analyteNames: (context.analytes || []).slice(0, 3).map((a: any) => a.parameter || a.test_name || a.name || 'unknown')
    })
    
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
        const { displayFlag } = determineFlag(
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
          flag: displayFlag
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
    
    const headerHtml = labSettings?.default_report_header_html || ''
    const footerHtml = labSettings?.default_report_footer_html || ''
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
    
    // 6b. Get from orders table (trend_graph_data, ai_clinical_summary)
    const { data: orderExtras } = await supabaseClient
      .from('orders')
      .select('trend_graph_data, ai_clinical_summary, ai_clinical_summary_generated_at, include_clinical_summary_in_report')
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
      // From reports table
      ai_doctor_summary: reportRecord?.ai_doctor_summary,
      include_trend_graphs: reportRecord?.include_trend_graphs ?? true,
      // From results table
      results_extras: resultsWithExtras || []
    }
    
    console.log('✅ Report extras:', {
      hasTrendCharts: !!(reportExtras.trend_charts?.length),
      hasTrendGraphData: !!reportExtras.trend_graph_data,
      hasClinicalSummary: !!reportExtras.clinical_summary,
      hasAiClinicalSummary: !!reportExtras.ai_clinical_summary,
      hasAiDoctorSummary: !!reportExtras.ai_doctor_summary,
      resultsWithExtras: reportExtras.results_extras.length
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
      .eq('include_in_report', true)
    
    console.log('✅ Attachments found:', attachments?.length || 0)
    
    // ========================================
    // Step 7b: Get Section Content for Pre-defined Report Sections
    // ========================================
    console.log('\n📄 Step 7b: Fetching section content for placeholders...')
    
    // Get ALL result IDs for this order (not just ones with extras)
    const { data: allResults } = await supabaseClient
      .from('results')
      .select('id')
      .eq('order_id', orderId)
    
    const resultIds = (allResults || []).map((r: any) => r.id)
    console.log(`📋 Found ${resultIds.length} result(s) for order`)
    
    // Fetch section content for all results
    const sectionContent = await fetchSectionContent(supabaseClient, resultIds)
    console.log('✅ Section content loaded:', Object.keys(sectionContent))
    
    await updateProgress(supabaseClient, job.id, 'Rendering HTML template...', 50)

    // ========================================
    // Step 8: Render HTML Template (Multi-Test Support)
    // ========================================
    console.log('\n🔧 Step 8: Rendering HTML template...')
    
    // Helper to prepare full context
    const prepareFullContext = (ctx: any) => {
      const placeholders = ctx.placeholderValues || {}
      return {
        ...ctx,
        patient: ctx.patient || {},
        order: ctx.order || {},
        meta: ctx.meta || {},
        ...placeholders,
        labName: labSettings?.name || placeholders.labName || '',
        patientName: ctx.patient?.name || placeholders.patientName || '',
        patientDisplayId: ctx.patient?.displayId || placeholders.patientDisplayId || '',
        patientId: ctx.patientId || placeholders.patientId || '',
        sampleId: ctx.order?.sampleId || placeholders.sampleId || '',
        orderNumber: ctx.meta?.orderNumber || placeholders.orderNumber || '',
        orderDate: ctx.meta?.orderDate || placeholders.orderDate || '',
        locationName: ctx.order?.locationName || placeholders.locationName || '',
        referringDoctorName: ctx.order?.referringDoctorName || placeholders.referringDoctorName || '',
        sampleCollectedAt: ctx.order?.sampleCollectedAt || placeholders.sampleCollectedAt || '',
        sampleCollectedAtFormatted: ctx.order?.sampleCollectedAtFormatted || placeholders.sampleCollectedAtFormatted || '',
        approvedAt: ctx.order?.approvedAt || placeholders.approvedAt || '',
        approvedAtFormatted: ctx.order?.approvedAtFormatted || placeholders.approvedAtFormatted || '',
        approverSignature: ctx.order?.approverSignature || placeholders.approverSignature || '',
        approvedByName: ctx.order?.approvedByName || placeholders.approvedByName || '',
        reportDate: placeholders.reportDate || new Date().toISOString().split('T')[0],
      }
    }

    // Helper to select template
    const selectTemplate = (ctx: any) => {
      const tGIds = ctx.testGroupIds || []
      // 1. Match by test_group_id
      let tpl = templatesWithHtml.find((t: any) => t.test_group_id && tGIds.includes(t.test_group_id))
      // 2. Match by analyte name
      if (!tpl && ctx.analytes?.length > 0) {
        const analyteNames = ctx.analytes.map((a: any) => (a.parameter || a.test_name || a.name || '').toLowerCase().trim()).filter(Boolean)
        tpl = templatesWithHtml.find((t: any) => {
          const tName = (t.template_name || '').toLowerCase().trim()
          return analyteNames.some((name: string) => tName.includes(name) || name.includes(tName))
        })
      }
      // 3. Default
      if (!tpl) tpl = templatesWithHtml.find((t: any) => t.is_default)
      // 4. Any
      if (!tpl && templatesWithHtml.length > 0) tpl = templatesWithHtml[0]
      return tpl
    }

    // Group analytes - use testGroupIds from context as authoritative source
    // The RPC returns testGroupIds as an array even if individual analytes don't have test_group_id
    const contextTestGroupIds = context.testGroupIds || []
    const analytesByGroup = groupAnalytesByTestGroup(context.analytes || [], contextTestGroupIds)
    
    console.log(`📋 Found ${analytesByGroup.size} test group(s) from analytes`)
    console.log(`📋 Context testGroupIds: ${JSON.stringify(contextTestGroupIds)}`)
    
    // Use the larger of the two counts - either from grouped analytes or from context testGroupIds
    const effectiveGroupCount = Math.max(analytesByGroup.size, contextTestGroupIds.length)
    console.log(`📋 Effective group count: ${effectiveGroupCount}`)

    let bodyHtml = ''
    let template = null // Primary template for CSS/Settings
    let fullContext: any = null // Define in outer scope for print version
    let rawHtmlForPrint = '' // Capture HTML before watermark for print version

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
      const renderedHtml = renderTemplate(template.gjs_html, fullContext)
      bodyHtml = buildPdfBodyDocument(renderedHtml, template.gjs_css || '')
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
          const renderedHtml = renderTemplate(groupTemplate.gjs_html, groupFullContext)
          
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
      bodyHtml = buildPdfBodyDocument(renderedSections.join('\n'), template.gjs_css || '')
      rawHtmlForPrint = bodyHtml // Save for print version
    }

    // Inject section content ({{section:key}} placeholders)
    if (Object.keys(sectionContent).length > 0) {
      bodyHtml = injectSectionContent(bodyHtml, sectionContent)
      rawHtmlForPrint = injectSectionContent(rawHtmlForPrint, sectionContent)
      console.log('✅ Section content injected into bodyHtml and rawHtmlForPrint')
    }

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
    
    await updateProgress(supabaseClient, job.id, 'Generating PDF via PDF.co...', 70)

    // ========================================
    // Step 10: Generate PDFs via PDF.co API (PARALLEL)
    // ========================================
    console.log('\n📤 Step 10: Calling PDF.co API (parallel eCopy + Print)...')
    const pdfStartTime = Date.now()
    
    // Build PDF settings
    const margins = pdfSettings?.margins 
      ? `${pdfSettings.margins.top}px ${pdfSettings.margins.right}px ${pdfSettings.margins.bottom}px ${pdfSettings.margins.left}px`
      : DEFAULT_PDF_SETTINGS.margins
    
    const filename = `Report_${context.sampleId || orderId}_${Date.now()}.pdf`
    
    // Check if lab has print settings enabled (default: true)
    const generatePrintVersion = labSettings?.pdf_settings?.generatePrintVersion !== false
    
    // Prepare print HTML in advance (if needed) for parallel generation
    let printHtmlPrepared: string | null = null
    if (generatePrintVersion) {
      let printHtml = ''
      if (rawHtmlForPrint) {
        printHtml = rawHtmlForPrint
      } else {
        const printTemplateContext = {
          ...fullContext,
          isForPrint: true,
          hideWatermark: true,
          watermarkText: '',
          showWatermark: false
        }
        const printRenderedHtml = renderTemplate(template.gjs_html, printTemplateContext)
        // Build print HTML WITHOUT gjs_css - pass empty string for clean print output
        printHtml = buildPdfBodyDocument(printRenderedHtml, '')
        console.log('✅ Built print HTML without gjs_css (clean print mode)')
        
        // Also inject section content for this fallback path
        if (Object.keys(sectionContent).length > 0) {
          printHtml = injectSectionContent(printHtml, sectionContent)
          console.log('✅ Section content injected into print fallback HTML')
        }
      }
      
      // Strip custom gjs_css from rawHtmlForPrint path (if it was included)
      printHtml = printHtml.replace(/<style id="lims-report-custom">[\s\S]*?<\/style>/gi, '')
      
      // Inject report extras
      const printExtrasHtml = generateReportExtrasHtml(reportExtras)
      if (printExtrasHtml) {
        printHtml = printHtml.replace('</body>', `${printExtrasHtml}</body>`)
      }
      
      // Inject attachments
      if (attachments && attachments.length > 0) {
        const printAttachmentsHtml = generateAttachmentsHtml(attachments)
        if (printAttachmentsHtml) {
          printHtml = printHtml.replace('</body>', `${printAttachmentsHtml}</body>`)
        }
      }
      
      // Convert images to base64
      printHtml = await convertHtmlImagesToBase64(printHtml)
      
      // Inject print-optimized CSS (grayscale, simplified colors)
      const printCss = `
        <style id="lims-print-css">
          /* Grayscale filter for clean B&W printing */
          html, body { -webkit-filter: grayscale(100%) !important; filter: grayscale(100%) !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          
          /* Force black text */
          body, p, span, td, th, div, h1, h2, h3, h4, h5, h6 { color: #000 !important; }
          
          /* Neutralize colored backgrounds */
          .bg-blue-50, .bg-green-50, .bg-yellow-50, .bg-red-50,
          [class*="bg-blue"], [class*="bg-green"], [class*="bg-yellow"], [class*="bg-red"] { background-color: #f5f5f5 !important; }
          
          /* Neutralize colored text */
          .text-blue-600, .text-green-600, .text-red-600, .text-yellow-600,
          [class*="text-blue"], [class*="text-green"], [class*="text-red"], [class*="text-yellow"] { color: #333 !important; }
          
          /* Clean table styling for print */
          table { border-collapse: collapse !important; }
          td, th { border: 1px solid #ccc !important; padding: 4px 8px !important; }
        </style>
      `
      printHtml = printHtml.replace('</head>', `${printCss}</head>`)
      console.log('✅ Print CSS injected (grayscale + clean styling)')
      
      printHtmlPrepared = printHtml
    }
    
    // ========================================
    // PARALLEL PDF Generation - eCopy + Print simultaneously
    // ========================================
    const eCopyPromise = sendHtmlToPdfCo(
      processedBody,
      filename,
      PDFCO_API_KEY,
      {
        headerHtml: processedHeader,
        footerHtml: processedFooter,
        margins,
        headerHeight: pdfSettings?.headerHeight ? `${pdfSettings.headerHeight}px` : DEFAULT_PDF_SETTINGS.headerHeight,
        footerHeight: pdfSettings?.footerHeight ? `${pdfSettings.footerHeight}px` : DEFAULT_PDF_SETTINGS.footerHeight,
        scale: pdfSettings?.scale ?? DEFAULT_PDF_SETTINGS.scale,
        displayHeaderFooter: pdfSettings?.displayHeaderFooter ?? DEFAULT_PDF_SETTINGS.displayHeaderFooter,
        paperSize: DEFAULT_PDF_SETTINGS.paperSize,
        mediaType: DEFAULT_PDF_SETTINGS.mediaType,
        printBackground: DEFAULT_PDF_SETTINGS.printBackground
      }
    )
    
    const printPromise = printHtmlPrepared 
      ? sendHtmlToPdfCo(
          printHtmlPrepared,
          `Print_${filename}`,
          PDFCO_API_KEY!,
          {
            headerHtml: '',
            footerHtml: '',
            margins: '180px 20px 150px 20px',
            headerHeight: '0px',
            footerHeight: '0px',
            scale: pdfSettings?.scale ?? DEFAULT_PDF_SETTINGS.scale,
            displayHeaderFooter: false,
            paperSize: DEFAULT_PDF_SETTINGS.paperSize,
            mediaType: 'print',
            printBackground: false
          }
        )
      : Promise.resolve(null)
    
    // Wait for both PDFs to generate in parallel
    const [pdfCoUrl, printPdfCoUrl] = await Promise.all([eCopyPromise, printPromise])
    
    console.log(`✅ PDFs generated in ${Date.now() - pdfStartTime}ms (parallel)`)
    console.log('  eCopy URL:', pdfCoUrl ? '✓' : '✗')
    console.log('  Print URL:', printPdfCoUrl ? '✓' : 'skipped')
    
    await updateProgress(supabaseClient, job.id, 'Uploading PDFs to storage...', 85)

    // ========================================
    // Step 11: Upload PDFs to Storage (PARALLEL)
    // ========================================
    console.log('\n📦 Step 11: Uploading PDFs to Supabase Storage (parallel)...')
    const uploadStartTime = Date.now()
    
    // Small delay before downloads to let PDF.co finalize
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    const eCopyUploadPromise = uploadPdfToStorage(
      supabaseClient,
      pdfCoUrl,
      orderId,
      job.lab_id,
      context.patientId || 'unknown',
      filename,
      'final'
    )
    
    const printUploadPromise = printPdfCoUrl 
      ? uploadPdfToStorage(
          supabaseClient,
          printPdfCoUrl,
          orderId,
          job.lab_id,
          context.patientId || 'unknown',
          `Print_${filename}`,
          'print',
          5
        ).catch(err => {
          console.warn('⚠️ Print upload failed (non-fatal):', err.message)
          return null
        })
      : Promise.resolve(null)
    
    const [eCopyResult, printResult] = await Promise.all([eCopyUploadPromise, printUploadPromise])
    
    const storageUrl = eCopyResult.publicUrl
    let printStorageUrl: string | null = printResult?.publicUrl || null
    
    console.log(`✅ PDFs uploaded in ${Date.now() - uploadStartTime}ms (parallel)`)
    console.log('  eCopy:', storageUrl)
    console.log('  Print:', printStorageUrl || 'none')
    
    await updateProgress(supabaseClient, job.id, 'Updating database records...', 95)

    // ========================================
    // Step 12: Update Database Records
    // ========================================
    console.log('\n💾 Step 12: Updating database records...')
    
    const now = new Date().toISOString()
    
    // Get patient_id and doctor name from context (required fields for reports table)
    // Try multiple sources for patient_id
    let patientId = context.patientId || context.patient?.id
    
    // If still null, try to get from orders table
    if (!patientId) {
      const { data: orderData } = await supabaseClient
        .from('orders')
        .select('patient_id')
        .eq('id', orderId)
        .single()
      patientId = orderData?.patient_id
    }
    
    const doctorName = context.order?.referringDoctorName || 
                       context.placeholderValues?.referringDoctorName || 
                       context.order?.doctor || 
                       ''
    
    if (!patientId) {
      console.error('❌ Missing patient_id - cannot create report record')
      console.error('Context patient sources:', { 
        contextPatientId: context.patientId, 
        patientObjectId: context.patient?.id,
        orderId 
      })
      // Don't throw - continue without creating report record, PDF is still generated
      console.warn('⚠️ Skipping report record creation due to missing patient_id')
    }
    
    console.log('📋 Report record data:', {
      orderId,
      patientId,
      doctorName,
      pdfUrl: storageUrl,
      printPdfUrl: printStorageUrl || 'none'
    })
    
    // Only create/update report record if we have patient_id
    if (patientId) {
      // Update or create report record - include ALL fields like normal flow
      const { data: existingReport, error: selectError } = await supabaseClient
        .from('reports')
        .select('id')
        .eq('order_id', orderId)
        .maybeSingle()
      
      // Fields to update (for existing record)
      const updateFields = {
        pdf_url: storageUrl,
        pdf_generated_at: now,
        status: 'completed',
        report_status: 'completed',
        report_type: 'final',
        updated_at: now,
        ...(printStorageUrl && { 
          print_pdf_url: printStorageUrl,
          print_pdf_generated_at: now
        })
      }
      
      // Fields for new record (includes required fields)
      const insertFields = {
        order_id: orderId,
        patient_id: patientId,
        lab_id: job.lab_id,  // Add lab_id for multi-lab filtering
        doctor: doctorName,
        generated_date: now,
        ...updateFields
      }
      
      if (existingReport) {
        const { error: updateError } = await supabaseClient
          .from('reports')
          .update(updateFields)
          .eq('id', existingReport.id)
        
        if (updateError) {
          console.error('⚠️ Report update error:', updateError)
        } else {
          console.log('✅ Updated existing report record with all fields')
        }
      } else {
        const { error: insertError } = await supabaseClient
          .from('reports')
          .insert(insertFields)
        
        if (insertError) {
          console.error('⚠️ Report insert error:', insertError)
          console.error('Insert data:', insertFields)
        } else {
          console.log('✅ Created new report record with all fields')
        }
      }
    } // End of if (patientId)
    
    // Mark job as completed - WITH ERROR CHECKING
    const { error: completeError } = await supabaseClient
      .from('pdf_generation_queue')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        progress_stage: 'Completed',
        progress_percent: 100
      })
      .eq('id', job.id)
    
    if (completeError) {
      console.error('⚠️ Failed to mark job as completed:', completeError)
      // Try again with simpler update
      const { error: retryError } = await supabaseClient
        .from('pdf_generation_queue')
        .update({ status: 'completed', progress_percent: 100 })
        .eq('id', job.id)
      
      if (retryError) {
        console.error('❌ Retry also failed:', retryError)
      } else {
        console.log('✅ Job marked complete on retry')
      }
    } else {
      console.log('✅ Job marked as COMPLETED in queue')
    }
    
    console.log('═══════════════════════════════════════════════════════════')
    console.log('✅ PDF GENERATION COMPLETE')
    console.log('eCopy URL:', storageUrl)
    console.log('Print URL:', printStorageUrl || 'Not generated')
    console.log('Job ID:', job.id)
    console.log('═══════════════════════════════════════════════════════════')

    return new Response(
      JSON.stringify({
        success: true,
        status: 'completed',
        pdfUrl: storageUrl,
        printPdfUrl: printStorageUrl,
        storagePath: eCopyResult.path,
        jobId: job.id,
        orderId,
        reportType: 'final'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

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
