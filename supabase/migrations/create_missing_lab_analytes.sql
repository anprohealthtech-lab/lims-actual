-- =====================================================
-- SIMPLE: Create missing lab_analytes from test_group_analytes
-- =====================================================

INSERT INTO lab_analytes (
  id,
  lab_id,
  analyte_id,
  is_active,
  visible,
  name,
  unit,
  reference_range,
  reference_range_male,
  reference_range_female,
  low_critical,
  high_critical,
  critical_low,
  critical_high,
  interpretation_low,
  interpretation_normal,
  interpretation_high,
  created_at,
  updated_at
)
SELECT 
  gen_random_uuid(),
  tg.lab_id,
  tga.analyte_id,
  a.is_active,
  true,
  a.name,
  a.unit,
  a.reference_range,
  a.reference_range_male,
  a.reference_range_female,
  NULL,  -- low_critical (skip non-numeric values)
  NULL,  -- high_critical (skip non-numeric values)
  NULL,  -- critical_low (skip non-numeric values)
  NULL,  -- critical_high (skip non-numeric values)
  a.interpretation_low,
  a.interpretation_normal,
  a.interpretation_high,
  NOW(),
  NOW()
FROM test_group_analytes tga
JOIN test_groups tg ON tg.id = tga.test_group_id
JOIN analytes a ON a.id = tga.analyte_id
LEFT JOIN lab_analytes la ON la.lab_id = tg.lab_id AND la.analyte_id = tga.analyte_id
WHERE tg.lab_id IS NOT NULL
  AND la.id IS NULL;

-- Show results
SELECT 
  COUNT(*) as total_created,
  'lab_analytes records created' as status
FROM lab_analytes;
