import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BarChart3, ChevronDown, ChevronRight, Download, Loader2, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../../utils/supabase';
import { parseReferenceRange } from '../../utils/flagDetermination';

interface AnalysisRow {
  order_id: string;
  sample_id: string | null;
  patient_name: string;
  order_date: string;
  test_group_name: string;
  analyte_name: string;
  value: string | null;
  unit: string | null;
  reference_range: string | null;
  flag: string | null;
}

interface B2BResultAnalysisModalProps {
  orderIds: string[];
  onClose: () => void;
}

type RangeStatus = 'below' | 'within' | 'above' | 'unclassified';
type ClassifiedAnalysisRow = AnalysisRow & { rangeStatus: RangeStatus };

const statusStyles: Record<RangeStatus, { label: string; badge: string; bar: string }> = {
  below: { label: 'Below range', badge: 'bg-blue-100 text-blue-700', bar: 'bg-blue-500' },
  within: { label: 'Within range', badge: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500' },
  above: { label: 'Above range', badge: 'bg-rose-100 text-rose-700', bar: 'bg-rose-500' },
  unclassified: { label: 'Not classified', badge: 'bg-gray-100 text-gray-600', bar: 'bg-gray-400' },
};

const classifyResult = (row: AnalysisRow): RangeStatus => {
  const flag = String(row.flag || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (flag.includes('low')) return 'below';
  if (flag.includes('high')) return 'above';
  if (flag === 'normal' || flag === 'within_range' || flag === 'within') return 'within';

  const numericValue = Number(String(row.value ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(numericValue)) return 'unclassified';

  const range = parseReferenceRange(row.reference_range);
  if (range.low !== null && numericValue < range.low) return 'below';
  if (range.high !== null && numericValue > range.high) return 'above';
  if (range.type !== 'none' && (range.low !== null || range.high !== null)) return 'within';
  return 'unclassified';
};

const B2BResultAnalysisModal: React.FC<B2BResultAnalysisModalProps> = ({ orderIds, onClose }) => {
  const [rows, setRows] = useState<AnalysisRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedAnalytes, setExpandedAnalytes] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;

    const loadAnalysis = async () => {
      setLoading(true);
      setError('');
      const { data, error: rpcError } = await supabase.rpc('get_b2b_result_analysis', {
        p_order_ids: orderIds,
      });

      if (!active) return;
      if (rpcError) {
        setError(rpcError.message || 'Unable to load result analysis.');
        setRows([]);
      } else {
        setRows((data || []) as AnalysisRow[]);
      }
      setLoading(false);
    };

    loadAnalysis();
    return () => { active = false; };
  }, [orderIds]);

  const classifiedRows = useMemo(
    () => rows.map((row) => ({ ...row, rangeStatus: classifyResult(row) })),
    [rows],
  );

  const totals = useMemo(() => {
    const counts: Record<RangeStatus, number> = { below: 0, within: 0, above: 0, unclassified: 0 };
    classifiedRows.forEach((row) => { counts[row.rangeStatus] += 1; });
    return counts;
  }, [classifiedRows]);

  const analyteSummaries = useMemo(() => {
    const summary = new Map<string, {
      testGroup: string;
      analyte: string;
      unit: string | null;
      referenceRange: string | null;
      below: number;
      within: number;
      above: number;
      unclassified: number;
      rows: ClassifiedAnalysisRow[];
    }>();

    classifiedRows.forEach((row) => {
      const key = `${row.test_group_name}::${row.analyte_name}`;
      if (!summary.has(key)) {
        summary.set(key, {
          testGroup: row.test_group_name,
          analyte: row.analyte_name,
          unit: row.unit,
          referenceRange: row.reference_range,
          below: 0,
          within: 0,
          above: 0,
          unclassified: 0,
          rows: [],
        });
      }
      const item = summary.get(key)!;
      item[row.rangeStatus] += 1;
      item.rows.push(row);
    });

    return Array.from(summary.values()).sort((a, b) =>
      a.testGroup.localeCompare(b.testGroup) || a.analyte.localeCompare(b.analyte));
  }, [classifiedRows]);

  const classifiedTotal = totals.below + totals.within + totals.above;
  const percentage = (count: number, denominator = classifiedRows.length) =>
    denominator > 0 ? Math.round((count / denominator) * 100) : 0;

  const toggleAnalyte = (key: string) => {
    setExpandedAnalytes((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const downloadExcel = (exportRows: ClassifiedAnalysisRow[], analyteName?: string) => {
    const workbook = XLSX.utils.book_new();
    const sheets: Array<{ status: RangeStatus; name: string }> = [
      { status: 'below', name: 'Low' },
      { status: 'within', name: 'In Range' },
      { status: 'above', name: 'High' },
    ];

    sheets.forEach(({ status, name }) => {
      const sheetRows = exportRows
        .filter((row) => row.rangeStatus === status)
        .map((row) => ({
          'Patient Name': row.patient_name,
          'Sample ID': row.sample_id || '',
          'Order Date': row.order_date,
          'Test Group': row.test_group_name,
          'Analyte': row.analyte_name,
          'Value': row.value || '',
          'Unit': row.unit || '',
          'Reference Range': row.reference_range || '',
          'Classification': statusStyles[status].label,
        }));

      const worksheet = XLSX.utils.json_to_sheet(sheetRows.length > 0 ? sheetRows : [{
        'Patient Name': '',
        'Sample ID': '',
        'Order Date': '',
        'Test Group': '',
        'Analyte': analyteName || '',
        'Value': '',
        'Unit': '',
        'Reference Range': '',
        'Classification': `No ${name.toLowerCase()} results`,
      }]);
      worksheet['!cols'] = [
        { wch: 28 }, { wch: 24 }, { wch: 14 }, { wch: 30 }, { wch: 30 },
        { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 18 },
      ];
      XLSX.utils.book_append_sheet(workbook, worksheet, name);
    });

    const safeName = analyteName
      ? analyteName.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 60)
      : 'all_analytes';
    XLSX.writeFile(workbook, `b2b_result_analysis_${safeName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-indigo-600" />
              <h2 className="text-lg font-semibold text-gray-900">Report Analysis</h2>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Range distribution across {orderIds.length} selected order{orderIds.length === 1 ? '' : 's'}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {classifiedRows.length > 0 && (
              <button
                onClick={() => downloadExcel(classifiedRows)}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                <Download className="h-4 w-4" />
                Download Excel
              </button>
            )}
            <button onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-gray-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading result analysis...
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 py-16 text-center text-sm text-gray-500">
              No result values are available for the selected orders.
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {(Object.keys(statusStyles) as RangeStatus[]).map((status) => (
                  <div key={status} className="rounded-xl border border-gray-200 p-4">
                    <div className="text-sm text-gray-500">{statusStyles[status].label}</div>
                    <div className="mt-1 text-2xl font-semibold text-gray-900">{totals[status]}</div>
                    <div className="mt-1 text-xs text-gray-500">{percentage(totals[status])}% of values</div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-gray-200 p-4">
                <div className="mb-3 flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-800">Overall classified distribution</span>
                  <span className="text-gray-500">{classifiedTotal} classified values</span>
                </div>
                <div className="flex h-5 overflow-hidden rounded-full bg-gray-100">
                  {(['below', 'within', 'above'] as RangeStatus[]).map((status) => (
                    totals[status] > 0 && (
                      <div
                        key={status}
                        className={statusStyles[status].bar}
                        style={{ width: `${percentage(totals[status], classifiedTotal)}%` }}
                        title={`${statusStyles[status].label}: ${totals[status]}`}
                      />
                    )
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-600">
                  {(['below', 'within', 'above'] as RangeStatus[]).map((status) => (
                    <span key={status} className="flex items-center gap-1.5">
                      <span className={`h-2.5 w-2.5 rounded-full ${statusStyles[status].bar}`} />
                      {statusStyles[status].label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-gray-200">
                <div className="border-b bg-gray-50 px-4 py-3">
                  <h3 className="font-semibold text-gray-900">Test group and analyte analysis</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                      <tr>
                        <th className="px-4 py-3 text-left">Test group / analyte</th>
                        <th className="px-4 py-3 text-left">Reference range</th>
                        <th className="px-4 py-3 text-center">Below</th>
                        <th className="px-4 py-3 text-center">Within</th>
                        <th className="px-4 py-3 text-center">Above</th>
                        <th className="min-w-64 px-4 py-3 text-left">Distribution</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {analyteSummaries.map((item) => {
                        const total = item.rows.length;
                        const itemKey = `${item.testGroup}::${item.analyte}`;
                        const isExpanded = expandedAnalytes.has(itemKey);
                        return (
                          <React.Fragment key={itemKey}>
                            <tr className="cursor-pointer align-top hover:bg-gray-50" onClick={() => toggleAnalyte(itemKey)}>
                              <td className="px-4 py-3">
                                <span className="mr-2 inline-flex align-middle text-gray-500">
                                  {isExpanded
                                    ? <ChevronDown className="h-4 w-4" />
                                    : <ChevronRight className="h-4 w-4" />}
                                </span>
                                <div className="font-medium text-gray-900">{item.analyte}</div>
                                <div className="text-xs text-gray-500">{item.testGroup}{item.unit ? ` | ${item.unit}` : ''}</div>
                              </td>
                              <td className="px-4 py-3 text-gray-600">{item.referenceRange || 'Not set'}</td>
                              <td className="px-4 py-3 text-center font-medium text-blue-700">{item.below}</td>
                              <td className="px-4 py-3 text-center font-medium text-emerald-700">{item.within}</td>
                              <td className="px-4 py-3 text-center font-medium text-rose-700">{item.above}</td>
                              <td className="px-4 py-3">
                                <div className="flex h-3 overflow-hidden rounded-full bg-gray-100">
                                  {(['below', 'within', 'above', 'unclassified'] as RangeStatus[]).map((status) => (
                                    item[status] > 0 && (
                                      <div
                                        key={status}
                                        className={statusStyles[status].bar}
                                        style={{ width: `${percentage(item[status], total)}%` }}
                                      />
                                    )
                                  ))}
                                </div>
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    downloadExcel(item.rows, item.analyte);
                                  }}
                                  className="mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                                  title={`Download ${item.analyte} analysis`}
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  Excel
                                </button>
                              </td>
                            </tr>
                            {isExpanded && <tr className="bg-gray-50/60">
                              <td colSpan={6} className="px-4 py-2">
                                <div className="flex flex-wrap gap-2">
                                  {item.rows.map((row) => (
                                    <span
                                      key={`${row.order_id}-${row.analyte_name}`}
                                      className={`rounded-full px-2 py-1 text-xs ${statusStyles[row.rangeStatus].badge}`}
                                      title={`${row.patient_name} | ${row.reference_range || 'No reference range'}`}
                                    >
                                      <span className="font-semibold">{row.patient_name}</span>
                                      {' | '}
                                      {row.sample_id || row.order_id.slice(-6)}: {row.value || '-'}{row.unit ? ` ${row.unit}` : ''}
                                    </span>
                                  ))}
                                </div>
                              </td>
                            </tr>}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default B2BResultAnalysisModal;
