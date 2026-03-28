import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Get AI prompt with hierarchical fallback
 */
async function getAIPrompt(
  supabase: any,
  processingType: string,
  labId?: string,
  testGroupId?: string,
): Promise<string> {
  try {
    console.log(`\n🔍 AI Prompt Lookup Starting...`);
    console.log(`  - Type: ${processingType}`);
    console.log(`  - Lab ID: ${labId || "not provided"}`);
    console.log(`  - Test Group ID: ${testGroupId || "not provided"}`);

    // Try: Lab + Test specific
    if (labId && testGroupId) {
      console.log("  → Trying: Lab + Test specific prompt...");
      const { data } = await supabase
        .from("ai_prompts")
        .select("prompt")
        .eq("lab_id", labId)
        .eq("test_id", testGroupId)
        .eq("ai_processing_type", processingType)
        .is("analyte_id", null)
        .maybeSingle();

      if (data?.prompt) {
        console.log("  ✅ FOUND: Lab + Test specific prompt");
        console.log(`     Length: ${data.prompt.length} chars`);
        return data.prompt;
      }
      console.log("  ❌ Not found: Lab + Test specific prompt");
    }

    // Try: Test-specific
    if (testGroupId) {
      console.log("  → Trying: Test-specific prompt...");
      const { data } = await supabase
        .from("ai_prompts")
        .select("prompt")
        .eq("test_id", testGroupId)
        .eq("ai_processing_type", processingType)
        .is("lab_id", null)
        .is("analyte_id", null)
        .maybeSingle();

      if (data?.prompt) {
        console.log("  ✅ FOUND: Test-specific prompt");
        console.log(`     Length: ${data.prompt.length} chars`);
        return data.prompt;
      }
      console.log("  ❌ Not found: Test-specific prompt");
    }

    // Try: Test group level prompt
    if (testGroupId) {
      console.log("  → Trying: Test Group level prompt...");
      const { data } = await supabase
        .from("test_groups")
        .select("group_level_prompt")
        .eq("id", testGroupId)
        .maybeSingle();

      if (data?.group_level_prompt) {
        console.log("  ✅ FOUND: Test Group level prompt");
        console.log(`     Length: ${data.group_level_prompt.length} chars`);
        return data.group_level_prompt;
      }
      console.log("  ❌ Not found: Test Group level prompt");
    }

    // Try: Default prompt
    console.log("  → Trying: Default prompt from database...");
    const { data: defaultPrompt } = await supabase
      .from("ai_prompts")
      .select("prompt")
      .eq("ai_processing_type", processingType)
      .eq("default", true)
      .is("lab_id", null)
      .is("test_id", null)
      .is("analyte_id", null)
      .maybeSingle();

    if (defaultPrompt?.prompt) {
      console.log("  ✅ FOUND: Default prompt from database");
      console.log(`     Length: ${defaultPrompt.prompt.length} chars`);
      return defaultPrompt.prompt;
    }
    console.log("  ❌ Not found: Default prompt in database");

    // Fallback: Hardcoded default
    console.log("  ⚠️  FALLBACK: Using hardcoded default prompt");
    const hardcodedPrompt = getHardcodedDefaultPrompt(processingType);
    console.log(`     Length: ${hardcodedPrompt.length} chars`);
    return hardcodedPrompt;
  } catch (error) {
    console.error("❌ Error fetching prompt:", error);
    console.log(
      "  ⚠️  FALLBACK: Using hardcoded default prompt (due to error)",
    );
    return getHardcodedDefaultPrompt(processingType);
  }
}

/**
 * Hardcoded default prompts (fallback)
 */
