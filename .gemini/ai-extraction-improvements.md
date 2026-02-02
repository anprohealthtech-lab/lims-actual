# AI Extraction Improvements Summary

## Date: 2026-01-24

## Issues Addressed

### 1. AI Test Configurator - JSON Truncation Error
**Problem**: `SyntaxError: Unterminated string in JSON at position 6450` - AI response was being cut off mid-JSON.

**Root Cause**: `maxOutputTokens` was set to 2048, which was insufficient for complex test configurations.

**Solution**:
- Switched from Gemini to **Anthropic Claude Haiku 4.5** (`claude-haiku-4-5-20251001`)
- Increased `max_tokens` from 2048 to **15000**
- Added better error logging with response snippets
- Added JSON extraction logic to handle markdown-wrapped responses

**Files Modified**:
- `supabase/functions/ai-test-configurator/index.ts`

---

### 2. Gemini NLP - Poor Parameter Matching (1/11 matched)
**Problem**: Only 1 out of 11 extracted parameters were being matched to database analytes because the matching logic required exact name matches.

**Root Cause**: Simple exact match logic couldn't handle:
- Medical abbreviations (WBC, RBC, HGB, etc.)
- Variations in naming (Hemoglobin vs HGB vs Hb)
- Partial matches

**Solution**: Implemented **comprehensive fuzzy matching** with:
1. **Exact match** (case-insensitive)
2. **Abbreviation mapping** for 50+ common medical abbreviations
3. **Reverse lookup** (check if param is in analyte's abbreviation list)
4. **Partial matching** (substring matching)
5. **Word-based fuzzy matching** (key word overlap)

**Abbreviations Supported**:
- CBC: WBC, RBC, HGB, HCT, PLT, MCV, MCH, MCHC, RDW, MPV
- Differential: NEU/NEUX, LYM, MON/MONX, EOS/E05, BAS
- Chemistry: GLU, BUN, CR, NA, K, CL, CA, MG
- Liver: ALT, AST, ALP, TBIL, DBIL, TP, ALB
- Thyroid: TSH, T3, T4, FT3, FT4
- Lipids: CHOL, LDL, HDL, VLDL, TG
- And many more...

**Files Modified**:
- `supabase/functions/gemini-nlp/index.ts`

---

### 3. Claude Validation Enhancement (NEW FEATURE)
**Problem**: Need medical validation and ability to find missing parameters from OCR text.

**Solution**: Added **optional Claude Haiku 4.5 validation step** for OCR reports that:
1. **Validates** medical accuracy of extracted parameters
2. **Finds missing parameters** from the original OCR text that Gemini missed
3. **Corrects errors** in units, values, flags, and reference ranges
4. **Stays within token limits** by truncating OCR text to 3000 chars

**When Applied**:
- Only for `ocr_report` or `documentType` processing
- Only when `ANTHROPIC_API_KEY` is configured
- Falls back gracefully if validation fails

**Benefits**:
- Higher accuracy and completeness
- Medical validation of extracted data
- Catches parameters that initial extraction missed
- Corrects common OCR errors

**Files Modified**:
- `supabase/functions/gemini-nlp/index.ts`

---

### 4. Token Limit Increases Across Functions
Updated token limits in multiple functions for better handling of complex data:

| Function | Old Limit | New Limit | Model |
|----------|-----------|-----------|-------|
| `ai-test-configurator` | 2048 | 15000 | Claude Haiku 4.5 |
| `resolve-reference-ranges` | 2000 | 15000 | Claude Haiku 4.5 |
| `generate-pdf-oneshot` | 4000 | 15000 | Claude Haiku 4.5 |
| `gemini-nlp` (validation) | N/A | 10000 | Claude Haiku 4.5 |

---

## Deployment Instructions

Deploy the updated functions:

```bash
# Deploy all updated functions
supabase functions deploy ai-test-configurator
supabase functions deploy resolve-reference-ranges
supabase functions deploy generate-pdf-oneshot
supabase functions deploy gemini-nlp
```

**Note**: Ensure `ANTHROPIC_API_KEY` is set in Supabase secrets for Claude features to work.

---

## Expected Improvements

### Before:
- ❌ JSON truncation errors on complex test configurations
- ❌ Only 1/11 parameters matched (9% match rate)
- ❌ No validation or error correction
- ❌ Missing parameters not detected

### After:
- ✅ No truncation with 8192 token limit
- ✅ Expected 9-11/11 parameters matched (80-100% match rate)
- ✅ Medical validation with Claude
- ✅ Missing parameters detected and added
- ✅ Automatic error correction

---

## Testing Recommendations

1. **Test ai-test-configurator** with complex test groups (CBC, CMP, Lipid Panel)
2. **Test gemini-nlp** with OCR reports containing:
   - Abbreviated parameter names (WBC, RBC, etc.)
   - Multiple parameters (10+ tests)
   - Common OCR errors
3. **Verify Claude validation** is working by checking metadata field `validationApplied: true`
4. **Monitor logs** for match rates and validation success

---

## Rollback Plan

If issues occur, revert to Gemini for ai-test-configurator:
1. Change model back to `gemini-2.0-flash-exp`
2. Set `maxOutputTokens: 2048`
3. Remove Anthropic API call logic

For gemini-nlp, the fuzzy matching is backward compatible and won't break existing functionality.
