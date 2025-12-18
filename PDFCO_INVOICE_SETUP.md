# PDF.co Invoice Generation Setup

## Quick Start

### 1. Get PDF.co API Key

1. Sign up at **https://pdf.co**
2. Go to **Dashboard → API Keys**
3. Copy your API key
4. Free tier includes:
   - 300 API calls/month
   - 10 MB file size limit
   - All features

### 2. Configure Environment Variable

Add to your `.env` file:

```env
VITE_PDFCO_API_KEY=your_api_key_here
```

### 3. Test Invoice Generation

```typescript
import { generateInvoicePDF } from '@/utils/invoicePdfService';

// Generate invoice PDF
const pdfUrl = await generateInvoicePDF(invoiceId);
console.log('PDF generated:', pdfUrl);
```

---

## PDF.co API Details

### Endpoint Used
```
POST https://api.pdf.co/v1/pdf/convert/from/html
```

### Request Format
```typescript
{
  html: string,              // Complete HTML document
  name: string,              // PDF filename
  margins: string,           // "10mm 10mm 15mm 15mm" (top right bottom left)
  paperSize: "A4",          // Paper size
  orientation: "Portrait",   // Portrait or Landscape
  printBackground: true,     // Include CSS backgrounds
  async: false              // Synchronous generation
}
```

### Response Format
```typescript
{
  url: string,              // Temporary URL to download PDF (valid 1 hour)
  pageCount: number,        // Number of pages
  error: boolean,           // Error flag
  message: string           // Error message if any
}
```

---

## Error Handling

### Common Errors

**1. API Key Missing**
```
Error: PDF.co API key not configured
Solution: Add VITE_PDFCO_API_KEY to .env file
```

**2. API Limit Exceeded**
```
Error: PDF.co API error: 429 - Rate limit exceeded
Solution: Upgrade PDF.co plan or wait for reset (monthly)
```

**3. Invalid HTML**
```
Error: PDF.co generation failed: Invalid HTML
Solution: Check template HTML syntax
```

**4. Download Failed**
```
Error: Failed to download PDF from PDF.co: 404
Solution: PDF.co temporary URL expired (1 hour). Regenerate.
```

---

## Pricing Tiers

| Plan | API Calls/Month | Price |
|------|----------------|-------|
| Free | 300 | $0 |
| Basic | 3,000 | $9.99 |
| Pro | 10,000 | $29.99 |
| Business | 50,000 | $99.99 |
| Enterprise | Unlimited | Custom |

**Recommendation:** Start with **Free** tier. Upgrade to **Basic** if generating 10+ invoices/day.

---

## PDF.co vs Puppeteer

| Feature | PDF.co | Puppeteer |
|---------|--------|-----------|
| Setup | ✅ No server needed | ❌ Requires Node.js server |
| Scaling | ✅ Auto-scales | ❌ Manual scaling |
| Maintenance | ✅ Zero maintenance | ❌ Server updates needed |
| Cost (300 PDFs) | ✅ Free | ❌ Server hosting cost |
| Speed | ⚡ 2-5 seconds | ⚡ 3-8 seconds |
| Concurrency | ✅ Unlimited | ❌ Limited by server |
| Reliability | ✅ 99.9% uptime | ⚠️ Depends on server |

**Winner:** PDF.co for serverless architecture

---

## Advanced Configuration

### Custom Headers/Footers

```typescript
// In invoicePdfService.ts, modify callPdfCoService:
{
  html: html,
  header: '<div style="text-align: center; font-size: 10px;">{{lab_name}}</div>',
  footer: '<div style="text-align: center; font-size: 10px;">Page {{page}} of {{pages}}</div>',
  margins: '20mm 10mm 20mm 10mm', // Increase top/bottom for header/footer
}
```

### Landscape Orientation

```typescript
{
  orientation: "Landscape",
  paperSize: "A4"
}
```

### Custom Paper Size

```typescript
{
  paperSize: "Letter",  // Options: A4, Letter, Legal, A3, A5
}
```

---

## Monitoring & Logs

### Check API Usage

```typescript
// Call PDF.co API to check usage
const response = await fetch('https://api.pdf.co/v1/usage', {
  headers: {
    'x-api-key': PDFCO_API_KEY
  }
});
const usage = await response.json();
console.log('Remaining credits:', usage.remaining);
```

