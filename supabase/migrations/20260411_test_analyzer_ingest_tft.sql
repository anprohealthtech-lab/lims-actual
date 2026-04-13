-- Test: Simulate HL7 ORU^R01 result from analyzer for order ab52404d-1aca-49a6-84b9-31536fa52a20
-- Sample barcode: 2604110017 (Dummy 3, TFT panel)
-- 
-- Flow triggered by this INSERT:
--   1. DB webhook fires → receive-analyzer-result edge function
--   2. AI parses ORU message → extracts TSH=2.5, FT3=4.2, FT4=14.8
--   3. Queries v_order_missing_analytes for order → gets analyte UUIDs + order_test_id
--   4. AI maps analyzer codes (TSH, FT3, FT4) → analyte UUIDs
--   5. Inserts into result_values with order_test_id populated (via order_tests path)

INSERT INTO analyzer_raw_messages (
  lab_id,
  direction,
  raw_content,
  analyzer_connection_id,
  sample_barcode,
  ai_status
) VALUES (
  'd4663e50-2474-4f6f-8e81-775f60634375',
  'INBOUND',
  'MSH|^~\&|ANALYZER|ANALYZER|LIMSV2|LAB|20260411070000||ORU^R01|ANALYZER001|P|2.5.1' || chr(13) ||
  'PID|1||2604110017||Dummy 3|||Male' || chr(13) ||
  'OBR|1|ab52404d-1aca-49a6-84b9-31536fa52a20||TFT^^LOCAL|R|20260411070000' || chr(13) ||
  'OBX|1|NM|TSH^Thyroid Stimulating Hormone||2.5|mIU/L|0.35-5.5||||F|||20260411070000' || chr(13) ||
  'OBX|2|NM|T3^Total T3 Triiodothyronine||1.8|nmol/L|1.2-2.8||||F|||20260411070000' || chr(13) ||
  'OBX|3|NM|T4^Total T4 Thyroxine||98.5|nmol/L|60-150||||F|||20260411070000',
  '5296baa5-fee7-4fc9-a754-ef45b494bc28',
  '2604110017',
  'pending'
);

-- After running, verify with:
-- SELECT parameter, value, unit, flag, order_test_id
-- FROM result_values
-- WHERE order_id = 'ab52404d-1aca-49a6-84b9-31536fa52a20';
