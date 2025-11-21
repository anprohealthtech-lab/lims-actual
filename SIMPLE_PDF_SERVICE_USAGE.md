# Simple PDF Service Usage Guide

## Overview

The new `pdfServiceSimple.ts` provides two clean functions:

1. **View Draft Report** - Opens HTML in browser (user can print with Ctrl+P)
2. **Generate Final Report** - Creates PDF with Puppeteer and saves to Supabase Storage

## Key Benefits

✅ **No PDF.co dependency** for viewing reports  
✅ **Simplified codebase** - only ~450 lines vs 3400+ lines in legacy service  
✅ **Browser-native printing** - users control their PDF generation for drafts  
✅ **Puppeteer for finals** - fast, reliable PDF generation for approved reports  

---

## Usage Examples

### 1. View Draft Report (Opens HTML in Browser)

```typescript
import { viewDraftReportInBrowser } from '../utils/pdfServiceSimple';

// In your component
const handleViewDraft = async (orderId: string) => {
  try {
    await viewDraftReportInBrowser(orderId, (message) => {
      console.log(message); // Show progress to user
    });
    // User can now use Ctrl+P or browser print to generate PDF
  } catch (error) {
    alert('Failed to view report: ' + error.message);
  }
};
```

**User Experience:**
1. Click "View Draft" button
2. New browser window opens with formatted HTML report
3. User can review, then press `Ctrl+P` (or Cmd+P on Mac)
4. Browser's native print dialog allows Save as PDF

---

### 2. Generate Final Report (PDF saved to Storage)

```typescript
import { generateFinalReport } from '../utils/pdfServiceSimple';

// In your component
const [progress, setProgress] = useState('');
const [percent, setPercent] = useState(0);

const handleGenerateFinal = async (orderId: string) => {
  try {
    const result = await generateFinalReport(
      orderId,
      (message, percent) => {
        setProgress(message);
        if (percent) setPercent(percent);
      }
    );
    
    console.log('PDF URL:', result.pdfUrl);
    console.log('Report ID:', result.reportId);
    
    // Open or download the PDF
    window.open(result.pdfUrl, '_blank');
  } catch (error) {
    alert('Failed to generate report: ' + error.message);
  }
};
```

**Progress Messages:**
- Loading report data... (10%)
- Loading template... (20%)
- Rendering HTML... (30%)
- Generating PDF... (50%)
- Uploading to storage... (80%)
- Saving report record... (90%)
- Complete! (100%)

---

## Integration with Reports.tsx

### Replace existing button handlers:

#### For "View Draft" button:
```typescript
// OLD (complex PDF.co call):
onClick={() => handleOrderTemplatePreview(group)}

// NEW (simple HTML view):
onClick={async () => {
  try {
    await viewDraftReportInBrowser(group.order_id, (msg) => {
      console.log(msg);
    });
  } catch (error) {
    alert('Failed to open draft: ' + error.message);
  }
}}
```

#### For "Generate Final" button:
```typescript
// OLD (handleDownload with complex logic):
onClick={() => handleDownload(group.order_id, false)}

// NEW (simple final report):
onClick={async () => {
  setIsGenerating(true);
  try {
    const result = await generateFinalReport(
      group.order_id,
      (message, percent) => {
        console.log(`${percent}%: ${message}`);
      }
    );
    
    // Refresh results to show new PDF URL
    await loadApprovedResults();
    
    alert('Report generated successfully!');
  } catch (error) {
    alert('Failed to generate: ' + error.message);
  } finally {
    setIsGenerating(false);
  }
}}
```

---

## Technical Details

### HTML Structure

Both functions use the same template rendering pipeline:

1. Load `ReportTemplateContext` from database
2. Get lab's active template from `lab_templates`
3. Render template with Nunjucks
4. Build complete HTML document with:
   - Baseline CSS (`reportBaselineCss`)
   - Template custom CSS
   - Header/footer from lab branding

### Differences:

