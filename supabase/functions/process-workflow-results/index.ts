import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("ALLGOOGLE_KEY") ?? Deno.env.get("GEMINI_API_KEY") ?? "";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("process-workflow-results: missing Supabase configuration");
}

type ProcessingStatus = "pending" | "processing" | "completed" | "failed";

interface WorkflowAIRequest {
  workflow_instance_id: string;
  order_id?: string;
  force?: boolean;
  analyteCatalog?: IncomingAnalyteCatalogEntry[];
  analytesToExtract?: string[];
  order_test_id?: string | null;
  order_test_group_id?: string | null;
  lab_id?: string | null;
  test_group_id?: string | null;
}

interface WorkflowInstance {
  id: string;
  order_id: string;
  lab_id?: string | null;
  workflow_versions?: {
    workflow_id?: string;
    test_group_id?: string | null;
  } | null;
  workflows?: {
    name?: string | null;
  } | null;
}

interface WorkflowAIRecord {
  id: string;
  workflow_instance_id: string;
  processing_status: ProcessingStatus;
  retry_count: number | null;
}

interface IncomingAnalyteCatalogEntry {
  id?: string | null;
  name?: string | null;
  unit?: string | null;
  reference_range?: string | null;
  code?: string | null;
}

interface NormalizedAnalyteEntry {
  id: string | null;
  name: string;
  unit?: string | null;
  reference_range?: string | null;
  code?: string | null;
}

