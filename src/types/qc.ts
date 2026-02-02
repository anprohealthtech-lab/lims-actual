/**
 * Quality Control Module Types
 * NABL/ISO 15189:2022 Compliant Type Definitions
 */

// ============================================
// Base Types from Existing Schema
// ============================================

export interface QCLot {
  id: string;
  lab_id: string;
  lot_number: string;
  material_name: string;
  manufacturer?: string;
  catalog_number?: string;
  lot_type: 'internal_control' | 'calibrator' | 'reagent' | 'external_control';
  level?: string; // L1, L2, L3, etc.
  received_date: string;
  expiry_date: string;
  opened_date?: string;
  stability_days_after_opening?: number;
  storage_temperature?: string;
  storage_location?: string;
  is_active: boolean;
  notes?: string;
  // Test group and analyzer linkage
  analyzer_name?: string;
  test_group_ids?: string[];
  created_at: string;
  updated_at: string;
  // Computed fields from views
  is_expired?: boolean;
  effective_expiry?: string;
  days_until_expiry?: number;
  test_group_names?: string[];
  test_group_count?: number;
}

export interface QCTargetValue {
  id: string;
  qc_lot_id: string;
  analyte_id: string;
  test_group_id?: string;
  target_mean: number;
  target_sd: number;
  target_cv_percent?: number;
  range_1sd_low?: number;
  range_1sd_high?: number;
  range_2sd_low?: number;
  range_2sd_high?: number;
  range_3sd_low?: number;
  range_3sd_high?: number;
  unit?: string;
  source: 'manufacturer' | 'calculated' | 'peer_group';
  created_at: string;
  updated_at: string;
  // Joined fields
  analyte_name?: string;
  lot_number?: string;
}

export interface QCRun {
  id: string;
  lab_id: string;
  run_date: string;
  run_time?: string;
  run_number?: number;
  analyzer_id?: string;
  analyzer_name?: string;
  operator_id?: string;
  operator_name?: string;
  run_type: 'routine' | 'calibration_verification' | 'new_lot' | 'maintenance' | 'troubleshooting';
  status: 'pending' | 'in_progress' | 'completed' | 'reviewed' | 'rejected';
  reviewed_by?: string;
  reviewed_at?: string;
  review_notes?: string;
  overall_pass?: boolean;
  westgard_violations?: string[];
  notes?: string;
  created_at: string;
  updated_at: string;
  // Joined fields
  results?: QCResult[];
  evidence?: QCEvidence[];
}

export interface QCResult {
  id: string;
  qc_run_id: string;
  lab_id: string;
  qc_lot_id: string;
  analyte_id: string;
  test_group_id?: string;
  observed_value: number;
  unit?: string;
  target_mean: number;
  target_sd: number;
  z_score?: number; // Computed: (observed - mean) / sd
  deviation_percent?: number; // Computed: ((observed - mean) / mean) * 100
  pass_fail: 'pass' | 'fail' | 'warning' | 'pending';
  westgard_flags?: string[];
  override_pass_fail?: 'pass' | 'fail' | 'warning';
  override_reason?: string;
  override_by?: string;
  override_at?: string;
  created_at: string;
  // Joined fields
  analyte_name?: string;
  lot_number?: string;
  level?: string;
}

export type WestgardRuleCode = '1_2s' | '1_3s' | '2_2s' | 'R_4s' | '4_1s' | '10x';

export interface WestgardRule {
  id: string;
  lab_id: string;
  rule_code: WestgardRuleCode;
  rule_name: string;
  description: string;
  is_warning: boolean;
  is_rejection: boolean;
  is_enabled: boolean;
  priority: number;
  parameters?: Record<string, any>;
  created_at: string;
}

// ============================================
// AI-Enhanced Types (New Tables)
// ============================================

