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
  lab_analyte_id?: string | null;
  name: string;
  formula: string;
  formula_variables: string[] | string | null;
  formula_description?: string;
  unit?: string;
  reference_range?: string;
  category?: string;
  code?: string;
  value_type?: string;
}

export interface AnalyteDependency {
  calculated_analyte_id?: string;
  calculated_lab_analyte_id?: string | null;
  source_analyte_id: string;
  source_lab_analyte_id?: string | null;
  source_name: string;
  variable_name: string;
  lab_id?: string | null;
}

export interface ResultValue {
  id?: string;
  analyte_id?: string;
  lab_analyte_id?: string | null;
  parameter: string;
  value: string;
  unit?: string;
  reference_range?: string;
  flag?: string;
  is_auto_calculated?: boolean;
  is_calculated?: boolean;
  isCalculated?: boolean;
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
  lab_analyte_id?: string | null;
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

const parseFormulaVariables = (formulaVariables: string[] | string | null | undefined): string[] => {
  if (!formulaVariables) return [];
  if (Array.isArray(formulaVariables)) return formulaVariables.filter(Boolean);
  try {
    const parsed = JSON.parse(formulaVariables);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
};

const toVariableSlug = (name: string): string => {
  const abbrevMap: Record<string, string> = {
    'total cholesterol': 'TC',
    'hdl cholesterol': 'HDL',
    'ldl cholesterol': 'LDL',
    'triglycerides': 'TG',
    'hemoglobin': 'HGB',
    'hematocrit': 'HCT',
    'red blood cell': 'RBC',
    'white blood cell': 'WBC',
    'platelet': 'PLT',
    'mean corpuscular volume': 'MCV',
    'mean corpuscular hemoglobin': 'MCH',
    'albumin': 'ALB',
    'globulin': 'GLOB',
    'total protein': 'TP',
    'creatinine': 'CREAT',
    'blood urea nitrogen': 'BUN',
    'urea': 'UREA',
    'glucose': 'GLU',
    'calcium': 'CA',
    'sodium': 'NA',
    'potassium': 'K',
  };
  const lower = name.toLowerCase();
  for (const [full, abbrev] of Object.entries(abbrevMap)) {
    if (lower.includes(full)) return abbrev.toLowerCase();
  }
  const words = name.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].substring(0, 4).toLowerCase();
  return words.map((word) => word.substring(0, 3)).join('').toLowerCase().substring(0, 6);
};

const getVariableAliases = (name: string): string[] => {
  const lower = String(name || '').toLowerCase().trim();
  const aliases = new Set<string>();
  const push = (value?: string | null) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized) aliases.add(normalized);
  };
  const hasWord = (word: string) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower);
  const isAbsoluteCount =
    /\b(abs|absolute)\b/i.test(lower) ||
    /\bcount\b/i.test(lower) ||
    /\bconcentration\b/i.test(lower);
  const isDerivedCbcMetric =
    lower.includes('mean corpuscular') ||
    lower.includes('distribution width') ||
    lower.includes('ratio');

  push(toVariableSlug(name));

  if (hasWord('hemoglobin') && !isDerivedCbcMetric) push('hgb');
  if (hasWord('hematocrit')) push('hct');
  if (lower.includes('red blood cell')) push('rbc');
  if (lower.includes('mean corpuscular volume')) push('mcv');
  if (lower.includes('mean corpuscular hemoglobin concentration')) push('mchc');
  if (lower.includes('mean corpuscular hemoglobin')) push('mch');

  if (
    lower.includes('total wbc count') ||
    lower.includes('total leukocyte count') ||
    lower.includes('total white blood cell count') ||
    lower.includes('wbc count')
  ) {
    push('totwbc');
    push('twbc');
    push('tlc');
    push('wbc');
    push('twc');
  }

    if (lower.includes('lymphocyte') && !isAbsoluteCount) {
      push('lym');
      push('lymph');
      push('lymphocytes');
    }
    if (lower.includes('neutrophil') && !isAbsoluteCount) {
      push('neu');
      push('neut');
      push('neutrophils');
    }
    if (lower.includes('monocyte') && !isAbsoluteCount) {
      push('mono');
      push('mon');
      push('monocytes');
    }
    if (lower.includes('eosinophil') && !isAbsoluteCount) {
      push('eos');
      push('eosin');
      push('eosinophils');
    }
    if (lower.includes('basophil') && !isAbsoluteCount) {
      push('baso');
      push('bas');
      push('basophils');
    }
  if (lower.includes('polymorph')) {
    push('poly');
    push('pmn');
    push('neut');
  }

  return [...aliases];
};