interface OrderContext {
  id: string;
  patient_id: string;
  patient_name: string;
  lab_id: string | null;
  sample_id: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: "Service misconfigured" }, 500);
  }

  let recordId: string | null = null;
  let currentRetryCount: number | null = null;
  try {
    const requestBody = (await req.json()) as WorkflowAIRequest;
    const {
      workflow_instance_id,
      order_id,
      force = false,
      analyteCatalog: requestAnalyteCatalog,
      analytesToExtract,
      order_test_id: orderTestId,
      order_test_group_id: orderTestGroupId,
      lab_id: overrideLabId,
      test_group_id: overrideTestGroupId,
    } = requestBody;

    if (!workflow_instance_id) {
      return json({ error: "workflow_instance_id is required" }, 400);
    }

    const instance = await fetchWorkflowInstance(workflow_instance_id);
    if (!instance) {
      return json({ error: "Workflow instance not found" }, 404);
    }

    const targetOrderId = order_id ?? instance.order_id;
    if (!targetOrderId) {
      return json({ error: "order_id missing on workflow instance" }, 400);
    }

    const existingRecord = await fetchWorkflowAIRecord(workflow_instance_id);
    if (existingRecord && existingRecord.processing_status === "completed" && !force) {
      return json({ success: true, message: "Already processed", record_id: existingRecord.id });
    }

    // Note: survey_data not available in order_workflow_instances, would need to fetch from workflow_step_events
    const workflowData = {} as Record<string, unknown>;
    if (Array.isArray(requestAnalyteCatalog)) {
      workflowData.__analyte_catalog = requestAnalyteCatalog;
    }
    if (Array.isArray(analytesToExtract)) {
      workflowData.__analytes_to_extract = analytesToExtract;
    }
    const imageAttachments = extractImageAttachments(workflowData);
    const referenceImages: unknown[] = []; // reference_images not available in order_workflow_instances

    const upsertedRecord = await upsertWorkflowAIRecord(existingRecord, {
      workflow_instance_id,
      order_id: targetOrderId,
      test_group_id: overrideTestGroupId ?? instance.workflow_versions?.test_group_id ?? null,
      lab_id: overrideLabId ?? instance.lab_id ?? null,
      workflow_data: workflowData,
      image_attachments: imageAttachments,
      reference_images: referenceImages,
    });

    recordId = upsertedRecord.id;
    const retryCount = existingRecord ? (existingRecord.retry_count ?? 0) + (force ? 1 : 0) : 0;
    currentRetryCount = retryCount;

    await updateWorkflowAIRecord(recordId, {
      processing_status: "processing",
      processing_started_at: new Date().toISOString(),
      processing_completed_at: null,
      error_message: null,
      retry_count: retryCount,
    });

    const testGroupId = overrideTestGroupId ?? instance.workflow_versions?.test_group_id ?? null;
    const analyteIds = await resolveAnalyteIds(instance, testGroupId);
    const workflowInstruction = buildWorkflowPrompt(instance, analyteIds, workflowData);
    const analytesRequested = Array.isArray(analytesToExtract)
      ? analytesToExtract.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
      : [];

    const orderContext = await fetchOrderContext(targetOrderId);

    const primaryAttachment = imageAttachments[0]?.attachment_id ?? null;
    let visionResult: Record<string, unknown> | null = null;

    if (primaryAttachment) {
      visionResult = await invokeFunction("vision-ocr", {
        attachmentId: primaryAttachment,
        batchId: instance.batch_id ?? null,
        orderId: targetOrderId,
        testGroupId,
        analyteIds: analyteIds.length ? analyteIds : undefined,
        referenceImages: referenceImages,
        customInstruction: workflowInstruction,
        imageAttachmentIds: imageAttachments.map((img) => img.attachment_id),
      });
    }

    const geminiPrompt = buildGeminiWorkflowPrompt({
      workflowInstruction,
      workflowData,
      visionResult,
      analyteCatalog: requestAnalyteCatalog ?? null,
      analytesRequested,
      analyteIds,
      orderContext,
    });

    const geminiResponseText = await callGemini(geminiPrompt);
    const geminiResult = normalizeGeminiResponse(geminiResponseText);

    const extractedValues = extractValuesFromGemini(geminiResult);
    const analyteCatalog = await buildAnalyteCatalogData({
      requestCatalog: requestAnalyteCatalog,
      analyteIds,
      extractedValues,
    });

    const geminiConfidence = extractGeminiConfidence(geminiResult);
    const labIdForPersistence = overrideLabId ?? instance.lab_id ?? orderContext.lab_id ?? null;
    if (!labIdForPersistence) {
      throw new Error(`Unable to determine lab context for workflow instance ${workflow_instance_id}`);
    }

    const persistenceSummary = await persistExtractedValues({
      orderId: targetOrderId,
      workflowInstanceId: workflow_instance_id,
      workflowName: instance.workflows?.name ?? null,
      testGroupId,
      orderTestId: orderTestId ?? null,
      orderTestGroupId: orderTestGroupId ?? null,
      analyteCatalog,
      extractedValues,
      attachmentId: primaryAttachment,
      aiConfidence: geminiConfidence,
      labId: labIdForPersistence,
      orderContext,
      analytesRequested,
    });

    await updateWorkflowAIRecord(recordId, {
      processing_status: "completed",
      processing_completed_at: new Date().toISOString(),
      extracted_values: extractedValues,
      ai_confidence: geminiConfidence,
      ai_metadata: {
        vision: visionResult,
        gemini: geminiResult,
        analyte_catalog_size: analyteCatalog.length,
        analytes_requested: analytesRequested,
        result_id: persistenceSummary.resultId,
        result_value_count: persistenceSummary.valueCount,
      },
      retry_count: currentRetryCount,
    });

    return json({
      success: true,
      record_id: recordId,
      extracted_values: extractedValues,
      result_id: persistenceSummary.resultId,
      result_value_count: persistenceSummary.valueCount,
    });
  } catch (error) {
    console.error("process-workflow-results error", error);
    if (recordId) {
      try {
        await updateWorkflowAIRecord(recordId, {
          processing_status: "failed",
          processing_completed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : String(error),
          retry_count: currentRetryCount,
        });
      } catch (updateError) {
        console.error("process-workflow-results: failed to persist error state", updateError);
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function extractImageAttachments(surveyData: Record<string, unknown>): Array<{
  question_id: string;
  attachment_id: string;
  label?: string;
  metadata?: Record<string, unknown> | null;
}> {
  const attachments: Array<{
    question_id: string;
    attachment_id: string;
    label?: string;
    metadata?: Record<string, unknown> | null;
  }> = [];

  for (const [questionId, answer] of Object.entries(surveyData)) {
    if (!answer) continue;

    if (Array.isArray(answer)) {
      answer.forEach((entry, idx) => {
        if (entry && typeof entry === "object" && "attachment_id" in entry && entry.attachment_id) {
          attachments.push({
            question_id: questionId,
            attachment_id: String(entry.attachment_id),
            label: typeof entry.label === "string" ? entry.label : `${questionId}_${idx + 1}`,
            metadata: typeof entry.metadata === "object" ? (entry.metadata as Record<string, unknown>) : null,
          });
        }
      });
      continue;
    }

    if (typeof answer === "object" && "attachment_id" in (answer as Record<string, unknown>)) {
      const obj = answer as Record<string, unknown>;
      if (typeof obj.attachment_id === "string" && obj.attachment_id.length) {
        attachments.push({
          question_id,
          attachment_id: obj.attachment_id,
          label: typeof obj.label === "string" ? obj.label : questionId,
          metadata: typeof obj.metadata === "object" ? (obj.metadata as Record<string, unknown>) : null,
        });
      }
    }
  }

  return attachments;
}

async function fetchWorkflowInstance(id: string): Promise<WorkflowInstance | null> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/order_workflow_instances`);
  url.searchParams.set("id", `eq.${id}`);
  url.searchParams.set(
    "select",
    [
      "id",
      "order_id",
      "lab_id",
      "workflow_versions(workflow_id,test_group_id)",
      "workflows(name)"
    ].join(",")
  );
  url.searchParams.set("limit", "1");

  const res = await fetch(url, { headers: baseHeaders() });
  if (!res.ok) {
    throw new Error(`Failed to load workflow instance: ${await res.text()}`);
  }

  const data = (await res.json()) as WorkflowInstance[];
  return data?.[0] ?? null;
}

async function fetchWorkflowAIRecord(workflowInstanceId: string): Promise<WorkflowAIRecord | null> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/workflow_ai_processing`);
  url.searchParams.set("workflow_instance_id", `eq.${workflowInstanceId}`);
  url.searchParams.set("select", "id,workflow_instance_id,processing_status,retry_count");
  url.searchParams.set("limit", "1");

  const res = await fetch(url, { headers: baseHeaders() });
  if (!res.ok) {
    throw new Error(`Failed to load workflow AI record: ${await res.text()}`);
  }

  const data = (await res.json()) as WorkflowAIRecord[];
  return data?.[0] ?? null;
}

async function upsertWorkflowAIRecord(
  existingRecord: WorkflowAIRecord | null,
  payload: {
  workflow_instance_id: string;
  order_id: string;
  test_group_id?: string | null;
  lab_id?: string | null;
  workflow_data: Record<string, unknown>;
  image_attachments: unknown[];
  reference_images: unknown[];
  }
): Promise<{ id: string }> {
  if (existingRecord) {
    await updateWorkflowAIRecord(existingRecord.id, {
      workflow_instance_id: payload.workflow_instance_id,
      order_id: payload.order_id,
      test_group_id: payload.test_group_id ?? null,
      lab_id: payload.lab_id ?? null,
      workflow_data: payload.workflow_data,
      image_attachments: payload.image_attachments,
      reference_images: payload.reference_images,
      processing_status: "pending",
      processing_started_at: null,
      processing_completed_at: null,
      error_message: null,
    });
    return { id: existingRecord.id };
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/workflow_ai_processing`, {
    method: "POST",
    headers: {
      ...baseHeaders(),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      workflow_instance_id: payload.workflow_instance_id,
      order_id: payload.order_id,
      test_group_id: payload.test_group_id ?? null,
      lab_id: payload.lab_id ?? null,
      workflow_data: payload.workflow_data,
      image_attachments: payload.image_attachments,
      reference_images: payload.reference_images,
      processing_status: "pending",
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to upsert workflow AI record: ${await res.text()}`);
  }

  const data = await res.json();
  return Array.isArray(data) && data[0]?.id ? data[0] : data;
}

