// WhatsApp Template Utilities
// Placeholder replacement and template processing

export interface TemplateData {
  // Patient info
  PatientName?: string;
  PatientId?: string;
  PatientPhone?: string;
  PatientAge?: string | number;
  PatientGender?: string;
  
  // Test/Order info
  TestName?: string;
  OrderId?: string;
  OrderNumber?: string;
  OrderStatus?: string;
  SampleId?: string;
  
  // Doctor info
  DoctorName?: string;
  DoctorPhone?: string;
  
  // Report info
  ReportUrl?: string;
  ReportDate?: string;
  
  // Lab info
  LabName?: string;
  LabPhone?: string;
  LabAddress?: string;
  
  // Billing info
  Amount?: string | number;
  DueAmount?: string | number;
  PaidAmount?: string | number;
  InvoiceNumber?: string;
  
  // Appointment info
  AppointmentDate?: string;
  AppointmentTime?: string;
  
  // Results
  ResultSummary?: string;
  
  // Custom fields
  [key: string]: string | number | undefined;
}

/**
 * Replace placeholders in template with actual data
 * Supports both [PlaceholderName] and {placeholderName} formats
 * 
 * @param template - Template string with placeholders
 * @param data - Data object with placeholder values
 * @returns Processed string with placeholders replaced
 */
export function replacePlaceholders(template: string, data: TemplateData): string {
  if (!template) return '';
  
  let result = template;
  
  // Replace [CapitalCase] format (preferred)
  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      const placeholder = `[${key}]`;
      const regex = new RegExp(escapeRegex(placeholder), 'g');
      result = result.replace(regex, String(value));
    }
  });
  
  // Replace {lowercase} format (legacy support)
  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      const lowercaseKey = key.charAt(0).toLowerCase() + key.slice(1);
      const placeholder = `{${lowercaseKey}}`;
      const regex = new RegExp(escapeRegex(placeholder), 'g');
      result = result.replace(regex, String(value));
    }
  });
  
  return result;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract placeholder names from template string
 * Finds both [PlaceholderName] and {placeholderName} formats
 * 
 * @param template - Template string
 * @returns Array of unique placeholder names
 */
export function extractPlaceholders(template: string): string[] {
  if (!template) return [];
  
  const placeholders = new Set<string>();
  
  // Find [CapitalCase] placeholders
  const bracketMatches = template.match(/\[([A-Za-z0-9_]+)\]/g);
  if (bracketMatches) {
    bracketMatches.forEach(match => {
      const name = match.slice(1, -1); // Remove [ and ]
      placeholders.add(name);
    });
  }
  
  // Find {lowercase} placeholders
  const braceMatches = template.match(/\{([a-z][A-Za-z0-9_]*)\}/g);
  if (braceMatches) {
    braceMatches.forEach(match => {
      const name = match.slice(1, -1); // Remove { and }
      // Convert to CapitalCase for consistency
      const capitalCase = name.charAt(0).toUpperCase() + name.slice(1);
      placeholders.add(capitalCase);
    });
  }
  
  return Array.from(placeholders).sort();
}

/**
 * Validate template data against required placeholders
 * 
 * @param template - Template string
 * @param data - Data object
 * @returns Object with validation result and missing placeholders
 */
export function validateTemplateData(
  template: string,
  data: TemplateData
): { isValid: boolean; missing: string[] } {
  const placeholders = extractPlaceholders(template);
  const missing: string[] = [];
  
  placeholders.forEach(placeholder => {
    if (data[placeholder] === undefined || data[placeholder] === null || data[placeholder] === '') {
      missing.push(placeholder);
    }
  });
  
  return {
    isValid: missing.length === 0,
    missing
  };
}

/**
 * Preview template with sample data
 * Shows what the message will look like
 * 
 * @param template - Template string
 * @returns Preview with placeholder highlighting or sample data
 */
