/**
 * Workflow Context Service
 *
 * Automatically fetches order context and maps it to workflow form fields.
 * Eliminates manual entry of data that already exists in the system.
 */

import { supabase } from './supabase';
import type { Model } from 'survey-core';

// Common field name variations used in workflow definitions
const FIELD_NAME_MAPPINGS: Record<string, string[]> = {
  // Patient fields
  patientId: ['patientID', 'patientId', 'patient_id', 'PatientID', 'Patient_ID'],
  patientName: ['patientName', 'patient_name', 'PatientName', 'Patient_Name', 'patientFullName'],
  patientAge: ['patientAge', 'patient_age', 'PatientAge', 'age', 'Age'],
  patientGender: ['patientGender', 'patient_gender', 'PatientGender', 'gender', 'Gender', 'sex', 'Sex'],

  // Sample/Collection fields
  sampleId: ['sampleID', 'sampleId', 'sample_id', 'SampleID', 'Sample_ID', 'sampleIDVerification', 'sampleVerification', 'specimenId'],
  collectionDate: ['collectionDate', 'collection_date', 'CollectionDate', 'sampleDate', 'sample_date', 'specimenDate'],
  collectionTime: ['collectionTime', 'collection_time', 'CollectionTime', 'sampleTime', 'sample_time'],
  collectorName: ['collectorName', 'phlebotomistID', 'phlebotomist_id', 'collectedBy', 'collected_by', 'sampleCollector'],

  // Order fields
  orderId: ['orderId', 'order_id', 'OrderID', 'Order_ID'],
  orderNumber: ['orderNumber', 'order_number', 'OrderNumber'],
  orderDate: ['orderDate', 'order_date', 'OrderDate'],

  // Test fields
  testGroupId: ['testGroupId', 'test_group_id', 'TestGroupID', 'testId'],
  testName: ['testName', 'test_name', 'TestName', 'Test_Name'],
  testCode: ['testCode', 'test_code', 'TestCode'],

  // Lab fields
  labId: ['labId', 'lab_id', 'LabID', 'Lab_ID'],
  labName: ['labName', 'lab_name', 'LabName'],

  // Doctor fields
  doctorName: ['doctorName', 'doctor', 'referringDoctor', 'referring_doctor', 'Doctor'],
  doctorId: ['doctorId', 'doctor_id', 'referringDoctorId'],

  // Technician fields
  technicianId: ['technicianId', 'technician_id', 'TechnicianID', 'tech_id', 'operatorId'],
  technicianName: ['technicianName', 'technician_name', 'TechnicianName', 'tech_name', 'operatorName'],
};

export interface WorkflowContext {
  // From Order
  orderId: string;
  orderNumber?: string;
  orderDate: string;
  sampleId: string | null;
  collectionDate: string | null;
  collectionTime: string | null;
  collectorName: string | null;
  priority: string;
  status: string;

  // From Patient
  patientId: string;
  patientName: string;
  patientAge: number | null;
  patientGender: string | null;
  patientPhone: string | null;

  // From Test
  testGroupId: string | null;
  testName: string | null;
  testCode: string | null;

  // From Lab
  labId: string;
  labName: string | null;

  // From Doctor
  doctorName: string | null;
  doctorId: string | null;

  // Current User (Technician)
  technicianId: string | null;
  technicianName: string | null;

  // Computed
  workingDate: string;
  workingTime: string;
}

export interface ContextFetchOptions {
  orderId: string;
  testGroupId?: string;
  includeAnalytes?: boolean;
}

/**
 * Fetch complete order context for workflow pre-population
 */