async function updateWorkflowAIRecord(id: string, patch: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/workflow_ai_processing?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      ...baseHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      updated_at: new Date().toISOString(),
      ...patch,
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to update workflow AI record: ${await res.text()}`);
  }
}

async function resolveAnalyteIds(instance: WorkflowInstance, overrideTestGroupId?: string | null): Promise<string[]> {
  // Note: analyte_ids not available in order_workflow_instances, always fetch from test_group_analytes
  const testGroupId = overrideTestGroupId ?? instance.workflow_versions?.test_group_id;
  if (!testGroupId) return [];

  const url = new URL(`${SUPABASE_URL}/rest/v1/test_group_analytes`);
  url.searchParams.set("test_group_id", `eq.${testGroupId}`);
  url.searchParams.set("select", "analyte_id");

  const res = await fetch(url, { headers: baseHeaders() });
  if (!res.ok) {
    console.warn("process-workflow-results: unable to load test group analytes", await res.text());
    return [];
  }

  const rows = (await res.json()) as Array<{ analyte_id: string | null }>;
  return rows
    .map((row) => row.analyte_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

async function invokeFunction(path: string, payload: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
    method: "POST",
    headers: {
      ...baseHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_err) {
    data = text;
  }

  if (!res.ok || (data && typeof data === "object" && "error" in data)) {
    const errorMessage =
      data && typeof data === "object" && "error" in data
        ? (data.error as string)
        : text || `Function ${path} failed`;
    throw new Error(`Function ${path} failed: ${errorMessage}`);
  }

  return data;
}

async function callGemini(prompt: string): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error("Gemini API key not configured. Set ALLGOOGLE_KEY or GEMINI_API_KEY.");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const body = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      topK: 32,
      topP: 1,
      maxOutputTokens: 4096,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ],
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const json = await response.json();
  const parts = json?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts
        .map((part: { text?: string }) => (typeof part?.text === "string" ? part.text : ""))
        .join("")
        .trim()
    : "";

  if (!text) {
    throw new Error("No response text from Gemini");
  }

  return text;
}

function buildGeminiWorkflowPrompt(params: {
  workflowInstruction: string;
  workflowData: Record<string, unknown>;
  visionResult: Record<string, unknown> | null;
  analyteCatalog: IncomingAnalyteCatalogEntry[] | null | undefined;
  analytesRequested: string[];
  analyteIds: string[];
  orderContext: OrderContext;
}): string {
  const {
    workflowInstruction,
    workflowData,
    visionResult,
    analyteCatalog,
    analytesRequested,
    analyteIds,
    orderContext,
  } = params;

  const catalogNames = (analyteCatalog ?? [])
    .map((entry) => (entry?.name ?? "").trim())
    .filter((name) => name.length > 0);

  const focusLine = analytesRequested.length
    ? `Focus exclusively on these analytes: ${analytesRequested.join(", ")}.`
    : catalogNames.length
   ? `Prioritize analytes referenced in catalog: ${catalogNames.slice(0, 15).join(", ")}.
     ${catalogNames.length > 15 ? "(List truncated)" : ""}`
        .trim()
    : analyteIds.length
    ? `Target analyte IDs: ${analyteIds.join(", ")}.`
    : "Focus on clinically relevant analytes mentioned in the instruction.";

  const workflowSnippet = serializeForPrompt(workflowData, 1800);
  const visionSnippet = visionResult ? serializeForPrompt(visionResult, 1200) : null;
  const catalogSnippet = analyteCatalog ? serializeForPrompt(analyteCatalog, 1200) : null;

  return [
    "You are an AI assistant that extracts laboratory analyte results from workflow submissions.",
    "Return ONLY valid JSON (no Markdown code fences).",
    focusLine,
    `Patient: ${orderContext.patient_name ?? "Unknown"}; Order ID: ${orderContext.id}; Sample ID: ${orderContext.sample_id ?? "n/a"}.`,
    `Instruction: ${workflowInstruction}`,
    workflowSnippet ? `Workflow data excerpt: ${workflowSnippet}` : "",
    visionSnippet ? `Vision analysis summary: ${visionSnippet}` : "",
    catalogSnippet ? `Reference analyte catalog entries: ${catalogSnippet}` : "",
    "Output schema: {\"extractedParameters\": [{\"parameter\": string, \"value\": string | number, \"unit\": string | null, \"reference_range\": string | null, \"flag\": string | null, \"confidence\": number | null, \"analyte_id\": string | null}], \"metadata\": {\"source\": \"gemini-workflow\", \"notes\": string?}}",
    "Ensure each analyte has unique parameter names. Use null when a field is unavailable."
  ]
    .filter(Boolean)
    .join("\n\n");
}

function serializeForPrompt(data: unknown, maxLength = 1500): string {
  try {
    const json = JSON.stringify(
      data,
      (_key, value) => {
        if (value === undefined) return null;
        if (typeof value === "string" && value.length > 200) {
          return `${value.slice(0, 200)}...`;
        }
        return value;
      },
      2
    );
  return json.length > maxLength ? `${json.slice(0, maxLength)}...` : json;
  } catch (_err) {
    return "[unserializable data]";
  }
}

function normalizeGeminiResponse(responseText: string) {
  if (!responseText) {
    return { extractedParameters: [], metadata: { source: "gemini-workflow", note: "empty response" } };
  }

  let cleaned = responseText.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return { extractedParameters: parsed };
    }
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch (_err) {
    // fallthrough to default structure
  }

  return {
    extractedParameters: [],
    rawText: cleaned,
    metadata: { source: "gemini-workflow", note: "could not parse JSON" },
  };
}

/**
 * Parse numeric value and extract flag character (L/H/C) if present
 * Examples: "11.1L" -> { value: "11.1", flag: "L" }
 *           "4.91" -> { value: "4.91", flag: null }
 *           "10.5H" -> { value: "10.5", flag: "H" }
 */
function parseValueAndFlag(rawValue: string): { value: string; extractedFlag: string | null } {
  if (!rawValue || typeof rawValue !== 'string') {
    return { value: rawValue, extractedFlag: null };
  }

  const trimmed = rawValue.trim();
  
  // Check if value ends with a flag character (L, H, C, LL, HH)
  const flagPattern = /^([\d\.\-\+\s,]+?)([LHC]{1,2})$/i;
  const match = trimmed.match(flagPattern);
  
  if (match) {
    const numericPart = match[1].trim();
    const flagPart = match[2].toUpperCase();
    
    // Validate that the numeric part is actually a valid number
    if (!isNaN(parseFloat(numericPart))) {
      return { 
        value: numericPart, 
        extractedFlag: flagPart 
      };
    }
  }
  
  // No flag found or invalid format, return as-is
  return { value: trimmed, extractedFlag: null };
}

function extractValuesFromGemini(result: any) {
  if (!result) return null;

  if (Array.isArray(result?.extractedParameters)) {
    const map: Record<string, unknown> = {};
    result.extractedParameters.forEach((entry: any) => {
      if (!entry || typeof entry !== "object") return;
      const key = entry.parameter || entry.name;
      if (!key) return;
      
      // Parse value to separate numeric value from flag character
      let parsedValue = entry.value;
      let extractedFlag = entry.flag;
      
      if (typeof entry.value === 'string') {
        const parsed = parseValueAndFlag(entry.value);
        parsedValue = parsed.value;
        // Use extracted flag if no explicit flag was provided
        if (!extractedFlag && parsed.extractedFlag) {
          extractedFlag = parsed.extractedFlag;
        }
      }
      
      map[key] = {
        value: parsedValue ?? null,
        unit: entry.unit ?? null,
        reference: entry.reference_range ?? null,
        flag: extractedFlag ?? null,
        confidence: entry.confidence ?? null,
        analyte_id: entry.analyte_id ?? null,
      };
    });
    return map;
  }

  if (typeof result === "object" && result !== null) {
    return result;
  }

  return null;
}

function buildWorkflowPrompt(
  instance: WorkflowInstance,
  analyteIds: string[],
  surveyData: Record<string, unknown>
) {
  const workflowName = instance.workflows?.name ?? "Workflow";
  const analyteHint = analyteIds.length ? `Target analyte IDs: ${analyteIds.join(", ")}.` : "";
  const snippetKeys = Object.keys(surveyData).slice(0, 5);
  const snippets = snippetKeys
    .map((key) => {
      const value = surveyData[key];
      if (typeof value === "string" && value.length < 120) {
        return `${key}: ${value}`;
      }
      return null;
    })
    .filter(Boolean)
    .join(" | ");

  return [
    `${workflowName} results captured via Survey workflow.`,
    analyteHint,
    snippets ? `Context: ${snippets}.` : "",
    "Extract structured analyte results and return JSON keyed by analyte name with value, unit, and optional flag.",
  ]
    .filter(Boolean)
    .join(" \n");
}

function baseHeaders(): HeadersInit {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
  };
}

async function fetchOrderContext(orderId: string): Promise<OrderContext> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/orders`);
  url.searchParams.set("id", `eq.${orderId}`);
  url.searchParams.set("select", "id,patient_id,patient_name,lab_id,sample_id");
  url.searchParams.set("limit", "1");

  const res = await fetch(url, { headers: baseHeaders() });
  if (!res.ok) {
    throw new Error(`Failed to load order context: ${await res.text()}`);
  }

  const data = await res.json();
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) {
    throw new Error(`Order context not found for order ${orderId}`);
  }

  return {
    id: row.id,
    patient_id: row.patient_id,
    patient_name: row.patient_name ?? "Unknown Patient",
    lab_id: row.lab_id ?? null,
    sample_id: row.sample_id ?? null,
  };
}

