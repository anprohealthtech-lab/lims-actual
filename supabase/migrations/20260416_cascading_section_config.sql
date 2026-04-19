-- Migration: Cascading Section Config
-- Date: 2026-04-16
-- Adds support for hierarchical/cascading predefined options in report sections.
-- e.g. Biopsy: Specimen → Gross Examination → Microscopic → Anatomical Site
-- e.g. Microbiology: Organism Found → Sensitivity → Antibiotics tested

-- Add section_config JSONB to store the cascading tree structure.
-- Non-breaking: existing sections keep using predefined_options (flat mode).
-- section_config shape: { mode: 'flat' | 'cascading', cascade_levels: CascadeLevel[] }
-- CascadeLevel: { id, label, multi_select, options: CascadeOption[] }
-- CascadeOption: { id, value, sub_levels?: CascadeLevel[] }
ALTER TABLE lab_template_sections
  ADD COLUMN IF NOT EXISTS section_config jsonb;

-- Add cascading_selections to store doctor selections per level.
-- Shape: Record<levelId, optionId[]>
-- e.g. { "lvl_specimen": ["opt_skin"], "lvl_gross_skin": ["opt_ulcerated"] }
ALTER TABLE result_section_content
  ADD COLUMN IF NOT EXISTS cascading_selections jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN lab_template_sections.section_config IS
  'Cascading options tree. Shape: { mode: flat|cascading, cascade_levels: [{id, label, multi_select, options: [{id, value, sub_levels?: [...]}]}] }';

COMMENT ON COLUMN result_section_content.cascading_selections IS
  'Doctor selections for cascading sections. Shape: Record<levelId, optionId[]>';
