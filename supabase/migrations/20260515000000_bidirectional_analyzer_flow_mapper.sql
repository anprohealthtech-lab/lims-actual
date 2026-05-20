-- Bidirectional analyzer flow mapper.
-- Adds directional mapping metadata, global profile defaults, and worklist payload fields.

ALTER TABLE public.test_mappings
  ADD COLUMN IF NOT EXISTS mapping_type text NOT NULL DEFAULT 'result_analyte',
  ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'bidirectional',
  ADD COLUMN IF NOT EXISTS analyzer_code_system text,
  ADD COLUMN IF NOT EXISTS analyzer_display text,
  ADD COLUMN IF NOT EXISTS hl7_field text,
  ADD COLUMN IF NOT EXISTS value_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'test_mappings_mapping_type_check'
      AND conrelid = 'public.test_mappings'::regclass
  ) THEN
    ALTER TABLE public.test_mappings
      ADD CONSTRAINT test_mappings_mapping_type_check
      CHECK (mapping_type IN ('order_service', 'result_analyte', 'specimen_mode', 'histogram', 'flag', 'control'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'test_mappings_direction_check'
      AND conrelid = 'public.test_mappings'::regclass
  ) THEN
    ALTER TABLE public.test_mappings
      ADD CONSTRAINT test_mappings_direction_check
      CHECK (direction IN ('outbound', 'inbound', 'bidirectional'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_test_mappings_flow_lookup
  ON public.test_mappings(lab_id, analyzer_connection_id, mapping_type, direction, lims_code);

CREATE INDEX IF NOT EXISTS idx_test_mappings_profile_flow_lookup
  ON public.test_mappings(lab_id, analyzer_profile_id, mapping_type, direction, lims_code);

UPDATE public.test_mappings
SET
  mapping_type = 'order_service',
  direction = CASE WHEN COALESCE(supports_result_receive, false) THEN 'bidirectional' ELSE 'outbound' END
WHERE COALESCE(supports_order_send, false) = true
  AND analyte_id IS NULL
  AND mapping_type = 'result_analyte';

CREATE TABLE IF NOT EXISTS public.analyzer_profile_code_mappings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  analyzer_profile_id text NOT NULL REFERENCES public.analyzer_profiles(id) ON DELETE CASCADE,
  lims_code text NOT NULL,
  analyzer_code text NOT NULL,
  analyzer_display text,
  analyzer_code_system text,
  mapping_type text NOT NULL DEFAULT 'result_analyte'
    CHECK (mapping_type IN ('order_service', 'result_analyte', 'specimen_mode', 'histogram', 'flag', 'control')),
  direction text NOT NULL DEFAULT 'bidirectional'
    CHECK (direction IN ('outbound', 'inbound', 'bidirectional')),
  hl7_field text,
  value_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT analyzer_profile_code_mappings_pkey PRIMARY KEY (id),
  CONSTRAINT analyzer_profile_code_mappings_unique
    UNIQUE (analyzer_profile_id, mapping_type, direction, lims_code, analyzer_code)
);

CREATE INDEX IF NOT EXISTS idx_profile_code_mappings_lookup
  ON public.analyzer_profile_code_mappings(analyzer_profile_id, mapping_type, direction, lims_code)
  WHERE is_active = true;

ALTER TABLE public.analyzer_order_queue
  ADD COLUMN IF NOT EXISTS flow_type text NOT NULL DEFAULT 'lims_push',
  ADD COLUMN IF NOT EXISTS request_message_type text,
  ADD COLUMN IF NOT EXISTS response_message_type text,
  ADD COLUMN IF NOT EXISTS hl7_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS worklist_query jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS served_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS served_count integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'analyzer_order_queue_flow_type_check'
      AND conrelid = 'public.analyzer_order_queue'::regclass
  ) THEN
    ALTER TABLE public.analyzer_order_queue
      ADD CONSTRAINT analyzer_order_queue_flow_type_check
      CHECK (flow_type IN ('lims_push', 'analyzer_initiated'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_order_queue_worklist_lookup
  ON public.analyzer_order_queue(lab_id, analyzer_connection_id, sample_barcode, status, flow_type);

ALTER TABLE public.analyzer_profiles
  ADD COLUMN IF NOT EXISTS hl7_character_set text,
  ADD COLUMN IF NOT EXISTS byte_encoding text,
  ADD COLUMN IF NOT EXISTS repetition_delimiter text DEFAULT '~',
  ADD COLUMN IF NOT EXISTS escape_delimiter text DEFAULT E'\\',
  ADD COLUMN IF NOT EXISTS subcomponent_delimiter text DEFAULT '&';

UPDATE public.analyzer_profiles
SET
  protocol_version = '2.3.1',
  message_encoding = 'UTF-8',
  byte_encoding = COALESCE(byte_encoding, 'UTF-8'),
  hl7_character_set = 'UNICODE',
  test_code_format = 'Mindray order service CE: code^display^99MRC',
  connection_settings = COALESCE(connection_settings, '{}'::jsonb) || '{
    "default_port": 5000,
    "transport": "TCP",
    "framing": "MLLP",
    "mllp_start": "0x0B",
    "mllp_end": "0x1C0D",
    "character_set": "UNICODE",
    "hl7_version": "2.3.1",
    "worklist_flow": "analyzer_initiated",
    "diagnostic_service_id": "HM",
    "obr4_code": "00001^Automated Count^99MRC",
    "obr4_coding_system": "99MRC",
    "patient_id_suffix": "^^^^MR",
    "order_control_orm": "RF",
    "order_control_orr": "AF",
    "order_status_orm": "IP"
  }'::jsonb,
  ai_parsing_hints = COALESCE(ai_parsing_hints, '{}'::jsonb) || '{
    "category": "hematology",
    "barcode_field": "OBR-3",
    "patient_id_field": "PID-3",
    "result_format": "OBX_per_parameter",
    "worklist_response_type": "ORR^O02",
    "result_message_type": "ORU^R01"
  }'::jsonb,
  sample_messages = jsonb_build_array(
    'MSH|^~\&|LIMSV2|LAB|ANALYZER||20260514092226||ORR^O02|MSG001|P|2.3.1||||||UNICODE' || E'\r' ||
    'MSA|AA|ANLZ001' || E'\r' ||
    'PID|1||2605140007^^^^MR||Jasuja^Sanjay||19800101000000|M' || E'\r' ||
    'ORC|AF|2605140007' || E'\r' ||
    'OBR|1|2605140007|2605140007|00001^Automated Count^99MRC||20260514092226||||||||||20260514092226||||||||||HM' || E'\r' ||
    'OBX|1|IS|08002^Blood Mode^99MRC||W||||||F' || E'\r' ||
    'OBX|2|IS|08003^Test Mode^99MRC||CBC+DIFF||||||F' || E'\r'
  ),
  updated_at = now()
WHERE id = 'mindray-bc5150';

INSERT INTO public.analyzer_profile_code_mappings
  (analyzer_profile_id, lims_code, analyzer_code, analyzer_display, analyzer_code_system, mapping_type, direction, hl7_field, value_map, metadata)
VALUES
  ('mindray-bc5150', 'CBC', '00001', 'Automated Count', '99MRC', 'order_service', 'outbound', 'OBR-4',
   '{"blood_mode":"W","test_mode":"CBC+DIFF"}'::jsonb, '{"universal_service_id":"00001^Automated Count^99MRC"}'::jsonb),
  ('mindray-bc5150', 'CBCPF', '00001', 'Automated Count', '99MRC', 'order_service', 'outbound', 'OBR-4',
   '{"blood_mode":"W","test_mode":"CBC+DIFF"}'::jsonb, '{"universal_service_id":"00001^Automated Count^99MRC"}'::jsonb),
  ('mindray-bc5150', 'WBC', 'WBC', 'White Blood Cell', '99MRC', 'result_analyte', 'inbound', 'OBX-3', '{}'::jsonb, '{}'::jsonb),
  ('mindray-bc5150', 'RBC', 'RBC', 'Red Blood Cell', '99MRC', 'result_analyte', 'inbound', 'OBX-3', '{}'::jsonb, '{}'::jsonb),
  ('mindray-bc5150', 'HGB', 'HGB', 'Hemoglobin', '99MRC', 'result_analyte', 'inbound', 'OBX-3', '{}'::jsonb, '{}'::jsonb),
  ('mindray-bc5150', 'HCT', 'HCT', 'Hematocrit', '99MRC', 'result_analyte', 'inbound', 'OBX-3', '{}'::jsonb, '{}'::jsonb),
  ('mindray-bc5150', 'MCV', 'MCV', 'Mean Corpuscular Volume', '99MRC', 'result_analyte', 'inbound', 'OBX-3', '{}'::jsonb, '{}'::jsonb),
  ('mindray-bc5150', 'MCH', 'MCH', 'Mean Corpuscular Hemoglobin', '99MRC', 'result_analyte', 'inbound', 'OBX-3', '{}'::jsonb, '{}'::jsonb),
  ('mindray-bc5150', 'MCHC', 'MCHC', 'Mean Corpuscular Hemoglobin Concentration', '99MRC', 'result_analyte', 'inbound', 'OBX-3', '{}'::jsonb, '{}'::jsonb),
  ('mindray-bc5150', 'PLT', 'PLT', 'Platelet Count', '99MRC', 'result_analyte', 'inbound', 'OBX-3', '{}'::jsonb, '{}'::jsonb),
  ('mindray-bc5150', '08002', '08002', 'Blood Mode', '99MRC', 'specimen_mode', 'outbound', 'OBX-3',
   '{"default":"W"}'::jsonb, '{}'::jsonb),
  ('mindray-bc5150', '08003', '08003', 'Test Mode', '99MRC', 'control', 'outbound', 'OBX-3',
   '{"default":"CBC+DIFF"}'::jsonb, '{}'::jsonb)
ON CONFLICT (analyzer_profile_id, mapping_type, direction, lims_code, analyzer_code)
DO UPDATE SET
  analyzer_display = EXCLUDED.analyzer_display,
  analyzer_code_system = EXCLUDED.analyzer_code_system,
  hl7_field = EXCLUDED.hl7_field,
  value_map = EXCLUDED.value_map,
  metadata = EXCLUDED.metadata,
  is_active = true,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.save_ai_mapping(
    p_lab_id UUID,
    p_lims_code TEXT,
    p_analyzer_code TEXT,
    p_analyzer_id TEXT,
    p_confidence FLOAT,
    p_analyte_id UUID DEFAULT NULL,
    p_test_name TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO public.test_mappings (
        lab_id,
        lims_code,
        analyzer_code,
        analyzer_id,
        analyzer_profile_id,
        ai_confidence,
        ai_source,
        analyte_id,
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
        mapping_type = CASE WHEN p_analyte_id IS NULL THEN 'order_service' ELSE mapping_type END,
        direction = CASE WHEN p_analyte_id IS NULL THEN 'outbound' ELSE direction END
    WHERE lab_id = p_lab_id
      AND (analyzer_id = p_analyzer_id OR analyzer_profile_id = p_analyzer_id)
      AND lims_code = p_lims_code
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;
