// Supabase Edge Function: Full Server-Side PDF Generation with PDF.co
// Complete pipeline: Context → Templates → HTML → PDF.co → Storage

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import {
  fetchFrontBackPages,
  fetchLetterheadBackground,
  fetchLetterheadBackgroundForOrder,
  fetchHeaderFooterImages,
  imageUrlToBase64,
  buildHeaderHtml,
  buildFooterHtml,
} from "./headerFooterHelper.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Custom domain for reports storage (configured via Deno environment variable)
const CUSTOM_REPORTS_DOMAIN = Deno.env.get("CUSTOM_STORAGE_DOMAIN") || "";

/**
 * Get public URL for storage file with custom domain support
 */
function getPublicStorageUrl(bucket: string, path: string): string {
  if (bucket === "reports" && CUSTOM_REPORTS_DOMAIN) {
    const cleanPath = path.startsWith("/") ? path.slice(1) : path;
    return `${CUSTOM_REPORTS_DOMAIN}/${cleanPath}`;
  }

  // Fallback to Supabase default URL
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}

// ============================================================
// SECTION: Configuration & Constants
// ============================================================

const PDFCO_API_URL = "https://api.pdf.co/v1/pdf/convert/from/html";
const PDFCO_JOB_STATUS_URL = "https://api.pdf.co/v1/job/check";

// Default PDF settings (fallback if not in lab settings)
const DEFAULT_PDF_SETTINGS = {
  margins: "180px 20px 150px 20px", // top right bottom left
  headerHeight: "90px",
  footerHeight: "80px",
  scale: 1.0,
  paperSize: "A4",
  displayHeaderFooter: true,
  mediaType: "screen",
  printBackground: true,
};

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
  border: none;
  background: #fff;
}

.limsv2-report table thead th {
  background-color: #fff;
  color: var(--report-heading-color);
  border: none;
  border-top: 2px solid #000;
  border-bottom: 2px solid #000;
}

.limsv2-report table th,
.limsv2-report table td {
  border: none;
  padding: 10px 12px;
  text-align: left;
  vertical-align: top;
  background: #fff;
}

/* Abnormal values highlighting & Flags */
.result-abnormal, .abnormal, .flag-abnormal,
.result-high, .flag-high, .result-critical_high, .result-critical_h,
.result-low, .flag-low, .result-critical_low, .result-critical_l {
  color: #000000 !important;
  font-weight: bold;
}

