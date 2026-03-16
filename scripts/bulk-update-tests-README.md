# Bulk Update Tests / Analytes

Fuzzy-match test groups or analytes from an Excel file and bulk-update fields in Supabase.

---

## Prerequisites

1. Run the DB migration: `db/migrations/20260312-1100__bulk_match_rpc.sql`
2. Set `SUPABASE_SERVICE_ROLE_KEY` in your `.env` or `.env.local`

---

## Usage

```bash
# Update test group prices
npx ts-node scripts/bulk-update-tests.ts \
  --lab=<lab_uuid> \
  --file=price_list.xlsx \
  --mode=tests

# Update analyte display names / units
npx ts-node scripts/bulk-update-tests.ts \
  --lab=<lab_uuid> \
  --file=analyte_names.xlsx \
  --mode=analytes

# Preview only (no writes)
npx ts-node scripts/bulk-update-tests.ts --lab=... --file=... --dry-run

# Lower the match threshold (default 0.4, range 0–1)
npx ts-node scripts/bulk-update-tests.ts --lab=... --file=... --threshold=0.3
```

---

## Excel Format — MODE: tests

Updates the `test_groups` table.

| name                        | price | collection_charge | turnaround_time | new_name           |
|-----------------------------|-------|-------------------|-----------------|--------------------|
| CBC Complete Blood Count    | 500   |                   |                 |                    |
| Urine Routine Examination   | 300   | 50                |                 |                    |
| Lipid Profile               | 700   |                   | 24 hours        | Lipid Panel        |

- **name** — required, used for fuzzy match (does not need to be exact)
- **price** — new price (leave blank to skip)
- **collection_charge** — new collection charge (leave blank to skip)
- **turnaround_time** — e.g. "24 hours" (leave blank to skip)
- **new_name** — rename the test group (leave blank to skip)

---

## Excel Format — MODE: analytes

Updates the `lab_analytes` table (lab-specific overrides).

| name              | display_name    | unit  | reference_range | reference_range_male | reference_range_female |
|-------------------|-----------------|-------|-----------------|----------------------|------------------------|
| Haemoglobin       | HGB             | g/dL  |                 | 13.5–17.5            | 12.0–16.0              |
| Total WBC Count   | WBC             | /cumm | 4000–11000      |                      |                        |
| Serum Cholesterol | Cholesterol     |       |                 |                      |                        |

- **name** — required, used for fuzzy match
- **display_name** — shown in PDF report (highest priority override)
- **unit** — lab-specific unit
- **reference_range** — lab-specific reference range (used when no gender-specific range)
- **reference_range_male** / **reference_range_female** — gender-specific ranges

---

## Confidence Levels

| Score     | Label  | Meaning                                    |
|-----------|--------|--------------------------------------------|
| ≥ 0.7     | HIGH   | Strong match, safe to apply automatically  |
| 0.4–0.69  | MEDIUM | Review recommended before confirming       |
| < 0.4     | LOW    | Skipped (below threshold)                  |

Adjust `--threshold` if you're getting too many skips (lower) or wrong matches (raise).

---

## Tips

- Column headers are **case-insensitive** and spaces are normalised to underscores
- Leave a cell blank to skip that field — only non-empty cells cause updates
- Use `--dry-run` first to review before committing
- If you get wrong matches, check if the test/analyte names in your DB differ significantly from the Excel names (e.g. abbreviations vs full names)
