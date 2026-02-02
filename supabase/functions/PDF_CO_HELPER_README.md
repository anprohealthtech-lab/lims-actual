# PDF.co Helper Script

A reusable, production-ready script for generating PDFs with PDF.co API, featuring:
- ✅ Proper A4 sizing (210mm x 297mm)
- ✅ Letterhead background support (repeating on every page)
- ✅ QR code verification support
- ✅ Print-friendly versions (grayscale)
- ✅ Custom CSS injection
- ✅ Multi-page layout handling

## 📦 Files

| File | Description |
|------|-------------|
| `pdf-co-helper.ts` | Main reusable script with all functions |
| `pdf-co-helper-example.ts` | 7 usage examples covering common scenarios |
| `PDF_CO_HELPER_README.md` | This documentation file |

## 🚀 Quick Start

### 1. Copy the script to your project

```bash
# Copy the helper file to your project
cp pdf-co-helper.ts /path/to/your/project/
```

### 2. Install dependencies (if needed)

The script uses only standard Web APIs (`fetch`), so no additional dependencies are needed for Deno/Edge Functions.

For Node.js projects, ensure you have `node-fetch` if using Node < 18:
```bash
npm install node-fetch
```

### 3. Basic Usage

```typescript
import { generatePdfWithLetterhead } from './pdf-co-helper.ts';

// Your HTML content
const htmlContent = `
  <h1>Medical Report</h1>
  <p>Patient: John Doe</p>
  <table>
    <tr><th>Test</th><th>Value</th></tr>
    <tr><td>Hemoglobin</td><td>14.5</td></tr>
  </table>
`;

// Generate PDF with letterhead
const pdfUrl = await generatePdfWithLetterhead({
  html: htmlContent,
  backgroundImageUrl: 'https://your-cdn.com/letterhead-a4.png',
  apiKey: process.env.PDFCO_API_KEY!,
  filename: 'report-2024.pdf',
  topMargin: 130,    // Pixels to reserve for header graphic
  bottomMargin: 130, // Pixels to reserve for footer graphic
});

console.log('PDF generated:', pdfUrl);
```

## 📋 API Reference

### `generatePdfWithLetterhead(options)`

Main function to generate PDFs with or without letterhead backgrounds.

#### Parameters

```typescript
interface PdfGenerationOptions {
  /** The HTML content to convert to PDF */
  html: string;
  
  /** Background image URL (letterhead) - set to null for no background */
  backgroundImageUrl?: string | null;
  
  /** PDF.co API key */
  apiKey: string;
  
  /** Output filename (e.g., 'report.pdf') */
  filename: string;
  
  /** Top margin/spacer height in pixels (default: 130) */
  topMargin?: number;
  
  /** Bottom margin/spacer height in pixels (default: 130) */
  bottomMargin?: number;
  
  /** Additional custom CSS to inject */
  customCss?: string;
  
  /** QR code verification URL (optional) */
  verificationUrl?: string | null;
  
  /** Enable grayscale/black & white mode for print */
  grayscale?: boolean;
  
  /** Use async job mode (recommended for large documents) */
  async?: boolean;
}
```

#### Returns

```typescript
Promise<string> // URL of the generated PDF
```

### `generatePrintPdf(options)`

Convenience function for generating print-friendly PDFs (grayscale, no background).

```typescript
const pdfUrl = await generatePrintPdf({
  html: htmlContent,
  apiKey: 'YOUR_API_KEY',
  filename: 'print-version.pdf',
});
```

### `buildPdfHtml(options)`

Build the complete HTML document without sending to PDF.co. Useful for debugging or previewing.

```typescript
const fullHtml = buildPdfHtml({
  html: htmlContent,
  backgroundImageUrl: 'https://...',
  topMargin: 130,
  bottomMargin: 130,
});

// Save to file or preview in browser
```

## 💡 Common Use Cases

### 1️⃣ PDF with Letterhead Background

```typescript
const pdfUrl = await generatePdfWithLetterhead({
  html: '<h1>Report</h1><p>Content...</p>',
  backgroundImageUrl: 'https://imagekit.io/lab-letterhead-a4.png',
  apiKey: 'YOUR_API_KEY',
  filename: 'report-with-letterhead.pdf',
  topMargin: 130,
  bottomMargin: 130,
});
```

**Important:** Your background image should be:
- Exact A4 dimensions: **210mm x 297mm** (2480px x 3508px at 300dpi)
- PNG or JPG format
- Hosted on a publicly accessible URL (ImageKit, S3, etc.)

### 2️⃣ Clean PDF (No Background)

```typescript
const pdfUrl = await generatePdfWithLetterhead({
  html: '<h1>Invoice</h1><p>...</p>',
  backgroundImageUrl: null, // No letterhead
  apiKey: 'YOUR_API_KEY',
  filename: 'invoice.pdf',
  topMargin: 40,
  bottomMargin: 40,
});
```

### 3️⃣ Print-Friendly Version

```typescript
const printPdfUrl = await generatePrintPdf({
  html: content,
  apiKey: 'YOUR_API_KEY',
  filename: 'print-version.pdf',
  topMargin: 30,
  bottomMargin: 30,
});
```