export interface QCEvidence {
  id: string;
  qc_run_id: string;
  qc_result_id?: string;
  lab_id: string;
  source_type: 'camera' | 'pdf_upload' | 'analyzer_screenshot' | 'manual';
  file_url?: string;
  file_path?: string;
  original_filename?: string;
  file_type?: string;
  file_size?: number;
  ocr_json?: any;
  extraction_confidence?: number;
  extracted_values?: ExtractedQCValues;
  matched_lot_id?: string;
  matched_analyte_ids?: string[];
  matching_suggestions?: Record<string, MatchingSuggestion[]>;
  correction_json?: CorrectionEntry[];
  corrected_by?: string;
  corrected_at?: string;
  correction_reason?: string;
  ai_model_used?: string;
  ai_processing_time_ms?: number;
  ai_prompt_used?: string;
  ai_raw_response?: any;
  created_at: string;
  created_by?: string;
}

export interface ExtractedQCValues {
  analyzer_name?: string;
  lot_number?: string;
  level?: string;
  run_date?: string;
  run_time?: string;
  results: ExtractedResult[];
}

export interface ExtractedResult {
  analyte_name: string;
  observed_value: number;
  unit?: string;
  matched_analyte_id?: string;
  matched_lot_id?: string;
  target_mean?: number;
  target_sd?: number;
  confidence: number;
  raw_text?: string;
}

export interface MatchingSuggestion {
  id: string;
  name: string;
  confidence: number;
}

export interface CorrectionEntry {
  field: string;
  original_value: any;
  corrected_value: any;
  corrected_at: string;
}

export interface QCInvestigation {
  id: string;
  lab_id: string;
  qc_run_id?: string;
  investigation_number?: string;
  title: string;
  description?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  impacted_test_group_ids?: string[];
  impacted_analyte_ids?: string[];
  impacted_order_ids?: string[];
  westgard_violations?: string[];
  violation_details?: Record<string, ViolationDetail>;
  // AI-generated content
  ai_summary?: string;
  ai_likely_causes?: LikelyCause[];
  ai_recommendations?: AIRecommendation[];
  ai_impact_assessment?: ImpactAssessment;
  ai_context_used?: any;
  ai_model_used?: string;
  ai_generated_at?: string;
  // Human-reviewed final content
  final_problem_statement?: string;
  final_root_cause?: string;
  final_immediate_correction?: string;
  final_corrective_action?: string;
  final_preventive_action?: string;
  verification_plan?: string;
  verification_evidence?: VerificationEvidence[];
  effectiveness_check?: string;
  // Status
  status: 'open' | 'investigating' | 'pending_review' | 'closed' | 'cancelled';
  // Result hold
  hold_patient_results?: boolean;
  hold_reason?: string;
  hold_scope?: 'all_pending' | 'specific_tests' | 'time_range';
  hold_applied_by?: string;
  hold_applied_at?: string;
  hold_released_by?: string;
  hold_released_at?: string;
  release_justification?: string;
  // Assignment
  assigned_to?: string;
  assigned_by?: string;
  assigned_at?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  reviewer_notes?: string;
  closed_by?: string;
  closed_at?: string;
  closure_summary?: string;
  due_date?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
  // Joined fields
  assigned_to_name?: string;
  run_date?: string;
  analyzer_name?: string;
  is_overdue?: boolean;
  tasks?: QCTask[];
}

export interface ViolationDetail {
  rule: WestgardRuleCode;
  z_score: number;
  action_required: string;
}

export interface LikelyCause {
  cause: string;
  probability: 'high' | 'medium' | 'low';
  evidence: string[];
}

export interface AIRecommendation {
  action: string;
  priority: 'immediate' | 'soon' | 'scheduled';
  rationale: string;
  task_type?: string;
}

export interface ImpactAssessment {
  affected_tests: string[];
  orders_to_hold: string[];
  recommendation: 'hold_results' | 'proceed_with_caution' | 'safe_to_release';
}

export interface VerificationEvidence {
  type: string;
  description: string;
  date: string;
  file_url?: string;
}

