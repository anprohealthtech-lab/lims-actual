// Supabase Edge Function: AI Result Intelligence
// Deno port of netlify/functions/ai-result-intelligence.ts
// Handles: patient_summary, clinical_summary, delta_check, verifier_summary,
//          generate_interpretations, analyze_result_values

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_MODEL = "gemini-2.5-flash";

// ── Types ────────────────────────────────────────────────────────────────────

interface AnalyteData {
  id: string;
  name: string;
  unit: string;
  reference_range: string;
  interpretation_low?: string | null;
  interpretation_normal?: string | null;
  interpretation_high?: string | null;
}

interface ResultValue {
  id?: string;
  analyte_id?: string;
  analyte_name: string;
  value: string;
  unit: string;
  reference_range: string;
  flag: string | null;
  interpretation?: string | null;
  ai_suggested_flag?: string | null;
  ai_suggested_interpretation?: string | null;
  trend_interpretation?: string | null;
  historical_values?: Array<{
    date: string;
    value: string;
    flag?: string | null;
    source: "internal" | "external";
    lab_name?: string;
  }>;
}

interface TestGroupContext {
  test_group_name: string;
  test_group_code: string;
  category?: string;
  clinical_purpose?: string;
}

interface PatientContext {
  age?: number;
  gender?: string;
  clinical_notes?: string;
}

interface GenerateInterpretationsRequest {
  action: "generate_interpretations";
  analytes: AnalyteData[];
  test_group: TestGroupContext;
}

interface VerifierSummaryRequest {
  action: "verifier_summary";
  test_group: TestGroupContext;
  result_values: ResultValue[];
  patient?: PatientContext;
}

interface ClinicalSummaryRequest {
  action: "clinical_summary";
  test_groups: Array<{
    name: string;
    category: string;
    result_values: ResultValue[];
  }>;
  patient?: PatientContext;
}

interface AnalyzeResultValuesRequest {
  action: "analyze_result_values";
  result_values: ResultValue[];
  patient?: PatientContext;
  trend_data?: unknown;
}

type SupportedLanguage =
  | "english"
  | "hindi"
  | "marathi"
  | "gujarati"
  | "tamil"
  | "telugu"
  | "kannada"
  | "bengali"
  | "punjabi"
  | "malayalam"
  | "odia"
  | "assamese";

interface PatientSummaryRequest {
  action: "patient_summary";
  test_groups: Array<{
    name: string;
    category: string;
    result_values: ResultValue[];
  }>;
  language: SupportedLanguage;
  referring_doctor_name?: string;
  patient?: PatientContext;
}

interface DeltaCheckRequest {
  action: "delta_check";
  test_group: TestGroupContext;
  result_values: ResultValue[];
  patient?: PatientContext;
  related_test_results?: Array<{
    test_name: string;
    analyte_name: string;
    value: string;
    unit: string;
    flag?: string | null;
  }>;
}

type AIRequest =
  | GenerateInterpretationsRequest
  | VerifierSummaryRequest
  | ClinicalSummaryRequest
  | AnalyzeResultValuesRequest
  | PatientSummaryRequest
  | DeltaCheckRequest;

// ── Flag helpers ─────────────────────────────────────────────────────────────

function isAbnormalFlag(flag: string | null | undefined): boolean {
  if (!flag) return false;
  const n = flag.toLowerCase().trim();
  return [
    "h", "l", "c",
    "high", "low", "critical", "abnormal",
    "critical_high", "critical_low",
    "critical_h", "critical_l",
    "h*", "l*", "c*",
  ].includes(n);
}

function isNormalFlag(flag: string | null | undefined): boolean {
  if (!flag) return true;
  return ["n", "normal", ""].includes(flag.toLowerCase().trim());
}

// ── Prompt builders (identical logic to the Netlify function) ────────────────

