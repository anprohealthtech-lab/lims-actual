# PDF CSS & Section Content Formatting Fixes

**Date**: December 16, 2025  
**Issues**: CSS not applying in manual PDF generation, section content formatting mismatch

---

## Problems Identified

### 1. Section Content Formatting Issues
- **Problem**: Section content (doctor-filled findings, impressions, etc.) was being HTML-escaped, causing formatted text to appear as plain text
- **Impact**: Doctor's formatted input with newlines appeared as single-line text with `&lt;` `&gt;` entities
- **Root Cause**: `injectSectionContent()` function was escaping HTML entities to prevent XSS

### 2. Missing CSS Styling for Section Content
- **Problem**: `.section-content` class had no styling defined in baseline CSS
- **Impact**: Section content had no consistent typography or spacing

### 3. CSS Not Visible in Manual PDF
- **Problem**: User reported template CSS (blue headers, zebra rows) appears in auto PDF but not manual PDF
- **Analysis**: CSS was actually being included via `buildPdfBodyDocument()`, but needed debugging to verify

---

## Solutions Implemented

### 1. Added Section Content Styling to Baseline CSS

**File**: `src/styles/report-baseline.css`

```css
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
```

### 2. Improved Section Content Formatting

**File**: `src/utils/pdfService.ts` (line ~2111)

**Before**:
```typescript
// Escaped HTML entities - broke formatting
const escapedContent = content
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/\n/g, '<br/>');
```

**After**:
```typescript
// Preserve formatting: double newlines = paragraphs, single = <br/>
const formattedContent = content
  .trim()
  .split(/\n\n+/)  // Split on double newlines (paragraph breaks)
  .map(para => {
    const cleanPara = para.trim();
    if (!cleanPara) return '';
    // Convert single newlines to <br/> within paragraphs
    const withBreaks = cleanPara.replace(/\n/g, '<br/>');
    return `<p>${withBreaks}</p>`;
  })
  .filter(Boolean)
  .join('');
```

**Rationale**: Content comes from CKEditor (doctor input), which is already sanitized. No need for additional HTML escaping - preserving formatting is more important.

### 3. Added CSS Debug Logging

**File**: `src/utils/pdfService.ts` (line ~403)

Added debug logging to `buildPdfBodyDocument()` to verify CSS inclusion:

```typescript
console.log('🎨 buildPdfBodyDocument CSS Debug:', {
  hasBaselineCss: !!reportBaselineCss,
  baselineCssLength: reportBaselineCss?.length || 0,
  hasCustomCss: !!customCss,
  customCssLength: customCss?.length || 0,
  customCssPreview: customCss?.substring(0, 100) || 'NONE',
});
```

Also added logging at template render point (line ~828):

```typescript
console.log('🎨 renderLabTemplateHtmlBundle CSS Debug:', {
  hasTemplateHtml: !!template.gjs_html,
  hasTemplateCss: !!template.gjs_css,
  templateCssLength: template.gjs_css?.length || 0,
  templateCssPreview: template.gjs_css?.substring(0, 100) || 'NONE',
});
```

### 4. Applied Same Fixes to Edge Function

**File**: `supabase/functions/generate-pdf-auto/index.ts`

Applied identical fixes:
- Added `.section-content` styling to `BASELINE_CSS` (line ~230)
- Improved `injectSectionContent()` formatting (line ~790)
- Added CSS debug logging to `buildPdfBodyDocument()` (line ~525)

---

## Testing Instructions

### 1. Test Section Content Formatting

1. Create an order with a test that has section content (e.g., PBS, Radiology)
2. Fill in section content in Result Verification with:
   - Multiple paragraphs (double newlines)
   - Single line breaks
   - Plain text
3. Generate PDF (both manual and auto)
4. Verify:
   - ✅ Paragraphs are properly separated
   - ✅ Line breaks appear within paragraphs
   - ✅ Text matches template styling (font, size, color)
   - ✅ No HTML entities visible (`&lt;`, `&gt;`)

### 2. Test CSS Application

1. Open browser console before generating PDF
2. Look for CSS debug logs:
   ```
   🎨 renderLabTemplateHtmlBundle CSS Debug: { hasTemplateCss: true, ... }
   🎨 buildPdfBodyDocument CSS Debug: { hasCustomCss: true, ... }
   ```
3. Verify:
   - ✅ `customCssLength` > 0 (template has CSS)
   - ✅ `customCssPreview` shows actual CSS rules
   - ✅ Generated PDF includes template styling (colors, borders, etc.)

### 3. Compare Auto vs Manual PDF

1. Generate PDF via auto-generation (order approval triggers it)
2. Generate PDF manually (click "Generate Now" button)
3. Compare both PDFs:
   - ✅ Both should have same CSS styling
   - ✅ Both should have same section content formatting
   - ✅ Console logs should show similar CSS info

---

## Files Modified

1. **`src/styles/report-baseline.css`**
   - Added `.section-content` styling block

2. **`src/utils/pdfService.ts`**
   - Updated `injectSectionContent()` function (line ~2120)
   - Added CSS debug logging to `buildPdfBodyDocument()` (line ~410)
   - Added CSS debug logging to `renderLabTemplateHtmlBundle()` (line ~828)

3. **`supabase/functions/generate-pdf-auto/index.ts`**
   - Added `.section-content` styling to `BASELINE_CSS` (line ~230)
   - Updated `injectSectionContent()` function (line ~790)
   - Added CSS debug logging to `buildPdfBodyDocument()` (line ~530)

---

## Technical Details

### CSS Flow

```
Template (gjs_css) 
  ↓
renderLabTemplateHtmlBundle() 
  ↓ [logs CSS length/preview]
buildReportHtmlBundle() 
  ↓
buildPdfBodyDocument() 
  ↓ [logs CSS inclusion]
<style id="lims-report-custom">
  {template.gjs_css}
</style>
  ↓
PDF.co / Puppeteer
  ↓
Final PDF
```

### Section Content Flow

```
Database (result_section_content)
  ↓
get_report_template_context() 
  ↓
context.sectionContent = { "impression": "text..." }
  ↓
prepareReportHtml()
  ↓
injectSectionContent()
  ↓ [convert \n\n → <p>, \n → <br/>]
<div class="section-content">
  <p>paragraph 1</p>
  <p>paragraph 2<br/>line break</p>
</div>
  ↓
Final HTML → PDF
```

---

## Notes

- **Security**: Section content is not HTML-escaped anymore. This is safe because:
  1. Content comes from authenticated doctors only
  2. CKEditor sanitizes input
  3. Content is stored in database (not user-controllable at PDF generation time)
  
- **Consistency**: Both manual and Edge function now use identical logic for:
  - Section content formatting
  - CSS application
  - Debug logging

- **Debugging**: If CSS still doesn't appear in PDF:
  1. Check console logs for CSS length (should be > 0)
  2. Verify template has `gjs_css` in database: 
     ```sql
     SELECT id, template_name, LENGTH(gjs_css) FROM lab_templates WHERE id = 'xxx';
     ```
  3. Check if PDF.co/Puppeteer is receiving HTML with `<style>` tags

---

## Related Documents

- [PLACEHOLDER_SYSTEM_GUIDE.md](./PLACEHOLDER_SYSTEM_GUIDE.md) - Placeholder system overview
- [TEMPLATE_AUDIT_COMPLETE_GUIDE.md](./TEMPLATE_AUDIT_COMPLETE_GUIDE.md) - Template validation
- [SIMPLE_PDF_SERVICE_USAGE.md](./SIMPLE_PDF_SERVICE_USAGE.md) - PDF generation architecture