.result-normal, .normal, .flag-normal {
  color: inherit;
  font-weight: normal;
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

.patient-info {
  page-break-inside: auto;
  break-inside: auto;
}

/* Ensure tables are visible */
figure.table {
  display: block;
  overflow: visible !important;
  margin: 1em 0;
}

/* =========================================
   TABLE PAGE BREAK HANDLING (PDF.co)
   Allow tables to break across pages naturally,
   but prevent breaking within individual rows
   ========================================= */
@media print {
  /* Allow tables to break across pages */
  table, .report-table, .limsv2-report table {
    page-break-inside: auto !important;
    break-inside: auto !important;
  }
  
  /* Prevent breaking within rows - keeps each row intact */
  tr, .limsv2-report tr {
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }
  
  /* Keep table headers with at least one row */
  thead {
    display: table-header-group;
  }
  
  /* Keep footer at bottom of table */
  tfoot {
    display: table-footer-group;
  }
  
  /* Ensure table body allows natural flow */
  tbody {
    page-break-inside: auto !important;
    break-inside: auto !important;
  }
  
  /* Keep section headers attached to following content */
  .test-group-header, .section-header, h3, h4 {
    page-break-after: avoid !important;
    break-after: avoid !important;
  }
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
  break-inside: auto;
  page-break-inside: auto;
}

.page-break-before {
  break-before: page;
  page-break-before: always;
}

/* Section content (doctor-filled sections) - with fallback values */
.section-content {
  font-family: var(--report-font-family, "Inter", Arial, sans-serif);
  color: var(--report-text-color, #1f2937);
  font-size: 13px;
  line-height: 1.7;
  margin: 0.5rem 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  position: relative;
  z-index: 2;
}

.section-content p {
  margin: 0.4rem 0;
  color: var(--report-text-color, #1f2937);
  line-height: 1.7;
  font-size: 13px;
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
  color: var(--report-heading-color, #111827);
}

.section-content em,
.section-content i {
  font-style: italic;
}

/* Section content lists */
.section-content ul,
.section-content ol {
  margin: 0.5rem 0;
  padding-left: 1.5rem;
  color: var(--report-text-color, #1f2937);
}

.section-content li {
  margin-bottom: 0.3rem;
  line-height: 1.6;
  font-size: 13px;
}

.section-content li:last-child {
  margin-bottom: 0;
}

/* Section headers within content */
.section-content h1,
.section-content h2,
.section-content h3,
.section-content h4,
.section-content h5,
.section-content h6 {
  font-family: var(--report-font-family, "Inter", Arial, sans-serif);
  color: var(--report-heading-color, #111827);
  font-weight: 600;
  margin: 0.75rem 0 0.5rem;
  line-height: 1.4;
}

.section-content h4 { font-size: 14px; }
.section-content h5 { font-size: 13px; }
.section-content h6 { font-size: 12px; }
`;

// ============================================================
// SECTION: Flag Determination System
// ============================================================

type FlagValue =
  | "normal"
  | "high"
  | "low"
  | "critical_high"
  | "critical_low"
  | "abnormal"
  | null;

interface ParsedRange {
  low: number | null;
  high: number | null;
  type: "range" | "less_than" | "greater_than" | "single" | "none";
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
  /^sterile$/i,
];

// Known abnormal text patterns
const ABNORMAL_TEXT_PATTERNS = [
  /^positive$/i,
  /^reactive$/i,
  /^detected$/i,
  /^present$/i,
  /^abnormal$/i,
  /^growth$/i,
];

// Semi-quantitative normal values
const SEMI_QUANT_NORMAL = ["nil", "negative", "trace", "±", "+-", "neg"];
const SEMI_QUANT_ABNORMAL_ORDER = [
  "1+",
  "+",
  "2+",
  "++",
  "3+",
  "+++",
  "4+",
  "++++",
];

/**
 * Parse reference range string into numeric bounds
 */
function parseReferenceRange(refRange: string | null | undefined): ParsedRange {
  if (!refRange || typeof refRange !== "string") {
    return { low: null, high: null, type: "none" };
  }

  const cleaned = refRange
    .replace(/\([^)]*\)/g, "") // Remove parenthetical notes
    .replace(/[a-zA-Z%\/]+/g, " ") // Remove units
    .replace(/,/g, "") // Remove commas
    .trim();

  // Pattern: "< X" or "≤ X"
  const lessThanMatch = cleaned.match(/[<≤]\s*([\d.]+)/);
  if (lessThanMatch) {
    return { low: null, high: parseFloat(lessThanMatch[1]), type: "less_than" };
  }

  // Pattern: "> X" or "≥ X"
  const greaterThanMatch = cleaned.match(/[>≥]\s*([\d.]+)/);
  if (greaterThanMatch) {
    return {
      low: parseFloat(greaterThanMatch[1]),
      high: null,
      type: "greater_than",
    };
  }

  // Pattern: "X - Y" or "X – Y" or "X to Y"
  const rangeMatch = cleaned.match(/([\d.]+)\s*[-–—~to]+\s*([\d.]+)/i);
  if (rangeMatch) {
    const low = parseFloat(rangeMatch[1]);
    const high = parseFloat(rangeMatch[2]);
    return {
      low: Math.min(low, high),
      high: Math.max(low, high),
      type: "range",
    };
  }

  // Single number
  const singleMatch = cleaned.match(/^([\d.]+)$/);
  if (singleMatch) {
    return { low: null, high: parseFloat(singleMatch[1]), type: "single" };
  }

  return { low: null, high: null, type: "none" };
}

/**
 * Extract numeric value from string
 */
function extractNumericValue(
  value: string | number | null | undefined,
): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;

  const cleaned = String(value).replace(/[,<>≤≥]/g, "").trim();
  const match = cleaned.match(/^-?([\d.]+)/);
  if (match) {
    const num = parseFloat(match[0]);
    return isNaN(num) ? null : num;
  }
  return null;
}

/**
 * Detect value type
 */
function detectValueType(
  value: string,
): "numeric" | "qualitative" | "semi_quantitative" | "descriptive" {
  const num = extractNumericValue(value);
  if (num !== null) return "numeric";

  const lower = value.toLowerCase().trim();

  if (/^[+-]+$/.test(value) || /^[1-4]\+$/.test(value) || lower === "trace") {
    return "semi_quantitative";
  }

  if (
    NORMAL_TEXT_PATTERNS.some((p) => p.test(lower)) ||
    ABNORMAL_TEXT_PATTERNS.some((p) => p.test(lower))
  ) {
    return "qualitative";
  }

  if (value.split(/\s+/).length > 3) {
    return "descriptive";
  }

  return "qualitative";
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
  expectedNormalValues?: string[],
): { flag: FlagValue; displayFlag: string } {
  if (value === null || value === undefined || value === "") {
    return { flag: null, displayFlag: "" };
  }

  const strValue = String(value).trim();
  const valueType = detectValueType(strValue);

  // Get appropriate reference range based on gender
  let effectiveRefRange = referenceRange;
  if (patientGender === "Male" && referenceRangeMale) {
    effectiveRefRange = referenceRangeMale;
  } else if (patientGender === "Female" && referenceRangeFemale) {
    effectiveRefRange = referenceRangeFemale;
  }

  let flag: FlagValue = null;

  if (valueType === "numeric") {
    const numValue = extractNumericValue(strValue);
    if (numValue !== null) {
      const lowCrit = extractNumericValue(lowCritical);
      const highCrit = extractNumericValue(highCritical);
      const { low, high, type } = parseReferenceRange(effectiveRefRange);

      // Critical checks first
      if (highCrit !== null && numValue >= highCrit) {
        flag = "critical_high";
      } else if (lowCrit !== null && numValue <= lowCrit) {
        flag = "critical_low";
      } else if (type === "range" && low !== null && high !== null) {
        if (numValue < low) flag = "low";
        else if (numValue > high) flag = "high";
        else flag = "normal";
      } else if (type === "less_than" && high !== null) {
        flag = numValue > high ? "high" : "normal";
      } else if (type === "greater_than" && low !== null) {
        flag = numValue < low ? "low" : "normal";
      }
    }
  } else if (valueType === "qualitative") {
    const lower = strValue.toLowerCase();

    // Check expected normal values first
    if (expectedNormalValues && expectedNormalValues.length > 0) {
      const normalVals = expectedNormalValues.map((v) => v.toLowerCase());
      flag = normalVals.some((nv) => lower === nv || lower.includes(nv))
        ? "normal"
        : "abnormal";
    } else {
      // Pattern matching
      if (NORMAL_TEXT_PATTERNS.some((p) => p.test(lower))) {
        flag = "normal";
      } else if (ABNORMAL_TEXT_PATTERNS.some((p) => p.test(lower))) {
        flag = "abnormal";
      }
    }
  } else if (valueType === "semi_quantitative") {
    const normalized = strValue.toLowerCase();
    if (SEMI_QUANT_NORMAL.includes(normalized)) {
      flag = "normal";
    } else {
      const upperValue = strValue.toUpperCase();
      if (
        SEMI_QUANT_ABNORMAL_ORDER.some((v) =>
          v === upperValue || v === strValue
        )
      ) {
        const index = SEMI_QUANT_ABNORMAL_ORDER.findIndex((v) =>
          v === upperValue || v === strValue
        );
        flag = index >= 4 ? "high" : "abnormal";
      }
    }
  }

  // Convert to display string
  const displayMap: Record<string, string> = {
    "normal": "",
    "high": "High",
    "low": "Low",
    "critical_high": "Critical High",
    "critical_low": "Critical Low",
    "abnormal": "Abnormal",
  };

  return {
    flag,
    displayFlag: flag ? (displayMap[flag] || "") : "",
  };
}

type CanonicalReportFlag =
  | "normal"
  | "high"
  | "low"
  | "critical"
  | "critical_high"
  | "critical_low"
  | "abnormal"
  | null;

function normalizeReportFlag(flag?: string | null): {
  canonical: CanonicalReportFlag;
  label: string;
} {
  const raw = String(flag || "").trim();
  if (!raw) {
    return { canonical: null, label: "" };
  }

  const norm = raw
    .toLowerCase()
    .replace(/[-\s]/g, "_")
    .replace(/[^a-z0-9_*]/g, "");

  if (["n", "normal", "ok", "wnl", "within_range"].includes(norm)) {
    return { canonical: "normal", label: "" };
  }
  if (["h", "high", "hh", "hi"].includes(norm)) {
    return { canonical: "high", label: "High" };
  }
  if (["l", "low", "ll"].includes(norm)) {
    return { canonical: "low", label: "Low" };
  }
  if (["c", "critical", "crit", "c*"].includes(norm)) {
    return { canonical: "critical", label: "Critical" };
  }
  if (
    ["critical_high", "critical_h", "criticalh", "high_critical", "criticalhigh", "h*", "ch"].includes(norm)
  ) {
    return { canonical: "critical_high", label: "Critical High" };
  }
  if (
    ["critical_low", "critical_l", "criticall", "low_critical", "criticallow", "l*", "cl"].includes(norm)
  ) {
    return { canonical: "critical_low", label: "Critical Low" };
  }
  if (["a", "abnormal", "abn"].includes(norm)) {
    return { canonical: "abnormal", label: "Abnormal" };
  }

  if (norm.includes("critical") && norm.includes("high")) {
    return { canonical: "critical_high", label: "Critical High" };
  }
  if (norm.includes("critical") && norm.includes("low")) {
    return { canonical: "critical_low", label: "Critical Low" };
  }
  if (norm.includes("critical")) {
    return { canonical: "critical", label: "Critical" };
  }
  if (norm.includes("high")) {
    return { canonical: "high", label: "High" };
  }
  if (norm.includes("low")) {
    return { canonical: "low", label: "Low" };
  }

  return { canonical: "abnormal", label: raw };
}

// ============================================================
// SECTION: Analyte Placeholder Generation (Hardcoded Support)
// ============================================================

/**
 * Generate a short key from analyte name for placeholder purposes
 */
function generateAnalyteShortKey(name: string): string {
  if (!name) return "";

  // Common abbreviations mapping

  const abbreviations: Record<string, string> = {
    "C-Reactive Protein (CRP), Quantitative": "CREACT",
    "C-Reactive Protein (CRP)": "CREACT",
    "C-Reactive Protein": "CRP",
    "Hemoglobin": "HB",
    "Hb (Hemoglobin)": "HB",
    "Hematocrit": "HCT",
    "Total White Blood Cell Count": "WBC",
    "Total Leukocyte Count": "TLC",
    "Red Blood Cell Count": "RBC",
    "Platelet Count": "PLT",
    "Mean Corpuscular Volume": "MCV",
    "Alanine Aminotransferase (ALT/SGPT)": "ALT",
    "ALT (SGPT)": "ALT",
    // 5-Part CBC differential — canonical names
    "Neutrophils (%)": "NEUT_PCT",
    "Neutrophils (Abs)": "NEUT_ABS",
    "Lymphocytes (%)": "LYMPH_PCT",
    "Lymphocytes (Abs)": "LYMPH_ABS",
    "Monocytes (%)": "MONO_PCT",
    "Monocytes (Abs)": "MONO_ABS",
    "Eosinophils (%)": "EOS_PCT",
    "Eosinophils (Abs)": "EOS_ABS",
    "Basophils (%)": "BASO_PCT",
    "Basophils (Abs)": "BASO_ABS",
    "ESR (After 1 hour)": "ESR",
  };

  if (abbreviations[name]) return abbreviations[name];

  // Check for abbreviations in parentheses
  const parenthesesMatch = name.match(/\(([A-Z]{2,})\)/);
  if (parenthesesMatch) return parenthesesMatch[1];

  // Generate from initials
  const cleaned = name.replace(/[^a-zA-Z0-9\s-]/g, "");
  const words = cleaned.split(/\s+/).filter((w) => w.length > 0);

  if (words.length === 0) return "";
  if (words.length === 1) {
    return words[0].substring(0, Math.min(4, words[0].length)).toUpperCase();
  }

  const initials = words.map((w) => w[0]).join("").toUpperCase();
  if (initials.length < 3 && words[0].length > 1) {
    return (words[0].substring(0, 3) + initials.substring(1)).toUpperCase();
  }

  return initials;
}

/**
 * Convert flag value to CSS classes for template styling
 * Returns valueClass, flagClass, and normalized flagText
 */
function toFlagClass(flag?: string | null) {
  const normalized = normalizeReportFlag(flag);
  const canonical = normalized.canonical;

  if (!canonical || canonical === "normal") {
    return {
      valueClass: "value-normal",
      flagClass: "flag-normal",
      flagText: "",
    };
  }

  if (canonical === "low") {
    return { valueClass: "value-low", flagClass: "flag-low", flagText: "Low" };
  }
  if (canonical === "high") {
    return {
      valueClass: "value-high",
      flagClass: "flag-high",
      flagText: "High",
    };
  }

  if (canonical === "critical_high") {
    return {
      valueClass: "value-critical_h",
      flagClass: "flag-critical_h",
      flagText: "Critical High",
    };
  }
  if (canonical === "critical_low") {
    return {
      valueClass: "value-critical_l",
      flagClass: "flag-critical_l",
      flagText: "Critical Low",
    };
  }
  if (canonical === "critical") {
    return {
      valueClass: "value-abnormal",
      flagClass: "flag-abnormal",
      flagText: "Critical",
    };
  }
  if (canonical === "abnormal") {
    return {
      valueClass: "value-abnormal",
      flagClass: "flag-abnormal",
      flagText: normalized.label || "Abnormal",
    };
  }

  // abnormal / anything else
  return {
    valueClass: "value-abnormal",
    flagClass: "flag-abnormal",
    flagText: normalized.label,
  };
}

/**
 * Generate analyte-specific placeholders for templates
 * Creates both short keys (ANALYTE_HB_VALUE) and full slugs (Hemoglobin_VALUE)
 * Now includes CSS classes for styling: _VALUE_CLASS, _FLAG_CLASS, _FLAG_TEXT
 */
function generateAnalytePlaceholders(analytes: any[]): Record<string, any> {
  const placeholders: Record<string, any> = {};

  if (!analytes || analytes.length === 0) return placeholders;

  analytes.forEach((analyte) => {
    const name = analyte.parameter || analyte.name || analyte.test_name || "";
    if (!name) return;

    // Get CSS classes from flag
    const { valueClass, flagClass, flagText } = toFlagClass(analyte.flag);
    const normalizedFlag = normalizeReportFlag(analyte.flag);
    const normalizedFlagLabel = normalizedFlag.label;

    // 1. Existing Short Key Logic (ANALYTE_HB_VALUE)
    const shortKey = generateAnalyteShortKey(name);
    if (shortKey) {
      placeholders[`ANALYTE_${shortKey}_VALUE`] = analyte.value || "";
      placeholders[`ANALYTE_${shortKey}_UNIT`] = analyte.unit || "";
      placeholders[`ANALYTE_${shortKey}_REFERENCE`] = analyte.reference_range ||
        "";
      placeholders[`ANALYTE_${shortKey}_FLAG`] = normalizedFlagLabel;
      placeholders[`ANALYTE_${shortKey}_FLAG_RAW`] = analyte.flag || "";
      placeholders[`ANALYTE_${shortKey}_METHOD`] = analyte.method || "";
      placeholders[`ANALYTE_${shortKey}_DISPLAYFLAG`] = analyte.displayFlag ||
        normalizedFlagLabel;
      // NEW: CSS class placeholders
      placeholders[`ANALYTE_${shortKey}_FLAG_TEXT`] = flagText;
      placeholders[`ANALYTE_${shortKey}_FLAG_CLASS`] = flagClass;
      placeholders[`ANALYTE_${shortKey}_VALUE_CLASS`] = valueClass;
    }

    // 2. New Full Slug Logic (Hemoglobin_VALUE) - Matches Frontend Picker
    // Slugify: "Hemoglobin (Hb)" -> "HemoglobinHb"
    const slug = name.replace(/[^a-zA-Z0-9]+/g, " ").trim().replace(/\s+/g, "");
    if (slug) {
      // Direct values
      placeholders[`${slug}`] = analyte.value || ""; // {{Hemoglobin}}

      // Suffix variations
      placeholders[`${slug}_VALUE`] = analyte.value || "";
      placeholders[`${slug}_UNIT`] = analyte.unit || "";
      placeholders[`${slug}_REF_RANGE`] = analyte.reference_range || ""; // Matching _REF_RANGE from frontend
      placeholders[`${slug}_REFERENCE`] = analyte.reference_range || ""; // Alias
      placeholders[`${slug}_FLAG`] = normalizedFlagLabel;
      placeholders[`${slug}_FLAG_RAW`] = analyte.flag || "";
      placeholders[`${slug}_DISPLAYFLAG`] = analyte.displayFlag || normalizedFlagLabel;
      placeholders[`${slug}_NOTE`] = analyte.notes || analyte.comments || "";
      placeholders[`${slug}_METHOD`] = analyte.method || "";
      // NEW: CSS class placeholders
      placeholders[`${slug}_FLAG_TEXT`] = flagText;
      placeholders[`${slug}_FLAG_CLASS`] = flagClass;
      placeholders[`${slug}_VALUE_CLASS`] = valueClass;
    }

    // 3. UPPER_SNAKE_CASE format for templates like {{ANALYTE_WHITE_BLOOD_CELL_COUNT_VALUE}}
    // Convert "White Blood Cell Count" -> "WHITE_BLOOD_CELL_COUNT"
    const upperSnakeKey = name
      .replace(/[^a-zA-Z0-9\s]/g, "") // Remove special chars except spaces
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "_"); // Replace spaces with underscores

    if (upperSnakeKey && upperSnakeKey !== shortKey) {
      placeholders[`ANALYTE_${upperSnakeKey}_VALUE`] = analyte.value || "";
      placeholders[`ANALYTE_${upperSnakeKey}_UNIT`] = analyte.unit || "";
      placeholders[`ANALYTE_${upperSnakeKey}_REFERENCE`] =
        analyte.reference_range || "";
      placeholders[`ANALYTE_${upperSnakeKey}_FLAG`] = normalizedFlagLabel;
      placeholders[`ANALYTE_${upperSnakeKey}_FLAG_RAW`] = analyte.flag || "";
      placeholders[`ANALYTE_${upperSnakeKey}_DISPLAYFLAG`] =
        analyte.displayFlag || normalizedFlagLabel;
      placeholders[`ANALYTE_${upperSnakeKey}_METHOD`] = analyte.method || "";
      placeholders[`ANALYTE_${upperSnakeKey}_FLAG_TEXT`] = flagText;
      placeholders[`ANALYTE_${upperSnakeKey}_FLAG_CLASS`] = flagClass;
      placeholders[`ANALYTE_${upperSnakeKey}_VALUE_CLASS`] = valueClass;
    }
  });

  // Debug: Show all placeholder keys with _VALUE suffix
  const valueKeys = Object.keys(placeholders).filter((k) =>
    k.endsWith("_VALUE")
  );
  console.log("📋 Generated analyte placeholders:");
  console.log("   Total keys:", Object.keys(placeholders).length);
  console.log(
    "   VALUE keys:",
    valueKeys.slice(0, 20).join(", "),
    valueKeys.length > 20 ? `... (${valueKeys.length} total)` : "",
  );

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
  if (!html) return "";

  let result = html;

  // Replace {{ variable }} patterns
  result = result.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, key) => {
    const trimmedKey = key.trim();
    const value = getNestedValue(context, trimmedKey);

    if (value === undefined || value === null) {
      return ""; // Empty string for missing values
    }

    if (typeof value === "object") {
      return JSON.stringify(value);
    }

    return String(value);
  });

  return result;
}

/**
 * Inject signature image into rendered HTML - ROBUST VERSION
 * Always injects into .signatures or .report-footer if present, never truncates content
 */
function injectSignatureImage(
  html: string,
  signatoryImageUrl: string,
  signatoryName: string = "",
  signatoryDesignation: string = "",
): string {
  if (!html || !signatoryImageUrl) {
    console.log("  ⚠️ Missing required params for signature injection");
    return html;
  }

  // Already present?
  if (html.includes(`src="${signatoryImageUrl}"`)) {
    console.log("  ✅ Signature image already present");
    return html;
  }

  // Build complete signature block with image and text
  const signatureBlockHtml = `
    <div style="margin-top: 10px;">
      <img src="${signatoryImageUrl}" alt="Signature" style="display:block;max-height:40px;max-width:120px;width:auto;height:auto;object-fit:contain;margin-top:5px;margin-bottom:0px;" />
      ${
    signatoryName
      ? `<p style="margin-top:8px;margin-bottom:4px;font-weight:600;font-size:14px;">${signatoryName}</p>`
      : ""
  }
      ${
    signatoryDesignation
      ? `<p style="margin-top:0;color:#64748b;font-size:12px;">${signatoryDesignation}</p>`
      : ""
  }
    </div>
  `.trim();

  console.log(
    `  🔍 Looking for .signatures or .report-footer block (name: ${signatoryName})`,
  );

  // 1. PRIORITY: Inject into .signatures block (most common)
  const signaturesPattern = /(<div[^>]*class="[^"]*signatures[^"]*"[^>]*>)/i;
  if (signaturesPattern.test(html)) {
    console.log("  ✅ Found .signatures block - injecting signature");
    return html.replace(signaturesPattern, `$1${signatureBlockHtml}`);
  }

  // 2. Inject into .report-footer block
  const footerPattern = /(<div[^>]*class="[^"]*report-footer[^"]*"[^>]*>)/i;
  if (footerPattern.test(html)) {
    console.log("  ✅ Found .report-footer block - injecting signature");
    return html.replace(footerPattern, `$1${signatureBlockHtml}`);
  }

  // 3. Look for any signatory/approver related classes
  const signatoryPattern =
    /(<div[^>]*class="[^"]*(?:signatory|signature-block|approver|signer)[^"]*"[^>]*>)/i;
  if (signatoryPattern.test(html)) {
    console.log("  ✅ Found signatory-related block - injecting signature");
    return html.replace(signatoryPattern, `$1${signatureBlockHtml}`);
  }

  // 4. Fallback: inject before closing </section> with report-region--body class
  const sectionPattern = /(<\/section>)/i;
  if (sectionPattern.test(html)) {
    console.log("  ⚠️ Fallback: injecting before </section>");
    return html.replace(
      sectionPattern,
      `<div style="margin-top:20px;">${signatureBlockHtml}</div>$1`,
    );
  }

  // 5. Last resort: inject before closing </body>
  if (html.includes("</body>")) {
    console.log("  ⚠️ Last resort: injecting before </body>");
    return html.replace(
      "</body>",
      `<div style="margin:20px;">${signatureBlockHtml}</div></body>`,
    );
  }

  // 6. Absolute last resort: Append to end of HTML string (for partials/sections)
  console.log(
    "  ⚠️ Absolute last resort: Appending signature to end of HTML string",
  );
  return html +
    `<div style="margin-top:20px; page-break-inside: avoid;">${signatureBlockHtml}</div>`;
}

/**
 * Inject QR verification code into rendered HTML
 * Looks for .signatures, .report-footer, .qr-verify blocks or creates one
 * Places QR on left side of signature area
 */
function injectQrCode(html: string, verifyUrl: string): string {
  if (!html || !verifyUrl) {
    console.log("  ⚠️ Missing required params for QR injection");
    return html;
  }

  // Already has QR code?
  if (html.includes("qr-verify") || html.includes("api.qrserver.com")) {
    console.log("  ✅ QR code already present in template");
    return html;
  }

  // Build QR block HTML
  const qrBlockHtml = `
    <div class="qr-verify" style="text-align:left;">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${
    encodeURIComponent(verifyUrl)
  }" 
           alt="Verify Report" 
           style="width:60px;height:60px;" />
      <p style="margin:2px 0 0 0;font-size:9px;color:#6b7280;">Scan to verify</p>
    </div>
  `.trim();

  console.log(`  🔍 Looking for signature block to add QR code`);

  // 1. PRIORITY: Look for .signatures block - wrap content in flex container
  const signaturesPattern =
    /(<div[^>]*class="[^"]*signatures[^"]*"[^>]*>)([\s\S]*?)(<\/div>\s*$|<\/div>\s*<\/|<\/div>\s*<section|<\/div>\s*<div class="(?:attachments|interpretation))/i;
  if (signaturesPattern.test(html)) {
    console.log("  ✅ Found .signatures block - adding QR with flex layout");
    return html.replace(
      signaturesPattern,
      (match, openTag, content, closeOrNext) => {
        // Modify the opening tag to add flex styles
        const flexOpenTag = openTag.replace(
          /style="([^"]*)"/,
          'style="$1;display:flex;justify-content:space-between;align-items:flex-end;"',
        )
          .replace(
            />$/,
            ' style="display:flex;justify-content:space-between;align-items:flex-end;">',
          );
        // If style was already there, the first replace worked. If not, the second adds it.
        const finalOpenTag = openTag.includes("style=")
          ? openTag.replace(
            /style="([^"]*)"/,
            'style="$1;display:flex;justify-content:space-between;align-items:flex-end;"',
          )
          : openTag.replace(
            />$/,
            ' style="display:flex;justify-content:space-between;align-items:flex-end;">',
          );

        return `${finalOpenTag}${qrBlockHtml}<div style="text-align:right;">${content}</div>${closeOrNext}`;
      },
    );
  }

  // 2. Look for .report-footer block
  const footerPattern = /(<div[^>]*class="[^"]*report-footer[^"]*"[^>]*>)/i;
  if (footerPattern.test(html)) {
    console.log("  ✅ Found .report-footer block - prepending QR");
    return html.replace(footerPattern, `$1${qrBlockHtml}`);
  }

  // 3. Look for signatory/signature-block classes
  const signatoryPattern =
    /(<div[^>]*class="[^"]*(?:signatory|signature-block|approver|signer)[^"]*"[^>]*>)/i;
  if (signatoryPattern.test(html)) {
    console.log("  ✅ Found signatory block - prepending QR");
    return html.replace(
      signatoryPattern,
      `<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:20px;">${qrBlockHtml}$1</div>`,
    );
  }

  // 4. Fallback: inject before </section>
  const sectionPattern = /(<\/section>)/i;
  if (sectionPattern.test(html)) {
    console.log("  ⚠️ Fallback: adding QR before </section>");
    return html.replace(
      sectionPattern,
      `<div style="margin-top:20px;text-align:left;">${qrBlockHtml}</div>$1`,
    );
  }

  // 5. Last resort: inject before </body>
  if (html.includes("</body>")) {
    console.log("  ⚠️ Last resort: adding QR before </body>");
    return html.replace(
      "</body>",
      `<div style="margin:20px;text-align:left;">${qrBlockHtml}</div></body>`,
    );
  }

  // 6. Absolute last resort: Append to end
  console.log("  ⚠️ Absolute last resort: Appending QR to end of HTML");
  return html +
    `<div style="margin-top:20px;text-align:left;">${qrBlockHtml}</div>`;
}

/**
 * Get nested value from object using dot notation
 * e.g., getNestedValue({patient: {name: 'John'}}, 'patient.name') => 'John'
 */
function getNestedValue(obj: Record<string, any>, path: string): any {
  const keys = path.split(".");
  let current = obj;

  for (const key of keys) {
    if (current === undefined || current === null) {
      return undefined;
    }
    current = current[key];
  }

  return current;
}

// ============================================================
// SECTION: HTML Document Builders
// ============================================================

/**
 * Generate dynamic CSS based on lab settings (colors, fonts, etc.)
 * @param settings - pdfLayoutSettings from labs table
 * @param printOptions - merged print options (lab printOptions + test-group print_options override)
 */
function generateDynamicCss(settings: any, printOptions?: any): string {
  const hasPrintOptions = printOptions && Object.keys(printOptions).length > 0;
  if (!settings || (!settings.resultColors && !settings.headerTextColor && !hasPrintOptions)) {
    return "";
  }

  let css = "/* Dynamic PDF Settings */\n";

  // Header Text Color - target all possible header classes
  if (settings.headerTextColor && settings.headerTextColor !== "inherit") {
    const color = settings.headerTextColor === "white"
      ? "#ffffff"
      : settings.headerTextColor;
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
    `;
  }

  // Result Colors
  if (settings.resultColors && settings.resultColors.enabled) {
    const { high, low, normal } = settings.resultColors;
    if (high) {
      css +=
        `.result-high, .flag-high, .result-critical_high, .result-critical-high, .result-critical_h, .result-H, .result-HH { color: ${high} !important; }\n`;
      css +=
        `.result-abnormal, .flag-abnormal, .result-A { color: ${high} !important; }\n`;
    }
    if (low) {
      css +=
        `.result-low, .flag-low, .result-critical_low, .result-critical-low, .result-critical_l, .result-L, .result-LL { color: ${low} !important; }\n`;
    }
    if (normal) {
      css +=
        `.result-normal, .flag-normal, .result-N { color: ${normal} !important; }\n`;
    }
  }

  // ── Print Options overrides (lab-level + test-group-level) ──────────────────
  if (hasPrintOptions) {
    css += "\n/* Print Options Overrides */\n";

    // Remove table borders
    if (printOptions.tableBorders === false) {
      css += `
.report-table, .report-table tr, .report-table th, .report-table td,
.patient-info table, .patient-info tr, .patient-info td, .patient-info th,
.limsv2-report table, .limsv2-report tr, .limsv2-report th, .limsv2-report td {
  border: none !important;
  border-top: none !important;
  border-bottom: none !important;
  border-left: none !important;
  border-right: none !important;
}
.report-table thead tr, .report-table thead th { border: none !important; }
.report-table tbody tr, .report-table tbody tr td { border: none !important; }
`;
    }

    // Hide flag column (last column in classic layout)
    if (printOptions.flagColumn === false) {
      css += `
.report-table th:last-child,
.report-table td:last-child { display: none !important; }
`;
    }

    // Custom table header background color
    if (printOptions.headerBackground) {
      const bg = printOptions.headerBackground;
      const textColor = printOptions.headerTextColor || "#ffffff";
      css += `
.report-table thead tr th {
  background: ${bg} !important;
  background-color: ${bg} !important;
  color: ${textColor} !important;
}
`;
    }

    // Disable alternate row shading
    if (printOptions.alternateRows === false) {
      css += `
.report-table tbody tr:nth-child(even) td,
.report-table tbody tr:nth-child(even) { background: #ffffff !important; background-color: #ffffff !important; }
`;
    }

    // Base font size
    if (printOptions.baseFontSize && typeof printOptions.baseFontSize === "number") {
      const fs = Math.min(Math.max(printOptions.baseFontSize, 8), 16);
      css += `
.limsv2-report, .report-table td, .report-table th,
.patient-info td, .patient-info th { font-size: ${fs}px !important; }
`;
    }
  }

  return css;
}

/**
 * Merge lab-level printOptions (from pdf_layout_settings.printOptions) with
 * test-group-level print_options. Test-group values win over lab values.
 * Returns null if no options set at either level.
 */
function mergePrintOptions(
  labLayoutSettings: any,
  testGroupPrintOptions?: any,
): any | null {
  const labOpts = labLayoutSettings?.printOptions || null;
  const groupOpts = testGroupPrintOptions || null;
  if (!labOpts && !groupOpts) return null;
  return { ...(labOpts || {}), ...(groupOpts || {}) };
}

// ── Configurable Patient Info Section Builder ──
interface PatientInfoConfig {
  layout: 'table' | 'inline';
  fields: string[];
}

const PATIENT_INFO_FIELD_MAP: Record<string, { label: string; placeholder: string }> = {
  patientName:          { label: 'Patient Name',     placeholder: '{{patientName}}' },
  patientId:            { label: 'Patient ID',       placeholder: '{{patientId}}' },
  age:                  { label: 'Age',              placeholder: '{{patientAge}}' },
  gender:               { label: 'Gender',           placeholder: '{{patientGender}}' },
  collectionDate:       { label: 'Collected On',     placeholder: '{{collectionDate}}' },
  sampleId:             { label: 'Sample ID',        placeholder: '{{sampleId}}' },
  referringDoctorName:  { label: 'Ref. Doctor',      placeholder: '{{referringDoctorName}}' },
  approvedAt:           { label: 'Approved On',      placeholder: '{{approvedAt}}' },
  phone:                { label: 'Phone',            placeholder: '{{patientPhone}}' },
  sampleCollectedBy:    { label: 'Collected By',     placeholder: '{{sampleCollectedBy}}' },
};

function buildPatientInfoHtml(
  config: PatientInfoConfig,
  accentColor = '#5a7f3a',
  extraFieldConfigs?: Array<{ field_key: string; label: string }>,
): string {
  // Build dynamic lookup for custom_* keys from lab's field configs
  const customFieldMap: Record<string, { label: string; placeholder: string }> = {};
  if (extraFieldConfigs) {
    for (const f of extraFieldConfigs) {
      customFieldMap[`custom_${f.field_key}`] = {
        label: f.label,
        placeholder: `{{custom_${f.field_key}}}`,
      };
    }
  }

  const fields = config.fields
    .map(key => {
      if (PATIENT_INFO_FIELD_MAP[key]) return PATIENT_INFO_FIELD_MAP[key];
      if (customFieldMap[key]) return customFieldMap[key];
      // Fallback: derive label from key name (e.g. custom_abha_id → "Abha Id")
      if (key.startsWith('custom_')) {
        const rawKey = key.replace(/^custom_/, '');
        const label = rawKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        return { label, placeholder: `{{${key}}}` };
      }
      return undefined;
    })
    .filter(Boolean) as Array<{ label: string; placeholder: string }>;

  if (fields.length === 0) return '';

  if (config.layout === 'table') {
    // Table layout — 2 columns of label/value pairs per row
    const rows: string[] = [];
    for (let i = 0; i < fields.length; i += 2) {
      const f1 = fields[i];
      const f2 = fields[i + 1];
      rows.push(`<tr>
        <td style="padding: 8px 12px; border: 1px solid #e5e7eb; background: #f9fafb; width: 25%; font-weight: 500;">${f1.label}</td>
        <td style="padding: 8px 12px; border: 1px solid #e5e7eb; width: 25%;">${f1.placeholder}</td>
        ${f2 ? `<td style="padding: 8px 12px; border: 1px solid #e5e7eb; background: #f9fafb; width: 25%; font-weight: 500;">${f2.label}</td>
        <td style="padding: 8px 12px; border: 1px solid #e5e7eb; width: 25%;">${f2.placeholder}</td>` : `<td colspan="2" style="border: 1px solid #e5e7eb;"></td>`}
      </tr>`);
    }
    return `
    <div class="patient-info" style="page-break-inside: avoid;">
      <h3 style="font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px;">Patient Information</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
  }

  // Inline layout — flex row of spans (beautiful style)
  // First field (usually patientName) gets prominent heading treatment
  const firstField = fields[0];
  const restFields = fields.slice(1);
  const spans = restFields.map(f => `<span><strong>${f.label}:</strong> ${f.placeholder}</span>`).join('\n        ');

  return `
    <div class="patient-info" style="margin-bottom: 16px; padding: 12px 16px; background: #ffffff; border: 1px solid #d1d5db; border-radius: 4px; page-break-inside: avoid;">
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
        <div style="font-size: 16px; font-weight: 700; color: ${accentColor};">
          ${firstField.placeholder}
        </div>
        <div style="font-size: 11px; color: #6b7280;">
          {{approvedAtFormatted}}
        </div>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: #374151;">
        ${spans}
      </div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helper: sort analytes by sort_order and group by section_heading.
//
// Returns an array of { heading: string | null, analytes: any[] } blocks.
// Analytes with no section_heading (or all the same heading) are treated as
// a single block with heading = null.
// ─────────────────────────────────────────────────────────────────────────────
function groupAnalytesBySectionHeading(
  analytes: any[],
): { heading: string | null; analytes: any[] }[] {
  // Sort: defined sort_order first (ascending), then by insertion order
  const sorted = [...analytes].sort((a, b) => {
    const oa = a.sort_order ?? 0;
    const ob = b.sort_order ?? 0;
    return oa - ob;
  });
  console.log("📊 Analyte sort order:", sorted.map(a => `${a.parameter}(sort_order=${a.sort_order ?? 'null'})`).join(', '));

  // Check if any analyte has a section_heading
  const hasHeadings = sorted.some((a) => a.section_heading);
  if (!hasHeadings) {
    return [{ heading: null, analytes: sorted }];
  }

  // Group into consecutive blocks sharing the same heading
  const blocks: { heading: string | null; analytes: any[] }[] = [];
  let currentHeading: string | null = null;
  let currentBlock: any[] = [];

  for (const analyte of sorted) {
    const h = analyte.section_heading ?? null;
    if (h !== currentHeading) {
      if (currentBlock.length > 0) {
        blocks.push({ heading: currentHeading, analytes: currentBlock });
      }
      currentHeading = h;
      currentBlock = [analyte];
    } else {
      currentBlock.push(analyte);
    }
  }
  if (currentBlock.length > 0) {
    blocks.push({ heading: currentHeading, analytes: currentBlock });
  }
  return blocks;
}

/**
 * Classic default template - plain table with flag text styling.
 * This is the original default template before the 3-band color matrix was added.
 */
function generateClassicDefaultTemplateHtml(
  context: any,
  testGroupNames: Map<string, string>,
  analytesByGroup: Map<string, any[]>,
  signatoryInfo: any,
  sectionContent?: Record<string, string>,
  includeSections = true,
  showMethodology = true,
  showInterpretation = false,
  patientInfoConfig?: PatientInfoConfig | null,
  printOptions?: Record<string, unknown>,
  extraFieldConfigs?: Array<{ field_key: string; label: string }>,
): string {
  const normalizedSectionContent =
    sectionContent && typeof sectionContent === "object" ? sectionContent : {};

  // Patient Information Section
  const patientInfoHtml = patientInfoConfig
    ? buildPatientInfoHtml(patientInfoConfig, '#5a7f3a', extraFieldConfigs)
    : `
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
  `;

  // Test Results Section
  let testResultsHtml = '<div class="test-results">';
  testResultsHtml += '<h3 style="font-size: 14px; font-weight: 600; color: #1e40af; margin-bottom: 8px; border-bottom: 2px solid #3b82f6; padding-bottom: 4px;">Test Results</h3>';

  for (const [groupId, analytes] of analytesByGroup) {
    if (!analytes || analytes.length === 0) continue;

    const groupName = testGroupNames.get(groupId) || analytes[0]?.test_name || "Test Results";
    const sectionBlocks = groupAnalytesBySectionHeading(analytes);

    testResultsHtml += `
      <div class="test-group-section" style="margin-bottom: 16px;">
        <h4 style="font-size: 16px; font-weight: 600; color: #1e40af; padding: 6px 0; margin: 0;">${groupName}</h4>
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
    `;

    let rowIndexGlobal = 0;
    for (const block of sectionBlocks) {
      // Render section sub-heading row if present
      if (block.heading) {
        testResultsHtml += `
            <tr>
              <td colspan="5" style="padding: 6px 12px; background: #f1f5f9; font-weight: 600; font-size: 11px; color: #374151; border: 1px solid #e5e7eb;">${block.heading}</td>
            </tr>
        `;
      }
      for (const analyte of block.analytes) {
        const rowBg = rowIndexGlobal++ % 2 === 0 ? "#ffffff" : "#f8fafc";
        const parameterName = analyte.parameter || analyte.name || analyte.test_name || "";
        const value = analyte.value ?? "";
        const unit = analyte.unit || "";
        const refRange = analyte.reference_range || "";
        const flag = analyte.flag || "";
        const normalizedFlag = normalizeReportFlag(flag);
        const canonicalFlag = normalizedFlag.canonical;
        const displayFlag = normalizedFlag.label;

        const unitText = String(unit || "").trim().toLowerCase();
        const refText = String(refRange || "").trim();
        const hasNumericRef = /\d/.test(refText);
        const isDescriptive =
          unitText === "n/a" || unitText === "na" || unitText === "-" ||
          unitText === "none" || unitText === "not applicable" ||
          (!unitText && refText && !hasNumericRef);

        let flagStyle = "";
        let flagClass = "";

        if (canonicalFlag === "high" || canonicalFlag === "critical_high") {
          flagStyle = "color: #dc2626; font-weight: bold;";
          flagClass = "result-high flag-high";
        } else if (canonicalFlag === "low" || canonicalFlag === "critical_low") {
          flagStyle = "color: #ea580c; font-weight: bold;";
          flagClass = "result-low flag-low";
        } else if (canonicalFlag === "normal") {
          flagStyle = "color: #16a34a;";
          flagClass = "result-normal flag-normal";
        } else if (canonicalFlag === "critical") {
          flagStyle = "color: #7c2d12; font-weight: bold;";
          flagClass = "result-critical flag-critical";
        } else if (canonicalFlag === "abnormal") {
          flagStyle = "color: #dc2626; font-weight: bold;";
          flagClass = "result-abnormal flag-abnormal";
        }

        if (isDescriptive) {
          testResultsHtml += `
              <tr style="background: ${rowBg};">
                <td colspan="5" style="padding: 10px 12px; border: 1px solid #e5e7eb;">
                  <strong>${parameterName}:</strong> ${value || refText || ""}
                </td>
              </tr>
          `;
          continue;
        }

        testResultsHtml += `
              <tr style="background: ${rowBg};">
                <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">
                  ${parameterName}${(analyte.is_auto_calculated || analyte.is_calculated) ? '<sup style="font-size:8px;color:#6b7280;margin-left:2px;font-style:italic;">*calc</sup>' : ''}
                  ${showMethodology && analyte.method ? `<div style="font-size: 9px; color: #9ca3af; margin-top: 2px;">${analyte.method}</div>` : ""}
                </td>
                <td class="${flagClass}" style="padding: 8px 12px; border: 1px solid #e5e7eb; ${flagStyle}">${value}${printOptions?.flagAsterisk && (canonicalFlag === 'high' || canonicalFlag === 'low' || canonicalFlag === 'critical_high' || canonicalFlag === 'critical_low') ? (printOptions?.flagAsteriskCritical && (canonicalFlag === 'critical_high' || canonicalFlag === 'critical_low') ? '**' : '*') : ''}</td>
                <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${unit}</td>
                <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${refRange}</td>
                <td class="${flagClass}" style="padding: 8px 12px; border: 1px solid #e5e7eb; text-align: center; ${flagStyle}">${displayFlag}</td>
              </tr>
        `;

        if (showInterpretation) {
          let classicInterpretation = "";
          if (canonicalFlag === "high" || canonicalFlag === "critical_high") {
            classicInterpretation = analyte.interpretation_high || "";
          } else if (canonicalFlag === "low" || canonicalFlag === "critical_low") {
            classicInterpretation = analyte.interpretation_low || "";
          } else {
            classicInterpretation = analyte.interpretation_normal || "";
          }
          if (classicInterpretation) {
            testResultsHtml += `
              <tr style="background: ${rowBg};">
                <td colspan="5" style="padding: 2px 12px 6px 24px; border: 1px solid #e5e7eb; border-top: none; font-size: 11px; color: #6b7280; font-style: italic;">
                  <strong>Interpretation:</strong> ${classicInterpretation}
                </td>
              </tr>
            `;
          }
        }
      } // end for analyte
    } // end for block

    testResultsHtml += `
          </tbody>
        </table>
        ${analytes.some((a: any) => a.is_auto_calculated || a.is_calculated) ? '<p style="font-size:9px;color:#9ca3af;margin:2px 0 8px;font-style:italic;">*calc \u2013 Calculated parameter</p>' : ''}
      </div>
    `;
  }

  testResultsHtml += "</div>";

  // Signatory Section
  const sigName = signatoryInfo?.signatoryName || "";
  const sigDesignation = signatoryInfo?.signatoryDesignation || "";
  const sigImageUrl = signatoryInfo?.signatoryImageUrl || "";

  const signatoryHtml = `
    <div class="signatures" style="margin-top: 20px; text-align: right; page-break-inside: avoid;">
      ${sigImageUrl ? `<img src="${sigImageUrl}" alt="Signature" style="max-height: 50px; max-width: 150px; margin-bottom: 5px;" />` : ""}
      ${sigName ? `<p style="margin: 0; font-weight: 600; font-size: 14px;">${sigName}</p>` : ""}
      ${sigDesignation ? `<p style="margin: 4px 0 0 0; color: #64748b; font-size: 12px;">${sigDesignation}</p>` : ""}
    </div>
  `;

  const buildSectionLabel = (key: string) => {
    const { rawKey } = normalizeSectionKey(key);
    if (!rawKey) return "Report Section";
    return rawKey
      .replace(/[_-]+/g, " ")
      .split(" ")
      .filter(Boolean)
      .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  };

  let reportSectionsHtml = "";
  if (includeSections && Object.keys(normalizedSectionContent).length > 0) {
    const sectionItems = Object.entries(normalizedSectionContent)
      .filter(([, content]) => content && String(content).trim().length > 0)
      .map(([key, content]) => {
        const formatted = formatSectionContentToHtml(String(content));
        if (!formatted) return "";
        const heading = buildSectionLabel(key);
        return `
          <div style="margin-top: 12px;">
            <h4 style="font-size: 13px; font-weight: 600; color: #111827; margin: 0 0 6px;">${heading}</h4>
            ${formatted}
          </div>
        `;
      })
      .filter(Boolean)
      .join("");

    if (sectionItems) {
      reportSectionsHtml = `
        <div class="report-sections" style="margin-top: 18px;">
          <h3 style="font-size: 14px; font-weight: 600; color: #111827; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px;">Report Sections</h3>
          ${sectionItems}
        </div>
      `;
    }
  }

  return `
    <div class="default-report-template">
      ${patientInfoHtml}
      ${testResultsHtml}
      ${reportSectionsHtml}
      ${signatoryHtml}
    </div>
  `;
}

/**
 * "Basic" template — old-school plain layout matching traditional printed lab reports.
 *
 * Design rules:
 *  - "TEST REPORT" title bar with 1.5px border top/bottom
 *  - Patient info as figure.table with <th> labels (15%) + <td> values (35%)
 *  - 4 columns: TEST NAME (55%) | VALUE (15%) | UNITS (10%) | Bio. Ref. Interval (20%)
 *  - Column header row: 1.5px solid border top/bottom only — no cell borders
 *  - Group name as center-title (underlined, uppercase) inside main-group-row
 *  - Section headings: sub-section-header class (uppercase, small, bold)
 *  - High flags → red (#dc2626) bold; Low flags → black bold; Qualitative abnormal → black bold
 *  - Test name bold, method italic small below it, calculated marker *
 *  - Footer: flex layout — "Authenticated Electronic Report" left, signature right
 *  - Font size controllable via printOptions.baseFontSize (lab-level setting)
 */
function generateBasicDefaultTemplateHtml(
  _context: unknown,
  testGroupNames: Map<string, string>,
  analytesByGroup: Map<string, any[]>,
  signatoryInfo: any,
  sectionContent?: Record<string, string>,
  includeSections = true,
  showMethodology = true,
  showInterpretation = false,
  patientInfoConfig?: PatientInfoConfig | null,
  printOptions?: Record<string, unknown>,
  extraFieldConfigs?: Array<{ field_key: string; label: string }>,
): string {
  const normalizedSectionContent =
    sectionContent && typeof sectionContent === "object" ? sectionContent : {};

  // Font size: honour lab-level baseFontSize if set, otherwise 11px
  const basePx = typeof printOptions?.baseFontSize === "number"
    ? Math.max(8, Math.min(16, printOptions.baseFontSize as number))
    : 11;
  const smallPx = Math.max(7, basePx - 3);   // method / ref range
  const titlePx = basePx + 2;                 // group heading
  const sigPx   = basePx + 1;                 // signatory name

  const noColorCss = `
<style>
.basic-report-template {
  font-size: ${basePx}px;
  line-height: 1.3;
  color: #000;
}
.basic-report-template td,
.basic-report-template th {
  color: #000 !important;
  font-weight: normal;
  background-color: #fff !important;
}
/* Strip every colour flag-class BASELINE_CSS would inject */
.basic-report-template .result-normal, .basic-report-template .flag-normal,
.basic-report-template .value-normal, .basic-report-template .result-high,
.basic-report-template .flag-high, .basic-report-template .value-high,
.basic-report-template .result-low, .basic-report-template .flag-low,
.basic-report-template .value-low, .basic-report-template .result-critical,
.basic-report-template .flag-critical, .basic-report-template .value-critical,
.basic-report-template .result-abnormal, .basic-report-template .flag-abnormal,
.basic-report-template .value-abnormal, .basic-report-template .flag-trace,
.basic-report-template .value-trace {
  color: #000 !important;
  font-weight: normal;
}
/* TEST REPORT title bar */
.basic-report-template .report-main-title {
  text-align: center !important;
  font-size: ${titlePx + 2}px !important;
  border-top: 1.5px solid #000 !important;
  border-bottom: 1.5px solid #000 !important;
  padding: 6px 0 !important;
  margin: 8px 0 12px !important;
  font-weight: bold !important;
  color: #000 !important;
}
/* Prevent print CSS injecting borders on our tables */
.basic-report-template table {
  border: none !important;
}
/* Patient header table */
.basic-report-template .patient-header-table {
  width: 100% !important;
  table-layout: fixed !important;
  margin-bottom: 12px !important;
  border: none !important;
}
.basic-report-template .patient-header-table th {
  width: 15% !important;
  font-weight: bold !important;
  text-align: left !important;
  color: #000 !important;
  padding: 2px 4px !important;
  white-space: nowrap !important;
  border: none !important;
}
.basic-report-template .patient-header-table td {
  width: 35% !important;
  padding: 2px 4px !important;
  border: none !important;
}
/* Results table — no cell borders, only header rule */
.basic-report-template .tbl-results {
  width: 100% !important;
  table-layout: fixed !important;
  border-collapse: collapse !important;
  border: none !important;
}
.basic-report-template .tbl-results thead th {
  border-top: 1.5px solid #000 !important;
  border-bottom: 1.5px solid #000 !important;
  border-left: none !important;
  border-right: none !important;
  font-weight: bold !important;
  text-align: left !important;
  padding: 4px 6px !important;
}
.basic-report-template .tbl-results thead th:nth-child(1) { width: 55% !important; }
.basic-report-template .tbl-results thead th:nth-child(2) { width: 15% !important; text-align: center !important; }
.basic-report-template .tbl-results thead th:nth-child(3) { width: 10% !important; }
.basic-report-template .tbl-results thead th:nth-child(4) { width: 20% !important; }
.basic-report-template .tbl-results td {
  border: none !important;
  padding: 3px 6px !important;
}
/* Value cell — high: red, low: black bold, abnormal: black bold */
.basic-report-template .val {
  text-align: center !important;
  vertical-align: top !important;
}
.basic-report-template .val.high,
.basic-report-template .val.critical_high,
.basic-report-template .val.critical_h {
  color: #dc2626 !important;
  font-weight: bold !important;
}
.basic-report-template .val.low,
.basic-report-template .val.critical_low,
.basic-report-template .val.critical_l,
.basic-report-template .val.abnormal {
  color: #000 !important;
  font-weight: bold !important;
}
/* Main group name row */
.basic-report-template .main-group-row td {
  padding: 0 !important;
  border: none !important;
}
.basic-report-template .center-title {
  text-align: center !important;
  font-weight: bold !important;
  text-decoration: underline !important;
  font-size: ${titlePx}px !important;
  margin: 10px 0 0 !important;
  text-transform: uppercase !important;
}
.basic-report-template .center-subtitle {
  text-align: center !important;
  font-size: ${smallPx + 1}px !important;
  margin: 2px 0 5px !important;
  color: #444 !important;
}
/* Sub-section heading row */
.basic-report-template .sub-section-header td {
  font-weight: bold !important;
  padding-top: 10px !important;
  padding-bottom: 2px !important;
  text-transform: uppercase !important;
  font-size: ${smallPx + 1}px !important;
  letter-spacing: 0.3px !important;
  border: none !important;
}
/* Footer — flex, auth text left, signature right */
.basic-report-template .report-footer {
  margin-top: 30px !important;
  border-top: 1.5px solid #000 !important;
  padding-top: 10px !important;
  display: flex !important;
  justify-content: space-between !important;
  align-items: flex-start !important;
  page-break-inside: avoid !important;
}
.basic-report-template .auth-text {
  font-size: ${smallPx + 1}px !important;
  color: #555 !important;
  font-style: italic !important;
}
.basic-report-template .signature-box {
  text-align: right !important;
}
/* Undo hide-last-column rule for tbl-results */
.basic-report-template .tbl-results th:last-child,
.basic-report-template .tbl-results td:last-child {
  display: table-cell !important;
}
</style>`;

  // Patient info — figure.table wrapper with <th> labels
  const patientInfoHtml = patientInfoConfig
    ? buildPatientInfoHtml(patientInfoConfig, '#5a7f3a', extraFieldConfigs)
    : `
    <div class="report-header-top">
      <h2 class="report-main-title">TEST REPORT</h2>
    </div>
    <figure class="table" style="margin: 0 0 12px;">
      <table class="patient-header-table">
        <tbody>
          <tr>
            <th>Name</th><td>: {{patientName}}</td>
            <th>Reg. No</th><td>: {{patientId}}</td>
          </tr>
          <tr>
            <th>Age / Sex</th><td>: {{patientAge}} / {{patientGender}}</td>
            <th>Reg. Date</th><td>: {{collectionDate}}</td>
          </tr>
          <tr>
            <th>Ref. By</th><td>: {{referringDoctorName}}</td>
            <th>Report Date</th><td>: {{approvedAt}}</td>
          </tr>
        </tbody>
      </table>
    </figure>
  `;

  let testResultsHtml = '<div class="test-results">';
  for (const [groupId, analytes] of analytesByGroup) {
    if (!analytes || analytes.length === 0) continue;

    const groupName = testGroupNames.get(groupId) || analytes[0]?.test_name || "Test Results";
    const hasCalcInGroup = analytes.some((a: { is_auto_calculated?: boolean; is_calculated?: boolean }) => a.is_auto_calculated || a.is_calculated);

    testResultsHtml += `
      <figure class="table" style="margin: 0 0 14px;">
        <table class="tbl-results">
          <thead>
            <tr>
              <th>TEST NAME</th>
              <th style="text-align:center;">VALUE</th>
              <th>UNITS</th>
              <th>Bio. Ref. Interval</th>
            </tr>
          </thead>
          <tbody>
            <tr class="main-group-row">
              <td colspan="4">
                <div class="center-title">${groupName}</div>
              </td>
            </tr>
    `;

    const sectionBlocks = groupAnalytesBySectionHeading(analytes);
    for (const block of sectionBlocks) {
      if (block.heading) {
        testResultsHtml += `
            <tr class="sub-section-header">
              <td colspan="4">${block.heading}</td>
            </tr>
        `;
      }
      for (const analyte of block.analytes) {
        const parameterName = analyte.parameter || analyte.name || analyte.test_name || "";
        const value        = analyte.value ?? "";
        const unit         = analyte.unit || "";
        const refRange     = analyte.reference_range || "";
        const flag         = analyte.flag || "";
        const normalizedFlag  = normalizeReportFlag(flag);
        const canonicalFlag   = normalizedFlag.canonical;
        const isCalculated    = analyte.is_auto_calculated || analyte.is_calculated;

        const unitText      = String(unit || "").trim().toLowerCase();
        const refText       = String(refRange || "").trim();
        const hasNumericRef = /\d/.test(refText);
        const isDescriptive =
          unitText === "n/a" || unitText === "na" || unitText === "-" ||
          unitText === "none" || unitText === "not applicable" ||
          (!unitText && refText && !hasNumericRef);

        const isNumericHigh = canonicalFlag === "high" || canonicalFlag === "critical_high";
        const isNumericLow  = canonicalFlag === "low"  || canonicalFlag === "critical_low";

        const asteriskSuffix = (printOptions?.flagAsterisk && (isNumericHigh || isNumericLow))
          ? (printOptions?.flagAsteriskCritical && (canonicalFlag === 'critical_high' || canonicalFlag === 'critical_low') ? '**' : '*')
          : '';
        const displayValue = value + asteriskSuffix;

        if (isDescriptive) {
          testResultsHtml += `
              <tr>
                <td colspan="4" style="padding: 3px 6px; font-size: ${basePx}px;">
                  <strong>${parameterName}:</strong> ${value || refText || ""}
                </td>
              </tr>
          `;
          continue;
        }

        // val class drives colour: high → red, low/abnormal → black bold
        const valClass = canonicalFlag ? `val ${canonicalFlag}` : "val";

        testResultsHtml += `
              <tr>
                <td style="padding: 3px 6px; vertical-align: top;">
                  <strong style="font-size: ${basePx}px;">${parameterName}</strong>${isCalculated ? `<sup style="font-size:${smallPx - 1}px; color:#444; margin-left:1px;">*</sup>` : ''}
                  ${showMethodology && analyte.method ? `<div style="font-size: ${smallPx}px; color: #444; font-style: italic; margin-top: 1px;">${analyte.method}</div>` : ""}
                </td>
                <td class="${valClass}" style="font-size: ${basePx}px;">${displayValue}</td>
                <td style="text-align: center; vertical-align: top; font-size: ${basePx}px;">${unit}</td>
                <td style="vertical-align: top; font-size: ${smallPx + 1}px;">${refRange}</td>
              </tr>
        `;

        if (showInterpretation) {
          let interp = "";
          if (isNumericHigh) interp = analyte.interpretation_high || "";
          else if (isNumericLow) interp = analyte.interpretation_low || "";
          else interp = analyte.interpretation_normal || "";
          if (interp) {
            testResultsHtml += `
              <tr>
                <td colspan="4" style="padding: 1px 6px 4px 20px; font-size: ${smallPx}px; color: #333; font-style: italic;">${interp}</td>
              </tr>
            `;
          }
        }
      } // end for analyte
    } // end for block

    testResultsHtml += `
          </tbody>
        </table>
        ${hasCalcInGroup ? `<p style="font-size:${smallPx}px;color:#444;margin:2px 0 6px;font-style:italic;">* Calculated parameter</p>` : ''}
      </figure>
    `;
  }

  testResultsHtml += "</div>";

  // Footer — flex: auth text left, signatory right
  const sigName        = signatoryInfo?.signatoryName || "";
  const sigDesignation = signatoryInfo?.signatoryDesignation || "";
  const sigImageUrl    = signatoryInfo?.signatoryImageUrl || "";

  const signatoryHtml = `
    <div class="report-footer">
      <div class="auth-text">Authenticated Electronic Report</div>
      <div class="signature-box">
        ${sigImageUrl ? `<img src="${sigImageUrl}" alt="Signature" style="max-height: 45px; max-width: 130px; margin-bottom: 4px; display: block; margin-left: auto;" />` : ""}
        ${sigName        ? `<div style="font-weight: bold; font-size: ${sigPx}px;">${sigName}</div>` : ""}
        ${sigDesignation ? `<div style="font-size: ${basePx - 1}px; margin-top: 2px;">${sigDesignation}</div>` : ""}
      </div>
    </div>
  `;

  const buildSectionLabel = (key: string) => {
    const { rawKey } = normalizeSectionKey(key);
    if (!rawKey) return "Report Section";
    return rawKey
      .replace(/[_-]+/g, " ")
      .split(" ")
      .filter(Boolean)
      .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  };

  let reportSectionsHtml = "";
  if (includeSections && Object.keys(normalizedSectionContent).length > 0) {
    const sectionItems = Object.entries(normalizedSectionContent)
      .filter(([, content]) => content && String(content).trim().length > 0)
      .map(([key, content]) => {
        const formatted = formatSectionContentToHtml(String(content));
        if (!formatted) return "";
        return `
          <div style="margin-top: 10px; font-size: ${basePx}px;">
            <div style="font-weight: bold; margin-bottom: 3px;">${buildSectionLabel(key)}</div>
            ${formatted}
          </div>
        `;
      })
      .filter(Boolean)
      .join("");

    if (sectionItems) {
      reportSectionsHtml = `
        <div class="report-sections" style="margin-top: 14px; border-top: 1px solid #000; padding-top: 6px;">
          ${sectionItems}
        </div>
      `;
    }
  }

  return `
    ${noColorCss}
    <div class="basic-report-template" style="font-family: Arial, Helvetica, sans-serif; font-size: ${basePx}px; color: #000;">
      ${patientInfoHtml}
      ${testResultsHtml}
      ${reportSectionsHtml}
      ${signatoryHtml}
    </div>
  `;
}

/**
 * Generate default template HTML when no custom template is found.
 *
 * Supports three styles controlled by lab setting `default_template_style`:
 *   - "beautiful" (default): 3-band color matrix with colored cells
 *   - "classic": Plain table with flag text styling
 *   - "basic": Old-school, no colours, bold H/L prefix on abnormal values
 */
function generateDefaultTemplateHtml(
  context: any,
  testGroupNames: Map<string, string>,
  analytesByGroup: Map<string, any[]>,
  signatoryInfo: any,
  sectionContent?: Record<string, string>,
  includeSections = true,
  templateStyle: 'beautiful' | 'classic' | 'basic' = 'beautiful',
  showMethodology = true,
  showInterpretation = false,
  patientInfoConfig?: PatientInfoConfig | null,
  printOptions?: Record<string, unknown>,
  extraFieldConfigs?: Array<{ field_key: string; label: string }>,
): string {
  // Branch to classic template if requested
  if (templateStyle === 'classic') {
    return generateClassicDefaultTemplateHtml(
      context, testGroupNames, analytesByGroup, signatoryInfo,
      sectionContent, includeSections, showMethodology, showInterpretation,
      patientInfoConfig, printOptions, extraFieldConfigs,
    );
  }

  // Branch to basic (old-school) template if requested
  if (templateStyle === 'basic') {
    return generateBasicDefaultTemplateHtml(
      context, testGroupNames, analytesByGroup, signatoryInfo,
      sectionContent, includeSections, showMethodology, showInterpretation,
      patientInfoConfig, printOptions, extraFieldConfigs,
    );
  }

  const _patient = context.patient || {};
  const _order = context.order || {};
  const normalizedSectionContent =
    sectionContent && typeof sectionContent === "object" ? sectionContent : {};

  // ── Theme colors ──
  const THEME = {
    accent: "#5a7f3a",
    normalBg: "#4a8c4a", normalText: "#ffffff",
    borderlineBg: "#d4a84b", borderlineText: "#1f1f1f",
    abnormalBg: "#c45454", abnormalText: "#ffffff",
    headerBg: "#e8efe4", headerText: "#374151",
  };

  // ── Helper: classify a numeric value against structured ranges ──
  function classifyValue(
    numVal: number,
    analyte: any,
  ): { column: 1 | 2 | 3; semantic: "good" | "borderline" | "bad" } | null {
    const minVal = analyte.normal_range_min != null
      ? Number(analyte.normal_range_min)
      : null;
    const maxVal = analyte.normal_range_max != null
      ? Number(analyte.normal_range_max)
      : null;

    if (minVal !== null && maxVal !== null && !isNaN(minVal) && !isNaN(maxVal)) {
      if (numVal < minVal) return { column: 1, semantic: "bad" };
      if (numVal > maxVal) return { column: 3, semantic: "bad" };
      return { column: 2, semantic: "good" };
    }

    // Fallback: try parsing text reference_range "10 - 20" style
    const refText = String(analyte.reference_range || "").trim();
    const rangeMatch = refText.match(/([\d.]+)\s*[-–]\s*([\d.]+)/);
    if (rangeMatch) {
      const lo = parseFloat(rangeMatch[1]);
      const hi = parseFloat(rangeMatch[2]);
      if (!isNaN(lo) && !isNaN(hi)) {
        if (numVal < lo) return { column: 1, semantic: "bad" };
        if (numVal > hi) return { column: 3, semantic: "bad" };
        return { column: 2, semantic: "good" };
      }
    }

    // One-sided upper limit: "< X" or "≤ X" (e.g. Total Cholesterol < 200)
    const upperMatch = refText.match(/^[<≤]\s*([\d.]+)/);
    if (upperMatch) {
      const hi = parseFloat(upperMatch[1]);
      if (!isNaN(hi)) {
        if (numVal <= hi) return { column: 2, semantic: "good" };
        return { column: 3, semantic: "bad" };
      }
    }

    // One-sided lower limit: "> X" or "≥ X" (e.g. HDL > 40)
    const lowerMatch = refText.match(/^[>≥]\s*([\d.]+)/);
    if (lowerMatch) {
      const lo = parseFloat(lowerMatch[1]);
      if (!isNaN(lo)) {
        if (numVal >= lo) return { column: 2, semantic: "good" };
        return { column: 1, semantic: "bad" };
      }
    }

    return null; // no structured range available
  }

  // ── Helper: get color by semantic ──
  function getColor(semantic: "good" | "borderline" | "bad") {
    switch (semantic) {
      case "good": return { bg: THEME.normalBg, text: THEME.normalText };
      case "borderline": return { bg: THEME.borderlineBg, text: THEME.borderlineText };
      case "bad": return { bg: THEME.abnormalBg, text: THEME.abnormalText };
    }
  }

  // ── Helper: format reference range text for a column position ──
  function formatRefForColumn(
    analyte: any,
    position: 1 | 2 | 3,
  ): string {
    const minVal = analyte.normal_range_min != null
      ? Number(analyte.normal_range_min)
      : null;
    const maxVal = analyte.normal_range_max != null
      ? Number(analyte.normal_range_max)
      : null;

    if (minVal !== null && maxVal !== null && !isNaN(minVal) && !isNaN(maxVal)) {
      if (position === 1) return `< ${minVal}`;
      if (position === 2) return `${minVal} – ${maxVal}`;
      return `> ${maxVal}`;
    }

    // Fallback: parse text reference_range
    const refText = String(analyte.reference_range || "").trim();
    const rangeMatch = refText.match(/([\d.]+)\s*[-–]\s*([\d.]+)/);
    if (rangeMatch) {
      const lo = rangeMatch[1];
      const hi = rangeMatch[2];
      if (position === 1) return `< ${lo}`;
      if (position === 2) return `${lo} – ${hi}`;
      return `> ${hi}`;
    }

    // One-sided upper limit: "< X" — LOW col empty, NORMAL = "< X", HIGH = "> X"
    const upperMatch = refText.match(/^[<≤]\s*([\d.]+)/);
    if (upperMatch) {
      if (position === 1) return "";
      if (position === 2) return `< ${upperMatch[1]}`;
      return `> ${upperMatch[1]}`;
    }

    // One-sided lower limit: "> X" — LOW = "< X", NORMAL = "> X", HIGH col empty
    const lowerMatch = refText.match(/^[>≥]\s*([\d.]+)/);
    if (lowerMatch) {
      if (position === 1) return `< ${lowerMatch[1]}`;
      if (position === 2) return `> ${lowerMatch[1]}`;
      return "";
    }

    if (position === 2) return refText || "";
    return "";
  }

  // ── Helper: check if analyte has structured numeric range ──
  function hasStructuredRange(analyte: any): boolean {
    if (
      analyte.normal_range_min != null && analyte.normal_range_max != null
    ) return true;
    const refText = String(analyte.reference_range || "").trim();
    // Two-sided: "10 - 20"
    if (/[\d.]+\s*[-–]\s*[\d.]+/.test(refText)) return true;
    // One-sided: "< 200" or "> 40"
    if (/^[<>≤≥]\s*[\d.]+/.test(refText)) return true;
    return false;
  }

  // ── Helper: check if value is numeric ──
  function isNumericValue(val: any): boolean {
    if (val == null || val === "") return false;
    const str = String(val).trim();
    return /^[<>≤≥]?\s*[\d.]+$/.test(str);
  }

  function extractNumericVal(val: any): number | null {
    if (val == null || val === "") return null;
    const str = String(val).trim();
    const m = str.match(/([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  }

  // ── Helper: check if analyte is descriptive (should be shown as full-width row) ──
  function isDescriptiveAnalyte(analyte: any): boolean {
    const unitText = String(analyte.unit || "").trim().toLowerCase();
    const refText = String(analyte.reference_range || "").trim();
    const hasNumericRef = /\d/.test(refText);
    const vt = String(analyte.value_type || "").toLowerCase();

    return (
      vt === "descriptive" ||
      unitText === "n/a" || unitText === "na" || unitText === "-" ||
      unitText === "none" || unitText === "not applicable" ||
      (!unitText && !!refText && !hasNumericRef && vt !== "numeric")
    );
  }

  // ── Helper: get flag display + color for flat table badge ──
  function getFlagBadge(flag: string): { text: string; bg: string } {
    const normalized = normalizeReportFlag(flag);

    if (normalized.canonical === "high" || normalized.canonical === "critical_high") {
      return { text: normalized.label.toUpperCase(), bg: THEME.abnormalBg };
    }
    if (normalized.canonical === "low" || normalized.canonical === "critical_low") {
      return { text: normalized.label.toUpperCase(), bg: "#ea580c" };
    }
    if (normalized.canonical === "normal") {
      return { text: "NORMAL", bg: THEME.normalBg };
    }
    if (normalized.canonical === "abnormal") {
      return { text: "ABNORMAL", bg: THEME.abnormalBg };
    }
    if (normalized.canonical === "critical") {
      return { text: "CRITICAL", bg: "#7c2d12" };
    }
    return { text: (normalized.label || flag || "").toUpperCase(), bg: "#6b7280" };
  }

  // ── Patient Information Section ──
  const patientInfoHtml = patientInfoConfig
    ? buildPatientInfoHtml(patientInfoConfig, THEME.accent, extraFieldConfigs)
    : `
    <div class="patient-info" style="margin-bottom: 16px; padding: 12px 16px; background: #ffffff; border: 1px solid #d1d5db; border-radius: 4px; page-break-inside: avoid;">
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
        <div style="font-size: 16px; font-weight: 700; color: ${THEME.accent};">
          {{patientName}}
        </div>
        <div style="font-size: 11px; color: #6b7280;">
          {{approvedAtFormatted}}
        </div>
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
  `;

  // ── Test Results Section - group by test group ──
  let testResultsHtml = '<div class="test-results">';

  for (const [groupId, analytes] of analytesByGroup) {
    if (!analytes || analytes.length === 0) continue;

    const groupName = testGroupNames.get(groupId) || analytes[0]?.test_name ||
      "Test Results";

    // Separate analytes into categories (sorted by sort_order first)
    const sortedAnalytes = groupAnalytesBySectionHeading(analytes).flatMap(b => b.analytes);
    const colorMatrixAnalytes: any[] = [];
    const flatTableAnalytes: any[] = [];
    const descriptiveAnalytes: any[] = [];

    for (const analyte of sortedAnalytes) {
      if (isDescriptiveAnalyte(analyte)) {
        descriptiveAnalytes.push(analyte);
      } else if (isNumericValue(analyte.value) && hasStructuredRange(analyte)) {
        colorMatrixAnalytes.push(analyte);
      } else {
        flatTableAnalytes.push(analyte);
      }
    }

    testResultsHtml += `
      <div class="test-group-section" style="margin-bottom: 20px; page-break-inside: auto;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid ${THEME.accent};">
          <h3 style="font-size: 18px; font-weight: 600; color: ${THEME.accent}; margin: 0;">${groupName}</h3>
        </div>
    `;

    // ── 3-Band Color Matrix Table (for numeric analytes with structured ranges) ──
    if (colorMatrixAnalytes.length > 0) {
      testResultsHtml += `
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; background: #ffffff; -webkit-print-color-adjust: exact; print-color-adjust: exact; margin-bottom: 12px;">
          <thead>
            <tr>
              <th style="text-align: left; padding: 8px 12px; border: 1px solid #d1d5db; width: 180px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: ${THEME.headerText}; background-color: ${THEME.headerBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">Test Name</th>
              <th style="text-align: center; padding: 8px 12px; border: 1px solid #d1d5db; width: 130px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: ${THEME.headerText}; background-color: ${THEME.headerBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">Low</th>
              <th style="text-align: center; padding: 8px 12px; border: 1px solid #d1d5db; width: 130px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: ${THEME.headerText}; background-color: ${THEME.headerBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">Normal</th>
              <th style="text-align: center; padding: 8px 12px; border: 1px solid #d1d5db; width: 130px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: ${THEME.headerText}; background-color: ${THEME.headerBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">High</th>
            </tr>
          </thead>
          <tbody>
      `;

      for (const cmBlock of groupAnalytesBySectionHeading(colorMatrixAnalytes)) {
        if (cmBlock.heading) {
          testResultsHtml += `
              <tr>
                <td colspan="4" style="padding: 6px 12px; background: #f1f5f9; font-weight: 600; font-size: 11px; color: #374151; border: 1px solid #e5e7eb;">${cmBlock.heading}</td>
              </tr>
          `;
        }
        for (const analyte of cmBlock.analytes) {
          const paramName = analyte.parameter || analyte.name || analyte.test_name || "";
          const value = analyte.value ?? "";
          const unitStr = analyte.unit || "";
          const method = analyte.method || "";
          const numVal = extractNumericVal(value);
          const classification = numVal !== null ? classifyValue(numVal, analyte) : null;

          const ref1 = formatRefForColumn(analyte, 1);
          const ref2 = formatRefForColumn(analyte, 2);
          const ref3 = formatRefForColumn(analyte, 3);

          const buildColorCell = (colNum: 1 | 2 | 3, refText: string) => {
            const isActive = classification?.column === colNum;
            if (isActive) {
              const color = getColor(classification!.semantic);
              return `
                <td style="padding: 6px; border: 1px solid #d1d5db; text-align: center; vertical-align: middle; background-color: ${color.bg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">
                  <div style="font-size: 15px; font-weight: 700; color: ${color.text};">${value}</div>
                  ${unitStr ? `<div style="font-size: 10px; color: ${color.text}; opacity: 0.85; margin-top: 1px;">${unitStr}</div>` : ""}
                  ${refText ? `<div style="font-size: 10px; color: ${color.text}; opacity: 0.85; margin-top: 2px;">${refText}</div>` : ""}
                </td>
              `;
            }
            return `
              <td style="padding: 6px; border: 1px solid #d1d5db; text-align: center; vertical-align: middle; background-color: transparent;">
                <div style="font-size: 10px; color: #6b7280;">${refText}</div>
              </td>
            `;
          };

          testResultsHtml += `
              <tr style="page-break-inside: avoid;">
                <td style="font-weight: 600; padding: 10px 12px; border: 1px solid #d1d5db; color: #1f2937; width: 180px;">
                  ${paramName}${(analyte.is_auto_calculated || analyte.is_calculated) ? '<sup style="font-size:8px;color:#6b7280;margin-left:2px;font-style:italic;">*calc</sup>' : ''}
                  ${showMethodology && method ? `<div style="font-size: 9px; color: #9ca3af; margin-top: 2px;">${method}</div>` : ""}
                </td>
                ${buildColorCell(1, ref1)}
                ${buildColorCell(2, ref2)}
                ${buildColorCell(3, ref3)}
              </tr>
          `;

          // Interpretation row (shown below the analyte row if enabled)
          if (showInterpretation) {
            const canonicalFlag = normalizeReportFlag(analyte.flag).canonical;
            let interpretationText = "";
            if (canonicalFlag === "high" || canonicalFlag === "critical_high") {
              interpretationText = analyte.interpretation_high || "";
            } else if (canonicalFlag === "low" || canonicalFlag === "critical_low") {
              interpretationText = analyte.interpretation_low || "";
            } else {
              interpretationText = analyte.interpretation_normal || "";
            }
            if (interpretationText) {
              testResultsHtml += `
              <tr style="page-break-inside: avoid;">
                <td colspan="4" style="padding: 4px 12px 8px 24px; border: 1px solid #d1d5db; border-top: none; font-size: 11px; color: #6b7280; font-style: italic;">
                  <strong>Interpretation:</strong> ${interpretationText}
                </td>
              </tr>
              `;
            }
          }
        } // end for analyte
      } // end for cmBlock

      testResultsHtml += `
          </tbody>
        </table>
        ${colorMatrixAnalytes.some((a: any) => a.is_auto_calculated || a.is_calculated) ? '<p style="font-size:9px;color:#9ca3af;margin:2px 0 8px;font-style:italic;">*calc – Calculated parameter</p>' : ''}
      `;
    }

    // ── Flat Table (for numeric analytes without structured ranges, or non-numeric) ──
    if (flatTableAnalytes.length > 0) {
      testResultsHtml += `
        <table class="report-table" style="width: 100%; border-collapse: collapse; font-size: 13px; background: #ffffff; margin-bottom: 12px;">
          <thead>
            <tr>
              <th style="text-align: left; padding: 8px 12px; border: 1px solid #d1d5db; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: ${THEME.headerText}; background-color: ${THEME.headerBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">Test</th>
              <th style="text-align: center; padding: 8px 12px; border: 1px solid #d1d5db; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: ${THEME.headerText}; background-color: ${THEME.headerBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">Result</th>
              <th style="text-align: center; padding: 8px 12px; border: 1px solid #d1d5db; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: ${THEME.headerText}; background-color: ${THEME.headerBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">Unit</th>
              <th style="text-align: center; padding: 8px 12px; border: 1px solid #d1d5db; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: ${THEME.headerText}; background-color: ${THEME.headerBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">Ref. Range</th>
              <th style="text-align: center; padding: 8px 12px; border: 1px solid #d1d5db; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: ${THEME.headerText}; background-color: ${THEME.headerBg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">Flag</th>
            </tr>
          </thead>
          <tbody>
      `;

      for (const flatBlock of groupAnalytesBySectionHeading(flatTableAnalytes)) {
        if (flatBlock.heading) {
          testResultsHtml += `
              <tr>
                <td colspan="5" style="padding: 6px 12px; background: #f1f5f9; font-weight: 600; font-size: 11px; color: #374151; border: 1px solid #e5e7eb;">${flatBlock.heading}</td>
              </tr>
          `;
        }
        for (const analyte of flatBlock.analytes) {
          const paramName = analyte.parameter || analyte.name || analyte.test_name || "";
          const value = analyte.value ?? "";
          const unit = analyte.unit || "";
          const refRange = analyte.reference_range || "";
          const flag = analyte.flag || "";
          const method = analyte.method || "";
          const badge = getFlagBadge(flag);
          const canonicalFlag = normalizeReportFlag(flag).canonical;
          const isAbnormal = !!canonicalFlag && canonicalFlag !== "normal";

          testResultsHtml += `
              <tr style="page-break-inside: avoid;">
                <td style="padding: 8px 12px; border: 1px solid #d1d5db; font-weight: 600; color: #1f2937;">
                  ${paramName}${(analyte.is_auto_calculated || analyte.is_calculated) ? '<sup style="font-size:8px;color:#6b7280;margin-left:2px;font-style:italic;">*calc</sup>' : ''}
                  ${showMethodology && method ? `<div style="font-size: 9px; color: #9ca3af;">${method}</div>` : ""}
                </td>
                <td style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: center; font-weight: 700; color: ${isAbnormal ? badge.bg : "#374151"};">${value}</td>
                <td style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: center; color: #6b7280; font-size: 12px;">${unit}</td>
                <td style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: center; color: #6b7280; font-size: 12px;">${refRange}</td>
                <td style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: center;">
                  ${flag ? `<span style="display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; color: white; background-color: ${badge.bg}; -webkit-print-color-adjust: exact; print-color-adjust: exact;">${badge.text}</span>` : ""}
                </td>
              </tr>
          `;

          // Interpretation row (shown below the analyte row if enabled)
          if (showInterpretation) {
            let interpretationTextFlat = "";
            if (canonicalFlag === "high" || canonicalFlag === "critical_high") {
              interpretationTextFlat = analyte.interpretation_high || "";
            } else if (canonicalFlag === "low" || canonicalFlag === "critical_low") {
              interpretationTextFlat = analyte.interpretation_low || "";
            } else {
              interpretationTextFlat = analyte.interpretation_normal || "";
            }
            if (interpretationTextFlat) {
              testResultsHtml += `
              <tr style="page-break-inside: avoid;">
                <td colspan="5" style="padding: 4px 12px 8px 24px; border: 1px solid #d1d5db; border-top: none; font-size: 11px; color: #6b7280; font-style: italic;">
                  <strong>Interpretation:</strong> ${interpretationTextFlat}
                </td>
              </tr>
              `;
            }
          }
        } // end for analyte
      } // end for flatBlock

      testResultsHtml += `
          </tbody>
        </table>
        ${flatTableAnalytes.some((a: any) => a.is_auto_calculated || a.is_calculated) ? '<p style="font-size:9px;color:#9ca3af;margin:2px 0 8px;font-style:italic;">*calc \u2013 Calculated parameter</p>' : ''}
      `;
    }

    // ── Descriptive Rows ──
    if (descriptiveAnalytes.length > 0) {
      for (const descBlock of groupAnalytesBySectionHeading(descriptiveAnalytes)) {
        if (descBlock.heading) {
          testResultsHtml += `
          <div style="padding: 6px 12px; font-weight: 600; font-size: 12px; color: ${THEME.accent}; margin-top: 8px; margin-bottom: 4px; border-bottom: 1px solid ${THEME.accent};">${descBlock.heading}</div>
          `;
        }
        for (const analyte of descBlock.analytes) {
          const paramName = analyte.parameter || analyte.name || analyte.test_name || "";
          const value = analyte.value ?? "";
          const refText = String(analyte.reference_range || "").trim();
          testResultsHtml += `
            <div style="padding: 8px 12px; border: 1px solid #e5e7eb; border-radius: 4px; margin-bottom: 6px; background: #f9fafb;">
              <strong style="color: #1f2937;">${paramName}:</strong>
              <span style="color: #374151; margin-left: 6px;">${value || refText || ""}</span>
            </div>
          `;
        }
      }
    }

    testResultsHtml += `
      </div>
    `;
  }

  testResultsHtml += "</div>";

  // ── Signatory Section ──
  const sigName = signatoryInfo?.signatoryName || "";
  const sigDesignation = signatoryInfo?.signatoryDesignation || "";
  const sigImageUrl = signatoryInfo?.signatoryImageUrl || "";

  const signatoryHtml = `
    <div class="signatures" style="margin-top: 30px; text-align: right; page-break-inside: avoid;">
      <div style="display: inline-block; text-align: center; min-width: 200px;">
        ${
    sigImageUrl
      ? `<img src="${sigImageUrl}" alt="Signature" style="max-height: 50px; max-width: 150px; margin-bottom: 5px;" />`
      : ""
  }
        ${
    sigName
      ? `<div style="border-bottom: 1px solid #374151; padding-bottom: 4px; margin-bottom: 4px; font-size: 14px; font-weight: 600; color: #1f2937;">${sigName}</div>`
      : ""
  }
        ${
    sigDesignation
      ? `<div style="font-size: 11px; color: #6b7280;">${sigDesignation}</div>`
      : ""
  }
      </div>
    </div>
  `;

  const buildSectionLabel = (key: string) => {
    const { rawKey } = normalizeSectionKey(key);
    if (!rawKey) return "Report Section";
    return rawKey
      .replace(/[_-]+/g, " ")
      .split(" ")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  };

  let reportSectionsHtml = "";
  if (includeSections && Object.keys(normalizedSectionContent).length > 0) {
    const sectionItems = Object.entries(normalizedSectionContent)
      .filter(([, content]) => content && String(content).trim().length > 0)
      .map(([key, content]) => {
        const formatted = formatSectionContentToHtml(String(content));
        if (!formatted) return "";
        const heading = buildSectionLabel(key);
        return `
          <div style="margin-top: 12px;">
            <h4 style="font-size: 13px; font-weight: 600; color: #111827; margin: 0 0 6px;">${heading}</h4>
            ${formatted}
          </div>
        `;
      })
      .filter(Boolean)
      .join("");

    if (sectionItems) {
      reportSectionsHtml = `
        <div class="report-sections" style="margin-top: 18px;">
          <h3 style="font-size: 14px; font-weight: 600; color: #111827; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px;">Report Sections</h3>
          ${sectionItems}
        </div>
      `;
    }
  }

  // ── Combine all sections ──
  return `
    <div class="default-report-template">
      ${patientInfoHtml}
      ${testResultsHtml}
      ${reportSectionsHtml}
      ${signatoryHtml}
    </div>
  `;
}

/**
 * Build PDF body HTML document (main content)
 * Now supports letterhead background image, padding settings, and QR Verification Code
 */
function buildPdfBodyDocumentV2(
  bodyHtml: string,
  customCss: string,
  letterheadBackgroundUrl?: string | null,
  pdfSettings?: any,
  verificationUrl?: string | null,
): string {
  console.log("🚀🚀🚀 VERSION 3.3 - PER-GROUP TEMPLATE STYLE 🚀🚀🚀");
  console.log("🏗️ buildPdfBodyDocumentV2 called with:", {
    bodyHtmlLength: bodyHtml?.length || 0,
    customCssLength: customCss?.length || 0,
    letterheadUrl: letterheadBackgroundUrl || "NONE",
    hasLetterhead: !!letterheadBackgroundUrl,
    hasPdfSettings: !!pdfSettings,
    verificationUrl: verificationUrl || "NONE",
  });

  // Calculate spacer heights from settings (default to 130px)
  const topSpacerHeight = pdfSettings?.margins?.top ?? 130;
  const bottomSpacerHeight = pdfSettings?.margins?.bottom ?? 130;

  // QR code is now placed in signature area (bottom) - not at top
  // The QR will be injected where signature exists, on the opposite side
  // 🎨 PDF.co compatibility: Expand CSS custom properties (variables) to literal values
  let normalizedCss = customCss;
  if (customCss) {
    const cssVarMap = new Map<string, string>();

    // Extract :root variables
    const rootMatch = customCss.match(/:root\s*\{([^}]+)\}/);
    if (rootMatch) {
      const rootBlock = rootMatch[1];
      const varMatches = rootBlock.matchAll(/--([a-z-]+)\s*:\s*([^;]+);/g);
      for (const match of varMatches) {
        cssVarMap.set(`--${match[1]}`, match[2].trim());
      }
    }

    // Replace var() references with actual values
    if (cssVarMap.size > 0) {
      normalizedCss = customCss.replace(/var\(--([a-z-]+)\)/g, (_, varName) => {
        const value = cssVarMap.get(`--${varName}`);
        return value || `var(--${varName})`; // fallback to original if not found
      });

      console.log("🎨 CSS Variables expanded for PDF.co:", {
        variableCount: cssVarMap.size,
        variables: Array.from(cssVarMap.keys()),
      });
    }
  }

  // 🐛 Debug CSS inclusion
  console.log("🎨 buildPdfBodyDocument CSS Debug:", {
    hasBaselineCss: !!BASELINE_CSS,
    baselineCssLength: BASELINE_CSS?.length || 0,
    hasCustomCss: !!normalizedCss,
    customCssLength: normalizedCss?.length || 0,
    customCssPreview: normalizedCss?.substring(0, 100) || "NONE",
    hasLetterhead: !!letterheadBackgroundUrl,
  });

  // Build letterhead background styles if URL provided
  console.log("🎨 Building letterhead styles...");
  console.log("  letterheadBackgroundUrl value:", letterheadBackgroundUrl);
  console.log(
    "  letterheadBackgroundUrl type:",
    typeof letterheadBackgroundUrl,
  );
  console.log("  letterheadBackgroundUrl truthy?:", !!letterheadBackgroundUrl);

  const letterheadStyles = letterheadBackgroundUrl
    ? `
    /* Letterhead Background - Fixed layer that repeats on every PDF page */
    /* NOTE: Do NOT set @page { margin: 0; } - it overrides PDF.co margins! */
    
    html, body {
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    
    /* The repeating full-page background layer */
    #page-bg {
      position: fixed;
      top: 0;
      left: 0;
      width: 210mm;
      height: 297mm;
      z-index: 0;
      pointer-events: none;
      background-image: url('${letterheadBackgroundUrl}');
      background-repeat: no-repeat;
      background-position: top left;
      background-size: 210mm 297mm; /* A4 exact sizing */
    }
    
    /* Keep content above the background */
    .limsv2-report,
    .limsv2-report-body {
      position: relative;
      z-index: 1;
    }
    
    /* CRITICAL: Remove the white sheet that hides the background layer */
    .limsv2-report,
    .limsv2-report-body {
      background: transparent !important;
      background-color: transparent !important;
    }
    
    /* Prevent white blocks from hiding the letterhead */
    .report-container,
    .report-body,
    .report-region,
    .report-region--body,
    .report-header {
      background: transparent !important;
      background-color: transparent !important;
    }
    
    /* Keep tables readable with solid white background (no bleed-through) */
    .patient-info,
    .report-table,
    .tbl-meta,
    .tbl-results,
    .tbl-interpretation {
      background: #ffffff !important;
    }

    /* Safe content area - spacing handled by HTML TABLE spacers now */
    .limsv2-report-body--pdf {
      padding: 0 20px !important;
    }

    /* Prevent table rows from being cut across pages */
    .report-table tr,
    .patient-info tr,
    .tbl-interpretation tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }

    /* Keep headers repeated on new pages */
    .report-table thead,
    .tbl-interpretation thead {
      display: table-header-group;
    }
  `
    : "";

  console.log("  letterheadStyles length:", letterheadStyles.length);

  // Wrap content with fixed background AND repeating layout table
  // This "Print Table" technique ensures top/bottom spacing repeats on EVERY page
  // QR code is now placed in signature area at bottom
  const wrappedBody = letterheadBackgroundUrl
    ? `
    <!-- Fixed background layer - repeats on every PDF page -->
    <div id="page-bg"></div>
    
    <!-- Layout Table for Multi-Page Spacing -->
    <table style="width: 100%; border: none; border-collapse: collapse;">
      
      <!-- HEADER SPACER (Repeats on every page) -->
      <thead style="display: table-header-group;">
        <tr>
          <td style="border: none; padding: 0;">
            <div style="height: ${topSpacerHeight}px;"></div>
          </td>
        </tr>
      </thead>
      
      <!-- FOOTER SPACER (Repeats on every page) -->
      <tfoot style="display: table-footer-group;">
        <tr>
          <td style="border: none; padding: 0;">
            <div style="height: ${bottomSpacerHeight}px;"></div>
          </td>
        </tr>
      </tfoot>
      
      <!-- MAIN CONTENT -->
      <tbody>
        <tr>
          <td style="border: none; padding: 0;">
            <div class="limsv2-report">
              <main class="limsv2-report-body limsv2-report-body--pdf">${
      bodyHtml || "<p></p>"
    }</main>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  `
    : `
    <div class="limsv2-report">
      <main class="limsv2-report-body limsv2-report-body--pdf">${
      bodyHtml || "<p></p>"
    }</main>
    </div>
  `;

  const finalHtml = `<!DOCTYPE html>
<!-- FORCE V3 UPDATE -->
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<!-- Load Google Fonts for Indian Languages -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;700&family=Noto+Sans+Bengali:wght@400;700&family=Noto+Sans+Devanagari:wght@400;700&family=Noto+Sans+Gujarati:wght@400;700&family=Noto+Sans+Gurmukhi:wght@400;700&family=Noto+Sans+Kannada:wght@400;700&family=Noto+Sans+Malayalam:wght@400;700&family=Noto+Sans+Oriya:wght@400;700&family=Noto+Sans+Tamil:wght@400;700&family=Noto+Sans+Telugu:wght@400;700&display=swap" rel="stylesheet">
<style id="lims-report-baseline">${BASELINE_CSS}</style>
${
    normalizedCss
      ? `<style id="lims-report-custom">${normalizedCss}</style>`
      : ""
  }
${
    letterheadStyles
      ? `<style id="lims-letterhead">${letterheadStyles}</style>`
      : ""
  }
</head>
<body>
${wrappedBody}
</body>
</html>`;

  console.log("🎯 buildPdfBodyDocumentV2 FINAL CHECK before return:");
  console.log("  - letterheadStyles included?:", !!letterheadStyles);
  console.log("  - wrappedBody type:", typeof wrappedBody);
  console.log(
    "  - Final HTML includes page-bg div?:",
    finalHtml.includes("page-bg"),
  );

  return finalHtml;
}

/**
 * Apply styling to flag values AND result values in rendered HTML
 * - Wraps flag text (high, low, H, L, etc.) in styled spans
 * - Also colors the result value in the same table row
 */
/**
 * AUTO-FIX: Scans the rendered HTML and adds semantic classes to flag cells
 * This ensures existing templates (without explicit {{_FLAG_CLASS}}) still get colored flags
 *
 * Logic:
 * 1. Finds table cells in .report-table
 * 2. Checks content (Normal, Low, High, Critical)
 * 3. Appends class="flag-low" etc. to the <td>
 */
/**
 * AUTO-FIX: Scans the rendered HTML and adds semantic classes to flag cells AND value cells
 * This ensures existing templates get robust styling for both flags and values.
 *
 * Logic:
 * 1. Scans '<tr>' blocks to find rows with abnormal flags.
 * 2. If a row has a flag (Low, High, Critical), it:
 *    - Adds 'flag-[status]' to the flag cell.
 *    - Adds 'value-[status]' to the numeric value cell in the SAME row.
 */
function addFlagClassesToHtml(html: string): string {
  if (!html) return html;

  // Process each table row separately
  return html.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, (rowHtml) => {
    // 1. Determine flag status of this row
    let status = "";
    const lowerRow = rowHtml.toLowerCase();

    // Check for critical first (more specific)
    if (lowerRow.includes("critical_h") || lowerRow.includes("criticalh") ||
      lowerRow.includes(">h*<") || lowerRow.includes("> h* <")) {
      status = "critical_h";
    } else if (
      lowerRow.includes("critical_l") || lowerRow.includes("criticall") ||
      lowerRow.includes(">l*<") || lowerRow.includes("> l* <")
    ) status = "critical_l";
    else if (lowerRow.includes("critical")) status = "critical";
    // High / Low
    else if (
      lowerRow.includes(">high<") || lowerRow.includes(">h<") ||
      lowerRow.includes("> hh <") || lowerRow.includes(">hh<")
    ) status = "high";
    else if (
      lowerRow.includes(">low<") || lowerRow.includes(">l<") ||
      lowerRow.includes("> ll <") || lowerRow.includes(">ll<")
    ) status = "low";
    // Qualitative Abnormal (Red)
    else if (
      lowerRow.includes("detected") && !lowerRow.includes("not detected") ||
      lowerRow.includes("positive") ||
      lowerRow.includes("present") ||
      lowerRow.includes("reactive") && !lowerRow.includes("non-reactive")
    ) status = "abnormal";
    // Qualitative Warning (Amber)
    else if (
      lowerRow.includes("trace") || lowerRow.includes("borderline") ||
      lowerRow.includes("indeterminate")
    ) status = "trace";
    // Normal / Negative
    else if (
      lowerRow.includes(">normal<") || lowerRow.includes(">n<") ||
      lowerRow.includes("negative") ||
      lowerRow.includes("not detected") ||
      lowerRow.includes("absent") ||
      lowerRow.includes("non-reactive")
    ) status = "normal";

    if (!status) return rowHtml; // No flag found, return unchanged

    // 2. Inject classes into cells
    return rowHtml.replace(
      /(<td[^>]*>)([\s\S]*?)(<\/td>)/gi,
      (cellMatch, openTag, content, closeTag) => {
        const text = content.replace(/<[^>]+>/g, "").trim();
        const lowerText = text.toLowerCase();

        // Is this the FLAG cell? (Matches the status text)
        const isFlagCell =
          (status === "critical_h" &&
            (lowerText === "critical_h" || lowerText === "criticalh" || lowerText === "h*")) ||
          (status === "critical_l" &&
            (lowerText === "critical_l" || lowerText === "criticall" || lowerText === "l*")) ||
          (status === "high" && (lowerText === "high" || lowerText === "h" || lowerText === "hh")) ||
          (status === "low" && (lowerText === "low" || lowerText === "l" || lowerText === "ll")) ||
          (status === "abnormal" &&
            (lowerText.includes("detected") || lowerText === "positive" ||
              lowerText === "present" || lowerText === "reactive")) ||
          (status === "trace" &&
            (lowerText === "trace" || lowerText === "borderline")) ||
          (status === "normal" &&
            (lowerText === "normal" || lowerText === "n" ||
              lowerText === "negative" || lowerText.includes("not detected")));

        // Is this the VALUE cell? (Is numeric and NOT the flag cell)
        // Heuristic: It's a number, maybe with decimals/signs, and NOT empty
        const isValueCell = !isFlagCell &&
          /^[<>~]?\s*-?\d+(\.\d+)?\s*$/.test(text);

        let newClass = "";
        if (isFlagCell) newClass = `flag-${status}`;
        else if (isValueCell) newClass = `value-${status}`;

        if (newClass) {
          if (openTag.includes('class="')) {
            return openTag.replace('class="', `class="${newClass} `) + content +
              closeTag;
          } else {
            return openTag.replace("<td", `<td class="${newClass}"`) + content +
              closeTag;
          }
        }

        return cellMatch;
      },
    );
  });
}

