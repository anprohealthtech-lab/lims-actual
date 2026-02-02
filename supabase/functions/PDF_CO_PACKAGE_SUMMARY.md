# 📦 PDF.co Helper Script Package - Summary

## 🎯 What You Got

A complete, production-ready solution for generating PDFs with PDF.co API, featuring:
- ✅ **A4 sizing** with proper letterhead support
- ✅ **Background images** that repeat on every page
- ✅ **Multi-page layout** handling
- ✅ **QR code** verification support
- ✅ **Print versions** (grayscale)
- ✅ **Zero dependencies** - pure JavaScript

## 📁 Files Created

| File | Purpose | When to Use |
|------|---------|-------------|
| **pdf-co-helper.ts** | TypeScript version with full types | Deno, Supabase Edge Functions, TypeScript projects |
| **pdf-co-helper-standalone.js** | Standalone JavaScript version | Node.js, Browser, any JavaScript environment |
| **pdf-co-helper-example.ts** | 7 comprehensive examples | Learning how to use the helper |
| **pdf-template-copy-paste.js** | Complete copy-paste template | Quick start - just edit config and run! |
| **PDF_CO_HELPER_README.md** | Full documentation | Comprehensive guide with API reference |
| **QUICK_REFERENCE.md** | Cheat sheet | Quick lookups and common patterns |

## 🚀 Getting Started (3 Steps)

### Option A: Copy-Paste Template (Fastest)

```bash
# 1. Open pdf-template-copy-paste.js
# 2. Edit the YOUR_CONFIG section (API key, HTML, background URL)
# 3. Run it!
node pdf-template-copy-paste.js
```

### Option B: Import as Module

```javascript
// 1. Copy pdf-co-helper-standalone.js to your project
const { generatePdfWithLetterhead } = require('./pdf-co-helper-standalone.js');

// 2. Use it
const pdfUrl = await generatePdfWithLetterhead({
  html: '<h1>Hello</h1>',
  backgroundImageUrl: 'https://cdn.com/letterhead.png',
  apiKey: 'YOUR_API_KEY',
  filename: 'output.pdf',
});
```

### Option C: TypeScript (Recommended for Deno/Edge Functions)

```typescript
// 1. Use pdf-co-helper.ts
import { generatePdfWithLetterhead } from './pdf-co-helper.ts';

// 2. Use it with full type safety
const pdfUrl = await generatePdfWithLetterhead({
  html: '<h1>Typed</h1>',
  backgroundImageUrl: 'https://...',
  apiKey: process.env.PDFCO_API_KEY!,
  filename: 'output.pdf',
  topMargin: 130,
  bottomMargin: 130,
});
```

## 💡 What Makes This Special

### 1. Proper A4 Sizing
- Exact dimensions: **210mm × 297mm**
- Works with PDF.co's rendering engine
- No manual scaling needed

### 2. Letterhead Support
```javascript
backgroundImageUrl: 'https://your-cdn.com/letterhead.png'
```
- Background **repeats on every page** automatically
- Content stays in safe zone (controlled by margins)
- CSS-based positioning for reliability

### 3. Multi-Page Handling
- Uses HTML `<table>` with `<thead>` and `<tfoot>` for repeating headers/footers
- Table rows don't break mid-row
- Clean page breaks

### 4. QR Code Integration
```javascript
verificationUrl: 'https://myapp.com/verify?id=123'
```
- Auto-generated QR code
- Positioned dynamically (top-right)
- Adjusts based on letterhead presence

### 5. Print Mode
```javascript
grayscale: true  // Black & white, no background
```
- Perfect for physical printing
- Saves ink
- Clean, professional output

## 🎨 Letterhead Image Requirements

| Property | Value |
|----------|-------|
| **Dimensions** | 210mm × 297mm (A4 standard) |
| **Pixels** | 2480px × 3508px @ 300dpi *(recommended)*<br>1654px × 2339px @ 200dpi *(minimum)* |
| **Format** | PNG (best quality) or JPG (smaller size) |
| **URL** | Publicly accessible HTTPS URL |
| **Design** | Reserve ~130px top/bottom for header/footer graphics |

### How to Design Your Letterhead

1. **Create canvas:** 2480px × 3508px (or 210mm × 297mm in design software)
2. **Header area:** Top 130px (~13mm) - place logo, company name, contact info
3. **Footer area:** Bottom 130px (~13mm) - place footer text, certifications, page numbers
4. **Content area:** Middle section - **keep transparent or light background**
5. **Export:** PNG with transparency OR JPG with white middle
6. **Upload:** To CDN (ImageKit, S3, Cloudflare, etc.)

## 📋 Common Use Cases

### Medical Reports
```javascript
generatePdfWithLetterhead({
  html: reportHtml,
  backgroundImageUrl: 'https://cdn.com/lab-letterhead.png',
  apiKey: API_KEY,
  filename: `report-${patientId}.pdf`,
  topMargin: 130,
  bottomMargin: 130,
  verificationUrl: `https://lab.com/verify/${reportId}`,
});
```

### Invoices
```javascript
generatePdfWithLetterhead({
  html: invoiceHtml,
  backgroundImageUrl: null, // Clean layout
  apiKey: API_KEY,
  filename: `invoice-${invoiceNumber}.pdf`,
  topMargin: 40,
  bottomMargin: 40,
});
```

### Certificates
```javascript
generatePdfWithLetterhead({
  html: certificateHtml,
  backgroundImageUrl: 'https://cdn.com/certificate-bg.png',
  apiKey: API_KEY,
  filename: `certificate-${studentId}.pdf`,
  topMargin: 100,
  bottomMargin: 100,
});
```

### Print-Friendly Reports
```javascript
generatePrintPdf({
  html: reportHtml,
  apiKey: API_KEY,
  filename: `print-${id}.pdf`,
});
```

## 🔧 Integration Examples

### Supabase Edge Function
```typescript
// supabase/functions/generate-pdf/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { generatePdfWithLetterhead } from '../pdf-co-helper.ts';

