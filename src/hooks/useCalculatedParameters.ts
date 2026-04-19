/**
 * Hook for integrating calculated parameters into result entry/verification
 * 
 * Provides automatic recalculation when source values change and
 * visual indicators for calculated fields.
 */

import { useState, useCallback, useEffect } from 'react';
import calculationEngine, { 
  CalculationResult, 
  ResultValue, 
  PatientData,
  CalculatedAnalyte 
} from '../utils/calculationEngine';

interface UseCalculatedParametersOptions {
  testGroupId: string;
  resultId?: string;
  orderId?: string;
  labId?: string;
  patientData?: PatientData;
  autoRecalculate?: boolean; // Default true - recalculate when values change
}

interface UseCalculatedParametersReturn {
  // State
  calculatedValues: CalculationResult[];
  calculatedAnalytes: CalculatedAnalyte[];
  isCalculating: boolean;
  error: string | null;
  
  // Actions
  calculate: (inputValues: ResultValue[]) => Promise<CalculationResult[]>;
  saveCalculations: () => Promise<{ success: boolean; error?: string }>;
  checkIfCalculated: (analyteId: string) => boolean;
  getCalculatedValue: (analyteId: string) => CalculationResult | undefined;
  
  // Helpers
  shouldRecalculate: (changedAnalyteId: string) => Promise<boolean>;
}

export function useCalculatedParameters(
  options: UseCalculatedParametersOptions
): UseCalculatedParametersReturn {
  const { 
    testGroupId, 
    resultId, 
    orderId, 
    labId, 
    patientData,
    autoRecalculate = true 
  } = options;

  const [calculatedValues, setCalculatedValues] = useState<CalculationResult[]>([]);
  const [calculatedAnalytes, setCalculatedAnalytes] = useState<CalculatedAnalyte[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load calculated analytes for this test group on mount
  useEffect(() => {
    const loadCalculatedAnalytes = async () => {
      try {
        const analytes = await calculationEngine.getCalculatedAnalytesForTestGroup(testGroupId);
        setCalculatedAnalytes(analytes);
      } catch (err) {
        console.error('Failed to load calculated analytes:', err);
      }
    };

    if (testGroupId) {
      loadCalculatedAnalytes();
    }
  }, [testGroupId]);

  /**
   * Calculate all calculated parameters from input values
   */
  const calculate = useCallback(async (inputValues: ResultValue[]): Promise<CalculationResult[]> => {
    if (!testGroupId) {
      setError('Test group ID is required');
      return [];
    }

    setIsCalculating(true);
    setError(null);

    try {
      const results = await calculationEngine.computeCalculatedValues(
        inputValues,
        testGroupId,
        patientData,
        labId
      );
      setCalculatedValues(results);
      return results;
    } catch (err: any) {
      const errorMsg = err.message || 'Calculation failed';
      setError(errorMsg);
      console.error('Calculation error:', err);
      return [];
    } finally {
      setIsCalculating(false);
    }
  }, [testGroupId, patientData]);

  /**
   * Save calculated values to database
   */
  const saveCalculations = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!resultId || !orderId || !labId) {
      return { success: false, error: 'Missing required IDs (result, order, or lab)' };
    }

    const successfulCalcs = calculatedValues.filter(c => c.success);
    if (successfulCalcs.length === 0) {
      return { success: true }; // Nothing to save
    }

    try {
      return await calculationEngine.saveCalculatedValues(
        resultId,
        orderId,
        testGroupId,
        labId,
        calculatedValues
      );
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to save calculations' };
    }
  }, [resultId, orderId, testGroupId, labId, calculatedValues]);

  /**
   * Check if an analyte is a calculated parameter
   */
  const checkIfCalculated = useCallback((analyteId: string): boolean => {
    return calculatedAnalytes.some(a => a.id === analyteId);
  }, [calculatedAnalytes]);

  /**
   * Get calculated value for a specific analyte
   */
  const getCalculatedValue = useCallback((analyteId: string): CalculationResult | undefined => {
    return calculatedValues.find(c => c.analyte_id === analyteId);
  }, [calculatedValues]);

  /**
   * Check if changing a specific analyte should trigger recalculation
   */
  const shouldRecalculate = useCallback(async (changedAnalyteId: string): Promise<boolean> => {
    if (!autoRecalculate) return false;
    return await calculationEngine.hasDependents(changedAnalyteId, labId);
  }, [autoRecalculate, labId]);

  return {
    calculatedValues,
    calculatedAnalytes,
    isCalculating,
    error,
    calculate,
    saveCalculations,
    checkIfCalculated,
    getCalculatedValue,
    shouldRecalculate
  };
}

/**
 * Example usage in a result entry component:
 * 
 * ```tsx
 * function ResultEntryForm({ testGroupId, resultId, orderId, labId, patient }) {
 *   const [values, setValues] = useState<ResultValue[]>([]);
 *   
 *   const {
 *     calculatedValues,
 *     calculatedAnalytes,
 *     isCalculating,
 *     calculate,
 *     saveCalculations,
 *     checkIfCalculated,
 *     getCalculatedValue
 *   } = useCalculatedParameters({
 *     testGroupId,
 *     resultId,
 *     orderId,
 *     labId,
 *     patientData: patient ? {
 *       age: patient.age,
 *       gender: patient.gender
 *     } : undefined
 *   });
 * 
 *   // Recalculate when values change
 *   useEffect(() => {
 *     if (values.length > 0) {
 *       calculate(values);
 *     }
 *   }, [values, calculate]);
 * 
 *   // Handle value change
 *   const handleValueChange = async (analyteId: string, newValue: string) => {
 *     setValues(prev => prev.map(v => 
 *       v.analyte_id === analyteId ? { ...v, value: newValue } : v
 *     ));
 *   };
 * 
 *   // Save on submit
 *   const handleSubmit = async () => {
 *     // Save manual values first, then calculated
 *     await saveManualValues(values);
 *     await saveCalculations();
 *   };
 * 
 *   return (
 *     <div>
 *       {analytes.map(analyte => {
 *         const isCalculated = checkIfCalculated(analyte.id);
 *         const calcResult = getCalculatedValue(analyte.id);
 *         
 *         return (
 *           <div key={analyte.id}>
 *             <label>{analyte.name}</label>
 *             {isCalculated ? (
 *               <div className="calculated-field">
 *                 <span>{calcResult?.value || '-'}</span>
 *                 <span className="badge">Calculated</span>
 *                 {calcResult?.error && (
 *                   <span className="error">{calcResult.error}</span>
 *                 )}
 *               </div>
 *             ) : (
 *               <input
 *                 value={values.find(v => v.analyte_id === analyte.id)?.value || ''}
 *                 onChange={e => handleValueChange(analyte.id, e.target.value)}
 *               />
 *             )}
 *           </div>
 *         );
 *       })}
 *       {isCalculating && <span>Calculating...</span>}
 *     </div>
 *   );
 * }
 * ```
 */

export default useCalculatedParameters;
