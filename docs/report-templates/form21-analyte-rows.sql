-- ============================================================
-- form21-analyte-rows.sql
--
-- Generates the exact <tr> markup for Annexure item (8)
-- LAB INVESTIGATIONS, using the real placeholder keys derived
-- from each analyte's code.
--
-- Key rule (get_report_template_context, 20260420 migration):
--   ANALYTE_<CODE>_VALUE  where
--   <CODE> = UPPER(analytes.code) with ALL non-alphanumerics REMOVED
--   falling back to the analyte name when code is empty.
--   e.g. code 'SERUM_UREA' -> ANALYTE_SERUMUREA_VALUE   (no underscore)
--
-- HOW TO USE:
--   1. Attach the item (8) analytes to the test group in the Tests UI.
--   2. Run this. Copy the generated `row_html` column.
--   3. Paste it into the <tbody> of the .lab-table in
--      docs/report-templates/form21-annexure.html, replacing the
--      skeleton rows.
-- ============================================================

SELECT
  COALESCE(tga.section_heading, 'INVESTIGATIONS') AS group_heading,
  COALESCE(tga.analyte_name, a.name)              AS analyte,
  a.code                                          AS raw_code,
  slug.key                                        AS placeholder_code,
  '<tr><td>' || COALESCE(tga.analyte_name, a.name) || '</td>'
    || '<td class="val">{{ANALYTE_' || slug.key || '_VALUE}}</td>'
    || '<td>{{ANALYTE_'             || slug.key || '_UNIT}}</td>'
    || '<td>{{ANALYTE_'             || slug.key || '_REFERENCE}}</td>'
    || '<td>{{ANALYTE_'             || slug.key || '_FLAG}}</td></tr>'  AS row_html
FROM test_group_analytes tga
JOIN analytes a ON a.id = tga.analyte_id
CROSS JOIN LATERAL (
  SELECT COALESCE(
    NULLIF(UPPER(regexp_replace(a.code, '[^A-Za-z0-9]+', '', 'g')), ''),
           UPPER(regexp_replace(a.name, '[^A-Za-z0-9]+', '', 'g'))
  ) AS key
) slug
WHERE tga.test_group_id = 'c1d53eae-c3f2-4e11-85b0-1c57e9316e72'
  AND COALESCE(tga.is_header, false) = false
ORDER BY tga.section_heading NULLS FIRST, tga.sort_order, tga.display_order;


-- ── Optional: one-shot version that returns the whole <tbody> ──
-- Uncomment to get a single string you can paste directly.
--
-- SELECT string_agg(
--   '<tr><td>' || COALESCE(tga.analyte_name, a.name) || '</td>'
--     || '<td class="val">{{ANALYTE_' || slug.key || '_VALUE}}</td>'
--     || '<td>{{ANALYTE_'             || slug.key || '_UNIT}}</td>'
--     || '<td>{{ANALYTE_'             || slug.key || '_REFERENCE}}</td>'
--     || '<td>{{ANALYTE_'             || slug.key || '_FLAG}}</td></tr>',
--   E'\n' ORDER BY tga.sort_order, tga.display_order) AS tbody_html
-- FROM test_group_analytes tga
-- JOIN analytes a ON a.id = tga.analyte_id
-- CROSS JOIN LATERAL (
--   SELECT COALESCE(
--     NULLIF(UPPER(regexp_replace(a.code, '[^A-Za-z0-9]+', '', 'g')), ''),
--            UPPER(regexp_replace(a.name, '[^A-Za-z0-9]+', '', 'g'))
--   ) AS key
-- ) slug
-- WHERE tga.test_group_id = 'c1d53eae-c3f2-4e11-85b0-1c57e9316e72'
--   AND COALESCE(tga.is_header, false) = false;