### Log PDF Generation

```typescript
// Already implemented in invoicePdfService.ts
console.log('PDF generation started for invoice:', invoiceId);
console.log('PDF uploaded to:', pdfUrl);
```

---

## Troubleshooting

### Issue: Slow PDF Generation (>10 seconds)

**Causes:**
- Large HTML (>1MB)
- Many images/assets
- Complex CSS

**Solutions:**
1. Optimize template CSS (remove unused styles)
2. Compress images before embedding
3. Use async: true for background generation

### Issue: PDF Looks Different from Browser

**Causes:**
- Missing CSS print media queries
- External fonts not loading
- JavaScript not executed

**Solutions:**
1. Add print media queries: `@media print { }`
2. Embed fonts in CSS: `@font-face { src: url('...') }`
3. Avoid JavaScript-dependent rendering

### Issue: Invoice Items Table Broken

**Causes:**
- Table too wide for A4
- Missing border-collapse
- Complex nested tables

**Solutions:**
1. Use `max-width: 100%` on tables
2. Add `border-collapse: collapse`
3. Test with `printBackground: true`

---

## Security Best Practices

### 1. API Key Protection

✅ **DO:**
- Store in `.env` (never commit)
- Use server-side rendering if possible
- Rotate keys regularly

❌ **DON'T:**
- Hardcode in frontend
- Expose in public repos
- Share keys publicly

### 2. Invoice Data Validation

Already implemented in `invoicePdfService.ts`:
- ✅ Validates invoice has items
- ✅ Validates financial totals
- ✅ Validates partial invoice constraints
- ✅ Checks amount_paid <= total

### 3. PDF Storage

✅ **DO:**
- Use signed URLs for sensitive invoices
- Set expiration on storage URLs
- Implement RLS policies

---

## Testing Checklist

- [ ] **API Key Works**
  ```bash
  curl -X POST https://api.pdf.co/v1/pdf/convert/from/html \
    -H "x-api-key: YOUR_KEY" \
    -H "Content-Type: application/json" \
    -d '{"html":"<h1>Test</h1>","name":"test.pdf"}'
  ```

- [ ] **Environment Variable Loaded**
  ```typescript
  console.log('PDF.co API Key:', import.meta.env.VITE_PDFCO_API_KEY ? '✅ Set' : '❌ Missing');
  ```

- [ ] **Invoice PDF Generates**
  ```typescript
  const pdfUrl = await generateInvoicePDF(testInvoiceId);
  console.log('Success:', pdfUrl);
  ```

- [ ] **PDF Downloads Correctly**
  - Open PDF URL in browser
  - Check all placeholders replaced
  - Verify invoice items render
  - Check totals display correctly

- [ ] **Partial Invoice Badge Appears**
  - Create partial invoice (is_partial = true)
  - Generate PDF
  - Verify "PARTIAL INVOICE" badge visible

- [ ] **All 5 Templates Work**
  - Test Standard Invoice
  - Test Minimal Invoice
  - Test Professional Invoice
  - Test B2B Detailed Invoice
  - Test Modern Invoice

---

## Support & Resources

- **PDF.co Docs:** https://apidocs.pdf.co
- **HTML to PDF API:** https://pdf.co/html-to-pdf-api
- **Support:** support@pdf.co
- **Status Page:** https://status.pdf.co

---

## Migration from Puppeteer

If you were using Puppeteer before:

1. **Remove Puppeteer service dependency**
   - No need to deploy separate Node.js server
   - No need to manage Puppeteer updates

2. **Update environment variables**
   ```diff
   - VITE_PUPPETEER_SERVICE_URL=https://api.limsapp.in/puppeteer
   + VITE_PDFCO_API_KEY=your_api_key_here
   ```

3. **Code changes already done**
   - ✅ `invoicePdfService.ts` updated
   - ✅ Uses PDF.co API now
   - ✅ Same interface (no breaking changes)

4. **Test thoroughly**
   - Generate sample invoices
   - Compare with Puppeteer output
   - Verify all templates work

---

**Setup Complete!** 🎉  
Your invoice system now uses PDF.co for serverless PDF generation.
