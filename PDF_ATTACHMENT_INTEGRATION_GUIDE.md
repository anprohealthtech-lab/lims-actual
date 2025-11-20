# PDF Generation with Attachments - Modular Integration Guide

## Overview
This guide explains how to modularly integrate uploaded files/attachments into the final PDF report during result entry. The system already has robust PDF generation and file attachment capabilities that can be extended.

---

## Current Architecture

### 1. **PDF Generation System**

#### **Two Providers:**
- **Puppeteer Service** (Primary - Fast ~3.5s)
  - Location: `puppeteer-service/src/server.ts`
  - Endpoint: `https://plankton-app-oakzv.ondigitalocean.app/generate-pdf`
  - Accepts: HTML content + options
  - Returns: Base64 PDF

- **PDF.co API** (Fallback - Reliable ~10s)
  - Location: `src/utils/pdfService.ts`
  - Function: `sendHtmlToPdfCo()`
  - Auto-fallback enabled

#### **PDF Types:**
1. **E-Copy PDF** - Full digital report with watermarks, logos, headers/footers
2. **Print PDF** - Optimized for physical letterhead (80px top padding, no backgrounds)

#### **Key Functions:**
```typescript
// Main PDF generation entry point
src/utils/pdfService.ts:
- buildReportHtmlBundle() - Creates HTML bundle with header/body/footer
- generatePDFWithPuppeteer() - Puppeteer generation
- sendHtmlToPdfCo() - PDF.co generation
- convertImageUrlToBase64() - Converts images to base64 for embedding
```

---

### 2. **Attachment System**

#### **Database Table: `attachments`**
```sql
- id (uuid)
- order_id (uuid) - Links to orders
- test_group_id (uuid) - Optional: specific test group
- file_url (text) - Public URL
- file_path (text) - Storage path
- file_type (text) - MIME type
- file_size (integer)
- uploaded_by (uuid)
- upload_timestamp (timestamp)
- description (text)
- upload_context (jsonb) - Metadata
```

#### **Storage Locations:**
- **TRF Uploads:** `attachments/labs/{labId}/trf-uploads/`
- **Result Attachments:** `attachments/labs/{labId}/orders/{orderId}/`
- **Test-Specific:** `attachments/labs/{labId}/orders/{orderId}/tests/{testGroupId}/`

#### **Key Functions:**
```typescript
src/utils/supabase.ts:
- uploadFile() - Single file upload
- AttachmentService.upload() - Upload with metadata
- AttachmentService.uploadMultiple() - Batch upload with optimization
- AttachmentService.getByOrder() - Fetch order attachments
- AttachmentService.getByTest() - Fetch test-specific attachments
```

---

### 3. **Result Entry System**

#### **Manual Entry Form:**
Location: `src/components/Results/EntryMode/ManualEntryForm.tsx`

Current flow:
1. User enters result values
2. Saves to `result_values` table
3. Links to `results` table via `result_id`

**Missing:** Attachment upload during result entry

---

## Proposed Modular Solution

### **Architecture: Attachment-Aware PDF Generation**

```
┌─────────────────────────────────────────────────────────────┐
│                    Result Entry Flow                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Manual Entry Form                                       │
│     ├─ Enter result values                                  │
│     ├─ Upload attachments (NEW)                             │
│     └─ Save to database                                     │
│                                                             │
│  2. Attachment Processing                                   │
│     ├─ Upload to Supabase Storage                           │
│     ├─ Create attachment records                            │
│     └─ Link to order/test_group                             │
│                                                             │
│  3. PDF Generation (Enhanced)                               │
│     ├─ Fetch order data + attachments                       │
│     ├─ Convert images to base64                             │
│     ├─ Inject into report template                          │
│     └─ Generate PDF with embedded images                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Steps

### **Step 1: Extend Result Entry Form**

**File:** `src/components/Results/EntryMode/ManualEntryForm.tsx`

```typescript
// Add state for attachments
const [attachments, setAttachments] = useState<File[]>([]);
const [uploadedAttachments, setUploadedAttachments] = useState<any[]>([]);

// Add file input handler
const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
  const files = Array.from(event.target.files || []);
  setAttachments(prev => [...prev, ...files]);
};

