-- Peerless HA560: deterministic inbound result-code mappings
-- Lab 0e48c67f-b745-4358-b7fa-54c208e88d22, connection e2222d31-ac65-42c2-ab8c-77b32e6d3a11.
-- The HA560 reports differential codes (NEU%, LYM#, RDWCV, WBC, ...) that differ from
-- the lab's outbound order codes (NEUT_PCT, LYMPH_ABS, RDW-CV, TLC, ...), so inbound
-- result matching fell back to AI on every message. These rows make it deterministic.
WITH ha560(analyzer_code, lims_code, lab_analyte_id) AS (
  VALUES
    ('WBC',   'TLC',       '600cd77e-764e-40de-934f-9f99dcd7843b'::uuid),
    ('NEU%',  'NEUT_PCT',  '2e9a8425-eab0-4d73-9044-835f1e0d7c98'::uuid),
    ('LYM%',  'LYMPH_PCT', '9160c58e-1580-4cbe-b71c-efb6d81320a7'::uuid),
    ('MON%',  'MONO_PCT',  'e7f23a0c-ff7e-4d37-be34-a9fdf130c256'::uuid),
    ('EOS%',  'EOS_PCT',   '811a4dbe-609d-4d0d-9309-5369d29ff0b4'::uuid),
    ('BAS%',  'BASO_PCT',  '8ed6b4a0-5818-46fa-9e6b-b45722c56c80'::uuid),
    ('NEU#',  'NEUT_ABS',  '04dc6fe6-99dc-4e63-9690-5ad95585cab4'::uuid),
    ('LYM#',  'LYMPH_ABS', '70ad44dd-a1a0-4d5c-b5af-981d2b3c59a0'::uuid),
    ('MON#',  'MONO_ABS',  'a7e6fe27-d570-4b96-853c-c3c737f73b56'::uuid),
    ('EOS#',  'EOS_ABS',   'c9f44dca-98df-4ae0-9ec9-ecba60e36c5b'::uuid),
    ('BAS#',  'BASO_ABS',  '1a366c4b-52e9-4708-a2e7-46a47eeda31c'::uuid),
    ('RBC',   'RBC',       'c3c66a27-1a6c-40e2-a60b-521518a21aaa'::uuid),
    ('HGB',   'HGB',       'c9fe1d38-c0f6-427d-936c-7d4b8c19f3da'::uuid),
    ('HCT',   'HCT',       'b378ae3b-6503-4946-854b-bbfb527e603d'::uuid),
    ('MCV',   'MCV',       'bde3e56c-5e7f-4138-815e-f79d2ec418bd'::uuid),
    ('MCH',   'MCH',       '48fdd34d-fff5-4968-8ed3-1a1d4bcf5c41'::uuid),
    ('MCHC',  'MCHC',      '83f64289-645c-41d5-be85-a6e3ec09ba1b'::uuid),
    ('RDWCV', 'RDW_CV',    'c1165486-588f-4bda-90a6-8e4fb256a2e0'::uuid),
    ('PLT',   'PLT',       '46842d91-056f-4a0d-8b05-e9f765bed39b'::uuid)
)
INSERT INTO public.test_mappings (
  lab_id, analyzer_connection_id, lims_code, analyzer_code, test_name,
  analyte_id, lab_analyte_id, mapping_type, direction,
  supports_order_send, supports_result_receive,
  ai_confidence, ai_source, verified, metadata
)
SELECT
  '0e48c67f-b745-4358-b7fa-54c208e88d22'::uuid,
  'e2222d31-ac65-42c2-ab8c-77b32e6d3a11'::uuid,
  h.lims_code,
  h.analyzer_code,
  h.lims_code,
  la.analyte_id,
  h.lab_analyte_id,
  'result_analyte',
  'inbound',
  false,
  true,
  1.0,
  'manual',
  true,
  jsonb_build_object('analyzer_brand', 'Peerless HA560', 'source', 'manual_integration_fix')
FROM ha560 h
JOIN public.lab_analytes la ON la.id = h.lab_analyte_id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.test_mappings t
  WHERE t.lab_id = '0e48c67f-b745-4358-b7fa-54c208e88d22'::uuid
    AND t.mapping_type = 'result_analyte'
    AND t.analyzer_code = h.analyzer_code
    AND t.lab_analyte_id = h.lab_analyte_id
);
