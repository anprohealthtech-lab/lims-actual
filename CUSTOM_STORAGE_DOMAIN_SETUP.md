# Custom Storage Domain Setup

## Overview

Replace default Supabase storage URLs with branded custom domain URLs for better branding and shorter links.

**Before**: `https://scqhzbkkradflywariem.supabase.co/storage/v1/object/public/reports/ecopy/file.pdf`  
**After**: `https://reports.limsapp.in/ecopy/file.pdf`

## Quick Setup

### 1. Deploy Proxy (Netlify)

The proxy repository is at `d:/app folder/reports` containing:
- `netlify.toml` - Rewrites all requests to Supabase storage
- `index.html` - Placeholder file

**Deploy Steps:**
```bash
# 1. Push to Git
cd "d:/app folder/reports"
git init
git add .
git commit -m "Initial proxy setup"
git remote add origin https://github.com/your-org/reports-proxy.git
git push -u origin main

# 2. Deploy to Netlify
# - Login to Netlify → "Add new site"
# - Import from GitHub → select reports-proxy
# - Deploy (no build needed)
```

### 2. Configure Custom Domain

**In Netlify:**
1. Go to deployed site → Domain management
2. Add custom domain: `reports.limsapp.in`
3. Note the Netlify URL (e.g., `optimistic-beaver-123456.netlify.app`)

**In DNS Provider:**
1. Add CNAME record:
   - Name: `reports`
   - Target: `optimistic-beaver-123456.netlify.app`
2. Wait for DNS propagation (~10 minutes)

### 3. Configure Application

**Frontend (.env.local):**
```env
VITE_CUSTOM_STORAGE_DOMAIN=https://reports.limsapp.in
```

**Edge Function (Supabase Dashboard):**
1. Go to Edge Functions → `generate-pdf-auto` → Settings
2. Add environment variable:
   - Key: `CUSTOM_STORAGE_DOMAIN`
   - Value: `https://reports.limsapp.in`
3. Redeploy function

**Netlify Deployment:**
1. Go to Site settings → Environment variables
2. Add: `VITE_CUSTOM_STORAGE_DOMAIN=https://reports.limsapp.in`
3. Rebuild site

### 4. Verify

```bash
# Test direct file access
curl -I https://reports.limsapp.in/test.pdf

# Expected: 200 OK (or 404 if file doesn't exist)
# Should redirect to Supabase storage internally
```

## Implementation Details

### Code Changes

1. **Storage URL Builder** (`src/utils/storageUrlBuilder.ts`)
   - Centralized URL generation
   - Automatic fallback to Supabase default
   - Path extraction for backward compatibility

2. **Client-Side PDF Service** (`src/utils/pdfService.ts`)
   - Replaced all `getPublicUrl()` calls
   - Uses `getPublicStorageUrl()` utility

3. **Edge Function** (`supabase/functions/generate-pdf-auto/index.ts`)
   - Added `getPublicStorageUrl()` function
   - Reads `CUSTOM_STORAGE_DOMAIN` from Deno env

### Backward Compatibility

- **Old PDFs**: Keep existing Supabase URLs unchanged
- **New PDFs**: Use custom domain automatically
- **URL Extraction**: `extractStoragePath()` handles both formats

### Current Scope

✅ **Reports bucket** - Custom domain active  
❌ **Lab branding bucket** - Future implementation  
❌ **Workflow attachments** - Future implementation  

## Monitoring

Check logs for custom domain usage:

**Frontend Console:**
```
PDF saved to storage successfully: https://reports.limsapp.in/ecopy/order_123.pdf
```

**Edge Function Logs:**
```
✅ PDF uploaded to storage: https://reports.limsapp.in/ecopy/order_123.pdf
📡 Using custom domain: true
```

## Troubleshooting

### PDFs still use old URLs
- Check environment variables are set correctly
- Verify `.env.local` has `VITE_CUSTOM_STORAGE_DOMAIN`
- Clear browser cache and rebuild
- Check Netlify environment variables

### 404 errors on custom domain
- Verify DNS CNAME is correct
- Check Netlify domain configuration
- Test with `curl -I https://reports.limsapp.in`
- Check `netlify.toml` rewrite rules

### PDFs not downloading
- Check CORS headers in `netlify.toml`
- Verify file exists in Supabase storage
- Test with direct Supabase URL
- Check browser network tab for errors

## Future Enhancements

1. **Multiple Buckets**: Extend to `lab-branding`, `workflow-attachments`
2. **CDN Layer**: Add Cloudflare for performance
3. **URL Migration**: Script to migrate old URLs in database
4. **Analytics**: Track usage and performance
