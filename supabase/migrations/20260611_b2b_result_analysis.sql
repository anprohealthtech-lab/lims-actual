-- Account-scoped result analysis for the B2B portal.
-- Raw results remain protected by RLS; this function returns only values for
-- orders owned by the authenticated B2B account.
CREATE OR REPLACE FUNCTION public.get_b2b_result_analysis(p_order_ids uuid[] DEFAULT NULL)
RETURNS TABLE (
  order_id uuid,
  sample_id text,
  patient_name text,
  order_date date,
  test_group_name text,
  analyte_name text,
  value text,
  unit text,
  reference_range text,
  flag text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  IF COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', '') <> 'b2b_account' THEN
    RAISE EXCEPTION 'B2B account access required';
  END IF;

  BEGIN
    v_account_id := (auth.jwt() -> 'user_metadata' ->> 'account_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid B2B account context';
  END;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Missing B2B account context';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (
    o.id,
    COALESCE(r.test_group_id::text, r.test_name, ''),
    LOWER(COALESCE(rv.analyte_name, ''))
  )
    o.id,
    o.sample_id::text,
    o.patient_name::text,
    o.order_date,
    COALESCE(tg.name, r.test_name, 'Results')::text,
    COALESCE(rv.analyte_name, 'Analyte')::text,
    rv.value::text,
    rv.unit::text,
    rv.reference_range::text,
    rv.flag::text
  FROM public.orders o
  JOIN public.results r ON r.order_id = o.id
  JOIN public.result_values rv ON rv.result_id = r.id
  LEFT JOIN public.test_groups tg ON tg.id = r.test_group_id
  WHERE o.account_id = v_account_id
    AND (p_order_ids IS NULL OR o.id = ANY(p_order_ids))
    AND COALESCE(rv.is_hidden_from_report, false) = false
    AND NULLIF(BTRIM(COALESCE(rv.value::text, '')), '') IS NOT NULL
    AND LOWER(COALESCE(r.status::text, '')) NOT IN ('rejected', 'cancelled')
  ORDER BY
    o.id,
    COALESCE(r.test_group_id::text, r.test_name, ''),
    LOWER(COALESCE(rv.analyte_name, '')),
    r.verified_at DESC NULLS LAST,
    r.created_at DESC NULLS LAST,
    rv.id DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_b2b_result_analysis(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_b2b_result_analysis(uuid[]) TO authenticated;
