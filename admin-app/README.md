# LIMS Admin App

Separate Netlify app for owner-level LIMS operations. The browser uses only the Supabase anon key. Privileged database changes happen inside the `admin-ops` Supabase Edge Function with the service role key.

## Netlify env

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Supabase Edge Function secrets

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_EMAILS` comma-separated owner emails allowed to use this admin app:
  `anprohealthtech@gmail.com,accucell12@gmail.com,accucell@gmail.com`

## Deploy

Deploy this folder as its own Netlify site:

```bash
cd admin-app
npm install
npm run build
```

Deploy the Edge Function from the repo root:

```bash
supabase functions deploy admin-ops
supabase secrets set ADMIN_EMAILS=anprohealthtech@gmail.com,accucell12@gmail.com,accucell@gmail.com
```