**View (Browser):**
```html
<div class="limsv2-report">
  <header>...</header>
  <main class="limsv2-report-body">
    <!-- Rendered template -->
  </main>
  <footer>...</footer>
</div>
```

**PDF (Print-optimized):**
```html
<div class="limsv2-report limsv2-report--print">
  <header class="limsv2-report-header">...</header>
  <main class="limsv2-report-body limsv2-report-body--print">
    <!-- Rendered template -->
  </main>
  <footer class="limsv2-report-footer">...</footer>
</div>
```

Plus additional print CSS:
```css
@media print {
  body { margin: 0; }
  .limsv2-report { page-break-inside: avoid; }
}
```

---

## File Storage

Final reports are saved to Supabase Storage:

**Path structure:**
```
attachments/
  reports/
    {lab_id}/
      {order_id}/
        {PatientName}_{OrderId}_{Timestamp}.pdf
```

**Example:**
```
attachments/reports/abc-123-def/order-456/John_Doe_order-456_2025-11-21T10-30-00Z.pdf
```

**Database record:**
```sql
INSERT INTO reports (
  order_id,
  patient_id,
  report_type,  -- 'final'
  status,       -- 'completed'
  pdf_url,      -- Public URL
  file_path,    -- Storage path
  generated_at
)
```

---

## Error Handling

Both functions throw descriptive errors:

```typescript
try {
  await generateFinalReport(orderId);
} catch (error) {
  // Possible errors:
  // - "Failed to load report data"
  // - "No active template found"
  // - "Cannot generate final report: Not all results are approved"
  // - "Failed to upload PDF: {reason}"
  console.error(error.message);
}
```

---

## Migration Path

### Phase 1: Side-by-side (Recommended)
- Keep legacy `pdfService.ts` untouched
- Add new buttons using `pdfServiceSimple.ts`
- Test with real users

### Phase 2: Gradual replacement
- Replace "View Draft" buttons first (safest)
- Monitor user feedback on browser print experience
- Replace "Generate Final" buttons once confident

### Phase 3: Legacy cleanup (Future)
- Remove unused functions from `pdfService.ts`
- Update imports across codebase
- Archive old implementation for reference

---

## Advantages Over Legacy Service

| Feature | Legacy Service | Simple Service |
|---------|---------------|----------------|
| Lines of code | 3,434 | ~450 |
| Draft viewing | PDF.co API call | Browser HTML |
| Final generation | PDF.co or Puppeteer | Puppeteer only |
| Dependencies | Many utilities | Minimal |
| User control | None (server-side) | Full (browser print) |
| Cost | PDF.co API costs | No API costs for viewing |
| Speed | Network latency | Instant HTML view |
| Maintenance | Complex | Simple |

---

## Browser Print Experience

When users view draft reports:

1. **Chrome/Edge**: Print dialog → "Save as PDF" → Choose quality/margins
2. **Firefox**: Print → "Save to PDF" destination
3. **Safari**: Print → PDF button → Save as PDF

**Advantages:**
- Users can adjust margins, orientation, scale
- No server processing for drafts
- Works offline once HTML is loaded
- Familiar UI (standard OS print dialog)

---

## Next Steps

1. ✅ Create simplified service (`pdfServiceSimple.ts`)
2. ⏳ Update Reports.tsx to use new functions
3. ⏳ Test with sample orders
4. ⏳ Deploy and monitor
5. ⏳ Gather user feedback
6. ⏳ Plan legacy service deprecation

---

## Questions?

- **Q: What if user can't print from browser?**  
  A: Keep legacy "Download PDF" button as fallback

- **Q: Can we still use PDF.co?**  
  A: Yes, legacy service remains available

- **Q: What about multi-template reports?**  
  A: Not yet supported - add template selection logic to `renderTemplateToHtml()`

- **Q: Header/footer in browser view?**  
  A: Already included in HTML - browser will respect them in print

- **Q: What if Puppeteer fails?**  
  A: Error is thrown - you can add PDF.co fallback in calling code
