-- ============================================================
-- Bulk fuzzy-match RPC for lab test group / analyte updates
-- Requires: pg_trgm extension (trigram similarity)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ──────────────────────────────────────────────────────────────
-- 1) bulk_match_test_groups
--    Input:  lab_id + JSONB array of rows, each with at least "name"
--    Output: JSONB array — one entry per input row, with top 3
--            candidate matches sorted by trigram similarity score
--
--    Example input rows:
--      [{"name":"CBC Complete Blood Count","price":500},
--       {"name":"Urine Routine Examination","collection_charge":50}]
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bulk_match_test_groups(
  p_lab_id UUID,
  p_rows   JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  results     JSONB := '[]'::JSONB;
  row_item    JSONB;
  match_name  TEXT;
  candidates  JSONB;
BEGIN
  FOR row_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    match_name := trim(row_item->>'name');

    -- Top 3 candidates by trigram similarity
    SELECT jsonb_agg(c ORDER BY c->>'score' DESC)
    INTO candidates
    FROM (
      SELECT jsonb_build_object(
        'id',                  tg.id,
        'name',                tg.name,
        'price',               tg.price,
        'collection_charge',   tg.collection_charge,
        'turnaround_time',     tg.turnaround_time,
        'score',               round(similarity(tg.name, match_name)::numeric, 3)
      ) AS c
      FROM test_groups tg
      WHERE tg.lab_id = p_lab_id
        AND tg.is_active = true
      ORDER BY similarity(tg.name, match_name) DESC
      LIMIT 3
    ) sub;

    results := results || jsonb_build_array(
      jsonb_build_object(
        'input',      row_item,
        'candidates', COALESCE(candidates, '[]'::JSONB)
      )
    );
  END LOOP;

  RETURN results;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_match_test_groups(UUID, JSONB) TO service_role;


-- ──────────────────────────────────────────────────────────────
-- 2) bulk_match_analytes
--    Input:  lab_id + JSONB array of rows, each with "name"
--            (matches against analytes visible to the lab via lab_analytes)
--    Output: JSONB array — one entry per input row with top 3 candidates
--
--    Example input rows:
--      [{"name":"Haemoglobin","display_name":"HGB","unit":"g/dL"},
--       {"name":"Total WBC Count","display_name":"WBC"}]
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bulk_match_analytes(
  p_lab_id UUID,
  p_rows   JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  results     JSONB := '[]'::JSONB;
  row_item    JSONB;
  match_name  TEXT;
  candidates  JSONB;
BEGIN
  FOR row_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    match_name := trim(row_item->>'name');

    -- Match against the lab's visible analytes
    -- Prefer lab_specific_name or display_name for similarity if set
    SELECT jsonb_agg(c ORDER BY c->>'score' DESC)
    INTO candidates
    FROM (
      SELECT jsonb_build_object(
        'analyte_id',         a.id,
        'analyte_name',       a.name,
        'display_name',       la.display_name,
        'lab_specific_name',  la.lab_specific_name,
        'unit',               COALESCE(la.lab_specific_unit, a.unit),
        'reference_range',    COALESCE(la.lab_specific_reference_range, a.reference_range),
        'score',              round(
          GREATEST(
            similarity(a.name, match_name),
            similarity(COALESCE(la.lab_specific_name, ''), match_name),
            similarity(COALESCE(la.display_name, ''), match_name)
          )::numeric, 3)
      ) AS c
      FROM lab_analytes la
      JOIN analytes a ON a.id = la.analyte_id
      WHERE la.lab_id = p_lab_id
        AND la.is_active = true
      ORDER BY GREATEST(
        similarity(a.name, match_name),
        similarity(COALESCE(la.lab_specific_name, ''), match_name),
        similarity(COALESCE(la.display_name, ''), match_name)
      ) DESC
      LIMIT 3
    ) sub;

    results := results || jsonb_build_array(
      jsonb_build_object(
        'input',      row_item,
        'candidates', COALESCE(candidates, '[]'::JSONB)
      )
    );
  END LOOP;

  RETURN results;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_match_analytes(UUID, JSONB) TO service_role;