function buildInterpretationsPrompt(req: GenerateInterpretationsRequest): string {
  const { analytes, test_group } = req;
  return `You are a clinical laboratory scientist generating standardized interpretation text for laboratory analytes.

Context:
- Test Group: ${test_group.test_group_name} (${test_group.test_group_code})
- Category: ${test_group.category || "General"}
- Clinical Purpose: ${test_group.clinical_purpose || "Not specified"}

For each analyte below, generate clinical interpretations for LOW, NORMAL, and HIGH values.
The interpretations should be:
- Professional medical language suitable for lab reports
- Concise but clinically informative (1-2 sentences each)
- Describe clinical significance and potential implications
- Use standard medical terminology

Analytes requiring interpretations:
${
    analytes.map((a, i) => `
${i + 1}. ${a.name}
   - Unit: ${a.unit}
   - Reference Range: ${a.reference_range}
   - Current interpretation_low: ${a.interpretation_low || "MISSING"}
   - Current interpretation_normal: ${a.interpretation_normal || "MISSING"}
   - Current interpretation_high: ${a.interpretation_high || "MISSING"}
`).join("\n")
  }

Respond with a JSON object with this exact structure:
{
  "interpretations": [
    {
      "analyte_id": "id from input",
      "analyte_name": "name",
      "interpretation_low": "Clinical text for low values...",
      "interpretation_normal": "Clinical text for normal values...",
      "interpretation_high": "Clinical text for high values..."
    }
  ]
}

Only generate interpretations for fields marked as MISSING. Keep existing interpretations unchanged.
Return ONLY the JSON object, no additional text.`;
}

function buildVerifierSummaryPrompt(req: VerifierSummaryRequest): string {
  const { test_group, result_values, patient } = req;
  const flaggedResults = result_values.filter((r) => isAbnormalFlag(r.flag));
  const criticalResults = result_values.filter((r) => {
    const f = (r.flag || "").toLowerCase();
    return ["c", "critical", "critical_h", "critical_l", "critical_high", "critical_low"].includes(f);
  });
  const getFlagDisplay = (flag: string | null | undefined): string => {
    if (!flag) return "";
    const f = flag.toLowerCase();
    if (f === "h" || f === "high" || f === "critical_h") return " [HIGH]";
    if (f === "l" || f === "low" || f === "critical_l") return " [LOW]";
    if (["c", "critical", "critical_high", "critical_low"].includes(f)) return " [CRITICAL]";
    if (isAbnormalFlag(flag)) return ` [${flag.toUpperCase()}]`;
    return "";
  };
  return `You are a senior clinical laboratory scientist reviewing test results before approval.

Test Group: ${test_group.test_group_name} (${test_group.test_group_code})
Category: ${test_group.category || "General"}
${patient?.age ? `Patient Age: ${patient.age}` : ""}
${patient?.gender ? `Patient Gender: ${patient.gender}` : ""}
${patient?.clinical_notes ? `Clinical Notes: ${patient.clinical_notes}` : ""}

Results to Review:
${result_values.map((r) => `- ${r.analyte_name}: ${r.value} ${r.unit} (Ref: ${r.reference_range})${getFlagDisplay(r.flag)}`).join("\n")}

Summary Statistics:
- Total analytes: ${result_values.length}
- Flagged results: ${flaggedResults.length}
- Critical values: ${criticalResults.length}

Generate a concise verifier summary that includes:
1. Overall assessment (1 sentence)
2. Key abnormal findings requiring attention
3. Any critical values that need immediate action
4. Recommendation (approve/needs clarification/reject)

Respond with a JSON object:
{
  "overall_assessment": "Brief overall assessment...",
  "abnormal_findings": ["Finding 1...", "Finding 2..."],
  "critical_alerts": ["Critical alert if any..."],
  "recommendation": "approve|needs_clarification|reject",
  "recommendation_reason": "Brief reason for recommendation...",
  "verifier_notes": "Optional notes for the record..."
}

Return ONLY the JSON object, no additional text.`;
}