async function buildAnalyteCatalogData(params: {
  requestCatalog?: IncomingAnalyteCatalogEntry[] | null;
  analyteIds: string[];
  extractedValues: Record<string, unknown> | null;
}): Promise<NormalizedAnalyteEntry[]> {
  const combinedMap = new Map<string, NormalizedAnalyteEntry>();

  const mergeEntry = (entry: NormalizedAnalyteEntry) => {
    const key = entry.id ?? normalizeIdentifier(entry.name);
    if (!key) return;

    const existing = combinedMap.get(key);
    if (existing) {
      combinedMap.set(key, {
        id: existing.id ?? entry.id ?? null,
        name: existing.name.length >= entry.name.length ? existing.name : entry.name,
        unit: existing.unit ?? entry.unit ?? null,
        reference_range: existing.reference_range ?? entry.reference_range ?? null,
        code: existing.code ?? entry.code ?? null,
      });
    } else {
      combinedMap.set(key, { ...entry });
    }
  };

  if (Array.isArray(params.requestCatalog)) {
    params.requestCatalog.forEach((item) => {
      const name = typeof item?.name === "string" ? item.name.trim() : "";
      if (!name) return;
      mergeEntry({
        id: item?.id ?? null,
        name,
        unit: item?.unit ?? null,
        reference_range: item?.reference_range ?? null,
        code: item?.code ?? null,
      });
    });
  }

  const extractedEntries = normalizeExtractedEntries(params.extractedValues);
  extractedEntries.forEach(({ key, raw }) => {
    const rawName = typeof raw?.parameter === "string" ? raw.parameter : key;
    const name = rawName?.trim?.() || key;
    if (!name) return;
    const unit = typeof raw?.unit === "string" ? raw.unit : raw?.units ?? null;
    const reference = typeof raw?.reference_range === "string" ? raw.reference_range : raw?.reference ?? null;
    const code = typeof raw?.code === "string" ? raw.code : null;
    mergeEntry({
      id: typeof raw?.analyte_id === "string" ? raw.analyte_id : null,
      name,
      unit: unit ?? null,
      reference_range: reference ?? null,
      code,
    });
  });

  const suppliedIds = new Set<string>();
  combinedMap.forEach((entry) => {
    if (entry.id) suppliedIds.add(entry.id);
  });

  const supplementalIds = new Set<string>();
  params.analyteIds.forEach((id) => {
    if (id && !suppliedIds.has(id)) supplementalIds.add(id);
  });
  collectAnalyteIdsFromExtractedValues(params.extractedValues).forEach((id) => {
    if (id && !suppliedIds.has(id)) supplementalIds.add(id);
  });

  if (supplementalIds.size > 0) {
    const fetched = await fetchAnalytesByIds(Array.from(supplementalIds));
    fetched.forEach(mergeEntry);
  }

  return Array.from(combinedMap.values());
}