/**
 * DEPRECATED: Old applyFlagStyling (kept for reference but unused if we use clean classes)
 */
function applyFlagStyling(html: string, settings?: any): string {
  // Pass through to the class adder first - this ALWAYS adds classes like value-high, flag-low
  let newHtml = addFlagClassesToHtml(html);

  // CSS injection is OPT-IN via marker OR lab settings
  // Marker in template: <!-- lims:enable-flag-styling --> or LIMS_ENABLE_FLAG_STYLING
  // OR settings.resultColors.enabled === true
  // DEFAULT: enabled unless explicitly disabled
  const optOut = settings?.resultColors?.enabled === false;
  const optIn = !optOut ||
    html.includes("lims:enable-flag-styling") ||
    html.includes("LIMS_ENABLE_FLAG_STYLING");

  if (optIn) {
    // Use lab-configured colors or defaults
    const high = settings?.resultColors?.high || "#dc2626";
    const low = settings?.resultColors?.low || "#ea580c";
    const normal = settings?.resultColors?.normal || "#1f2937";

    const css = `
<style>
/* Flag and Value Coloring - Injected via lims:enable-flag-styling marker or lab settings */
.flag-high, .value-high { color: ${high} !important; font-weight: 800; }
.flag-low, .value-low { color: ${low} !important; font-weight: 800; }
.flag-critical, .value-critical,
.flag-critical_h, .value-critical_h { color: ${high} !important; font-weight: 900; }
.flag-critical_l, .value-critical_l { color: ${low} !important; font-weight: 900; }
.flag-abnormal, .value-abnormal { color: ${high} !important; font-weight: 800; }
.flag-trace, .value-trace { color: ${low} !important; font-weight: 800; }
.flag-normal, .value-normal { color: ${normal} !important; font-weight: 700; }
</style>`;
    if (newHtml.includes("</head>")) {
      return newHtml.replace("</head>", css + "</head>");
    }
    return css + newHtml;
  }

  // No opt-in: Classes are still added by addFlagClassesToHtml
  // User's custom CSS can style .value-high, .flag-low etc with their own colors
  return newHtml;
}