function getHardcodedDefaultPrompt(processingType: string): string {
  if (processingType === "nlp_extraction") {
    return `You are an expert medical document analyzer specializing in Test Request Forms (TRF) from Indian medical laboratories.

TASK: Extract structured information from the provided text with high accuracy.

EXTRACT THE FOLLOWING:

1. PATIENT INFORMATION:
   - name: Full patient name
   - age: Numeric age with unit (years/months/days)
   - gender: Male/Female/Other
   - phone: 10-digit mobile number
   - email: Email address if present
   - address: Full address if present

2. REQUESTED TESTS (CHECKBOX DETECTION):
   - Extract all test names EXACTLY as written
   - **CRITICAL**: Look for checkboxes (☑, ✓, tick marks) next to each test
   - Set "isSelected: true" ONLY if the checkbox is CHECKED/TICKED
   - Set "isSelected: false" if the checkbox is EMPTY/UNCHECKED
   - If no checkbox is visible, default to "isSelected: false"
   - Provide confidence score (0.0 to 1.0) for each test

3. DOCTOR INFORMATION:
   - name: Doctor's full name (include titles like Dr./Prof.)
   - specialization: Medical specialty if mentioned
   - registrationNumber: Medical registration number if present

4. ADDITIONAL DETAILS:
   - clinicalNotes: Any clinical history or symptoms
   - location: Collection location if specified
   - sampleCollectionDate: Date if specified (format: YYYY-MM-DD)
   - urgency: "Normal" / "Urgent" / "STAT"

OUTPUT FORMAT (JSON):
{
  "patientInfo": {
    "name": "string",
    "age": number,
    "gender": "Male" | "Female" | "Other",
    "phone": "string (10 digits)",
    "email": "string or null",
    "address": "string or null",
    "confidence": 0.9
  },
  "requestedTests": [
    {
      "testName": "string (exact name from document)",
      "isSelected": true,
      "confidence": 0.9
    }
  ],
  "doctorInfo": {
    "name": "string",
    "specialization": "string or null",
    "registrationNumber": "string or null",
    "confidence": 0.8
  },
  "clinicalNotes": "string or null",
  "location": "string or null",
  "sampleCollectionDate": "YYYY-MM-DD or null",
  "urgency": "Normal" | "Urgent" | "STAT"
}

IMPORTANT GUIDELINES:
- Use confidence scores based on text clarity
- Return null for missing fields
- Preserve original test names exactly
- Include all tests mentioned, but REMOVE DUPLICATES (same test name should appear only once)
- Default urgency to "Normal" if not specified
- Pay special attention to checkbox states for test selection`;
  }
  return "Extract information from the medical document and return as structured JSON.";
}

interface TRFExtractionRequest {
  attachmentId: string;
  imageBase64?: string;
}

interface PatientInfo {
  name: string;
  age?: number;
  gender?: "Male" | "Female" | "Other";
  phone?: string;
  email?: string;
  address?: string;
  confidence: number;
}

interface TestRequest {
  testName: string;
  testGroupId?: string;
  matched: boolean;
  confidence: number;
}

interface DoctorInfo {
  name: string;
  specialization?: string;
  registrationNumber?: string;
  confidence: number;
}

interface TRFExtractionResponse {
  success: boolean;
  patientInfo?: PatientInfo;
  requestedTests?: TestRequest[];
  doctorInfo?: DoctorInfo;
  clinicalNotes?: string;
  location?: string;
  sampleCollectionDate?: string;
  urgency?: "Normal" | "Urgent" | "STAT";
  matchedPatient?: {
    id: string;
    name: string;
    phone: string;
    matchConfidence: number;
    matchReason?: string; // 'phone_and_name' | 'phone_only' | 'name_only'
  };
  matchedDoctor?: {
    id: string;
    name: string;
    specialization?: string;
    matchConfidence: number;
  };
  error?: string;
  metadata?: any;
}

/**
 * Resilient JSON parser that handles truncated AI responses
 * AI often returns truncated JSON due to token limits - this repairs it
 */