// Modify handleSubmit to upload attachments
const handleSubmit = async () => {
  setSaving(true);
  
  try {
    // ... existing result submission code ...
    
    // Upload attachments if any
    if (attachments.length > 0) {
      const uploadResults = await AttachmentService.uploadMultiple(
        attachments,
        {
          orderId: order.id,
          testGroupId: testGroup.id,
          scope: 'test', // or 'order' for order-level
          userId: user?.id || '',
          labId: order.lab_id
        }
      );
      
      setUploadedAttachments(uploadResults.successful);
      console.log(`Uploaded ${uploadResults.successful.length} attachments`);
    }
    
    onSubmit(resultsWithFlags);
  } catch (error) {
    console.error('Error submitting results:', error);
  } finally {
    setSaving(false);
  }
};
```

**Add UI Component:**
```tsx
<div className="mt-4 border-t pt-4">
  <label className="block text-sm font-medium text-gray-700 mb-2">
    Attach Supporting Documents (Optional)
  </label>
  <input
    type="file"
    multiple
    accept="image/*,.pdf"
    onChange={handleFileUpload}
    className="block w-full text-sm text-gray-500
      file:mr-4 file:py-2 file:px-4
      file:rounded-md file:border-0
      file:text-sm file:font-semibold
      file:bg-blue-50 file:text-blue-700
      hover:file:bg-blue-100"
  />
  
  {/* Preview uploaded files */}
  {attachments.length > 0 && (
    <div className="mt-2 space-y-1">
      {attachments.map((file, idx) => (
        <div key={idx} className="flex items-center text-sm text-gray-600">
          <FileIcon className="h-4 w-4 mr-2" />
          {file.name} ({(file.size / 1024).toFixed(1)} KB)
        </div>
      ))}
    </div>
  )}
</div>
```

---

### **Step 2: Create Attachment Injection Module**

**New File:** `src/utils/pdfAttachmentInjector.ts`

```typescript
import { supabase } from './supabase';

export interface AttachmentInjectionOptions {
  orderId: string;
  testGroupId?: string;
  position?: 'before-results' | 'after-results' | 'appendix';
  maxWidth?: string;
  includeCaption?: boolean;
}

/**
 * Fetch and prepare attachments for PDF injection
 */
export const prepareAttachmentsForPDF = async (
  options: AttachmentInjectionOptions
): Promise<string> => {
  const { orderId, testGroupId, position = 'after-results', maxWidth = '100%', includeCaption = true } = options;
  
  // Fetch attachments
  let query = supabase
    .from('attachments')
    .select('*')
    .eq('order_id', orderId)
    .order('upload_timestamp', { ascending: true });
  
  if (testGroupId) {
    query = query.eq('test_group_id', testGroupId);
  }
  
  const { data: attachments, error } = await query;
  
  if (error || !attachments || attachments.length === 0) {
    return ''; // No attachments to inject
  }
  
  // Filter for image types only (PDFs would need different handling)
  const imageAttachments = attachments.filter(att => 
    att.file_type?.startsWith('image/')
  );
  
  if (imageAttachments.length === 0) {
    return '';
  }
  
  // Convert images to base64 and build HTML
  const imageHtmlPromises = imageAttachments.map(async (attachment) => {
    try {
      // Fetch image from storage
      const { data: fileData } = await supabase.storage
        .from('attachments')
        .download(attachment.file_path);
      
      if (!fileData) {
        console.warn(`Failed to download attachment: ${attachment.id}`);
        return '';
      }
      
      // Convert to base64
      const arrayBuffer = await fileData.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      const dataUrl = `data:${attachment.file_type};base64,${base64}`;
      
      // Build HTML with optional caption
      const caption = includeCaption && attachment.description 
        ? `<p class="attachment-caption" style="text-align: center; font-size: 12px; color: #666; margin-top: 8px;">${attachment.description}</p>`
        : '';
      
      return `
        <div class="attachment-container" style="margin: 20px 0; page-break-inside: avoid;">
          <img 
            src="${dataUrl}" 
            alt="${attachment.description || 'Attachment'}"
            style="max-width: ${maxWidth}; height: auto; display: block; margin: 0 auto; border: 1px solid #ddd; border-radius: 4px;"
            data-attachment-id="${attachment.id}"
          />
          ${caption}
        </div>
      `;
    } catch (error) {
      console.error(`Error processing attachment ${attachment.id}:`, error);
      return '';
    }
  });
  
  const imageHtmlArray = await Promise.all(imageHtmlPromises);
  const attachmentsHtml = imageHtmlArray.filter(html => html).join('\n');
  
  // Wrap in section with header
  if (!attachmentsHtml) {
    return '';
  }
  
  return `
    <div class="attachments-section" style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #e5e7eb;">
      <h3 style="font-size: 16px; font-weight: 600; color: #1f2937; margin-bottom: 15px;">
        Supporting Documents
      </h3>
      ${attachmentsHtml}
    </div>
  `;
};

