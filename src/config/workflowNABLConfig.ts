/**
 * NABL/ISO 15189:2022 Workflow Configuration
 *
 * This file defines:
 * 1. Standard field mappings between order context and workflow fields
 * 2. Mandatory NABL requirements for workflow validation
 * 3. QC integration configuration
 * 4. Phase structure requirements
 */

// ============================================================================
// Field Mappings: Order Context → Workflow Fields
// ============================================================================

/**
 * Maps order/patient/lab context to workflow field names.
 * The key is the canonical field name, values are variations used in workflows.
 */
export const CONTEXT_FIELD_MAPPINGS: Record<string, string[]> = {
  // Sample identification
  sampleId: ['sampleId', 'sampleID', 'sample_id', 'Sample_ID', 'specimenId', 'specimen_id', 'sampleIDVerification'],

  // Patient identification
  patientId: ['patientId', 'patientID', 'patient_id', 'Patient_ID', 'patientUUID'],
  patientName: ['patientName', 'patient_name', 'PatientName', 'patientFullName'],
  patientAge: ['patientAge', 'patient_age', 'age', 'Age', 'patientAgeYears'],
  patientGender: ['patientGender', 'patient_gender', 'gender', 'Gender', 'sex', 'Sex'],
  dateOfBirth: ['dateOfBirth', 'dob', 'DOB', 'date_of_birth', 'birthDate'],

  // Collection information
  collectionDate: ['collectionDate', 'collection_date', 'sampleDate', 'sample_date', 'specimenDate', 'receivedDate'],
  collectionTime: ['collectionTime', 'collection_time', 'sampleTime', 'sample_time', 'specimenTime', 'receivedTime'],
  collectorName: ['collectorName', 'collector_name', 'phlebotomistID', 'phlebotomist', 'collectedBy', 'sample_collector'],

  // Order information
  orderId: ['orderId', 'order_id', 'OrderID', 'orderUUID'],
  orderNumber: ['orderNumber', 'order_number', 'orderDisplay', 'order_display'],
  orderDate: ['orderDate', 'order_date', 'OrderDate'],

  // Test information
  testGroupId: ['testGroupId', 'test_group_id', 'testId', 'TestGroupID'],
  testName: ['testName', 'test_name', 'TestName', 'testTitle'],
  testCode: ['testCode', 'test_code', 'TestCode'],

  // Lab information
  labId: ['labId', 'lab_id', 'LabID', 'laboratory_id'],
  labName: ['labName', 'lab_name', 'LabName', 'laboratoryName'],

  // Doctor information
  doctorName: ['doctorName', 'doctor', 'referringDoctor', 'referring_doctor', 'physician'],
  doctorId: ['doctorId', 'doctor_id', 'referringDoctorId'],

  // Technician/Operator
  technicianId: ['technicianId', 'technician_id', 'operatorId', 'operator_id', 'userId', 'user_id'],
  technicianName: ['technicianName', 'technician_name', 'operatorName', 'operator_name', 'userName', 'tech_signature'],

  // Working date/time (auto-filled)
  workingDate: ['workingDate', 'working_date', 'testDate', 'test_date', 'analysisDate', 'runDate', 'date_signed'],
  workingTime: ['workingTime', 'working_time', 'testTime', 'test_time', 'analysisTime', 'runTime'],
};

/**
 * Fields that should be read-only (pre-populated from order)
 */
export const READ_ONLY_CONTEXT_FIELDS = [
  'sampleId',
  'patientId',
  'patientName',
  'patientAge',
  'patientGender',
  'collectionDate',
  'collectionTime',
  'collectorName',
  'orderId',
  'orderNumber',
  'testGroupId',
  'testName',
  'testCode',
  'labId',
  'labName',
  'doctorName',
  'technicianId',
  'technicianName',
  'workingDate',
  'workingTime',
];

// ============================================================================
// NABL/ISO 15189:2022 Mandatory Requirements
// ============================================================================

export interface NABLRequirement {
  id: string;
  description: string;
  phase: 'preAnalytical' | 'qcVerification' | 'analytical' | 'postAnalytical';
  severity: 'mandatory' | 'recommended' | 'optional';
  fieldNames: string[]; // Field names that satisfy this requirement
  validationRule?: string; // How to validate
}