function buildClinicalSummaryPrompt(req: ClinicalSummaryRequest): string {
  const { test_groups, patient } = req;
  const allResults = test_groups.flatMap((tg) =>
    tg.result_values.map((r) => ({ ...r, test_group: tg.name }))
  );
  const abnormalResults = allResults.filter((r) => isAbnormalFlag(r.flag));
  const normalResults = allResults.filter((r) => isNormalFlag(r.flag));
  const resultsWithHistory = allResults.filter((r) => r.historical_values && r.historical_values.length > 0);

  const formatHistory = (r: ResultValue): string => {
    if (!r.historical_values || r.historical_values.length === 0) return "";
    const history = r.historical_values
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5)
      .map((h) => `${h.date}: ${h.value}${h.flag ? ` [${h.flag}]` : ""} (${h.source}${h.lab_name ? ` - ${h.lab_name}` : ""})`);
    return `\n      Historical: ${history.join(" → ")}`;
  };

  const patientInfo = [
    patient?.age ? `Patient Age: ${patient.age} years` : "",
    patient?.gender ? `Patient Gender: ${patient.gender}` : "",
    patient?.clinical_notes ? `Clinical History: ${patient.clinical_notes}` : "",
  ].filter(Boolean).join("\n");

  const testResultsSection = test_groups.map((tg) => {
    const results = tg.result_values.map((r) => {
      const abnormal = isAbnormalFlag(r.flag);
      const fl = (r.flag || "").toString().toLowerCase();
      let flagDisplay = " [NORMAL]";
      if (abnormal) {
        if (fl === "h" || fl === "high" || fl === "critical_h") flagDisplay = " [HIGH ↑]";
        else if (fl === "l" || fl === "low" || fl === "critical_l") flagDisplay = " [LOW ↓]";
        else if (["c", "critical", "critical_high", "critical_low"].includes(fl)) flagDisplay = " [CRITICAL ⚠️]";
        else flagDisplay = ` [ABNORMAL - ${r.flag}]`;
      }
      return `  - ${r.analyte_name}: ${r.value} ${r.unit} (Ref: ${r.reference_range})${flagDisplay}${formatHistory(r)}`;
    }).join("\n");
    return `**${tg.name}** (${tg.category})\n${results}`;
  }).join("\n\n");

  const abnormalFindingsForPrompt = abnormalResults.length > 0
    ? `\n\n⚠️ ACTUAL ABNORMAL FINDINGS (only these ${abnormalResults.length} results are abnormal based on flags):\n${abnormalResults.map((r) => `- ${r.analyte_name}: ${r.value} ${r.unit} (Ref: ${r.reference_range}) [FLAG: ${r.flag}]`).join("\n")}`
    : "\n\n✅ ALL RESULTS ARE NORMAL - No abnormal findings based on flags.";

  const historyNote = resultsWithHistory.length > 0
    ? `\nIMPORTANT: Historical data is available for ${resultsWithHistory.length} parameter(s). Analyze these trends to identify improving or worsening patterns.\n`
    : "";

  return `You are a clinical pathologist generating a concise summary report for a referring physician.

FLAG RULES (authoritative):
- flag H/high = abnormal high | flag L/low = abnormal low | flag C/critical = critical | flag N/null = normal
- Do NOT re-evaluate numeric flags.
- EXCEPTION — qualitative results (text values, no flag): use your clinical knowledge of the analyte to determine normality. Example: HIV "Reactive" = abnormal; HBsAg "Reactive" = abnormal; Platelets "Detected" = normal (expected). Judge by what a normal result for that specific analyte should be.

${patientInfo}

Test Results:
${testResultsSection}
${abnormalFindingsForPrompt}
${historyNote}
Respond with a JSON object:
{
  "executive_summary": "1-2 sentence overview",
  "significant_findings": [
    { "finding": "string", "clinical_significance": "string", "test_group": "string", "trend": "improving|worsening|stable|new_finding" }
  ],
  "trend_analysis": "string or null",
  "suggested_followup": ["string"],
  "urgent_findings": ["string"],
  "clinical_interpretation": "string"
}

Return ONLY the JSON object, no additional text.`;
}