export function previewTemplate(template: string, sampleData?: Partial<TemplateData>): string {
  const defaultSample: TemplateData = {
    PatientName: 'John Doe',
    PatientId: 'P12345',
    TestName: 'Complete Blood Count',
    OrderId: 'ORD-2024-001',
    OrderStatus: 'Completed',
    DoctorName: 'Dr. Sarah Smith',
    LabName: 'MediLab Diagnostics',
    Amount: '2500',
    ReportDate: new Date().toLocaleDateString('en-IN'),
    ...sampleData
  };
  
  return replacePlaceholders(template, defaultSample);
}

/**
 * Standard placeholder definitions for UI
 */
export const STANDARD_PLACEHOLDERS = [
  { name: 'PatientName', description: 'Patient full name', category: 'patient' },
  { name: 'PatientId', description: 'Patient ID/registration number', category: 'patient' },
  { name: 'PatientPhone', description: 'Patient contact number', category: 'patient' },
  { name: 'PatientAge', description: 'Patient age', category: 'patient' },
  { name: 'PatientGender', description: 'Patient gender', category: 'patient' },
  
  { name: 'TestName', description: 'Test or test group name', category: 'test' },
  { name: 'OrderId', description: 'Order ID', category: 'order' },
  { name: 'OrderNumber', description: 'Order number (display format)', category: 'order' },
  { name: 'OrderStatus', description: 'Current order status', category: 'order' },
  { name: 'SampleId', description: 'Sample/specimen ID', category: 'order' },
  
  { name: 'DoctorName', description: 'Referring doctor name', category: 'doctor' },
  { name: 'DoctorPhone', description: 'Doctor contact number', category: 'doctor' },
  
  { name: 'ReportUrl', description: 'Report PDF URL', category: 'report' },
  { name: 'ReportDate', description: 'Report generation date', category: 'report' },
  
  { name: 'LabName', description: 'Laboratory name', category: 'lab' },
  { name: 'LabPhone', description: 'Lab contact number', category: 'lab' },
  { name: 'LabAddress', description: 'Lab address', category: 'lab' },
  
  { name: 'Amount', description: 'Total amount', category: 'billing' },
  { name: 'DueAmount', description: 'Amount due/pending', category: 'billing' },
  { name: 'PaidAmount', description: 'Amount paid', category: 'billing' },
  { name: 'InvoiceNumber', description: 'Invoice number', category: 'billing' },
  
  { name: 'AppointmentDate', description: 'Appointment date', category: 'appointment' },
  { name: 'AppointmentTime', description: 'Appointment time', category: 'appointment' },
  
  { name: 'ResultSummary', description: 'Summary of test results', category: 'results' },
] as const;

/**
 * Default template content for seeding
 */
export const DEFAULT_TEMPLATES = {
  report_ready: {
    name: 'Report Ready',
    message: 'Hello [PatientName], your [TestName] report is ready. Please find it attached.',
    requires_attachment: true,
  },
  appointment_reminder: {
    name: 'Appointment Reminder',
    message: 'Hello [PatientName], this is a reminder for your upcoming appointment on [AppointmentDate] at [AppointmentTime]. Please arrive 15 minutes early.',
    requires_attachment: false,
  },
  test_results: {
    name: 'Test Results Available',
    message: 'Hello [PatientName], your [TestName] results are now available. Please contact [LabName] at [LabPhone] to collect your report.',
    requires_attachment: false,
  },
  doctor_notification: {
    name: 'Doctor Notification',
    message: 'Hello Dr. [DoctorName],\n\nOrder #[OrderId] for patient [PatientName] is currently [OrderStatus].\n\nThank you.',
    requires_attachment: false,
  },
  payment_reminder: {
    name: 'Payment Reminder',
    message: 'Hello [PatientName], this is a reminder that payment of ₹[DueAmount] is pending for Order #[OrderNumber]. Please visit [LabName] to complete payment.',
    requires_attachment: false,
  },
} as const;