export const NABL_REQUIREMENTS: NABLRequirement[] = [
  // Pre-Analytical Phase
  {
    id: 'NABL-PRE-001',
    description: 'Sample identification must be verified',
    phase: 'preAnalytical',
    severity: 'mandatory',
    fieldNames: ['sampleIdVerified', 'sampleVerification', 'sampleAdequate'],
    validationRule: 'checkbox_checked',
  },
  {
    id: 'NABL-PRE-002',
    description: 'Patient identity must be confirmed',
    phase: 'preAnalytical',
    severity: 'mandatory',
    fieldNames: ['patientVerified', 'patientIdConfirmed', 'patientIdentityVerified'],
    validationRule: 'checkbox_checked',
  },
  {
    id: 'NABL-PRE-003',
    description: 'Sample condition must be documented',
    phase: 'preAnalytical',
    severity: 'mandatory',
    fieldNames: ['sampleCondition', 'specimenCondition', 'sampleQuality'],
    validationRule: 'has_value',
  },
  {
    id: 'NABL-PRE-004',
    description: 'Sample received within stability period',
    phase: 'preAnalytical',
    severity: 'recommended',
    fieldNames: ['stabilityVerified', 'withinStability', 'sampleStability'],
    validationRule: 'checkbox_checked',
  },

  // QC Verification Phase
  {
    id: 'NABL-QC-001',
    description: 'IQC must be run before patient samples',
    phase: 'qcVerification',
    severity: 'mandatory',
    fieldNames: ['iqcLevel1', 'iqcLow', 'qcLevel1', 'iqcLowResult'],
    validationRule: 'numeric_required',
  },
  {
    id: 'NABL-QC-002',
    description: 'At least 2 levels of IQC required',
    phase: 'qcVerification',
    severity: 'mandatory',
    fieldNames: ['iqcLevel2', 'iqcNormal', 'qcLevel2', 'iqcMediumResult', 'iqcNormalResult'],
    validationRule: 'numeric_required',
  },
  {
    id: 'NABL-QC-003',
    description: 'IQC lot number must be recorded',
    phase: 'qcVerification',
    severity: 'mandatory',
    fieldNames: ['iqcLotNumber', 'qcLotNumber', 'lot_number', 'controlLotNumber'],
    validationRule: 'has_value',
  },
  {
    id: 'NABL-QC-004',
    description: 'IQC acceptability must be confirmed',
    phase: 'qcVerification',
    severity: 'mandatory',
    fieldNames: ['iqcAccepted', 'qcAccepted', 'iqcPass', 'qcVerified'],
    validationRule: 'checkbox_checked',
  },
  {
    id: 'NABL-QC-005',
    description: 'Calibration verification required',
    phase: 'qcVerification',
    severity: 'recommended',
    fieldNames: ['calibrationVerified', 'calibrationOk', 'calibrationDate', 'lastCalibration'],
    validationRule: 'has_value',
  },

  // Analytical Phase
  {
    id: 'NABL-ANA-001',
    description: 'Test result value must be recorded',
    phase: 'analytical',
    severity: 'mandatory',
    fieldNames: ['resultValue', 'testResult', 'result', 'value', 'measurement'],
    validationRule: 'numeric_required',
  },
  {
    id: 'NABL-ANA-002',
    description: 'Reagent lot number should be tracked',
    phase: 'analytical',
    severity: 'recommended',
    fieldNames: ['reagentLotNumber', 'reagentLot', 'kitLotNumber'],
    validationRule: 'has_value',
  },
  {
    id: 'NABL-ANA-003',
    description: 'Analyzer/Equipment identification',
    phase: 'analytical',
    severity: 'recommended',
    fieldNames: ['analyzerName', 'equipmentId', 'instrumentId', 'analyzer'],
    validationRule: 'has_value',
  },

  // Post-Analytical Phase
  {
    id: 'NABL-POST-001',
    description: 'Result verification must be performed',
    phase: 'postAnalytical',
    severity: 'mandatory',
    fieldNames: ['resultVerified', 'verificationComplete', 'resultReviewed', 'resultVerificationChecklist'],
    validationRule: 'checkbox_checked',
  },
  {
    id: 'NABL-POST-002',
    description: 'Critical value notification if applicable',
    phase: 'postAnalytical',
    severity: 'mandatory',
    fieldNames: ['criticalValueReported', 'criticalNotified', 'criticalValueAction'],
    validationRule: 'conditional', // Only required if result is critical
  },
  {
    id: 'NABL-POST-003',
    description: 'Technician signature/confirmation',
    phase: 'postAnalytical',
    severity: 'mandatory',
    fieldNames: ['technicianSignature', 'resultConfirmed', 'completionConfirmed', 'wasteDisposalConfirmation'],
    validationRule: 'checkbox_checked',
  },
];

