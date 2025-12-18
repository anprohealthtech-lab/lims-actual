# Invoice Template Editor - Enhanced Version

## 🎉 What's New

### Before vs After

#### ❌ Before (Text-Only)
```
[HTML Tab] [CSS Tab] [Preview]
- Plain textarea for HTML
- Plain textarea for CSS  
- Preview with placeholders ({{ patient_name }})
```

#### ✅ After (CKEditor + Sample Data)
```
[Visual Editor] [HTML] [CSS] [Preview with Data]
- 🎨 CKEditor WYSIWYG with full toolbar
- 📝 Raw code editors (advanced users)
- 💾 Live preview with actual sample data
- ✅ Placeholders replaced: Rajesh Kumar, INV-2024-12345
```

---

## 🎨 Visual Editor (CKEditor)

### Features
- ✅ **Rich Text Formatting** - Bold, italic, underline, colors
- ✅ **Tables** - Insert and edit tables
- ✅ **Lists** - Bullet and numbered lists
- ✅ **Alignment** - Left, center, right, justify
- ✅ **Font Sizes** - 9pt to 21pt
- ✅ **Headings** - H1, H2, H3
- ✅ **Links** - Insert hyperlinks
- ✅ **Source Editing** - Toggle to HTML view for placeholders

### How to Insert Placeholders

1. **Click "Source Editing"** button in CKEditor toolbar (right side)
2. **HTML view appears** - Now you can see raw code
3. **Type placeholders** - `{{ patient_name }}`, `{{ total }}`, etc.
4. **Click "Source Editing" again** - Return to visual mode
5. **Continue editing** - Format text around placeholders

### Example Workflow

```html
<!-- In Source Editing Mode -->
<h1>Invoice for {{ patient_name }}</h1>
<p>Invoice Number: {{ invoice_number }}</p>
<p>Total Amount: {{ total }}</p>

<!-- After clicking Source Editing (Visual Mode) -->
Shows formatted text with placeholders visible
```

---

## 💾 Preview with Sample Data

### What You See

Instead of:
```
Patient: {{ patient_name }}
Invoice: {{ invoice_number }}
Total: {{ total }}
```

You now see:
```
Patient: Rajesh Kumar
Invoice: INV-2024-12345
Total: ₹2,242.00
```

### Complete Sample Data

| Category | Fields | Sample Values |
|----------|--------|---------------|
| **Lab** | lab_name, lab_address, lab_phone | Advanced Diagnostics Lab, Mumbai |
| **Patient** | patient_name, patient_age, patient_gender | Rajesh Kumar, 45, Male |
| **Invoice** | invoice_number, invoice_date, due_date | INV-2024-12345, 18-Dec-2024 |
| **Financial** | subtotal, tax_amount, total, balance_due | ₹1,900.00, ₹342.00, ₹2,242.00 |
| **Items** | invoice_items (HTML table) | CBC, Lipid Profile, TFT |
| **Payment** | payment_terms, bank_details | HDFC Bank, Account details |

### Invoice Items Table

Preview shows a real table:

| Test Name | Qty | Rate | Amount |
|-----------|-----|------|--------|
| Complete Blood Count (CBC) | 1 | ₹500.00 | ₹500.00 |
| Lipid Profile | 1 | ₹800.00 | ₹800.00 |
| Thyroid Function Test | 1 | ₹600.00 | ₹600.00 |

---

## 🚀 Quick Start Guide

### Step 1: Open Template Editor
```
Settings → Invoice Templates → Click "Edit" button
```

### Step 2: Choose Your Editing Style

**Option A: Visual Editing (Recommended for beginners)**
1. Click "Visual Editor" tab (default)
2. Use CKEditor toolbar to format
3. Click "Source Editing" to add placeholders
4. Format text visually

**Option B: Code Editing (For advanced users)**
1. Click "HTML" or "CSS" tabs
2. Edit raw code directly
3. Switch to "Preview with Data" to see results

### Step 3: Preview Your Changes
```
Click "Preview with Data" tab
→ See template with realistic invoice data
→ All placeholders replaced
→ Verify layout and formatting
```

### Step 4: Save
```
Click "Save Changes" button
→ Template updated in database
→ Modal closes automatically
→ Template list refreshes
```

---

## 📋 Available Placeholders

### Patient Information
```
{{ patient_name }}      → Rajesh Kumar
{{ patient_age }}       → 45
{{ patient_gender }}    → Male
{{ patient_id }}        → PAT-2024-001
```

### Invoice Details
```
{{ invoice_number }}    → INV-2024-12345
{{ invoice_date }}      → 18-Dec-2024
{{ due_date }}          → 25-Dec-2024
```

### Financial
```
{{ subtotal }}          → ₹1,900.00
{{ tax_amount }}        → ₹342.00
{{ tax_percentage }}    → 18
{{ total }}             → ₹2,242.00
{{ amount_paid }}       → ₹1,000.00
{{ balance_due }}       → ₹1,242.00
```

