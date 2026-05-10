// QuickResultEntryModal.tsx
// Fast keyboard-first manual result entry modal.
// No nested popups. Tab/Enter navigates between value cells.
// Reuses same DB schema (results + result_values) as OrderDetailsModal.

import React, { useState, useEffect, useRef, useCallback } from "react";
import ReactDOM from "react-dom";
import { X, Save, CheckCircle, ChevronDown, Loader2, RefreshCw, Eye } from "lucide-react";
import { supabase, database } from "../../utils/supabase";
import { toast } from "react-hot-toast";
import { useAuth } from "../../contexts/AuthContext";
import { calculateFlag, calculateFlagsForResults } from "../../utils/flagCalculation";
import { calculationEngine, type CalculatedAnalyte } from "../../utils/calculationEngine";
import { useEscapeModalClose } from "../../hooks/useEscapeModalClose";
import SectionEditor, { SectionEditorRef, SectionPreviewItem } from "../Results/SectionEditor";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AnalyteRow {
  analyte_id: string;
  lab_analyte_id?: string | null;
  parameter: string;
  value: string;
  unit: string;
  reference: string;
  flag: string;
  is_calculated: boolean;
  is_existing: boolean;
  expected_normal_values: string[];
  expected_value_flag_map: Record<string, string>;
  value_type?: string;
  expected_value_codes?: Record<string, string>;
  default_value?: string;
  is_default?: boolean;
  formula?: string | null;
  formula_variables?: string[] | string | null;
  verify_note?: string;
  is_rerun?: boolean;
}

interface TestGroup {
  test_group_id: string;
  test_group_name: string;
  order_test_group_id: string | null;
  order_test_id: string | null;
  is_section_only?: boolean;
  ref_range_ai_config?: { enabled?: boolean; consider_age?: boolean } | null;
  analytes: {
    id: string;
    lab_analyte_id?: string | null;
    name: string;
    code?: string;
    units?: string;
    reference_range?: string;
    is_calculated?: boolean;
    formula?: string | null;
    formula_variables?: string[] | string | null;
    expected_normal_values?: string[];
    expected_value_flag_map?: Record<string, string>;
    value_type?: string;
    expected_value_codes?: Record<string, string>;
    existing_result?: {
      value: string;
      unit?: string;
      reference_range?: string;
      flag?: string;
      verify_note?: string;
      verify_status?: string;
      analyte_name?: string;
      parameter?: string;
    } | null;
  }[];
}

interface QuickResultEntryModalProps {
  order: {
    id: string;
    lab_id: string;
    patient_name: string;
    patient_id: string;
    patient?: { age?: string | null; gender?: string | null } | null;
    tests: string[];
    sample_id?: string | null;
  };
  onClose: () => void;
  onSubmitted: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_FLAG_OPTIONS = [
  { value: "", label: "Normal" },
  { value: "H", label: "High" },
  { value: "L", label: "Low" },
  { value: "critical_h", label: "Crit. High" },
  { value: "critical_l", label: "Crit. Low" },
  { value: "A", label: "Abnormal" },
];

const hasMeaningfulTextValue = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const toNumber = (raw: string | number | null | undefined): number | null => {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(String(raw).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};

const formatIndianNumber = (value: string): string => {
  const cleaned = value.replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  if (!Number.isFinite(num) || Math.abs(num) < 1000) return cleaned || value.trim();
  return new Intl.NumberFormat('en-IN').format(num);
};

const parseFormulaVars = (fv: string[] | string | null | undefined): string[] => {
  if (!fv) return [];
  if (Array.isArray(fv)) return fv.filter(Boolean);
  try { return JSON.parse(fv).filter(Boolean); } catch { return []; }
};

// Derives a short variable slug from an analyte name (mirrors SimpleAnalyteEditor logic).
// Used as a fallback lookup key so formulas still resolve even if the dependency
// was linked to a different analyte UUID with the same name.
const toVariableSlug = (name: string): string => {
  const abbrevMap: Record<string, string> = {
    'total cholesterol': 'TC', 'hdl cholesterol': 'HDL', 'ldl cholesterol': 'LDL',
    'triglycerides': 'TG', 'hemoglobin': 'HGB', 'hematocrit': 'HCT',
    'red blood cell': 'RBC', 'white blood cell': 'WBC', 'platelet': 'PLT',
    'mean corpuscular volume': 'MCV', 'mean corpuscular hemoglobin': 'MCH',
    'albumin': 'ALB', 'globulin': 'GLOB', 'total protein': 'TP',
    'creatinine': 'CREAT', 'blood urea nitrogen': 'BUN', 'urea': 'UREA',
    'glucose': 'GLU', 'calcium': 'CA', 'sodium': 'NA', 'potassium': 'K',
  };
  const lower = name.toLowerCase();
  for (const [full, abbrev] of Object.entries(abbrevMap)) {
    if (lower.includes(full)) return abbrev.toLowerCase();
  }
  const words = name.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/);
  if (words.length === 1) return words[0].substring(0, 4).toLowerCase();
  return words.map(w => w.substring(0, 3)).join('').toLowerCase().substring(0, 6);
};