function buildAnalyzeResultValuesPrompt(req: AnalyzeResultValuesRequest): string {
  const { result_values, patient } = req;
  return `You are an AI assistant helping laboratory technicians by suggesting flags and interpretations for test result values.

${patient?.age ? `Patient Age: ${patient.age} years` : ""}
${patient?.gender ? `Patient Gender: ${patient.gender}` : ""}
${patient?.clinical_notes ? `Clinical Notes: ${patient.clinical_notes}` : ""}

For each result value below, analyze and provide:
1. **Suggested Flag**: Based on reference range comparison (L=Low, H=High, C=Critical, N=Normal)
2. **Value Interpretation**: Clinical interpretation of THIS specific result value (2-3 sentences)
3. **Trend Interpretation**: If historical data is provided, comment on the trend (improving/worsening/stable)

Result Values to Analyze:
${
    result_values.map((rv, i) => `
${i + 1}. ID: "${rv.id || "unknown"}"
   Analyte: ${rv.analyte_name}
   Current Value: ${rv.value} ${rv.unit}
   Reference Range: ${rv.reference_range}
   ${rv.historical_values ? `Historical Values: ${rv.historical_values.map((h) => `${h.date}: ${h.value}${h.flag ? ` (${h.flag})` : ""}`).join(", ")}` : "No historical data"}
`).join("\n")
  }

IMPORTANT: You MUST include the exact "id" value from the input in your response for each result.

Respond with a JSON array:
[
  {
    "id": "exact id from input - REQUIRED",
    "analyte_name": "name",
    "ai_suggested_flag": "L|H|C|N",
    "ai_suggested_interpretation": "Clinical interpretation of this specific value...",
    "trend_interpretation": "Trend analysis if historical data provided, otherwise null"
  }
]

Return ONLY the JSON array, no additional text.`;
}

function buildPatientSummaryPrompt(req: PatientSummaryRequest): string {
  const { test_groups, language, referring_doctor_name, patient } = req;
  const allResults = test_groups.flatMap((tg) =>
    tg.result_values.map((r) => ({ ...r, test_group: tg.name }))
  );
  const abnormalResults = allResults.filter((r) => isAbnormalFlag(r.flag));
  const normalResults = allResults.filter((r) => isNormalFlag(r.flag));
  const resultsWithHistory = allResults.filter((r) => r.historical_values && r.historical_values.length > 0);

  const formatHistory = (r: ResultValue): string => {
    if (!r.historical_values || r.historical_values.length === 0) return "";
    const history = r.historical_values
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 3)
      .map((h) => `${h.date}: ${h.value}`);
    return ` (Previous: ${history.join(" → ")})`;
  };

  const languageNames: Record<SupportedLanguage, string> = {
    english: "English",
    hindi: "Hindi (हिन्दी)",
    marathi: "Marathi (मराठी)",
    gujarati: "Gujarati (ગુજરાતી)",
    tamil: "Tamil (தமிழ்)",
    telugu: "Telugu (తెలుగు)",
    kannada: "Kannada (ಕನ್ನಡ)",
    bengali: "Bengali (বাংলা)",
    punjabi: "Punjabi (ਪੰਜਾਬੀ)",
    malayalam: "Malayalam (മലയാളം)",
    odia: "Odia (ଓଡ଼ିଆ)",
    assamese: "Assamese (অসমীয়া)",
  };

  const targetLanguage = languageNames[language] || "English";
  const doctorName = referring_doctor_name || "your doctor";
  const patientInfo = [
    patient?.age ? `Age: ${patient.age} years` : "Age: Not specified",
    patient?.gender ? `Gender: ${patient.gender}` : "Gender: Not specified",
  ].join("\n");

  const testResultsSection = test_groups.map((tg) => {
    const results = tg.result_values.map((r) => {
      const abnormal = isAbnormalFlag(r.flag);
      const fl = (r.flag || "").toString().toLowerCase();
      let flagDisplay = " [NORMAL ✓]";
      if (abnormal) {
        if (fl === "h" || fl === "high" || fl === "critical_h") flagDisplay = " [HIGH ↑ ABNORMAL]";
        else if (fl === "l" || fl === "low" || fl === "critical_l") flagDisplay = " [LOW ↓ ABNORMAL]";
        else if (["c", "critical", "critical_high", "critical_low"].includes(fl)) flagDisplay = " [CRITICAL ⚠️]";
        else flagDisplay = ` [ABNORMAL - ${r.flag}]`;
      }
      return `  - ${r.analyte_name}: ${r.value} ${r.unit} (Ref: ${r.reference_range})${flagDisplay}${formatHistory(r)}`;
    }).join("\n");
    return `**${tg.name}**\n${results}`;
  }).join("\n\n");

  const abnormalFindingsForPrompt = abnormalResults.length > 0
    ? `\n\n⚠️ ACTUAL ABNORMAL FINDINGS TO EXPLAIN (only these ${abnormalResults.length} results are abnormal):\n${abnormalResults.map((r) => `- ${r.analyte_name}: ${r.value} ${r.unit} [FLAG: ${r.flag}]`).join("\n")}`
    : "\n\n✅ ALL RESULTS ARE NORMAL - No abnormal findings to report.";

  const historyNote = resultsWithHistory.length > 0
    ? `\nHISTORICAL TREND DATA AVAILABLE:\n${resultsWithHistory.length} test(s) have previous results from past visits.\n`
    : "";

  return `You are a healthcare communicator creating a simple, reassuring summary of lab results for a patient.

LANGUAGE: Write in ${targetLanguage}. Keep medical terms (CBC, Hemoglobin, HIV, HBsAg, etc.) in English.

FLAG RULES (authoritative):
- flag H/high = abnormal high | flag L/low = abnormal low | flag C/critical = critical | flag N/null = normal
- Do NOT re-evaluate numeric flags.
- EXCEPTION — qualitative results (text values, no flag): use your clinical knowledge of the analyte to determine normality. Example: HIV "Reactive" = abnormal; HBsAg "Reactive" = abnormal; Platelets "Detected" = normal (expected). Judge by what a normal result for that specific analyte should be.

Patient Information:
${patientInfo}

Test Results:
${testResultsSection}
${abnormalFindingsForPrompt}
${historyNote}
Respond with a JSON object (text in ${targetLanguage}, medical terms in English):
{
  "health_status": "1-2 sentence overall status",
  "normal_findings_detailed": [
    { "test_name": "English term", "value": "value+unit", "what_it_measures": "1 sentence", "your_result_means": "1 sentence" }
  ],
  "abnormal_findings": [
    { "test_name": "English term", "value": "value+unit", "status": "high|low|critical|abnormal", "what_it_measures": "1 sentence", "explanation": "1-2 sentences", "what_to_do": "1 sentence", "trend": "improving|worsening|stable|new" }
  ],
  "needs_consultation": ${abnormalResults.length > 0 ? "true" : "false"},
  "consultation_recommendation": "1 sentence",
  "health_tips": ["tip1", "tip2", "tip3"],
  "summary_message": "1-2 sentence warm closing",
  "language": "${language}"
}

Return ONLY the JSON object, no additional text.`;
}