/**
 * Apply header text color inline styles for PDF.co compatibility
 * This directly adds inline style="color: #fff" to h1/h2/div elements in report headers
 */
function applyHeaderTextColor(html: string, settings?: any): string {
  if (!html) return html;

  const headerColor = settings?.headerTextColor;
  if (!headerColor || headerColor === "inherit") return html;

  const color = headerColor === "white" ? "#ffffff" : headerColor;

  let styledHtml = html;

  // Strategy: Find the report-header section and identify h1/h2/divs inside it
  // Then add inline color styles

  // Check if we have a report-header class in the HTML
  if (!styledHtml.includes("report-header")) {
    console.log(
      "⚠️ No report-header found in HTML, skipping header text color",
    );
    return styledHtml;
  }

  // Approach: Process the HTML to add inline color to elements within report-header
  // We'll look for the pattern of header section and add styles

  // Pattern 1: Find <div class="report-header..."> and add color to children
  // Use a state machine approach to track when we're inside report-header

  let insideReportHeader = false;
  let depth = 0;
  let i = 0;
  let result = "";

  while (i < styledHtml.length) {
    // Check for opening div with report-header class
    const divMatch = styledHtml.slice(i).match(
      /^<div[^>]*class="[^"]*report-header[^"]*"[^>]*>/i,
    );
    if (divMatch) {
      insideReportHeader = true;
      depth = 1;
      result += divMatch[0];
      i += divMatch[0].length;
      continue;
    }

    // Track depth when inside report-header
    if (insideReportHeader) {
      const openDivMatch = styledHtml.slice(i).match(/^<div[^>]*>/i);
      if (openDivMatch) {
        depth++;
        result += openDivMatch[0];
        i += openDivMatch[0].length;
        continue;
      }

      const closeDivMatch = styledHtml.slice(i).match(/^<\/div>/i);
      if (closeDivMatch) {
        depth--;
        if (depth === 0) {
          insideReportHeader = false;
        }
        result += closeDivMatch[0];
        i += closeDivMatch[0].length;
        continue;
      }

      // Add color to h1 inside report-header
      const h1Match = styledHtml.slice(i).match(/^<h1([^>]*)>/i);
      if (h1Match) {
        const attrs = h1Match[1];
        if (attrs.includes("style=")) {
          // Append color to existing style
          const newTag = h1Match[0].replace(
            /style="([^"]*)"/i,
            `style="$1; color: ${color} !important;"`,
          );
          result += newTag;
        } else {
          // Add new style attribute
          result += `<h1${attrs} style="color: ${color};">`;
        }
        i += h1Match[0].length;
        continue;
      }

      // Add color to h2 inside report-header
      const h2Match = styledHtml.slice(i).match(/^<h2([^>]*)>/i);
      if (h2Match) {
        const attrs = h2Match[1];
        if (attrs.includes("style=")) {
          const newTag = h2Match[0].replace(
            /style="([^"]*)"/i,
            `style="$1; color: ${color} !important;"`,
          );
          result += newTag;
        } else {
          result += `<h2${attrs} style="color: ${color};">`;
        }
        i += h2Match[0].length;
        continue;
      }

      // Add color to div with report-subtitle class
      const subtitleMatch = styledHtml.slice(i).match(
        /^<div([^>]*class="[^"]*report-subtitle[^"]*"[^>]*)>/i,
      );
      if (subtitleMatch) {
        const attrs = subtitleMatch[1];
        if (attrs.includes("style=")) {
          const newTag = subtitleMatch[0].replace(
            /style="([^"]*)"/i,
            `style="$1; color: ${color} !important;"`,
          );
          result += newTag;
        } else {
          result += `<div${attrs} style="color: ${color};">`;
        }
        i += subtitleMatch[0].length;
        continue;
      }
    }

    // Regular character - copy as-is
    result += styledHtml[i];
    i++;
  }

  console.log("🎨 Applied header text color:", color);
  return result;
}

/**
 * Add draft watermark to HTML
 */
function addDraftWatermark(html: string): string {
  const watermarkDiv = '<div class="draft-watermark">DRAFT</div>';
  return html.replace("</body>", `${watermarkDiv}</body>`);
}

// ============================================================
// SECTION: Image Processing
// ============================================================

/**
 * Convert image URLs in HTML to base64 for PDF.co
 */
async function convertHtmlImagesToBase64(html: string): Promise<string> {
  if (!html || html.trim().length === 0) return "";

  const imgRegex = /<img([^>]*src=['"]([^'"]+)['"][^>]*)>/gi;
  const matches = [...html.matchAll(imgRegex)];

  let convertedHtml = html;

  for (const match of matches) {
    const fullImgTag = match[0];
    const imageUrl = match[2];

    // Skip if already base64
    if (imageUrl.startsWith("data:")) continue;

    try {
      const base64Src = await convertImageUrlToBase64(imageUrl);
      if (base64Src) {
        const newImgTag = fullImgTag.replace(imageUrl, base64Src);
        convertedHtml = convertedHtml.replace(fullImgTag, newImgTag);
        console.log(
          `✅ Converted image to base64: ${imageUrl.substring(0, 50)}...`,
        );
      }
    } catch (error) {
      console.warn(`⚠️ Failed to convert image ${imageUrl}:`, error);
    }
  }

  return convertedHtml;
}

/**
 * Fetch image URL and convert to base64 data URL
 */
async function convertImageUrlToBase64(imageUrl: string): Promise<string> {
  try {
    // Strip ImageKit transformations for base64 conversion
    // ImageKit transformations like /tr:w-800,h-600/ can cause issues with base64
    let cleanUrl = imageUrl;
    if (imageUrl.includes("ik.imagekit.io") && imageUrl.includes("/tr:")) {
      // Remove transformation parameters: /tr:w-800,h-600/ -> /
      cleanUrl = imageUrl.replace(/\/tr:[^/]+\//, "/");
      console.log(
        `  🔧 Stripped ImageKit transforms: ${imageUrl} -> ${cleanUrl}`,
      );
    }
    // 1. Parse request body
    const {
      record,
      old_record,
      type,
      orderId: requestOrderId,
      htmlOverride, // NEW: For Manual Design Studio
      isManualDesign, // NEW: Flag
    } = await req.json();

    // Determine Order ID
    const orderId = requestOrderId || record?.id;

    if (!orderId) {
      throw new Error("No order_id provided in request body or record");
    }

    console.log(
      `\n📄 GENERATING PDF for Order: ${orderId} ${
        isManualDesign ? "(MANUAL DESIGN MODE)" : "(AUTO MODE)"
      }`,
    );

    // ========================================
    // MANUAL MODE: Bypass Template Logic
    // ========================================
    if (isManualDesign && htmlOverride) {
      console.log("🎨 Manual Design detected. Bypassing template generation.");
      console.log("📝 HTML Content Length:", htmlOverride.length);

      // Validate HTML slightly
      if (!htmlOverride.includes("<!DOCTYPE html>")) {
        console.warn("⚠️ Manual HTML missing DOCTYPE, might cause issues.");
      }

      // Prepare filename
      const filename = `Report_${orderId}_${new Date().getTime()}.pdf`;

      // Send directly to PDF.co
      const pdfUrl = await sendHtmlToPdfCo(
        htmlOverride,
        filename,
        PDFCO_API_KEY,
        {
          // For manual design, we assume the HTML is fully formed (A4 sized divs)
          // So we disable margins and headers/footers in PDF.co to let HTML control layout
          margins: "0px 0px 0px 0px",
          paperSize: "A4",
          printBackground: true,
          displayHeaderFooter: false,
        },
      );

      console.log("✅ PDF generated successfully via Manual Mode:", pdfUrl);

      // Upload to Storage
      const { publicUrl } = await uploadPdfToStorage(
        supabaseClient,
        pdfUrl,
        orderId,
        undefined, // lab_id not strictly needed for path construction if simplified
        "manual_patient",
        filename,
        "final",
      );

      // Update Database (Basic)
      // We might not have all patient details here if we didn't fetch them,
      // but typically the frontend triggers this AFTER saving the order, so updates strictly to 'reports' table
      // might be needed. For now, just return the URL.

      return new Response(
        JSON.stringify({
          success: true,
          pdfUrl: publicUrl,
          status: "completed",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ========================================
    // AUTO MODE: Original Logic
    // ========================================

    // Initialize job tracking
    job = await createJob(supabaseClient, orderId);
    console.log("✅ Job created:", job.id);

    const response = await fetch(cleanUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Convert to base64
    let binary = "";
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);

    // Detect content type
    const contentType = response.headers.get("content-type") || "image/png";
    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    console.warn("Failed to convert image to base64:", error);
    return "";
  }
}

// ============================================================
// SECTION: PDF.co API Integration
// ============================================================

/**
 * Poll PDF.co async job until completion
 */
async function pollPdfCoJob(
  jobId: string,
  apiKey: string,
  maxAttempts = 60,
): Promise<string> {
  const pollInterval = 2000; // 2 seconds

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(
      `📊 Polling PDF.co job ${jobId} (attempt ${attempt}/${maxAttempts})...`,
    );

    const response = await fetch(`${PDFCO_JOB_STATUS_URL}?jobid=${jobId}`, {
      headers: { "x-api-key": apiKey },
    });

    if (!response.ok) {
      throw new Error(`PDF.co job status check failed: ${response.status}`);
    }

    const result = await response.json();

    if (result.status === "success" && result.url) {
      console.log("✅ PDF.co job completed:", result.url);
      return result.url;
    }

    if (result.status === "error") {
      throw new Error(`PDF.co job failed: ${result.message}`);
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error("PDF.co job polling timed out");
}

/**
 * Send HTML to PDF.co API and get PDF URL
 */
async function sendHtmlToPdfCo(
  html: string,
  filename: string,
  apiKey: string,
  options: {
    headerHtml?: string;
    footerHtml?: string;
    margins?: string;
    headerHeight?: string;
    footerHeight?: string;
    scale?: number;
    displayHeaderFooter?: boolean;
    paperSize?: string;
    mediaType?: string;
    printBackground?: boolean;
    grayscale?: boolean; // Convert to black & white for print versions
  } = {},
): Promise<string> {
  console.log("📤 Sending HTML to PDF.co API...");
  console.log("  Filename:", filename);
  console.log("  HTML length:", html.length);
  console.log("  Header length:", options.headerHtml?.length || 0);
  console.log("  Footer length:", options.footerHtml?.length || 0);

  const payload: Record<string, any> = {
    name: filename,
    html: html,
    async: true, // Use async for large documents
    margins: options.margins || DEFAULT_PDF_SETTINGS.margins,
    paperSize: options.paperSize || DEFAULT_PDF_SETTINGS.paperSize,
    displayHeaderFooter: options.displayHeaderFooter ??
      DEFAULT_PDF_SETTINGS.displayHeaderFooter,
    header: options.headerHtml || "",
    footer: options.footerHtml || "",
    headerHeight: options.headerHeight || DEFAULT_PDF_SETTINGS.headerHeight,
    footerHeight: options.footerHeight || DEFAULT_PDF_SETTINGS.footerHeight,
    scale: options.scale ?? DEFAULT_PDF_SETTINGS.scale,
    mediaType: options.mediaType || DEFAULT_PDF_SETTINGS.mediaType,
    printBackground: options.printBackground ??
      DEFAULT_PDF_SETTINGS.printBackground,
  };

  // Add grayscale filter for print versions (converts colors to B&W)
  // PDF.co expects profiles as a JSON string with specific format
  if (options.grayscale) {
    // Use CSS filter instead since PDF.co profiles format is complex
    // We'll inject grayscale CSS into the HTML instead
    console.log("  🖨️ Grayscale mode requested - will apply via CSS filter");
  }

  const response = await fetch(PDFCO_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `PDF.co API error: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  const result = await response.json();

  if (result.error) {
    throw new Error(`PDF.co API error: ${result.message}`);
  }

  // Handle synchronous response
  if (result.url) {
    console.log("✅ PDF generated synchronously:", result.url);
    return result.url;
  }

  // Handle async response (poll for completion)
  if (result.jobId) {
    console.log("📋 PDF.co async job queued:", result.jobId);
    return pollPdfCoJob(result.jobId, apiKey);
  }

  throw new Error("PDF.co API did not return a result URL or jobId");
}

// ============================================================
// SECTION: Section Content Injection (PBS/Radiology findings, impressions)
// ============================================================

/**
 * Fetch section content for a result and return as a map of placeholder_key -> final_content
 */
async function fetchSectionContent(
  supabaseClient: any,
  resultIds: string[],
  includeImages = true,
): Promise<Record<string, string>> {
  if (!resultIds || resultIds.length === 0) return {};

  try {
    const { data, error } = await supabaseClient
      .from("result_section_content")
      .select(`
        final_content,
        image_urls,
        lab_template_sections!inner(
          placeholder_key
        )
      `)
      .in("result_id", resultIds)
      .not("lab_template_sections.placeholder_key", "is", null);

    if (error || !data) {
      console.warn("Failed to fetch section content:", error?.message);
      return {};
    }

    // Build map of placeholder_key -> final_content
    const sectionMap: Record<string, string> = {};
    for (const item of data) {
      const key = item.lab_template_sections?.placeholder_key;
      if (key) {
        const content = item.final_content ? String(item.final_content) : "";
        const imageUrls = parseSectionImageUrls(item.image_urls);
        const imagesHtml = includeImages ? buildSectionImagesHtml(imageUrls) : "";
        const combined = [content.trim(), imagesHtml].filter(Boolean).join("\n\n");
        if (combined) {
          sectionMap[key] = combined;
        }
      }
    }

    return sectionMap;
  } catch (err) {
    console.warn("Error fetching section content:", err);
    return {};
  }
}

/**
 * Format section content to HTML
 */
function formatSectionContentToHtml(content: string): string {
  if (!content) return "";

  const trimmed = content.trim();
  if (!trimmed) return "";

  if (/^\s*</.test(trimmed)) {
    return trimmed;
  }

  const renderMarkdownBold = (value: string) =>
    value.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  const paragraphs = trimmed
    .split(/\n\n+/)
    .map((para) => para.trim())
    .filter(Boolean);

  const labeledParagraphs =
    paragraphs.length > 1 &&
    paragraphs.every((para) => /^\*\*.+?\*\*\s*[:\-]/.test(para));

  if (labeledParagraphs) {
    const items = paragraphs
      .map((para) => renderMarkdownBold(para.replace(/\n/g, "<br/>")))
      .map((para) => `<li>${para}</li>`)
      .join("");
    return `<ul>${items}</ul>`;
  }

  // Preserve basic formatting: convert newlines to proper HTML paragraphs/breaks
  // Content comes from doctor input (CKEditor), preserve formatting
  return paragraphs
    .map((para) => {
      if (/^\s*</.test(para)) {
        return para;
      }

      const lines = para.split(/\n/).map((line) => line.trim());
      const isBulletList = lines.length > 1 && lines.every((line) =>
        /^[-•]\s+/.test(line)
      );

      if (isBulletList) {
        const items = lines
          .map((line) => line.replace(/^[-•]\s+/, ""))
          .map((line) => renderMarkdownBold(line))
          .map((line) => `<li>${line}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }

      // Convert single newlines to <br/> within paragraphs
      const withBreaks = renderMarkdownBold(para.replace(/\n/g, "<br/>"));
      return `<p>${withBreaks}</p>`;
    })
    .filter(Boolean)
    .join("");
}

function parseSectionImageUrls(imageUrls: unknown): string[] {
  if (!imageUrls) return [];
  if (Array.isArray(imageUrls)) {
    return imageUrls.filter((url) => typeof url === "string" && url.trim());
  }

  if (typeof imageUrls === "string") {
    try {
      const parsed = JSON.parse(imageUrls);
      if (Array.isArray(parsed)) {
        return parsed.filter((url) => typeof url === "string" && url.trim());
      }
    } catch {
      if (imageUrls.trim()) {
        return [imageUrls.trim()];
      }
    }
  }

  return [];
}

function buildSectionImagesHtml(imageUrls: string[]): string {
  if (!imageUrls.length) return "";

  const images = imageUrls
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => applyAttachmentImageTransformations(url, 520))
    .map(
      (url) =>
        `<img class="section-image" src="${url}" alt="Section Image" style="max-width: 100%; height: auto; border: 1px solid #e5e7eb; border-radius: 6px;" />`,
    )
    .join("");

  if (!images) return "";

  return `
    <div class="section-images" style="display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px;">
      ${images}
    </div>
  `.trim();
}

/**
 * Inject section content into HTML by replacing section placeholders
 * Supports both formats:
 *   - {{section:key}} (prefixed format)
 *   - {{key}} (simple format used in Template Studio)
 * Returns: { html, uninjectedSections } - uninjectedSections contains sections that had no matching placeholder
 */
function normalizeSectionKey(
  key: string,
): { rawKey: string; originalKey: string } {
  const trimmed = (key || "").trim();
  if (!trimmed) {
    return { rawKey: "", originalKey: "" };
  }
  if (trimmed.toLowerCase().startsWith("section:")) {
    return { rawKey: trimmed.slice(8), originalKey: trimmed };
  }
  return { rawKey: trimmed, originalKey: trimmed };
}

function injectSectionContent(
  html: string,
  sectionContent: Record<string, string>,
): { html: string; uninjectedSections: Record<string, string> } {
  if (!html || Object.keys(sectionContent).length === 0) {
    return { html, uninjectedSections: {} };
  }

  let resultHtml = html;
  const uninjectedSections: Record<string, string> = {};
  let injectedCount = 0;

  for (const [key, content] of Object.entries(sectionContent)) {
    if (!content) continue;

    const { rawKey, originalKey } = normalizeSectionKey(key);
    if (!rawKey) continue;

    // Try both placeholder formats:
    // 1. {{section:key}} - prefixed format
    // 2. {{key}} - simple format (used in Template Studio CKEditor)
    // 3. {{section:...}} stored directly as placeholder_key
    const prefixedPlaceholder = `{{section:${rawKey}}}`;
    const simplePlaceholder = `{{${rawKey}}}`;
    const originalPlaceholder = originalKey.startsWith("section:")
      ? `{{${originalKey}}}`
      : null;

    const formattedContent = formatSectionContentToHtml(content);
    // Add inline styles as fallback in case CSS doesn't load
    const wrappedContent =
      `<div class="section-content" style="font-family: 'Inter', Arial, sans-serif; font-size: 13px; line-height: 1.7; color: #1f2937;">${formattedContent}</div>`;

    let found = false;

    // Check prefixed format first
    if (
      resultHtml.includes(prefixedPlaceholder) ||
      resultHtml.toLowerCase().includes(prefixedPlaceholder.toLowerCase())
    ) {
      const prefixedRegex = new RegExp(
        prefixedPlaceholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "gi",
      );
      resultHtml = resultHtml.replace(prefixedRegex, wrappedContent);
      found = true;
      injectedCount++;
      console.log(
        `📝 Injected section "${rawKey}" via {{section:${rawKey}}} placeholder`,
      );
    } // Check simple format (e.g., {{impression}})
    else if (
      resultHtml.includes(simplePlaceholder) ||
      resultHtml.toLowerCase().includes(simplePlaceholder.toLowerCase())
    ) {
      const simpleRegex = new RegExp(
        simplePlaceholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "gi",
      );
      resultHtml = resultHtml.replace(simpleRegex, wrappedContent);
      found = true;
      injectedCount++;
      console.log(
        `📝 Injected section "${rawKey}" via {{${rawKey}}} placeholder`,
      );
    } // Check original placeholder (if key already includes section: prefix)
    else if (
      originalPlaceholder &&
      (resultHtml.includes(originalPlaceholder) ||
        resultHtml.toLowerCase().includes(originalPlaceholder.toLowerCase()))
    ) {
      const originalRegex = new RegExp(
        originalPlaceholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "gi",
      );
      resultHtml = resultHtml.replace(originalRegex, wrappedContent);
      found = true;
      injectedCount++;
      console.log(
        `📝 Injected section "${rawKey}" via {{${originalKey}}} placeholder`,
      );
    }

    if (!found) {
      // No placeholder found - track for fallback rendering
      uninjectedSections[rawKey] = content;
    }
  }

  console.log(
    `📝 Injected ${injectedCount} section(s) via placeholders, ${
      Object.keys(uninjectedSections).length
    } need fallback:`,
    Object.keys(sectionContent),
  );

  return { html: resultHtml, uninjectedSections };
}

/**
 * Generate fallback HTML for sections that weren't injected via placeholders
 * This ensures sections are included even when templates don't have specific placeholders
 */
function generateFallbackSectionsHtml(
  uninjectedSections: Record<string, string>,
): string {
  if (Object.keys(uninjectedSections).length === 0) return "";

  const sectionsHtml = Object.entries(uninjectedSections)
    .map(([key, content]) => {
      const formattedContent = formatSectionContentToHtml(content);
      // Capitalize first letter and replace underscores with spaces for display
      const sectionTitle = key.charAt(0).toUpperCase() +
        key.slice(1).replace(/_/g, " ");

      return `
        <div class="report-section fallback-section" style="margin-top: 16px; padding: 12px 0; border-top: 1px solid #e5e7eb;">
          <h4 style="font-family: 'Inter', Arial, sans-serif; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">${sectionTitle}</h4>
          <div class="section-content" style="font-family: 'Inter', Arial, sans-serif; font-size: 13px; color: #1f2937; line-height: 1.7;">
            ${formattedContent}
          </div>
        </div>
      `;
    })
    .join("");

  console.log(
    `📝 Generated fallback HTML for ${
      Object.keys(uninjectedSections).length
    } section(s):`,
    Object.keys(uninjectedSections),
  );

  return sectionsHtml;
}

// ============================================================
// SECTION: Report Extras (Trend Charts, Clinical Summary)
// ============================================================

/**
 * Generate watermark HTML
 */
function generateWatermarkHtml(settings: {
  enabled: boolean;
  imageUrl: string;
  opacity: number;
  position: string;
  size: string;
  rotation: number;
}): string {
  if (!settings.enabled || !settings.imageUrl) return "";

  const positionStyles: Record<string, string> = {
    "center": "top: 50%; left: 50%; transform: translate(-50%, -50%)",
    "top-left": "top: 10%; left: 10%",
    "top-right": "top: 10%; right: 10%",
    "bottom-left": "bottom: 10%; left: 10%",
    "bottom-right": "bottom: 10%; right: 10%",
  };

  const position = positionStyles[settings.position] ||
    positionStyles["center"];
  const rotation = settings.rotation ? `rotate(${settings.rotation}deg)` : "";
  const transform = position.includes("translate")
    ? position.replace(")", ` ${rotation})`)
    : `${position}; transform: ${rotation}`;

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
  `;
}

/**
 * Format clinical summary text with proper HTML structure
 * Parses structured text with sections, bullets, and formatting
 */
function formatClinicalSummary(text: string): string {
  if (!text) return "";

  let html = text;

  // Convert **Section Headers** to bold with proper styling
  html = html.replace(
    /\*\*([^*]+)\*\*/g,
    '<div style="font-weight: bold; color: #1e40af; margin-top: 15px; margin-bottom: 8px; font-size: 14px;">$1</div>',
  );

  // Convert bullet points • to proper HTML lists
  const lines = html.split("\n");
  let inList = false;
  const processedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith("•")) {
      if (!inList) {
        processedLines.push(
          '<ul style="margin: 8px 0; padding-left: 20px; list-style-type: disc;">',
        );
        inList = true;
      }
      const content = line.substring(1).trim();
      processedLines.push(
        `<li style="margin: 4px 0; color: #374151;">${content}</li>`,
      );
    } else {
      if (inList) {
        processedLines.push("</ul>");
        inList = false;
      }
      if (line) {
        // Check if it's a section header (already converted to div above)
        if (!line.includes('<div style="font-weight: bold')) {
          processedLines.push(
            `<p style="margin: 8px 0; color: #374151;">${line}</p>`,
          );
        } else {
          processedLines.push(line);
        }
      }
    }
  }

  if (inList) {
    processedLines.push("</ul>");
  }

  return processedLines.join("\n");
}

/**
 * Generate HTML for report extras (trend charts, clinical summary, AI summaries, patient summary)
 */
function generateReportExtrasHtml(extras: {
  trend_charts?: any[];
  clinical_summary?: string;
  trend_graph_data?: any;
  ai_clinical_summary?: string;
  ai_patient_summary?: string;
  patient_summary_language?: string;
  ai_doctor_summary?: string;
  include_trend_graphs?: boolean;
  results_extras?: any[];
}): string {
  if (!extras) return "";

  let html = "";

  // Trend charts from report_extras table
  if (extras.trend_charts && extras.trend_charts.length > 0) {
    html +=
      '<div class="report-extras-trends" style="margin-top: 20px; page-break-inside: avoid;">';
    html += '<h3 style="margin-bottom: 10px;">Historical Trends</h3>';

    for (const chart of extras.trend_charts) {
      if (chart.image_base64) {
        html += `<div class="trend-chart" style="margin: 10px 0;">`;
        html += `<img src="${chart.image_base64}" alt="${
          chart.analyte_name || "Trend"
        }" style="max-width: 100%; height: auto;" />`;
        if (chart.analyte_name) {
          html +=
            `<p style="font-size: 11px; text-align: center; margin-top: 5px;">${chart.analyte_name}</p>`;
        }
        html += `</div>`;
      }
    }

    html += "</div>";
  }

  // Trend graph data from orders table (if include_trend_graphs is true)
  if (extras.include_trend_graphs !== false && extras.trend_graph_data) {
    const trendData = extras.trend_graph_data;
    if (trendData.image_base64 || trendData.svg) {
      html +=
        '<div class="report-trend-graph" style="margin-top: 20px; page-break-inside: avoid;">';
      html += '<h3 style="margin-bottom: 10px;">Trend Analysis</h3>';
      if (trendData.image_base64) {
        html +=
          `<img src="${trendData.image_base64}" alt="Trend Graph" style="max-width: 100%; height: auto;" />`;
      } else if (trendData.svg) {
        html += trendData.svg;
      }
      html += "</div>";
    }

    // Analyzer graphs from machine interface (stored in trend_graph_data.analyzer_graphs)
    if (trendData.analyzer_graphs) {
      const analyzerData = trendData.analyzer_graphs;

      // Render stored images (histograms, scatter plots, etc.)
      if (analyzerData.images && analyzerData.images.length > 0) {
        html +=
          '<div class="analyzer-graphs-section" style="margin-top: 25px; page-break-inside: avoid;">';
        html +=
          '<h3 style="margin-bottom: 15px; color: #1e40af; border-bottom: 2px solid #3b82f6; padding-bottom: 8px;">Analyzer Graphs</h3>';

        html +=
          '<div style="display: flex; flex-wrap: wrap; gap: 15px; justify-content: center;">';
        for (const img of analyzerData.images) {
          html += `<div style="text-align: center; max-width: 45%;">`;
          html +=
            `<img src="${img.url}" alt="${img.name}" style="max-width: 100%; height: auto; border: 1px solid #e5e7eb; border-radius: 4px;" />`;
          html +=
            `<p style="margin-top: 5px; font-size: 11px; color: #6b7280;">${img.name}</p>`;
          html += `</div>`;
        }
        html += "</div>";

        // AI analysis of the graphs
        if (analyzerData.ai_analysis && analyzerData.ai_analysis.length > 0) {
          html +=
            '<div style="margin-top: 15px; padding: 12px; background: #f0f9ff; border-radius: 6px; border-left: 4px solid #3b82f6;">';
          html +=
            '<p style="margin: 0 0 8px 0; font-weight: bold; color: #1e40af; font-size: 12px;">AI Graph Analysis:</p>';
          for (const analysis of analyzerData.ai_analysis) {
            if (analysis.description) {
              html +=
                `<p style="margin: 4px 0; font-size: 11px; color: #374151;">• <strong>${
                  analysis.name || analysis.type
                }:</strong> ${analysis.description}</p>`;
            }
          }
          html += "</div>";
        }

        if (analyzerData.instrument) {
          html +=
            `<p style="margin-top: 10px; font-size: 10px; color: #9ca3af; text-align: right;">Source: ${analyzerData.instrument}</p>`;
        }

        html += "</div>";
      }
    }
  }

  // Clinical summary from report_extras table
  if (extras.clinical_summary) {
    // Format clinical summary with proper HTML structure
    const formattedSummary = formatClinicalSummary(extras.clinical_summary);
    html +=
      '<div class="report-extras-summary clinical-summary-section" style="margin-top: 30px; border: 2px solid #3b82f6; border-radius: 8px; padding: 20px; background: #eff6ff;">';
    html +=
      '<h2 class="clinical-summary-title" style="margin: 0 0 15px 0; color: #1e40af; font-size: 18px; font-weight: bold; text-align: center; border-bottom: 2px solid #3b82f6; padding-bottom: 10px; page-break-after: avoid; break-after: avoid;">AI Clinical Interpretation</h2>';
    html +=
      `<div class="clinical-summary-content" style="font-size: 13px; line-height: 1.6; color: #1f2937;">${formattedSummary}</div>`;
    html += "</div>";
  }

  // AI Clinical Summary from orders table
  if (extras.ai_clinical_summary) {
    const formattedAiSummary = formatClinicalSummary(
      extras.ai_clinical_summary,
    );
    html +=
      '<div class="report-ai-summary" style="margin-top: 30px; border: 2px solid #3b82f6; border-radius: 8px; padding: 20px; background: #eff6ff;">';
    html +=
      '<h2 style="margin: 0 0 15px 0; color: #1e40af; font-size: 18px; font-weight: bold; text-align: center; border-bottom: 2px solid #3b82f6; padding-bottom: 10px; page-break-after: avoid; break-after: avoid;">AI Clinical Interpretation</h2>';
    html +=
      `<div style="font-size: 13px; line-height: 1.6; color: #1f2937;">${formattedAiSummary}</div>`;
    html += "</div>";
  }

  // AI Doctor Summary from reports table
  if (extras.ai_doctor_summary) {
    html +=
      '<div class="report-doctor-summary" style="margin-top: 20px;">';
    html += '<h3 style="margin-bottom: 10px; page-break-after: avoid; break-after: avoid;">Doctor\'s Summary</h3>';
    html +=
      `<div style="padding: 10px; background: #f9fafb; border-radius: 4px;">${extras.ai_doctor_summary}</div>`;
    html += "</div>";
  }

  // AI Patient Summary from orders table (patient-friendly explanation)
  if (extras.ai_patient_summary) {
    try {
      const patientSummary = typeof extras.ai_patient_summary === "string"
        ? JSON.parse(extras.ai_patient_summary)
        : extras.ai_patient_summary;

      const languageLabel = extras.patient_summary_language
        ? ` (${
          extras.patient_summary_language.charAt(0).toUpperCase() +
          extras.patient_summary_language.slice(1)
        })`
        : "";

      html +=
        '<div class="report-patient-summary" style="margin-top: 30px; border: 2px solid #db2777; border-radius: 8px; padding: 20px; background: #fdf2f8;">';
      html +=
        `<h2 style="margin: 0 0 15px 0; color: #be185d; font-size: 18px; font-weight: bold; text-align: center; border-bottom: 2px solid #db2777; padding-bottom: 10px; page-break-after: avoid; break-after: avoid;">Your Results Summary${languageLabel}</h2>`;

      // Health Status
      if (patientSummary.health_status) {
        html += '<div style="margin-bottom: 15px;">';
        html +=
          '<h3 style="margin: 0 0 8px 0; color: #be185d; font-size: 14px; font-weight: bold;">Overall Health Status</h3>';
        html +=
          `<p style="margin: 0; font-size: 13px; line-height: 1.5; color: #1f2937;">${patientSummary.health_status}</p>`;
        html += "</div>";
      }

      // Normal Findings - Support both detailed (new) and simple (legacy) formats
      if (
        patientSummary.normal_findings_detailed &&
        patientSummary.normal_findings_detailed.length > 0
      ) {
        // New detailed format with explanations
        html += '<div style="margin-bottom: 15px;">';
        html +=
          `<h3 style="margin: 0 0 8px 0; color: #16a34a; font-size: 14px; font-weight: bold;">✓ Normal Findings (${patientSummary.normal_findings_detailed.length} tests)</h3>`;
        for (const finding of patientSummary.normal_findings_detailed) {
          html +=
            '<div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 10px; margin-bottom: 8px;">';
          html +=
            `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">`;
          html +=
            `<span style="font-weight: bold; color: #166534; font-size: 13px;">${
              finding.test_name || "Test"
            }</span>`;
          html +=
            `<span style="background: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 10px; font-size: 11px;">✓ Normal</span>`;
          html += "</div>";
          if (finding.value) {
            html +=
              `<p style="margin: 4px 0; font-size: 12px; color: #374151;"><strong>Value:</strong> ${finding.value}</p>`;
          }
          if (finding.what_it_measures) {
            html +=
              `<p style="margin: 4px 0; font-size: 12px; color: #1d4ed8;"><strong>What it measures:</strong> ${finding.what_it_measures}</p>`;
          }
          if (finding.your_result_means) {
            html +=
              `<p style="margin: 4px 0; font-size: 12px; color: #166534;"><strong>Your result:</strong> ${finding.your_result_means}</p>`;
          }
          html += "</div>";
        }
        html += "</div>";
      } else if (
        patientSummary.normal_findings &&
        patientSummary.normal_findings.length > 0
      ) {
        // Legacy simple format (array of strings)
        html += '<div style="margin-bottom: 15px;">';
        html +=
          '<h3 style="margin: 0 0 8px 0; color: #16a34a; font-size: 14px; font-weight: bold;">✓ Normal Findings</h3>';
        html +=
          '<ul style="margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.6; color: #1f2937;">';
        for (const finding of patientSummary.normal_findings) {
          html += `<li>${finding}</li>`;
        }
        html += "</ul></div>";
      } else if (patientSummary.normal_findings_summary) {
        // Summary text format
        html += '<div style="margin-bottom: 15px;">';
        html +=
          '<h3 style="margin: 0 0 8px 0; color: #16a34a; font-size: 14px; font-weight: bold;">✓ Normal Findings</h3>';
        html +=
          `<p style="margin: 0; font-size: 13px; line-height: 1.5; color: #1f2937;">${patientSummary.normal_findings_summary}</p>`;
        html += "</div>";
      }

      // Abnormal Findings - Enhanced to support new fields
      if (
        patientSummary.abnormal_findings &&
        patientSummary.abnormal_findings.length > 0
      ) {
        html += '<div style="margin-bottom: 15px;">';
        html +=
          '<h3 style="margin: 0 0 8px 0; color: #dc2626; font-size: 14px; font-weight: bold;">⚠ Areas Needing Attention</h3>';
        for (const finding of patientSummary.abnormal_findings) {
          // Handle both string and object formats for abnormal findings
          if (typeof finding === "string") {
            html +=
              `<div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 10px; margin-bottom: 8px;">`;
            html +=
              `<p style="margin: 0; font-size: 13px; color: #1f2937;">${finding}</p>`;
            html += "</div>";
          } else {
            // Object format with detailed fields
            const findingName = finding.test_name || finding.name ||
              finding.parameter || finding.label || "Finding";
            const status = finding.status || "abnormal";
            const statusColor = status === "critical"
              ? "#b91c1c"
              : status === "high"
              ? "#dc2626"
              : status === "low"
              ? "#1d4ed8"
              : "#d97706";
            const statusBg = status === "critical"
              ? "#fee2e2"
              : status === "high"
              ? "#fee2e2"
              : status === "low"
              ? "#dbeafe"
              : "#fef3c7";
            const statusLabel = status === "critical"
              ? "⚠️ Critical"
              : status === "high"
              ? "↑ High"
              : status === "low"
              ? "↓ Low"
              : "Abnormal";

            html += `<div style="background: ${statusBg}; border: 1px solid ${
              status === "critical" || status === "high"
                ? "#fecaca"
                : status === "low"
                ? "#bfdbfe"
                : "#fde68a"
            }; border-radius: 6px; padding: 10px; margin-bottom: 8px;">`;
            html +=
              `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">`;
            html +=
              `<span style="font-weight: bold; color: ${statusColor}; font-size: 13px;">${findingName}</span>`;
            html +=
              `<span style="background: white; color: ${statusColor}; padding: 2px 8px; border-radius: 10px; font-size: 11px; border: 1px solid ${statusColor};">${statusLabel}</span>`;
            html += "</div>";
            if (finding.value) {
              html +=
                `<p style="margin: 4px 0; font-size: 12px; color: #374151;"><strong>Value:</strong> ${finding.value}</p>`;
            }
            if (finding.what_it_measures) {
              html +=
                `<p style="margin: 4px 0; font-size: 12px; color: #1d4ed8;"><strong>What it measures:</strong> ${finding.what_it_measures}</p>`;
            }
            if (finding.explanation) {
              html +=
                `<p style="margin: 4px 0; font-size: 12px; color: #92400e;"><strong>What this means:</strong> ${finding.explanation}</p>`;
            }
            if (finding.what_to_do) {
              html +=
                `<p style="margin: 4px 0; font-size: 12px; color: #7c3aed;"><strong>What to do:</strong> ${finding.what_to_do}</p>`;
            }
            if (finding.trend) {
              const trendEmoji = finding.trend === "improving"
                ? "📈"
                : finding.trend === "worsening"
                ? "📉"
                : finding.trend === "stable"
                ? "➡️"
                : "🆕";
              const trendColor = finding.trend === "improving"
                ? "#16a34a"
                : finding.trend === "worsening"
                ? "#dc2626"
                : "#6b7280";
              html +=
                `<p style="margin: 4px 0; font-size: 11px; color: ${trendColor};"><strong>Trend:</strong> ${trendEmoji} ${
                  finding.trend.charAt(0).toUpperCase() + finding.trend.slice(1)
                }</p>`;
            }
            html += "</div>";
          }
        }
        html += "</div>";
      }

      // Consultation Recommendation - Support both field names
      const consultMessage = patientSummary.consultation_recommendation ||
        patientSummary.consultation_message;
      if (consultMessage) {
        html +=
          '<div style="margin-bottom: 15px; background: #fef2f2; padding: 12px; border-radius: 6px; border-left: 4px solid #dc2626;">';
        html +=
          `<h3 style="margin: 0 0 8px 0; color: #dc2626; font-size: 14px; font-weight: bold;">📋 ${
            patientSummary.needs_consultation
              ? "Doctor Consultation Recommended"
              : "Recommendation"
          }</h3>`;
        html +=
          `<p style="margin: 0; font-size: 13px; line-height: 1.5; color: #1f2937;">${consultMessage}</p>`;
        html += "</div>";
      }

      // Health Tips
      if (patientSummary.health_tips && patientSummary.health_tips.length > 0) {
        html += '<div style="margin-bottom: 10px;">';
        html +=
          '<h3 style="margin: 0 0 8px 0; color: #0891b2; font-size: 14px; font-weight: bold;">💡 Health Tips</h3>';
        html +=
          '<ul style="margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.6; color: #1f2937;">';
        for (const tip of patientSummary.health_tips) {
          html += `<li>${tip}</li>`;
        }
        html += "</ul></div>";
      }

      // Summary Message (new field - warm closing note)
      if (patientSummary.summary_message) {
        html +=
          '<div style="margin-bottom: 10px; background: linear-gradient(135deg, #fdf2f8 0%, #fce7f3 100%); padding: 12px; border-radius: 6px; border: 1px solid #fbcfe8;">';
        html +=
          `<p style="margin: 0; font-size: 13px; line-height: 1.5; color: #be185d; font-style: italic; text-align: center;">💖 ${patientSummary.summary_message}</p>`;
        html += "</div>";
      }

      html +=
        '<p style="font-size: 11px; color: #6b7280; text-align: center; margin: 15px 0 0 0; font-style: italic;">This summary is for your understanding. Please consult your doctor for medical advice.</p>';
      html += "</div>";
    } catch (e) {
      // If JSON parsing fails, render as plain text
      console.log("Patient summary parsing failed, rendering as text:", e);
      html +=
        '<div class="report-patient-summary" style="margin-top: 30px; border: 2px solid #db2777; border-radius: 8px; padding: 20px; background: #fdf2f8;">';
      html +=
        '<h2 style="margin: 0 0 15px 0; color: #be185d; font-size: 18px; font-weight: bold; text-align: center; border-bottom: 2px solid #db2777; padding-bottom: 10px; page-break-after: avoid; break-after: avoid;">Your Results Summary</h2>';
      html +=
        `<div style="font-size: 13px; line-height: 1.6; color: #1f2937;">${extras.ai_patient_summary}</div>`;
      html += "</div>";
    }
  }

  return html;
}