/**
 * Inject attachments into report HTML at specified position
 */
export const injectAttachmentsIntoReport = (
  reportHtml: string,
  attachmentsHtml: string,
  position: 'before-results' | 'after-results' | 'appendix' = 'after-results'
): string => {
  if (!attachmentsHtml) {
    return reportHtml;
  }
  
  switch (position) {
    case 'before-results':
      // Insert before first table or result section
      return reportHtml.replace(
        /(<table[^>]*class="[^"]*result-table[^"]*"[^>]*>)/i,
        `${attachmentsHtml}\n$1`
      );
      
    case 'after-results':
      // Insert after last table or before footer
      return reportHtml.replace(
        /(<\/main>|<footer)/i,
        `${attachmentsHtml}\n$1`
      );
      
    case 'appendix':
      // Insert at very end before closing tags
      return reportHtml.replace(
        /(<\/div>\s*<\/body>)/i,
        `${attachmentsHtml}\n$1`
      );
      
    default:
      return reportHtml;
  }
};
```

---

### **Step 3: Integrate into PDF Generation**

**File:** `src/utils/pdfService.ts`

Add to the report generation flow:

```typescript
import { prepareAttachmentsForPDF, injectAttachmentsIntoReport } from './pdfAttachmentInjector';

// Modify existing PDF generation function
export const generateReportPDF = async (
  orderId: string,
  options: {
    includeAttachments?: boolean;
    attachmentPosition?: 'before-results' | 'after-results' | 'appendix';
  } = {}
): Promise<string> => {
  const { includeAttachments = true, attachmentPosition = 'after-results' } = options;
  
  // ... existing report HTML generation code ...
  
  let finalHtml = reportHtml;
  
  // Inject attachments if enabled
  if (includeAttachments) {
    try {
      const attachmentsHtml = await prepareAttachmentsForPDF({
        orderId,
        position: attachmentPosition,
        maxWidth: '600px',
        includeCaption: true
      });
      
      if (attachmentsHtml) {
        finalHtml = injectAttachmentsIntoReport(
          reportHtml,
          attachmentsHtml,
          attachmentPosition
        );
        console.log('✅ Injected attachments into PDF');
      }
    } catch (error) {
      console.error('Failed to inject attachments:', error);
      // Continue without attachments rather than failing
    }
  }
  
  // Generate PDF with attachments included
  return generatePDFWithPuppeteer(finalHtml, filename);
};
```

---

### **Step 4: Update Report Template Context**

**File:** `src/utils/supabase.ts` (ReportTemplateContext interface)

```typescript
export interface ReportTemplateContext {
  // ... existing fields ...
  
  // Add attachment support
  attachments?: Array<{
    id: string;
    file_url: string;
    file_type: string;
    description?: string;
    test_group_id?: string;
  }>;
  
  includeAttachmentsInPDF?: boolean;
  attachmentDisplayPosition?: 'before-results' | 'after-results' | 'appendix';
}
```

---

## Usage Examples

### **Example 1: Result Entry with Attachments**

```typescript
// In ManualEntryForm.tsx
const handleSubmit = async () => {
  // 1. Save results
  const resultId = await saveResults(formData);
  
  // 2. Upload attachments
  if (attachments.length > 0) {
    await AttachmentService.uploadMultiple(attachments, {
      orderId: order.id,
      testGroupId: testGroup.id,
      scope: 'test',
      userId: user?.id,
      labId: order.lab_id
    });
  }
  
  // 3. Generate PDF with attachments
  const pdfUrl = await generateReportPDF(order.id, {
    includeAttachments: true,
    attachmentPosition: 'after-results'
  });
};
```

### **Example 2: Selective Attachment Display**

```typescript
// Only include attachments for specific test groups
const attachmentsHtml = await prepareAttachmentsForPDF({
  orderId: 'order-123',
  testGroupId: 'radiology-xray', // Only X-ray images
  position: 'after-results',
  maxWidth: '800px'
});
```

### **Example 3: Custom Template with Attachments**

```nunjucks
<!-- In report template HTML -->
<div class="test-results">
  {% for result in testResults %}
    <div>{{ result.parameter }}: {{ result.value }}</div>
  {% endfor %}
</div>

