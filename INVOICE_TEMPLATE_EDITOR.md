# Invoice Template Editor

## Overview
Full template editing system with **CKEditor WYSIWYG integration** and **live preview with actual sample data**.

## ✨ Key Features

1. **🎨 Visual WYSIWYG Editor** - CKEditor 5 for intuitive template editing
2. **💾 Sample Data Preview** - See templates with realistic invoice data
3. **📝 Raw Code Editors** - Direct HTML/CSS editing for advanced users
4. **👁️ Live Preview** - Real-time rendering with placeholder replacement

## Components

### InvoiceTemplateEditor.tsx
Location: `src/components/Billing/InvoiceTemplateEditor.tsx`

**4-Tab Interface:**
1. **Visual Editor (WYSIWYG)** - CKEditor with full formatting toolbar
2. **HTML Tab** - Raw HTML code editor (monospace textarea)
3. **CSS Tab** - Stylesheet editor
4. **Preview with Data** - Live preview with sample invoice data

**CKEditor Features:**
- Source editing mode for inserting placeholders
- Rich text formatting (bold, italic, underline, colors)
- Tables, lists, alignment
- Font sizes and heading styles
- Link insertion
- Undo/redo support

**Props:**
```typescript
interface InvoiceTemplateEditorProps {
  templateId: string;        // UUID of template to edit
  onClose: () => void;       // Close modal callback
  onSave: () => void;        // Save success callback (refreshes list)
}
```

**Tabs:**
1. **Visual Editor (WYSIWYG)** - CKEditor with toolbar for rich text editing
2. **HTML Tab** - Edit `gjs_html` field with placeholder guide  
3. **CSS Tab** - Edit `gjs_css` field
4. **Preview with Data Tab** - Live preview with sample invoice data

**CKEditor Toolbar:**
```
Heading | Bold Italic Underline Strikethrough | Link Lists |
Alignment Indent | Font Size Colors | Table Quote Line |
Undo Redo | Source Editing
```

**Source Editing Mode:**
- Click "Source Editing" button in CKEditor toolbar
- Switch to raw HTML view to insert placeholders
- Add placeholders like `{{ patient_name }}`, `{{ total }}`, etc.
- Switch back to visual mode to continue formatting

## Sample Data for Preview

The preview tab replaces all placeholders with realistic sample data:

```typescript
{
  // Lab Information
  lab_name: 'Advanced Diagnostics Lab',
  lab_address: '123 Medical Center Blvd',
  lab_city: 'Mumbai',
  lab_state: 'Maharashtra',
  lab_pincode: '400001',
  lab_phone: '+91 22 1234 5678',
  lab_email: 'info@advanceddiagnostics.com',
  lab_license: 'MH/LAB/2024/12345',
  lab_registration: 'NABL-12345',
  
  // Patient Information
  patient_name: 'Rajesh Kumar',
  patient_age: '45',
  patient_gender: 'Male',
  patient_id: 'PAT-2024-001',
  
  // Invoice Details
  invoice_number: 'INV-2024-12345',
  invoice_date: '18-Dec-2024',
  due_date: '25-Dec-2024',
  
  // Financial
  subtotal: '₹1,900.00',
  tax_amount: '₹342.00',
  tax_percentage: '18',
  total: '₹2,242.00',
  amount_paid: '₹1,000.00',
  balance_due: '₹1,242.00',
  
  // Items (rendered as HTML table)
  invoice_items: '<table>...</table>',
  
  // Payment Info
  payment_terms: 'Payment is due within 7 days...',
  bank_details: '<div>Bank transfer details...</div>',
  
  // Notes
  notes: 'Thank you for choosing our laboratory services...'
}
```

**Invoice Items Sample:**
- Complete Blood Count (CBC) - ₹500.00
- Lipid Profile - ₹800.00
- Thyroid Function Test (TFT) - ₹600.00

**Bank Details Sample:**
- Bank: HDFC Bank
- Account: 12345678901234
- IFSC: HDFC0001234

### InvoiceTemplateManager.tsx
Location: `src/components/Billing/InvoiceTemplateManager.tsx`

**Updated:**
- Added **Edit** button to each template card (blue border)
- Opens `InvoiceTemplateEditor` modal when clicked
- Maintains existing Set Default and Activate/Deactivate functionality

**Button Layout per Template:**
```
[Edit] [Set Default (if not default)] [Activate/Deactivate]
```

## Database Integration

**Uses existing API:**
```typescript
// Load template for editing
await database.invoiceTemplates.getById(templateId);

// Save changes
await database.invoiceTemplates.update(templateId, {
  gjs_html: updatedHtml,
  gjs_css: updatedCss,
  updated_at: new Date().toISOString()
});
```

**Fields Edited:**
- `gjs_html` - HTML template code
- `gjs_css` - CSS stylesheet code
- `updated_at` - Timestamp (auto-updated)

## Template Placeholders

**Available placeholders in HTML:**
```
{{ patient_name }}
{{ invoice_number }}
{{ invoice_date }}
{{ due_date }}
{{ invoice_items }}
{{ subtotal }}
{{ tax_amount }}
{{ total }}
{{ lab_name }}
{{ lab_address }}
{{ lab_phone }}
{{ lab_email }}
{{ payment_terms }}
{{ bank_details }}
```