function collectAnalyteIdsFromExtractedValues(extracted: Record<string, unknown> | null | undefined): string[] {
  const ids: string[] = [];
  if (!extracted || typeof extracted !== "object") {
    return ids;
  }

  normalizeExtractedEntries(extracted).forEach(({ raw }) => {
    if (raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).analyte_id === "string") {
      ids.push(((raw as Record<string, unknown>).analyte_id as string).trim());
    }
  });

  return ids;
}

async function fetchAnalytesByIds(ids: string[]): Promise<NormalizedAnalyteEntry[]> {
  if (!ids.length) return [];

  const uniqueIds = Array.from(new Set(ids.filter((id) => typeof id === "string" && id.trim().length > 0)));
  if (!uniqueIds.length) return [];

  const results: NormalizedAnalyteEntry[] = [];
  const chunkSize = 50;

  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);
    const url = new URL(`${SUPABASE_URL}/rest/v1/analytes`);
    url.searchParams.set("id", `in.(${chunk.join(",")})`);
    url.searchParams.set("select", "id,name,unit,reference_range");

    const res = await fetch(url, { headers: baseHeaders() });
    if (!res.ok) {
      console.warn("process-workflow-results: unable to load analyte metadata", await res.text());
      continue;
    }

    const data = await res.json();
    (data ?? []).forEach((row: any) => {
      const name = typeof row?.name === "string" ? row.name.trim() : "";
      if (!name) return;
      results.push({
        id: row.id ?? null,
        name,
        unit: row.unit ?? null,
        reference_range: row.reference_range ?? null,
        code: null, // analytes table doesn't have code column
      });
    });
  }

  return results;
}