export interface QCTask {
  id: string;
  lab_id: string;
  qc_run_id?: string;
  qc_investigation_id?: string;
  qc_lot_id?: string;
  calibration_id?: string;
  task_type: QCTaskType;
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  source: 'manual' | 'ai_recommendation' | 'westgard_rule' | 'drift_alert' | 'system';
  ai_recommendation_json?: AIRecommendation;
  assigned_to?: string;
  assigned_by?: string;
  assigned_at?: string;
  due_date?: string;
  reminder_date?: string;
  escalation_date?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'overdue' | 'escalated';
  started_at?: string;
  completed_by?: string;
  completed_at?: string;
  completion_notes?: string;
  completion_evidence?: VerificationEvidence[];
  requires_verification?: boolean;
  verified_by?: string;
  verified_at?: string;
  verification_notes?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
  // Joined fields
  assigned_to_name?: string;
  investigation_number?: string;
  run_date?: string;
  is_overdue?: boolean;
}

export type QCTaskType =
  | 'repeat_qc'
  | 'recalibrate'
  | 'change_reagent'
  | 'change_lot'
  | 'service_call'
  | 'review_capa'
  | 'verify_results'
  | 'manual_check'
  | 'lot_verification'
  | 'maintenance'
  | 'documentation'
  | 'training'
  | 'other';

export interface QCDriftAlert {
  id: string;
  lab_id: string;
  analyzer_id?: string;
  analyzer_name?: string;
  qc_lot_id?: string;
  analyte_id?: string;
  test_group_id?: string;
  alert_code?: string;
  alert_type: DriftAlertType;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  analysis_period_start?: string;
  analysis_period_end?: string;
  data_points_analyzed?: number;
  trend_data?: TrendData;
  statistical_summary?: StatisticalSummary;
  risk_score?: number;
  risk_factors?: RiskFactor[];
  ai_analysis?: string;
  ai_recommendations?: string[];
  ai_predicted_impact?: PredictedImpact;
  ai_model_used?: string;
  ai_generated_at?: string;
  status: 'active' | 'acknowledged' | 'investigating' | 'resolved' | 'dismissed' | 'false_positive';
  acknowledged_by?: string;
  acknowledged_at?: string;
  acknowledgment_notes?: string;
  resolution_action?: string;
  resolved_by?: string;
  resolved_at?: string;
  resolution_notes?: string;
  investigation_id?: string;
  created_at: string;
  expires_at?: string;
  // Joined fields
  analyte_name?: string;
  lot_number?: string;
}

export type DriftAlertType =
  | 'slow_drift'
  | 'sudden_shift'
  | 'lot_change'
  | 'analyzer_variation'
  | 'operator_effect'
  | 'cusum_alert'
  | 'ewma_alert'
  | 'trend_warning'
  | 'calibration_drift'
  | 'reagent_degradation';

export interface TrendData {
  dates: string[];
  z_scores: number[];
  values: number[];
  target_mean: number;
  target_sd: number;
}

export interface StatisticalSummary {
  mean_bias: number;
  cusum_value?: number;
  ewma_value?: number;
  trend_slope: number;
  r_squared?: number;
  n_points: number;
}

export interface RiskFactor {
  factor: string;
  weight: number;
  contribution: number;
}

export interface PredictedImpact {
  days_until_failure: number;
  confidence: number;
}

// ============================================
// EQC Types (External Quality Control)
// ============================================

export interface EQCProgram {
  id: string;
  lab_id: string;
  program_name: string;
  provider: string;
  enrollment_id?: string;
  cycle_info?: string;
  test_groups?: string[];
  analyte_ids?: string[];
  is_active: boolean;
  start_date?: string;
  end_date?: string;
  notes?: string;
  created_at: string;
}

export interface EQCResult {
  id: string;
  eqc_program_id: string;
  lab_id: string;
  survey_name: string;
  sample_id: string;
  analyte_id: string;
  submitted_value: number;
  submitted_at?: string;
  peer_mean?: number;
  peer_sd?: number;
  peer_cv?: number;
  z_score?: number;
  bias_percent?: number;
  grade?: string;
  acceptable: boolean;
  review_status: 'pending' | 'reviewed' | 'corrective_action_required';
  reviewed_by?: string;
  reviewed_at?: string;
  corrective_action?: string;
  notes?: string;
  created_at: string;
  // Joined fields
  program_name?: string;
  analyte_name?: string;
}