function resilientJsonParse(jsonText: string): any {
  // First, try standard parse
  try {
    return JSON.parse(jsonText);
  } catch (firstError) {
    console.log("  ⚠️ Initial JSON parse failed, attempting repair...");
  }

  let repaired = jsonText.trim();

  // Step 1: Complete truncated numbers (e.g., "1." -> "1.0", "0." -> "0.0")
  repaired = repaired.replace(/:\s*(\d+)\.\s*([,}\]\n]|$)/g, ": $1.0$2");
  repaired = repaired.replace(/:\s*(\d+)\.$/, ": $1.0");

  // Step 2: Remove trailing commas before closing brackets
  repaired = repaired.replace(/,\s*([}\]])/g, "$1");

  // Step 3: Count brackets to find imbalance
  const openBraces = (repaired.match(/{/g) || []).length;
  const closeBraces = (repaired.match(/}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/]/g) || []).length;

  // Step 4: Handle incomplete strings - close them
  // Check if we're in the middle of a string value
  const lastQuote = repaired.lastIndexOf('"');
  const afterLastQuote = repaired.substring(lastQuote + 1).trim();
  if (
    afterLastQuote && !afterLastQuote.startsWith(":") &&
    !afterLastQuote.startsWith(",") &&
    !afterLastQuote.startsWith("}") && !afterLastQuote.startsWith("]")
  ) {
    // We might be in the middle of a string, try to close it
    if (!afterLastQuote.includes('"')) {
      repaired = repaired + '"';
    }
  }

  // Step 5: Remove incomplete key-value pairs at the end
  // Pattern: trailing incomplete entries like ', "key"' or ', "key":' or ', "key": "val'
  repaired = repaired.replace(/,\s*"[^"]*"?\s*:?\s*"?[^",}\]]*$/g, "");

  // Step 6: Add missing closing brackets/braces
  const missingBraces = openBraces - closeBraces;
  const missingBrackets = openBrackets - closeBrackets;

  // Remove trailing comma before adding closers
  repaired = repaired.replace(/,\s*$/, "");

  for (let i = 0; i < missingBrackets; i++) {
    repaired += "]";
  }
  for (let i = 0; i < missingBraces; i++) {
    repaired += "}";
  }

  // Step 7: Try parsing the repaired JSON
  try {
    const parsed = JSON.parse(repaired);
    console.log("  ✅ JSON repaired successfully (truncation handled)");
    return parsed;
  } catch (repairError) {
    console.log("  ⚠️ Repair attempt 1 failed, trying aggressive repair...");
  }

  // Step 8: Aggressive repair - find the last valid JSON structure
  // Try progressively shorter substrings ending with proper closure
  for (let end = repaired.length; end > 50; end--) {
    let substr = repaired.substring(0, end).trim();

    // Remove trailing incomplete parts
    substr = substr.replace(/,\s*$/, "");
    substr = substr.replace(/:\s*$/, "");
    substr = substr.replace(/,\s*"[^"]*$/, "");

    // Count and close brackets
    const ob = (substr.match(/{/g) || []).length;
    const cb = (substr.match(/}/g) || []).length;
    const obk = (substr.match(/\[/g) || []).length;
    const cbk = (substr.match(/]/g) || []).length;

    let closed = substr;
    for (let i = 0; i < (obk - cbk); i++) closed += "]";
    for (let i = 0; i < (ob - cb); i++) closed += "}";

    try {
      const parsed = JSON.parse(closed);
      console.log(
        `  ✅ JSON recovered (truncated at position ${end}/${repaired.length})`,
      );
      return parsed;
    } catch {
      // Continue trying shorter substrings
    }
  }

  // Step 9: Last resort - return minimal structure
  console.error(
    "  ❌ All JSON repair attempts failed, returning empty structure",
  );
  return {
    patientInfo: { name: null, confidence: 0 },
    requestedTests: [],
    doctorInfo: null,
    _parseError: true,
    _rawLength: jsonText.length,
  };
}

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { attachmentId, imageBase64 } = await req
      .json() as TRFExtractionRequest;

    console.log("Processing TRF extraction for attachment:", attachmentId);

    // Step 1: Get attachment details (including lab_id)
    let imageData = imageBase64;
    let userLabId: string | undefined;

    if (!imageData && attachmentId) {
      const { data: attachment, error: attachmentError } = await supabase
        .from("attachments")
        .select("file_url, file_path, lab_id")
        .eq("id", attachmentId)
        .single();

      if (attachmentError) {
        throw new Error(
          `Failed to fetch attachment: ${attachmentError.message}`,
        );
      }

      // Get lab_id from attachment
      if (attachment.lab_id) {
        userLabId = attachment.lab_id;
        console.log("📌 Using lab_id from attachment:", userLabId);
      }

      console.log(
        "Downloading file from storage bucket: attachments, path:",
        attachment.file_path,
      );

      // Download image from storage (correct bucket: 'attachments')
      const { data: fileData, error: downloadError } = await supabase
        .storage
        .from("attachments")
        .download(attachment.file_path);

      if (downloadError) {
        console.error("Download error:", downloadError);
        throw new Error(
          `Failed to download file: ${JSON.stringify(downloadError)}`,
        );
      }

      console.log(
        "File downloaded successfully, size:",
        fileData.size,
        "bytes",
      );

      // Convert to base64 using a more efficient method for large files
      const arrayBuffer = await fileData.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      // Use chunked conversion to avoid stack overflow
      let binary = "";
      const chunkSize = 8192; // Process 8KB at a time
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        binary += String.fromCharCode.apply(null, Array.from(chunk));
      }

      const base64 = btoa(binary);
      imageData = base64;

      console.log("Base64 conversion completed, length:", base64.length);
    }

    if (!imageData) {
      throw new Error("No image data provided");
    }

    // Step 2: Call Google Vision API for OCR
    console.log("\n👁️  Calling Google Vision API for OCR...");
    const apiKey = Deno.env.get("ALLGOOGLE_KEY");
    if (!apiKey) {
      throw new Error("ALLGOOGLE_KEY not configured");
    }

    console.log(
      "  - Using Vision API features: TEXT_DETECTION, DOCUMENT_TEXT_DETECTION",
    );
    const visionResponse = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [{
            image: { content: imageData },
            features: [
              { type: "TEXT_DETECTION", maxResults: 1 },
              { type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 },
            ],
          }],
        }),
      },
    );

    if (!visionResponse.ok) {
      const errorBody = await visionResponse.text();
      console.error("Vision API error body:", errorBody);
      throw new Error(`Vision API failed: ${visionResponse.statusText} - ${errorBody}`);
    }

    const visionData = await visionResponse.json();
    const fullText = visionData.responses?.[0]?.fullTextAnnotation?.text || "";

    console.log("  ✅ Vision OCR completed");
    console.log("  - Extracted text length:", fullText.length, "characters");
    console.log(
      "  - Text preview (first 200 chars):",
      fullText.substring(0, 200),
    );

    // Step 3: We already have userLabId from the attachment record above

    // Step 4: Fetch dynamic AI prompt (with fallback to hardcoded default)
    console.log("\n📝 Fetching NLP extraction prompt...");
    const basePrompt = await getAIPrompt(supabase, "nlp_extraction", userLabId);
    console.log("📝 NLP Prompt Details:");
    console.log("  - Processing Type: nlp_extraction");
    console.log("  - Lab ID:", userLabId || "none");
    console.log("  - Prompt Length:", basePrompt.length, "characters");
    console.log(
      "  - Prompt Preview (first 200 chars):",
      basePrompt.substring(0, 200),
    );

    // Step 5: Call Gemini API for structured extraction (MULTIMODAL - Image + Text)
    console.log(
      "\n🤖 Calling Gemini API for NLP extraction (with image vision)...",
    );

    const geminiPrompt = `${basePrompt}

EXTRACTED TEXT FROM OCR:
${fullText}

IMPORTANT: Use the IMAGE to verify checkbox states. The OCR text shows what tests are listed, but you must LOOK AT THE IMAGE to see which checkboxes are checked (✓) or unchecked (☐).`;

    console.log(
      "  - Full Gemini prompt length:",
      geminiPrompt.length,
      "characters",
    );
    console.log("  - Sending image for visual checkbox detection");

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: geminiPrompt },
              {
                inline_data: {
                  mime_type: "image/jpeg",
                  data: imageData,
                },
              },
            ],
          }],
          generationConfig: {
            temperature: 0.1,
            topK: 32,
            topP: 1,
            maxOutputTokens: 4096,
          },
        }),
      },
    );

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error("Gemini API error:", geminiResponse.status, errorText);
      throw new Error(
        `Gemini API failed: ${geminiResponse.statusText} - ${errorText}`,
      );
    }

    const geminiData = await geminiResponse.json();
    const generatedText =
      geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

    console.log("\n✅ Gemini API Response Received");
    console.log("  - Response length:", generatedText.length, "characters");
    console.log(
      "  - Response preview (first 500 chars):",
      generatedText.substring(0, 500),
    );

    // Parse JSON from Gemini response (handle markdown code blocks)
    let extractedData;
    try {
      // Improved JSON extraction: handle markdown code blocks and potential truncation
      let jsonText = generatedText.trim();

      // Remove ```json or ``` from the start
      if (jsonText.startsWith("```")) {
        jsonText = jsonText.replace(/^```(json)?\s*/i, "");
      }

      // Remove ``` from the end (if present)
      if (jsonText.endsWith("```")) {
        jsonText = jsonText.replace(/\s*```$/, "");
      }

      // Attempt to parse, with fallback repair for truncated JSON
      extractedData = resilientJsonParse(jsonText);
      console.log("  ✅ JSON parsed successfully");
      console.log(
        "  - Patient name:",
        extractedData.patientInfo?.name || "not found",
      );
      console.log(
        "  - Patient phone:",
        extractedData.patientInfo?.phone || "not found",
      );
      console.log(
        "  - Tests requested:",
        extractedData.requestedTests?.length ||
          extractedData.testsRequested?.length || 0,
      );
    } catch (parseError) {
      console.error("  ❌ Failed to parse Gemini response:", parseError);
      console.error("  - Raw response:", generatedText);
      throw new Error("Failed to parse AI response");
    }

    // Step 4: Match patient with existing records (fuzzy search)
    let matchedPatient = null;
    if (extractedData.patientInfo?.name || extractedData.patientInfo?.phone) {
      const searchPhone = extractedData.patientInfo.phone?.replace(/\D/g, "") ||
        "";

      // Query patients: filter by lab_id first, then optionally by phone
      let query = supabase
        .from("patients")
        .select("id, name, phone, age, gender")
        .eq("is_active", true);

      // CRITICAL: Always filter by lab_id to avoid cross-lab patient matches
      if (userLabId) {
        query = query.eq("lab_id", userLabId);
        console.log(`  Filtering patients by lab_id: ${userLabId}`);
      } else {
        console.warn("⚠️ WARNING: No lab_id available, matching against ALL labs' patients!");
      }

      if (searchPhone) {
        // Filter by phone for better performance and accuracy
        query = query.ilike("phone", `%${searchPhone}%`);
      }

      const { data: patients } = await query.limit(100);

      if (patients && patients.length > 0) {
        const searchName = extractedData.patientInfo.name?.toLowerCase() || "";

        // Track ALL potential matches to find the BEST one
        let bestMatch = null;
        let bestScore = 0;

        for (const patient of patients) {
          const patientName = patient.name?.toLowerCase() || "";
          const patientPhone = patient.phone?.replace(/\D/g, "") || "";

          let matchScore = 0;
          let nameMatchScore = 0;
          let matchReason = "";

          // Calculate name match score first
          if (searchName && patientName) {
            if (patientName === searchName) {
              nameMatchScore = 1.0;
            } else if (
              patientName.includes(searchName) ||
              searchName.includes(patientName)
            ) {
              nameMatchScore = 0.7;
            } else {
              // Levenshtein distance for fuzzy matching
              const distance = levenshteinDistance(searchName, patientName);
              const maxLen = Math.max(searchName.length, patientName.length);
              const similarity = 1 - (distance / maxLen);
              if (similarity > 0.6) {
                nameMatchScore = similarity;
              }
            }
          }

          // Phone match with name verification
          if (searchPhone && patientPhone && searchPhone === patientPhone) {
            // Phone matches - verify name as well
            if (nameMatchScore >= 0.6) {
              // Both phone and name match - high confidence (BEST MATCH)
              matchScore = 0.95;
              matchReason = "phone_and_name";
            } else if (!searchName) {
              // Phone matches but no name provided in TRF
              matchScore = 0.85;
              matchReason = "phone_only";
            } else {
              // Phone matches but name doesn't match - possible wrong patient
              matchScore = 0.75;
              matchReason = "phone_only_name_mismatch";
            }
          } // Name-only match (no phone in TRF or no phone match)
          else if (nameMatchScore >= 0.8) {
            matchScore = nameMatchScore * 0.9;
            matchReason = "name_only";
          }

          // Keep track of BEST match (highest score)
          if (matchScore > bestScore) {
            bestScore = matchScore;
            bestMatch = {
              id: patient.id,
              name: patient.name,
              phone: patient.phone,
              matchConfidence: matchScore,
              matchReason: matchReason,
            };
          }
        }

        // Only use match if score is above threshold
        if (bestMatch && bestScore > 0.7) {
          matchedPatient = bestMatch;
          console.log(
            `✓ Best patient match found: ${bestMatch.name} (${bestMatch.phone}) - Score: ${
              bestScore.toFixed(2)
            } (${bestMatch.matchReason})`,
          );
        } else {
          console.log(
            `⚠ No confident patient match found (best score: ${
              bestScore.toFixed(2)
            })`,
          );
        }
      }
    }

    // Step 4.5: Match doctor with existing records (fuzzy search with normalization)
    let matchedDoctor = null;
    if (extractedData.doctorInfo?.name) {
      const doctorName = extractedData.doctorInfo.name;
      console.log(`🔍 Searching for doctor: "${doctorName}"`);

      // Normalize doctor name: remove periods, collapse spaces
      const normalizeDocName = (name: string) =>
        name.toLowerCase()
          .replace(/\./g, "") // Remove periods (Dr. -> Dr)
          .replace(/\s+/g, " ") // Collapse multiple spaces
          .trim();

      const searchName = normalizeDocName(doctorName);
      console.log(`   Normalized search: "${searchName}"`);

      // Query active doctors — filter by lab_id if available
      let doctorQuery = supabase
        .from("doctors")
        .select("id, name, specialization")
        .eq("is_active", true);

      if (userLabId) {
        doctorQuery = doctorQuery.eq("lab_id", userLabId);
        console.log(`  Filtering doctors by lab_id: ${userLabId}`);
      }

      const { data: doctors, error: doctorError } = await doctorQuery;

      if (doctorError) {
        console.error("❌ Error fetching doctors:", doctorError);
      } else if (doctors && doctors.length > 0) {
        console.log(`   Found ${doctors.length} active doctors to search`);

        let bestDoctorMatch = null;
        let bestDoctorScore = 0;

        for (const doctor of doctors) {
          const docName = normalizeDocName(doctor.name || "");
          let matchScore = 0;

          // Exact match after normalization
          if (docName === searchName) {
            matchScore = 1.0;
            console.log(
              `   ✓ Exact match: "${doctor.name}" (normalized: "${docName}")`,
            );
          } // Substring match (handles "Dr Anand" matching "Dr Anand Priyadarshi")
          else if (
            docName.includes(searchName) || searchName.includes(docName)
          ) {
            matchScore = 0.8;
            console.log(
              `   ~ Partial match: "${doctor.name}" (normalized: "${docName}") - Score: ${matchScore}`,
            );
          }

          if (matchScore > bestDoctorScore) {
            bestDoctorMatch = doctor;
            bestDoctorScore = matchScore;
          }
        }

        // Use match if score is above threshold
        if (bestDoctorMatch && bestDoctorScore >= 0.7) {
          matchedDoctor = {
            id: bestDoctorMatch.id,
            name: bestDoctorMatch.name,
            specialization: bestDoctorMatch.specialization,
            matchConfidence: bestDoctorScore,
          };
          console.log(
            `✓ Best doctor match: "${bestDoctorMatch.name}" (ID: ${bestDoctorMatch.id}) - Score: ${
              bestDoctorScore.toFixed(2)
            }`,
          );
        } else {
          console.log(
            `⚠ No confident doctor match found (best score: ${
              bestDoctorScore.toFixed(2)
            })`,
          );
        }
      } else {
        console.log(`   No active doctors found in database`);
      }
    } else {
      console.log(`   No doctor name extracted from TRF`);
    }

    // Step 5: Match test names with test_groups
    if (
      extractedData.requestedTests &&
      Array.isArray(extractedData.requestedTests)
    ) {
      console.log(
        `📋 Matching ${extractedData.requestedTests.length} tests against test_groups...`,
      );
      console.log(
        `📋 Tests from AI:`,
        extractedData.requestedTests.map((t: any) =>
          `"${t.testName}" (selected: ${t.isSelected})`
        ).join(", "),
      );

      // CRITICAL: Filter by lab_id to only match tests from this lab!
      let testGroupsQuery = supabase
        .from("test_groups")
        .select("id, name, code")
        .eq("is_active", true);

      // Add lab_id filter if available
      if (userLabId) {
        testGroupsQuery = testGroupsQuery.eq("lab_id", userLabId);
        console.log(`  Filtering test groups by lab_id: ${userLabId}`);
      } else {
        console.warn(
          "⚠️ WARNING: No lab_id available, matching against ALL labs' tests!",
        );
      }

      const { data: testGroups, error: testGroupsError } =
        await testGroupsQuery;

      if (testGroupsError) {
        console.error("❌ Failed to fetch test groups:", testGroupsError);
      } else {
        console.log(
          `✓ Found ${testGroups?.length || 0} active test groups for lab ${
            userLabId || "ALL LABS"
          }`,
        );
        console.log(
          `📋 Sample test groups:`,
          testGroups?.slice(0, 10).map((g) => `"${g.name}" (${g.code})`).join(
            ", ",
          ),
        );
      }

      if (testGroups && testGroups.length > 0) {
        extractedData.requestedTests = extractedData.requestedTests.map(
          (test: any) => {
            const testName = test.testName?.toLowerCase() || "";
            let bestMatch = null;
            let bestScore = 0;

            console.log(`🔍 Matching test: "${test.testName}"`);

            for (const group of testGroups) {
              const groupName = group.name?.toLowerCase() || "";
              const groupCode = group.code?.toLowerCase() || "";

              if (groupName === testName || groupCode === testName) {
                bestMatch = group;
                bestScore = 1.0;
                console.log(`  ✓ Exact match found: "${group.name}"`);
                break;
              } else if (
                groupName.includes(testName) || testName.includes(groupName)
              ) {
                const score = 0.8;
                if (score > bestScore) {
                  bestMatch = group;
                  bestScore = score;
                  console.log(
                    `  ~ Partial match: "${group.name}" (score: ${score})`,
                  );
                }
              }
            }

            const result = {
              ...test,
              testGroupId: bestMatch?.id || null,
              matched: bestScore > 0.7,
              matchedTestName: bestMatch?.name || null,
              matchConfidence: bestScore,
            };

            if (bestMatch) {
              console.log(
                `✓ Test "${test.testName}" -> Matched "${bestMatch.name}" (${bestScore})`,
              );
            } else {
              console.log(`❌ Test "${test.testName}" -> NO MATCH FOUND`);
            }

            return result;
          },
        );

        const matchedCount = extractedData.requestedTests.filter((t: any) =>
          t.matched
        ).length;
        console.log(
          `📊 Test matching complete: ${matchedCount}/${extractedData.requestedTests.length} matched`,
        );
      }
    }

    // Step 6: Update attachment metadata
    if (attachmentId) {
      await supabase
        .from("attachments")
        .update({
          ai_processed: true,
          ai_confidence: extractedData.patientInfo?.confidence || 0.8,
          ai_extracted_data: {
            patientInfo: extractedData.patientInfo,
            requestedTests: extractedData.requestedTests,
            doctorInfo: extractedData.doctorInfo,
            matchedPatient,
            matchedDoctor,
          },
        })
        .eq("id", attachmentId);
    }

    const response: TRFExtractionResponse = {
      success: true,
      patientInfo: extractedData.patientInfo,
      requestedTests: extractedData.requestedTests,
      doctorInfo: extractedData.doctorInfo,
      clinicalNotes: extractedData.clinicalNotes,
      location: extractedData.location,
      sampleCollectionDate: extractedData.sampleCollectionDate,
      urgency: extractedData.urgency || "Normal",
      matchedPatient,
      matchedDoctor,
      metadata: {
        ocrMethod: "Google Vision AI + Gemini NLP",
        textLength: fullText.length,
        processingTime: Date.now(),
      },
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("TRF extraction error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

// Levenshtein distance for fuzzy string matching
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = Array.from(
    { length: m + 1 },
    () => Array(n + 1).fill(0),
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}
