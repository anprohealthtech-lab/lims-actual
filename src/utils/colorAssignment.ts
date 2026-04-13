/**
 * Color assignment utilities for order-based sample identification system
 * Each order gets its own sample tube, QR code, and color for proper lab workflow
 */

// 12 high-contrast, visually distinct colors for daily rotation
export const COLOR_PALETTE: Array<{hex: string, name: string}> = [
  { hex: "#EF4444", name: "Red" },
  { hex: "#3B82F6", name: "Blue" },
  { hex: "#10B981", name: "Green" },
  { hex: "#F59E0B", name: "Orange" },
  { hex: "#8B5CF6", name: "Purple" },
  { hex: "#06B6D4", name: "Cyan" },
  { hex: "#EC4899", name: "Pink" },
  { hex: "#84CC16", name: "Lime" },
  { hex: "#F97316", name: "Amber" },
  { hex: "#6366F1", name: "Indigo" },
  { hex: "#14B8A6", name: "Teal" },
  { hex: "#A855F7", name: "Violet" }
];

/**
 * Get the assigned color for an order based on daily sequence
 * @param dailySequenceNumber Sequential number of the order for the day (1, 2, 3, ...)
 * @returns Object containing the color_code (HEX) and color_name
 */
export const getOrderAssignedColor = (dailySequenceNumber: number): { color_code: string, color_name: string } => {
  // Subtract 1 to make it 0-indexed (sequential numbers start from 1)
  const colorIndex = (dailySequenceNumber - 1) % COLOR_PALETTE.length;
  const selectedColor = COLOR_PALETTE[colorIndex];
  
  return {
    color_code: selectedColor.hex,
    color_name: selectedColor.name
  };
};

/**
 * Generate sample ID for an order
 * @param date Date for the order
 * @param dailySequence Sequential number for the day
 * @param labCode Optional lab code prefix (e.g. "ML001"). When provided the
 *   format is LABCODE-DD-Mon-YYYY-SEQ so each lab has its own namespace.
 * @returns Sample ID in format [LABCODE-]DD-Mon-YYYY-SEQ
 */
export const generateOrderSampleId = (date: Date, dailySequence: number, labCode?: string): string => {
  const day = date.getDate().toString().padStart(2, '0');
  const month = date.toLocaleString('en-US', { month: 'short' });
  const year = date.getFullYear();
  const sequence = dailySequence.toString().padStart(3, '0');
  const datePart = `${day}-${month}-${year}-${sequence}`;
  return labCode ? `${labCode}-${datePart}` : datePart;
};

/**
 * Generate QR code data for an order
 * @param order Order data
 * @returns JSON string for QR code containing order and sample information
 */
export const generateOrderQRCodeData = (order: {
  id: string;
  patientId: string;
  sampleId: string;
  orderDate: string;
  colorCode: string;
  colorName: string;
  patientName?: string;
}): string => {
  return JSON.stringify({
    orderId: order.id,
    patientId: order.patientId,
    sampleId: order.sampleId,
    orderDate: order.orderDate,
    colorCode: order.colorCode,
    colorName: order.colorName,
    patientName: order.patientName || 'Unknown',
    generated: new Date().toISOString()
  });
};

// Legacy functions for backward compatibility during transition
// These will be removed after full migration to order-based system

/**
 * @deprecated Use getOrderAssignedColor instead
 * Legacy function for patient-based color assignment
 */
export const getAssignedColor = (sequentialNumber: number): { color_code: string, color_name: string } => {
  console.warn('getAssignedColor is deprecated. Use getOrderAssignedColor for order-based sample tracking.');
  return getOrderAssignedColor(sequentialNumber);
};

/**
 * @deprecated Use generateOrderQRCodeData instead
 * Legacy function for patient-based QR code generation
 */
export const generateQRCodeData = (patient: {
  id: string;
  name: string;
  age: number;
  gender: string;
}): string => {
  console.warn('generateQRCodeData is deprecated. Use generateOrderQRCodeData for order-based sample tracking.');
  return `${patient.id}|${patient.name}|${patient.age}|${patient.gender}`;
};

/**
 * Calculate the number of days since January 1, 2024 (epoch)
 * @returns Number of days since epoch
 */
export const getDaysSinceEpoch = (): number => {
  const epoch = new Date(2024, 0, 1).getTime(); // January 1, 2024
  const today = new Date().setHours(0, 0, 0, 0);
  const diffTime = today - epoch;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

/**
 * Calculate the daily color offset based on the current date
 * @returns The offset to use for today's color assignments
 */
export const getDailyColorOffset = (): number => {
  const daysSinceEpoch = getDaysSinceEpoch();
  // Use half the color palette length as the daily progression
  // This ensures we don't repeat the same starting colors every day
  const dailyProgression = Math.floor(COLOR_PALETTE.length / 2);
  return (daysSinceEpoch * dailyProgression) % COLOR_PALETTE.length;
};

/**
 * Count patients registered today
 * @param patients Array of all patients
 * @returns Number of patients registered today
 * @deprecated This function is no longer needed for order-based sample tracking
 */
export const countPatientsRegisteredToday = async (): Promise<number> => {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  
  // This function will be replaced by direct database query in supabase.ts
  return 0;
};