-- ============================================================
-- MIGRATION: Deprecate all duplicate global analytes
-- Date: 2026-03-09
-- ============================================================
-- Problem: 697 global analytes with only 487 unique codes.
--   210 excess duplicates across 57 codes. All is_global=true
--   entries go to ALL labs via lab_analytes, causing noise.
--
-- Strategy: For each duplicated code, KEEP one canonical entry:
--   Priority 1 — a1cbc000-... UUIDs (our canonical CBC analytes)
--   Priority 2 — newest created_at (most recently curated)
--   All others → is_global=false, to_be_copied=false
--
-- SAFE: Does NOT touch is_active, lab_analytes, test_group_analytes,
--   or result_values. Existing lab data is fully preserved.
-- ============================================================

BEGIN;

-- ── STEP 1: Deprecate excess duplicates ──────────────────────
-- For each code that has more than 1 is_global=true row,
-- keep exactly ONE (canonical or newest), set rest to non-global.

WITH duplicated_codes AS (
  -- Find all codes that have more than 1 global analyte
  SELECT code
  FROM public.analytes
  WHERE is_global = true
    AND code IS NOT NULL
    AND code != ''
  GROUP BY code
  HAVING COUNT(*) > 1
),
ranked AS (
  -- Rank each analyte within its code group
  SELECT
    a.id,
    a.code,
    a.created_at,
    ROW_NUMBER() OVER (
      PARTITION BY a.code
      ORDER BY
        -- Canonical CBC analytes always win
        CASE WHEN a.id::text LIKE 'a1cbc000%' THEN 0 ELSE 1 END,
        -- Then prefer the newest (most recently curated)
        a.created_at DESC,
        -- Tiebreak by id for determinism
        a.id::text ASC
    ) AS rn
  FROM public.analytes a
  WHERE a.is_global = true
    AND a.code IN (SELECT code FROM duplicated_codes)
)
UPDATE public.analytes
SET
  is_global    = false,
  to_be_copied = false,
  updated_at   = now()
WHERE id IN (
  SELECT id FROM ranked WHERE rn > 1
)
-- Safety: never touch our canonical CBC analytes even if something goes wrong
AND id::text NOT LIKE 'a1cbc000%';

-- ── STEP 2: Verification ─────────────────────────────────────

-- A. Summary: how many were deprecated?
SELECT
  'Deprecated this run' AS label,
  COUNT(*) AS count
FROM public.analytes
WHERE is_global = false
  AND updated_at > now() - interval '5 minutes'
  AND id::text NOT LIKE 'a1cbc000%';

-- B. Confirm no more duplicate global codes (should return 0 rows)
SELECT
  code,
  COUNT(*) AS still_global
FROM public.analytes
WHERE is_global = true
  AND code IS NOT NULL
  AND code != ''
GROUP BY code
HAVING COUNT(*) > 1
ORDER BY still_global DESC;

-- C. What was KEPT per previously-duplicate code
SELECT
  a.code,
  a.id,
  a.name,
  a.unit,
  a.created_at::date AS created,
  CASE WHEN a.id::text LIKE 'a1cbc000%' THEN 'canonical' ELSE 'newest' END AS kept_reason
FROM public.analytes a
WHERE a.is_global = true
  AND a.code IN (
    'GLU','AST','K','HEPATI','NA','DENGUE','BUN','BILIRU','ALB',
    'CREAT','CHOL','CREA','APTT','PT','FT4','TSH','T4','HBA1C',
    'T3','STYPHI','SPARAT','REDBLO','CL','ALT','PH','CRE','AFP',
    'ALP','BICARB','CALCIU','COLOR','CREACT','IGE','LDL','MAGNESIUM',
    'MALARI','MICROS','POSTPR','TROP','VITAMI','GROSSD','DIAGNOSIS',
    'HCV-AB','HDL','DC','HIVIII','HIVRAP','IBIL','IGA','IGD',
    'BACT-ID','IGG','IGM','IMMUNO','INS','INTERN','DBIL','KETONES',
    'APPEARANCE','LIPID','TLC','TOXOPL','TRANSF','MPV','ABO_GROUP',
    'NTPROBNP','PCO2','CPK','AFB','PROTEIN','PSA','CMP','CBC',
    'RETICU','RF','RHD_TYPE','SICKLI','SIGE','CA','SPECIF','BLOOD',
    'T13','ESTIMA','FERRITIN','FERTN','FSH','FT3','ESR','GGT','EPITHE'
  )
ORDER BY a.code;

-- D. Total global analytes remaining (should be ~487)
SELECT
  COUNT(*) AS total_global_remaining,
  COUNT(DISTINCT code) AS unique_codes
FROM public.analytes
WHERE is_global = true;

COMMIT;