// ============================================
// Calibration Types
// ============================================

export interface CalibrationRecord {
  id: string;
  lab_id: string;
  analyzer_id?: string;
  analyzer_name: string;
  analyte_id?: string;
  test_group_id?: string;
  calibration_type: 'blank' | 'one_point' | 'two_point' | 'multi_point' | 'full';
  calibrator_lot_id?: string;
  calibration_date: string;
  performed_by?: string;
  verified_by?: string;
  verified_at?: string;
  slope?: number;
  intercept?: number;
  r_squared?: number;
  status: 'pending' | 'passed' | 'failed' | 'expired';
  next_calibration_due?: string;
  notes?: string;
  created_at: string;
  // Joined fields
  analyte_name?: string;
  lot_number?: string;
}

// ============================================
// API Request/Response Types
// ============================================

// QC Scan Intake
export interface QCScanIntakeRequest {
  attachmentId?: string;
  base64Image?: string;
  documentType: 'analyzer_screen' | 'thermal_printout' | 'pdf_report';
  labId: string;
  analyzerId?: string;
  analyzerName?: string;
  runDate?: string;
  lotNumber?: string;
}

export interface QCScanIntakeResponse {
  success: boolean;
  qc_run_id?: string;
  evidence_id?: string;
  extracted_data: ExtractedQCValues;
  extraction_confidence: number;
  matching_results: {
    lot_matched: boolean;
    lot_id?: string;
    lot_suggestions?: MatchingSuggestion[];
    analyte_matches: Record<string, { matched: boolean; id?: string; suggestions?: MatchingSuggestion[] }>;
  };
  warnings?: string[];
  created_results?: QCResult[];
}

// QC AI Explain Run
export interface QCExplainRunRequest {
  qc_run_id: string;
  include_historical?: boolean;
  include_calibration?: boolean;
}

export interface QCExplainRunResponse {
  success: boolean;
  summary: string;
  likely_causes: LikelyCause[];
  recommended_actions: AIRecommendation[];
  impact_assessment: ImpactAssessment;
  context_used: {
    qc_results_count: number;
    historical_runs_analyzed: number;
    calibration_records_checked: number;
  };
}

// QC AI Draft CAPA
export interface QCDraftCAPARequest {
  qc_run_id?: string;
  qc_investigation_id?: string;
  include_templates?: boolean;
}

export interface QCDraftCAPAResponse {
  success: boolean;
  capa_draft: {
    problem_statement: string;
    immediate_correction: string;
    root_cause_hypotheses: Array<{
      cause: string;
      likelihood: 'probable' | 'possible' | 'unlikely';
      investigation_needed: string[];
    }>;
    corrective_actions: Array<{
      action: string;
      responsible_role: string;
      timeline: string;
    }>;
    preventive_actions: Array<{
      action: string;
      responsible_role: string;
      timeline: string;
    }>;
    verification_plan: string;
  };
  ai_context: {
    model_used: string;
    records_analyzed: number;
    confidence: number;
  };
}

// QC AI Drift Alerts
export interface QCDriftAlertRequest {
  lab_id: string;
  analyzer_name?: string;
  analyte_ids?: string[];
  lookback_days?: number;
}

export interface QCDriftAlertResponse {
  success: boolean;
  alerts: QCDriftAlert[];
  summary: {
    total_analytes_checked: number;
    alerts_generated: number;
    high_risk_count: number;
  };
}

// ============================================
// Dashboard Types
// ============================================

export interface QCDashboardStats {
  passRate: number;
  totalRuns: number;
  passedRuns: number;
  failedRuns: number;
  pendingReview: number;
  runDate: string;
}

export interface QCDashboardData {
  todayStats: QCDashboardStats;
  weeklyTrend: QCDashboardStats[];
  openInvestigations: QCInvestigation[];
  activeAlerts: QCDriftAlert[];
  expiringLots: QCLot[];
  pendingTasks: QCTask[];
  eqcPending: EQCResult[];
  violationBreakdown: Record<string, number>;
}

