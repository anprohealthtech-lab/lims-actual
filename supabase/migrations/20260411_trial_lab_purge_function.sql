-- ============================================================
-- Trial Lab Data Purge Function
-- ============================================================
-- Deletes ALL data for a given lab_id from every table,
-- preserving only the labs row itself.
--
-- Call after the 5-day trial expires:
--   SELECT public.delete_trial_lab_data('<lab-uuid>');
--
-- For a dry run (row counts only, no deletes):
--   SELECT public.delete_trial_lab_data('<lab-uuid>', dry_run => true);
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_trial_lab_data(
  p_lab_id UUID,
  dry_run   BOOLEAN DEFAULT false
)
RETURNS TABLE (step TEXT, rows_affected BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_ids   UUID[];
  v_patient_ids UUID[];
  v_result_ids  UUID[];
  v_invoice_ids UUID[];
  v_session_ids UUID[];
  v_sample_ids  TEXT[];
  v_tg_ids      UUID[];
  v_account_ids UUID[];
  v_n           BIGINT;
BEGIN

  -- Guard: lab must exist
  IF NOT EXISTS (SELECT 1 FROM public.labs WHERE id = p_lab_id) THEN
    RAISE EXCEPTION 'Lab % not found', p_lab_id;
  END IF;

  -- ── Pre-collect ID arrays to avoid repeated subqueries ───────────────────
  SELECT ARRAY_AGG(id) INTO v_order_ids   FROM public.orders   WHERE lab_id = p_lab_id;
  SELECT ARRAY_AGG(id) INTO v_patient_ids FROM public.patients WHERE lab_id = p_lab_id;
  SELECT ARRAY_AGG(id) INTO v_result_ids  FROM public.results  WHERE lab_id = p_lab_id;
  SELECT ARRAY_AGG(id) INTO v_invoice_ids FROM public.invoices WHERE lab_id = p_lab_id;
  SELECT ARRAY_AGG(id) INTO v_session_ids
    FROM public.ai_protocol_sessions
   WHERE order_id = ANY(v_order_ids);
  SELECT ARRAY_AGG(id) INTO v_sample_ids  FROM public.samples  WHERE lab_id = p_lab_id;
  SELECT ARRAY_AGG(id) INTO v_tg_ids      FROM public.test_groups WHERE lab_id = p_lab_id;
  SELECT ARRAY_AGG(id) INTO v_account_ids FROM public.accounts WHERE lab_id = p_lab_id;

  -- ── PHASE 1: Break self-referential FK cycles ─────────────────────────────
  -- orders.parent_order_id → orders
  -- patients.master_patient_id → patients
  -- invoices.parent_invoice_id, consolidated_invoice_id → invoices

  IF NOT dry_run THEN
    UPDATE public.orders   SET parent_order_id        = NULL WHERE lab_id = p_lab_id;
    UPDATE public.patients SET master_patient_id       = NULL WHERE lab_id = p_lab_id;
    UPDATE public.invoices SET parent_invoice_id       = NULL WHERE lab_id = p_lab_id;
    UPDATE public.invoices SET consolidated_invoice_id = NULL WHERE lab_id = p_lab_id;
  END IF;
  step := 'Phase 1 – Break self-referential cycles'; rows_affected := 0; RETURN NEXT;

  -- ── PHASE 2: Deepest children of results ─────────────────────────────────

  -- 2a. ai_captures → ai_protocol_sessions
  SELECT COUNT(*) INTO v_n FROM public.ai_captures WHERE session_id = ANY(v_session_ids);
  IF NOT dry_run THEN DELETE FROM public.ai_captures WHERE session_id = ANY(v_session_ids); END IF;
  step := 'ai_captures'; rows_affected := v_n; RETURN NEXT;

  -- 2b. ai_flag_audits (has lab_id; also references result_values, results, orders)
  SELECT COUNT(*) INTO v_n FROM public.ai_flag_audits WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.ai_flag_audits WHERE lab_id = p_lab_id; END IF;
  step := 'ai_flag_audits'; rows_affected := v_n; RETURN NEXT;

  -- 2c. result_verification_audit → results
  SELECT COUNT(*) INTO v_n FROM public.result_verification_audit WHERE result_id = ANY(v_result_ids);
  IF NOT dry_run THEN DELETE FROM public.result_verification_audit WHERE result_id = ANY(v_result_ids); END IF;
  step := 'result_verification_audit'; rows_affected := v_n; RETURN NEXT;

  -- 2d. result_verification_notes → results
  SELECT COUNT(*) INTO v_n FROM public.result_verification_notes WHERE result_id = ANY(v_result_ids);
  IF NOT dry_run THEN DELETE FROM public.result_verification_notes WHERE result_id = ANY(v_result_ids); END IF;
  step := 'result_verification_notes'; rows_affected := v_n; RETURN NEXT;

  -- 2e. result_section_content → results
  SELECT COUNT(*) INTO v_n FROM public.result_section_content WHERE result_id = ANY(v_result_ids);
  IF NOT dry_run THEN DELETE FROM public.result_section_content WHERE result_id = ANY(v_result_ids); END IF;
  step := 'result_section_content'; rows_affected := v_n; RETURN NEXT;

  -- ── PHASE 3: result_values ────────────────────────────────────────────────
  -- FK: result_id → results, order_id → orders, order_test_id → order_tests,
  --     test_group_id → test_groups, order_test_group_id → order_test_groups,
  --     lab_analyte_id → lab_analytes
  SELECT COUNT(*) INTO v_n FROM public.result_values WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.result_values WHERE lab_id = p_lab_id; END IF;
  step := 'result_values'; rows_affected := v_n; RETURN NEXT;

  -- ── PHASE 4: results ──────────────────────────────────────────────────────
  -- FK: order_id → orders, patient_id → patients, order_test_id → order_tests,
  --     order_test_group_id → order_test_groups, test_group_id → test_groups,
  --     workflow_instance_id → order_workflow_instances
  SELECT COUNT(*) INTO v_n FROM public.results WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.results WHERE lab_id = p_lab_id; END IF;
  step := 'results'; rows_affected := v_n; RETURN NEXT;

  -- ── PHASE 5: reports ──────────────────────────────────────────────────────
  -- FK: result_id → results (must come after results deleted),
  --     order_id → orders, patient_id → patients
  -- NOTE: pdf_url / print_pdf_url are storage paths — delete storage objects
  --       separately via the Supabase Storage API before running this script.
  SELECT COUNT(*) INTO v_n FROM public.reports WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.reports WHERE lab_id = p_lab_id; END IF;
  step := 'reports (PDF URLs must be cleaned from storage separately)'; rows_affected := v_n; RETURN NEXT;

  -- ── PHASE 6: AI protocol sessions ─────────────────────────────────────────
  SELECT COUNT(*) INTO v_n FROM public.ai_protocol_sessions WHERE order_id = ANY(v_order_ids);
  IF NOT dry_run THEN DELETE FROM public.ai_protocol_sessions WHERE order_id = ANY(v_order_ids); END IF;
  step := 'ai_protocol_sessions'; rows_affected := v_n; RETURN NEXT;

  -- ── PHASE 7: Order-adjacent tables ───────────────────────────────────────

  -- pdf_generation_queue → orders (UNIQUE order_id)
  SELECT COUNT(*) INTO v_n FROM public.pdf_generation_queue WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.pdf_generation_queue WHERE lab_id = p_lab_id; END IF;
  step := 'pdf_generation_queue'; rows_affected := v_n; RETURN NEXT;

  -- outsourced_reports → orders, patients
  SELECT COUNT(*) INTO v_n FROM public.outsourced_reports WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.outsourced_reports WHERE lab_id = p_lab_id; END IF;
  step := 'outsourced_reports'; rows_affected := v_n; RETURN NEXT;

  -- patient_activity_log → orders, patients
  SELECT COUNT(*) INTO v_n FROM public.patient_activity_log WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.patient_activity_log WHERE lab_id = p_lab_id; END IF;
  step := 'patient_activity_log'; rows_affected := v_n; RETURN NEXT;

  -- patient_report_access_logs → patients, orders (no lab_id column)
  SELECT COUNT(*) INTO v_n FROM public.patient_report_access_logs WHERE patient_id = ANY(v_patient_ids);
  IF NOT dry_run THEN DELETE FROM public.patient_report_access_logs WHERE patient_id = ANY(v_patient_ids); END IF;
  step := 'patient_report_access_logs'; rows_affected := v_n; RETURN NEXT;

  -- order_workflow_instances → orders
  SELECT COUNT(*) INTO v_n FROM public.order_workflow_instances WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.order_workflow_instances WHERE lab_id = p_lab_id; END IF;
  step := 'order_workflow_instances'; rows_affected := v_n; RETURN NEXT;

  -- sample_events → samples (must come before samples)
  SELECT COUNT(*) INTO v_n FROM public.sample_events WHERE sample_id = ANY(v_sample_ids);
  IF NOT dry_run THEN DELETE FROM public.sample_events WHERE sample_id = ANY(v_sample_ids); END IF;
  step := 'sample_events'; rows_affected := v_n; RETURN NEXT;

  -- ── PHASE 8: Invoice data ─────────────────────────────────────────────────
  -- Delete in order: invoice_items → payments → order_billing_items →
  --                  order_tests → order_test_groups → invoices

  -- invoice_items → invoices, order_tests, orders
  SELECT COUNT(*) INTO v_n FROM public.invoice_items WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.invoice_items WHERE lab_id = p_lab_id; END IF;
  step := 'invoice_items'; rows_affected := v_n; RETURN NEXT;

  -- payments → invoices (lab_id column exists)
  SELECT COUNT(*) INTO v_n FROM public.payments WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.payments WHERE lab_id = p_lab_id; END IF;
  step := 'payments'; rows_affected := v_n; RETURN NEXT;

  -- order_billing_items → orders (invoice_items already gone)
  SELECT COUNT(*) INTO v_n FROM public.order_billing_items WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.order_billing_items WHERE lab_id = p_lab_id; END IF;
  step := 'order_billing_items'; rows_affected := v_n; RETURN NEXT;

  -- order_tests → invoices, orders (invoice_items gone so can delete)
  SELECT COUNT(*) INTO v_n FROM public.order_tests WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.order_tests WHERE lab_id = p_lab_id; END IF;
  step := 'order_tests'; rows_affected := v_n; RETURN NEXT;

  -- order_test_groups → orders, samples (no lab_id; use order_id)
  SELECT COUNT(*) INTO v_n FROM public.order_test_groups WHERE order_id = ANY(v_order_ids);
  IF NOT dry_run THEN DELETE FROM public.order_test_groups WHERE order_id = ANY(v_order_ids); END IF;
  step := 'order_test_groups'; rows_affected := v_n; RETURN NEXT;

  -- invoices → orders, patients (order_tests + invoice_items already gone)
  SELECT COUNT(*) INTO v_n FROM public.invoices WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.invoices WHERE lab_id = p_lab_id; END IF;
  step := 'invoices'; rows_affected := v_n; RETURN NEXT;

  -- ── PHASE 9: Samples (after order_test_groups which FK to samples) ─────────
  SELECT COUNT(*) INTO v_n FROM public.samples WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.samples WHERE lab_id = p_lab_id; END IF;
  step := 'samples'; rows_affected := v_n; RETURN NEXT;

  -- ── PHASE 10: Orders ──────────────────────────────────────────────────────
  -- All child tables are cleared; parent_order_id self-ref already nulled.
  SELECT COUNT(*) INTO v_n FROM public.orders WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.orders WHERE lab_id = p_lab_id; END IF;
  step := 'orders'; rows_affected := v_n; RETURN NEXT;

  -- ── PHASE 11: Patients ────────────────────────────────────────────────────
  -- patient_loyalty_points → patients
  SELECT COUNT(*) INTO v_n FROM public.patient_loyalty_points WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.patient_loyalty_points WHERE lab_id = p_lab_id; END IF;
  step := 'patient_loyalty_points'; rows_affected := v_n; RETURN NEXT;

  -- patients (master_patient_id self-ref already nulled)
  SELECT COUNT(*) INTO v_n FROM public.patients WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.patients WHERE lab_id = p_lab_id; END IF;
  step := 'patients'; rows_affected := v_n; RETURN NEXT;

  -- ── PHASE 12: Test & analyte configuration ────────────────────────────────

  -- test_group_analytes → test_groups, lab_analytes
  SELECT COUNT(*) INTO v_n FROM public.test_group_analytes WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.test_group_analytes WHERE lab_id = p_lab_id; END IF;
  step := 'test_group_analytes'; rows_affected := v_n; RETURN NEXT;

  -- lab_analyte_interface_config → lab_analytes
  SELECT COUNT(*) INTO v_n FROM public.lab_analyte_interface_config WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.lab_analyte_interface_config WHERE lab_id = p_lab_id; END IF;
  step := 'lab_analyte_interface_config'; rows_affected := v_n; RETURN NEXT;

  -- lab_analytes (result_values + test_group_analytes + laic already gone)
  SELECT COUNT(*) INTO v_n FROM public.lab_analytes WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.lab_analytes WHERE lab_id = p_lab_id; END IF;
  step := 'lab_analytes'; rows_affected := v_n; RETURN NEXT;

  -- test_mappings → test_groups
  SELECT COUNT(*) INTO v_n FROM public.test_mappings WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.test_mappings WHERE lab_id = p_lab_id; END IF;
  step := 'test_mappings'; rows_affected := v_n; RETURN NEXT;

  -- test_workflow_map → test_groups
  SELECT COUNT(*) INTO v_n FROM public.test_workflow_map WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.test_workflow_map WHERE lab_id = p_lab_id; END IF;
  step := 'test_workflow_map'; rows_affected := v_n; RETURN NEXT;

  -- ai_prompts → test_groups, lab_analytes
  SELECT COUNT(*) INTO v_n FROM public.ai_prompts WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.ai_prompts WHERE lab_id = p_lab_id; END IF;
  step := 'ai_prompts'; rows_affected := v_n; RETURN NEXT;

  -- account_prices → test_groups (filter via accounts.lab_id)
  SELECT COUNT(*) INTO v_n FROM public.account_prices WHERE account_id = ANY(v_account_ids);
  IF NOT dry_run THEN DELETE FROM public.account_prices WHERE account_id = ANY(v_account_ids); END IF;
  step := 'account_prices'; rows_affected := v_n; RETURN NEXT;

  -- outsourced_lab_prices → test_groups
  SELECT COUNT(*) INTO v_n FROM public.outsourced_lab_prices WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.outsourced_lab_prices WHERE lab_id = p_lab_id; END IF;
  step := 'outsourced_lab_prices'; rows_affected := v_n; RETURN NEXT;

  -- package_test_groups → test_groups, packages (no lab_id; filter via test_group_id)
  SELECT COUNT(*) INTO v_n FROM public.package_test_groups WHERE test_group_id = ANY(v_tg_ids);
  IF NOT dry_run THEN DELETE FROM public.package_test_groups WHERE test_group_id = ANY(v_tg_ids); END IF;
  step := 'package_test_groups'; rows_affected := v_n; RETURN NEXT;

  -- test_groups (all dependents cleared above)
  SELECT COUNT(*) INTO v_n FROM public.test_groups WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.test_groups WHERE lab_id = p_lab_id; END IF;
  step := 'test_groups'; rows_affected := v_n; RETURN NEXT;

  -- ── PHASE 13: Remaining lab-scoped tables ────────────────────────────────

  -- packages (after package_test_groups)
  SELECT COUNT(*) INTO v_n FROM public.packages WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.packages WHERE lab_id = p_lab_id; END IF;
  step := 'packages'; rows_affected := v_n; RETURN NEXT;

  -- account_package_prices → accounts, packages
  SELECT COUNT(*) INTO v_n FROM public.account_package_prices WHERE account_id = ANY(v_account_ids);
  IF NOT dry_run THEN DELETE FROM public.account_package_prices WHERE account_id = ANY(v_account_ids); END IF;
  step := 'account_package_prices'; rows_affected := v_n; RETURN NEXT;

  -- accounts (account_prices + account_package_prices already gone)
  SELECT COUNT(*) INTO v_n FROM public.accounts WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.accounts WHERE lab_id = p_lab_id; END IF;
  step := 'accounts'; rows_affected := v_n; RETURN NEXT;

  -- outsourced_labs (orders + order_tests + results + outsourced_lab_prices already gone)
  SELECT COUNT(*) INTO v_n FROM public.outsourced_labs WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.outsourced_labs WHERE lab_id = p_lab_id; END IF;
  step := 'outsourced_labs'; rows_affected := v_n; RETURN NEXT;

  -- pending_orders
  SELECT COUNT(*) INTO v_n FROM public.pending_orders WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.pending_orders WHERE lab_id = p_lab_id; END IF;
  step := 'pending_orders'; rows_affected := v_n; RETURN NEXT;

  -- ai_mapping_cache
  SELECT COUNT(*) INTO v_n FROM public.ai_mapping_cache WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.ai_mapping_cache WHERE lab_id = p_lab_id; END IF;
  step := 'ai_mapping_cache'; rows_affected := v_n; RETURN NEXT;

  -- lab_billing_item_types (order_billing_items already gone)
  SELECT COUNT(*) INTO v_n FROM public.lab_billing_item_types WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.lab_billing_item_types WHERE lab_id = p_lab_id; END IF;
  step := 'lab_billing_item_types'; rows_affected := v_n; RETURN NEXT;

  -- lab_branding_assets
  SELECT COUNT(*) INTO v_n FROM public.lab_branding_assets WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.lab_branding_assets WHERE lab_id = p_lab_id; END IF;
  step := 'lab_branding_assets'; rows_affected := v_n; RETURN NEXT;

  -- lab_api_keys
  SELECT COUNT(*) INTO v_n FROM public.lab_api_keys WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.lab_api_keys WHERE lab_id = p_lab_id; END IF;
  step := 'lab_api_keys'; rows_affected := v_n; RETURN NEXT;

  -- stock_alerts → inventory_items
  SELECT COUNT(*) INTO v_n FROM public.stock_alerts WHERE lab_id = p_lab_id;
  IF NOT dry_run THEN DELETE FROM public.stock_alerts WHERE lab_id = p_lab_id; END IF;
  step := 'stock_alerts'; rows_affected := v_n; RETURN NEXT;

  -- ── Done ──────────────────────────────────────────────────────────────────
  step := '✓ Purge complete – labs row preserved';
  rows_affected := 0;
  IF dry_run THEN step := '(DRY RUN) ' || step; END IF;
  RETURN NEXT;

END;
$$;

COMMENT ON FUNCTION public.delete_trial_lab_data IS
  'Purges all data for a trial lab after the 5-day demo period.
   Preserves the labs row. Respects FK constraints via ordered deletes.
   Set dry_run => true to preview row counts without deleting.
   IMPORTANT: PDF/storage files must be removed separately via Supabase Storage API.';