<!-- Attachments will be injected here automatically -->
{% if attachments and attachments.length > 0 %}
  <div class="attachments-section">
    <h3>Supporting Images</h3>
    {% for attachment in attachments %}
      <img src="{{ attachment.file_url }}" alt="{{ attachment.description }}" />
    {% endfor %}
  </div>
{% endif %}
```

---

## Configuration Options

### **Lab-Level Settings**

Add to `labs` table or settings:

```typescript
interface LabPDFSettings {
  include_attachments_by_default: boolean;
  attachment_position: 'before-results' | 'after-results' | 'appendix';
  attachment_max_width: string; // e.g., '600px', '100%'
  show_attachment_captions: boolean;
  allowed_attachment_types: string[]; // ['image/jpeg', 'image/png', 'application/pdf']
  max_attachment_size_mb: number;
}
```

### **Per-Report Override**

```typescript
// Allow users to toggle attachments in PDF
const generatePDF = async (orderId: string, userPreferences: {
  includeAttachments: boolean;
  attachmentPosition: string;
}) => {
  return generateReportPDF(orderId, userPreferences);
};
```

---

## Benefits of This Approach

### ✅ **Modular**
- Attachment logic separated into dedicated module
- Can be enabled/disabled per report
- No changes to core PDF generation

### ✅ **Flexible**
- Support for order-level and test-level attachments
- Configurable positioning
- Optional captions and styling

### ✅ **Scalable**
- Handles multiple attachments efficiently
- Base64 conversion for reliable embedding
- Batch upload support

### ✅ **Backward Compatible**
- Existing reports work without changes
- Attachments are optional
- Graceful degradation if attachment fetch fails

---

## Testing Checklist

- [ ] Upload single image during result entry
- [ ] Upload multiple images (batch)
- [ ] Generate PDF with attachments (e-copy)
- [ ] Generate PDF with attachments (print version)
- [ ] Test with large images (>5MB)
- [ ] Test with different image formats (JPEG, PNG, WebP)
- [ ] Verify attachment positioning (before/after/appendix)
- [ ] Test with no attachments (should work normally)
- [ ] Test attachment captions
- [ ] Verify page breaks with large images

---

## Performance Considerations

### **Image Optimization**
```typescript
// Already implemented in AttachmentService
const optimizeImage = async (file: File): Promise<File> => {
  if (file.size > 5 * 1024 * 1024) { // > 5MB
    return await imageCompression(file, {
      maxSizeMB: 2,
      maxWidthOrHeight: 1920,
      useWebWorker: true
    });
  }
  return file;
};
```

### **Lazy Loading**
- Only fetch attachments when generating PDF
- Cache base64 conversions for repeated generation
- Use streaming for large files

### **PDF Size Management**
- Limit number of attachments per report
- Compress images before embedding
- Offer "attachments appendix" as separate PDF option

---

## Future Enhancements

1. **PDF Attachments**: Support embedding PDF files (requires different approach)
2. **Attachment Annotations**: Allow marking up images before including
3. **Selective Inclusion**: UI to choose which attachments to include
4. **Attachment Gallery**: Thumbnail view in report with full-size on click
5. **Digital Signatures**: Sign attachments for authenticity
6. **Version Control**: Track attachment versions and updates

---

## File Structure Summary

```
src/
├── components/
│   └── Results/
│       └── EntryMode/
│           └── ManualEntryForm.tsx          [MODIFY: Add file upload]
│
├── utils/
│   ├── pdfService.ts                        [MODIFY: Integrate attachments]
│   ├── pdfAttachmentInjector.ts            [NEW: Attachment logic]
│   └── supabase.ts                          [MODIFY: Add context fields]
│
└── types/
    └── attachments.ts                       [NEW: Type definitions]

puppeteer-service/
└── src/
    └── server.ts                            [NO CHANGES NEEDED]
```

---

## Conclusion

This modular approach allows you to:
1. **Upload files during result entry** via enhanced form
2. **Store attachments** with proper metadata and linking
3. **Inject into PDFs** automatically at configurable positions
4. **Maintain flexibility** with optional inclusion and positioning
5. **Scale easily** with batch uploads and optimization

The system leverages existing infrastructure (Supabase Storage, PDF generation) and adds a clean abstraction layer for attachment handling.

**Next Steps:**
1. Implement `ManualEntryForm` file upload UI
2. Create `pdfAttachmentInjector.ts` module
3. Integrate into `generateReportPDF()` function
4. Add lab-level configuration settings
5. Test with various image types and sizes

---

**Last Updated:** 2025-11-21  
**Version:** 1.0  
**Status:** Ready for Implementation ✅
