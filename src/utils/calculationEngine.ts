/**
 * Calculation Engine for LIMS v2
 * 
 * Handles formula-based calculated parameters for analytes.
 * Uses mathjs for safe formula evaluation (no eval).
 * 
 * Features:
 * - Safe mathematical expression evaluation
 * - Dependency tracking for recalculation triggers
 * - Circular dependency prevention (validated at DB level)
 * - Patient data injection (age, gender) for eGFR-like formulas
 */

import { evaluate, round } from 'mathjs';
import { supabase } from './supabase';

// ============================================
// TYPES
// ============================================

export interface CalculatedAnalyte {
  id: string;
  name: string;
  formula: string;
  formula_variables: string[];
  formula_description?: string;
  unit?: string;
  reference_range?: string;
  category?: string;
}

export interface AnalyteDependency {
  source_analyte_id: string;
  source_name: string;
  variable_name: string;
}

export interface ResultValue {
  id?: string;
  analyte_id?: string;
  parameter: string;
  value: string;
  unit?: string;
  reference_range?: string;
  flag?: string;
  is_auto_calculated?: boolean;
  calculation_inputs?: Record<string, number>;
  calculated_at?: string;
}

export interface PatientData {
  age: number;
  gender: 'Male' | 'Female' | 'Other';
  weight_kg?: number;
  height_cm?: number;
  ethnicity?: string;
}

export interface CalculationResult {
  analyte_id: string;
  parameter: string;
  value: string;
  unit?: string;
  reference_range?: string;
  is_auto_calculated: true;
  calculation_inputs: Record<string, number>;
  calculated_at: string;
  formula_used: string;
  success: boolean;
  error?: string;
}

// ============================================
// CALCULATION ENGINE
// ============================================

