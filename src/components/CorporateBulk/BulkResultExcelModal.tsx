/**
 * BulkResultExcelModal - Bulk result entry via Excel upload for corporate orders
 *
 * Features:
 * 1. Download Excel template with orders grouped by test group
 *    - Regular tests: columns = analyte names
 *    - Section report tests: columns = section names
 *    - Mixed tests: columns = analyte names + section names
 * 2. Upload filled Excel and save results
 *    - Only non-blank cells are saved
 *    - Blank cells are skipped (existing values preserved)
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import * as XLSX from 'xlsx';
import {
  X,
  Download,
  Upload,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileDown,
  ArrowRight,
  Info
} from 'lucide-react';
import { supabase, database } from '../../utils/supabase';
import { calculateFlag } from '../../utils/flagCalculation';

// ─── Types ───────────────────────────────────────────────────────────────────

interface OrderInfo {
  id: string;
  order_display: string | null;
  patient_name: string;
  patient_id: string | null;
  sample_id: string | null;
  patient_age: string | null;
  patient_gender: string | null;
}

interface TestGroupInfo {
  id: string;
  name: string;
  is_section_only: boolean;
  orders: OrderInfo[];
  columns: ColumnInfo[];
}

interface CascadeLevel {
  id: string;
  label: string;
  options: { id: string; value: string }[];
  multi_select?: boolean;
}

interface SectionConfig {
  mode?: 'flat' | 'cascading' | 'matrix';
  cascade_levels?: CascadeLevel[];
}

interface ColumnInfo {
  id: string; // analyte_id or section_id
  name: string;
  type: 'analyte' | 'section' | 'cascade_field';
  unit?: string;
  reference_range?: string;
  section_type?: string;
  // For cascade fields
  section_id?: string; // parent section ID
  cascade_level_id?: string;
  cascade_options?: string[]; // allowed values
  multi_select?: boolean;
}

interface ParsedRow {
  order_id: string;
  patient_name: string;
  values: Record<string, string>; // column_name -> value
}

interface ParsedSheet {
  test_group_id: string;
  test_group_name: string;
  rows: ParsedRow[];
}

interface SaveResult {
  order_id: string;
  patient_name: string;
  success: boolean;
  saved_count: number;
  error?: string;
}

interface BulkResultExcelModalProps {
  orderIds: string[];
  labId: string;
  onClose: () => void;
  onSaved?: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

const BulkResultExcelModal: React.FC<BulkResultExcelModalProps> = ({
  orderIds,
  labId,
  onClose,
  onSaved
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'loading' | 'ready' | 'uploading' | 'saving' | 'done'>('loading');
  const [testGroups, setTestGroups] = useState<TestGroupInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [downloadReady, setDownloadReady] = useState(false);

  // Upload state
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [parsedSheets, setParsedSheets] = useState<ParsedSheet[]>([]);
  const [saveResults, setSaveResults] = useState<SaveResult[]>([]);
  const [savingProgress, setSavingProgress] = useState({ current: 0, total: 0 });

  // ─── Load order and test group data ────────────────────────────────────────

  const loadData = useCallback(async () => {
    setStep('loading');
    setError(null);

    try {
      // Fetch orders with their test groups and patient info
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select(`
          id, order_display, patient_name, patient_id,
          patients(id, age, gender),
          samples(id, barcode),
          order_test_groups(
            id, test_group_id,
            test_groups(
              id, name, is_section_only,
              test_group_analytes(
                analyte_id, lab_analyte_id, sort_order,
                analytes(id, name, unit, reference_range),
                lab_analytes(id, name, unit, reference_range)
              )
            )
          ),
          order_tests(
            id, test_group_id, is_canceled, outsourced_lab_id,
            test_groups(
              id, name, is_section_only,
              test_group_analytes(
                analyte_id, lab_analyte_id, sort_order,
                analytes(id, name, unit, reference_range),
                lab_analytes(id, name, unit, reference_range)
              )
            )
          )
        `)
        .in('id', orderIds);

      if (ordersError) throw ordersError;
      if (!orders || orders.length === 0) {
        setError('No orders found');
        return;
      }

      // Group orders by test_group_id
      const groupMap = new Map<string, TestGroupInfo>();

      for (const order of orders) {
        const orderInfo: OrderInfo = {
          id: order.id,
          order_display: order.order_display,
          patient_name: order.patient_name,
          patient_id: order.patient_id,
          sample_id: Array.isArray(order.samples)
            ? (order.samples[0]?.barcode || order.samples[0]?.id || null)
            : (order.samples?.barcode || order.samples?.id || null),
          patient_age: Array.isArray(order.patients)
            ? order.patients[0]?.age
            : order.patients?.age,
          patient_gender: Array.isArray(order.patients)
            ? order.patients[0]?.gender
            : order.patients?.gender,
        };

        // Process order_test_groups
        for (const otg of (order.order_test_groups || [])) {
          if (!otg.test_groups) continue;
          const tg = otg.test_groups;

          if (!groupMap.has(tg.id)) {
            const columns = await getColumnsForTestGroup(tg, labId);
            groupMap.set(tg.id, {
              id: tg.id,
              name: tg.name,
              is_section_only: !!tg.is_section_only,
              orders: [],
              columns
            });
          }

          const group = groupMap.get(tg.id)!;
          if (!group.orders.find(o => o.id === orderInfo.id)) {
            group.orders.push(orderInfo);
          }
        }

        // Process order_tests
        for (const ot of (order.order_tests || [])) {
          if (!ot.test_groups || ot.is_canceled || ot.outsourced_lab_id) continue;
          const tg = ot.test_groups;

          if (!groupMap.has(tg.id)) {
            const columns = await getColumnsForTestGroup(tg, labId);
            groupMap.set(tg.id, {
              id: tg.id,
              name: tg.name,
              is_section_only: !!tg.is_section_only,
              orders: [],
              columns
            });
          }

          const group = groupMap.get(tg.id)!;
          if (!group.orders.find(o => o.id === orderInfo.id)) {
            group.orders.push(orderInfo);
          }
        }
      }

      const groups = Array.from(groupMap.values()).filter(g => g.columns.length > 0);

      if (groups.length === 0) {
        setError('No test groups with analytes or sections found for the selected orders');
        return;
      }

      setTestGroups(groups);
      setDownloadReady(true);
      setStep('ready');

    } catch (err: any) {
      console.error('Failed to load data:', err);
      setError(err.message || 'Failed to load order data');
      setStep('ready');
    }
  }, [orderIds, labId]);

  // Get columns (analytes and/or sections) for a test group
  async function getColumnsForTestGroup(
    tg: { id: string; name: string; is_section_only?: boolean; test_group_analytes?: any[] },
    labId: string
  ): Promise<ColumnInfo[]> {
    const columns: ColumnInfo[] = [];

    if (!tg.is_section_only) {
      // Use analytes from test_group_analytes
      const analytes = [...(tg.test_group_analytes || [])].sort((a, b) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0)
      );

      for (const tga of analytes) {
        const a = tga.analytes;
        const la = tga.lab_analytes;
        if (!a) continue;

        columns.push({
          id: a.id,
          name: la?.name || a.name,
          type: 'analyte',
          unit: la?.unit || a.unit || '',
          reference_range: la?.reference_range || a.reference_range || ''
        });
      }
    }

    // Fetch editable report sections for both section-only and mixed test groups.
    const { data: sections } = await supabase
      .from('lab_template_sections')
      .select('id, section_name, section_type, display_order, section_config')
      .eq('test_group_id', tg.id)
      .eq('lab_id', labId)
      .eq('is_editable', true)
      .order('display_order');

    for (const sec of (sections || [])) {
      // Parse section_config to check for cascading mode
      let config: SectionConfig | null = null;
      if (sec.section_config) {
        try {
          config = typeof sec.section_config === 'string'
            ? JSON.parse(sec.section_config)
            : sec.section_config;
        } catch { /* ignore */ }
      }

      // If cascading mode with levels, expand each level to a column
      if (config?.mode === 'cascading' && config.cascade_levels?.length) {
        for (const level of config.cascade_levels) {
          const optionValues = level.options?.map(o => o.value) || [];
          columns.push({
            id: `${sec.id}:${level.id}`,
            name: level.label || level.id,
            type: 'cascade_field',
            section_id: sec.id,
            cascade_level_id: level.id,
            cascade_options: optionValues,
            multi_select: !!level.multi_select,
          });
        }
      } else {
        // Flat or unknown mode - single column for the section
        columns.push({
          id: sec.id,
          name: sec.section_name,
          type: 'section',
          section_type: sec.section_type
        });
      }
    }

    return columns;
  }

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ─── Generate and download Excel template ──────────────────────────────────

  const handleDownloadTemplate = useCallback(() => {
    if (testGroups.length === 0) return;

    const wb = XLSX.utils.book_new();

    for (const group of testGroups) {
      // Build header row
      const headers = ['Order ID', 'Patient Name', 'Sample ID'];
      for (const col of group.columns) {
        if (col.type === 'analyte' && col.unit) {
          headers.push(`${col.name} (${col.unit})`);
        } else if (col.type === 'cascade_field' && col.multi_select) {
          headers.push(`${col.name} (multi)`);
        } else {
          headers.push(col.name);
        }
      }

      // Build hint row for allowed values (cascade options or reference ranges)
      const hasHints = group.columns.some(c => c.reference_range || c.cascade_options?.length);
      const hintRow = ['', '', 'Options/Ref:'];
      for (const col of group.columns) {
        if (col.cascade_options?.length) {
          // Show allowed values for cascade fields
          hintRow.push(col.cascade_options.join(' | '));
        } else if (col.reference_range) {
          hintRow.push(col.reference_range);
        } else {
          hintRow.push('');
        }
      }

      // Build data rows
      const dataRows: string[][] = [];
      for (const order of group.orders) {
        const row: string[] = [
          order.order_display || order.id.slice(-6),
          order.patient_name,
          order.sample_id || ''
        ];
        // Add empty cells for each column
        for (let i = 0; i < group.columns.length; i++) {
          row.push('');
        }
        dataRows.push(row);
      }

      // Combine: headers + hints (if any) + data
      const allRows = hasHints ? [headers, hintRow, ...dataRows] : [headers, ...dataRows];

      // Create worksheet
      const ws = XLSX.utils.aoa_to_sheet(allRows);

      // Set column widths - wider for cascade fields with options
      const colWidths = [
        { wch: 12 },  // Order ID
        { wch: 20 },  // Patient Name
        { wch: 12 },  // Sample ID
        ...group.columns.map(col => ({
          wch: col.cascade_options?.length ? Math.max(18, col.name.length + 2) : 15
        }))
      ];
      ws['!cols'] = colWidths;

      // Use sanitized sheet name (Excel has 31 char limit)
      const sheetName = sanitizeSheetName(group.name);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    // Generate filename with date
    const date = new Date().toISOString().split('T')[0];
    const filename = `bulk_results_template_${date}.xlsx`;

    XLSX.writeFile(wb, filename);
  }, [testGroups]);

  // Sanitize sheet name for Excel (max 31 chars, no special chars)
  function sanitizeSheetName(name: string): string {
    return name
      .replace(/[\\/*?:\[\]]/g, '')
      .substring(0, 31);
  }

  // ─── Handle file upload ────────────────────────────────────────────────────

  const handleFileUpload = useCallback((file: File) => {
    setError(null);
    setUploadedFileName(file.name);
    setStep('uploading');

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });

        const parsed: ParsedSheet[] = [];

        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });

          if (json.length === 0) continue;

          // Find matching test group by sheet name
          const matchingGroup = testGroups.find(g =>
            sanitizeSheetName(g.name).toLowerCase() === sheetName.toLowerCase() ||
            g.name.toLowerCase().includes(sheetName.toLowerCase()) ||
            sheetName.toLowerCase().includes(g.name.toLowerCase())
          );

          if (!matchingGroup) {
            console.warn(`No matching test group for sheet: ${sheetName}`);
            continue;
          }

          // Skip reference range row if present
          const dataRows = json.filter(row => {
            const firstCol = Object.values(row)[0];
            return firstCol &&
              String(firstCol).toLowerCase() !== 'ref range:' &&
              String(firstCol).toLowerCase() !== 'reference:';
          });

          const rows: ParsedRow[] = [];

          for (const row of dataRows) {
            const orderId = findOrderId(row, matchingGroup.orders);
            if (!orderId) continue;

            const values: Record<string, string> = {};

            for (const col of matchingGroup.columns) {
              // Try to find the column value by matching header name
              const value = findColumnValue(row, col.name, col.unit, col.multi_select);
              if (value !== null && value !== undefined && String(value).trim() !== '') {
                values[col.name] = String(value).trim();
              }
            }

            if (Object.keys(values).length > 0) {
              rows.push({
                order_id: orderId,
                patient_name: String(row['Patient Name'] || ''),
                values
              });
            }
          }

          if (rows.length > 0) {
            parsed.push({
              test_group_id: matchingGroup.id,
              test_group_name: matchingGroup.name,
              rows
            });
          }
        }

        if (parsed.length === 0) {
          setError('No valid data found in the uploaded file. Make sure the sheet names match test groups and Order ID column is filled.');
          setStep('ready');
          return;
        }

        setParsedSheets(parsed);
        setStep('ready');

      } catch (err: any) {
        console.error('Failed to parse Excel:', err);
        setError('Failed to parse Excel file. Please check the format.');
        setStep('ready');
      }
    };
    reader.readAsArrayBuffer(file);
  }, [testGroups]);

  // Find order ID from row data
  function findOrderId(row: Record<string, any>, orders: OrderInfo[]): string | null {
    const orderIdValue = row['Order ID'] || row['order_id'] || row['OrderID'] || '';
    const orderIdStr = String(orderIdValue).trim().toLowerCase();

    if (!orderIdStr) return null;

    // Try exact match first
    const exactMatch = orders.find(o =>
      o.id === orderIdStr ||
      o.order_display?.toLowerCase() === orderIdStr ||
      o.id.slice(-6).toLowerCase() === orderIdStr
    );

    if (exactMatch) return exactMatch.id;

    // Try partial match (last 6 chars)
    const partialMatch = orders.find(o =>
      o.id.toLowerCase().endsWith(orderIdStr) ||
      o.order_display?.toLowerCase().includes(orderIdStr)
    );

    return partialMatch?.id || null;
  }

  // Find column value from row with flexible header matching
  function findColumnValue(row: Record<string, any>, colName: string, unit?: string, isMultiSelect?: boolean): any {
    // Try exact match
    if (row[colName] !== undefined) return row[colName];

    // Try with unit
    if (unit && row[`${colName} (${unit})`] !== undefined) {
      return row[`${colName} (${unit})`];
    }

    // Try with (multi) suffix for cascade fields
    if (isMultiSelect && row[`${colName} (multi)`] !== undefined) {
      return row[`${colName} (multi)`];
    }

    // Try case-insensitive match
    const lowerName = colName.toLowerCase();
    for (const [key, value] of Object.entries(row)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey === lowerName ||
          lowerKey === `${lowerName} (multi)` ||
          lowerKey.startsWith(lowerName) ||
          lowerKey.includes(lowerName)) {
        return value;
      }
    }

    return null;
  }

  // ─── Save results to database ──────────────────────────────────────────────

  const handleSaveResults = useCallback(async () => {
    if (parsedSheets.length === 0) return;

    setStep('saving');
    setSaveResults([]);

    const totalRows = parsedSheets.reduce((sum, s) => sum + s.rows.length, 0);
    setSavingProgress({ current: 0, total: totalRows });

    const results: SaveResult[] = [];
    let processedCount = 0;

    try {
      const [{ data: { user: currentUser } }, userLabId] = await Promise.all([
        supabase.auth.getUser(),
        database.getCurrentUserLabId(),
      ]);

      for (const sheet of parsedSheets) {
        const group = testGroups.find(g => g.id === sheet.test_group_id);
        if (!group) continue;

        for (const row of sheet.rows) {
          const saveResult: SaveResult = {
            order_id: row.order_id,
            patient_name: row.patient_name,
            success: false,
            saved_count: 0
          };

          try {
            let savedCount = 0;

            if (group.columns.some(col => col.type === 'analyte')) {
              // Save analyte results
              savedCount += await saveAnalyteResults(
                row.order_id,
                group,
                row.values,
                currentUser,
                userLabId
              );
            }

            if (group.columns.some(col => col.type === 'section' || col.type === 'cascade_field')) {
              // Save report section content
              savedCount += await saveSectionResults(
                row.order_id,
                group,
                row.values,
                currentUser?.id || null,
                userLabId
              );
            }

            saveResult.saved_count = savedCount;
            saveResult.success = true;

            // Update order status
            await database.orders.checkAndUpdateStatus(row.order_id);

          } catch (err: any) {
            saveResult.error = err.message || 'Failed to save';
          }

          results.push(saveResult);
          processedCount++;
          setSavingProgress({ current: processedCount, total: totalRows });
        }
      }

      setSaveResults(results);
      setStep('done');

      if (onSaved) {
        onSaved();
      }

    } catch (err: any) {
      console.error('Save failed:', err);
      setError(err.message || 'Failed to save results');
      setStep('ready');
    }
  }, [parsedSheets, testGroups, onSaved]);

  // Save analyte-based results
  async function saveAnalyteResults(
    orderId: string,
    group: TestGroupInfo,
    values: Record<string, string>,
    currentUser: any,
    userLabId: string | null
  ): Promise<number> {
    // Get or create result row
    const { data: existingResult } = await supabase
      .from('results')
      .select('id')
      .eq('order_id', orderId)
      .eq('test_group_id', group.id)
      .maybeSingle();

    // Fetch order for patient info
    const { data: order } = await supabase
      .from('orders')
      .select('patient_id, patient_name, patients(age, gender)')
      .eq('id', orderId)
      .single();

    const patientGender = Array.isArray(order?.patients)
      ? order?.patients[0]?.gender
      : order?.patients?.gender;

    let resultId = existingResult?.id;

    if (!resultId) {
      const { data: newResult, error: createError } = await supabase
        .from('results')
        .insert({
          order_id: orderId,
          patient_id: order?.patient_id || null,
          patient_name: order?.patient_name || '',
          test_name: group.name,
          test_group_id: group.id,
          lab_id: userLabId,
          status: 'pending_verification',
          entered_by: currentUser?.email || 'Bulk Excel Import',
          entered_date: new Date().toISOString().split('T')[0],
        })
        .select('id')
        .single();

      if (createError) throw createError;
      resultId = newResult.id;
    }

    // Prepare result values
    const resultValues: any[] = [];

    for (const col of group.columns) {
      if (col.type !== 'analyte') continue;

      const value = values[col.name];
      if (!value) continue;

      const autoFlag = calculateFlag(
        value,
        col.reference_range || '',
        patientGender || undefined
      );

      resultValues.push({
        result_id: resultId,
        analyte_id: col.id,
        analyte_name: col.name,
        parameter: col.name,
        value: value,
        unit: col.unit || '',
        reference_range: col.reference_range || '',
        flag: autoFlag || null,
        flag_source: autoFlag ? 'auto_numeric' : null,
        verify_status: 'pending',
        order_id: orderId,
        test_group_id: group.id,
        lab_id: userLabId,
      });
    }

    if (resultValues.length === 0) return 0;

    // Delete existing values for these analytes and insert new ones
    const analyteIds = resultValues.map(rv => rv.analyte_id);
    await supabase
      .from('result_values')
      .delete()
      .eq('result_id', resultId)
      .in('analyte_id', analyteIds);

    const { error: insertError } = await supabase
      .from('result_values')
      .insert(resultValues);

    if (insertError) throw insertError;

    return resultValues.length;
  }

  // Save section-based results
  async function saveSectionResults(
    orderId: string,
    group: TestGroupInfo,
    values: Record<string, string>,
    userId: string | null,
    userLabId: string | null
  ): Promise<number> {
    // Get or create result row
    const { data: existingResult } = await supabase
      .from('results')
      .select('id')
      .eq('order_id', orderId)
      .eq('test_group_id', group.id)
      .maybeSingle();

    // Fetch order for patient info
    const { data: order } = await supabase
      .from('orders')
      .select('patient_id, patient_name')
      .eq('id', orderId)
      .single();

    let resultId = existingResult?.id;

    if (!resultId) {
      const { data: newResult, error: createError } = await supabase
        .from('results')
        .insert({
          order_id: orderId,
          patient_id: order?.patient_id || null,
          patient_name: order?.patient_name || '',
          test_name: group.name,
          test_group_id: group.id,
          lab_id: userLabId,
          status: 'pending_verification',
          entered_by: 'Bulk Excel Import',
          entered_date: new Date().toISOString().split('T')[0],
        })
        .select('id')
        .single();

      if (createError) throw createError;
      resultId = newResult.id;
    }

    // Group columns by section_id for cascade fields
    const sectionGroups = new Map<string, { sectionId: string; cascadeValues: Map<string, string> }>();
    const flatSections: ColumnInfo[] = [];

    for (const col of group.columns) {
      if (col.type === 'cascade_field' && col.section_id && col.cascade_level_id) {
        const content = values[col.name];
        if (!content) continue;

        if (!sectionGroups.has(col.section_id)) {
          sectionGroups.set(col.section_id, { sectionId: col.section_id, cascadeValues: new Map() });
        }
        sectionGroups.get(col.section_id)!.cascadeValues.set(col.cascade_level_id, content);
      } else if (col.type === 'section') {
        flatSections.push(col);
      }
    }

    let savedCount = 0;

    // Save cascade sections
    for (const [sectionId, { cascadeValues }] of sectionGroups) {
      if (cascadeValues.size === 0) continue;

      // Build cascading_selections in the format expected by SectionEditor
      // Format: { level_id: [option_id], ... } - we use the value text as option_id for simplicity
      const cascadingSelections: Record<string, string[]> = {};
      const contentParts: string[] = [];

      for (const [levelId, value] of cascadeValues) {
        // Find the column to get the label
        const col = group.columns.find(c => c.cascade_level_id === levelId);
        const label = col?.name || levelId;

        // Handle multi-select (comma-separated values)
        const valueList = value.split(',').map(v => v.trim()).filter(Boolean);
        cascadingSelections[levelId] = valueList;
        contentParts.push(`${label}: ${valueList.join(', ')}`);
      }

      const finalContent = contentParts.join('\n');

      const { error } = await database.resultSectionContent.upsert({
        result_id: resultId,
        section_id: sectionId,
        selected_options: [],
        custom_text: '',
        final_content: finalContent,
        image_urls: [],
        cascading_selections: cascadingSelections,
      }, userId);

      if (!error) savedCount += cascadeValues.size;
    }

    // Save flat sections
    for (const col of flatSections) {
      const content = values[col.name];
      if (!content) continue;

      const { error } = await database.resultSectionContent.upsert({
        result_id: resultId,
        section_id: col.id,
        selected_options: [],
        custom_text: content,
        final_content: content,
        image_urls: [],
        cascading_selections: {},
      }, userId);

      if (!error) savedCount++;
    }

    return savedCount;
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const totalValues = parsedSheets.reduce(
    (sum, s) => sum + s.rows.reduce((rSum, r) => rSum + Object.keys(r.values).length, 0),
    0
  );

  const successCount = saveResults.filter(r => r.success).length;
  const failedCount = saveResults.filter(r => !r.success).length;

  function getColumnSummary(group: TestGroupInfo): string {
    const analyteCount = group.columns.filter(col => col.type === 'analyte').length;
    const sectionCount = group.columns.filter(col => col.type === 'section' || col.type === 'cascade_field').length;
    const parts: string[] = [];

    if (analyteCount > 0) parts.push(`${analyteCount} analyte${analyteCount === 1 ? '' : 's'}`);
    if (sectionCount > 0) parts.push(`${sectionCount} section column${sectionCount === 1 ? '' : 's'}`);

    return parts.join(', ') || '0 columns';
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-t-xl">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="w-6 h-6" />
            <div>
              <h2 className="text-lg font-semibold">Bulk Result Entry via Excel</h2>
              <p className="text-sm text-indigo-100">{orderIds.length} orders selected</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Error display */}
          {error && (
            <div className="flex items-start gap-2 text-red-600 bg-red-50 rounded-lg p-4 text-sm">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}

          {/* Loading state */}
          {step === 'loading' && (
            <div className="flex items-center justify-center py-12 gap-3 text-gray-500">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span>Loading order data...</span>
            </div>
          )}

          {/* Ready state - show download and upload options */}
          {(step === 'ready' || step === 'uploading') && downloadReady && (
            <>
              {/* Test groups summary */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Test Groups Found</h3>
                <div className="space-y-2">
                  {testGroups.map(group => (
                    <div key={group.id} className="flex items-center justify-between text-sm">
                      <span className="text-gray-800">
                        {group.name}
                        {group.is_section_only && (
                          <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                            Section Report
                          </span>
                        )}
                      </span>
                      <span className="text-gray-500">
                        {group.orders.length} orders · {getColumnSummary(group)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Step 1: Download template */}
              <div className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-semibold text-sm">
                    1
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-800">Download Excel Template</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Get a pre-filled template with patient names and test columns.
                      Each test group will be on a separate sheet.
                    </p>
                    <button
                      onClick={handleDownloadTemplate}
                      className="mt-3 flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
                    >
                      <Download className="w-4 h-4" />
                      Download Template
                    </button>
                  </div>
                </div>
              </div>

              {/* Step 2: Upload filled template */}
              <div className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-semibold text-sm">
                    2
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-800">Upload Filled Excel</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Fill in the values and upload. Only non-blank cells will be saved.
                    </p>

                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const file = e.dataTransfer.files[0];
                        if (file) handleFileUpload(file);
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      className="mt-3 border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/50 transition-colors"
                    >
                      {step === 'uploading' ? (
                        <div className="flex items-center justify-center gap-2 text-indigo-600">
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span>Parsing {uploadedFileName}...</span>
                        </div>
                      ) : (
                        <>
                          <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                          <p className="text-gray-600 text-sm">
                            {uploadedFileName
                              ? `Selected: ${uploadedFileName}`
                              : 'Drop Excel file here or click to browse'}
                          </p>
                        </>
                      )}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
                        }}
                      />
                    </div>

                    {/* Parsed data preview */}
                    {parsedSheets.length > 0 && (
                      <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
                        <div className="flex items-center gap-2 text-green-700 mb-2">
                          <CheckCircle2 className="w-5 h-5" />
                          <span className="font-medium">Ready to save</span>
                        </div>
                        <div className="text-sm text-green-600 space-y-1">
                          {parsedSheets.map(sheet => (
                            <div key={sheet.test_group_id}>
                              {sheet.test_group_name}: {sheet.rows.length} patients, {' '}
                              {sheet.rows.reduce((sum, r) => sum + Object.keys(r.values).length, 0)} values
                            </div>
                          ))}
                        </div>
                        <p className="text-xs text-green-600 mt-2">
                          Total: {totalValues} values to save
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Info note */}
              <div className="flex items-start gap-2 text-blue-700 bg-blue-50 rounded-lg p-3 text-sm">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <strong>Tip:</strong> Leave cells blank if you don't have results yet - they won't be saved.
                  You can upload partial results and fill in the rest later.
                </div>
              </div>
            </>
          )}

          {/* Saving state */}
          {step === 'saving' && (
            <div className="py-8 text-center">
              <Loader2 className="w-10 h-10 animate-spin text-indigo-600 mx-auto mb-4" />
              <p className="text-gray-700 font-medium">Saving results...</p>
              <p className="text-sm text-gray-500 mt-1">
                {savingProgress.current} / {savingProgress.total} orders processed
              </p>
              <div className="w-full max-w-xs mx-auto mt-4 bg-gray-200 rounded-full h-2">
                <div
                  className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(savingProgress.current / savingProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Done state */}
          {step === 'done' && (
            <div className="py-4">
              <div className="text-center mb-6">
                <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
                <h3 className="text-lg font-semibold text-gray-800">Results Saved Successfully</h3>
                <p className="text-sm text-gray-500 mt-1">
                  {successCount} orders saved, {failedCount > 0 ? `${failedCount} failed` : 'no errors'}
                </p>
              </div>

              {/* Results summary */}
              <div className="bg-gray-50 rounded-lg p-4 max-h-60 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-600">
                      <th className="pb-2">Patient</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2 text-right">Values Saved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {saveResults.map((result, idx) => (
                      <tr key={idx} className="border-t border-gray-200">
                        <td className="py-2 font-medium">{result.patient_name}</td>
                        <td className="py-2">
                          {result.success ? (
                            <span className="text-green-600 flex items-center gap-1">
                              <CheckCircle2 className="w-4 h-4" /> Saved
                            </span>
                          ) : (
                            <span className="text-red-600 flex items-center gap-1">
                              <AlertCircle className="w-4 h-4" /> {result.error}
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-right text-gray-600">{result.saved_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t bg-gray-50 flex items-center justify-end gap-3 rounded-b-xl">
          {step === 'done' ? (
            <button
              onClick={onClose}
              className="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              {parsedSheets.length > 0 && step === 'ready' && (
                <button
                  onClick={handleSaveResults}
                  className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
                >
                  <FileDown className="w-4 h-4" />
                  Save {totalValues} Results
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default BulkResultExcelModal;