// ============================================================
// SECTION: Attachment Processing
// ============================================================

/**
 * Apply ImageKit transformations to letterhead background for crisp A4 rendering.
 * Requests 2480px wide (A4 @ 300dpi), high quality, PNG format to eliminate
 * JPEG compression artifacts that cause brown/pixelated backgrounds.
 */
function applyLetterheadImageTransform(url: string): string {
  if (!url) return url;
  if (!url.includes("ik.imagekit.io")) return url;

  try {
    const urlObj = new URL(url);

    // If transformations already exist, replace them for letterhead-quality
    if (url.includes("/tr:")) {
      return url.replace(/\/tr:[^/]+/, "/tr:w-2480,h-3508,c-force,q-95,f-png");
    }
    if (url.includes("?tr=")) {
      return url.replace(/\?tr=[^&]+/, "?tr=w-2480,h-3508,c-force,q-95,f-png");
    }

    // Insert transformation path segment
    const pathParts = urlObj.pathname.split("/");
    const insertIndex = pathParts.findIndex((p: string) =>
      p && !p.includes(".")
    ) + 1;
    pathParts.splice(insertIndex, 0, "tr:w-2480,h-3508,c-force,q-95,f-png");
    urlObj.pathname = pathParts.join("/");

    console.log("📸 Applied letterhead ImageKit transform: 2480x3508 q95 png");
    return urlObj.toString();
  } catch (e) {
    console.log("⚠️ Could not apply letterhead transform:", e);
    return url;
  }
}

/**
 * Apply ImageKit transformations to resize attachment images for PDF
 * Uses half-page width (~400px for A4) with auto height
 */
function applyAttachmentImageTransformations(
  url: string,
  maxWidth: number = 400,
): string {
  if (!url) return "";

  // Only transform ImageKit URLs
  if (!url.includes("ik.imagekit.io")) return url;

  try {
    const urlObj = new URL(url);

    // Check if transformations already exist
    if (url.includes("/tr:") || url.includes("?tr=")) {
      // Append width transformation to existing
      if (url.includes("/tr:")) {
        return url.replace("/tr:", `/tr:w-${maxWidth},`);
      } else if (url.includes("?tr=")) {
        return url.replace("?tr=", `?tr=w-${maxWidth},`);
      }
    }

    // Add new transformation path for width constraint
    // Format: /tr:w-400,fo-auto/ (width 400px, focus auto)
    const pathParts = urlObj.pathname.split("/");
    // Find where to insert transformation (after imagekit ID)
    const insertIndex = pathParts.findIndex((p: string) =>
      p && !p.includes(".")
    ) + 1;
    pathParts.splice(insertIndex, 0, `tr:w-${maxWidth},fo-auto,q-90`);
    urlObj.pathname = pathParts.join("/");

    console.log(`📸 Applied ImageKit transform: w-${maxWidth} to attachment`);
    return urlObj.toString();
  } catch (e) {
    console.log("⚠️ Could not apply transformations to attachment URL:", e);
    return url;
  }
}

/**
 * Generate HTML for attachments included in report
 * Images are resized to half-page width (~400px) to prevent overflow
 */
function generateAttachmentsHtml(attachments: any[]): string {
  if (!attachments || attachments.length === 0) return "";

  const includedAttachments = attachments.filter((a) =>
    a.tag === "include_in_report"
  );
  if (includedAttachments.length === 0) return "";

  // A4 page content width is ~595px (210mm at 72dpi) minus margins
  // Half page = ~400px for comfortable display with caption
  const HALF_PAGE_WIDTH = 400;

  let html =
    '<div class="report-attachments" style="margin-top: 20px; page-break-before: always;">';
  html +=
    '<h3 style="margin-bottom: 15px; color: #374151; font-size: 16px; border-bottom: 2px solid #2563eb; padding-bottom: 8px;">Attachments</h3>';

  for (const attachment of includedAttachments) {
    const isImage = attachment.file_type?.startsWith("image/");

    // Prefer imagekit_url, fallback to file_url
    let imageUrl = attachment.imagekit_url || attachment.file_url;

    if (isImage && imageUrl) {
      // Apply ImageKit transformations for proper sizing
      imageUrl = applyAttachmentImageTransformations(imageUrl, HALF_PAGE_WIDTH);

      html +=
        `<div class="attachment-item" style="margin: 15px 0; page-break-inside: avoid; text-align: center;">`;
      html += `<img src="${imageUrl}" alt="${
        attachment.file_name || "Attachment"
      }" style="max-width: ${HALF_PAGE_WIDTH}px; height: auto; border: 1px solid #e5e7eb; border-radius: 4px;" />`;
      if (attachment.file_name) {
        html +=
          `<p style="font-size: 11px; color: #6b7280; text-align: center; margin-top: 8px; font-style: italic;">${attachment.file_name}</p>`;
      }
      html += `</div>`;
    }
  }

  html += "</div>";
  return html;
}

// ============================================================
// SECTION: Storage Operations
// ============================================================