  function evalFormula(
  formula: string,
  vars: string[],
  valueLookup: Map<string, number>,
  deps: { calculated_analyte_id: string; calculated_lab_analyte_id?: string | null; source_analyte_id: string; source_lab_analyte_id?: string | null; variable_name: string }[],
  analyteId: string,
  labAnalyteId?: string | null,
): string {
  let resolved = formula.trim();
  const analyteSliceDeps = deps.filter(d =>
    (labAnalyteId && d.calculated_lab_analyte_id === labAnalyteId) ||
    (!d.calculated_lab_analyte_id && d.calculated_analyte_id === analyteId)
  );

  for (const variable of vars) {
    const key = variable.toLowerCase();
    const dep = analyteSliceDeps.find(d => d.variable_name.toLowerCase() === key);
    let val: number | undefined = dep?.source_lab_analyte_id ? valueLookup.get(dep.source_lab_analyte_id) : undefined;
    if (val === undefined) val = dep ? valueLookup.get(dep.source_analyte_id) : undefined;
    if (val === undefined) val = valueLookup.get(key);
    if (val === undefined) return "";
    resolved = resolved.replace(new RegExp(`\\b${variable}\\b`, "g"), String(val));
  }

  // Normalize formula for plain-JS eval:
  // 1. pow(x,y) → Math.pow(x,y)  (mathjs syntax not valid in JS)
  // 2. x^y     → x**y            (^ is XOR in JS, not exponentiation)
  resolved = resolved
    .replace(/\bpow\s*\(/g, 'Math.pow(')
    .replace(/\^/g, '**');

  try {
    // eslint-disable-next-line no-new-func
    const result = new Function(`return (${resolved})`)();
    return typeof result === "number" && Number.isFinite(result)
      ? String(Math.round(result * 100) / 100)
      : "";
  } catch { return ""; }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safeUuid = (v: string | null | undefined) => (v && UUID_RE.test(v) ? v : null);

const getGroupKey = (tg: Pick<TestGroup, "test_group_id" | "order_test_group_id" | "order_test_id">) => {
  if (tg.order_test_group_id) return `otg:${tg.order_test_group_id}`;
  if (tg.order_test_id) return `ot:${tg.order_test_id}`;
  return `tg:${tg.test_group_id}`;
};

// ─── Component ───────────────────────────────────────────────────────────────

const QuickResultEntryModal: React.FC<QuickResultEntryModalProps> = ({ order, onClose, onSubmitted }) => {
  const { user } = useAuth();

    type DepRow = { calculated_analyte_id: string; calculated_lab_analyte_id?: string | null; source_analyte_id: string; source_lab_analyte_id?: string | null; variable_name: string };

  const [loading, setLoading] = useState(true);
  const [testGroups, setTestGroups] = useState<TestGroup[]>([]);
  const [rows, setRows] = useState<AnalyteRow[]>([]);
  const [calcDeps, setCalcDeps] = useState<DepRow[]>([]);
  const [flagOptions, setFlagOptions] = useState(DEFAULT_FLAG_OPTIONS);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  // result row IDs per test_group_id — needed to render SectionEditor
  const [resultIds, setResultIds] = useState<Map<string, string>>(new Map());
  // Preview modal state
  const [previewGroupId, setPreviewGroupId] = useState<string | null>(null);
  const [previewItems, setPreviewItems] = useState<Map<string, SectionPreviewItem[]>>(new Map());

  useEscapeModalClose(onClose, !previewGroupId);
  useEscapeModalClose(() => setPreviewGroupId(null), !!previewGroupId);

  // Flat refs for every value input/select in render order (for keyboard nav)
  const valueRefs = useRef<(HTMLInputElement | HTMLSelectElement | null)[]>([]);
  const modalBodyRef = useRef<HTMLDivElement | null>(null);
  // Refs to SectionEditor instances keyed by test_group_id — used to save on Done
  const sectionEditorRefs = useRef<Map<string, React.RefObject<SectionEditorRef>>>(new Map());
  const getSectionEditorRef = (testGroupId: string) => {
    if (!sectionEditorRefs.current.has(testGroupId)) {
      sectionEditorRefs.current.set(testGroupId, React.createRef<SectionEditorRef>());
    }
    return sectionEditorRefs.current.get(testGroupId)!;
  };

  const getPatientData = useCallback(() => {
    const age = order.patient?.age ? Number(order.patient.age) : null;
    if (age === null || !Number.isFinite(age)) return undefined;
    const gender = order.patient?.gender === "Female"
      ? "Female"
      : order.patient?.gender === "Male"
        ? "Male"
        : "Other";
    return { age, gender } as const;
  }, [order.patient]);

  const recalculateRowsWithSharedEngine = useCallback((
    rowSet: AnalyteRow[],
    groupsSource: TestGroup[] = testGroups,
    dependencies: DepRow[] = calcDeps,
    changedSource?: { analyteId?: string; labAnalyteId?: string | null },
  ) => {
    if (groupsSource.length === 0) return rowSet;

    const nextRows = [...rowSet];
    let hasChanges = false;

    for (const tg of groupsSource) {
      const allCalculatedDefs: CalculatedAnalyte[] = tg.analytes
        .filter((analyte) => !!analyte.is_calculated && !!analyte.formula)
        .map((analyte) => ({
          id: analyte.id,
          lab_analyte_id: analyte.lab_analyte_id || null,
          name: analyte.name,
          formula: analyte.formula || "",
          formula_variables: analyte.formula_variables ?? [],
          unit: analyte.units || "",
          reference_range: analyte.reference_range || "",
          code: analyte.code,
          value_type: analyte.value_type,
        }));
      if (allCalculatedDefs.length === 0) continue;

      let calculatedDefs = allCalculatedDefs;
      if (changedSource && (changedSource.analyteId || changedSource.labAnalyteId)) {
        const availableAnalyteIds = new Set<string>();
        const availableLabAnalyteIds = new Set<string>();
        if (changedSource.analyteId) availableAnalyteIds.add(changedSource.analyteId);
        if (changedSource.labAnalyteId) availableLabAnalyteIds.add(changedSource.labAnalyteId);

        const remaining = [...allCalculatedDefs];
        const impacted: CalculatedAnalyte[] = [];
        let advanced = true;

        while (advanced) {
          advanced = false;
          for (let index = remaining.length - 1; index >= 0; index -= 1) {
            const candidate = remaining[index];
            const candidateDeps = candidate.lab_analyte_id
              ? dependencies.filter((dep) => dep.calculated_lab_analyte_id === candidate.lab_analyte_id)
              : [];
            const fallbackDeps = dependencies.filter(
              (dep) => !dep.calculated_lab_analyte_id && dep.calculated_analyte_id === candidate.id,
            );
            const depsForCandidate = candidateDeps.length > 0 ? candidateDeps : fallbackDeps;

            if (depsForCandidate.length === 0) {
              impacted.push(candidate);
              if (candidate.id) availableAnalyteIds.add(candidate.id);
              if (candidate.lab_analyte_id) availableLabAnalyteIds.add(candidate.lab_analyte_id);
              remaining.splice(index, 1);
              advanced = true;
              continue;
            }

            const isImpacted = depsForCandidate.some((dep) =>
              availableAnalyteIds.has(dep.source_analyte_id) ||
              (!!dep.source_lab_analyte_id && availableLabAnalyteIds.has(dep.source_lab_analyte_id))
            );

            if (!isImpacted) continue;

            impacted.push(candidate);
            if (candidate.id) availableAnalyteIds.add(candidate.id);
            if (candidate.lab_analyte_id) availableLabAnalyteIds.add(candidate.lab_analyte_id);
            remaining.splice(index, 1);
            advanced = true;
          }
        }

        calculatedDefs = impacted;
      }

      if (calculatedDefs.length === 0) continue;

      const analyteIds = new Set(tg.analytes.map((analyte) => analyte.id));
      const groupResults = nextRows
        .filter((row) => analyteIds.has(row.analyte_id))
        .map((row) => ({
          analyte_id: row.analyte_id,
          lab_analyte_id: row.lab_analyte_id || null,
          parameter: row.parameter,
          value: row.value.replace(/,/g, ""),
          unit: row.unit,
          reference_range: row.reference,
          flag: row.flag,
          is_calculated: row.is_calculated,
          is_auto_calculated: row.is_calculated,
        }));

      const calculations = calculationEngine.computeCalculatedValuesFromDefinitions(
        groupResults,
        calculatedDefs,
        dependencies,
        getPatientData(),
      );

      for (const calculation of calculations) {
        if (!calculation.success || !hasMeaningfulTextValue(calculation.value)) continue;
        const rowIndex = nextRows.findIndex((row) =>
          (calculation.lab_analyte_id && row.lab_analyte_id === calculation.lab_analyte_id) ||
          row.analyte_id === calculation.analyte_id,
        );
        if (rowIndex === -1) continue;
        const currentRow = nextRows[rowIndex];
        const autoFlag = calculateFlag(
          calculation.value,
          currentRow.reference,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          currentRow.value_type,
        );
        const nextValue = formatIndianNumber(calculation.value);
        const nextFlag = autoFlag || currentRow.flag;
        if (currentRow.value !== nextValue || currentRow.flag !== nextFlag) {
          nextRows[rowIndex] = {
            ...currentRow,
            value: nextValue,
            flag: nextFlag,
          };
          hasChanges = true;
        }
      }
    }

    return hasChanges ? nextRows : rowSet;
  }, [calcDeps, getPatientData, testGroups]);

  // ── Data loading ────────────────────────────────────────────────────────────

  useEffect(() => {
    loadData();
    loadFlagOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  const loadFlagOptions = async () => {
    try {
      const { data } = await supabase.from("labs").select("flag_options").eq("id", order.lab_id).single();
      if (data?.flag_options?.length) setFlagOptions(data.flag_options);
    } catch { /* keep defaults */ }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("orders")
        .select(`
          id, lab_id, patient_id, patient_name,
          order_test_groups(
            id, test_group_id, test_name,
            test_groups(
              id, name, is_section_only, ref_range_ai_config,
              test_group_analytes(
                analyte_id, lab_analyte_id, sort_order, display_order,
                analytes(id, name, code, unit, reference_range, is_calculated, formula, formula_variables, expected_normal_values, expected_value_flag_map, value_type, expected_value_codes),
                lab_analytes(id, name, unit, reference_range, lab_specific_reference_range, is_calculated, formula, formula_variables, expected_normal_values, expected_value_flag_map, value_type, expected_value_codes, default_value)
              )
            )
          ),
          order_tests(
            id, test_name, test_group_id, is_canceled, outsourced_lab_id,
            test_groups(
              id, name, is_section_only, ref_range_ai_config,
              test_group_analytes(
                analyte_id, lab_analyte_id, sort_order, display_order,
                analytes(id, name, code, unit, reference_range, is_calculated, formula, formula_variables, expected_normal_values, expected_value_flag_map, value_type, expected_value_codes),
                lab_analytes(id, name, unit, reference_range, lab_specific_reference_range, is_calculated, formula, formula_variables, expected_normal_values, expected_value_flag_map, value_type, expected_value_codes, default_value)
              )
            )
          ),
          results(
            id, order_test_group_id, order_test_id, test_group_id,
            result_values(analyte_id, analyte_name, parameter, value, unit, reference_range, flag, verify_note, verify_status)
          )
        `)
        .eq("id", order.id)
        .single();

      if (error) throw error;

      const mapAnalytes = (tgaList: any[], results: any[], otgId: string | null, otId: string | null) =>
        [...(tgaList || [])].sort((a, b) => {
          const ao = a.sort_order ?? a.display_order ?? 0;
          const bo = b.sort_order ?? b.display_order ?? 0;
          return ao - bo;
        }).map((tga: any) => {
          const a = tga.analytes;
          // Prefer lab_analytes config when lab_analyte_id is set (no join ambiguity)
          // la fields override global analyte fields for is_calculated, formula, reference_range, etc.
          const la = tga.lab_analyte_id ? tga.lab_analytes : null;
          const resultRow = results?.find((r: any) =>
            (otgId && r.order_test_group_id === otgId) ||
            (otId && r.order_test_id === otId) ||
            (!otgId && !otId && r.test_group_id === a?.test_group_id)
          );
          let existing = resultRow?.result_values?.find((rv: any) => rv.analyte_id === a?.id) || null;
          // Fallback: scan all result rows by analyte_id or analyte_name
          // (handles: analyzer-inserted values with null linkage fields, Save Draft with null analyte_id)
          if (!existing && results) {
            for (const r of results) {
              const found = r.result_values?.find((rv: any) =>
                rv.analyte_id === a?.id ||
                (!rv.analyte_id && (rv.analyte_name === a?.name || rv.parameter === a?.name))
              );
              if (found) { existing = found; break; }
            }
          }
          // Merge: spread global analyte fields first, then override with lab_analytes fields
          const merged = la ? {
            ...a,
            lab_analyte_id: tga.lab_analyte_id || la.id || null,
            name: la.name || a?.name,
            unit: la.unit || a?.unit,
            reference_range: la.lab_specific_reference_range ?? la.reference_range ?? a?.reference_range,
            is_calculated: la.is_calculated ?? a?.is_calculated,
            formula: la.formula ?? a?.formula,
            formula_variables: la.formula_variables ?? a?.formula_variables,
            expected_normal_values: la.expected_normal_values ?? a?.expected_normal_values,
            expected_value_flag_map: la.expected_value_flag_map ?? a?.expected_value_flag_map,
            value_type: la.value_type ?? a?.value_type,
            expected_value_codes: la.expected_value_codes ?? a?.expected_value_codes,
            default_value: la.default_value ?? null,
          } : a;
          return { ...merged, units: merged?.unit, existing_result: existing };
        }).filter(Boolean);

      const tgFromOTG: TestGroup[] = (data.order_test_groups || [])
        .filter((otg: any) => otg.test_groups)
        .map((otg: any) => ({
          test_group_id: otg.test_groups.id,
          test_group_name: otg.test_groups.name,
          order_test_group_id: otg.id,
          order_test_id: null,
          is_section_only: !!otg.test_groups.is_section_only,
          ref_range_ai_config: otg.test_groups.ref_range_ai_config || null,
          analytes: mapAnalytes(otg.test_groups.test_group_analytes, data.results, otg.id, null),
        }));

      const tgFromOT: TestGroup[] = (data.order_tests || [])
        .filter((ot: any) => ot.test_groups && ot.test_group_id && !ot.is_canceled && !ot.outsourced_lab_id)
        .map((ot: any) => ({
          test_group_id: ot.test_groups.id,
          test_group_name: ot.test_groups.name,
          order_test_group_id: null,
          order_test_id: ot.id,
          is_section_only: !!ot.test_groups.is_section_only,
          ref_range_ai_config: ot.test_groups.ref_range_ai_config || null,
          analytes: mapAnalytes(ot.test_groups.test_group_analytes, data.results, null, ot.id),
        }));

      // Merge groups by test_group_id
      const merged = [...tgFromOTG, ...tgFromOT].reduce<TestGroup[]>((acc, cur) => {
        const idx = acc.findIndex(t => t.test_group_id === cur.test_group_id);
        if (idx === -1) { acc.push(cur); } else {
          const m = acc[idx];
          const merged2 = [...m.analytes];
          cur.analytes.forEach(a => { if (!merged2.find(x => x.id === a.id)) merged2.push(a); });
          acc[idx] = {
            ...m,
            analytes: merged2,
            order_test_group_id: m.order_test_group_id || cur.order_test_group_id,
            order_test_id: m.order_test_id || cur.order_test_id,
            is_section_only: m.is_section_only || cur.is_section_only,
          };
        }
        return acc;
      }, []);

      // Fetch lab_analytes overrides for analytes that didn't have lab_analyte_id set yet
      // (fallback for rows pre-dating the lab_analyte_id migration)
      const allAnalyteIds = merged.flatMap(tg => tg.analytes.map(a => a.id)).filter(Boolean);
      let labAnalytesMap = new Map<string, any>();
      if (allAnalyteIds.length > 0 && data.lab_id) {
        const { data: la } = await supabase
          .from("lab_analytes")
          .select("analyte_id, expected_normal_values, expected_value_flag_map, value_type, expected_value_codes, default_value, reference_range, lab_specific_reference_range, is_calculated, formula, formula_variables")
          .eq("lab_id", data.lab_id)
          .in("analyte_id", allAnalyteIds)
          .order("created_at", { ascending: true });
        // Deduplicate: keep only the first (earliest) row per analyte_id
        if (la) {
          for (const x of la as any[]) {
            if (!labAnalytesMap.has(x.analyte_id)) labAnalytesMap.set(x.analyte_id, x);
          }
        }
      }

      setTestGroups(merged);

      // Build result ID map from existing result rows
      const resultIdMap = new Map<string, string>();
      for (const r of (data.results || [])) {
        if (r.test_group_id) resultIdMap.set(r.test_group_id, r.id);
      }
      // Find test groups that have technician-editable sections
      const groupIds = merged.map(tg => tg.test_group_id).filter(Boolean);
      if (groupIds.length > 0) {
        const { data: techSections } = await supabase
          .from("lab_template_sections")
          .select("test_group_id")
          .eq("allow_technician_entry", true)
          .in("test_group_id", groupIds);

        const techGroupIds = new Set((techSections || []).map((s: any) => s.test_group_id));

        // Also include section-only groups so they always get a result stub
        const sectionOnlyIds = new Set(
          merged.filter(tg => tg.is_section_only).map(tg => tg.test_group_id)
        );
        const needsStubIds = new Set([...techGroupIds, ...sectionOnlyIds]);

        if (needsStubIds.size > 0) {
          // Pre-create stub result rows for groups that have technician sections or are section-only
          const [{ data: { user: currentUser } }, userLabId] = await Promise.all([
            supabase.auth.getUser(),
            database.getCurrentUserLabId(),
          ]);
          for (const tg of merged) {
            if (!needsStubIds.has(tg.test_group_id)) continue;
            if (resultIdMap.has(tg.test_group_id)) continue;
            const { data: stub } = await supabase
              .from("results")
              .upsert({
                order_id: order.id,
                patient_id: safeUuid(order.patient_id),
                patient_name: order.patient_name,
                test_name: tg.test_group_name,
                status: "pending_verification",
                entered_by: currentUser?.email || "Unknown",
                entered_date: new Date().toISOString().split("T")[0],
                test_group_id: tg.test_group_id,
                lab_id: userLabId,
                ...(tg.order_test_group_id && { order_test_group_id: tg.order_test_group_id }),
                ...(tg.order_test_id && { order_test_id: tg.order_test_id }),
              }, { onConflict: "order_id,test_name", ignoreDuplicates: false })
              .select()
              .single();
            if (stub?.id) resultIdMap.set(tg.test_group_id, stub.id);
          }
        }
      }

      setResultIds(resultIdMap);


      // Build flat rows
      const flat: AnalyteRow[] = merged.flatMap(tg =>
        tg.analytes.map(a => {
          const la = labAnalytesMap.get(a.id);
          let envValues: string[] = a.expected_normal_values || [];
          let envMap: Record<string, string> = a.expected_value_flag_map || {};
          if (la?.expected_normal_values) {
            try { const p = typeof la.expected_normal_values === "string" ? JSON.parse(la.expected_normal_values) : la.expected_normal_values; if (p?.length) envValues = p; } catch { /* */ }
          }
          if (la?.expected_value_flag_map) {
            try { const p = typeof la.expected_value_flag_map === "string" ? JSON.parse(la.expected_value_flag_map) : la.expected_value_flag_map; if (Object.keys(p).length) envMap = p; } catch { /* */ }
          }
          // value_type and expected_value_codes: lab override wins if set
          let envValueType: string | undefined = a.value_type;
          let envCodes: Record<string, string> = a.expected_value_codes || {};
          if (la?.value_type) {
            envValueType = la.value_type;
          }
          if (la?.expected_value_codes) {
            try {
              const p = typeof la.expected_value_codes === "string" ? JSON.parse(la.expected_value_codes) : la.expected_value_codes;
              if (p && Object.keys(p).length) envCodes = p;
            } catch { /* */ }
          }
          const envDefaultValue: string = la?.default_value || "";
          const isRerun = !!(a.existing_result?.verify_note && String(a.existing_result.verify_note).toUpperCase().includes("RE-RUN"));
          const hasExisting = hasMeaningfulTextValue(a.existing_result?.value) && !isRerun;
          // Pre-fill default only for new (unsaved) results
          const prefillValue = hasExisting
            ? a.existing_result!.value
            : (isRerun ? (a.existing_result?.value || "") : (envDefaultValue || ""));
          return {
            analyte_id: a.id,
            lab_analyte_id: a.lab_analyte_id || null,
            parameter: a.name,
            value: prefillValue,
            unit: a.existing_result?.unit || a.units || "",
            reference: a.existing_result?.reference_range ?? (la != null ? (la.lab_specific_reference_range ?? la.reference_range ?? a.reference_range) : a.reference_range) ?? "",
            flag: a.existing_result?.flag || "",
            // lab_analytes overrides win for calculated-param fields
            is_calculated: la?.is_calculated != null ? !!la.is_calculated : !!a.is_calculated,
            is_existing: hasExisting,
            expected_normal_values: envValues,
            expected_value_flag_map: envMap,
            value_type: envValueType,
            expected_value_codes: envCodes,
            default_value: envDefaultValue,
            // Mark as default-prefilled so the UI can style it differently
            is_default: !hasExisting && !isRerun && !!envDefaultValue,
            formula: la?.formula ?? a.formula ?? null,
            formula_variables: la?.formula_variables ?? a.formula_variables ?? null,
            verify_note: isRerun ? a.existing_result?.verify_note || "" : "",
            is_rerun: isRerun,
          };
        })
      );

      // Load analyte_dependencies for live formula evaluation
      // Prefer lab-specific rows; fall back to global (lab_id IS NULL) when no lab override exists
      // Use flat (which has lab_analytes overrides applied) so lab-level is_calculated=true is respected
      const calculatedDefs: CalculatedAnalyte[] = merged
        .flatMap((tg) => tg.analytes)
        .filter((analyte) => !!analyte.is_calculated && !!analyte.formula)
        .map((analyte) => ({
          id: analyte.id,
          lab_analyte_id: analyte.lab_analyte_id || null,
          name: analyte.name,
          formula: analyte.formula || "",
          formula_variables: analyte.formula_variables ?? [],
          unit: analyte.units || "",
          reference_range: analyte.reference_range || "",
          code: analyte.code,
          value_type: analyte.value_type,
        }));
      let loadedDeps: DepRow[] = [];
      if (calculatedDefs.length > 0) {
        loadedDeps = await calculationEngine.getDependenciesForCalculatedAnalytes(calculatedDefs, data.lab_id) as DepRow[];
        setCalcDeps(loadedDeps);
      }
      const flatWithCalc = recalculateRowsWithSharedEngine(flat, merged, loadedDeps);
      setRows(flatWithCalc);
    } catch (err) {
      console.error("QuickResultEntry load error:", err);
    } finally {
      setLoading(false);
    }
  };

  // ── Row mutations ───────────────────────────────────────────────────────────

  const setRowField = useCallback((idx: number, field: keyof AnalyteRow, value: string) => {
    setRows(prev => prev.map((r, i) => i !== idx ? r : { ...r, [field]: value }));
  }, []);

  const handleValueBlur = useCallback((idx: number, value: string) => {
    const rawValue = value.replace(/,/g, '');
    const displayValue = formatIndianNumber(rawValue);
    setRows(prev => {
      // 1. Update the edited row
      const next = prev.map((r, i) => {
        if (i !== idx) return r;
        const auto = calculateFlag(rawValue, r.reference, undefined, undefined, undefined, undefined, undefined, undefined, r.value_type);
        return { ...r, value: displayValue, flag: auto || r.flag };
      });

      return recalculateRowsWithSharedEngine(next, testGroups, calcDeps, {
        analyteId: next[idx]?.analyte_id,
        labAnalyteId: next[idx]?.lab_analyte_id || null,
      });

      // 2. Rebuild value lookup from all non-calculated rows
      const lookup = new Map<string, number>();
      // Inject patient context so formulas like eGFR can use AGE / GENDER_MALE
      const patientAge = order.patient?.age ? Number(order.patient.age) : null;
      const patientGender = order.patient?.gender;
      if (patientAge !== null && Number.isFinite(patientAge)) {
        lookup.set('age', patientAge);
      }
      if (patientGender) {
        lookup.set('gender_male', patientGender === 'Male' ? 1 : 0);
        lookup.set('gender_female', patientGender === 'Female' ? 1 : 0);
        lookup.set('gender', patientGender === 'Male' ? 1 : 0);
      }
      // Seed lookup with already-saved analyte values (existing_result) so formulas
      // that depend on previously entered analytes (e.g. MCHC = HGB / HCT * 100)
      // still evaluate correctly when those dependencies are already in is_existing state.
      for (const tg of testGroups) {
        for (const a of tg.analytes) {
          if (a.is_calculated) continue;
          const savedVal = a.existing_result?.value;
          const num = toNumber(savedVal);
          if (num !== null) {
            if (a.id) lookup.set(a.id, num);
            if ((a as any).lab_analyte_id) lookup.set((a as any).lab_analyte_id, num);
            lookup.set(a.name.toLowerCase(), num);
            lookup.set(toVariableSlug(a.name), num);
          }
        }
      }
      for (const r of next) {
        if (r.is_calculated) continue;
        const num = toNumber(r.value);
        if (num !== null) {
          if (r.analyte_id) lookup.set(r.analyte_id, num);
          if (r.lab_analyte_id) lookup.set(r.lab_analyte_id, num);
          lookup.set(r.parameter.toLowerCase(), num);
          // Slug-based key (e.g. "Total Cholesterol" → "tc") so formula
          // variables still resolve even when the dependency UUID points to
          // a different copy of an analyte with the same name.
          lookup.set(toVariableSlug(r.parameter), num);
        }
      }

      // 3. Recompute calculated rows
      return next.map(r => {
        if (!r.is_calculated || !r.formula) return r;
        const vars = parseFormulaVars(r.formula_variables);
        const calcVal = evalFormula(r.formula, vars, lookup, calcDeps, r.analyte_id, r.lab_analyte_id);
        if (!calcVal) return r;
        const autoFlag = calculateFlag(calcVal, r.reference, undefined, undefined, undefined, undefined, undefined, undefined, r.value_type);
        return { ...r, value: formatIndianNumber(calcVal), flag: autoFlag || r.flag };
      });
    });
  }, [calcDeps, recalculateRowsWithSharedEngine, testGroups]);

  // Recalculate all formula-based analytes using saved (existing_result) + pending row values.
  // Called manually via the "↻" button when auto-calc didn't fire (e.g. all deps already saved).
  const handleRecalculate = useCallback(() => {
    setRows(prev => {
      return recalculateRowsWithSharedEngine(prev);

      const lookup = new Map<string, number>();
      const patientAge = order.patient?.age ? Number(order.patient.age) : null;
      const patientGender = order.patient?.gender;
      if (patientAge !== null && Number.isFinite(patientAge)) lookup.set('age', patientAge);
      if (patientGender) {
        lookup.set('gender_male', patientGender === 'Male' ? 1 : 0);
        lookup.set('gender_female', patientGender === 'Female' ? 1 : 0);
        lookup.set('gender', patientGender === 'Male' ? 1 : 0);
      }
      // Seed from already-saved analyte values
      for (const tg of testGroups) {
        for (const a of tg.analytes) {
          if (a.is_calculated) continue;
          const num = toNumber(a.existing_result?.value);
          if (num !== null) {
            if (a.id) lookup.set(a.id, num);
            if ((a as any).lab_analyte_id) lookup.set((a as any).lab_analyte_id, num);
            lookup.set(a.name.toLowerCase(), num);
            lookup.set(toVariableSlug(a.name), num);
          }
        }
      }
      // Seed from current pending row values
      for (const r of prev) {
        if (r.is_calculated) continue;
        const num = toNumber(r.value);
        if (num !== null) {
          if (r.analyte_id) lookup.set(r.analyte_id, num);
          if (r.lab_analyte_id) lookup.set(r.lab_analyte_id, num);
          lookup.set(r.parameter.toLowerCase(), num);
          lookup.set(toVariableSlug(r.parameter), num);
        }
      }
      return prev.map(r => {
        if (!r.is_calculated || !r.formula) return r;
        const vars = parseFormulaVars(r.formula_variables);
        const calcVal = evalFormula(r.formula, vars, lookup, calcDeps, r.analyte_id, r.lab_analyte_id);
        if (!calcVal) return r;
        const autoFlag = calculateFlag(calcVal, r.reference, undefined, undefined, undefined, undefined, undefined, undefined, r.value_type);
        return { ...r, value: formatIndianNumber(calcVal), flag: autoFlag || r.flag };
      });
    });
  }, [calcDeps, order.patient, recalculateRowsWithSharedEngine, testGroups]);

  const getCalculatedDebugInfo = useCallback((row: AnalyteRow) => {
    if (!row.is_calculated || !row.formula) return null;

    const lookup = new Map<string, number>();
    for (const tg of testGroups) {
      for (const a of tg.analytes) {
        if (a.is_calculated) continue;
        const num = toNumber(a.existing_result?.value);
        if (num !== null) {
          if (a.id) lookup.set(a.id, num);
          if ((a as any).lab_analyte_id) lookup.set((a as any).lab_analyte_id, num);
          if (a.name) {
            lookup.set(a.name.toLowerCase(), num);
            const slug = toVariableSlug(a.name);
            if (slug) lookup.set(slug, num);
          }
          if (a.code) lookup.set(String(a.code).toLowerCase(), num);
        }
      }
    }
    for (const currentRow of rows) {
      if (currentRow.is_calculated) continue;
      const num = toNumber(currentRow.value);
      if (num !== null) {
        if (currentRow.analyte_id) lookup.set(currentRow.analyte_id, num);
        if (currentRow.lab_analyte_id) lookup.set(currentRow.lab_analyte_id, num);
        lookup.set(currentRow.parameter.toLowerCase(), num);
        const slug = toVariableSlug(currentRow.parameter);
        if (slug) lookup.set(slug, num);
      }
    }

    const deps = calcDeps.filter(d =>
      (row.lab_analyte_id && d.calculated_lab_analyte_id === row.lab_analyte_id) ||
      (!d.calculated_lab_analyte_id && d.calculated_analyte_id === row.analyte_id)
    );
    const allAnalytes = testGroups.flatMap(tg => tg.analytes);

    if (deps.length > 0) {
      const dependencies = deps.map(dep => {
        const sourceAnalyte = allAnalytes.find((a: any) =>
          (dep.source_lab_analyte_id && (a as any).lab_analyte_id === dep.source_lab_analyte_id) ||
          a.id === dep.source_analyte_id
        );
        let value =
          (dep.source_lab_analyte_id ? lookup.get(dep.source_lab_analyte_id) : undefined) ??
          lookup.get(dep.source_analyte_id) ??
          lookup.get(dep.variable_name.toLowerCase());
        if (value === undefined && sourceAnalyte?.name) {
          value = lookup.get(sourceAnalyte.name.toLowerCase());
          if (value === undefined) {
            const slug = toVariableSlug(sourceAnalyte.name);
            if (slug) value = lookup.get(slug);
          }
        }
        return {
          variable: dep.variable_name,
          sourceName: sourceAnalyte?.name || dep.source_analyte_id?.slice(0, 8) || dep.variable_name,
          value,
        };
      });
      return {
        formula: row.formula,
        dependencies,
        missing: dependencies.filter(dep => dep.value === undefined).map(dep => dep.variable),
        hasDependencies: true,
      };
    }

    const vars = parseFormulaVars(row.formula_variables);
    const dependencies = vars.map(variable => ({
      variable,
      sourceName: variable,
      value: lookup.get(variable.toLowerCase()) ?? lookup.get(variable) ?? lookup.get(toVariableSlug(variable)),
    }));
    return {
      formula: row.formula,
      dependencies,
      missing: dependencies.filter(dep => dep.value === undefined).map(dep => dep.variable),
      hasDependencies: false,
    };
  }, [calcDeps, rows, testGroups]);

  // ── Keyboard navigation ─────────────────────────────────────────────────────

  // valueRefs is rebuilt on each render via the ref callback below
  const inputableIndexes = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !r.is_calculated && (!r.is_existing || !!r.is_rerun))
    .map(({ i }) => i);

  const keepElementVisible = useCallback((element: Element | null) => {
    const container = modalBodyRef.current;
    if (!container || !(element instanceof HTMLElement)) return;

    const elementRect = element.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const topGap = 12;
    const bottomGap = 20;

    if (elementRect.top < containerRect.top + topGap) {
      container.scrollBy({
        top: elementRect.top - containerRect.top - topGap,
        behavior: "smooth",
      });
      return;
    }

    if (elementRect.bottom > containerRect.bottom - bottomGap) {
      container.scrollBy({
        top: elementRect.bottom - containerRect.bottom + bottomGap,
        behavior: "smooth",
      });
    }
  }, []);

  const focusRowInput = useCallback((rowIdx: number) => {
    const target = valueRefs.current[rowIdx];
    if (!target) return;

    target.focus();
    requestAnimationFrame(() => {
      keepElementVisible(target);
      keepElementVisible(target.closest("tr"));
    });
  }, [keepElementVisible]);

  const focusNext = (currentRowIdx: number) => {
    const pos = inputableIndexes.indexOf(currentRowIdx);
    if (pos === -1) return;
    const nextRowIdx = inputableIndexes[pos + 1];
    if (nextRowIdx !== undefined) {
      focusRowInput(nextRowIdx);
    }
  };

  const focusPrev = (currentRowIdx: number) => {
    const pos = inputableIndexes.indexOf(currentRowIdx);
    if (pos <= 0) return;
    const prevRowIdx = inputableIndexes[pos - 1];
    if (prevRowIdx !== undefined) {
      focusRowInput(prevRowIdx);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, rowIdx: number) => {
    if (e.key === "Enter") {
      e.preventDefault();
      focusNext(rowIdx);
    }
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      focusPrev(rowIdx);
    }
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      focusNext(rowIdx);
    }
  };

  // ── Save Draft ──────────────────────────────────────────────────────────────

  const handleSaveDraft = async () => {
    const valid = rows.filter(r => !r.is_calculated && r.value.trim());
    if (!valid.length) { setMessage({ text: "Enter at least one value before saving.", type: "error" }); return; }

    setSaving(true);
    setMessage(null);
    try {
      const resultValues = valid.map(r => ({ parameter: r.parameter, value: r.value.replace(/,/g, ''), unit: r.unit, reference_range: r.reference, flag: r.flag, value_type: r.value_type }));
      const withFlags = calculateFlagsForResults(resultValues);

      const payload = {
        order_id: order.id,
        patient_name: order.patient_name,
        patient_id: safeUuid(order.patient_id),
        test_name: order.tests.join(", "),
        status: "Entered" as const,
        entered_by: user?.user_metadata?.full_name || user?.email || "Unknown",
        entered_date: new Date().toISOString().split("T")[0],
        values: withFlags,
      };

      // Check for existing result row to update
      const { data: existing } = await supabase.from("results").select("id").eq("order_id", order.id).limit(1).maybeSingle();
      if (existing?.id) {
        await database.results.update(existing.id, payload);
      } else {
        await database.results.create(payload);
      }
      setMessage({ text: "Draft saved.", type: "success" });
      setTimeout(() => setMessage(null), 3000);
    } catch (err: any) {
      setMessage({ text: `Save failed: ${err.message}`, type: "error" });
    } finally {
      setSaving(false);
    }
  };

  // ── Submit ──────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    const valid = rows.filter(r => !r.is_calculated && r.value.trim());
    const hasSections = sectionEditorRefs.current.size > 0;
    if (!valid.length && !hasSections) { setMessage({ text: "Enter at least one value before submitting.", type: "error" }); return; }

    setSubmitting(true);
    setMessage({ text: "Saving results...", type: "success" });

    try {
      const [{ data: { user: currentUser } }, userLabId] = await Promise.all([
        supabase.auth.getUser(),
        database.getCurrentUserLabId(),
      ]);

      // Prefetch existing result rows for key-based dedup
      const { data: existingRows } = await supabase
        .from("results")
        .select("id, test_group_id, order_test_group_id, order_test_id, status, verification_status")
        .eq("order_id", order.id);

      const existingByKey = new Map<string, string>();
      const existingStatusByKey = new Map<string, string>();
      const isLockedStatus = (status: string | null, verificationStatus: string | null) =>
        ['Approved', 'Reviewed', 'Reported', 'approved', 'verified'].includes(status || '') ||
        ['verified'].includes(verificationStatus || '');
      for (const row of existingRows || []) {
        const locked = isLockedStatus(row.status, row.verification_status) ? 'LOCKED' : row.status;
        if (row.order_test_group_id) {
          existingByKey.set(`otg:${row.order_test_group_id}`, row.id);
          existingStatusByKey.set(`otg:${row.order_test_group_id}`, locked);
        }
        if (row.order_test_id) {
          existingByKey.set(`ot:${row.order_test_id}`, row.id);
          existingStatusByKey.set(`ot:${row.order_test_id}`, locked);
        }
        if (row.test_group_id) {
          existingByKey.set(`tg:${row.test_group_id}`, row.id);
          existingStatusByKey.set(`tg:${row.test_group_id}`, locked);
        }
      }

      // Use pre-loaded analyte_dependencies (loaded at initial data fetch)
      const deps = calcDeps;

      // Work with a local mutable copy so AI ref range updates are visible to the save loop below
      let workingRows = [...rows];

      // AUTO-RESOLVE AI reference ranges for groups that have it enabled
      const groupsToResolve = testGroups.filter(tg => tg.ref_range_ai_config?.enabled === true);
      if (groupsToResolve.length > 0) {
        setMessage({ text: `Resolving AI reference ranges for ${groupsToResolve.length} group(s)...`, type: "success" });
        const { resolveReferenceRanges } = await import("../../utils/referenceRangeService");
        for (const tg of groupsToResolve) {
          const payload = tg.analytes.map(a => {
            const row = workingRows.find(r => r.analyte_id === a.id);
            return { id: a.id, name: a.name, value: row?.value || "", unit: row?.unit || a.units || "" };
          });
          try {
            const resolved = await resolveReferenceRanges(order.id, tg.test_group_id, payload);
            if (resolved) {
              workingRows = workingRows.map(r => {
                const hit = resolved.find(res => res.id === r.analyte_id || res.name === r.parameter);
                if (!hit?.used_reference_range) return r;
                const newRef = hit.used_reference_range;
                const autoFlag = calculateFlag(r.value, newRef, order.patient?.gender ?? undefined, undefined, undefined, undefined, undefined, undefined, r.value_type);
                return { ...r, reference: newRef, flag: r.flag || autoFlag || "" };
              });
            }
          } catch (aiErr) {
            console.warn(`AI ref range failed for group ${tg.test_group_name}:`, aiErr);
          }
        }
        // Sync resolved references back to UI state
        setRows(workingRows);
      }

      for (const tg of testGroups) {
        // Determine rows to persist: manual entries + calculated
        const manualForGroup = workingRows.filter(r =>
          !r.is_calculated &&
          r.value.trim() &&
          tg.analytes.some(a => a.id === r.analyte_id)
        );

        const calcForGroup: AnalyteRow[] = calculationEngine.computeCalculatedValuesFromDefinitions(
          manualForGroup.map((row) => ({
            analyte_id: row.analyte_id,
            lab_analyte_id: row.lab_analyte_id || null,
            parameter: row.parameter,
            value: row.value.replace(/,/g, ''),
            unit: row.unit,
            reference_range: row.reference,
            flag: row.flag,
          })),
          tg.analytes
            .filter((analyte) => !!analyte.is_calculated && !!analyte.formula)
            .map((analyte) => ({
              id: analyte.id,
              lab_analyte_id: analyte.lab_analyte_id || null,
              name: analyte.name,
              formula: analyte.formula || "",
              formula_variables: analyte.formula_variables ?? [],
              unit: analyte.units || "",
              reference_range: analyte.reference_range || "",
              code: analyte.code,
              value_type: analyte.value_type,
            })),
          deps,
          getPatientData(),
        )
          .filter((calculation) => calculation.success && hasMeaningfulTextValue(calculation.value))
          .map((calculation) => {
            const existingRow = workingRows.find((row) =>
              (calculation.lab_analyte_id && row.lab_analyte_id === calculation.lab_analyte_id) ||
              row.analyte_id === calculation.analyte_id,
            );
            return {
              analyte_id: calculation.analyte_id,
              lab_analyte_id: calculation.lab_analyte_id || null,
              parameter: calculation.parameter,
              value: calculation.value,
              unit: existingRow?.unit || calculation.unit || "",
              reference: existingRow?.reference || calculation.reference_range || "",
              flag: existingRow?.flag || "",
              is_calculated: true,
              expected_normal_values: [],
              expected_value_flag_map: {},
              value_type: existingRow?.value_type,
            };
          });

        // Merge: prefer manual, add calc, dedup
        const toPersist = [...manualForGroup, ...calcForGroup].reduce<AnalyteRow[]>((acc, r) => {
          if (!acc.some(x => x.analyte_id === r.analyte_id)) acc.push(r);
          return acc;
        }, []);

        if (toPersist.length === 0) continue;

        // Upsert results row
        const groupKey = getGroupKey(tg);
        let resultRowId = existingByKey.get(groupKey) || null;


        if (!resultRowId) {
          const { data: saved, error: re } = await supabase
            .from("results")
            .upsert({
              order_id: order.id,
              patient_id: safeUuid(order.patient_id),
              patient_name: order.patient_name,
              test_name: tg.test_group_name,
              status: "pending_verification",
              entered_by: currentUser?.email || "Unknown",
              entered_date: new Date().toISOString().split("T")[0],
              test_group_id: tg.test_group_id,
              lab_id: userLabId,
              extracted_by_ai: false,
              ...(tg.order_test_group_id && { order_test_group_id: tg.order_test_group_id }),
              ...(tg.order_test_id && { order_test_id: tg.order_test_id }),
            }, { onConflict: "order_id,test_name", ignoreDuplicates: false })
            .select("id, status, verification_status")
            .single();
          if (re) throw re;
          resultRowId = saved.id;
          existingByKey.set(groupKey, resultRowId);
          const savedLocked = isLockedStatus(saved.status, saved.verification_status) ? 'LOCKED' : saved.status;
          existingStatusByKey.set(groupKey, savedLocked);
        }

        // For locked results (already approved/verified/reported), only insert truly
        // missing analytes — do not delete/overwrite existing result_values.
        const existingStatus = existingStatusByKey.get(groupKey);
        const isGroupLocked = existingStatus === 'LOCKED';

        if (isGroupLocked) {
          // Fetch which analyte_ids already have values in this result row
          const analyteIdsToCheck = toPersist.map(r => r.analyte_id).filter(Boolean) as string[];
          if (analyteIdsToCheck.length === 0) continue;

          const { data: alreadySaved } = await supabase
            .from("result_values")
            .select("analyte_id")
            .eq("result_id", resultRowId!)
            .in("analyte_id", analyteIdsToCheck);

          const alreadySavedIds = new Set((alreadySaved || []).map((rv: any) => rv.analyte_id));
          const trulyMissing = toPersist.filter(r => r.analyte_id && !alreadySavedIds.has(r.analyte_id));
          if (trulyMissing.length === 0) continue;

          // Insert only the missing analyte values; unlock the result row so a fresh PDF can be generated
          const missingValueRows = trulyMissing.map(r => {
            const rawVal = r.value.replace(/,/g, '');
            const autoFlag = r.flag || calculateFlag(rawVal, r.reference, order.patient?.gender ?? undefined, undefined, undefined, undefined, undefined, undefined, r.value_type);
            return {
              result_id: resultRowId!,
              analyte_id: r.analyte_id || null,
              lab_analyte_id: r.lab_analyte_id || null,
              analyte_name: r.parameter,
              parameter: r.parameter,
              value: rawVal || null,
              unit: r.unit || "",
              reference_range: r.reference || "",
              flag: autoFlag || null,
              flag_source: r.flag ? "manual" : (autoFlag ? "auto_numeric" : undefined),
              is_auto_calculated: r.is_calculated,
              order_id: order.id,
              test_group_id: tg.test_group_id,
              lab_id: userLabId,
              ...(tg.order_test_group_id && { order_test_group_id: tg.order_test_group_id }),
              ...(tg.order_test_id && { order_test_id: tg.order_test_id }),
            };
          });
          const { error: mve } = await supabase.from("result_values").insert(missingValueRows);
          if (mve) throw mve;

          // Unlock the result row so a fresh report can be generated with complete data
          await supabase
            .from("results")
            .update({ is_locked: false, locked_reason: null })
            .eq("id", resultRowId!);

          continue;
        }

        const calculatedAnalyteIdsForGroup = tg.analytes
          .filter(a => !!a.is_calculated && !!a.id)
          .map(a => a.id);
        if (calculatedAnalyteIdsForGroup.length > 0) {
          const { error: cleanupNullCalcError } = await supabase
            .from("result_values")
            .delete()
            .eq("result_id", resultRowId!)
            .in("analyte_id", calculatedAnalyteIdsForGroup)
            .is("value", null);
          if (cleanupNullCalcError) throw cleanupNullCalcError;
        }

        // Delete + re-insert result_values for these analytes
        // Use analyte_id (UUID) for the filter — analyte names may contain characters like "(%)"
        // that break PostgREST's in() URL parser, causing silent 400 errors.
        const analyteIdsToDelete = toPersist.map(r => r.analyte_id).filter(Boolean) as string[];
        if (analyteIdsToDelete.length > 0) {
          const { error: deleteError } = await supabase
            .from("result_values")
            .delete()
            .eq("result_id", resultRowId!)
            .in("analyte_id", analyteIdsToDelete);
          if (deleteError) throw deleteError;
        }

        const valueRows = toPersist.map(r => {
          const rawVal = r.value.replace(/,/g, '');
          const autoFlag = r.flag || calculateFlag(
            rawVal,
            r.reference,
            order.patient?.gender ?? undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            r.value_type,
          );
          return {
          result_id: resultRowId!,
          analyte_id: r.analyte_id || null,
          lab_analyte_id: r.lab_analyte_id || null,
          analyte_name: r.parameter,
          parameter: r.parameter,
          value: rawVal || null,
          unit: r.unit || "",
          reference_range: r.reference || "",
          flag: autoFlag || null,
          flag_source: r.flag ? "manual" : (autoFlag ? "auto_numeric" : undefined),
          is_auto_calculated: r.is_calculated,
          order_id: order.id,
          test_group_id: tg.test_group_id,
          lab_id: userLabId,
          ...(tg.order_test_group_id && { order_test_group_id: tg.order_test_group_id }),
          ...(tg.order_test_id && { order_test_id: tg.order_test_id }),
          };
        });

        const { error: ve } = await supabase.from("result_values").insert(valueRows);
        if (ve) throw ve;

        // Inventory auto-consume (skip outsourced tests)
        const { data: orderTest } = await supabase
          .from("order_tests")
          .select("outsourced_lab_id")
          .eq("order_id", order.id)
          .eq("test_group_id", tg.test_group_id)
          .maybeSingle();

        if (!orderTest?.outsourced_lab_id) {
          try {
            const { data: consumeResult } = await database.inventory.triggerAutoConsume({
              labId: userLabId,
              orderId: order.id,
              resultId: resultRowId || undefined,
              testGroupId: tg.test_group_id,
            });
            if (consumeResult && consumeResult.itemsConsumed > 0) {
              if (consumeResult.alertsGenerated > 0) {
                toast(`Inventory: ${consumeResult.itemsConsumed} items consumed | ${consumeResult.alertsGenerated} low stock alert${consumeResult.alertsGenerated > 1 ? "s" : ""}`, {
                  icon: "⚠️",
                  style: { background: "#FEF3C7", color: "#92400E" },
                  duration: 5000,
                });
              } else {
                toast.success(`Inventory updated: ${consumeResult.itemsConsumed} item${consumeResult.itemsConsumed > 1 ? "s" : ""} consumed`);
              }
            }
          } catch (err) {
            console.warn("Inventory auto-consume failed (non-blocking):", err);
            toast("Inventory update failed (results saved)", {
              icon: "📦",
              style: { background: "#FED7AA", color: "#9A3412" },
            });
          }
        }
      }

      // Non-blocking: AI flag analysis
      import("../../utils/aiFlagAnalysis")
        .then(({ runAIFlagAnalysis }) => runAIFlagAnalysis(order.id, { applyToDatabase: true, createAudit: true }))
        .catch(e => console.warn("AI flag analysis skipped:", e));

      // Update result IDs so SectionEditors have the correct resultId
      const newResultIds = new Map(resultIds);
      for (const tg of testGroups) {
        const groupKey = getGroupKey(tg);
        const rId = existingByKey.get(groupKey);
        if (rId) newResultIds.set(tg.test_group_id, rId);
      }
      setResultIds(newResultIds);

      // Save all visible sections
      const sectionSaves = Array.from(sectionEditorRefs.current.values())
        .map(r => r.current?.save());
      await Promise.all(sectionSaves);

      setMessage({ text: "Results saved!", type: "success" });
      onSubmitted();
      onClose();
    } catch (err: any) {
      console.error("QuickResultEntry submit error:", err);
      setMessage({ text: `Submit failed: ${err.message}`, type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const isEditableRow = (r: AnalyteRow) => !r.is_existing || !!r.is_rerun;
  const filledCount = rows.filter(r => !r.is_calculated && isEditableRow(r) && r.value.trim()).length;
  const totalInputable = rows.filter(r => !r.is_calculated && isEditableRow(r)).length;
  const existingCount = rows.filter(r => !r.is_calculated && r.is_existing && !r.is_rerun).length;

  // Group rows by test group for display — hide already-saved analytes
  const rowsByGroup: { tg: TestGroup; rows: { row: AnalyteRow; globalIdx: number }[] }[] = testGroups.map(tg => ({
    tg,
    rows: tg.analytes.map(a => {
      const globalIdx = rows.findIndex(r => r.analyte_id === a.id);
      return { row: rows[globalIdx] || null, globalIdx };
    }).filter(x => x.row !== null && isEditableRow(x.row)),
  })).filter(g => g.rows.length > 0 || !!g.tg.is_section_only || resultIds.has(g.tg.test_group_id));

  // Re-index valueRefs array size
  valueRefs.current = valueRefs.current.slice(0, rows.length);

  const modal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
      <div className="bg-white rounded-xl shadow-2xl w-[95vw] max-w-6xl max-h-[98vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-t-xl">
          <div>
            <h2 className="text-lg font-bold">{order.patient_name}</h2>
            <p className="text-sm text-green-100">
              {order.patient?.age && `${order.patient.age} · `}
              {order.patient?.gender && `${order.patient.gender} · `}
              {order.tests.join(", ")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Progress pill */}
            <span className="text-sm bg-white/20 px-3 py-1 rounded-full font-medium">
              {filledCount}/{totalInputable} entered
            </span>
            {existingCount > 0 && (
              <span className="text-xs bg-white/10 px-2 py-1 rounded-full text-green-200">
                {existingCount} saved
              </span>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Keyboard hint */}
        <div className="px-5 py-2 text-xs text-gray-500 bg-gray-50 border-b flex gap-4 flex-wrap">
          <span><kbd className="bg-gray-200 px-1.5 py-0.5 rounded text-gray-700 font-mono text-xs">Enter</kbd> next analyte</span>
          <span><kbd className="bg-gray-200 px-1.5 py-0.5 rounded text-gray-700 font-mono text-xs">Tab</kbd> next field</span>
          <span><kbd className="bg-gray-200 px-1.5 py-0.5 rounded text-gray-700 font-mono text-xs">Shift+Tab</kbd> previous analyte</span>
          <span><kbd className="bg-gray-200 px-1.5 py-0.5 rounded text-gray-700 font-mono text-xs">Ctrl+Enter</kbd> submit</span>
          {resultIds.size > 0 && <span><kbd className="bg-gray-200 px-1.5 py-0.5 rounded text-gray-700 font-mono text-xs">A B C…</kbd> select section options</span>}
        </div>

        {/* Body */}
        <div
          ref={modalBodyRef}
          className="flex-1 overflow-y-auto"
          onKeyDown={e => { if (e.ctrlKey && e.key === "Enter") handleSubmit(); }}
        >
          {loading ? (
            <div className="flex items-center justify-center py-16 gap-3 text-gray-500">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>Loading analytes...</span>
            </div>
          ) : rowsByGroup.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-500">
              <CheckCircle className="h-10 w-10 text-green-500" />
              <p className="text-base font-medium text-green-700">All results already saved</p>
              <p className="text-sm text-gray-400">{existingCount} analyte{existingCount !== 1 ? "s" : ""} submitted previously</p>
            </div>
          ) : (
            rowsByGroup.map(({ tg, rows: groupRows }) => (
              <div key={tg.test_group_id}>
                {/* Test group header (only shown if >1 group) */}
                {testGroups.length > 1 && (
                  <div className="px-5 py-2 bg-gray-100 border-b text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <ChevronDown className="h-4 w-4 text-gray-400" />
                    {tg.test_group_name}
                  </div>
                )}

                <div className="w-full overflow-x-auto">
                  <table className="w-full min-w-[880px] table-fixed text-sm">
                    <colgroup>
                      <col style={{ width: "40%" }} />
                      <col style={{ width: "26%" }} />
                      <col style={{ width: "12%" }} />
                      <col style={{ width: "22%" }} />
                    </colgroup>
                    <thead className="sticky top-0 bg-gray-50 border-b z-10">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Analyte</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Value</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Unit</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Flag</th>
                      </tr>
                    </thead>
                    <tbody>
                    {groupRows.map(({ row, globalIdx }) => {
                      const isCalc = row.is_calculated;
                      const calcDebugInfo = isCalc ? getCalculatedDebugInfo(row) : null;
                      const isQualitative = row.value_type === 'qualitative';
                      const hasCodes = isQualitative && Object.keys(row.expected_value_codes || {}).length > 0;
                      // If expected_normal_values exist, always show dropdown regardless of value_type
                      const hasDropdown = row.expected_normal_values.length > 0;
                      const hasDraftValue = row.value.trim() !== "";
                      const isDefault = !!row.is_default;
                      const flagLabel = flagOptions.find(f => f.value === row.flag);
                      const flagColor = row.flag === "" ? "text-green-700" : row.flag?.includes("critical") ? "text-red-700 font-semibold" : row.flag === "H" || row.flag === "L" ? "text-orange-600 font-medium" : "text-gray-700";
                      // Row bg: default-prefilled = amber tint, manually entered = green tint, blank = plain
                      const rowBg = isDefault ? "bg-amber-50/50" : hasDraftValue ? "bg-green-50/40" : "hover:bg-blue-50/30";

                      return (
                        <tr key={row.analyte_id} className={`border-b transition-colors ${rowBg}`}>

                          {/* Analyte name + ref range hint */}
                          <td className="px-4 py-2.5 align-top">
                            <span className={`font-medium ${isCalc ? "text-blue-700" : "text-gray-800"}`}>{row.parameter}</span>
                            {isCalc && <span className="ml-1.5 text-xs text-blue-400 italic">auto</span>}
                            {isDefault && <span className="ml-1.5 text-xs text-amber-600 bg-amber-100 px-1 py-0.5 rounded">default</span>}
                            {row.is_rerun && (
                              <span className="ml-1.5 text-xs text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded font-medium">RE-RUN</span>
                            )}
                            {row.reference && (
                              <div className="text-xs text-gray-400 mt-0.5">{row.reference}</div>
                            )}
                            {isCalc && calcDebugInfo?.formula && (
                              <div className="mt-1 text-[11px] bg-blue-50 border border-blue-100 rounded px-2 py-1 space-y-0.5">
                                <div className="font-mono text-blue-700 truncate" title={calcDebugInfo.formula}>
                                  f: {calcDebugInfo.formula}
                                </div>
                                {calcDebugInfo.hasDependencies && calcDebugInfo.missing.length > 0 && (
                                  <div className="text-red-700">Missing: {calcDebugInfo.missing.join(", ")}</div>
                                )}
                                {!calcDebugInfo.hasDependencies && calcDebugInfo.missing.length > 0 && (
                                  <div className="text-amber-700">Fallback vars missing: {calcDebugInfo.missing.join(", ")}</div>
                                )}
                              </div>
                            )}
                            {row.verify_note && (
                              <div className="text-xs text-orange-600 mt-1">{row.verify_note}</div>
                            )}
                          </td>

                          {/* Value input */}
                          <td className="px-4 py-2 align-top">
                            {isCalc ? (
                              <div className="flex items-center gap-1.5">
                                <div className="flex-1 px-2 py-1.5 bg-blue-50 border border-blue-200 rounded text-blue-800 text-sm font-medium min-h-[34px] flex items-center">
                                  {row.value || <span className="text-blue-300 italic">calculated</span>}
                                </div>
                                <button
                                  type="button"
                                  title="Recalculate from saved values"
                                  onClick={handleRecalculate}
                                  className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-100 rounded transition-colors"
                                >
                                  <RefreshCw className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ) : hasDropdown ? (
                              <select
                                ref={el => { valueRefs.current[globalIdx] = el; }}
                                value={row.value}
                                onChange={e => {
                                  const val = e.target.value;
                                  const autoFlag = row.expected_value_flag_map[val] ?? "";
                                  setRows(prev => prev.map((r, i) => i !== globalIdx ? r : { ...r, value: val, flag: autoFlag, is_default: false }));
                                }}
                                onKeyDown={e => {
                                  // Quick code resolution: e.g. pressing "1" selects "Non-Reactive"
                                  if (hasCodes && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                                    const code = e.key.toUpperCase();
                                    const resolved = (row.expected_value_codes || {})[code];
                                    if (resolved) {
                                      e.preventDefault();
                                      const autoFlag = row.expected_value_flag_map[resolved] ?? "";
                                      setRows(prev => prev.map((r, i) => i !== globalIdx ? r : { ...r, value: resolved, flag: autoFlag, is_default: false }));
                                      focusNext(globalIdx);
                                      return;
                                    }
                                  }
                                  handleKeyDown(e, globalIdx);
                                }}
                                onFocus={e => keepElementVisible(e.currentTarget.closest("tr"))}
                                className={`w-full px-2 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 ${
                                  isDefault
                                    ? "border-amber-300 bg-amber-50 text-amber-800 italic focus:ring-amber-400"
                                    : row.value ? "border-green-300 bg-green-50 focus:ring-green-400" : "border-gray-300 focus:ring-green-400"
                                }`}
                              >
                                <option value="">Select...</option>
                                {row.expected_normal_values.map(opt => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                                {/* Show quick code hints if available */}
                                {hasCodes && <option disabled>── Quick codes ──</option>}
                                {hasCodes && Object.entries(row.expected_value_codes || {}).map(([code, val]) => (
                                  <option key={`hint-${code}`} disabled>{code} → {val}</option>
                                ))}
                              </select>
                            ) : isQualitative ? (
                              // Qualitative without dropdown values: free-text with quick-code resolution.
                              // Amber border/bg when pre-filled by default; purple when manually entered.
                              <div className="relative">
                                <input
                                  ref={el => { valueRefs.current[globalIdx] = el; }}
                                  type="text"
                                  list={hasCodes ? `qcodes-${globalIdx}` : undefined}
                                  value={row.value}
                                  placeholder={hasCodes ? "type code or value..." : "value..."}
                                  onChange={e => {
                                    const typed = e.target.value;
                                    if (hasCodes && typed.trim()) {
                                      const key = typed.trim().toUpperCase();
                                      const resolved = row.expected_value_codes![key];
                                      if (resolved) {
                                        setRows(prev => prev.map((r, i) => i !== globalIdx ? r : { ...r, value: resolved, is_default: false }));
                                        return;
                                      }
                                    }
                                    setRows(prev => prev.map((r, i) => i !== globalIdx ? r : { ...r, value: typed, is_default: false }));
                                  }}
                                  onKeyDown={e => handleKeyDown(e, globalIdx)}
                                  onFocus={e => keepElementVisible(e.currentTarget.closest("tr"))}
                                  className={`w-full px-2 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 ${
                                    isDefault
                                      ? "border-amber-300 bg-amber-50 text-amber-800 italic focus:ring-amber-400"
                                      : row.value
                                        ? "border-purple-300 bg-purple-50 font-medium focus:ring-purple-400"
                                        : "border-gray-300 focus:ring-purple-400"
                                  }`}
                                  autoFocus={globalIdx === inputableIndexes[0]}
                                />
                                {hasCodes && (
                                  <datalist id={`qcodes-${globalIdx}`}>
                                    {Object.entries(row.expected_value_codes!).map(([code, val]) => (
                                      <option key={code} value={val}>{code} → {val}</option>
                                    ))}
                                  </datalist>
                                )}
                              </div>
                            ) : (
                              <input
                                ref={el => { valueRefs.current[globalIdx] = el; }}
                                type="text"
                                value={row.value}
                                placeholder={row.reference ? `e.g. ${row.reference.split("-")[0]?.trim()}` : "value..."}
                                onChange={e => {
                                  const raw = e.target.value.replace(/,/g, '');
                                  setRows(prev => prev.map((r, i) => i !== globalIdx ? r : { ...r, value: raw, is_default: false }));
                                }}
                                onBlur={e => handleValueBlur(globalIdx, e.target.value)}
                                onKeyDown={e => handleKeyDown(e, globalIdx)}
                                onFocus={e => keepElementVisible(e.currentTarget.closest("tr"))}
                                className={`w-full px-2 py-1.5 border rounded text-sm focus:outline-none focus:ring-2 ${
                                  isDefault
                                    ? "border-amber-300 bg-amber-50 text-amber-800 italic focus:ring-amber-400"
                                    : row.value ? "border-green-400 bg-green-50 font-medium focus:ring-green-400" : "border-gray-300 focus:ring-green-400"
                                }`}
                                autoFocus={globalIdx === inputableIndexes[0]}
                              />
                            )}
                          </td>

                          {/* Unit (read-only) */}
                          <td className="px-4 py-2 text-gray-500 text-sm">{row.unit || "—"}</td>

                          {/* Flag select */}
                          <td className="px-4 py-2 align-top">
                            {isCalc ? (
                              <span className={`text-sm ${flagColor}`}>{flagLabel?.label || "—"}</span>
                            ) : (
                              <select
                                value={row.flag}
                                onChange={e => setRowField(globalIdx, "flag", e.target.value)}
                                onFocus={e => keepElementVisible(e.currentTarget.closest("tr"))}
                                tabIndex={-1}
                                className={`w-full px-1.5 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-green-400 ${flagColor}`}
                              >
                                {flagOptions.map(opt => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    </tbody>
                  </table>
                </div>

                {/* Report Sections (technician-editable) */}
                {resultIds.get(tg.test_group_id) && (
                  <div className="border-t border-blue-100 bg-blue-50/30 px-4 py-3">
                    <div className="flex items-center justify-end mb-2">
                      <button
                        type="button"
                        onClick={() => setPreviewGroupId(tg.test_group_id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Preview Report Section
                      </button>
                    </div>
                    <SectionEditor
                      ref={getSectionEditorRef(tg.test_group_id)}
                      resultId={resultIds.get(tg.test_group_id)!}
                      testGroupId={tg.test_group_id}
                      editorRole="technician"
                      showAIAssistant={false}
                      onContentChange={(items) =>
                        setPreviewItems(prev => new Map(prev).set(tg.test_group_id, items))
                      }
                    />
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t bg-gray-50 flex items-center justify-between gap-3">
          <div className="flex-1">
            {message && (
              <span className={`text-sm font-medium ${message.type === "success" ? "text-green-600" : "text-red-600"}`}>
                {message.type === "success" ? <CheckCircle className="inline h-4 w-4 mr-1" /> : null}
                {message.text}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSaveDraft}
              disabled={saving || submitting || loading}
              className="flex items-center gap-1.5 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 text-gray-700 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Draft
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving || submitting || loading}
              className="flex items-center gap-1.5 px-5 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors font-medium"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
              Submit Results
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // ── Section Preview Modal ───────────────────────────────────────────────────
  const previewTg = previewGroupId ? testGroups.find(t => t.test_group_id === previewGroupId) : null;
  const previewResultId = previewGroupId ? resultIds.get(previewGroupId) : undefined;
  const previewSectionEditorRef = React.useRef<SectionEditorRef>(null);

  const previewModal = previewGroupId && previewResultId ? ReactDOM.createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
      <div className="bg-white rounded-xl shadow-2xl w-[92vw] max-w-5xl max-h-[96vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-t-xl">
          <div>
            <h2 className="text-lg font-bold">Report Section Preview &amp; Edit</h2>
            <p className="text-sm text-indigo-100 mt-0.5">{previewTg?.test_group_name}</p>
          </div>
          <button onClick={() => setPreviewGroupId(null)} className="p-1 rounded hover:bg-white/20 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col lg:flex-row gap-0 divide-y lg:divide-y-0 lg:divide-x divide-gray-200">
          {/* Left: Live Preview panel */}
          <div className="lg:w-1/2 p-5 bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Report Preview</h3>
            {(previewItems.get(previewGroupId) ?? []).length === 0 ? (
              <p className="text-sm text-gray-400 italic">No section content yet.</p>
            ) : (
              <div className="space-y-4">
                {(previewItems.get(previewGroupId) ?? []).map(item => (
                  item.final_content.trim() ? (
                    <div key={item.id} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
                      <h4
                        className="font-semibold text-gray-800 uppercase tracking-wide border-b border-gray-100 pb-2 mb-3"
                        style={{ fontSize: `${(item.font_size ?? 13) + 1}px` }}
                      >
                        {item.section_name}
                      </h4>
                      <div
                        className="text-gray-700 leading-relaxed whitespace-pre-wrap"
                        style={{ fontSize: `${item.font_size ?? 13}px`, lineHeight: 1.7 }}
                        dangerouslySetInnerHTML={{ __html: item.final_content }}
                      />
                    </div>
                  ) : null
                ))}
              </div>
            )}
          </div>

          {/* Right: Editable SectionEditor */}
          <div className="lg:w-1/2 p-5 overflow-y-auto">
            <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Edit Sections</h3>
            <SectionEditor
              ref={previewSectionEditorRef}
              resultId={previewResultId}
              testGroupId={previewGroupId}
              editorRole="technician"
              showAIAssistant={false}
              onContentChange={(items) =>
                setPreviewItems(prev => new Map(prev).set(previewGroupId, items))
              }
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t bg-gray-50 flex items-center justify-end gap-3 rounded-b-xl">
          <button
            onClick={() => setPreviewGroupId(null)}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Close
          </button>
          <button
            onClick={async () => {
              await previewSectionEditorRef.current?.save();
              setPreviewGroupId(null);
            }}
            className="flex items-center gap-2 px-5 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
          >
            <Save className="h-4 w-4" />
            Save &amp; Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      {ReactDOM.createPortal(modal, document.body)}
      {previewModal}
    </>
  );
};

export default QuickResultEntryModal;