function extractGeminiConfidence(result: unknown): number | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  const maybeNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const direct = maybeNumber((result as Record<string, unknown>).confidence);
  if (direct !== null) return direct;

  const metadata = (result as Record<string, unknown>).metadata;
  if (metadata && typeof metadata === "object") {
    const metaConfidence = maybeNumber((metadata as Record<string, unknown>).confidence);
    if (metaConfidence !== null) return metaConfidence;
    const overall = maybeNumber((metadata as Record<string, unknown>).overallConfidence);
    if (overall !== null) return overall;
  }

  return null;
}

interface PersistParams {
  orderId: string;
  workflowInstanceId: string;
  workflowName: string | null;
  testGroupId: string | null;
  orderTestId: string | null;
  orderTestGroupId: string | null;
  analyteCatalog: NormalizedAnalyteEntry[];
  extractedValues: Record<string, any> | null;
  attachmentId: string | null;
  aiConfidence: number | null;
  labId: string;
  orderContext: OrderContext;
  analytesRequested: string[];
}

interface PersistSummary {
  resultId: string | null;
  valueCount: number;
}

async function persistExtractedValues(params: PersistParams): Promise<PersistSummary> {
  const { resultId, isProtected } = await ensureResultRecord({
    orderId: params.orderId,
    workflowInstanceId: params.workflowInstanceId,
    workflowName: params.workflowName,
    testGroupId: params.testGroupId,
    orderTestId: params.orderTestId,
    orderTestGroupId: params.orderTestGroupId,
    attachmentId: params.attachmentId,
    aiConfidence: params.aiConfidence,
    labId: params.labId,
    orderContext: params.orderContext,
    analyteCatalog: params.analyteCatalog,
    analytesRequested: params.analytesRequested,
  });

  // If result is protected (verified/approved), don't modify values
  if (isProtected) {
    console.log(`⚠️ Result ${resultId} is protected - skipping value updates to preserve verified data`);
    return { resultId, valueCount: 0 };
  }

  const normalizedEntries = normalizeExtractedEntries(params.extractedValues);

  // Always clear previous AI-generated values for this result to avoid duplicates
  await deleteExistingResultValues(resultId);

  if (!normalizedEntries.length) {
    return { resultId, valueCount: 0 };
  }

  const lookup = buildAnalyteLookup(params.analyteCatalog);
  const rowsByKey = new Map<string, Record<string, unknown>>();

  normalizedEntries.forEach(({ key, raw }) => {
    const explicitId = typeof raw?.analyte_id === "string" ? raw.analyte_id : null;
    const normalizedKey = normalizeIdentifier(key);
    const matched =
      (explicitId && lookup.byId.get(explicitId)) ||
      (normalizedKey ? lookup.byName.get(normalizedKey) : undefined) ||
      (normalizedKey ? lookup.byCode.get(normalizedKey) : undefined) ||
      null;

    const resolvedName = matched?.name ?? (typeof raw?.parameter === "string" ? raw.parameter : key);
    const parameterName = resolvedName ?? key;

    const rawValue = (() => {
      if (!raw || typeof raw !== "object") return raw;
      const record = raw as Record<string, unknown>;
      if ("value" in record) return record.value;
      if ("result" in record) return record.result;
      if ("text" in record) return record.text;
      return raw;
    })();

    let valueString: string | null = null;
    let extractedFlag: string | null = null;
    
    if (typeof rawValue === "string") {
      // Parse to separate numeric value from flag characters (e.g., "11.1L" -> "11.1" + flag "L")
      const parsed = parseValueAndFlag(rawValue);
      valueString = parsed.value;
      extractedFlag = parsed.extractedFlag;
    } else if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      valueString = rawValue.toString();
    } else if (typeof rawValue === "boolean") {
      valueString = rawValue ? "true" : "false";
    } else if (Array.isArray(rawValue)) {
      valueString = rawValue.map((item) => (item == null ? "" : String(item))).join(", ");
    }

    if (!valueString || valueString.trim().length === 0) {
      return;
    }
    valueString = valueString.trim();

    const unitCandidate =
      (raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).unit === "string"
        ? (raw as Record<string, unknown>).unit
        : raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).units === "string"
        ? (raw as Record<string, unknown>).units
        : null) ?? matched?.unit ?? null;

    const unit = typeof unitCandidate === "string" && unitCandidate.trim().length > 0 ? unitCandidate.trim() : null;

    const referenceRangeCandidate =
      (raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).reference_range === "string"
        ? (raw as Record<string, unknown>).reference_range
        : raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).reference === "string"
        ? (raw as Record<string, unknown>).reference
        : null) ?? matched?.reference_range ?? "";

    const referenceRange = (() => {
      if (typeof referenceRangeCandidate === "string") {
        return referenceRangeCandidate.trim();
      }
      if (typeof referenceRangeCandidate === "number" && Number.isFinite(referenceRangeCandidate)) {
        return referenceRangeCandidate.toString();
      }
      return "";
    })();

    // Use explicit flag from raw data, or fall back to flag extracted from value string
    const explicitFlag =
      raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).flag === "string"
        ? (raw as Record<string, unknown>).flag
        : null;
    
    const flag = explicitFlag || extractedFlag;

    const perAnalyteConfidenceValue =
      raw && typeof raw === "object" && "confidence" in raw
        ? (raw as Record<string, unknown>).confidence
        : null;

    const aiConfidence = (() => {
      if (typeof perAnalyteConfidenceValue === "number" && Number.isFinite(perAnalyteConfidenceValue)) {
        return perAnalyteConfidenceValue.toString();
      }
      if (typeof perAnalyteConfidenceValue === "string") {
        return perAnalyteConfidenceValue;
      }
      if (params.aiConfidence !== null) {
        return params.aiConfidence.toString();
      }
      return null;
    })();

    const analyteId = explicitId ?? matched?.id ?? null;
    const mapKey = (() => {
      const preferred = normalizeIdentifier(parameterName) || normalizedKey;
      if (preferred) return preferred;
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
      return `key-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    })();

    rowsByKey.set(mapKey, {
      result_id: resultId,
      order_id: params.orderId,
      test_group_id: params.testGroupId,
      order_test_group_id: params.orderTestGroupId,
      order_test_id: params.orderTestId,
      analyte_id: analyteId,
      analyte_name: parameterName,
      parameter: parameterName,
      value: valueString,
      unit,
      units: unit,
  reference_range: referenceRange,
  flag: flag ? flag.trim() : null,
      lab_id: params.labId,
      sample_id: params.orderContext.sample_id || null,
      ai_confidence: aiConfidence,
      extracted_by_ai: true,
    });
  });

  const rows = Array.from(rowsByKey.values());
  console.log(`🔄 persistExtractedValues: Prepared ${rows.length} result_value rows for insertion`);
  console.log("Sample row keys:", rows[0] ? Object.keys(rows[0]).join(", ") : "none");
  
  const insertedCount = await insertResultValues(rows);

  console.log(`✅ persistExtractedValues: Inserted ${insertedCount} values for result_id: ${resultId}`);

  return {
    resultId,
    valueCount: insertedCount,
  };
}

interface EnsureResultParams {
  orderId: string;
  workflowInstanceId: string;
  workflowName: string | null;
  testGroupId: string | null;
  orderTestId: string | null;
  orderTestGroupId: string | null;
  attachmentId: string | null;
  aiConfidence: number | null;
  labId: string;
  orderContext: OrderContext;
  analyteCatalog: NormalizedAnalyteEntry[];
  analytesRequested: string[];
}

async function ensureResultRecord(params: EnsureResultParams): Promise<{ resultId: string; isProtected: boolean }> {
  const existing = await findExistingResult({
    orderId: params.orderId,
    workflowInstanceId: params.workflowInstanceId,
    testGroupId: params.testGroupId,
    orderTestId: params.orderTestId,
    orderTestGroupId: params.orderTestGroupId,
  });

  const metadata = buildAIExtractionMetadata(
    existing?.ai_extraction_metadata,
    params.workflowInstanceId,
    params.analyteCatalog,
    params.analytesRequested,
  );

  if (existing?.id) {
    // IMPORTANT: Check if result is already verified/approved - don't overwrite protected results
    if (isResultProtected(existing)) {
      console.log(`⚠️ Result ${existing.id} is already verified/approved (status: ${existing.status}, verification_status: ${existing.verification_status}). Skipping update to preserve integrity.`);
      // Return existing ID but mark as protected so values won't be updated
      return { resultId: existing.id, isProtected: true };
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/results?id=eq.${existing.id}`, {
      method: "PATCH",
      headers: {
        ...baseHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        updated_at: new Date().toISOString(),
        lab_id: params.labId,
        test_group_id: params.testGroupId,
        order_test_group_id: params.orderTestGroupId ?? existing.order_test_group_id ?? null,
        order_test_id: params.orderTestId ?? existing.order_test_id ?? null,
        workflow_instance_id: params.workflowInstanceId,
        extracted_by_ai: true,
        ai_confidence: params.aiConfidence,
        ai_extraction_metadata: metadata,
        attachment_id: params.attachmentId ?? existing.attachment_id ?? null,
        status: "pending_verification",
        verification_status: "pending_verification",
      }),
    });

    if (!res.ok) {
      throw new Error(`Failed to update existing result ${existing.id}: ${await res.text()}`);
    }

    return { resultId: existing.id, isProtected: false };
  }

  const insertPayload = {
    order_id: params.orderId,
    patient_id: params.orderContext.patient_id,
    patient_name: params.orderContext.patient_name ?? "Unknown Patient",
    test_name: params.workflowName ?? "Workflow Result",
    status: "pending_verification",
    verification_status: "pending_verification",
    entered_by: "Workflow Automation",
    entered_date: new Date().toISOString().split("T")[0],
    lab_id: params.labId,
    test_group_id: params.testGroupId,
    order_test_group_id: params.orderTestGroupId,
    order_test_id: params.orderTestId,
    workflow_instance_id: params.workflowInstanceId,
    extracted_by_ai: true,
    ai_confidence: params.aiConfidence,
    ai_extraction_metadata: metadata,
    attachment_id: params.attachmentId,
    sample_id: params.orderContext.sample_id || null,
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/results`, {
    method: "POST",
    headers: {
      ...baseHeaders(),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(insertPayload),
  });

  if (!res.ok) {
    throw new Error(`Failed to create result record: ${await res.text()}`);
  }

  const data = await res.json();
  const inserted = Array.isArray(data) ? data[0] : data;
  if (!inserted?.id) {
    throw new Error("Result record creation did not return an ID");
  }

  return { resultId: inserted.id as string, isProtected: false };
}

async function findExistingResult(params: {
  orderId: string;
  workflowInstanceId: string;
  testGroupId: string | null;
  orderTestId: string | null;
  orderTestGroupId: string | null;
}): Promise<any | null> {
  const attempts: Array<Record<string, string>> = [];

  attempts.push({
    order_id: `eq.${params.orderId}`,
    workflow_instance_id: `eq.${params.workflowInstanceId}`,
  });

  const fallback: Record<string, string> = {
    order_id: `eq.${params.orderId}`,
  };
  if (params.testGroupId) fallback.test_group_id = `eq.${params.testGroupId}`;
  if (params.orderTestGroupId) fallback.order_test_group_id = `eq.${params.orderTestGroupId}`;
  if (params.orderTestId) fallback.order_test_id = `eq.${params.orderTestId}`;
  attempts.push(fallback);

  for (const filters of attempts) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/results`);
    Object.entries(filters).forEach(([key, value]) => url.searchParams.set(key, value));
    // Include status and verification_status to check if result is already verified
    url.searchParams.set("select", "id,attachment_id,order_test_group_id,order_test_id,ai_extraction_metadata,status,verification_status");
    url.searchParams.set("order", "created_at.desc");
    url.searchParams.set("limit", "1");

    const res = await fetch(url, { headers: baseHeaders() });
    if (!res.ok) {
      throw new Error(`Failed to query existing results: ${await res.text()}`);
    }

    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      return data[0];
    }
  }

  return null;
}