// ============================================================================
// Workflow Phase Configuration
// ============================================================================

export interface WorkflowPhase {
  id: string;
  name: string;
  title: string;
  order: number;
  requiredFields: string[];
  optionalFields: string[];
  description: string;
}

export const WORKFLOW_PHASES: WorkflowPhase[] = [
  {
    id: 'preAnalytical',
    name: 'Pre-Analytical Phase',
    title: 'Pre-Analytical Verification',
    order: 1,
    requiredFields: ['sampleIdVerified', 'sampleCondition', 'patientVerified'],
    optionalFields: ['storageConditions', 'stabilityVerified', 'labelingVerified'],
    description: 'Verify sample identity, condition, and adequacy before testing',
  },
  {
    id: 'qcVerification',
    name: 'Quality Control',
    title: 'QC Verification',
    order: 2,
    requiredFields: ['iqcLevel1', 'iqcLevel2', 'iqcLotNumber', 'iqcAccepted'],
    optionalFields: ['iqcLevel3', 'calibrationVerified', 'calibrationDate'],
    description: 'Verify QC is acceptable before processing patient samples',
  },
  {
    id: 'analytical',
    name: 'Analytical Phase',
    title: 'Testing & Measurement',
    order: 3,
    requiredFields: ['resultValue'],
    optionalFields: ['analyzerName', 'reagentLotNumber', 'observations', 'testStartTime', 'testEndTime'],
    description: 'Perform the test and record measurements',
  },
  {
    id: 'postAnalytical',
    name: 'Post-Analytical Phase',
    title: 'Result Verification',
    order: 4,
    requiredFields: ['resultVerified', 'technicianSignature'],
    optionalFields: ['criticalValueReported', 'reportedTo', 'previousResult', 'deltaCheck', 'comments'],
    description: 'Verify results, handle critical values, prepare for authorization',
  },
];

// ============================================================================
// QC Integration Configuration
// ============================================================================

export interface QCFieldMapping {
  workflowField: string;
  dbTable: string;
  dbColumn: string;
  description: string;
}

export const QC_FIELD_MAPPINGS: QCFieldMapping[] = [
  // QC Lot Information
  { workflowField: 'iqcLotNumber', dbTable: 'qc_lots', dbColumn: 'lot_number', description: 'Control material lot number' },
  { workflowField: 'iqcMaterialName', dbTable: 'qc_lots', dbColumn: 'material_name', description: 'Control material name' },
  { workflowField: 'iqcExpiryDate', dbTable: 'qc_lots', dbColumn: 'expiry_date', description: 'Lot expiry date' },

  // QC Results
  { workflowField: 'iqcLevel1', dbTable: 'qc_results', dbColumn: 'observed_value', description: 'Level 1 (Low) QC result' },
  { workflowField: 'iqcLevel2', dbTable: 'qc_results', dbColumn: 'observed_value', description: 'Level 2 (Normal) QC result' },
  { workflowField: 'iqcLevel3', dbTable: 'qc_results', dbColumn: 'observed_value', description: 'Level 3 (High) QC result' },

  // QC Run
  { workflowField: 'qcRunDate', dbTable: 'qc_runs', dbColumn: 'run_date', description: 'QC run date' },
  { workflowField: 'qcOperator', dbTable: 'qc_runs', dbColumn: 'operator_name', description: 'QC performed by' },
  { workflowField: 'qcAnalyzer', dbTable: 'qc_runs', dbColumn: 'analyzer_name', description: 'Analyzer used for QC' },

  // Calibration
  { workflowField: 'calibrationDate', dbTable: 'calibration_records', dbColumn: 'calibration_date', description: 'Last calibration date' },
  { workflowField: 'calibratorLot', dbTable: 'calibration_records', dbColumn: 'calibrator_lot_number', description: 'Calibrator lot number' },
];

// ============================================================================
// Westgard Rules Configuration
// ============================================================================