export async function fetchWorkflowContext(options: ContextFetchOptions): Promise<WorkflowContext | null> {
  const { orderId, testGroupId } = options;

  try {
    // Fetch order with related data
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        id,
        order_number,
        order_display,
        order_date,
        sample_id,
        sample_collected_at,
        sample_collected_by,
        priority,
        status,
        patient_id,
        patient_name,
        doctor,
        referring_doctor_id,
        lab_id,
        notes,
        patients (
          id,
          name,
          age,
          gender,
          phone,
          date_of_birth
        ),
        labs (
          id,
          name
        ),
        referring_doctors (
          id,
          name
        )
      `)
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error('Failed to fetch order for workflow context:', orderError);
      return null;
    }

    // Fetch test info if testGroupId provided
    let testInfo: { name: string; code: string | null } | null = null;
    if (testGroupId) {
      const { data: testGroup } = await supabase
        .from('test_groups')
        .select('name, code')
        .eq('id', testGroupId)
        .single();

      if (testGroup) {
        testInfo = testGroup;
      }
    }

    // Get current user info
    const { data: { user } } = await supabase.auth.getUser();
    let technicianInfo: { id: string; name: string } | null = null;

    if (user) {
      const { data: userData } = await supabase
        .from('users')
        .select('id, full_name')
        .eq('id', user.id)
        .single();

      if (userData) {
        technicianInfo = { id: userData.id, name: userData.full_name };
      }
    }

    // Parse collection datetime
    let collectionDate: string | null = null;
    let collectionTime: string | null = null;

    if (order.sample_collected_at) {
      const collectedAt = new Date(order.sample_collected_at);
      collectionDate = collectedAt.toISOString().split('T')[0]; // YYYY-MM-DD
      collectionTime = collectedAt.toTimeString().slice(0, 5); // HH:MM
    }

    // Build context object
    const context: WorkflowContext = {
      // Order
      orderId: order.id,
      orderNumber: order.order_display || order.order_number?.toString() || undefined,
      orderDate: order.order_date,
      sampleId: order.sample_id,
      collectionDate,
      collectionTime,
      collectorName: order.sample_collected_by,
      priority: order.priority,
      status: order.status,

      // Patient
      patientId: order.patient_id,
      patientName: order.patient_name || (order.patients as any)?.name || 'Unknown',
      patientAge: (order.patients as any)?.age || null,
      patientGender: (order.patients as any)?.gender || null,
      patientPhone: (order.patients as any)?.phone || null,

      // Test
      testGroupId: testGroupId || null,
      testName: testInfo?.name || null,
      testCode: testInfo?.code || null,

      // Lab
      labId: order.lab_id,
      labName: (order.labs as any)?.name || null,

      // Doctor
      doctorName: order.doctor || (order.referring_doctors as any)?.name || null,
      doctorId: order.referring_doctor_id || null,

      // Technician
      technicianId: technicianInfo?.id || null,
      technicianName: technicianInfo?.name || null,

      // Computed
      workingDate: new Date().toISOString().split('T')[0],
      workingTime: new Date().toTimeString().slice(0, 5),
    };

    return context;
  } catch (error) {
    console.error('Error fetching workflow context:', error);
    return null;
  }
}

/**
 * Build a flat field map from context for Survey.js pre-population
 */
export function buildFieldMap(context: WorkflowContext): Record<string, any> {
  const fieldMap: Record<string, any> = {};

  // For each context field, map to all possible field name variations
  Object.entries(context).forEach(([key, value]) => {
    if (value === null || value === undefined) return;

    const variations = FIELD_NAME_MAPPINGS[key] || [key];
    variations.forEach(fieldName => {
      fieldMap[fieldName] = value;
    });
  });

  return fieldMap;
}

/**
 * Apply context to a Survey.js model, pre-populating fields and optionally making them read-only
 */
export function applyContextToSurvey(
  survey: Model,
  context: WorkflowContext,
  options: {
    makeReadOnly?: boolean;
    showAsVerification?: boolean;
  } = {}
): void {
  const { makeReadOnly = true, showAsVerification = false } = options;

  const fieldMap = buildFieldMap(context);

  // =========================================================================
  // IMPORTANT: Set Survey.js VARIABLES for HTML template replacement
  // HTML elements use {variableName} syntax which requires setVariable()
  // =========================================================================
  Object.entries(fieldMap).forEach(([key, value]) => {
    // Set as variable for HTML template replacement (e.g., {patientName} in HTML)
    survey.setVariable(key, value ?? '');
  });

  // Also set common context fields directly (handles camelCase variations)
  Object.entries(context).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      survey.setVariable(key, value);
    }
  });

  // Get all questions from survey
  const questions = survey.getAllQuestions();
  const prefilledFields: string[] = [];

  // Pre-populate matching fields (for actual form questions)
  questions.forEach((question: any) => {
    const questionName = question.name;

    // Check if this question has a matching context value
    if (fieldMap[questionName] !== undefined) {
      // Set the value
      survey.setValue(questionName, fieldMap[questionName]);
      prefilledFields.push(questionName);

      if (makeReadOnly) {
        // Make the question read-only
        question.readOnly = true;

        // Add visual indicator
        if (showAsVerification && !question.title.includes('[Auto-filled]')) {
          question.title = `${question.title} [Auto-filled]`;
        }
      }
    }
  });

  // Also set data directly for any fields not represented as questions
  Object.entries(fieldMap).forEach(([key, value]) => {
    if (!survey.getValue(key)) {
      survey.setValue(key, value);
    }
  });

  console.log('Workflow context applied:', {
    prefilledFields,
    totalQuestions: questions.length,
    contextFields: Object.keys(context).length,
    variablesSet: Object.keys(fieldMap).length
  });
}

/**
 * Get analyte catalog for a test group
 */
export async function fetchAnalyteCatalog(testGroupId: string): Promise<Array<{
  id: string | null;
  name: string;
  unit: string | null;
  reference_range: string | null;
}>> {
  if (!testGroupId) return [];

  try {
    const { data, error } = await supabase
      .from('test_group_analytes')
      .select(`
        analyte_id,
        lab_analyte_id,
        analytes (
          id,
          name,
          unit,
          reference_range
        ),
        lab_analytes (
          id,
          name,
          unit,
          reference_range,
          lab_specific_reference_range
        )
      `)
      .eq('test_group_id', testGroupId);

    if (error) throw error;

    return (data ?? [])
      .map((row: any) => {
        const analyte = row.analytes ?? {};
        const la = row.lab_analyte_id ? row.lab_analytes : null;
        const name = la?.name || analyte?.name;
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
          return null;
        }
        return {
          id: row.analyte_id ?? analyte?.id ?? null,
          name,
          unit: la?.unit ?? analyte?.unit ?? null,
          reference_range: la?.lab_specific_reference_range ?? la?.reference_range ?? analyte?.reference_range ?? null,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  } catch (error) {
    console.error('Failed to fetch analyte catalog:', error);
    return [];
  }
}

/**
 * Validate that required context is present for workflow execution
 */
export function validateWorkflowContext(context: WorkflowContext | null): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!context) {
    return { valid: false, errors: ['No context available'] };
  }

  if (!context.orderId) errors.push('Order ID is required');
  if (!context.patientId) errors.push('Patient ID is required');
  if (!context.labId) errors.push('Lab ID is required');

  return {
    valid: errors.length === 0,
    errors
  };
}

export default {
  fetchWorkflowContext,
  buildFieldMap,
  applyContextToSurvey,
  fetchAnalyteCatalog,
  validateWorkflowContext
};