/**
 * Check if a result is in a protected status (verified/approved) that shouldn't be overwritten
 */
function isResultProtected(result: any): boolean {
  if (!result) return false;

  const protectedStatuses = ['verified', 'approved', 'released', 'reported', 'final'];
  const status = (result.status || '').toLowerCase();
  const verificationStatus = (result.verification_status || '').toLowerCase();

  return protectedStatuses.includes(status) || protectedStatuses.includes(verificationStatus);
}

function buildAIExtractionMetadata(
  existing: unknown,
  workflowInstanceId: string,
  analyteCatalog: NormalizedAnalyteEntry[],
  analytesRequested: string[],
) {
  const base = typeof existing === "object" && existing !== null ? (existing as Record<string, unknown>) : {};
  return {
    ...base,
    source: "workflow-ai",
    workflow_instance_id: workflowInstanceId,
    analyte_catalog_size: analyteCatalog.length,
    analytes_requested: Array.from(new Set(analytesRequested)),
    last_extracted_at: new Date().toISOString(),
  };
}

async function deleteExistingResultValues(resultId: string) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/result_values`);
  url.searchParams.set("result_id", `eq.${resultId}`);
  url.searchParams.set("extracted_by_ai", "eq.true");

  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      ...baseHeaders(),
      Prefer: "return=minimal",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to clear existing result values: ${await res.text()}`);
  }
}