### 4️⃣ PDF with QR Code Verification

```typescript
const pdfUrl = await generatePdfWithLetterhead({
  html: content,
  backgroundImageUrl: 'https://...',
  apiKey: 'YOUR_API_KEY',
  filename: 'verified-report.pdf',
  verificationUrl: 'https://myapp.com/verify?id=RPT123', // QR links here
});
```

The QR code will appear in the top-right corner.

### 5️⃣ Custom CSS Styling

```typescript
const customCss = `
  .highlight {
    background: #fef3c7;
    padding: 15px;
    border-left: 4px solid #f59e0b;
  }
`;

const pdfUrl = await generatePdfWithLetterhead({
  html: '<div class="highlight">Important!</div>',
  apiKey: 'YOUR_API_KEY',
  filename: 'styled.pdf',
  customCss: customCss,
});
```

## 🎨 Letterhead Background Guidelines

For best results with letterhead backgrounds:

1. **Image Dimensions:** Use exact A4 size
   - **210mm × 297mm** (standard A4)
   - **2480px × 3508px** at 300dpi (recommended)
   - **1654px × 2339px** at 200dpi (minimum)

2. **Design Layout:**
   - Reserve top ~130px (or your topMargin value) for header graphics
   - Reserve bottom ~130px (or your bottomMargin value) for footer graphics
   - Keep the middle area clean for content

3. **File Format:**
   - PNG (best for logos/text)
   - JPG (smaller file size)
   - Ensure publicly accessible URL

4. **Margins:**
   - Set `topMargin` to match your header height in the background
   - Set `bottomMargin` to match your footer height in the background
   - Script will automatically create spacers that repeat on every page

## 🔧 Integration Examples

### Supabase Edge Function

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { generatePdfWithLetterhead } from './pdf-co-helper.ts';

serve(async (req) => {
  const { html, backgroundUrl } = await req.json();
  
  const pdfUrl = await generatePdfWithLetterhead({
    html,
    backgroundImageUrl: backgroundUrl,
    apiKey: Deno.env.get('PDFCO_API_KEY')!,
    filename: `report-${Date.now()}.pdf`,
    topMargin: 130,
    bottomMargin: 130,
  });
  
  return new Response(JSON.stringify({ pdfUrl }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
```

### Node.js Express

```typescript
import express from 'express';
import { generatePdfWithLetterhead } from './pdf-co-helper';

const app = express();
app.use(express.json());

app.post('/generate-pdf', async (req, res) => {
  try {
    const { html, backgroundUrl } = req.body;
    
    const pdfUrl = await generatePdfWithLetterhead({
      html,
      backgroundImageUrl: backgroundUrl,
      apiKey: process.env.PDFCO_API_KEY!,
      filename: `report-${Date.now()}.pdf`,
    });
    
    res.json({ success: true, pdfUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000);
```

### React/Next.js Frontend

```typescript
// API route: /api/generate-pdf
import { generatePdfWithLetterhead } from '@/lib/pdf-co-helper';

export async function POST(req: Request) {
  const { html, backgroundUrl } = await req.json();
  
  const pdfUrl = await generatePdfWithLetterhead({
    html,
    backgroundImageUrl: backgroundUrl,
    apiKey: process.env.PDFCO_API_KEY!,
    filename: `document-${Date.now()}.pdf`,
  });
  
  return Response.json({ pdfUrl });
}
```

## 🐛 Troubleshooting

### Background image not showing
- ✅ Ensure the image URL is publicly accessible
- ✅ Check image dimensions (should be A4: 210mm × 297mm)
- ✅ Verify the URL uses HTTPS (HTTP may be blocked)
- ✅ Check PDF.co API logs for image fetch errors

### Content overlapping with header/footer
- ✅ Increase `topMargin` and `bottomMargin` values
- ✅ Ensure your background image has clear header/footer areas
- ✅ The margins create spacers that push content away from edges

### PDF generation timeout
- ✅ Use `async: true` for large documents (default)
- ✅ Reduce HTML/CSS size if possible
- ✅ Check PDF.co account quota/limits

### QR code not appearing
- ✅ Ensure `verificationUrl` is provided
- ✅ Check that the URL is properly encoded
- ✅ Verify QR code isn't hidden behind other elements

## 📊 Performance Tips

1. **Use async mode** for documents > 1 page (default)
2. **Optimize images** in your HTML (use CDN URLs, compress images)
3. **Minimize CSS** - remove unused styles
4. **BatchRequests** - generate multiple PDFs in parallel using `Promise.all()`

```typescript
const urls = await Promise.all([
  generatePdfWithLetterhead(options1),
  generatePdfWithLetterhead(options2),
  generatePdfWithLetterhead(options3),
]);
```

## 📝 License

This script is designed for use with PDF.co API. You need a valid PDF.co API key to use it.

Get your API key at: https://pdf.co/

## 🆘 Support

For issues specific to:
- **This script:** Check the examples in `pdf-co-helper-example.ts`
- **PDF.co API:** https://pdf.co/docs
- **A4 sizing:** Ensure background images are exactly 210mm × 297mm

---

**Created by:** LIMS v2 Development Team  
**Last Updated:** January 28, 2026