type PdfVariant = "final" | "draft" | "print";

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
  variant: PdfVariant = "final",
  maxRetries: number = 3,
): Promise<{ path: string; publicUrl: string }> {
  console.log("📥 Downloading PDF from PDF.co...");

  // Download PDF with retry logic
  let pdfBuffer: ArrayBuffer | null = null;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`  📥 Download attempt ${attempt}/${maxRetries}...`);

      // Add timeout to prevent hanging connections
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const pdfResponse = await fetch(pdfUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Supabase-Edge-Function/1.0",
          "Accept": "application/pdf, */*",
        },
      });

      clearTimeout(timeoutId);

      if (!pdfResponse.ok) {
        throw new Error(`Failed to download PDF: ${pdfResponse.status}`);
      }

      pdfBuffer = await pdfResponse.arrayBuffer();
      console.log(`  ✅ Download successful: ${pdfBuffer.byteLength} bytes`);
      break; // Success, exit retry loop
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(
        `  ⚠️ Download attempt ${attempt} failed:`,
        lastError.message,
      );

      if (attempt < maxRetries) {
        // Wait before retry with longer delays for PDF.co to finalize
        // PDF.co sometimes needs time to make files available
        const waitTime = variant === "print"
          ? Math.min(3000 * attempt, 10000) // Print: 3s, 6s, 9s, 12s (up to 10s max)
          : Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Normal: exponential backoff
        console.log(`  ⏳ Waiting ${waitTime}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }

  if (!pdfBuffer) {
    if (pdfUrl) {
      console.warn(
        `⚠️ FINAL FALLBACK: Failed to download PDF after ${maxRetries} attempts but PDF.co URL exists. Using temporary URL.`,
      );
      return {
        path: "",
        publicUrl: pdfUrl,
      };
    }
    throw new Error(
      `Failed to download PDF after ${maxRetries} attempts: ${lastError?.message}`,
    );
  }

  const pdfBlob = new Blob([pdfBuffer], { type: "application/pdf" });

  // Generate storage path - use simple format like normal PDF flow
  // Normal flow uses: {orderId}_{timestamp}_{variant}.pdf in 'reports' bucket
  const timestamp = Date.now();
  const suffix = variant === "final" ? "" : `_${variant}`;
  const storageFileName = `${orderId}_${timestamp}${suffix}.pdf`;

  console.log(
    "📤 Uploading PDF to Supabase Storage (reports bucket):",
    storageFileName,
  );

  // Upload to Supabase Storage - use 'reports' bucket like normal flow
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from("reports")
    .upload(storageFileName, pdfBlob, {
      contentType: "application/pdf",
      cacheControl: "3600",
      upsert: true, // Allow overwrite
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  // Get public URL (using custom domain if configured)
  const publicUrl = getPublicStorageUrl("reports", storageFileName);

  console.log("✅ PDF uploaded to storage:", publicUrl);
  console.log("📡 Using custom domain:", !!CUSTOM_REPORTS_DOMAIN);

  return {
    path: storageFileName,
    publicUrl,
  };
}

// ============================================================
// SECTION: Main Edge Function
// ============================================================

serve(async (req) => {
  // Top-level try-catch to ensure CORS headers are ALWAYS returned
  try {
    console.log("📥 Incoming request:", req.method, req.url);

    if (req.method === "OPTIONS") {
      console.log("📋 Handling OPTIONS preflight request");
      console.log("📋 CORS headers:", corsHeaders);
      return new Response(null, {
        status: 200,
        headers: corsHeaders,
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: { autoRefreshToken: false, persistSession: false },
      },
    );

    const PDFCO_API_KEY = Deno.env.get("PDFCO_API_KEY") ?? "";

    // Inner try-catch for main logic
    try {
      const requestBody = await req.json();

      // Support both direct calls (orderId) and webhook payloads (record.order_id)
      // Webhook payloads from Supabase Database Webhooks include: { type, table, record, schema, old_record }
      const orderId = requestBody.orderId || requestBody.record?.order_id;
      const isDraft = requestBody.isDraft;
      const htmlOverride = requestBody.htmlOverride;
      const isManualDesign = requestBody.isManualDesign;
      const isWebhook = !!requestBody.record;
      const triggeredByUserId = requestBody.triggeredByUserId; // User ID who triggered this request (for WhatsApp integration)

      console.log(
        "═══════════════════════════════════════════════════════════",
      );
      console.log("📄 PDF AUTO-GENERATION (SERVER-SIDE)");
      console.log(
        "═══════════════════════════════════════════════════════════",
      );
      console.log("Order ID:", orderId);
      console.log("Is Draft:", !!isDraft);
      console.log("Is Manual Design:", !!isManualDesign);
      console.log("Is Webhook Trigger:", isWebhook);
      console.log("Triggered By User ID:", triggeredByUserId || "N/A");
      console.log(
        "PDF.co API Key:",
        PDFCO_API_KEY ? "✅ Present" : "❌ MISSING",
      );

      if (!orderId) {
        return new Response(
          JSON.stringify({
            error:
              "orderId is required (pass orderId directly or via webhook record.order_id)",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // ========================================
      // MANUAL MODE: Bypass Template Logic
      // ========================================
      if (isManualDesign && htmlOverride) {
        console.log(
          "🎨 Manual Design detected. Bypassing template generation.",
        );

        const filename = `Report_${orderId}_${new Date().getTime()}.pdf`;

        // Send directly to PDF.co
        const pdfUrl = await sendHtmlToPdfCo(
          htmlOverride,
          filename,
          PDFCO_API_KEY,
          {
            margins: "0px 0px 0px 0px",
            paperSize: "A4",
            printBackground: true,
            displayHeaderFooter: false,
          },
        );

        console.log("✅ PDF generated successfully via Manual Mode:", pdfUrl);

        // Upload to Storage
        const { publicUrl } = await uploadPdfToStorage(
          supabaseClient,
          pdfUrl,
          orderId,
          undefined, // lab_id
          "manual_patient", // patient_id placeholder
          filename,
          "final",
        );

        return new Response(
          JSON.stringify({
            success: true,
            pdfUrl: publicUrl,
            status: "completed",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // ========================================
      // PRE-CHECK: Order Readiness (Panel Status)
      // ========================================
      if (!isDraft) {
        console.log("\n🔍 Pre-check: Verifying order readiness...");
        const { data: readinessData, error: readinessError } =
          await supabaseClient
            .from("v_result_panel_status")
            .select("panel_ready")
            .eq("order_id", orderId);

        if (readinessError) {
          console.warn(
            "⚠️ Could not verify panel status (view might be missing), proceeding with caution:",
            readinessError.message,
          );
        } else if (readinessData) {
          const isReady = readinessData.length > 0 &&
            readinessData.every((r: any) => r.panel_ready);
          console.log(
            `  → Panel status: ${isReady ? "✅ READY" : "⏳ NOT READY"}`,
            readinessData,
          );

          if (!isReady) {
            console.log(
              "⛔ Order is not ready for final report. Skipping auto-generation.",
            );

            // If there's an existing queue item, update it to failed/skipped so it doesn't get stuck
            await supabaseClient
              .from("pdf_generation_queue")
              .update({
                status: "failed",
                error_message: "Skipped: Order panels not ready",
                progress_stage: "Skipped (Not Ready)",
                updated_at: new Date().toISOString(),
              })
              .eq("order_id", orderId);

            return new Response(
              JSON.stringify({
                success: false,
                message:
                  "Order is not ready (panels incomplete). Pass isDraft=true to force.",
                status: "skipped",
              }),
              {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              },
            );
          }
        }
      }

      if (!PDFCO_API_KEY) {
        return new Response(
          JSON.stringify({ error: "PDFCO_API_KEY not configured" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // ========================================
      // Step 1: Get or Create Job from Queue
      // ========================================
      console.log("\n📋 Step 1: Fetching/creating job in queue...");

      // First, try to get existing job
      let { data: job, error: jobError } = await supabaseClient
        .from("pdf_generation_queue")
        .select("*")
        .eq("order_id", orderId)
        .maybeSingle();

      // If no job exists, create one (for manual/direct Edge function calls)
      if (!job) {
        console.log(
          "ℹ️ No queue entry found, fetching lab_id and creating entry...",
        );

        // Get lab_id from the order
        const { data: orderData, error: orderError } = await supabaseClient
          .from("orders")
          .select("lab_id")
          .eq("id", orderId)
          .single();

        if (orderError || !orderData?.lab_id) {
          console.error(
            "❌ Failed to fetch lab_id for order:",
            orderError?.message,
          );
          return new Response(
            JSON.stringify({
              error: "Order not found or missing lab_id",
              details: orderError?.message,
            }),
            {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        // Use upsert to handle race conditions (if trigger created entry simultaneously)
        const { data: upsertData, error: upsertError } = await supabaseClient
          .from("pdf_generation_queue")
          .upsert({
            order_id: orderId,
            lab_id: orderData.lab_id,
            status: "pending",
            priority: 5,
            created_at: new Date().toISOString(),
          }, {
            onConflict: "order_id",
            ignoreDuplicates: false,
          })
          .select()
          .single();

        if (upsertError) {
          console.error(
            "❌ Failed to upsert queue entry:",
            upsertError?.message,
          );
          return new Response(
            JSON.stringify({
              error: "Failed to create/update queue entry",
              details: upsertError?.message,
            }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        job = upsertData;
        console.log(
          "✅ Created/updated queue entry:",
          job.id,
          "for lab:",
          orderData.lab_id,
        );
      }

      // If job exists but is completed, reset it to pending for regeneration
      if (job.status === "completed") {
        console.log(
          "♻️ Job already completed, checking if PDF still exists...",
        );

        // Check if the PDF still exists in reports table
        const { data: existingReport, error: reportError } =
          await supabaseClient
            .from("reports")
            .select("id, ecopy_url, print_url, is_draft")
            .eq("order_id", orderId)
            .eq("is_draft", false)
            .maybeSingle();

        if (existingReport && existingReport.ecopy_url) {
          console.log(
            "✅ Final PDF already exists in reports table, returning existing URL",
          );
          return new Response(
            JSON.stringify({
              success: true,
              status: "completed",
              pdfUrl: existingReport.ecopy_url,
              printPdfUrl: existingReport.print_url,
              message: "PDF already exists",
              cached: true,
            }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        // PDF doesn't exist, reset queue to regenerate
        console.log("⚠️ PDF missing from reports table, regenerating...");
        const { data: resetJob, error: resetError } = await supabaseClient
          .from("pdf_generation_queue")
          .update({
            status: "pending",
            error_message: null,
            retry_count: 0,
            progress_stage: null,
            progress_percent: 0,
          })
          .eq("id", job.id)
          .select()
          .single();

        if (resetError) {
          console.error("❌ Failed to reset job status:", resetError?.message);
        } else {
          job = resetJob;
          console.log("✅ Job reset to pending");
        }
      }

      // Prevent duplicate processing - if already processing, return early
      if (job.status === "processing") {
        console.log("⏳ Job already processing, skipping duplicate request");
        return new Response(
          JSON.stringify({
            message: "Already processing",
            status: "processing",
            jobId: job.id,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      console.log("✅ Job found:", {
        id: job.id,
        status: job.status,
        labId: job.lab_id,
      });

      // ========================================
      // Step 2: Mark as Processing (Atomic Update)
      // ========================================
      console.log("\n📝 Step 2: Marking job as processing...");

      // Use atomic update with status check to prevent race conditions
      const { data: updatedJob, error: updateError } = await supabaseClient
        .from("pdf_generation_queue")
        .update({
          status: "processing",
          started_at: new Date().toISOString(),
          progress_stage: "Fetching report context...",
          progress_percent: 5,
        })
        .eq("id", job.id)
        .eq("status", "pending") // Only update if still pending
        .select()
        .single();

      // If update didn't find a pending job, another process got it first
      if (updateError || !updatedJob) {
        console.log("⏳ Job was claimed by another process, skipping");
        return new Response(
          JSON.stringify({
            message: "Job claimed by another process",
            status: "skipped",
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // ========================================
      // Step 3: Get Template Context (RPC)
      // ========================================
      console.log("\n📊 Step 3: Fetching template context via RPC...");
      const { data: context, error: contextError } = await supabaseClient.rpc(
        "get_report_template_context",
        { p_order_id: orderId },
      );

      if (contextError || !context) {
        console.error("❌ Context fetch failed:", contextError?.message);
        await failJob(
          supabaseClient,
          job.id,
          `Context fetch failed: ${contextError?.message}`,
        );
        return new Response(
          JSON.stringify({
            error: "Context fetch failed",
            details: contextError?.message,
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // RPC returns nested structure: context.patient.name, context.order.sampleId, etc.
      console.log(
        "✅ Context fetched (full structure):",
        JSON.stringify(context, null, 2).substring(0, 2000),
      );
      console.log("✅ Context summary:", {
        patientName: context.patient?.name ||
          context.placeholderValues?.patientName,
        patientId: context.patientId,
        patientAge: context.patient?.age || context.placeholderValues?.age,
        patientGender: context.patient?.gender ||
          context.placeholderValues?.gender,
        sampleId: context.order?.sampleId ||
          context.placeholderValues?.sampleId,
        analytes: context.analytes?.length || 0,
        analytesWithValues: (context.analytes || []).filter((a: any) =>
          a.value != null && a.value !== ""
        ).length,
        testGroupIds: context.testGroupIds || [],
        analyteNames: (context.analytes || []).slice(0, 3).map((a: any) =>
          a.parameter || a.test_name || a.name || "unknown"
        ),
      });

      // Validate that we have actual test results
      if (!context.analytes || context.analytes.length === 0) {
        console.error("❌ No analytes found in context");
        await failJob(
          supabaseClient,
          job.id,
          "No test results found for this order",
        );
        return new Response(
          JSON.stringify({ error: "No test results found for this order" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Check if analytes have values
      const analytesWithValues = context.analytes.filter((a: any) =>
        a.value != null && a.value !== ""
      );
      if (analytesWithValues.length === 0) {
        console.warn("⚠️ WARNING: All analytes have empty values!");
      }

      // ========================================
      // Step 3a: Filter out canceled tests
      // ========================================
      console.log("\n🚫 Step 3a: Filtering canceled tests...");

      // Get canceled test_group_ids from order_tests
      const { data: canceledTests } = await supabaseClient
        .from("order_tests")
        .select("test_group_id")
        .eq("order_id", orderId)
        .eq("is_canceled", true);

      const canceledTestGroupIds = new Set(
        (canceledTests || []).map((t: any) => t.test_group_id).filter(Boolean),
      );

      if (canceledTestGroupIds.size > 0) {
        console.log(
          `📋 Found ${canceledTestGroupIds.size} canceled test group(s):`,
          Array.from(canceledTestGroupIds),
        );

        // Filter out analytes from canceled test groups
        const originalCount = context.analytes?.length || 0;
        context.analytes = (context.analytes || []).filter((a: any) => {
          const testGroupId = a.test_group_id || a.testGroupId;
          if (testGroupId && canceledTestGroupIds.has(testGroupId)) {
            return false; // Exclude this analyte
          }
          return true;
        });

        // Also filter testGroupIds array
        if (context.testGroupIds) {
          context.testGroupIds = context.testGroupIds.filter((id: string) =>
            !canceledTestGroupIds.has(id)
          );
        }

        console.log(
          `✅ Filtered analytes: ${originalCount} → ${context.analytes.length} (removed ${
            originalCount - context.analytes.length
          } from canceled tests)`,
        );
      } else {
        console.log("✅ No canceled tests found - including all analytes");
      }

      // Deduplicate analytes by (test_group_id, analyte_id) — guards against
      // duplicate result_values rows from multiple results records for same test group
      {
        const seen = new Set<string>();
        const deduped: any[] = [];
        for (const a of (context.analytes || [])) {
          const key = `${a.test_group_id ?? ""}|${a.analyte_id ?? ""}`;
          if (!seen.has(key)) {
            seen.add(key);
            deduped.push(a);
          }
        }
        if (deduped.length < (context.analytes?.length ?? 0)) {
          console.log(`⚠️ Removed ${(context.analytes?.length ?? 0) - deduped.length} duplicate analyte(s) from context`);
          context.analytes = deduped;
        }
      }

      // ========================================
      // Step 3a.1: Enrich section content with image URLs (ecopy only)
      // ========================================
      try {
        const { data: resultRows, error: resultError } = await supabaseClient
          .from("results")
          .select("id")
          .eq("order_id", orderId);

        if (resultError) {
          console.warn(
            "⚠️ Failed to fetch result ids for section images:",
            resultError.message,
          );
        } else {
          const resultIds = (resultRows || [])
            .map((row: any) => row.id)
            .filter(Boolean);

          if (resultIds.length > 0) {
            const sectionContentWithImages = await fetchSectionContent(
              supabaseClient,
              resultIds,
              true,
            );
            const sectionContentNoImages = await fetchSectionContent(
              supabaseClient,
              resultIds,
              false,
            );

            const withImages = Object.keys(sectionContentWithImages).length > 0
              ? sectionContentWithImages
              : (context.sectionContent || {});
            const noImages = Object.keys(sectionContentNoImages).length > 0
              ? sectionContentNoImages
              : (context.sectionContent || {});

            context.sectionContent = withImages;
            context.sectionContentNoImages = noImages;
            context.placeholderValues = {
              ...(context.placeholderValues || {}),
              ...withImages,
            };
          }
        }
      } catch (err) {
        console.warn("⚠️ Section image enrichment failed:", err);
      }

      await updateProgress(
        supabaseClient,
        job.id,
        "Fetching lab template...",
        15,
      );

      // ========================================
      // Step 3b: Enhance Analytes with Flag Determination
      // ========================================
      console.log(
        "\n🏷️ Step 3b: Enhancing analytes with flag determination...",
      );
      const patientGender = context.patient?.gender ||
        context.placeholderValues?.gender;

      if (context.analytes && context.analytes.length > 0) {
        context.analytes = context.analytes.map((analyte: any) => {
          // If flag already exists and is valid, keep it
          if (analyte.flag && analyte.flag.trim()) {
            return analyte;
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
            analyte.expected_normal_values,
          );

          return {
            ...analyte,
            flag: displayFlag,
            flag_code: flag, // Expose raw flag code (high, low, etc.) for CSS class generation
          };
        });

        const flaggedCount = context.analytes.filter((a: any) =>
          a.flag && a.flag.trim()
        ).length;
        console.log(
          `✅ Flag determination complete: ${flaggedCount}/${context.analytes.length} analytes have flags`,
        );
      }

      await updateProgress(
        supabaseClient,
        job.id,
        "Fetching lab template...",
        15,
      );

      // ========================================
      // Step 4: Get Lab Template & Settings
      // ========================================
      console.log("\n🎨 Step 4: Fetching lab templates & settings...");

      // Get all templates for this lab
      const { data: allTemplates, error: templateError } = await supabaseClient
        .from("lab_templates")
        .select("*")
        .eq("lab_id", job.lab_id);

      const templatesWithHtml = (allTemplates || []).filter((tpl: any) =>
        tpl?.gjs_html
      );

      console.log(
        "📋 Available templates:",
        templatesWithHtml.map((t: any) => ({
          name: t.template_name,
          testGroupId: t.test_group_id || "none",
          isDefault: t.is_default,
          isInterpretationOnly: !!t.is_interpretation_only,
        })),
      );

      await updateProgress(
        supabaseClient,
        job.id,
        "Fetching lab settings...",
        25,
      );

      // ========================================
      // Step 5: Get Lab Settings (Header/Footer/PDF Settings/Watermark)
      // ========================================
      console.log("\n⚙️ Step 5: Fetching lab settings...");
      const { data: labSettings, error: labSettingsError } = await supabaseClient
        .from("labs")
        .select(`
        name,
        default_report_header_html, 
        default_report_footer_html, 
        pdf_layout_settings,
        pdf_letterhead_mode,
        watermark_enabled,
        watermark_image_url,
        watermark_opacity,
        watermark_position,
        watermark_size,
        watermark_rotation,
        default_template_style,
        show_methodology,
        show_interpretation,
        report_patient_info_config
      `)
        .eq("id", job.lab_id)
        .single();

      if (labSettingsError) {
        console.error("  ❌ Lab settings query error:", labSettingsError.message);
      }

      // Fetch custom patient field configs for this lab (for dynamic PDF fields)
      const { data: customPatientFieldConfigs } = await supabaseClient
        .from('lab_patient_field_configs')
        .select('field_key, label, sort_order')
        .eq('lab_id', job.lab_id)
        .order('sort_order');

      const pdfLetterheadMode = labSettings?.pdf_letterhead_mode || 'background';
      console.log("  📋 PDF Letterhead Mode:", pdfLetterheadMode);

      // Variables for both modes
      let letterheadUrl: string | null = null;
      let headerFooterHtml: { headerHtml: string; footerHtml: string } = { headerHtml: '', footerHtml: '' };

      if (pdfLetterheadMode === 'header_footer') {
        // MODE: Separate Header/Footer Images
        // Fetch header and footer separately, convert to base64 for PDF.co native header/footer
        console.log("  🖼️ Fetching SEPARATE header/footer images (header_footer mode)...");
        const { headerUrl, footerUrl } = await fetchHeaderFooterImages(
          supabaseClient,
          orderId,
          job.lab_id,
        );

        console.log("  📍 Header URL:", headerUrl ? "FOUND" : "NOT FOUND");
        console.log("  📍 Footer URL:", footerUrl ? "FOUND" : "NOT FOUND");

        // Convert to base64 for reliable rendering (with fallback to direct URL)
        let headerSrc = headerUrl || '';
        let footerSrc = footerUrl || '';

        if (headerUrl) {
          const headerBase64 = await imageUrlToBase64(headerUrl);
          if (headerBase64) {
            headerSrc = headerBase64;
            console.log("  ✅ Header converted to base64");
          } else {
            console.log("  ⚠️ Header base64 failed, using direct URL");
            // Apply ImageKit transform for quality if it's ImageKit URL
            if (headerUrl.includes('ik.imagekit.io') && !headerUrl.includes('/tr:')) {
              headerSrc = headerUrl.replace(/(ik\.imagekit\.io\/[^/]+)/, '$1/tr:w-2480,q-90');
            }
          }
        }

        if (footerUrl) {
          const footerBase64 = await imageUrlToBase64(footerUrl);
          if (footerBase64) {
            footerSrc = footerBase64;
            console.log("  ✅ Footer converted to base64");
          } else {
            console.log("  ⚠️ Footer base64 failed, using direct URL");
            if (footerUrl.includes('ik.imagekit.io') && !footerUrl.includes('/tr:')) {
              footerSrc = footerUrl.replace(/(ik\.imagekit\.io\/[^/]+)/, '$1/tr:w-2480,q-90');
            }
          }
        }

        // Build header/footer HTML for PDF.co
        const pdfLayoutSettings = labSettings?.pdf_layout_settings || {};
        const headerHeight = pdfLayoutSettings?.headerHeight || 90;
        const footerHeight = pdfLayoutSettings?.footerHeight || 80;

        headerFooterHtml = {
          headerHtml: headerSrc ? buildHeaderHtml(headerSrc, headerHeight) : '',
          footerHtml: footerSrc ? buildFooterHtml(footerSrc, footerHeight) : '',
        };

        console.log("  ✅ Header/Footer mode configured:",
          "header:", headerFooterHtml.headerHtml.length, "chars,",
          "footer:", headerFooterHtml.footerHtml.length, "chars");

        // letterheadUrl stays null — no background image in this mode
      } else {
        // MODE: Full-page Background (default/current behavior)
        // FETCH LETTERHEAD BACKGROUND IMAGE (Full-page background approach)
        // Priority: B2B Account > Location > Lab
        console.log("  🖼️ Fetching letterhead background image (background mode)...");
        console.log("  📍 Order ID:", orderId, "| Lab ID:", job.lab_id);
        const letterheadBackgroundUrl = await fetchLetterheadBackgroundForOrder(
          supabaseClient,
          orderId,
          job.lab_id,
        );

        // Apply ImageKit transforms for high-quality A4 rendering (2480x3508 @ 300dpi)
        letterheadUrl = letterheadBackgroundUrl
          ? applyLetterheadImageTransform(letterheadBackgroundUrl)
          : null;

        console.log(
          "  🎨 Letterhead Background URL:",
          letterheadUrl || "NOT FOUND",
        );
        if (letterheadUrl) {
          console.log(
            "  ✅ Using letterhead background:",
            letterheadUrl,
          );
        } else {
          console.log("  ⚠️ No letterhead background found, using plain layout");
        }
      }

      const pdfSettings = labSettings?.pdf_layout_settings || {};

      // result_colors lives inside pdf_layout_settings.resultColors (not a separate column)

      // Watermark settings
      const watermarkSettings = {
        enabled: labSettings?.watermark_enabled || false,
        imageUrl: labSettings?.watermark_image_url || "",
        opacity: labSettings?.watermark_opacity ?? 0.15,
        position: labSettings?.watermark_position || "center",
        size: labSettings?.watermark_size || "80%",
        rotation: labSettings?.watermark_rotation ?? 0,
      };

      // ========================================
      // Step 5b: Get Signatory Info (Approver fallback to Lab Default)
      // ========================================
      console.log("\n✍️ Step 5b: Fetching signatory information...");

      interface SignatoryInfo {
        signatoryName: string;
        signatoryDesignation: string;
        signatoryImageUrl: string;
      }

      // Helper to apply ImageKit transformations for signatures
      // Adds focus:auto and e-removebg for clean signature rendering
      const applySignatureTransformations = (url: string): string => {
        if (!url) return "";
        // If it's an ImageKit URL, add transformations
        if (url.includes("ik.imagekit.io")) {
          // Parse the URL and add transformations
          try {
            const urlObj = new URL(url);
            // Check if transformations already exist
            if (!url.includes("tr=")) {
              // Add transformation path
              const pathParts = urlObj.pathname.split("/");
              // Insert transformations after the imagekit path identifier
              const insertIndex = pathParts.findIndex((p: string) =>
                p && !p.includes(".")
              ) + 1;
              pathParts.splice(insertIndex, 0, "tr:fo-auto,e-removebg,t-true");
              urlObj.pathname = pathParts.join("/");
              return urlObj.toString();
            }
          } catch (e) {
            // If URL parsing fails, return as-is
            console.log(
              "    → Could not apply transformations to signature URL",
            );
          }
        }
        return url;
      };

      // Try to get the approver/verifier from results for this order
      let signatoryInfo: SignatoryInfo = {
        signatoryName: "Authorized Signatory",
        signatoryDesignation: "",
        signatoryImageUrl: "",
      };

      try {
        // First, get any verified result to find the approver
        const { data: verifiedResult } = await supabaseClient
          .from("result_values")
          .select(`
          verified_by,
          users!result_values_verified_by_fkey(
            id,
            name,
            role,
            department
          )
        `)
          .eq("result_id", orderId)
          .not("verified_by", "is", null)
          .limit(1)
          .maybeSingle();

        // If no result found by result_id, try via results table
        let verifierUserId = verifiedResult?.verified_by as string | null;
        let verifierName = (verifiedResult?.users as any)?.name as
          | string
          | null;
        let verifierRole = (verifiedResult?.users as any)?.role as
          | string
          | null;
        let verifierDepartment = (verifiedResult?.users as any)?.department as
          | string
          | null;

        if (!verifierUserId) {
          // Try via results table joined with result_values
          const { data: resultWithVerifier } = await supabaseClient
            .from("results")
            .select(`
            id,
            result_values(
              verified_by,
              users!result_values_verified_by_fkey(id, name, role, department)
            )
          `)
            .eq("order_id", orderId)
            .limit(1)
            .maybeSingle();

          if (resultWithVerifier?.result_values) {
            const rv = Array.isArray(resultWithVerifier.result_values)
              ? resultWithVerifier.result_values.find((v: any) => v.verified_by)
              : resultWithVerifier.result_values;
            if (rv?.verified_by) {
              verifierUserId = rv.verified_by;
              verifierName = (rv.users as any)?.name;
              verifierRole = (rv.users as any)?.role;
              verifierDepartment = (rv.users as any)?.department;
            }
          }
        }

        // If still no verifier found, check the orders.approved_by field
        if (!verifierUserId) {
          const { data: orderApprover } = await supabaseClient
            .from("orders")
            .select(`
            approved_by,
            users!orders_approved_by_fkey(id, name, role, department)
         `)
            .eq("id", orderId)
            .maybeSingle();

          if (orderApprover?.approved_by) {
            verifierUserId = orderApprover.approved_by;
            verifierName = (orderApprover.users as any)?.name;
            verifierRole = (orderApprover.users as any)?.role;
            verifierDepartment = (orderApprover.users as any)?.department;
            console.log("  → Verifier found via orders.approved_by");
          }
        }

        console.log(
          "  → Final Verifier ID:",
          verifierUserId ? `${verifierName} (${verifierUserId})` : "None",
        );

        // If we have a verifier, check if they have a signature (prioritize default)
        if (verifierUserId) {
          const { data: userSignature } = await supabaseClient
            .from("lab_user_signatures")
            .select(
              "imagekit_url, file_url, signature_name, is_default, variants",
            )
            .eq("user_id", verifierUserId)
            .eq("lab_id", job.lab_id)
            .eq("is_active", true)
            .order("is_default", { ascending: false }) // Default first
            .limit(1)
            .maybeSingle();

          if (userSignature) {
            // Priority: variants.optimized > imagekit_url with transforms > file_url
            let sigUrl: string | null = null;

            // Try to get optimized variant first (has background removal)
            if (userSignature.variants) {
              const variants = typeof userSignature.variants === "string"
                ? JSON.parse(userSignature.variants)
                : userSignature.variants;
              if (variants?.optimized) {
                sigUrl = variants.optimized;
                console.log(
                  "  ✅ Using optimized variant (bg removed):",
                  sigUrl,
                );
              }
            }

            // Fallback to imagekit_url with transforms
            if (!sigUrl && userSignature.imagekit_url) {
              sigUrl = applySignatureTransformations(
                userSignature.imagekit_url,
              );
              console.log("  ✅ Using imagekit_url with transforms");
            }

            // Final fallback to file_url
            if (!sigUrl && userSignature.file_url) {
              sigUrl = userSignature.file_url;
              console.log("  ✅ Using file_url fallback");
            }

            if (sigUrl) {
              // Prioritize signature_name from lab_user_signatures (has full credentials like "Dr Anand - MD (Pathology)")
              // Only fall back to verifierName if signature_name is not set
              signatoryInfo = {
                signatoryName: userSignature.signature_name || verifierName ||
                  "Authorized Signatory",
                signatoryDesignation: "", // Don't show role like "Admin" - signature_name already has credentials
                signatoryImageUrl: sigUrl,
              };
              console.log(
                "  ✅ Using verifier signature:",
                signatoryInfo.signatoryName,
              );
            } else {
              // Verifier exists but has no signature - use their name but get lab default signature
              console.log(
                "  → Verifier has no signature, using name with lab default signature",
              );
              signatoryInfo.signatoryName = verifierName ||
                "Authorized Signatory";
              signatoryInfo.signatoryDesignation = verifierRole ||
                verifierDepartment || "";
            }
          } else {
            // Verifier exists but has no signature entry
            console.log(
              "  → No signature entry for verifier, using name with lab default signature",
            );
            signatoryInfo.signatoryName = verifierName ||
              "Authorized Signatory";
            signatoryInfo.signatoryDesignation = verifierRole ||
              verifierDepartment || "";
          }
        }

        // If no verifier signature or no verifier, fall back to lab default
        if (!signatoryInfo.signatoryImageUrl) {
          console.log("  → Falling back to lab default signature...");

          // Get lab default signature from branding assets (asset_type = 'signature')
          const { data: labSignature } = await supabaseClient
            .from("lab_branding_assets")
            .select("file_url, imagekit_url, asset_metadata")
            .eq("lab_id", job.lab_id)
            .eq("asset_type", "signature")
            .eq("is_active", true)
            .order("is_default", { ascending: false }) // Default first
            .limit(1)
            .maybeSingle();

          if (labSignature) {
            // Prefer ImageKit URL with transformations
            if (labSignature.imagekit_url) {
              signatoryInfo.signatoryImageUrl = applySignatureTransformations(
                labSignature.imagekit_url,
              );
            } else if (labSignature.file_url) {
              signatoryInfo.signatoryImageUrl = labSignature.file_url;
            }

            // If we didn't have a verifier name, try to get from lab signature metadata
            if (signatoryInfo.signatoryName === "Authorized Signatory") {
              const metadata = labSignature.asset_metadata as
                | Record<string, any>
                | null;
              if (metadata?.signatory_name) {
                signatoryInfo.signatoryName = metadata.signatory_name;
              }
              if (
                metadata?.signatory_designation &&
                !signatoryInfo.signatoryDesignation
              ) {
                signatoryInfo.signatoryDesignation =
                  metadata.signatory_designation;
              }
            }
            console.log("  ✅ Using lab default signature");
          } else {
            // Try to find ANY user's default signature in this lab as last resort
            const { data: anyUserSig } = await supabaseClient
              .from("lab_user_signatures")
              .select(
                "imagekit_url, file_url, signature_name, user_id, variants",
              )
              .eq("lab_id", job.lab_id)
              .eq("is_active", true)
              .eq("is_default", true) // Only get default signatures
              .limit(1)
              .maybeSingle();

            if (anyUserSig) {
              // Priority: variants.optimized > imagekit_url with transforms > file_url
              let sigUrl: string | null = null;

              if (anyUserSig.variants) {
                const variants = typeof anyUserSig.variants === "string"
                  ? JSON.parse(anyUserSig.variants)
                  : anyUserSig.variants;
                if (variants?.optimized) {
                  sigUrl = variants.optimized;
                  console.log("  ✅ Using optimized variant (bg removed)");
                }
              }

              if (!sigUrl && anyUserSig.imagekit_url) {
                sigUrl = applySignatureTransformations(anyUserSig.imagekit_url);
              }

              if (!sigUrl && anyUserSig.file_url) {
                sigUrl = anyUserSig.file_url;
              }

              if (sigUrl) {
                signatoryInfo.signatoryImageUrl = sigUrl;
              }
              if (
                signatoryInfo.signatoryName === "Authorized Signatory" &&
                anyUserSig.signature_name
              ) {
                signatoryInfo.signatoryName = anyUserSig.signature_name;
              }
              console.log("  ✅ Using fallback user default signature");
            } else {
              console.log(
                "  ⚠️ No default signature found - trying any active signature as final resort",
              );
              // FINAL RESORT: Get ANY active signature for this lab
              const { data: desperateSig } = await supabaseClient
                .from("lab_user_signatures")
                .select(
                  "imagekit_url, file_url, signature_name, user_id, variants",
                )
                .eq("lab_id", job.lab_id)
                .eq("is_active", true)
                .limit(1)
                .maybeSingle();

              if (desperateSig) {
                // Priority: variants.optimized > imagekit_url with transforms > file_url
                let sigUrl: string | null = null;

                if (desperateSig.variants) {
                  const variants = typeof desperateSig.variants === "string"
                    ? JSON.parse(desperateSig.variants)
                    : desperateSig.variants;
                  if (variants?.optimized) {
                    sigUrl = variants.optimized;
                    console.log(
                      "  ✅ Using optimized variant (bg removed) - FINAL RESORT",
                    );
                  }
                }

                if (!sigUrl && desperateSig.imagekit_url) {
                  sigUrl = applySignatureTransformations(
                    desperateSig.imagekit_url,
                  );
                }

                if (!sigUrl && desperateSig.file_url) {
                  sigUrl = desperateSig.file_url;
                }

                if (sigUrl) {
                  signatoryInfo.signatoryImageUrl = sigUrl;
                }
                if (
                  signatoryInfo.signatoryName === "Authorized Signatory" &&
                  desperateSig.signature_name
                ) {
                  signatoryInfo.signatoryName = desperateSig.signature_name;
                }
                console.log(
                  "  ✅ Using ANY active signature found (FINAL RESORT)",
                );
              } else {
                console.log("  ❌ Absolutely no signature found for this lab");
              }
            }
          }
        }
      } catch (sigError) {
        console.error("  ❌ Error fetching signatory info:", sigError);
      }

      console.log("  → Final signatory:", {
        name: signatoryInfo.signatoryName,
        designation: signatoryInfo.signatoryDesignation,
        hasImage: !!signatoryInfo.signatoryImageUrl,
      });

      await updateProgress(
        supabaseClient,
        job.id,
        "Fetching report extras...",
        35,
      );

      // ========================================
      // Step 6: Get Report Extras (Multiple Sources)
      // ========================================
      console.log(
        "\n📈 Step 6: Fetching report extras from multiple sources...",
      );

      // 6a. Get from report_extras table
      const { data: reportExtrasTable } = await supabaseClient
        .from("report_extras")
        .select("*")
        .eq("order_id", orderId)
        .maybeSingle();

      // 6b. Get from orders table (trend_graph_data, ai_clinical_summary, ai_patient_summary)
      const { data: orderExtras } = await supabaseClient
        .from("orders")
        .select(
          "trend_graph_data, ai_clinical_summary, ai_clinical_summary_generated_at, include_clinical_summary_in_report, ai_patient_summary, ai_patient_summary_generated_at, include_patient_summary_in_report, patient_summary_language",
        )
        .eq("id", orderId)
        .single();

      // 6c. Get from reports table (ai_doctor_summary, include_trend_graphs)
      const { data: reportRecord } = await supabaseClient
        .from("reports")
        .select(
          "ai_doctor_summary, ai_summary_generated_at, include_trend_graphs",
        )
        .eq("order_id", orderId)
        .order("generated_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      // 6d. Get from results table (report_extras field)
      const { data: resultsWithExtras } = await supabaseClient
        .from("results")
        .select("id, report_extras")
        .eq("order_id", orderId)
        .not("report_extras", "is", null);

      // Merge all report extras into one object
      const reportExtras = {
        // From report_extras table
        trend_charts: reportExtrasTable?.trend_charts || [],
        clinical_summary: reportExtrasTable?.clinical_summary || "",
        // From orders table
        trend_graph_data: orderExtras?.trend_graph_data,
        ai_clinical_summary: orderExtras?.include_clinical_summary_in_report
          ? orderExtras?.ai_clinical_summary
          : null,
        ai_patient_summary: orderExtras?.include_patient_summary_in_report
          ? orderExtras?.ai_patient_summary
          : null,
        patient_summary_language: orderExtras?.patient_summary_language ||
          "english",
        // From reports table
        ai_doctor_summary: reportRecord?.ai_doctor_summary,
        include_trend_graphs: reportRecord?.include_trend_graphs ?? true,
        // From results table
        results_extras: resultsWithExtras || [],
      };

      // Merge report extras into context so they are available to templates
      // This fixed the issue where AI summaries were fetched but not compliant with the template data structure
      Object.assign(context, reportExtras);

      // Parse JSON fields if they are strings (TEXT columns in DB)
      const jsonFields = [
        "ai_patient_summary",
        "trend_graph_data",
        "ai_clinical_summary",
        "ai_doctor_summary",
      ];
      for (const field of jsonFields) {
        if (context[field]) {
          if (typeof context[field] === "string") {
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
      if (
        context.ai_patient_summary &&
        context.ai_patient_summary.abnormal_findings
      ) {
        console.log("  → Normalizing AI patient summary findings...");
        context.ai_patient_summary.abnormal_findings = context
          .ai_patient_summary.abnormal_findings.map((f: any) => {
            // Determine the best name for this finding (handle all possible field names)
            const findingName = f.test_name || f.name || f.parameter ||
              f.label || f.test || "";

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
              flag: (f.status || f.flag)
                ? (f.status || f.flag).charAt(0).toUpperCase() +
                  (f.status || f.flag).slice(1)
                : "",
              status: f.status || f.flag || "abnormal",
              // Ensure type exists
              type: f.type || "Observation",
              // Ensure explanation exists
              explanation: f.explanation || f.description || "",
            };
          });
      }

      console.log("✅ Report extras merged into context:", {
        hasTrendCharts: !!(context.trend_charts?.length),
        hasTrendGraphData: !!context.trend_graph_data,
        hasClinicalSummary: !!context.clinical_summary,
        hasAiClinicalSummary: !!context.ai_clinical_summary,
        hasAiPatientSummary: !!context.ai_patient_summary,
        hasAiDoctorSummary: !!context.ai_doctor_summary,
        resultsWithExtras: context.results_extras?.length || 0,
        patientSummaryLanguage: context.patient_summary_language,
      });

      await updateProgress(
        supabaseClient,
        job.id,
        "Fetching attachments...",
        40,
      );

      // ========================================
      // Step 7: Get Attachments
      // ========================================
      console.log("\n📎 Step 7: Fetching attachments...");
      const { data: attachments } = await supabaseClient
        .from("attachments")
        .select("*")
        .eq("related_table", "orders")
        .eq("related_id", orderId)
        .eq("tag", "include_in_report");

      console.log("✅ Attachments found:", attachments?.length || 0);

      // ========================================
      // Step 7c: Get Branding Pages (Front/Back)
      // ========================================
      console.log("\n🎨 Step 7c: Fetching front/back pages...");
      const { frontPage, lastPage } = await fetchFrontBackPages(
        supabaseClient,
        job.lab_id,
      );

      // Note: Using letterhead background instead of separate header/footer
      if (letterheadUrl) {
        console.log("✅ Using letterhead background");
      }
      if (frontPage) console.log("✅ Using custom front page");
      if (lastPage) console.log("✅ Using custom last page");

      await updateProgress(
        supabaseClient,
        job.id,
        "Rendering HTML template...",
        50,
      );

      // ========================================
      // Step 8: Render HTML Template (Multi-Test Support)
      // ========================================
      console.log("\n🔧 Step 8: Rendering HTML template...");

      // Initialize bodyHtml with front page if available
      // We add a specific class to handle page breaks
      let bodyHtml = "";

      if (frontPage) {
        bodyHtml +=
          `<div class="report-front-page" style="page-break-after: always; width: 100vw; height: 100vh; margin: 0; padding: 0;">${frontPage}</div>`;
      }
      let template = null; // Primary template for CSS/Settings
      let fullContext: any = null; // Define in outer scope for print version
      let rawHtmlForPrint = ""; // Capture HTML before watermark for print version
      let mergedPrintOptions: Record<string, unknown> | null = null; // Lifted to outer scope for print version

      // Group analytes by test_group_id
      const contextTestGroupIds = context.testGroupIds || [];
      const analytesByGroup = groupAnalytesByTestGroup(
        context.analytes || [],
        contextTestGroupIds,
      );
      const effectiveGroupCount = Math.max(
        contextTestGroupIds.length,
        analytesByGroup.size,
      );

      console.log("📊 Test group analysis:", {
        contextTestGroupIds,
        analytesByGroupKeys: Array.from(analytesByGroup.keys()),
        effectiveGroupCount,
      });

      // Fetch test group names + per-group PDF style overrides
      const testGroupNames = new Map<string, string>();
      const testGroupStyles = new Map<string, string>(); // groupId → 'beautiful'|'classic'
      const testGroupPrintOptions = new Map<string, Record<string, unknown>>(); // groupId → print_options JSONB
      const testGroupIdsToFetch = [
        ...new Set(
          [...contextTestGroupIds, ...analytesByGroup.keys()].filter((id) =>
            id !== "ungrouped"
          ),
        ),
      ];

      if (testGroupIdsToFetch.length > 0) {
        // First try to get names from order_tests (has test_name which is the group name)
        const { data: orderTestsData } = await supabaseClient
          .from("order_tests")
          .select("test_group_id, test_name")
          .eq("order_id", orderId)
          .in("test_group_id", testGroupIdsToFetch);

        if (orderTestsData) {
          for (const ot of orderTestsData) {
            if (ot.test_group_id && ot.test_name) {
              testGroupNames.set(ot.test_group_id, ot.test_name);
            }
          }
        }

        // For any groups not found in order_tests, try the test_groups table
        // Also fetch default_template_style and print_options for all groups
        const { data: testGroupsData } = await supabaseClient
          .from("test_groups")
          .select("id, name, default_template_style, print_options")
          .in("id", testGroupIdsToFetch);

        if (testGroupsData) {
          for (const tg of testGroupsData) {
            if (tg.id) {
              if (tg.name && !testGroupNames.has(tg.id)) {
                testGroupNames.set(tg.id, tg.name);
              }
              if (tg.default_template_style) {
                testGroupStyles.set(tg.id, tg.default_template_style);
              }
              if (tg.print_options) {
                testGroupPrintOptions.set(tg.id, tg.print_options);
              }
            }
          }
        }

        console.log(
          "📋 Test group names fetched:",
          Object.fromEntries(testGroupNames),
        );
      }

      // Helper: Select appropriate template
      const layoutTemplatesWithHtml = templatesWithHtml.filter((t: any) =>
        !t?.is_interpretation_only
      );
      const interpretationTemplatesWithHtml = templatesWithHtml.filter((
        t: any,
      ) => !!t?.is_interpretation_only);

      const extractBodyContent = (html: string) => {
        if (!html) return "";
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        return bodyMatch ? bodyMatch[1] : html;
      };

      const getInterpretationTemplatesForGroup = (testGroupId?: string) => {
        return interpretationTemplatesWithHtml.filter((t: any) => {
          if (!testGroupId) {
            return !t.test_group_id;
          }
          return t.test_group_id === testGroupId || !t.test_group_id;
        });
      };

      const renderInterpretationBlocks = (
        interpretationTemplates: any[],
        renderContext: any,
      ) => {
        if (!interpretationTemplates.length) {
          return { html: "", css: "" };
        }

        const html = interpretationTemplates.map((tpl: any) => {
          const rendered = renderTemplate(tpl.gjs_html || "", renderContext);
          return `\n<div class="limsv2-interpretation-block" data-template-id="${tpl.id}">${extractBodyContent(rendered)}</div>`;
        }).join("\n");

        const css = interpretationTemplates
          .map((tpl: any) => tpl.gjs_css || "")
          .filter(Boolean)
          .join("\n");

        return { html, css };
      };

      console.log("📌 Template split summary:", {
        layoutTemplates: layoutTemplatesWithHtml.length,
        interpretationTemplates: interpretationTemplatesWithHtml.length,
      });

      const selectTemplate = (ctx: any) => {
        const testGroupId = ctx.testGroupIds?.[0];
        if (!testGroupId) return null;

        // If this test group has a forced style override, skip custom template entirely
        if (testGroupStyles.has(testGroupId)) {
          console.log(`🎨 Test group ${testGroupId} has style override '${testGroupStyles.get(testGroupId)}' — skipping custom template`);
          return null;
        }

        // Strict match only: if no exact template for this test group,
        // caller must use built-in default template (beautiful/classic).
        return layoutTemplatesWithHtml.find((t: any) => t.test_group_id === testGroupId) || null;
      };

      // Helper: Prepare full context with all extras
      const prepareFullContext = (baseContext: any) => {
        // Generate individual analyte placeholders for hardcoded template support
        const analytePlaceholders = generateAnalytePlaceholders(
          baseContext.analytes || [],
        );

        // Generate verification URL for QR code
        const verifyUrl = `https://app.limsapp.in/verify?id=${
          encodeURIComponent(
            baseContext.order?.sampleId || baseContext.sampleId || orderId ||
              "",
          )
        }`;

        // Create flat aliases for nested properties (for template compatibility)

        const sig = baseContext.signatory || {};
        let sigName = sig.name || "";
        const sigUrl = sig.signature_url || sig.url;

        // Logic to inject signature image directly into the name placeholder
        // This follows "User Request" to look for {{signatoryName}} and inject there.
        if (sigUrl && sigName) {
          const imgHtml =
            `<img src="${sigUrl}" alt="Signature" style="display:block; max-height:40px; margin-bottom:2px; margin-top:2px;" />`;
          // Wrap name in span to separate it from block image, though block image forces break.
          sigName = `${imgHtml}<span>${sigName}</span>`;
        }

        const flatAliases = {
          // Patient aliases
          patientName: baseContext.patient?.name || "",
          patientId: baseContext.patient?.displayId ||
            baseContext.patient?.id || "",
          patientAge: baseContext.patient?.age || "",
          patientGender: baseContext.patient?.gender || "",
          patientPhone: baseContext.patient?.phone || "",

          // Order aliases
          sampleId: baseContext.order?.sampleId || "",
          orderId: baseContext.orderId || "",
          orderDate: baseContext.order?.orderDate ||
            baseContext.meta?.orderDate || "",
          collectionDate: baseContext.order?.sampleCollectedAtFormatted ||
            baseContext.order?.sampleCollectedAt || "",
          sampleCollectedBy: baseContext.order?.sampleCollectedBy || "",
          referringDoctorName: baseContext.order?.referringDoctorName || "",
          approvedAt: baseContext.order?.approvedAtFormatted ||
            baseContext.order?.approved_at || baseContext.meta?.approvedAt ||
            "",

          // Signatory aliases
          signatoryName: sigName,
          signatoryDesignation: sig.designation || "",

          // QR verification URL
          verifyUrl: verifyUrl,
          qr_code: `<img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(verifyUrl)}" alt="Verify Report" style="width:80px;height:80px;" />`,

          // Custom patient fields (from patients.custom_fields JSONB)
          ...Object.entries(baseContext.patient?.custom_fields || {}).reduce(
            (acc: Record<string, string>, [k, v]) => {
              acc[`custom_${k}`] = String(v ?? '');
              return acc;
            },
            {},
          ),
        };

        return {
          ...baseContext,
          ...reportExtras,
          ...baseContext.placeholderValues, // ✅ CRITICAL: Spread RPC-provided placeholders to root
          ...analytePlaceholders, // Add locally generated placeholders (fallbacks)
          ...flatAliases, // Add flat aliases
          verifyUrl: verifyUrl, // QR code URL
          qr_code: `<img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(verifyUrl)}" alt="Verify Report" style="width:80px;height:80px;" />`,
          watermark: watermarkSettings.enabled
            ? watermarkSettings.imageUrl
            : null,
          signatory: signatoryInfo,
          lab: { name: labSettings?.name },
          attachments: attachments || [],
        };
      };

      // Helper: Generate dynamic CSS (extends top-level generateDynamicCss with printOptions)
      const generateDynamicCss = (settings: any, printOpts?: Record<string, unknown>) => {
        let css = `
        .limsv2-report {
          font-size: ${settings.fontSize || "14px"};
        }
      `;
        if (printOpts && Object.keys(printOpts).length > 0) {
          css += "\n/* Print Options Overrides */\n";
          if (printOpts.tableBorders === false) {
            css += `.report-table,.report-table tr,.report-table th,.report-table td,.patient-info table,.patient-info tr,.patient-info td,.patient-info th,.limsv2-report table,.limsv2-report tr,.limsv2-report th,.limsv2-report td{border:none!important;}\n`;
          }
          if (printOpts.flagColumn === false) {
            css += `.report-table th:last-child,.report-table td:last-child{display:none!important;}\n`;
          }
          if (printOpts.headerBackground) {
            const textCol = (printOpts.headerTextColor as string) || "#ffffff";
            css += `.report-table thead tr th{background:${printOpts.headerBackground}!important;background-color:${printOpts.headerBackground}!important;color:${textCol}!important;}\n`;
          }
          if (printOpts.alternateRows === false) {
            css += `.report-table tbody tr:nth-child(even) td,.report-table tbody tr:nth-child(even){background:#ffffff!important;background-color:#ffffff!important;}\n`;
          }
          if (typeof printOpts.baseFontSize === "number") {
            const fs = Math.min(Math.max(printOpts.baseFontSize, 8), 16);
            css += `.limsv2-report,.report-table td,.report-table th,.patient-info td,.patient-info th{font-size:${fs}px!important;}\n`;
          }
        }
        return css;
      };

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
      `;
      };

      if (effectiveGroupCount <= 1) {
        // Single Group Logic
        template = selectTemplate(context);
        fullContext = prepareFullContext(context);
        const singleGroupId = context.testGroupIds?.[0];
        const singlePrintOptions = mergePrintOptions(pdfSettings, singleGroupId ? testGroupPrintOptions.get(singleGroupId) : undefined);
        mergedPrintOptions = singlePrintOptions; // lift to outer scope for print version
        const dynamicCss = generateDynamicCss(pdfSettings, singlePrintOptions ?? undefined);
        const singleInterpretationTemplates = getInterpretationTemplatesForGroup(
          singleGroupId,
        );
        let renderedHtml = "";
        let interpretationCss = "";

        if (!template) {
          // No custom template found - use default template
          const resolvedStyle = (singleGroupId && testGroupStyles.get(singleGroupId)) || labSettings?.default_template_style || 'beautiful';
          console.log(
            `⚠️ No custom template found for lab, using default template (style: ${resolvedStyle})`,
          );
          renderedHtml = generateDefaultTemplateHtml(
            context,
            testGroupNames,
            analytesByGroup,
            signatoryInfo,
            fullContext?.sectionContent,
            true,
            resolvedStyle,
            labSettings?.show_methodology ?? true,
            labSettings?.show_interpretation ?? false,
            labSettings?.report_patient_info_config,
            singlePrintOptions ?? undefined,
            customPatientFieldConfigs ?? [],
          );
          renderedHtml = renderTemplate(renderedHtml, fullContext); // Process placeholders

          // Inject QR code for verification (next to signature area)
          const defaultVerifyUrl = fullContext.verifyUrl ||
            `https://app.limsapp.in/verify?id=${
              encodeURIComponent(context.sampleId || orderId || "")
            }`;
          renderedHtml = injectQrCode(renderedHtml, defaultVerifyUrl);

          console.log(
            "✅ Generated default template HTML, length:",
            renderedHtml.length,
          );
        } else {
          console.log("✅ Using single template:", template.template_name);
          renderedHtml = renderTemplate(template.gjs_html, fullContext);

          // Inject signature image if template doesn't have one
          if (signatoryInfo.signatoryImageUrl) {
            renderedHtml = injectSignatureImage(
              renderedHtml,
              signatoryInfo.signatoryImageUrl,
              signatoryInfo.signatoryName,
              signatoryInfo.signatoryDesignation,
            );
          }

          // Inject QR code for verification (next to signature area)
          const singleVerifyUrl = fullContext.verifyUrl ||
            `https://app.limsapp.in/verify?id=${
              encodeURIComponent(context.sampleId || orderId || "")
            }`;
          renderedHtml = injectQrCode(renderedHtml, singleVerifyUrl);
        }

        if (singleInterpretationTemplates.length > 0) {
          const renderedInterpretation = renderInterpretationBlocks(
            singleInterpretationTemplates,
            fullContext,
          );
          if (renderedInterpretation.html) {
            renderedHtml += renderedInterpretation.html;
            interpretationCss = renderedInterpretation.css;
            console.log(
              "✅ Appended interpretation-only templates (single group):",
              singleInterpretationTemplates.map((t: any) => t.template_name),
            );
          }
        }

        console.log(
          "🔧 About to call buildPdfBodyDocumentV2 with letterhead:",
          letterheadUrl || "NONE",
        );

        const verifyUrl = `https://app.limsapp.in/verify?id=${
          encodeURIComponent(context.sampleId || orderId || "")
        }`;
        const templateCss = [
          template?.gjs_css || "",
          interpretationCss,
          dynamicCss,
        ].filter(Boolean).join("\n");
        bodyHtml = buildPdfBodyDocumentV2(
          renderedHtml,
          templateCss,
          letterheadUrl,
          pdfSettings,
          verifyUrl,
        );
        console.log(
          "✅ buildPdfBodyDocumentV2 returned, HTML length:",
          bodyHtml.length,
        );
        console.log(
          "🔍 Checking if letterhead is in returned HTML:",
          bodyHtml.includes("page-bg") ? "YES (page-bg div found)" : "NO",
        );
        // CRITICAL: Do NOT save bodyHtml to rawHtmlForPrint if we are using V2/letterhead logic.
        // We want the print version to RE-RENDER cleanly without the letterhead structure.
        // rawHtmlForPrint = bodyHtml
      } else {
        // Multi Group Logic
        console.log("🔀 Multi-test group rendering...");
        const renderedSections: string[] = [];
        let firstGroupTemplate = null;
        const multiInterpretationCssChunks: string[] = [];

        // Set base context for print version (even if not perfect for all groups)
        fullContext = prepareFullContext(context);

        // Use contextTestGroupIds as the authoritative list of groups to render
        // This ensures we render all test groups even if analytes don't have test_group_id
        const groupsToRender = contextTestGroupIds.length > 0
          ? contextTestGroupIds
          : [...analytesByGroup.keys()];
        console.log(`🔀 Groups to render: ${JSON.stringify(groupsToRender)}`);

        for (const testGroupId of groupsToRender) {
          // Get analytes for this group (may be empty if grouping failed)
          let groupAnalytes = analytesByGroup.get(testGroupId) || [];

          // If no analytes found for this group, try to find them from ungrouped
          if (groupAnalytes.length === 0 && analytesByGroup.has("ungrouped")) {
            const ungrouped = analytesByGroup.get("ungrouped") || [];
            // Distribute ungrouped analytes - take the next one for this group
            const groupIndex = groupsToRender.indexOf(testGroupId);
            if (groupIndex >= 0 && groupIndex < ungrouped.length) {
              groupAnalytes = [ungrouped[groupIndex]];
            }
          }

          console.log(
            `🔧 Rendering test group: ${testGroupId} with ${groupAnalytes.length} analyte(s)`,
          );

          // Skip if no analytes for this group
          if (groupAnalytes.length === 0) {
            console.log(
              `⚠️ No analytes found for test group: ${testGroupId}, skipping`,
            );
            continue;
          }

          const groupContext = {
            ...context,
            analytes: groupAnalytes,
            testGroupIds: [testGroupId],
          };

          // Find specific template for this group
          // But first check if this group has a forced style override
          let groupTemplate = null;
          let useGenericTemplate = false;

          if (testGroupStyles.has(testGroupId)) {
            console.log(`🎨 Test group ${testGroupId} has style override '${testGroupStyles.get(testGroupId)}' — skipping custom template`);
            useGenericTemplate = true;
          } else {
            groupTemplate = templatesWithHtml.find((t: { test_group_id?: string; is_interpretation_only?: boolean; [key: string]: unknown }) =>
              t.test_group_id === testGroupId
            ) || null;
            if (groupTemplate?.is_interpretation_only) {
              groupTemplate = null;
            }
          }

          if (!groupTemplate && !useGenericTemplate) {
            console.log(
              `⚠️ No specific template for ${testGroupId}, will use generic table template`,
            );
            // Don't use selectTemplate fallback - it would use another test group's template
            // Instead, flag to use generic template for this group's analytes
            useGenericTemplate = true;
          } else if (groupTemplate) {
            console.log(
              `✅ Found specific template for ${testGroupId}: ${groupTemplate.template_name}`,
            );
          }

          const groupFullContext = prepareFullContext(groupContext);
          let renderedHtml = "";
          let bodyContent = "";

          if (groupTemplate?.gjs_html && !useGenericTemplate) {
            if (!firstGroupTemplate) firstGroupTemplate = groupTemplate;

            renderedHtml = renderTemplate(
              groupTemplate.gjs_html,
              groupFullContext,
            );

            // Inject signature image if template doesn't have one
            if (signatoryInfo.signatoryImageUrl) {
              renderedHtml = injectSignatureImage(
                renderedHtml,
                signatoryInfo.signatoryImageUrl,
                signatoryInfo.signatoryName,
                signatoryInfo.signatoryDesignation,
              );
            }

            // Inject QR code for verification (next to signature area)
            const groupVerifyUrl = groupFullContext.verifyUrl ||
              `https://app.limsapp.in/verify?id=${
                encodeURIComponent(context.sampleId || orderId || "")
              }`;
            renderedHtml = injectQrCode(renderedHtml, groupVerifyUrl);

            // Extract body content
            const bodyMatch = renderedHtml.match(
              /<body[^>]*>([\s\S]*)<\/body>/i,
            );
            bodyContent = bodyMatch ? bodyMatch[1] : renderedHtml;
          } else {
            // No specific template found for this group - generate default/generic template for this group's analytes
            const testName = testGroupNames.get(testGroupId) ||
              groupAnalytes[0]?.test_name || "Test Results";
            console.log(
              `🔧 Generating generic table template for test group: ${testGroupId} (${testName}) with ${groupAnalytes.length} analyte(s)`,
            );
            const singleGroupMap = new Map<string, any[]>();
            singleGroupMap.set(testGroupId, groupAnalytes);
            renderedHtml = generateDefaultTemplateHtml(
              groupContext,
              testGroupNames,
              singleGroupMap,
              signatoryInfo,
              groupFullContext?.sectionContent,
              renderedSections.length === 0,
              testGroupStyles.get(testGroupId) || labSettings?.default_template_style || 'beautiful',
              labSettings?.show_methodology ?? true,
              labSettings?.show_interpretation ?? false,
              labSettings?.report_patient_info_config,
              undefined,
              customPatientFieldConfigs ?? [],
            );
            renderedHtml = renderTemplate(renderedHtml, groupFullContext);

            // Inject QR code for verification (next to signature area)
            const groupDefaultVerifyUrl = groupFullContext.verifyUrl ||
              `https://app.limsapp.in/verify?id=${
                encodeURIComponent(context.sampleId || orderId || "")
              }`;
            renderedHtml = injectQrCode(renderedHtml, groupDefaultVerifyUrl);

            bodyContent = renderedHtml;
          }

          const groupInterpretationTemplates =
            getInterpretationTemplatesForGroup(testGroupId);
          if (groupInterpretationTemplates.length > 0) {
            const renderedInterpretation = renderInterpretationBlocks(
              groupInterpretationTemplates,
              groupFullContext,
            );
            if (renderedInterpretation.html) {
              bodyContent += renderedInterpretation.html;
            }
            if (renderedInterpretation.css) {
              multiInterpretationCssChunks.push(renderedInterpretation.css);
            }
            console.log(
              `✅ Appended interpretation-only templates for ${testGroupId}:`,
              groupInterpretationTemplates.map((t: any) => t.template_name),
            );
          }

          // Add separator
          const testName = testGroupNames.get(testGroupId) ||
            groupAnalytes[0]?.test_name || groupTemplate?.template_name ||
            `Test Group ${renderedSections.length + 1}`;
          const sectionHtml = `
          <div class="test-group-section" data-test-group-id="${testGroupId}">
            ${
            renderedSections.length > 0
              ? `
              <div class="test-group-separator" style="page-break-before: always; margin: 20px 0 10px; padding-top: 10px; border-top: 2px solid #3b82f6;">
                <h2 style="color: #1e40af; font-size: 16px; margin: 0; font-weight: 600;">${testName}</h2>
              </div>
            `
              : ""
          }
            ${bodyContent}
          </div>
        `;
          renderedSections.push(sectionHtml);
          console.log(`✅ Rendered section for ${testGroupId}`);
        }

        if (renderedSections.length === 0) {
          // No sections rendered from templates - use complete default template
          console.log(
            "⚠️ No custom templates rendered, using complete default template",
          );
          fullContext = prepareFullContext(context);
          const defaultHtml = generateDefaultTemplateHtml(
            context,
            testGroupNames,
            analytesByGroup,
            signatoryInfo,
            fullContext?.sectionContent,
            true,
            labSettings?.default_template_style || 'beautiful',
            labSettings?.show_methodology ?? true,
            labSettings?.show_interpretation ?? false,
            labSettings?.report_patient_info_config,
            undefined,
            customPatientFieldConfigs ?? [],
          );
          let renderedDefaultHtml = renderTemplate(defaultHtml, fullContext);

          // Inject QR code for verification
          const fallbackVerifyUrl = fullContext.verifyUrl ||
            `https://app.limsapp.in/verify?id=${
              encodeURIComponent(context.sampleId || orderId || "")
            }`;
          renderedDefaultHtml = injectQrCode(
            renderedDefaultHtml,
            fallbackVerifyUrl,
          );

          renderedSections.push(renderedDefaultHtml);
        }

        // Use first group's exact layout template for outer shell (if available).
        // Do not fall back to unrelated lab template; generic/default sections already rendered.
        template = firstGroupTemplate || null;

        // template can be null if using default template - that's OK now
        const templateCss = [
          template?.gjs_css || "",
          multiInterpretationCssChunks.join("\n"),
        ].filter(Boolean).join("\n");
        console.log(
          "✅ Merged multiple templates" + (template
            ? ` using base: ${template.template_name}`
            : " using default template"),
        );
        const labPrintOptions = mergePrintOptions(pdfSettings, undefined);
        mergedPrintOptions = labPrintOptions; // lift to outer scope for print version
        const dynamicCss = generateDynamicCss(pdfSettings, labPrintOptions ?? undefined);
        console.log(
          "🔧 About to call buildPdfBodyDocumentV2 (multi-template) with letterhead:",
          letterheadUrl || "NONE",
        );

        const verifyUrl = `https://app.limsapp.in/verify?id=${
          encodeURIComponent(context.sampleId || orderId || "")
        }`;
        bodyHtml = buildPdfBodyDocumentV2(
          renderedSections.join("\n"),
          templateCss + "\n" + dynamicCss,
          letterheadUrl,
          pdfSettings,
          verifyUrl,
        );
        console.log(
          "✅ buildPdfBodyDocumentV2 returned, HTML length:",
          bodyHtml.length,
        );
        console.log(
          "🔍 Checking if letterhead is in returned HTML:",
          bodyHtml.includes("page-bg") ? "YES (page-bg div found)" : "NO",
        );
        rawHtmlForPrint = bodyHtml; // Save for print version
      }

      // Apply flag styling (color-code high/low/normal flags)
      bodyHtml = applyFlagStyling(bodyHtml, pdfSettings);
      // CRITICAL: Only apply flag styling to rawHtmlForPrint if it contains actual HTML content
      // If rawHtmlForPrint is empty/minimal, applyFlagStyling would return just CSS which would
      // incorrectly trigger the "if (rawHtmlForPrint)" branch later but fail the regex extraction
      if (rawHtmlForPrint && rawHtmlForPrint.includes("<main")) {
        rawHtmlForPrint = applyFlagStyling(rawHtmlForPrint, pdfSettings);
      }

      // Apply header text color (white text on dark header backgrounds)
      bodyHtml = applyHeaderTextColor(bodyHtml, pdfSettings);
      if (rawHtmlForPrint && rawHtmlForPrint.includes("<main")) {
        rawHtmlForPrint = applyHeaderTextColor(rawHtmlForPrint, pdfSettings);
      }

      // Inject watermark if enabled
      if (watermarkSettings.enabled && watermarkSettings.imageUrl) {
        const watermarkHtml = generateWatermarkHtml(watermarkSettings);
        bodyHtml = bodyHtml.replace("<main", `${watermarkHtml}<main`);
        console.log("✅ Watermark injected");
      }

      // Inject report extras (trends, clinical summary, AI summaries)
      // CRITICAL: Must inject INSIDE </main>, not before </body> - otherwise content appears outside letterhead layout table
      const extrasHtml = generateReportExtrasHtml(reportExtras);
      if (extrasHtml) {
        bodyHtml = bodyHtml.replace("</main>", `${extrasHtml}</main>`);
        console.log("✅ Report extras injected inside main content");
      }

      // Inject attachments
      if (attachments && attachments.length > 0) {
        const attachmentsHtml = generateAttachmentsHtml(attachments);
        if (attachmentsHtml) {
          bodyHtml = bodyHtml.replace("</main>", `${attachmentsHtml}</main>`);
          console.log("✅ Attachments injected:", attachments.length);
        }
      }

      // Inject Last Page if available (this one goes before </body> since it's a separate full page)
      if (lastPage) {
        bodyHtml = bodyHtml.replace(
          "</body>",
          `<div class="report-last-page" style="page-break-before: always; width: 100vw; height: 100vh; margin: 0; padding: 0;">${lastPage}</div></body>`,
        );
        console.log("✅ Last page injected");
      }

      console.log("✅ HTML rendered:", { length: bodyHtml.length });

      await updateProgress(
        supabaseClient,
        job.id,
        "Preparing PDF generation...",
        60,
      );

      // ========================================
      // Step 9: SKIP Base64 Conversion (PDF.co can fetch images directly)
      // ========================================
      console.log(
        "\n🖼️ Step 9: Skipping base64 conversion (PDF.co will fetch images directly from URLs)...",
      );

      // No conversion needed - PDF.co can fetch from ImageKit URLs directly
      const processedBody = bodyHtml;
      // Not using separate header/footer - using letterhead background instead
      const processedHeader = "";
      const processedFooter = "";

      console.log(
        "✅ Using direct image URLs (faster, no base64 conversion needed)",
      );

      await updateProgress(
        supabaseClient,
        job.id,
        "Generating PDF via PDF.co...",
        70,
      );

      // ========================================
      // Step 10: Generate PDFs via PDF.co API (PARALLEL)
      // ========================================
      console.log(
        "\n📤 Step 10: Calling PDF.co API (parallel eCopy + Print)...",
      );
      const pdfStartTime = Date.now();

      // Build PDF settings
      // CRITICAL: If letterhead is present, we must set PDF margins to 0px top/bottom
      // so the background image is not pushed down. Content spacing is handled by CSS padding.
      let margins = DEFAULT_PDF_SETTINGS.margins;

      if (letterheadUrl) {
        // Letterhead Mode: 0px all margins (background full bleed), side padding handled by CSS
        margins = `0px 0px 0px 0px`;
        console.log(
          "📄 Letterhead detected: Forcing 0px all margins for API, using CSS padding for content.",
        );
      } else if (pdfSettings?.margins) {
        // Standard Mode: Use saved margins
        margins =
          `${pdfSettings.margins.top}px ${pdfSettings.margins.right}px ${pdfSettings.margins.bottom}px ${pdfSettings.margins.left}px`;
      }

      const filename = `Report_${
        context.sampleId || orderId
      }_${Date.now()}.pdf`;

      // Check if lab has print settings enabled (default: true)
      const generatePrintVersion =
        labSettings?.pdf_settings?.generatePrintVersion !== false;

      // Prepare print HTML in advance (if needed) for parallel generation
      let printHtmlPrepared: string | null = null;

      // Create verification URL for QR code (used in both e-copy and print)
      const printVerifyUrl = `https://app.limsapp.in/verify?id=${
        encodeURIComponent(context.sampleId || orderId || "")
      }`;

      if (generatePrintVersion) {
        let printHtml = "";

        if (rawHtmlForPrint) {
          // rawHtmlForPrint contains the full E-Copy HTML with letterhead styles and spacers
          // For print version, we need to extract just the CONTENT and rebuild with null letterhead

          // Strategy: Extract the content inside <main class="limsv2-report-body...">...</main>
          // and rebuild a clean HTML document without letterhead
          const mainContentMatch = rawHtmlForPrint.match(
            /<main[^>]*class="[^"]*limsv2-report-body[^"]*"[^>]*>([\s\S]*?)<\/main>/i,
          );

          if (mainContentMatch) {
            const extractedContent = mainContentMatch[1];
            console.log(
              "✅ Extracted main content from rawHtmlForPrint, length:",
              extractedContent.length,
            );

            // Rebuild clean HTML with NO letterhead (pass null for letterheadBackgroundUrl)
            // Print version: Include QR code for verification (positioned at top since no letterhead spacer)
            printHtml = buildPdfBodyDocumentV2(
              extractedContent,
              "",
              null,
              pdfSettings,
              printVerifyUrl,
            );
            console.log(
              "✅ Rebuilt print HTML without letterhead, with QR code",
            );
          } else {
            // Fallback: Try to strip letterhead elements manually
            console.log(
              "⚠️ Could not extract main content, falling back to stripping approach",
            );
            printHtml = rawHtmlForPrint;

            // Remove letterhead styles
            printHtml = printHtml.replace(
              /<style id="lims-letterhead">[\s\S]*?<\/style>/gi,
              "",
            );

            // Remove background div
            printHtml = printHtml.replace(/<div id="page-bg"><\/div>/gi, "");

            // Keep QR code but fix its position for print (no letterhead spacer, so use 25px from top)
            printHtml = printHtml.replace(
              /(<div[^>]*style="[^"]*top:\s*)\d+px/gi,
              "$125px",
            );
          }
        } else {
          const printSectionContent = (fullContext as any)
            ?.sectionContentNoImages || (fullContext as any)?.sectionContent || {};
          const printTemplateContext = {
            ...fullContext,
            ...printSectionContent,
            sectionContent: printSectionContent,
            placeholderValues: {
              ...(fullContext?.placeholderValues || {}),
              ...printSectionContent,
            },
            isForPrint: true,
            hideWatermark: true,
            watermarkText: "",
            showWatermark: false,
          };
          let printRenderedHtml = "";
          const printInterpretationTemplates = getInterpretationTemplatesForGroup(
            context.testGroupIds?.[0],
          );
          const renderedPrintInterpretation = renderInterpretationBlocks(
            printInterpretationTemplates,
            printTemplateContext,
          );

          if (template?.gjs_html) {
            // Use custom template
            printRenderedHtml = renderTemplate(
              template.gjs_html,
              printTemplateContext,
            );

            // Inject signature image if template doesn't have one (Critical for print version)
            if (signatoryInfo.signatoryImageUrl) {
              printRenderedHtml = injectSignatureImage(
                printRenderedHtml,
                signatoryInfo.signatoryImageUrl,
                signatoryInfo.signatoryName,
                signatoryInfo.signatoryDesignation,
              );
            }

            // Inject QR code for verification (next to signature area)
            const printVerifyUrlForQr = `https://app.limsapp.in/verify?id=${
              encodeURIComponent(context.sampleId || orderId || "")
            }`;
            printRenderedHtml = injectQrCode(
              printRenderedHtml,
              printVerifyUrlForQr,
            );

            if (renderedPrintInterpretation.html) {
              printRenderedHtml += renderedPrintInterpretation.html;
            }
          } else {
            // No custom template - use default template
            console.log("⚠️ Using default template for print version");
            const printSingleGroupId = context.testGroupIds?.[0];
            const printResolvedStyle = (printSingleGroupId && testGroupStyles.get(printSingleGroupId)) || labSettings?.default_template_style || 'beautiful';
            printRenderedHtml = generateDefaultTemplateHtml(
              context,
              testGroupNames,
              analytesByGroup,
              signatoryInfo,
              printSectionContent,
              true,
              printResolvedStyle,
              labSettings?.show_methodology ?? true,
              labSettings?.show_interpretation ?? false,
              labSettings?.report_patient_info_config,
              mergedPrintOptions ?? undefined,
              customPatientFieldConfigs ?? [],
            );
            printRenderedHtml = renderTemplate(
              printRenderedHtml,
              printTemplateContext,
            );

            // Inject QR code for verification (next to signature area)
            const printDefaultVerifyUrl = `https://app.limsapp.in/verify?id=${
              encodeURIComponent(context.sampleId || orderId || "")
            }`;
            printRenderedHtml = injectQrCode(
              printRenderedHtml,
              printDefaultVerifyUrl,
            );

            if (renderedPrintInterpretation.html) {
              printRenderedHtml += renderedPrintInterpretation.html;
            }
          }

          // AUTO-FIX: Apply flag classes (so we can style them bold in print CSS)
          printRenderedHtml = addFlagClassesToHtml(printRenderedHtml);

          // Build print HTML body - gjs_css is injected separately below after this block
          // CRITICAL: Pass null for letterhead so we get a clean HTML without background/spacers
          // Print version: Include QR code for verification (positioned at top since no letterhead spacer)
          printHtml = buildPdfBodyDocumentV2(
            printRenderedHtml,
            renderedPrintInterpretation.css || "",
            null,
            pdfSettings,
            printVerifyUrl,
          );
          console.log(
            "✅ Built print HTML without gjs_css, with QR code (clean print mode)",
          );

          // Skip section content injection for print fallback path.
          // Sections already render via template placeholders to avoid duplicates.
        }

        // Strip section images for print output
        printHtml = printHtml.replace(
          /<div class="section-images"[\s\S]*?<\/div>/gi,
          "",
        );
        printHtml = printHtml.replace(
          /<img[^>]*class="section-image"[^>]*>/gi,
          "",
        );

        // Strip old lims-report-custom (may be from eCopy gjs_css or empty), then re-inject
        // with: gjs_css (template's own CSS) + merged printOptions overrides
        printHtml = printHtml.replace(
          /<style id="lims-report-custom">[\s\S]*?<\/style>/gi,
          "",
        );
        {
          const gjsCssPart = template?.gjs_css || "";
          const printOptionsCss = (mergedPrintOptions && Object.keys(mergedPrintOptions).length > 0)
            ? generateDynamicCss(pdfSettings, mergedPrintOptions)
            : generateDynamicCss(pdfSettings);
          const combinedCss = [gjsCssPart, printOptionsCss].filter(Boolean).join("\n");
          if (combinedCss) {
            printHtml = printHtml.replace(
              "</head>",
              `<style id="lims-report-custom">${combinedCss}</style></head>`,
            );
          }
        }

        // Inject report extras - INSIDE </main> not </body> for proper layout
        const printExtrasHtml = generateReportExtrasHtml(reportExtras);
        if (printExtrasHtml) {
          printHtml = printHtml.replace("</main>", `${printExtrasHtml}</main>`);
        }

        // NOTE: Attachments are NOT injected into print version (only in e-copy)

        // SKIP: Convert images to base64 (PDF.co can fetch directly)
        // printHtml = await convertHtmlImagesToBase64(printHtml)
        console.log("✅ Print HTML ready (using direct image URLs)");

        // Inject print-optimized CSS (grayscale, simplified colors)
        // REFINED: Don't nuke ALL backgrounds (protects table headers)
        const printCss = `
        <style id="lims-print-css">
          /* FORCE BLACK & WHITE / GRAYSCALE */
          html, body {
            -webkit-filter: grayscale(100%) !important;
            filter: grayscale(100%) !important;
            background: white !important;
            color: black !important;
          }
          
          /* RESET fancy UI backgrounds, but keep table headers readable */
          .report-header,
          .section-header,
          .note,
          .report-container {
            background: transparent !important;
            box-shadow: none !important;
          }
          
          /* Ensure explicit table borders for print legibility
             Skipped when: tableBorders=false OR a custom GrapesJS template is used
             (custom templates control their own border styles via gjs_css) */
          ${!template?.gjs_html && mergedPrintOptions?.tableBorders !== false ? `table, tr, th, td { border-color: #000 !important; }` : ''}

          /* Force black text for everything */
          body, p, span, td, th, div, h1, h2, h3, h4, h5, h6, strong, b, i, em {
            color: #000000 !important;
          }

          /* Neutralize colored backgrounds - specific targeting */
          .bg-blue-50, .bg-green-50, .bg-yellow-50, .bg-red-50,
          [class*="bg-"], [style*="background"] {
            background-color: #ffffff !important;
            background: #ffffff !important;
          }

          /* Neutralize colored text */
          [class*="text-"], [style*="color"] {
            color: #000000 !important;
          }

          /* Explicitly kill shadows on containers */
          .report-container, .report-body, .card, .box {
            box-shadow: none !important;
            border: none !important;
          }

          /* Clean table styling for print - only for default templates, not custom GrapesJS */
          ${!template?.gjs_html ? `
          table { border-collapse: collapse !important; ${mergedPrintOptions?.tableBorders !== false ? 'border: 1px solid #000 !important;' : 'border: none !important;'} }
          tr { ${mergedPrintOptions?.tableBorders !== false ? '' : 'border: none !important; border-top: none !important; border-bottom: none !important;'} }
          td, th { ${mergedPrintOptions?.tableBorders !== false ? 'border: 1px solid #000 !important;' : 'border: none !important;'} padding: 4px 8px !important; color: black !important; }
          thead th { background: #f0f0f0 !important; font-weight: bold !important; ${mergedPrintOptions?.tableBorders !== false ? 'border-bottom: 2px solid #000 !important;' : ''} }
          ` : ''}

          /* Header/Footer specific fixes for B&W */
          .report-header, .report-footer {
             background: transparent !important;
             color: black !important;
             border: none !important;
          }

          /* Hide non-print elements */
          .watermark, .draft-watermark { display: none !important; }

          /* BOLD overrides for Result/Flag classes in Print Mode */
          .value-low, .flag-low,
          .value-high, .flag-high,
          .value-critical, .flag-critical,
          .value-abnormal, .flag-abnormal,
          .value-trace, .flag-trace,
          .value-critical_h, .flag-critical_h,
          .value-critical_l, .flag-critical_l {
            color: #000000 !important;
            font-weight: 900 !important;
            text-decoration: none !important;
          }
        </style>
      `;
        printHtml = printHtml.replace("</head>", `${printCss}</head>`);
        console.log("✅ Print CSS injected (grayscale + clean styling)");

        printHtmlPrepared = printHtml;
      }

      // ========================================
      // PARALLEL PDF Generation - eCopy + Print simultaneously
      // ========================================
      console.log("📤 Preparing to send HTML to PDF.co...");
      console.log("  � PDF Mode:", pdfLetterheadMode);
      console.log("  📄 Processed body length:", processedBody.length);
      if (pdfLetterheadMode === 'header_footer') {
        console.log("  🖼️ Header HTML length:", headerFooterHtml.headerHtml.length);
        console.log("  🖼️ Footer HTML length:", headerFooterHtml.footerHtml.length);
      } else {
        console.log(
          "  🔍 Checking for letterhead in HTML:",
          processedBody.includes("page-bg") ? "✅ FOUND (page-bg)" : "❌ NOT FOUND",
        );
        console.log(
          "  🔍 Checking for letterhead URL in HTML:",
          processedBody.includes("background-image")
            ? "✅ FOUND"
            : "❌ NOT FOUND",
        );
      }

      // Build PDF.co options based on mode
      const isHeaderFooterMode = pdfLetterheadMode === 'header_footer';

      const eCopyPromise = sendHtmlToPdfCo(
        processedBody,
        filename,
        PDFCO_API_KEY,
        {
          headerHtml: isHeaderFooterMode ? headerFooterHtml.headerHtml : processedHeader,
          footerHtml: isHeaderFooterMode ? headerFooterHtml.footerHtml : processedFooter,
          margins: isHeaderFooterMode
            ? (pdfSettings?.margins
              ? `${pdfSettings.margins.top}px ${pdfSettings.margins.right}px ${pdfSettings.margins.bottom}px ${pdfSettings.margins.left}px`
              : DEFAULT_PDF_SETTINGS.margins)
            : margins,
          headerHeight: isHeaderFooterMode
            ? (pdfSettings?.headerHeight
              ? `${pdfSettings.headerHeight}px`
              : DEFAULT_PDF_SETTINGS.headerHeight)
            : (letterheadUrl
              ? "0px"
              : (pdfSettings?.headerHeight
                ? `${pdfSettings.headerHeight}px`
                : DEFAULT_PDF_SETTINGS.headerHeight)),
          footerHeight: isHeaderFooterMode
            ? (pdfSettings?.footerHeight
              ? `${pdfSettings.footerHeight}px`
              : DEFAULT_PDF_SETTINGS.footerHeight)
            : (letterheadUrl
              ? "0px"
              : (pdfSettings?.footerHeight
                ? `${pdfSettings.footerHeight}px`
                : DEFAULT_PDF_SETTINGS.footerHeight)),
          scale: pdfSettings?.scale ?? DEFAULT_PDF_SETTINGS.scale,
          displayHeaderFooter: isHeaderFooterMode
            ? true
            : (letterheadUrl
              ? false
              : (pdfSettings?.displayHeaderFooter ??
                DEFAULT_PDF_SETTINGS.displayHeaderFooter)),
          paperSize: DEFAULT_PDF_SETTINGS.paperSize,
          mediaType: DEFAULT_PDF_SETTINGS.mediaType,
          printBackground: DEFAULT_PDF_SETTINGS.printBackground,
        },
      );

      const printPromise = printHtmlPrepared
        ? sendHtmlToPdfCo(
          printHtmlPrepared,
          `Print_${filename}`,
          PDFCO_API_KEY!,
          {
            headerHtml: "",
            footerHtml: "",
            // Use database margins for print, with fallback to defaults
            margins: pdfSettings?.margins
              ? `${pdfSettings.margins.top}px ${pdfSettings.margins.right}px ${pdfSettings.margins.bottom}px ${pdfSettings.margins.left}px`
              : "150px 20px 150px 20px",
            headerHeight: "0px",
            footerHeight: "0px",
            scale: pdfSettings?.scale ?? DEFAULT_PDF_SETTINGS.scale,
            displayHeaderFooter: false,
            paperSize: DEFAULT_PDF_SETTINGS.paperSize,
            mediaType: "print",
            printBackground: false,
          },
        )
        : Promise.resolve(null);

      // Wait for both PDFs to generate in parallel
      const [pdfCoUrl, printPdfCoUrl] = await Promise.all([
        eCopyPromise,
        printPromise,
      ]);

      console.log(
        `✅ PDFs generated in ${Date.now() - pdfStartTime}ms (parallel)`,
      );
      console.log("  eCopy URL:", pdfCoUrl ? "✓" : "✗");
      console.log("  Print URL:", printPdfCoUrl ? "✓" : "skipped");

      await updateProgress(
        supabaseClient,
        job.id,
        "Uploading PDFs to storage...",
        85,
      );

      // ========================================
      // Step 11: Upload PDFs to Storage (PARALLEL)
      // ========================================
      console.log(
        "\n📦 Step 11: Uploading PDFs to Supabase Storage (parallel)...",
      );
      const uploadStartTime = Date.now();

      // Small delay before downloads to let PDF.co finalize
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const eCopyUploadPromise = uploadPdfToStorage(
        supabaseClient,
        pdfCoUrl,
        orderId,
        job.lab_id,
        context.patientId || "unknown",
        filename,
        "final",
      );

      const printUploadPromise = printPdfCoUrl
        ? uploadPdfToStorage(
          supabaseClient,
          printPdfCoUrl,
          orderId,
          job.lab_id,
          context.patientId || "unknown",
          `Print_${filename}`,
          "print",
          5,
        ).catch((err) => {
          console.warn("⚠️ Print upload failed (non-fatal):", err.message);
          return null;
        })
        : Promise.resolve(null);

      const [eCopyResult, printResult] = await Promise.all([
        eCopyUploadPromise,
        printUploadPromise,
      ]);

      const storageUrl = eCopyResult.publicUrl;
      let printStorageUrl: string | null = printResult?.publicUrl || null;

      console.log(
        `✅ PDFs uploaded in ${Date.now() - uploadStartTime}ms (parallel)`,
      );
      console.log("  eCopy:", storageUrl);
      console.log("  Print:", printStorageUrl || "none");

      await updateProgress(
        supabaseClient,
        job.id,
        "Updating database records...",
        95,
      );

      // ========================================
      // Step 12: Update Database Records
      // ========================================
      console.log("\n💾 Step 12: Updating database records...");

      const now = new Date().toISOString();

      // Get patient_id and doctor name from context (required fields for reports table)
      // Try multiple sources for patient_id
      let patientId = context.patientId || context.patient?.id;

      // If still null, try to get from orders table
      if (!patientId) {
        const { data: orderData } = await supabaseClient
          .from("orders")
          .select("patient_id")
          .eq("id", orderId)
          .single();
        patientId = orderData?.patient_id;
      }

      const doctorName = context.order?.referringDoctorName ||
        context.placeholderValues?.referringDoctorName ||
        context.order?.doctor ||
        "";

      if (!patientId) {
        console.error("❌ Missing patient_id - cannot create report record");
        console.error("Context patient sources:", {
          contextPatientId: context.patientId,
          patientObjectId: context.patient?.id,
          orderId,
        });
        // Don't throw - continue without creating report record, PDF is still generated
        console.warn(
          "⚠️ Skipping report record creation due to missing patient_id",
        );
      }

      console.log("📋 Report record data:", {
        orderId,
        patientId,
        doctorName,
        pdfUrl: storageUrl,
        printPdfUrl: printStorageUrl || "none",
      });

      // Track report ID for notification - declare before the if block so it's in scope
      let reportIdForNotif: string | null = null;

      // Only create/update report record if we have patient_id
      if (patientId) {
        // Update or create report record - include ALL fields like normal flow
        const { data: existingReport, error: selectError } =
          await supabaseClient
            .from("reports")
            .select("id")
            .eq("order_id", orderId)
            .maybeSingle();

        // Fields to update (for existing record)
        const updateFields = {
          pdf_url: storageUrl,
          pdf_generated_at: now,
          status: "completed",
          report_status: "completed",
          report_type: "final",
          updated_at: now,
          ...(printStorageUrl && {
            print_pdf_url: printStorageUrl,
            print_pdf_generated_at: now,
          }),
        };

        // Fields for new record (includes required fields)
        const insertFields = {
          order_id: orderId,
          patient_id: patientId,
          lab_id: job.lab_id, // Add lab_id for multi-lab filtering
          doctor: doctorName,
          generated_date: now,
          ...updateFields,
        };

        // Initialize with existing report ID if it exists
        reportIdForNotif = existingReport?.id || null;

        if (existingReport) {
          const { error: updateError } = await supabaseClient
            .from("reports")
            .update(updateFields)
            .eq("id", reportIdForNotif);

          if (updateError) {
            console.error("⚠️ Report update error:", updateError);
          } else {
            console.log("✅ Updated existing report record with all fields");
          }
        } else {
          const { data: newReport, error: insertError } = await supabaseClient
            .from("reports")
            .insert(insertFields)
            .select("id")
            .single();

          if (insertError) {
            console.error("⚠️ Report insert error:", insertError);
            console.error("Insert data:", insertFields);
          } else {
            reportIdForNotif = newReport.id;
            console.log(
              "✅ Created new report record with all fields, ID:",
              reportIdForNotif,
            );
          }
        }
      } // End of if (patientId)

      // Mark job as completed - WITH ERROR CHECKING
      const { error: completeError } = await supabaseClient
        .from("pdf_generation_queue")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          progress_stage: "Completed",
          progress_percent: 100,
        })
        .eq("id", job.id);

      if (completeError) {
        console.error("⚠️ Failed to mark job as completed:", completeError);
        // Try again with simpler update
        const { error: retryError } = await supabaseClient
          .from("pdf_generation_queue")
          .update({ status: "completed", progress_percent: 100 })
          .eq("id", job.id);

        if (retryError) {
          console.error("❌ Retry also failed:", retryError);
        } else {
          console.log("✅ Job marked complete on retry");
        }
      } else {
        console.log("✅ Job marked as COMPLETED in queue");
      }

      // ====== AUTO-TRIGGER WHATSAPP NOTIFICATIONS ======
      // Trigger if we have a valid report ID
      if (patientId && reportIdForNotif) {
        console.log("📲 Checking WhatsApp auto-send settings...");
        try {
          // Fetch lab notification settings
          const { data: notifSettings } = await supabaseClient
            .from("lab_notification_settings")
            .select("*")
            .eq("lab_id", job.lab_id)
            .maybeSingle();

          if (
            notifSettings?.auto_send_report_to_patient ||
            notifSettings?.auto_send_report_to_doctor
          ) {
            console.log("📲 Auto-send enabled, fetching recipient details...");

            const parseMinutes = (
              timeStr: string | null | undefined,
              fallback: string,
            ) => {
              const [h, m] = (timeStr || fallback).split(":").map(Number);
              return (h * 60) + m;
            };

            // Edge functions run in UTC. Send window times are in IST (UTC+5:30).
            const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
            const utcNow = Date.now();
            const istDate = new Date(utcNow + IST_OFFSET_MS);
            const currentMinutes = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();
            console.log(`⏰ Time check: UTC=${new Date(utcNow).toISOString()}, IST=${istDate.toISOString()}, currentMinutes=${currentMinutes}`);
            const startMinutes = parseMinutes(notifSettings.send_window_start, "09:00:00");
            const endMinutes = parseMinutes(notifSettings.send_window_end, "21:00:00");
            const withinWindow = startMinutes <= endMinutes
              ? (currentMinutes >= startMinutes && currentMinutes <= endMinutes)
              : (currentMinutes >= startMinutes || currentMinutes <= endMinutes);
            console.log(`⏰ Window: ${startMinutes}-${endMinutes}, current=${currentMinutes}, within=${withinWindow}`);

            const requiredStatus =
              String(notifSettings.send_report_on_status || "Completed").toLowerCase();
            const { data: reportForStatus } = await supabaseClient
              .from("reports")
              .select("status, report_status")
              .eq("id", reportIdForNotif)
              .maybeSingle();
            const currentStatus =
              String(reportForStatus?.report_status || reportForStatus?.status || "")
                .toLowerCase();
            const statusMatches = currentStatus === requiredStatus;
            console.log(`📋 Status check: required=${requiredStatus}, current=${currentStatus}, matches=${statusMatches}`);

            // Calculate next window start in IST, convert to UTC for scheduled_for
            const [startHour, startMinute] =
              (notifSettings.send_window_start || "09:00:00").split(":").map(Number);
            const nextIst = new Date(utcNow + IST_OFFSET_MS);
            nextIst.setUTCHours(startHour, startMinute, 0, 0);
            if (nextIst.getTime() <= utcNow + IST_OFFSET_MS) {
              nextIst.setUTCDate(nextIst.getUTCDate() + 1);
            }
            const nextWindowStart = new Date(nextIst.getTime() - IST_OFFSET_MS);

            const canAttemptImmediate = withinWindow && statusMatches;
            console.log(`🚦 canAttemptImmediate=${canAttemptImmediate} (window=${withinWindow}, status=${statusMatches})`);
            const shouldQueueOutsideWindow = notifSettings.queue_outside_window !== false;
            const deferredScheduledFor = withinWindow
              ? new Date().toISOString()
              : nextWindowStart.toISOString();

            // Fetch patient and doctor phone numbers, plus clinical summary fields
            const { data: order } = await supabaseClient
              .from("orders")
              .select(`
              patient_name,
              ai_clinical_summary,
              include_clinical_summary_in_report,
              patients!inner (id, phone, name),
              doctors (id, phone, name)
            `)
              .eq("id", orderId)
              .single();

            if (order) {
              const { data: orderTests } = await supabaseClient
                .from("order_tests")
                .select("test_name")
                .eq("order_id", orderId);

              const testNames = orderTests?.map((t) =>
                t.test_name
              ).join(", ") || "Lab Test";

              // Fetch lab details once for use throughout WhatsApp notification section
              const { data: lab } = await supabaseClient
                .from("labs")
                .select("name, whatsapp_user_id, country_code, block_send_on_due")
                .eq("id", job.lab_id)
                .single();

              // ========================================
              // SMART WHATSAPP ROUTING (Priority Order)
              // ========================================
              // 1. User who triggered (highest priority) - whoever clicked "Generate PDF"
              // 2. Location-based user (branch manager) - assigned to order's location
              // 3. Lab-level account (fallback) - central WhatsApp account
              // ========================================

              let whatsappUserId: string | null = null;
              let whatsappUserName: string | null = null;

              // Priority 1: User who triggered this request
              if (triggeredByUserId) {
                const { data: triggeringUser } = await supabaseClient
                  .from("users")
                  .select("id, name, whatsapp_user_id")
                  .eq("id", triggeredByUserId)
                  .single();

                if (triggeringUser?.whatsapp_user_id) {
                  whatsappUserId = triggeringUser.whatsapp_user_id;
                  whatsappUserName = triggeringUser.name;
                  console.log(
                    `✅ [Priority 1] Using triggering user's WhatsApp: ${whatsappUserName}`,
                  );
                } else {
                  console.log(
                    `⚠️ Triggering user (${
                      triggeringUser?.name || triggeredByUserId
                    }) has no whatsapp_user_id - checking location...`,
                  );
                }
              }

              // Priority 2: Location-based routing (find user assigned to order's location)
              if (!whatsappUserId && order.location_id) {
                console.log(
                  `🔍 Checking for location-based WhatsApp user for location: ${order.location_id}`,
                );

                // Find users assigned to this location with WhatsApp connected
                // Prioritize: Lab Manager > Lab Technician > any user with WhatsApp
                const { data: locationUsers } = await supabaseClient
                  .from("users")
                  .select(
                    "id, name, role, whatsapp_user_id, default_location_id",
                  )
                  .eq("lab_id", job.lab_id)
                  .not("whatsapp_user_id", "is", null)
                  .or(`default_location_id.eq.${order.location_id}`)
                  .order("role", { ascending: true }) // Lab Manager comes before Lab Technician
                  .limit(5);

                if (locationUsers && locationUsers.length > 0) {
                  // Prefer Lab Manager role if available
                  const locationUser = locationUsers.find((u) =>
                    u.role === "Lab Manager"
                  ) || locationUsers[0];
                  whatsappUserId = locationUser.whatsapp_user_id;
                  whatsappUserName = locationUser.name;
                  console.log(
                    `✅ [Priority 2] Using location-based WhatsApp: ${whatsappUserName} (${locationUser.role}) at location ${order.location_id}`,
                  );
                } else {
                  console.log(
                    `⚠️ No users with WhatsApp found for location: ${order.location_id}`,
                  );
                }
              }

              // Priority 3: Lab-level fallback (deprecated but kept for backwards compatibility)
              if (!whatsappUserId && lab?.whatsapp_user_id) {
                whatsappUserId = lab.whatsapp_user_id;
                whatsappUserName = lab.name;
                console.log(
                  `✅ [Priority 3] Using lab-level WhatsApp fallback: ${lab.name}`,
                );
              }

              if (!whatsappUserId) {
                console.warn(
                  "⚠️ No whatsapp_user_id configured - notifications will be queued only",
                );
              }

              // Use existing Netlify function for sending reports
              const NETLIFY_SEND_REPORT_URL =
                "https://app.limsapp.in/.netlify/functions/send-report-url";

              // Helper function to send WhatsApp via Netlify function
              const sendWhatsApp = async (
                phone: string,
                message: string,
                pdfUrl: string,
                patientName: string,
              ): Promise<boolean> => {
                if (!whatsappUserId) {
                  console.log(
                    "⏭️ Skipping immediate send - no whatsapp_user_id configured",
                  );
                  return false;
                }

                try {
                  // Use lab's country code (already fetched)
                  const countryCode = lab?.country_code || "+91"; // Default to India
                  console.log("🌍 Using country code:", countryCode);

                  let cleanPhone = phone.replace(/\D/g, "");

                  // Remove leading 0 (common for local numbers)
                  if (cleanPhone.startsWith("0")) {
                    cleanPhone = cleanPhone.substring(1);
                  }

                  // Format phone number with lab's country code
                  let formattedPhone: string;
                  const countryCodeDigits = countryCode.replace(/\D/g, "");

                  if (cleanPhone.length === 10) {
                    // 10 digit number - add country code
                    formattedPhone = countryCode + cleanPhone;
                  } else if (
                    cleanPhone.startsWith(countryCodeDigits) &&
                    cleanPhone.length === (10 + countryCodeDigits.length)
                  ) {
                    // Already has country code digits - just add +
                    formattedPhone = "+" + cleanPhone;
                  } else if (cleanPhone.length > 10) {
                    // Assume it has country code, just add +
                    formattedPhone = "+" + cleanPhone;
                  } else {
                    // Fallback - add country code
                    formattedPhone = countryCode + cleanPhone;
                  }

                  console.log(
                    `📤 Sending WhatsApp to ${formattedPhone} via Netlify function`,
                  );

                  // Extract filename from URL
                  const urlParts = pdfUrl.split("/");
                  const fileName = urlParts[urlParts.length - 1];

                  const requestBody = {
                    userId: whatsappUserId,
                    fileUrl: pdfUrl,
                    fileName: fileName,
                    caption: message,
                    phoneNumber: formattedPhone,
                    templateData: {
                      PatientName: patientName,
                    },
                  };

                  console.log(
                    "📋 Request payload:",
                    JSON.stringify(requestBody, null, 2),
                  );

                  const response = await fetch(NETLIFY_SEND_REPORT_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(requestBody),
                  });

                  const responseText = await response.text();

                  if (!response.ok) {
                    console.error(
                      `❌ Netlify function error: ${response.status} ${response.statusText}`,
                    );
                    console.error(`   Response: ${responseText}`);
                    return false;
                  }

                  try {
                    const result = JSON.parse(responseText);
                    console.log(`✅ WhatsApp sent successfully:`, result);
                  } catch {
                    console.log(
                      `✅ WhatsApp sent successfully (raw response): ${responseText}`,
                    );
                  }
                  return true;
                } catch (error) {
                  console.error(`❌ WhatsApp send exception:`, error);
                  return false;
                }
              };

              // Check per-order due block (shared by patient + doctor notification)
              let blockedByDue = false;
              if (lab?.block_send_on_due) {
                const { data: dueStatus } = await supabaseClient
                  .from("order_due_status")
                  .select("has_due")
                  .eq("order_id", orderId)
                  .maybeSingle();
                if (dueStatus?.has_due) {
                  console.log("⛔ Auto-send blocked — order has outstanding balance:", orderId);
                  blockedByDue = true;
                }
              }

              // Send to patient - use WhatsApp template if available (same as Dashboard)
              if (
                notifSettings.auto_send_report_to_patient &&
                order.patients?.phone
              ) {
                // Try to fetch WhatsApp template from database
                let patientMessage =
                  `Hello ${order.patient_name}, your ${testNames} report is ready. Please find it attached.`;

                try {
                  // Correct table: whatsapp_message_templates, column: category
                  const { data: template } = await supabaseClient
                    .from("whatsapp_message_templates")
                    .select("message_content")
                    .eq("lab_id", job.lab_id)
                    .eq("category", "report_ready")
                    .eq("is_default", true)
                    .eq("is_active", true)
                    .maybeSingle();

                  if (template?.message_content) {
                    // Replace placeholders - format is [PlaceholderName] not {{PlaceholderName}}
                    patientMessage = template.message_content
                      .replace(
                        /\[PatientName\]/gi,
                        order.patient_name || "Patient",
                      )
                      .replace(/\[OrderId\]/gi, orderId.slice(-6))
                      .replace(/\[TestName\]/gi, testNames)
                      .replace(/\[ReportUrl\]/gi, storageUrl)
                      .replace(/\[LabName\]/gi, lab?.name || "")
                      .replace(/\[LabAddress\]/gi, "") // Not fetched in this context
                      .replace(/\[LabContact\]/gi, "") // Not fetched in this context
                      .replace(/\[LabEmail\]/gi, ""); // Not fetched in this context

                    console.log(
                      "✅ Using WhatsApp template for patient message",
                    );
                  } else {
                    console.log(
                      "ℹ️ No WhatsApp template found, using default message",
                    );
                  }
                } catch (templateError) {
                  console.error(
                    "⚠️ Error fetching WhatsApp template:",
                    templateError,
                  );
                }

                // Add "Thank you" if not already present
                if (
                  !patientMessage.includes("Thank you") &&
                  !patientMessage.includes("thank you")
                ) {
                  patientMessage += "\n\nThank you.";
                }

                const sent = !blockedByDue && canAttemptImmediate
                  ? await sendWhatsApp(
                    order.patients.phone,
                    patientMessage,
                    storageUrl,
                    order.patient_name,
                  )
                  : false;

                if (sent) {
                  await supabaseClient
                    .from("reports")
                    .update({
                      whatsapp_sent_at: new Date().toISOString(),
                      whatsapp_sent_to: order.patients.phone,
                      whatsapp_sent_via: "api",
                    })
                    .eq("id", reportIdForNotif);
                  console.log(
                    "✅ WhatsApp sent to patient:",
                    order.patients.phone,
                  );
                } else {
                  // Queue for retry
                  const shouldQueue = statusMatches || shouldQueueOutsideWindow;
                  if (shouldQueue) {
                    await supabaseClient
                      .from("notification_queue")
                      .insert({
                        lab_id: job.lab_id,
                        recipient_type: "patient",
                        recipient_phone: order.patients.phone,
                        recipient_name: order.patient_name,
                        recipient_id: order.patients.id,
                        trigger_type: "report_ready",
                        order_id: orderId,
                        report_id: reportIdForNotif,
                        message_content: patientMessage,
                        attachment_url: storageUrl,
                        attachment_type: "report",
                        status: "pending",
                        scheduled_for: deferredScheduledFor,
                        last_error: !statusMatches
                          ? `Waiting for report status ${notifSettings.send_report_on_status || "Completed"}`
                          : (withinWindow ? "Initial send failed" : "Outside send window"),
                      });
                    console.log("📥 Patient notification queued for retry");
                  } else {
                    console.log(
                      "⏭️ Skipping patient notification: outside send window and queue disabled",
                    );
                  }
                }
              }

              // Send to doctor (with clinical summary if enabled)
              if (
                notifSettings.auto_send_report_to_doctor && order.doctors?.phone
              ) {
                // Build doctor message - include clinical summary if toggled
                let doctorMessage = `Hello Dr. ${
                  order.doctors.name || "Doctor"
                },\n\nThe report for patient ${order.patient_name} (${testNames}) is ready.`;

                // Add clinical summary if include_clinical_summary_in_report is true
                const includeClinicalSummary =
                  (order as any).include_clinical_summary_in_report || false;
                const clinicalSummary = (order as any).ai_clinical_summary ||
                  "";

                if (includeClinicalSummary && clinicalSummary) {
                  doctorMessage +=
                    `\n\n📋 Clinical Summary:\n${clinicalSummary}`;
                  console.log(
                    "📋 Including AI clinical summary in doctor message",
                  );
                }

                doctorMessage +=
                  `\n\nPlease find the attached report.\n\nThank you,\n${
                    lab?.name || "Lab"
                  }`;

                const sent = !blockedByDue && canAttemptImmediate
                  ? await sendWhatsApp(
                    order.doctors.phone,
                    doctorMessage,
                    storageUrl,
                    order.patient_name,
                  )
                  : false;

                if (sent) {
                  await supabaseClient
                    .from("reports")
                    .update({
                      doctor_informed_at: new Date().toISOString(),
                      doctor_informed_via: "whatsapp",
                    })
                    .eq("id", reportIdForNotif);
                  console.log(
                    "✅ WhatsApp sent to doctor:",
                    order.doctors.phone,
                  );
                } else {
                  // Queue for retry
                  const shouldQueue = statusMatches || shouldQueueOutsideWindow;
                  if (shouldQueue) {
                    await supabaseClient
                      .from("notification_queue")
                      .insert({
                        lab_id: job.lab_id,
                        recipient_type: "doctor",
                        recipient_phone: order.doctors.phone,
                        recipient_name: order.doctors.name,
                        recipient_id: order.doctors.id,
                        trigger_type: "report_ready",
                        order_id: orderId,
                        report_id: reportIdForNotif,
                        message_content: doctorMessage,
                        attachment_url: storageUrl,
                        attachment_type: "report",
                        status: "pending",
                        scheduled_for: deferredScheduledFor,
                        last_error: !statusMatches
                          ? `Waiting for report status ${notifSettings.send_report_on_status || "Completed"}`
                          : (withinWindow ? "Initial send failed" : "Outside send window"),
                      });
                    console.log("📥 Doctor notification queued for retry");
                  } else {
                    console.log(
                      "⏭️ Skipping doctor notification: outside send window and queue disabled",
                    );
                  }
                }
              }
            }
          } else {
            console.log("📲 Auto-send not enabled for this lab");
          }
        } catch (waError) {
          console.error("⚠️ WhatsApp notification error (non-fatal):", waError);
          // Don't fail the PDF generation if notifications fail
        }
      }
      // ====== END WHATSAPP NOTIFICATIONS ======

      console.log(
        "═══════════════════════════════════════════════════════════",
      );
      console.log("✅ PDF GENERATION COMPLETE");
      console.log("eCopy URL:", storageUrl);
      console.log("Print URL:", printStorageUrl || "Not generated");
      console.log("Job ID:", job.id);
      console.log(
        "═══════════════════════════════════════════════════════════",
      );

      return new Response(
        JSON.stringify({
          success: true,
          status: "completed",
          pdfUrl: storageUrl,
          printPdfUrl: printStorageUrl,
          storagePath: eCopyResult.path,
          jobId: job.id,
          orderId,
          reportType: "final",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      console.error(
        "═══════════════════════════════════════════════════════════",
      );
      console.error("❌ PDF GENERATION ERROR:", error);
      console.error(
        "═══════════════════════════════════════════════════════════",
      );

      return new Response(
        JSON.stringify({
          error: "PDF generation failed",
          details: String(error),
          message: error instanceof Error ? error.message : "Unknown error",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
  } catch (topError) {
    // Top-level error handler - ensures CORS headers are ALWAYS returned
    console.error("❌ TOP-LEVEL ERROR (before main logic):", topError);
    return new Response(
      JSON.stringify({
        error: "Request processing failed",
        details: String(topError),
        message: topError instanceof Error ? topError.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

// ============================================================
// SECTION: Helper Functions
// ============================================================

async function updateProgress(
  supabase: any,
  jobId: string,
  stage: string,
  percent: number,
) {
  await supabase
    .from("pdf_generation_queue")
    .update({ progress_stage: stage, progress_percent: percent })
    .eq("id", jobId);
}

async function failJob(supabase: any, jobId: string, errorMessage: string) {
  await supabase
    .from("pdf_generation_queue")
    .update({
      status: "failed",
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

/**
 * Helper function to group analytes by test_group_id
 * If analytes don't have test_group_id but contextTestGroupIds is provided,
 * distribute analytes across groups based on position or test name matching
 */
function groupAnalytesByTestGroup(
  analytes: any[],
  contextTestGroupIds: string[] = [],
): Map<string, any[]> {
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
    console.log(
      `⚠️ ${ungroupedAnalytes.length} analytes without test_group_id, attempting to match with ${contextTestGroupIds.length} context groups`,
    );

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
        if (!grouped.has("ungrouped")) {
          grouped.set("ungrouped", []);
        }
        grouped.get("ungrouped")!.push(analyte);
      }
    }
  } else if (ungroupedAnalytes.length > 0) {
    // No context groups, put all ungrouped in one bucket
    grouped.set("ungrouped", ungroupedAnalytes);
  }

  return grouped;
}