function buildDeltaCheckPrompt(req: DeltaCheckRequest): string {
  const { test_group, result_values, patient, related_test_results } = req;

  const formatHistory = (r: ResultValue): string => {
    if (!r.historical_values || r.historical_values.length === 0) return "No historical data";
    return r.historical_values
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5)
      .map((h) => `${h.date}: ${h.value}${h.flag ? ` [${h.flag}]` : ""} (${h.source}${h.lab_name ? ` - ${h.lab_name}` : ""})`)
      .join(" → ");
  };

  const calculateDelta = (current: string, historical: ResultValue["historical_values"]): string => {
    if (!historical || historical.length === 0) return "N/A";
    const cur = parseFloat(current);
    const last = parseFloat(historical[0].value);
    if (isNaN(cur) || isNaN(last) || last === 0) return "N/A";
    return `${((cur - last) / last * 100).toFixed(1)}%`;
  };

  const patientInfo = [
    patient?.age ? `Age: ${patient.age} years` : "",
    patient?.gender ? `Gender: ${patient.gender}` : "",
    patient?.clinical_notes ? `Clinical Notes: ${patient.clinical_notes}` : "",
  ].filter(Boolean).join("\n");

  const resultsSection = result_values.map((r, i) => {
    const delta = r.historical_values ? calculateDelta(r.value, r.historical_values) : "N/A";
    return `
${i + 1}. ${r.analyte_name}
   Current Value: ${r.value} ${r.unit} ${r.flag ? `[${r.flag}]` : ""}
   Reference Range: ${r.reference_range}
   Historical: ${formatHistory(r)}
   Delta from last: ${delta}`;
  }).join("\n");

  const relatedTestsSection = related_test_results && related_test_results.length > 0
    ? `\nRelated Tests from Same Order (for cross-validation):\n${related_test_results.map((r) => `  - ${r.test_name} > ${r.analyte_name}: ${r.value} ${r.unit}${r.flag ? ` [${r.flag}]` : ""}`).join("\n")}`
    : "";

  // WBC differential check
  const differentialPatterns: Record<string, RegExp[]> = {
    neutrophils: [/\bneutrophils?\b/i, /\bneut\b/i, /\bpoly\b/i],
    lymphocytes: [/\blymphocytes?\b/i, /\blymph\b/i],
    monocytes: [/\bmonocytes?\b/i, /\bmono\b/i],
    eosinophils: [/\beosinophils?\b/i, /\beos\b/i],
    basophils: [/\bbasophils?\b/i, /\bbaso\b/i],
  };
  const findPct = (patterns: RegExp[]): number | null => {
    const row = result_values.find((r) => patterns.some((p) => p.test(r.analyte_name || "")));
    if (!row) return null;
    const v = parseFloat(String(row.value || "").replace("%", "").trim());
    return Number.isFinite(v) ? v : null;
  };
  const neutPct = findPct(differentialPatterns.neutrophils);
  const lymphPct = findPct(differentialPatterns.lymphocytes);
  const monoPct = findPct(differentialPatterns.monocytes);
  const eosPct = findPct(differentialPatterns.eosinophils);
  const basoPct = findPct(differentialPatterns.basophils);
  const diffValues = [neutPct, lymphPct, monoPct, eosPct, basoPct].filter((v): v is number => v !== null);
  const differentialSection = diffValues.length >= 3
    ? `\nCBC/WBC DIFFERENTIAL CHECK:\n- Neutrophils%: ${neutPct ?? "NA"}\n- Lymphocytes%: ${lymphPct ?? "NA"}\n- Monocytes%: ${monoPct ?? "NA"}\n- Eosinophils%: ${eosPct ?? "NA"}\n- Basophils%: ${basoPct ?? "NA"}\n- Calculated Differential Total: ${diffValues.reduce((s, v) => s + v, 0).toFixed(1)}%\n`
    : "";

  return `You are a senior clinical laboratory quality control specialist performing a DELTA CHECK on laboratory results.

DELTA CHECK PURPOSE:
A delta check compares current patient results with their historical values and related tests to identify:
1. POTENTIAL INPUT ERRORS - Unlikely changes that suggest data entry mistakes
2. SAMPLE ISSUES - Results suggesting sample contamination, hemolysis, lipemia, or wrong patient sample
3. CONFLICTING RESULTS - Inconsistent findings between related tests
4. UNUSUAL CHANGES - Dramatic shifts from historical values that need verification
5. QUALITY CONCERNS - Any other issues affecting result reliability

Test Group: ${test_group.test_group_name} (${test_group.test_group_code})
Category: ${test_group.category || "General"}
${patientInfo}

CURRENT RESULTS WITH HISTORICAL DATA:
${resultsSection}
${relatedTestsSection}
${differentialSection}

DELTA CHECK RULES:
1. For numeric values, flag changes > 50% from last value as unusual (unless clinically expected)
2. Check for physiologically impossible values
3. Identify results that contradict each other
4. Flag critical values that appeared suddenly without prior warning
5. Look for patterns suggesting sample issues (hemolysis, lipemia, icterus)
6. Cross-validate related tests (liver panel, renal panel, CBC differential must total ~100%)

CONFIDENCE SCORING:
- 90-100: All results pass delta checks, no concerns
- 70-89: Minor issues or missing historical data, generally acceptable
- 50-69: Moderate concerns requiring review
- 0-49: Significant issues, results should not be released without investigation

Respond with a JSON object:
{
  "confidence_score": 85,
  "confidence_level": "high|medium|low",
  "summary": "Brief 1-2 sentence summary of delta check findings...",
  "issues": [
    {
      "issue_type": "input_error|sample_issue|conflicting_result|unusual_change|quality_concern",
      "severity": "critical|warning|info",
      "affected_analytes": ["Analyte1", "Analyte2"],
      "description": "Clear description of the issue...",
      "suggested_action": "What the technician should do...",
      "evidence": "Data supporting this concern..."
    }
  ],
  "validated_results": ["List of analytes that passed all checks"],
  "recommendation": "approve|review_required|reject",
  "verifier_notes": "Detailed notes for the verifier..."
}

If no issues are found, return an empty issues array and high confidence.
Return ONLY the JSON object, no additional text.`;
}

