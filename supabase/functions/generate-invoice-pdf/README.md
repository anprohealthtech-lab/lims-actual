# Generate Invoice PDF - Edge Function

This Supabase Edge Function securely generates invoice PDFs using PDF.co API without exposing the API key to the frontend.

## Features

- ✅ Secure server-side PDF.co API key storage
- ✅ HTML to PDF conversion via PDF.co
- ✅ Automatic upload to Supabase Storage (`invoices` bucket)
- ✅ Returns public URL for generated PDF
- ✅ CORS enabled for frontend access

## Setup

### 1. Set Secrets

```bash
# Set PDF.co API key (get from https://pdf.co)
supabase secrets set PDFCO_API_KEY=your_pdfco_api_key_here

# Verify secrets are set
supabase secrets list
```

### 2. Deploy Function

```bash
# Deploy to Supabase
supabase functions deploy generate-invoice-pdf

# Test locally
supabase functions serve generate-invoice-pdf
```

## Usage

### From Frontend (TypeScript)

```typescript
import { supabase } from './utils/supabase';

const { data: { session } } = await supabase.auth.getSession();

const response = await fetch(
  `${supabaseUrl}/functions/v1/generate-invoice-pdf`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      html: '<html>...</html>',
      filename: 'INV-2024-0001.pdf',
      invoiceId: 'uuid',
      labId: 'uuid',
    }),
  }
);

const result = await response.json();
console.log('PDF URL:', result.pdfUrl);
```

### Request Body

```typescript
{
  html: string;          // Complete HTML document
  filename: string;      // PDF filename (e.g., "INV-2024-0001.pdf")
  invoiceId?: string;    // Invoice UUID (for storage path)
  labId?: string;        // Lab UUID (for storage path)
}
```

### Response

**Success:**
```json
{
  "success": true,
  "pdfUrl": "https://...supabase.co/storage/v1/object/public/invoices/lab_id/invoices/filename.pdf",
  "filePath": "lab_id/invoices/filename.pdf",
  "pageCount": 1
}
```

**Error:**
```json
{
  "success": false,
  "error": "Error message"
}
```

## Environment Variables

Required in Supabase Edge Function:

- `PDFCO_API_KEY` - PDF.co API key (set via `supabase secrets set`)
- `SUPABASE_URL` - Auto-set by Supabase
- `SUPABASE_SERVICE_ROLE_KEY` - Auto-set by Supabase

## Testing

### Test Locally

```bash
# Start local edge functions
supabase functions serve

# Test with curl
curl -X POST http://localhost:54321/functions/v1/generate-invoice-pdf \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "html": "<html><body><h1>Test Invoice</h1></body></html>",
    "filename": "test.pdf",
    "invoiceId": "test-id",
    "labId": "test-lab"
  }'
```

### Test in Production

```bash
curl -X POST https://your-project.supabase.co/functions/v1/generate-invoice-pdf \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "html": "<html><body><h1>Test Invoice</h1></body></html>",
    "filename": "test.pdf",
    "invoiceId": "test-id",
    "labId": "test-lab"
  }'
```

## Error Handling

Common errors:

1. **PDFCO_API_KEY not configured**
   - Set via: `supabase secrets set PDFCO_API_KEY=your_key`

2. **HTML content is required**
   - Ensure `html` field is provided in request body

3. **PDF.co API error**
   - Check API key validity
   - Check PDF.co account limits (300 free/month)
   - Verify HTML is valid

4. **Failed to upload to storage**
   - Ensure `invoices` bucket exists
   - Check storage policies allow authenticated uploads

## Monitoring

View function logs:

```bash
# View recent logs
supabase functions logs generate-invoice-pdf

# Follow logs in real-time
supabase functions logs generate-invoice-pdf --follow
```

## Security

- ✅ API key never exposed to frontend
- ✅ Requires authentication (JWT token)
- ✅ Server-side execution only
- ✅ CORS configured for your domain only (update if needed)

## Cost Optimization

- PDF.co Free Tier: 300 PDFs/month
- Edge Function: Free for 500,000 invocations/month
- Storage: $0.021/GB/month

**Estimated Cost:** $0 for <300 invoices/month

## Troubleshooting

### Function not deploying

```bash
# Check function exists
ls supabase/functions/generate-invoice-pdf/

# Redeploy
supabase functions deploy generate-invoice-pdf --no-verify-jwt
```

### CORS errors

Update CORS headers in `index.ts`:

```typescript
'Access-Control-Allow-Origin': 'https://your-domain.com',
```

### Timeout errors

PDF.co uses synchronous generation (2-5 seconds). If timeouts occur:
- Check HTML size (<1MB recommended)
- Optimize template CSS
- Remove large embedded images