export const calculationEngine = {
  /**
   * Fetch all calculated analytes for a test group
   */
  async getCalculatedAnalytesForTestGroup(testGroupId: string): Promise<CalculatedAnalyte[]> {
    const { data, error } = await supabase
      .from('test_group_analytes')
      .select(`
        analytes!inner(
          id,
          name,
          formula,
          formula_variables,
          formula_description,
          unit,
          reference_range,
          category,
          is_calculated
        )
      `)
      .eq('test_group_id', testGroupId)
      .eq('analytes.is_calculated', true);

    if (error || !data) return [];

    return data.map((item: any) => ({
      id: item.analytes.id,
      name: item.analytes.name,
      formula: item.analytes.formula,
      formula_variables: item.analytes.formula_variables || [],
      formula_description: item.analytes.formula_description,
      unit: item.analytes.unit,
      reference_range: item.analytes.reference_range,
      category: item.analytes.category
    }));
  },

  /**
   * Fetch dependencies for a calculated analyte
   */
  async getDependencies(calculatedAnalyteId: string): Promise<AnalyteDependency[]> {
    const { data, error } = await supabase
      .from('analyte_dependencies')
      .select(`
        source_analyte_id,
        variable_name,
        analytes!analyte_dependencies_source_analyte_id_fkey(name)
      `)
      .eq('calculated_analyte_id', calculatedAnalyteId);

    if (error || !data) return [];

    return data.map((item: any) => ({
      source_analyte_id: item.source_analyte_id,
      source_name: item.analytes?.name || '',
      variable_name: item.variable_name
    }));
  },

  /**
   * Compute all calculated values for a set of result values
   * Called after technician saves values or when a source value changes
   */
  async computeCalculatedValues(
    resultValues: ResultValue[],
    testGroupId: string,
    patientData?: PatientData
  ): Promise<CalculationResult[]> {
    // 1. Get calculated analytes for this test group
    const calculatedAnalytes = await this.getCalculatedAnalytesForTestGroup(testGroupId);
    if (calculatedAnalytes.length === 0) return [];

    // 2. Build value map from entered results (use parameter name as key)
    const valueMap: Record<string, number> = {};
    
    // Map by parameter name (normalized)
    resultValues.forEach(rv => {
      if (rv.value && !isNaN(parseFloat(rv.value))) {
        // Store by both full name and potential variable name
        valueMap[rv.parameter.toUpperCase()] = parseFloat(rv.value);
        valueMap[rv.parameter] = parseFloat(rv.value);
      }
    });

    // Inject patient data if available
    if (patientData) {
      valueMap['AGE'] = patientData.age;
      valueMap['GENDER'] = patientData.gender === 'Male' ? 1 : (patientData.gender === 'Female' ? 0 : 0.5);
      valueMap['GENDER_MALE'] = patientData.gender === 'Male' ? 1 : 0;
      valueMap['GENDER_FEMALE'] = patientData.gender === 'Female' ? 1 : 0;
      if (patientData.weight_kg) valueMap['WEIGHT'] = patientData.weight_kg;
      if (patientData.height_cm) valueMap['HEIGHT'] = patientData.height_cm;
    }

    // 3. Compute each calculated analyte
    const results: CalculationResult[] = [];

    for (const analyte of calculatedAnalytes) {
      const deps = await this.getDependencies(analyte.id);
      
      // Check if all required variables are present
      const scope: Record<string, number> = {};
      let allDepsPresent = true;
      
      for (const dep of deps) {
        const varName = dep.variable_name.toUpperCase();
        const sourceName = dep.source_name.toUpperCase();
        
        // Try to find value by variable name or source analyte name
        const value = valueMap[varName] ?? valueMap[sourceName] ?? valueMap[dep.variable_name] ?? valueMap[dep.source_name];
        
        if (value === undefined || isNaN(value)) {
          allDepsPresent = false;
          break;
        }
        scope[dep.variable_name] = value;
      }

      // Also check formula_variables for patient data
      for (const varName of (analyte.formula_variables || [])) {
        if (!scope[varName]) {
          const upperVar = varName.toUpperCase();
          if (valueMap[upperVar] !== undefined) {
            scope[varName] = valueMap[upperVar];
          }
        }
      }

      if (!allDepsPresent) {
        results.push({
          analyte_id: analyte.id,
          parameter: analyte.name,
          value: '',
          unit: analyte.unit,
          reference_range: analyte.reference_range,
          is_auto_calculated: true,
          calculation_inputs: scope,
          calculated_at: new Date().toISOString(),
          formula_used: analyte.formula,
          success: false,
          error: 'Missing required input values'
        });
        continue;
      }

      // 4. Evaluate formula using mathjs
      try {
        const result = evaluate(analyte.formula, scope);
        const roundedResult = round(result, 2);

        results.push({
          analyte_id: analyte.id,
          parameter: analyte.name,
          value: String(roundedResult),
          unit: analyte.unit,
          reference_range: analyte.reference_range,
          is_auto_calculated: true,
          calculation_inputs: scope,
          calculated_at: new Date().toISOString(),
          formula_used: analyte.formula,
          success: true
        });
      } catch (err: any) {
        results.push({
          analyte_id: analyte.id,
          parameter: analyte.name,
          value: '',
          unit: analyte.unit,
          reference_range: analyte.reference_range,
          is_auto_calculated: true,
          calculation_inputs: scope,
          calculated_at: new Date().toISOString(),
          formula_used: analyte.formula,
          success: false,
          error: err.message || 'Formula evaluation failed'
        });
      }
    }

    return results;
  },

  /**
   * Save calculated values to result_values table
   */
  async saveCalculatedValues(
    resultId: string,
    orderId: string,
    testGroupId: string,
    labId: string,
    calculations: CalculationResult[]
  ): Promise<{ success: boolean; error?: string }> {
    const successfulCalcs = calculations.filter(c => c.success);
    if (successfulCalcs.length === 0) {
      return { success: true }; // Nothing to save
    }

    const upsertData = successfulCalcs.map(calc => ({
      result_id: resultId,
      order_id: orderId,
      test_group_id: testGroupId,
      lab_id: labId,
      analyte_id: calc.analyte_id,
      parameter: calc.parameter,
      value: calc.value,
      unit: calc.unit || '',
      reference_range: calc.reference_range || '',
      is_auto_calculated: true,
      calculation_inputs: calc.calculation_inputs,
      calculated_at: calc.calculated_at,
      verify_status: 'pending'
    }));

    // Upsert to handle recalculations
    const { error } = await supabase
      .from('result_values')
      .upsert(upsertData, {
        onConflict: 'result_id,analyte_id',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('Failed to save calculated values:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  },

  /**
   * Trigger recalculation when a source value changes
   * Called by result entry/verification components
   */
  async triggerRecalculation(
    resultId: string,
    orderId: string,
    testGroupId: string,
    labId: string,
    patientData?: PatientData
  ): Promise<CalculationResult[]> {
    // Fetch current result values
    const { data: currentValues, error } = await supabase
      .from('result_values')
      .select('*')
      .eq('result_id', resultId)
      .eq('is_auto_calculated', false); // Only get manually entered values

    if (error) {
      console.error('Failed to fetch current values for recalculation:', error);
      return [];
    }

    const resultValues: ResultValue[] = (currentValues || []).map((rv: any) => ({
      id: rv.id,
      analyte_id: rv.analyte_id,
      parameter: rv.parameter,
      value: rv.value,
      unit: rv.unit,
      reference_range: rv.reference_range,
      flag: rv.flag
    }));

    // Compute new calculated values
    const calculations = await this.computeCalculatedValues(resultValues, testGroupId, patientData);

    // Save successful calculations
    await this.saveCalculatedValues(resultId, orderId, testGroupId, labId, calculations);

    return calculations;
  },

  /**
   * Check if an analyte has dependents (other calculated analytes that use it)
   * Used to determine if recalculation is needed when a value changes
   */
  async hasDependents(analyteId: string): Promise<boolean> {
    const { count, error } = await supabase
      .from('analyte_dependencies')
      .select('*', { count: 'exact', head: true })
      .eq('source_analyte_id', analyteId);

    return !error && (count || 0) > 0;
  },

  /**
   * Get all analytes that depend on a given analyte
   * Used for cascade recalculation
   */
  async getDependentAnalytes(sourceAnalyteId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('analyte_dependencies')
      .select('calculated_analyte_id')
      .eq('source_analyte_id', sourceAnalyteId);

    if (error || !data) return [];
    return data.map(d => d.calculated_analyte_id);
  }
};

// ============================================
// COMMON MEDICAL FORMULAS (Reference)
// ============================================

/**
 * Example formulas that can be stored in analytes.formula:
 * 
 * LDL Cholesterol (Friedewald):
 *   formula: "TC - HDL - (TG / 5)"
 *   variables: ["TC", "HDL", "TG"]
 *   Note: Only valid when TG < 400 mg/dL
 * 
 * MCHC:
 *   formula: "(HGB / HCT) * 100"
 *   variables: ["HGB", "HCT"]
 * 
 * A/G Ratio:
 *   formula: "ALB / GLOB"
 *   variables: ["ALB", "GLOB"]
 *   Note: GLOB = Total Protein - Albumin
 * 
 * eGFR (CKD-EPI simplified for demo):
 *   formula: "142 * (CREAT / 0.9) ^ (-1.2) * 0.9938 ^ AGE * (GENDER_FEMALE == 1 ? 1.012 : 1)"
 *   variables: ["CREAT", "AGE", "GENDER_FEMALE"]
 *   Note: Actual CKD-EPI is more complex
 * 
 * Non-HDL Cholesterol:
 *   formula: "TC - HDL"
 *   variables: ["TC", "HDL"]
 * 
 * VLDL Cholesterol:
 *   formula: "TG / 5"
 *   variables: ["TG"]
 * 
 * Corrected Calcium:
 *   formula: "CA + 0.8 * (4 - ALB)"
 *   variables: ["CA", "ALB"]
 */

export default calculationEngine;
