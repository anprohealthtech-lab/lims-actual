# LIMS Mini - React + Supabase Edition

A minimal, fast, and cheap Laboratory Information Management System built with React and Supabase.

## Features

- ✅ Patient management
- ✅ Order creation with test selection
- ✅ Barcode/order number tracking
- ✅ Result entry with auto-flagging (high/low/normal)
- ✅ Result verification workflow
- ✅ Test catalog management with reference ranges
- ✅ Lab settings configuration
- ✅ Dashboard with stats

## Tech Stack

- **Frontend**: React 18 + Vite + TailwindCSS
- **Backend**: Supabase (PostgreSQL + Auth + Real-time)
- **Hosting**: Vercel/Netlify (free tier)

## Cost Estimate

| Service | Free Tier | Paid (if needed) |
|---------|-----------|------------------|
| Supabase | 500MB DB, 50K auth users | $25/mo for 8GB |
| Vercel/Netlify | Unlimited static hosting | Usually stays free |
| **Total** | **$0/month** | **$25/month max** |

## Setup Instructions

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create account
2. Create new project
3. Go to **SQL Editor** and run the schema from `supabase/schema.sql`

### 2. Configure Environment

1. Copy `.env.example` to `.env`
2. Fill in your Supabase credentials:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Find these in Supabase Dashboard → Settings → API

### 3. Create First User

1. Go to Supabase Dashboard → Authentication → Users
2. Click "Add User" and create your admin account

### 4. Install & Run

```bash
npm install
npm run dev
```

Open http://localhost:5173

### 5. Deploy (Free)

**Vercel:**
```bash
npm install -g vercel
vercel
```

**Netlify:**
```bash
npm run build
# Drag & drop `dist` folder to netlify.com
```

## Project Structure

```
src/
├── lib/
│   └── supabase.js      # Supabase client
├── pages/
│   ├── Login.jsx        # Auth page
│   ├── Dashboard.jsx    # Stats overview
│   ├── Patients.jsx     # Patient management
│   ├── Orders.jsx       # Order list
│   ├── NewOrder.jsx     # Create order
│   ├── ResultEntry.jsx  # Enter results
│   ├── Verification.jsx # Verify results
│   └── Settings.jsx     # Lab config + test catalog
├── App.jsx              # Router + layout
├── main.jsx             # Entry point
└── index.css            # Tailwind styles

supabase/
└── schema.sql           # Database schema
```

## Workflow

```
1. Create Patient (or select existing)
        ↓
2. Create Order (select tests)
        ↓
3. Order registered with barcode
        ↓
4. Enter Results (technician)
   - Auto-flags high/low values
        ↓
5. Verify Results (lab manager)
        ↓
6. Order marked as verified
```

## Database Tables

| Table | Purpose |
|-------|---------|
| `patients` | Patient master data |
| `orders` | Order headers |
| `order_tests` | Tests per order |
| `results` | Result values with flags |
| `test_catalog` | Test definitions + analytes |
| `settings` | Lab configuration |

## Customization

### Add New Tests

Go to Settings → Test Catalog → Add test with analytes JSON:

```json
[
  {"name": "Hemoglobin", "unit": "g/dL", "reference_range": "12-16"},
  {"name": "WBC", "unit": "x10^3/uL", "reference_range": "4-11"}
]
```

### Reference Range Formats

- Range: `12-16` or `12 - 16`
- Less than: `< 200`
- Greater than: `> 40`

## Scaling Notes

- Supabase free tier handles ~10,000 orders easily
- Add indexes for heavy queries
- Consider archiving old orders annually
- Upgrade to paid tier (~$25/mo) for larger labs

## What's NOT Included

- AI result parsing
- WhatsApp/SMS integration
- Analyzer integration
- PDF report generation (can add via Supabase Edge Functions)
- Multi-lab support
- Inventory management
- Payment processing

## Adding PDF Reports

For PDF generation, you can add a Supabase Edge Function:

```typescript
// supabase/functions/generate-report/index.ts
import { createClient } from '@supabase/supabase-js'
import PDFDocument from 'pdfkit'

// Generate PDF from order data
```

Or use client-side libraries like `jspdf` or `react-pdf`.

## License

MIT - Use freely for your diagnostic lab!
