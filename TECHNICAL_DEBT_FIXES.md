# Technical Debt & Fixes Roadmap

> Created: 2026-03-10
> Purpose: Track known issues and action items to address before showing the app to external people / investors.

---

## Priority Order

```
1. Security audit / privacy policy  ← legal risk, do first
2. Cleanup backup files             ← easy win, looks professional
3. Manual test checklist            ← cheap, immediate value
4. Overlap/messy code               ← lowest priority, ignore for now
```

---

## 1. Security Audit & Medical Data Compliance
**Risk:** Medical/lab data with no formal security review is a legal and reputational risk.

### Action Items
- [ ] Enable Supabase audit logs (Supabase dashboard → Logs → enable)
- [ ] Turn on 2FA for all admin accounts (Supabase + Netlify settings)
- [ ] Add Privacy Policy + Data Processing Agreement
  - Tool: [Termly.io](https://termly.io) (cheap) or hire a lawyer
  - Cost: ~$100–200
- [ ] Get a basic penetration test
  - Where: Upwork — search "Supabase security audit" or "web app pentest"
  - Cost: ~$500–1500
- [ ] Review what sensitive fields are stored — encrypt where needed (ask Claude)
- [ ] Confirm Row Level Security (RLS) is active on all tables with patient data

### What to tell people
> "We use Supabase with Row Level Security, data is encrypted at rest and in transit, and we are completing a formal security audit."

---

## 2. Cleanup Backup / Deprecated Files
**Risk:** Looks unprofessional to engineers reviewing the codebase. Also slows down development.

### What to clean up
- Files with suffixes: `_backup`, `_v1.0.13`, `_Clean`, `_Working`, `_old`
- Duplicate page implementations (Orders, Results, Reports have multiple versions)
- Unused SQL scripts in root: `audit_duplicates_orphans.sql`, `cleanup_lab_unused_data.sql`, etc.

### Action Items
- [ ] Ask Claude to scan and list all backup/deprecated files
- [ ] Review the list and confirm which are safe to delete
- [ ] Delete confirmed files in one clean commit
- [ ] Move loose SQL scripts to a `/db/archive/` folder

> **Note:** This does NOT affect the running app. Pure housekeeping.

---

## 3. Manual Test Checklist (Until Automated Tests Exist)
**Risk:** Bugs discovered by users instead of before release.

### Action Items
- [ ] Create a Google Sheet: "Pre-Release Test Checklist"
- [ ] Add these critical flows to test before every release:
  - [ ] Create a new patient
  - [ ] Place a new order with multiple tests
  - [ ] Enter results manually
  - [ ] Generate and share a PDF report via WhatsApp
  - [ ] Create an invoice and mark as paid
  - [ ] Add a new test/analyte
  - [ ] Onboard a new lab (if applicable)
  - [ ] Login as different roles (admin, technician, doctor)
- [ ] Run this checklist before every deployment

### Future: Automated Testing
- Tool options: **Checkly**, **Playwright** (browser automation, no code needed)
- Or: hire a QA freelancer (Upwork, ~$200–500 for basic suite)

### What to tell people
> "We have a manual QA process and are moving toward automated testing."

---

## 4. Feature Overlap & Messy Code
**Risk:** Low — invisible to users. Only matters if adding new features to affected areas.

### Known Areas
- Orders page — multiple rewrite versions exist
- Results entry — overlapping implementations (manual, AI, workflow-based)
- Reports/verification — multiple approaches implemented

### Action Items
- [ ] Do NOT rush to fix this — live product, low risk
- [ ] When adding new features in these areas, ask Claude to refactor that section first
- [ ] Gradual cleanup over time is the right approach

---

## Status Legend
| Symbol | Meaning |
|--------|---------|
| `[ ]` | Not started |
| `[x]` | Done |
| `[-]` | In progress |
| `[~]` | Deferred / low priority |

---

## Notes
- This file lives at the project root. Update it as items are completed.
- Revisit this list before any investor demo or external lab onboarding.
