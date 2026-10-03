# Crown Leave Form App

Internal tool for Crown Textile: upload the sick-leave register Excel file, review the
auto-detected columns, transliterate names/designations/departments into Urdu, add
signatures (with department/designation/reason rules), and generate print-ready
درخواست برائے چھٹی forms, two per A4 landscape page.

Live: https://hasnainarif.github.io/leave-form-app/

## Run locally

```bash
npm install
npm run dev
```

Optional Supabase (online signature + holiday storage); the app runs fully in
session-only mode when these are empty:

```bash
cp .env.example .env   # then fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run build
```

## Notes

- Official Crown logo is not available; the form renders a styled Urdu text
  fallback. To use a real logo, drop it as `public/crown-logo.png` and redeploy.
