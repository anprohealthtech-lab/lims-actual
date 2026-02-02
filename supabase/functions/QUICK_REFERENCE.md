# 📄 PDF.co Helper - Quick Reference Card

## 🚀 One-Line Usage

```javascript
const pdfUrl = await generatePdfWithLetterhead({
  html: '<h1>Title</h1><p>Content</p>',
  backgroundImageUrl: 'https://cdn.com/letterhead.png',
  apiKey: 'YOUR_API_KEY',
  filename: 'output.pdf',
  topMargin: 130,
  bottomMargin: 130
});
```

## 📦 Files Overview

| File | Use When |
|------|----------|
| `pdf-co-helper.ts` | **TypeScript projects** (Deno, Edge Functions) |
| `pdf-co-helper-standalone.js` | **JavaScript projects** (Node.js, Browser) |
| `pdf-co-helper-example.ts` | Learning / Copy examples |
| `PDF_CO_HELPER_README.md` | Full documentation |

## 🎯 Common Scenarios

### 1. PDF with Letterhead
```javascript
await generatePdfWithLetterhead({
  html: content,
  backgroundImageUrl: 'https://cdn.com/letterhead-a4.png',
  apiKey: 'xxx',
  filename: 'report.pdf',
  topMargin: 130,
  bottomMargin: 130,
});
```
✅ Background repeats on all pages  
✅ Content stays in safe zone  
✅ A4 sizing (210mm × 297mm)

### 2. Clean PDF (No Background)
```javascript
await generatePdfWithLetterhead({
  html: content,
  backgroundImageUrl: null, // ← null = no background
  apiKey: 'xxx',
  filename: 'invoice.pdf',
  topMargin: 40,
  bottomMargin: 40,
});
```
✅ Standard margins  
✅ No letterhead  
✅ Clean layout

### 3. Print Version (B&W)
```javascript
await generatePrintPdf({
  html: content,
  apiKey: 'xxx',
  filename: 'print.pdf',
});
```
✅ Grayscale mode  
✅ No background  
✅ Print-optimized

### 4. With QR Code
```javascript
await generatePdfWithLetterhead({
  html: content,
  backgroundImageUrl: 'https://...',
  apiKey: 'xxx',
  filename: 'verified.pdf',
  verificationUrl: 'https://app.com/verify?id=RPT123', // ← QR links here
});
```
✅ QR code in top-right  
✅ Auto-positioned  
✅ Verification support

### 5. Custom Styling
```javascript
await generatePdfWithLetterhead({
  html: '<div class="custom">Styled content</div>',
  apiKey: 'xxx',
  filename: 'styled.pdf',
  customCss: '.custom { background: #fef3c7; padding: 20px; }',
});
```
✅ Inject custom CSS  
✅ Override styles  
✅ Full control

## 📐 Letterhead Image Requirements

| Property | Value |
|----------|-------|
| **Dimensions** | 210mm × 297mm (A4) |
| **Resolution** | 2480px × 3508px @ 300dpi *(recommended)*<br>1654px × 2339px @ 200dpi *(minimum)* |
| **Format** | PNG (best) or JPG |
| **URL** | Must be publicly accessible (HTTPS) |
| **Design** | Reserve top/bottom areas for header/footer |

## ⚙️ Parameter Reference

```typescript
{
  html: string;                    // Required: Your HTML content
  apiKey: string;                  // Required: PDF.co API key
  filename: string;                // Required: Output filename
  backgroundImageUrl?: string|null; // Optional: Letterhead URL (null = none)
  topMargin?: number;              // Optional: Default 130px
  bottomMargin?: number;           // Optional: Default 130px
  customCss?: string;              // Optional: Additional CSS
  verificationUrl?: string|null;   // Optional: QR code URL
  grayscale?: boolean;             // Optional: B&W mode (default: false)
}
```

## 🔑 Getting API Key

1. Visit: https://pdf.co/
2. Sign up for free account
3. Go to Dashboard → API Keys
4. Copy your API key
5. Free tier: 150 requests/month

## 💡 Pro Tips

### Margins Explained
```
topMargin: 130     ← Space reserved for header graphic
bottomMargin: 130  ← Space reserved for footer graphic
```
- **With letterhead:** Content pushed down by margins
- **Without letterhead:** Standard page margins
- Margins **repeat on every page** automatically

### Multi-Page Documents
- ✅ Tables break naturally across pages
- ✅ Rows stay intact (no splitting mid-row)
- ✅ Headers/footers repeat automatically
- ✅ Background repeats on all pages

### Performance
```javascript
// ✅ Good: Parallel generation
const [pdf1, pdf2, pdf3] = await Promise.all([
  generatePdfWithLetterhead(options1),
  generatePdfWithLetterhead(options2),
  generatePdfWithLetterhead(options3),
]);

// ❌ Slow: Sequential
const pdf1 = await generatePdfWithLetterhead(options1);
const pdf2 = await generatePdfWithLetterhead(options2);
const pdf3 = await generatePdfWithLetterhead(options3);
```

## 🐛 Common Issues

| Issue | Solution |
|-------|----------|
| Background not showing | Check image URL is public & HTTPS |
| Content overlapping header | Increase `topMargin` value |
| QR code missing | Provide `verificationUrl` |
| PDF timeout | Reduce HTML size or optimize images |
| Wrong page size | Background must be exactly 210mm × 297mm |

## 🔗 Integration Examples

### Supabase Edge Function
```typescript
import { generatePdfWithLetterhead } from './pdf-co-helper.ts';

serve(async (req) => {
  const { html, bgUrl } = await req.json();
  const pdfUrl = await generatePdfWithLetterhead({
    html, backgroundImageUrl: bgUrl,
    apiKey: Deno.env.get('PDFCO_API_KEY')!,
    filename: `report-${Date.now()}.pdf`,
  });
  return new Response(JSON.stringify({ pdfUrl }));
});
```

### Node.js
```javascript
const { generatePdfWithLetterhead } = require('./pdf-co-helper-standalone.js');

app.post('/pdf', async (req, res) => {
  const pdfUrl = await generatePdfWithLetterhead({
    html: req.body.html,
    backgroundImageUrl: req.body.bgUrl,
    apiKey: process.env.PDFCO_API_KEY,
    filename: 'output.pdf',
  });
  res.json({ pdfUrl });
});
```

### Browser
```html
<script src="pdf-co-helper-standalone.js"></script>
<script>
const pdfUrl = await window.PdfCoHelper.generatePdfWithLetterhead({
  html: '<h1>Hello</h1>',
  apiKey: 'YOUR_KEY',
  filename: 'test.pdf',
});
</script>
```

## 📊 Testing Checklist

- [ ] Background image is A4 size (210mm × 297mm)
- [ ] Background URL is publicly accessible
- [ ] API key is valid and has quota
- [ ] HTML content is well-formed
- [ ] Margins match your letterhead design
- [ ] Test with multi-page content
- [ ] Verify QR code if using verification
- [ ] Test print version (grayscale)

## 📚 Next Steps

1. **Start simple:** Test with plain HTML, no background
2. **Add letterhead:** Once basic works, add background image
3. **Customize:** Add your CSS and styling
4. **Optimize:** Use parallel generation for multiple PDFs
5. **Deploy:** Integrate into your production app

---

**Need Help?**
- Full docs: `PDF_CO_HELPER_README.md`
- Examples: `pdf-co-helper-example.ts`
- PDF.co docs: https://pdf.co/docs

**Created:** January 28, 2026  
**Version:** 1.0
