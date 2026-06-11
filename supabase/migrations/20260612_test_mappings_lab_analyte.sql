-- Add lab_analyte_id to test_mappings for proper per-lab, per-instrument mapping
-- lab_analyte_id is the correct key since each lab has different instruments/protocols

-- 1. Add lab_analyte_id column
ALTER TABLE public.test_mappings
  ADD COLUMN IF NOT EXISTS lab_analyte_id UUID REFERENCES public.lab_analytes(id) ON DELETE CASCADE;

-- 2. Add index for fast lookup by lab_analyte_id + analyzer
CREATE INDEX IF NOT EXISTS idx_test_mappings_lab_analyte_lookup
  ON public.test_mappings(lab_id, lab_analyte_id, analyzer_connection_id, mapping_type, direction)
  WHERE lab_analyte_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_test_mappings_lab_analyte_profile_lookup
  ON public.test_mappings(lab_id, lab_analyte_id, analyzer_profile_id, mapping_type, direction)
  WHERE lab_analyte_id IS NOT NULL;

-- 3. Backfill existing mappings: resolve analyte_id → lab_analyte_id
UPDATE public.test_mappings tm
SET lab_analyte_id = la.id
FROM public.lab_analytes la
WHERE tm.analyte_id = la.analyte_id
  AND tm.lab_id = la.lab_id
  AND tm.lab_analyte_id IS NULL;

-- 4. Add comment
COMMENT ON COLUMN public.test_mappings.lab_analyte_id IS
  'Lab-specific analyte reference. Primary lookup key for per-lab instrument mapping.';

-- 5. Update save_ai_mapping function to accept lab_analyte_id
CREATE OR REPLACE FUNCTION public.save_ai_mapping(
    p_lab_id UUID,
    p_lims_code TEXT,
    p_analyzer_code TEXT,
    p_analyzer_id TEXT,
    p_confidence FLOAT,
    p_analyte_id UUID DEFAULT NULL,
    p_test_name TEXT DEFAULT NULL,
    p_lab_analyte_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_id UUID;
    v_resolved_lab_analyte_id UUID;
BEGIN
    -- Resolve lab_analyte_id if not provided but analyte_id is
    v_resolved_lab_analyte_id := p_lab_analyte_id;
    IF v_resolved_lab_analyte_id IS NULL AND p_analyte_id IS NOT NULL THEN
        SELECT id INTO v_resolved_lab_analyte_id
        FROM public.lab_analytes
        WHERE lab_id = p_lab_id AND analyte_id = p_analyte_id
        LIMIT 1;
    END IF;

    INSERT INTO public.test_mappings (
        lab_id,
        lims_code,
        analyzer_code,
        analyzer_id,
        analyzer_profile_id,
        ai_confidence,
        ai_source,
        analyte_id,
        lab_analyte_id,
        usage_count,
        test_name,
        mapping_type,
        direction,
        supports_order_send,
        supports_result_receive
    ) VALUES (
        p_lab_id,
        p_lims_code,
        p_analyzer_code,
        p_analyzer_id,
        p_analyzer_id,
        p_confidence,
        'gemini',
        p_analyte_id,
        v_resolved_lab_analyte_id,
        1,
        COALESCE(p_test_name, p_lims_code),
        CASE WHEN p_analyte_id IS NULL THEN 'order_service' ELSE 'result_analyte' END,
        CASE WHEN p_analyte_id IS NULL THEN 'outbound' ELSE 'inbound' END,
        p_analyte_id IS NULL,
        p_analyte_id IS NOT NULL
    )
    RETURNING id INTO v_id;

    RETURN v_id;
EXCEPTION WHEN unique_violation THEN
    UPDATE public.test_mappings
    SET
        analyzer_code = p_analyzer_code,
        ai_confidence = GREATEST(COALESCE(ai_confidence, 0), p_confidence),
        usage_count = COALESCE(usage_count, 0) + 1,
        last_used_at = now(),
        updated_at = now(),
        lab_analyte_id = COALESCE(lab_analyte_id, v_resolved_lab_analyte_id),
        mapping_type = CASE WHEN p_analyte_id IS NULL THEN 'order_service' ELSE mapping_type END,
        direction = CASE WHEN p_analyte_id IS NULL THEN 'outbound' ELSE direction END
    WHERE lab_id = p_lab_id
      AND (analyzer_id = p_analyzer_id OR analyzer_profile_id = p_analyzer_id)
      AND lims_code = p_lims_code
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- 6. Add analyzer_profile_code_mappings lab_analyte support (for profile defaults that need lab context)
ALTER TABLE public.analyzer_profile_code_mappings
  ADD COLUMN IF NOT EXISTS global_analyte_id UUID REFERENCES public.analytes(id);

COMMENT ON COLUMN public.analyzer_profile_code_mappings.global_analyte_id IS
  'Global analyte reference for profile-level defaults. Resolved to lab_analyte_id at runtime.';
