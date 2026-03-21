-- ============================================================
-- 20260321_global_test_catalog_sections.sql
-- Adds global_test_catalog_sections table — a per-catalog-entry
-- definition of report sections (clinical_history, impression,
-- recommendation, etc.) that get seeded into lab_template_sections
-- whenever a lab is onboarded or synced.
--
-- UUID resolution: the onboarding function joins
--   global_test_catalog.name ↔ test_groups.name (for the lab)
-- so UUIDs are never stored globally — they are resolved at seed time.
-- ============================================================

-- ── 1. Table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.global_test_catalog_sections (
  id                    UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_id            UUID    NOT NULL
                                REFERENCES public.global_test_catalog(id) ON DELETE CASCADE,
  section_type          TEXT    NOT NULL
                                CHECK (section_type = ANY (ARRAY[
                                  'findings','impression','recommendation',
                                  'technique','clinical_history','conclusion','custom'
                                ])),
  section_name          TEXT    NOT NULL,
  display_order         INT     NOT NULL DEFAULT 0,
  default_content       TEXT,
  predefined_options    JSONB   NOT NULL DEFAULT '[]',
  is_required           BOOLEAN NOT NULL DEFAULT false,
  is_editable           BOOLEAN NOT NULL DEFAULT true,
  placeholder_key       TEXT,
  allow_images          BOOLEAN NOT NULL DEFAULT false,
  allow_technician_entry BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ DEFAULT NOW(),

  -- One section_type per catalog entry (prevents duplicate seeding)
  CONSTRAINT global_test_catalog_sections_unique
    UNIQUE (catalog_id, section_type)
);

-- Index for fast lookup during onboarding
CREATE INDEX IF NOT EXISTS idx_global_catalog_sections_catalog_id
  ON public.global_test_catalog_sections (catalog_id);

-- ── 2. RLS ───────────────────────────────────────────────────
ALTER TABLE public.global_test_catalog_sections ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read (needed for onboarding function)
CREATE POLICY "global_test_catalog_sections_read"
  ON public.global_test_catalog_sections
  FOR SELECT
  USING (true);

-- Only service role can insert/update/delete (managed by migrations/admin)
CREATE POLICY "global_test_catalog_sections_service_write"
  ON public.global_test_catalog_sections
  FOR ALL
  USING (auth.role() = 'service_role');

-- ── 3. Seed: 3 standard sections for EVERY existing catalog entry ──
-- clinical_history (order 1), impression (order 2), recommendation (order 3)
-- These are safe defaults — non-required, fully editable.
-- Labs that don't want them can delete; they will NOT be re-seeded
-- on re-sync (the onboarding step checks for existing sections).

INSERT INTO public.global_test_catalog_sections
  (catalog_id, section_type, section_name, display_order,
   default_content, predefined_options, is_required, is_editable,
   placeholder_key, allow_images, allow_technician_entry)
SELECT
  gtc.id,
  s.section_type,
  s.section_name,
  s.display_order,
  s.default_content,
  s.predefined_options::JSONB,
  false,   -- is_required
  true,    -- is_editable
  s.placeholder_key,
  false,   -- allow_images
  false    -- allow_technician_entry
FROM public.global_test_catalog gtc
CROSS JOIN (
  VALUES
    ('clinical_history', 'Clinical History',  1, NULL,                     '[]', 'clinical_history'),
    ('impression',       'Impression',         2, NULL,                     '[]', 'impression'),
    ('recommendation',  'Recommendation',     3, NULL,                     '[]', 'recommendation')
) AS s(section_type, section_name, display_order, default_content, predefined_options, placeholder_key)
ON CONFLICT (catalog_id, section_type) DO NOTHING;

-- ── Verify ───────────────────────────────────────────────────
/*
SELECT gtc.name AS test_group, gcs.section_type, gcs.section_name, gcs.display_order
FROM global_test_catalog_sections gcs
JOIN global_test_catalog gtc ON gtc.id = gcs.catalog_id
ORDER BY gtc.name, gcs.display_order;
*/