// ── Gemini caller ─────────────────────────────────────────────────────────────

function extractJsonFromResponse(response: unknown): unknown {
  const r = response as Record<string, unknown>;
  if (r?.candidates && Array.isArray(r.candidates)) {
    for (const candidate of r.candidates as unknown[]) {
      const c = candidate as Record<string, unknown>;
      const parts = (c?.content as Record<string, unknown>)?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts as unknown[]) {
          const text = ((part as Record<string, unknown>)?.text as string || "").trim();
          if (!text) continue;
          try {
            return JSON.parse(text);
          } catch {
            const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (fenced) return JSON.parse(fenced[1].trim());
            const obj = text.match(/\{[\s\S]*\}/);
            if (obj) return JSON.parse(obj[0]);
            const arr = text.match(/\[[\s\S]*\]/);
            if (arr) return JSON.parse(arr[0]);
          }
        }
      }
    }
  }
  throw new Error("Could not extract JSON from Gemini response");
}

async function callGemini(prompt: string, apiKey: string, maxRetries = 4): Promise<unknown> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delayMs = Math.min(1000 * Math.pow(2, attempt), 10000) + Math.random() * 1000;
      console.warn(`⏳ Gemini retry ${attempt}/${maxRetries - 1} after ${Math.round(delayMs)}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            topP: 0.9,
            maxOutputTokens: 65536,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (response.ok) {
      const data = await response.json();
      return extractJsonFromResponse(data);
    }

    if (response.status === 429 || response.status === 503) {
      const errorText = await response.text();
      lastError = new Error(`Gemini API error: ${response.status} - ${errorText}`);
      console.warn(`Gemini rate limited (attempt ${attempt + 1}/${maxRetries}), retrying...`);
      continue;
    }

    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  throw lastError || new Error("Gemini API request failed after retries");
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const apiKey = Deno.env.get("ALLGOOGLE_KEY") || Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Gemini API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body: AIRequest = await req.json();

    if (!body.action) {
      return new Response(
        JSON.stringify({ error: "action is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let prompt: string;
    let result: unknown;

    switch (body.action) {
      case "generate_interpretations":
        if (!body.analytes || !body.test_group) {
          return new Response(
            JSON.stringify({ error: "analytes and test_group are required for generate_interpretations" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        prompt = buildInterpretationsPrompt(body as GenerateInterpretationsRequest);
        result = await callGemini(prompt, apiKey);
        break;

      case "verifier_summary":
        if (!body.test_group || !body.result_values) {
          return new Response(
            JSON.stringify({ error: "test_group and result_values are required for verifier_summary" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        prompt = buildVerifierSummaryPrompt(body as VerifierSummaryRequest);
        result = await callGemini(prompt, apiKey);
        break;

      case "clinical_summary":
        if (!body.test_groups) {
          return new Response(
            JSON.stringify({ error: "test_groups are required for clinical_summary" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        prompt = buildClinicalSummaryPrompt(body as ClinicalSummaryRequest);
        result = await callGemini(prompt, apiKey);
        break;

      case "analyze_result_values":
        if (!body.result_values) {
          return new Response(
            JSON.stringify({ error: "result_values are required for analyze_result_values" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        prompt = buildAnalyzeResultValuesPrompt(body as AnalyzeResultValuesRequest);
        result = await callGemini(prompt, apiKey);
        break;

      case "patient_summary":
        if (!body.test_groups || !body.language) {
          return new Response(
            JSON.stringify({ error: "test_groups and language are required for patient_summary" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        prompt = buildPatientSummaryPrompt(body as PatientSummaryRequest);
        result = await callGemini(prompt, apiKey);
        break;

      case "delta_check":
        if (!body.test_group || !body.result_values) {
          return new Response(
            JSON.stringify({ error: "test_group and result_values are required for delta_check" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        prompt = buildDeltaCheckPrompt(body as DeltaCheckRequest);
        result = await callGemini(prompt, apiKey);
        break;

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${(body as Record<string, unknown>).action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("AI Result Intelligence error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to process AI request",
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