export interface WestgardRule {
  code: string;
  name: string;
  description: string;
  isWarning: boolean;
  evaluationLogic: string;
}

export const WESTGARD_RULES: WestgardRule[] = [
  {
    code: '1_2s',
    name: '1:2s Warning',
    description: 'One control exceeds mean ± 2SD',
    isWarning: true,
    evaluationLogic: 'ABS(z_score) > 2',
  },
  {
    code: '1_3s',
    name: '1:3s Rejection',
    description: 'One control exceeds mean ± 3SD',
    isWarning: false,
    evaluationLogic: 'ABS(z_score) > 3',
  },
  {
    code: '2_2s',
    name: '2:2s Rejection',
    description: 'Two consecutive controls exceed mean + 2SD or mean - 2SD',
    isWarning: false,
    evaluationLogic: '(z_score > 2 AND prev_z > 2) OR (z_score < -2 AND prev_z < -2)',
  },
  {
    code: 'R_4s',
    name: 'R:4s Rejection',
    description: 'Range between two controls exceeds 4SD',
    isWarning: false,
    evaluationLogic: '(z_score > 2 AND prev_z < -2) OR (z_score < -2 AND prev_z > 2)',
  },
  {
    code: '4_1s',
    name: '4:1s Rejection',
    description: 'Four consecutive controls exceed mean + 1SD or mean - 1SD',
    isWarning: false,
    evaluationLogic: 'all_last_4_same_side_of_1sd',
  },
  {
    code: '10x',
    name: '10x Rejection',
    description: 'Ten consecutive controls on same side of mean',
    isWarning: false,
    evaluationLogic: 'all_last_10_same_side_of_mean',
  },
];

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a workflow definition against NABL requirements
 */
export function validateWorkflowNABLCompliance(workflowDefinition: any): {
  compliant: boolean;
  score: number;
  mandatoryMet: number;
  mandatoryTotal: number;
  issues: Array<{ requirement: NABLRequirement; status: 'pass' | 'fail' | 'warning' }>;
} {
  const issues: Array<{ requirement: NABLRequirement; status: 'pass' | 'fail' | 'warning' }> = [];

  // Extract all field names from workflow
  const workflowFields = new Set<string>();
  const pages = workflowDefinition?.ui?.template?.pages || workflowDefinition?.pages || [];

  pages.forEach((page: any) => {
    const elements = page.elements || [];
    elements.forEach((element: any) => {
      if (element.name) {
        workflowFields.add(element.name);
      }
    });
  });

  // Check each requirement
  let mandatoryMet = 0;
  const mandatoryTotal = NABL_REQUIREMENTS.filter(r => r.severity === 'mandatory').length;

  NABL_REQUIREMENTS.forEach(requirement => {
    const hasField = requirement.fieldNames.some(fieldName => workflowFields.has(fieldName));

    if (hasField) {
      issues.push({ requirement, status: 'pass' });
      if (requirement.severity === 'mandatory') mandatoryMet++;
    } else if (requirement.severity === 'mandatory') {
      issues.push({ requirement, status: 'fail' });
    } else {
      issues.push({ requirement, status: 'warning' });
    }
  });

  const score = Math.round((mandatoryMet / mandatoryTotal) * 100);

  return {
    compliant: mandatoryMet === mandatoryTotal,
    score,
    mandatoryMet,
    mandatoryTotal,
    issues,
  };
}

/**
 * Get the canonical field name from a workflow field name
 */
export function getCanonicalFieldName(workflowFieldName: string): string | null {
  for (const [canonical, variations] of Object.entries(CONTEXT_FIELD_MAPPINGS)) {
    if (variations.includes(workflowFieldName)) {
      return canonical;
    }
  }
  return null;
}

/**
 * Check if a field should be read-only (from context)
 */
export function isReadOnlyContextField(fieldName: string): boolean {
  const canonical = getCanonicalFieldName(fieldName);
  return canonical ? READ_ONLY_CONTEXT_FIELDS.includes(canonical) : false;
}

export default {
  CONTEXT_FIELD_MAPPINGS,
  READ_ONLY_CONTEXT_FIELDS,
  NABL_REQUIREMENTS,
  WORKFLOW_PHASES,
  QC_FIELD_MAPPINGS,
  WESTGARD_RULES,
  validateWorkflowNABLCompliance,
  getCanonicalFieldName,
  isReadOnlyContextField,
};