### Lab Information
```
{{ lab_name }}          → Advanced Diagnostics Lab
{{ lab_address }}       → 123 Medical Center Blvd
{{ lab_city }}          → Mumbai
{{ lab_state }}         → Maharashtra
{{ lab_pincode }}       → 400001
{{ lab_phone }}         → +91 22 1234 5678
{{ lab_email }}         → info@advanceddiagnostics.com
{{ lab_license }}       → MH/LAB/2024/12345
{{ lab_registration }}  → NABL-12345
```

### Dynamic Content (Pre-formatted HTML)
```
{{ invoice_items }}     → HTML table with test items
{{ payment_terms }}     → Payment terms paragraph
{{ bank_details }}      → Bank transfer details box
{{ notes }}             → Thank you note
```

---

## 🎯 Tips & Best Practices

### 1. Use Visual Editor for Layout
- Drag and drop tables
- Format headings and text
- Set alignment and spacing

### 2. Switch to Source Mode for Placeholders
- Insert placeholders in HTML mode
- Ensure correct syntax: `{{ placeholder_name }}`
- No spaces inside braces (optional but cleaner)

### 3. Preview Frequently
- Check "Preview with Data" after major changes
- Verify all placeholders are replaced
- Check table formatting and alignment

### 4. Use CSS Tab for Styling
- Define custom classes
- Set colors, fonts, borders
- Create responsive layouts

### 5. Test Before Deploying
- Generate a test invoice PDF
- Verify all data appears correctly
- Check print layout

---

## 🐛 Troubleshooting

### Placeholder Not Replaced in Preview
**Problem:** `{{ patient_name }}` still shows as text
**Solution:** Check spelling - must match exactly: `patient_name` not `patientName`

### CKEditor Toolbar Not Visible
**Problem:** Toolbar cut off or hidden
**Solution:** Modal is 90vh tall, toolbar should be visible. Refresh page if needed.

### Source Editing Button Missing
**Problem:** Can't find button to insert placeholders
**Solution:** Look for icon on right side of CKEditor toolbar. Labeled "Source Editing"

### Preview Shows No Data
**Problem:** Preview tab is blank or shows errors
**Solution:** 
1. Check HTML syntax in HTML tab
2. Ensure closing tags are present
3. Verify CSS doesn't hide content

### Changes Not Saving
**Problem:** Click Save but template not updated
**Solution:**
1. Check browser console for errors
2. Verify network connection
3. Check RLS policies allow updates

---

## 📸 Screenshots Reference

### Visual Editor Tab
```
┌─────────────────────────────────────────────────┐
│ [B] [I] [U] [Link] [Table] ... [Source Edit] │ ← Toolbar
├─────────────────────────────────────────────────┤
│                                                  │
│  Invoice for {{ patient_name }}                 │
│                                                  │
│  Dear valued customer...                         │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Preview with Data Tab
```
┌─────────────────────────────────────────────────┐
│ ✓ Placeholders Replaced                          │
├─────────────────────────────────────────────────┤
│                                                  │
│  INVOICE                                         │
│                                                  │
│  Patient: Rajesh Kumar                           │
│  Invoice: INV-2024-12345                         │
│  Total: ₹2,242.00                                │
│                                                  │
│  [CBC           ₹500.00]                         │
│  [Lipid Profile ₹800.00]                         │
│                                                  │
└─────────────────────────────────────────────────┘
```

---

## 🎓 Learning Path

1. **Beginner**: Start with Visual Editor, use formatting toolbar
2. **Intermediate**: Switch to HTML tab, learn placeholder syntax
3. **Advanced**: Edit CSS, create custom layouts
4. **Expert**: Combine all tabs for complex templates

---

## 💡 Pro Tips

- **Keyboard Shortcuts**: Ctrl+B (Bold), Ctrl+I (Italic), Ctrl+Z (Undo)
- **Copy Formatting**: Select text → Format → Copy style to other text
- **Table Tricks**: Right-click table cells for merge/split options
- **Quick Preview**: Toggle between Visual Editor and Preview tabs rapidly
- **Save Often**: No auto-save - click Save Changes frequently

---

## 🔗 Related Documentation

- [INVOICE_TEMPLATE_EDITOR.md](INVOICE_TEMPLATE_EDITOR.md) - Technical documentation
- [INVOICE_TEMPLATE_IMPLEMENTATION.md](INVOICE_TEMPLATE_IMPLEMENTATION.md) - System architecture
- [PDF_AUTO_GENERATION_README.md](PDF_AUTO_GENERATION_README.md) - PDF generation process

---

**Last Updated:** December 18, 2025  
**Version:** 2.0 (CKEditor + Sample Data)
