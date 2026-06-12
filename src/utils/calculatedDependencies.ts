export interface CalculatedDependency {
  calculated_analyte_id: string;
  calculated_lab_analyte_id?: string | null;
  source_analyte_id: string;
  source_lab_analyte_id?: string | null;
  variable_name: string;
  lab_id?: string | null;
}

const normalizeVariable = (value: string) => value.trim().toUpperCase();

export const selectPreferredCalculatedDependencies = <T extends CalculatedDependency>(
  dependencies: T[],
  calculatedAnalyteId?: string | null,
  calculatedLabAnalyteId?: string | null,
  availableSourceIds?: ReadonlySet<string>,
): T[] => {
  const exact = calculatedLabAnalyteId
    ? dependencies.filter((dependency) => dependency.calculated_lab_analyte_id === calculatedLabAnalyteId)
    : [];
  const candidates = exact.length > 0
    ? exact
    : dependencies.filter(
        (dependency) =>
          !dependency.calculated_lab_analyte_id &&
          dependency.calculated_analyte_id === calculatedAnalyteId,
      );

  const preferredByVariable = new Map<string, T>();
  for (const dependency of candidates) {
    const key = normalizeVariable(dependency.variable_name);
    const current = preferredByVariable.get(key);
    if (!current) {
      preferredByVariable.set(key, dependency);
      continue;
    }

    const score = (row: T) => {
      const sourceIsAvailable = !!availableSourceIds && (
        availableSourceIds.has(row.source_analyte_id) ||
        (!!row.source_lab_analyte_id && availableSourceIds.has(row.source_lab_analyte_id))
      );
      return (sourceIsAvailable ? 100 : 0) + (row.source_lab_analyte_id ? 10 : 0);
    };

    if (score(dependency) > score(current)) {
      preferredByVariable.set(key, dependency);
    }
  }

  return Array.from(preferredByVariable.values());
};

export const dedupeDependenciesForSave = <
  T extends Pick<CalculatedDependency, 'source_analyte_id' | 'source_lab_analyte_id' | 'variable_name'>
>(dependencies: T[]): T[] => {
  const preferredByVariable = new Map<string, T>();
  for (const dependency of dependencies) {
    const key = normalizeVariable(dependency.variable_name);
    const current = preferredByVariable.get(key);
    if (!current || (!current.source_lab_analyte_id && dependency.source_lab_analyte_id)) {
      preferredByVariable.set(key, dependency);
    }
  }
  return Array.from(preferredByVariable.values());
};