const resolveNumericValueFromLookup = (
  valueMap: Record<string, number>,
  key: string,
  sourceName?: string,
): number | undefined => {
  const directCandidates = [
    key,
    key.toUpperCase(),
    key.toLowerCase(),
    toVariableSlug(key),
  ];

  for (const candidate of directCandidates) {
    if (!candidate) continue;
    const resolved = valueMap[candidate];
    if (resolved !== undefined) return resolved;
  }

  if (sourceName) {
    const nameCandidates = [
      sourceName,
      sourceName.toUpperCase(),
      sourceName.toLowerCase(),
      ...getVariableAliases(sourceName),
    ];
    for (const candidate of nameCandidates) {
      if (!candidate) continue;
      const resolved = valueMap[candidate];
      if (resolved !== undefined) return resolved;
    }
  }

  return undefined;
};

const normalizeFormula = (formula: string) =>
  formula.replace(/\(([^()]+)\)\s*\^\s*\(([^()]+)\)/g, 'pow($1, $2)').replace(
    /([A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?)\s*\^\s*([A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?)/g,
    'pow($1, $2)',
  );

const buildValueLookup = (resultValues: ResultValue[], patientData?: PatientData) => {
  const valueMap: Record<string, number> = {};

  for (const rv of resultValues) {
    if (rv.is_auto_calculated || rv.is_calculated || rv.isCalculated) continue;
    if (!rv.value || Number.isNaN(parseFloat(rv.value))) continue;

    const value = parseFloat(rv.value);
    valueMap[rv.parameter.toUpperCase()] = value;
    valueMap[rv.parameter.toLowerCase()] = value;
    valueMap[rv.parameter] = value;
    const slug = toVariableSlug(rv.parameter);
    if (slug) valueMap[slug] = value;
    for (const alias of getVariableAliases(rv.parameter)) {
      valueMap[alias] = value;
      valueMap[alias.toUpperCase()] = value;
    }
    if (rv.analyte_id) valueMap[rv.analyte_id] = value;
    if (rv.lab_analyte_id) valueMap[rv.lab_analyte_id] = value;
  }

  if (patientData) {
    valueMap.AGE = patientData.age;
    valueMap.age = patientData.age;
    valueMap.GENDER = patientData.gender === 'Male' ? 1 : patientData.gender === 'Female' ? 0 : 0.5;
    valueMap.gender = valueMap.GENDER;
    valueMap.GENDER_MALE = patientData.gender === 'Male' ? 1 : 0;
    valueMap.gender_male = valueMap.GENDER_MALE;
    valueMap.GENDER_FEMALE = patientData.gender === 'Female' ? 1 : 0;
    valueMap.gender_female = valueMap.GENDER_FEMALE;
    if (patientData.weight_kg) {
      valueMap.WEIGHT = patientData.weight_kg;
      valueMap.weight = patientData.weight_kg;
    }
    if (patientData.height_cm) {
      valueMap.HEIGHT = patientData.height_cm;
      valueMap.height = patientData.height_cm;
    }
  }

  return valueMap;
};

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
        lab_analyte_id,
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
        ),
        lab_analytes(
          id,
          formula,
          formula_variables,
          unit,
          reference_range,
          lab_specific_reference_range,
          is_calculated
        )
      `)
      .eq('test_group_id', testGroupId);

    if (error || !data) return [];

    return data.map((item: any) => {
      const a = item.analytes;
      const la = item.lab_analyte_id ? item.lab_analytes : null;
      return {
        id: a.id,
        lab_analyte_id: item.lab_analyte_id || la?.id || null,
        name: a.name,
        formula: la?.formula ?? a.formula,
        formula_variables: la?.formula_variables ?? a.formula_variables ?? [],
        formula_description: a.formula_description,
        unit: la?.unit ?? a.unit,
        reference_range: la?.lab_specific_reference_range ?? la?.reference_range ?? a.reference_range,
        category: a.category
      };
    }).filter((item: any) => !!item.formula);
  },

  /**
   * Fetch dependencies for a calculated analyte
   */
  async getDependencies(
    calculatedAnalyteId: string,
    labId?: string,
    calculatedLabAnalyteId?: string | null,
  ): Promise<AnalyteDependency[]> {
    let query = supabase
      .from('analyte_dependencies')
      .select(`
        source_analyte_id,
        source_lab_analyte_id,
        variable_name,
        analytes!analyte_dependencies_source_analyte_id_fkey(name),
        source_lab_analyte:lab_analytes!analyte_dependencies_source_lab_analyte_id_fkey(name)
      `);

    if (calculatedLabAnalyteId) {
      query = query.or(
        `calculated_lab_analyte_id.eq.${calculatedLabAnalyteId},and(calculated_lab_analyte_id.is.null,calculated_analyte_id.eq.${calculatedAnalyteId})`,
      );
    } else {
      query = query.eq('calculated_analyte_id', calculatedAnalyteId);
    }

    if (labId) {
      query = query.or(`lab_id.eq.${labId},lab_id.is.null`);
    }

    const { data, error } = await query;

    if (error || !data) return [];

    return data.map((item: any) => ({
      calculated_analyte_id: calculatedAnalyteId,
      calculated_lab_analyte_id: calculatedLabAnalyteId || null,
      source_analyte_id: item.source_analyte_id,
      source_lab_analyte_id: item.source_lab_analyte_id || null,
      source_name: item.source_lab_analyte?.name || item.analytes?.name || '',
      variable_name: item.variable_name,
    }));
  },

    async getDependenciesForCalculatedAnalytes(
      calculatedAnalytes: Pick<CalculatedAnalyte, 'id' | 'lab_analyte_id'>[],
      labId?: string,
    ): Promise<AnalyteDependency[]> {
    const calculatedIds = [...new Set(calculatedAnalytes.map((item) => item.id).filter(Boolean))];
    if (calculatedIds.length === 0) return [];

    let query = supabase
      .from('analyte_dependencies')
      .select(`
        calculated_analyte_id,
        calculated_lab_analyte_id,
        source_analyte_id,
        source_lab_analyte_id,
        variable_name,
        lab_id,
        analytes!analyte_dependencies_source_analyte_id_fkey(name),
        source_lab_analyte:lab_analytes!analyte_dependencies_source_lab_analyte_id_fkey(name)
      `)
      .in('calculated_analyte_id', calculatedIds);

    if (labId) {
      query = query.or(`lab_id.eq.${labId},lab_id.is.null`);
    }

    const { data, error } = await query;
    if (error || !data) return [];

    const preferredKeys = new Set(
      calculatedAnalytes
        .map((item) => item.lab_analyte_id)
        .filter((value): value is string => !!value),
    );

    const scored = [...data].sort((left: any, right: any) => {
      const leftExact = left.calculated_lab_analyte_id && preferredKeys.has(left.calculated_lab_analyte_id) ? 1 : 0;
      const rightExact = right.calculated_lab_analyte_id && preferredKeys.has(right.calculated_lab_analyte_id) ? 1 : 0;
      if (leftExact !== rightExact) return rightExact - leftExact;
      const leftLabSpecific = left.lab_id ? 1 : 0;
      const rightLabSpecific = right.lab_id ? 1 : 0;
      return rightLabSpecific - leftLabSpecific;
    });

      const deduped: AnalyteDependency[] = [];
      const seen = new Set<string>();
      for (const item of scored as any[]) {
        const calculationKey = item.calculated_lab_analyte_id || item.calculated_analyte_id;
        const key = `${calculationKey}:${String(item.variable_name || '').toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push({
        calculated_analyte_id: item.calculated_analyte_id,
        calculated_lab_analyte_id: item.calculated_lab_analyte_id || null,
        source_analyte_id: item.source_analyte_id,
        source_lab_analyte_id: item.source_lab_analyte_id || null,
        source_name: item.source_lab_analyte?.name || item.analytes?.name || '',
        variable_name: item.variable_name,
        lab_id: item.lab_id || null,
        });
      }

      console.log('[calculationEngine] Loaded dependencies for calculated analytes', {
        labId: labId || null,
        requestedCalculatedAnalytes: calculatedAnalytes.map((analyte) => ({
          analyteId: analyte.id,
          labAnalyteId: analyte.lab_analyte_id || null,
        })),
        dependencyCount: deduped.length,
        dependencies: deduped.map((dep) => ({
          calculatedAnalyteId: dep.calculated_analyte_id || null,
          calculatedLabAnalyteId: dep.calculated_lab_analyte_id || null,
          sourceAnalyteId: dep.source_analyte_id,
          sourceLabAnalyteId: dep.source_lab_analyte_id || null,
          variableName: dep.variable_name,
          sourceName: dep.source_name || '',
          labId: dep.lab_id || null,
        })),
      });

      return deduped;
    },

  computeCalculatedValuesFromDefinitions(
    resultValues: ResultValue[],
    calculatedAnalytes: CalculatedAnalyte[],
    dependencies: AnalyteDependency[],
    patientData?: PatientData,
  ): CalculationResult[] {
    if (calculatedAnalytes.length === 0) return [];

    const valueMap = buildValueLookup(resultValues, patientData);
    const results: CalculationResult[] = [];
    const analyteById = new Map(calculatedAnalytes.map((analyte) => [analyte.id, analyte]));
    const calculatedIdSet = new Set(calculatedAnalytes.map((analyte) => analyte.id));
    const depsByAnalyte = new Map<string, AnalyteDependency[]>();

    for (const analyte of calculatedAnalytes) {
      const exact = analyte.lab_analyte_id
        ? dependencies.filter((dep) => dep.calculated_lab_analyte_id === analyte.lab_analyte_id)
        : [];
      const fallback = dependencies.filter(
        (dep) => !dep.calculated_lab_analyte_id && dep.calculated_analyte_id === analyte.id,
      );
      depsByAnalyte.set(analyte.id, exact.length > 0 ? exact : fallback);
    }

    const sorted: CalculatedAnalyte[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (analyte: CalculatedAnalyte) => {
      if (visited.has(analyte.id) || visiting.has(analyte.id)) return;
      visiting.add(analyte.id);
      const deps = depsByAnalyte.get(analyte.id) || [];
      for (const dep of deps) {
        if (!calculatedIdSet.has(dep.source_analyte_id)) continue;
        const upstream = analyteById.get(dep.source_analyte_id);
        if (upstream) visit(upstream);
      }
      visiting.delete(analyte.id);
      visited.add(analyte.id);
      sorted.push(analyte);
    };

    for (const analyte of calculatedAnalytes) {
      visit(analyte);
    }

    for (const analyte of sorted) {
      const deps = depsByAnalyte.get(analyte.id) || [];
      const vars = parseFormulaVariables(analyte.formula_variables);
      const scope: Record<string, number> = {};
      let allDepsPresent = true;

        if (deps.length > 0) {
          for (const dep of deps) {
            const isSelfDependency =
              dep.source_analyte_id === analyte.id ||
              (!!analyte.lab_analyte_id && dep.source_lab_analyte_id === analyte.lab_analyte_id);
            if (isSelfDependency) {
              allDepsPresent = false;
              break;
            }
            const varName = dep.variable_name;
            const sourceName = dep.source_name || '';
            const hasExplicitSourceRef = !!(dep.source_lab_analyte_id || dep.source_analyte_id);
            const resolvedValue = hasExplicitSourceRef
              ? (
                  (dep.source_lab_analyte_id ? valueMap[dep.source_lab_analyte_id] : undefined) ??
                  valueMap[dep.source_analyte_id]
                )
              : resolveNumericValueFromLookup(valueMap, varName, sourceName);

            if (resolvedValue === undefined || Number.isNaN(resolvedValue)) {
              allDepsPresent = false;
              break;
            }
          scope[varName] = resolvedValue;
        }
      }

      if (deps.length === 0 || allDepsPresent) {
        for (const variable of vars) {
          if (scope[variable] !== undefined) continue;
          const directValue = resolveNumericValueFromLookup(valueMap, variable);
          if (directValue !== undefined) {
            scope[variable] = directValue;
          }
        }
      }

      if (vars.some((variable) => scope[variable] === undefined)) {
        allDepsPresent = false;
      }

      if (!allDepsPresent) {
        const missingVariables = vars.filter((variable) => scope[variable] === undefined);
        console.warn('[calculationEngine] Missing inputs for calculated analyte', {
          analyteId: analyte.id,
          labAnalyteId: analyte.lab_analyte_id || null,
          analyteName: analyte.name,
          formula: analyte.formula,
          variables: vars,
          missingVariables,
          resolvedScope: scope,
            dependencies: deps.map((dep) => ({
              variable: dep.variable_name,
              sourceAnalyteId: dep.source_analyte_id,
              sourceLabAnalyteId: dep.source_lab_analyte_id || null,
              sourceName: dep.source_name || '',
              resolvedValue: dep.source_lab_analyte_id || dep.source_analyte_id
                ? (
                    (dep.source_lab_analyte_id ? valueMap[dep.source_lab_analyte_id] : undefined) ??
                    valueMap[dep.source_analyte_id]
                  )
                : resolveNumericValueFromLookup(valueMap, dep.variable_name, dep.source_name || ''),
            })),
          });
        results.push({
          analyte_id: analyte.id,
          lab_analyte_id: analyte.lab_analyte_id || null,
          parameter: analyte.name,
          value: '',
          unit: analyte.unit,
          reference_range: analyte.reference_range,
          is_auto_calculated: true,
          calculation_inputs: scope,
          calculated_at: new Date().toISOString(),
          formula_used: analyte.formula,
          success: false,
          error: 'Missing required input values',
        });
        continue;
      }

      try {
        const result = evaluate(normalizeFormula(analyte.formula), scope);
        const roundedResult = round(result, 4);
        const resultString = String(roundedResult);

        console.log('[calculationEngine] Calculated analyte result', {
          analyteId: analyte.id,
          labAnalyteId: analyte.lab_analyte_id || null,
          analyteName: analyte.name,
          formula: analyte.formula,
          scope,
          result: resultString,
        });

        results.push({
          analyte_id: analyte.id,
          lab_analyte_id: analyte.lab_analyte_id || null,
          parameter: analyte.name,
          value: resultString,
          unit: analyte.unit,
          reference_range: analyte.reference_range,
          is_auto_calculated: true,
          calculation_inputs: scope,
          calculated_at: new Date().toISOString(),
          formula_used: analyte.formula,
          success: true,
        });

        valueMap[analyte.id] = Number(roundedResult);
        if (analyte.lab_analyte_id) valueMap[analyte.lab_analyte_id] = Number(roundedResult);
        valueMap[analyte.name] = Number(roundedResult);
        valueMap[analyte.name.toLowerCase()] = Number(roundedResult);
        valueMap[analyte.name.toUpperCase()] = Number(roundedResult);
        const slug = toVariableSlug(analyte.name);
        if (slug) valueMap[slug] = Number(roundedResult);
      } catch (err: any) {
        console.error('[calculationEngine] Formula evaluation failed', {
          analyteId: analyte.id,
          labAnalyteId: analyte.lab_analyte_id || null,
          analyteName: analyte.name,
          formula: analyte.formula,
          scope,
          error: err,
        });
        results.push({
          analyte_id: analyte.id,
          lab_analyte_id: analyte.lab_analyte_id || null,
          parameter: analyte.name,
          value: '',
          unit: analyte.unit,
          reference_range: analyte.reference_range,
          is_auto_calculated: true,
          calculation_inputs: scope,
          calculated_at: new Date().toISOString(),
          formula_used: analyte.formula,
          success: false,
          error: err?.message || 'Formula evaluation failed',
        });
      }
    }

    return results;
  },

  /**
   * Compute all calculated values for a set of result values
   * Called after technician saves values or when a source value changes
   */
  async computeCalculatedValues(
    resultValues: ResultValue[],
    testGroupId: string,
    patientData?: PatientData,
    labId?: string,
  ): Promise<CalculationResult[]> {
    // 1. Get calculated analytes for this test group
    const calculatedAnalytes = await this.getCalculatedAnalytesForTestGroup(testGroupId);
    if (calculatedAnalytes.length === 0) return [];

    const dependencies = await this.getDependenciesForCalculatedAnalytes(calculatedAnalytes, labId);
    return this.computeCalculatedValuesFromDefinitions(resultValues, calculatedAnalytes, dependencies, patientData);
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
      lab_analyte_id: calc.lab_analyte_id || null,
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
      lab_analyte_id: rv.lab_analyte_id || null,
      parameter: rv.parameter,
      value: rv.value,
      unit: rv.unit,
      reference_range: rv.reference_range,
      flag: rv.flag
    }));

    // Compute new calculated values
    const calculations = await this.computeCalculatedValues(resultValues, testGroupId, patientData, labId);

    // Save successful calculations
    await this.saveCalculatedValues(resultId, orderId, testGroupId, labId, calculations);

    return calculations;
  },

  /**
   * Check if an analyte has dependents (other calculated analytes that use it)
   * Used to determine if recalculation is needed when a value changes
   */
  async hasDependents(analyteId: string, labId?: string): Promise<boolean> {
    let query = supabase
      .from('analyte_dependencies')
      .select('*', { count: 'exact', head: true })
      .eq('source_analyte_id', analyteId);

    if (labId) {
      query = query.or(`lab_id.eq.${labId},lab_id.is.null`);
    }

    const { count, error } = await query;

    return !error && (count || 0) > 0;
  },

  /**
   * Get all analytes that depend on a given analyte
   * Used for cascade recalculation
   */
  async getDependentAnalytes(sourceAnalyteId: string, labId?: string): Promise<string[]> {
    let query = supabase
      .from('analyte_dependencies')
      .select('calculated_analyte_id')
      .eq('source_analyte_id', sourceAnalyteId);

    if (labId) {
      query = query.or(`lab_id.eq.${labId},lab_id.is.null`);
    }

    const { data, error } = await query;

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