serve(async (req) => {
  const { html, bgUrl } = await req.json();
  
  const pdfUrl = await generatePdfWithLetterhead({
    html,
    backgroundImageUrl: bgUrl,
    apiKey: Deno.env.get('PDFCO_API_KEY')!,
    filename: `doc-${Date.now()}.pdf`,
  });
  
  return new Response(JSON.stringify({ pdfUrl }));
});
```

### Express.js API
```javascript
const express = require('express');
const { generatePdfWithLetterhead } = require('./pdf-co-helper-standalone.js');

app.post('/api/pdf', async (req, res) => {
  const pdfUrl = await generatePdfWithLetterhead({
    html: req.body.html,
    backgroundImageUrl: req.body.letterheadUrl,
    apiKey: process.env.PDFCO_API_KEY,
    filename: 'output.pdf',
  });
  res.json({ url: pdfUrl });
});
```

### Next.js API Route
```typescript
// app/api/generate-pdf/route.ts
import { generatePdfWithLetterhead } from '@/lib/pdf-co-helper';

export async function POST(req: Request) {
  const { html, letterheadUrl } = await req.json();
  
  const pdfUrl = await generatePdfWithLetterhead({
    html,
    backgroundImageUrl: letterheadUrl,
    apiKey: process.env.PDFCO_API_KEY!,
    filename: `doc-${Date.now()}.pdf`,
  });
  
  return Response.json({ pdfUrl });
}
```

## 🎓 Learning Path

1. **Start Here:** `pdf-template-copy-paste.js`
   - Edit config, run it, see the magic happen
   
2. **Explore Examples:** `pdf-co-helper-example.ts`
   - See 7 different use cases
   - Copy the pattern you need
   
3. **Read Docs:** `PDF_CO_HELPER_README.md`
   - Full API reference
   - Advanced features
   
4. **Quick Reference:** `QUICK_REFERENCE.md`
   - Common patterns
   - Troubleshooting
   
5. **Integrate:** Use `pdf-co-helper.ts` or `.js` in your app
   - TypeScript or JavaScript
   - Full control and customization

## 🔑 Get PDF.co API Key

1. Visit: **https://pdf.co/**
2. Sign up (free tier available)
3. Go to Dashboard → API Keys
4. Copy your API key
5. Use it in your config

**Free Tier:** 150 requests/month  
**Paid Plans:** Start at $9.99/month for 10,000 requests

## 📊 Comparison Matrix

| Feature | This Helper | Manual PDF.co API |
|---------|-------------|-------------------|
| A4 Sizing | ✅ Automatic | ❌ Manual calculation |
| Letterhead Support | ✅ Built-in | ❌ Complex setup |
| Multi-page Headers | ✅ Repeating | ❌ Manual per page |
| QR Code | ✅ Auto-positioned | ❌ Manual placement |
| Print Version | ✅ One function | ❌ Separate config |
| TypeScript Support | ✅ Full types | ❌ No types |
| Examples | ✅ 7+ examples | ❌ Basic docs only |
| Copy-Paste Ready | ✅ Yes | ❌ Build from scratch |

## 🐛 Troubleshooting Quick Guide

| Problem | Solution |
|---------|----------|
| "API error: 401" | Check API key is correct |
| Background not showing | Verify image URL is public HTTPS |
| Content overlapping | Increase `topMargin` / `bottomMargin` |
| Timeout | Reduce HTML size, optimize images |
| Wrong page size | Ensure background is 210mm × 297mm |
| QR code missing | Provide `verificationUrl` parameter |

## 💰 Cost Estimation

**PDF.co Pricing:**
- Free: 150 requests/month
- Starter: $9.99/month = 10,000 requests
- Pro: $49.99/month = 100,000 requests

**Example Costs:**
- 100 reports/day = $9.99/month
- 1,000 reports/day = $49.99/month

## 📝 Next Steps

1. ✅ **Test with sample data**
   ```bash
   node pdf-template-copy-paste.js
   ```

2. ✅ **Design your letterhead** (use Canva, Figma, or Photoshop)
   - A4 size: 2480px × 3508px
   - Export as PNG
   - Upload to CDN

3. ✅ **Integrate into your app**
   - Copy `pdf-co-helper.ts` or `.js`
   - Add to your project
   - Import and use

4. ✅ **Go to production**
   - Set up environment variables
   - Test with real data
   - Monitor API usage

## 🎉 Summary

You now have:
- ✅ **Production-ready PDF generation** with PDF.co
- ✅ **Full letterhead support** with A4 sizing
- ✅ **TypeScript and JavaScript** versions
- ✅ **7+ working examples**
- ✅ **Complete documentation**
- ✅ **Copy-paste templates**
- ✅ **Zero setup required**

**Happy PDF generating! 🚀**

---

**Created:** January 28, 2026  
**Author:** LIMS v2 Development Team  
**Version:** 1.0.0

For questions or issues, refer to:
- `PDF_CO_HELPER_README.md` - Full documentation
- `QUICK_REFERENCE.md` - Quick lookups
- PDF.co docs: https://pdf.co/docs
