# LIMS Patient Portal (PWA)

Standalone, installable Progressive Web App for patients. Talks to the same
Supabase backend as the main LIMS app — no schema changes of its own.

## Features
- Login with registered mobile number + 6-digit PIN (with WhatsApp "Forgot PIN")
- View orders, sample status, and download report PDFs
- Book home collections; track the phlebotomist live on a map while en route
- Change PIN
- Installable on Android/iOS/desktop ("Add to Home Screen"), auto-updating
  service worker

## Local development
```bash
cd patient-app
npm install
cp .env.example .env   # fill in the same VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY as the main app
npm run dev
```

## Deploy (Netlify)
Create a separate Netlify site pointing at this repo with:
- Base directory: `patient-app`
- Build command: `npm run build`
- Publish directory: `patient-app/dist`
- Environment: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

Suggested domain: `portal.limsapp.in`. After changing the domain, update the
links baked into WhatsApp messages:
- `supabase/functions/patient-forgot-pin/index.ts` (login link)
- Main app `PatientDetails.tsx` portal-credentials message (uses window.origin
  of the LIMS app — point it at the PWA domain instead)

## Routes
- `/login` — phone + PIN login
- `/portal` — patient dashboard (default redirect target)