These are replaced during PDF generation in the backend.

## Usage Flow

1. User navigates to **Settings → Invoices tab**
2. Sees list of invoice templates
3. Clicks **Edit** button on any template
4. Modal opens with 4 tabs (default: Visual Editor)
5. **Option A - Visual Editing:**
   - Use CKEditor toolbar for formatting
   - Click "Source Editing" to insert placeholders
   - See changes in WYSIWYG view
6. **Option B - Code Editing:**
   - Switch to HTML/CSS tabs
   - Edit raw code directly
7. **Preview:**
   - Switch to "Preview with Data" tab
   - See template rendered with sample invoice data
   - All placeholders replaced with realistic values
8. Click **Save Changes** to persist
9. Modal closes and template list refreshes

## CKEditor Integration

**Package:**
```json
{
  "@ckeditor/ckeditor5-react": "latest",
  "@ckeditor/ckeditor5-build-classic": "latest"
}
```

**Configuration:**
- **Toolbar**: 20+ tools including source editing
- **Table Support**: Insert/edit tables with merge cells
- **Font Options**: Size, color, background color
- **Alignment**: Left, center, right, justify
- **Source Mode**: Toggle between WYSIWYG and HTML

**Placeholder Insertion:**
1. Click "Source Editing" button (right side of toolbar)
2. HTML code view appears
3. Type placeholders: `{{ patient_name }}`
4. Click "Source Editing" again to return to visual mode

## Preview System

**Two Preview Modes:**

1. **Visual Editor (WYSIWYG)**
   - Real-time editing with CKEditor
   - What-you-see-is-what-you-get
   - Placeholders shown as-is: `{{ patient_name }}`

2. **Preview with Data Tab**
   - Full rendering with sample data
   - All placeholders replaced
   - Realistic invoice preview

**Placeholder Replacement:**
```typescript
const replacePlaceholders = (html: string) => {
  const sampleData = getSampleData();
  let result = html;
  
  Object.entries(sampleData).forEach(([key, value]) => {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    result = result.replace(regex, String(value));
  });
  
  return result;
};
```

**Security:**
- Iframe with `sandbox="allow-same-origin"`
- No JavaScript execution in preview
- Safe rendering of user HTML/CSS

## Layout

- **Modal Size**: `max-w-6xl` (wide modal)
- **Height**: `h-[90vh]` (90% viewport height)
- **Editor Height**: Flex-1 (fills available space)
- **Font**: `font-mono` for code editors
- **Scrolling**: Textareas have `resize-none` with overflow handling

## Error Handling

**Loading State:**
```typescript
if (loading) return <LoadingSpinner />;
```

**Error Display:**
```typescript
{error && (
  <div className="p-3 bg-red-50 border border-red-200">
    <AlertCircle /> {error}
  </div>
)}
```

**Save Errors:**
- Database errors shown in red alert
- User can retry save operation
- Modal stays open on error

## Future Enhancements

1. ~~**Syntax Highlighting**: Integrate Monaco Editor or CodeMirror~~ ✅ **CKEditor Integrated**
2. ~~**Sample Data Preview**: Preview with real invoice data~~ ✅ **Sample Data Working**
3. **Undo/Redo**: Add edit history (CKEditor has built-in undo/redo)
4. **Template Variables Panel**: Drag-and-drop placeholders
5. **Export/Import**: Export template as JSON, import from file
6. **Version Control**: Save template versions/history
7. **Template Cloning**: Duplicate existing templates
8. **Validation**: Validate HTML/CSS before save
9. **AI Suggestions**: Generate templates with AI
10. **Custom Placeholders**: Add lab-specific custom placeholders

## Related Files

- `src/utils/supabase.ts` - Database API (lines 9952-10107)
- `src/components/Billing/InvoiceGenerationModal.tsx` - Template selection
- `supabase/migrations/20241217_invoice_templates_seed.sql` - Default templates
- `supabase/functions/generate-invoice-pdf/index.ts` - PDF generation with templates

## Testing Checklist

- [ ] Edit HTML and see changes in preview
- [ ] Edit CSS and see styles applied in preview
- [ ] Save changes and verify in database
- [ ] Refresh page and verify changes persist
- [ ] Test with all 5 template categories
- [ ] Test error handling (invalid template ID, network error)
- [ ] Test on mobile viewport (modal responsiveness)
- [ ] Generate PDF with edited template

## Known Limitations

1. **No syntax validation** - Invalid HTML/CSS will cause render errors
2. **No auto-save** - Changes lost if modal closed without saving
3. **No collaborative editing** - Multiple users can overwrite changes
4. **Preview limitations** - Placeholders not replaced with sample data

## Security Considerations

- **Iframe sandbox**: Prevents XSS attacks in preview
- **RLS policies**: Only lab members can edit their templates
- **No script execution**: Preview iframe blocks JavaScript
- **Input sanitization**: Consider adding DOMPurify for HTML sanitization