async function insertResultValues(rows: Record<string, unknown>[]): Promise<number> {
  if (!rows.length) {
    console.log("⚠️ insertResultValues: No rows to insert");
    return 0;
  }

  console.log(`📝 insertResultValues: Attempting to insert ${rows.length} rows`);
  console.log("First row sample:", JSON.stringify(rows[0], null, 2));

  const res = await fetch(`${SUPABASE_URL}/rest/v1/result_values`, {
    method: "POST",
    headers: {
      ...baseHeaders(),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(rows),
  });

  const responseText = await res.text();
  console.log(`Response status: ${res.status}`);
  console.log(`Response body: ${responseText.substring(0, 500)}`);

  if (!res.ok) {
    throw new Error(`Failed to insert result values (${res.status}): ${responseText}`);
  }

  const data = JSON.parse(responseText);
  const count = Array.isArray(data) ? data.length : 0;
  console.log(`✅ insertResultValues: Successfully inserted ${count} rows`);
  return count;
}

function normalizeExtractedEntries(
  extracted: Record<string, unknown> | null | undefined,
): Array<{ key: string; raw: any }> {
  if (!extracted || typeof extracted !== "object") {
    return [];
  }

  return Object.entries(extracted).map(([key, raw]) => ({ key, raw }));
}

function buildAnalyteLookup(catalog: NormalizedAnalyteEntry[]): {
  byId: Map<string, NormalizedAnalyteEntry>;
  byName: Map<string, NormalizedAnalyteEntry>;
  byCode: Map<string, NormalizedAnalyteEntry>;
} {
  const byId = new Map<string, NormalizedAnalyteEntry>();
  const byName = new Map<string, NormalizedAnalyteEntry>();
  const byCode = new Map<string, NormalizedAnalyteEntry>();

  catalog.forEach((entry) => {
    if (entry.id) {
      byId.set(entry.id, entry);
    }
    const normalizedName = normalizeIdentifier(entry.name);
    if (normalizedName) {
      byName.set(normalizedName, entry);
    }
    if (entry.code) {
      const normalizedCode = normalizeIdentifier(entry.code);
      if (normalizedCode) {
        byCode.set(normalizedCode, entry);
      }
    }
  });

  return { byId, byName, byCode };
}

function normalizeIdentifier(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