// ============================================
// Filter Types
// ============================================

export interface QCRunFilters {
  labId: string;
  dateFrom?: string;
  dateTo?: string;
  analyzerName?: string;
  status?: QCRun['status'];
  runType?: QCRun['run_type'];
  passOnly?: boolean;
  failOnly?: boolean;
}

export interface QCInvestigationFilters {
  labId: string;
  status?: QCInvestigation['status'];
  severity?: QCInvestigation['severity'];
  assignedTo?: string;
  dateFrom?: string;
  dateTo?: string;
  hasHold?: boolean;
}

export interface QCTaskFilters {
  labId: string;
  status?: QCTask['status'];
  priority?: QCTask['priority'];
  taskType?: QCTaskType;
  assignedTo?: string;
  dueBefore?: string;
  overdueOnly?: boolean;
}

export interface QCLotFilters {
  labId: string;
  isActive?: boolean;
  lotType?: QCLot['lot_type'];
  expiringWithinDays?: number;
  analyteId?: string;
}

// ============================================
// Levey-Jennings Chart Types
// ============================================

export interface LeveyJenningsDataPoint {
  date: string;
  value: number;
  zScore: number;
  runId: string;
  pass: boolean;
  westgardFlags?: string[];
}

export interface LeveyJenningsChartData {
  dataPoints: LeveyJenningsDataPoint[];
  targetMean: number;
  targetSD: number;
  lotNumber: string;
  analyteName: string;
  analyzerName?: string;
  level?: string;
}

// ============================================
// QC Schedule Types (Automation)
// ============================================

export type QCScheduleFrequency = 'daily' | 'twice_daily' | 'weekly' | 'monthly' | 'per_shift' | 'before_patient_samples';

export interface QCSchedule {
  id: string;
  lab_id: string;
  schedule_name: string;
  description?: string;
  analyzer_name: string;
  qc_lot_id?: string;
  test_group_ids?: string[];
  frequency: QCScheduleFrequency;
  days_of_week: number[]; // 0=Sun, 1=Mon, etc.
  shift_times?: string[];
  required_before_patient_samples: boolean;
  min_runs_per_day: number;
  max_hours_between_runs: number;
  reminder_minutes_before: number;
  notify_on_miss: boolean;
  notify_user_ids?: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
  // Joined fields
  lot_number?: string;
  test_group_names?: string[];
}

export interface QCScheduleTask {
  id: string;
  lab_id: string;
  qc_schedule_id: string;
  scheduled_date: string;
  scheduled_time?: string;
  due_by: string;
  status: 'pending' | 'in_progress' | 'completed' | 'missed' | 'skipped';
  completed_at?: string;
  completed_by?: string;
  qc_run_id?: string;
  missed_reason?: string;
  acknowledged_by?: string;
  acknowledged_at?: string;
  created_at: string;
  // Joined fields
  schedule_name?: string;
  analyzer_name?: string;
  qc_status?: 'pending' | 'overdue' | 'passed' | 'failed' | 'missed';
  time_remaining?: string;
}

export interface QCAnalyzerCoverage {
  id: string;
  lab_id: string;
  analyzer_name: string;
  test_group_id: string;
  qc_lot_ids?: string[];
  required_qc_levels: string[];
  require_qc_pass_before_release: boolean;
  max_hours_since_qc: number;
  created_at: string;
  // Joined fields
  test_group_name?: string;
  active_lots?: QCLot[];
}

export interface QCValidationResult {
  is_valid: boolean;
  reason: string;
  last_qc_run_id?: string;
  last_qc_time?: string;
  last_qc_status?: string;
  hours_since_qc?: number;
}

// ============================================
// Schedule Filter Types
// ============================================

export interface QCScheduleFilters {
  labId: string;
  analyzerName?: string;
  isActive?: boolean;
}

export interface QCScheduleTaskFilters {
  labId: string;
  scheduledDate?: string;
  status?: QCScheduleTask['status'];
  analyzerName?: string;
}
