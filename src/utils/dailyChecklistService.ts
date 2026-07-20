// utils/dailyChecklistService.ts
// Daily Checklist (MIS-style invoice summary) — barcoded list of the day's
// orders with per-investigation TAT and status, printable from a new window.

import { database, supabase, formatAge } from './supabase';

export type ChecklistTestStatus = 'Pending' | 'In Progress' | 'Done' | 'Verified';

export interface ChecklistInvestigation {
  testName: string;
  status: ChecklistTestStatus;
}

export interface ChecklistOrder {
  orderId: string;
  slNo: number;
  invoice: string;
  accountName: string | null;
  dateTime: string;
  barcodeValue: string;
  barcodeDataUrl: string;
  patientName: string;
  patientAgeGender: string;
  refDoctor: string;
  investigations: ChecklistInvestigation[];
}

export interface ChecklistFilters {
  dateFrom: string; // yyyy-mm-dd (order_date)
  dateTo: string;   // yyyy-mm-dd
  pendingOnly?: boolean;
  doctor?: string;    // exact match on orders.doctor
  accountId?: string; // B2B account (orders.account_id)
}

export interface ChecklistFilterOptions {
  doctors: string[];
  accounts: { id: string; name: string }[];
}

/**
 * Load dropdown options for the checklist filters:
 * distinct referring doctors seen on recent orders + the lab's B2B accounts.
 */
export async function fetchChecklistFilterOptions(): Promise<ChecklistFilterOptions> {
  const lab_id = await database.getCurrentUserLabId();
  if (!lab_id) return { doctors: [], accounts: [] };

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - 180);
  const since = sinceDate.toLocaleDateString('en-CA');

  const [doctorRes, accountRes] = await Promise.all([
    supabase
      .from('orders')
      .select('doctor')
      .eq('lab_id', lab_id)
      .gte('order_date', since)
      .not('doctor', 'is', null)
      .limit(5000),
    supabase
      .from('accounts')
      .select('id, name')
      .eq('lab_id', lab_id)
      .order('name'),
  ]);

  const doctors = Array.from(
    new Set(
      (doctorRes.data || [])
        .map((r: any) => String(r.doctor || '').trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));

  return {
    doctors,
    accounts: (accountRes.data || []).map((a: any) => ({ id: a.id, name: a.name })),
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mapPanelStatus(panelStatus: string | null | undefined): ChecklistTestStatus {
  switch ((panelStatus || '').toLowerCase().replace(/\s+/g, '_')) {
    case 'verified':
      return 'Verified';
    case 'complete':
    case 'completed':
    case 'pending_approval':
      return 'Done';
    case 'in_progress':
    case 'partial':
      return 'In Progress';
    default:
      return 'Pending';
  }
}

function formatOrderDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-GB'); // dd/mm/yyyy
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${date} ${time}`;
}

/**
 * Fetch the checklist rows for a date range (order_date based),
 * scoped to the current user's lab and allowed locations.
 */
export async function fetchDailyChecklistData(filters: ChecklistFilters): Promise<ChecklistOrder[]> {
  const lab_id = await database.getCurrentUserLabId();
  if (!lab_id) throw new Error('No lab found for current user');

  let query = supabase
    .from('orders')
    .select(`
      id, order_number, order_display, sample_id, tube_barcode, created_at, order_date,
      patient_name, doctor, status, location_id,
      accounts(name),
      patients(name, age, gender, age_unit),
      order_tests(id, test_group_id, test_name)
    `)
    .eq('lab_id', lab_id)
    .gte('order_date', filters.dateFrom)
    .lte('order_date', filters.dateTo)
    .order('created_at', { ascending: true });

  if (filters.doctor) {
    query = query.eq('doctor', filters.doctor);
  }
  if (filters.accountId) {
    query = query.eq('account_id', filters.accountId);
  }

  const { shouldFilter, locationIds } = await database.shouldFilterByLocation();
  if (shouldFilter && locationIds.length > 0) {
    query = query.in('location_id', locationIds);
  }

  const { data: rows, error } = await query;
  if (error) throw error;

  const orderRows = (rows || []) as any[];
  if (orderRows.length === 0) return [];

  // Per-test progress from the enhanced progress view
  const orderIds = orderRows.map((o) => o.id);
  const { data: prog, error: pErr } = await supabase
    .from('v_order_test_progress_enhanced')
    .select('order_id, test_group_id, test_group_name, panel_status')
    .in('order_id', orderIds);
  if (pErr) console.error('Daily checklist progress view error:', pErr);

  const progressMap = new Map<string, any>();
  (prog || []).forEach((r: any) => {
    if (r.test_group_id) progressMap.set(`${r.order_id}:${r.test_group_id}`, r);
    if (r.test_group_name) progressMap.set(`${r.order_id}:name:${String(r.test_group_name).toLowerCase()}`, r);
  });

  // Barcode rendering (Code 128) — same library used for tube labels
  const { default: JsBarcode } = await import('jsbarcode');
  const renderBarcode = (value: string): string => {
    if (!value) return '';
    try {
      const canvas = document.createElement('canvas');
      JsBarcode(canvas, value, {
        format: 'CODE128',
        width: 2,
        height: 48,
        displayValue: true,
        fontSize: 13,
        margin: 4,
        background: '#ffffff',
        lineColor: '#000000',
      });
      return canvas.toDataURL('image/png');
    } catch (e) {
      console.error('Daily checklist barcode error:', e);
      return '';
    }
  };

  const result: ChecklistOrder[] = [];
  let sl = 0;

  for (const o of orderRows) {
    const patient = Array.isArray(o.patients) ? o.patients[0] : o.patients;
    const account = Array.isArray(o.accounts) ? o.accounts[0] : o.accounts;

    let investigations: ChecklistInvestigation[] = (o.order_tests || []).map((t: any) => {
      const p =
        progressMap.get(`${o.id}:${t.test_group_id}`) ||
        progressMap.get(`${o.id}:name:${String(t.test_name || '').toLowerCase()}`);
      return {
        testName: t.test_name || '',
        status: mapPanelStatus(p?.panel_status),
      };
    });

    if (filters.pendingOnly) {
      investigations = investigations.filter((i) => i.status === 'Pending' || i.status === 'In Progress');
      if (investigations.length === 0) continue;
    }
    if (investigations.length === 0) continue;

    sl += 1;
    const barcodeValue = o.sample_id || o.tube_barcode || o.order_display || (o.order_number != null ? String(o.order_number) : '');
    const genderShort = patient?.gender ? String(patient.gender).charAt(0).toUpperCase() : '';
    const ageStr = patient?.age != null ? formatAge(patient.age, patient.age_unit) : '';

    result.push({
      orderId: o.id,
      slNo: sl,
      invoice: o.order_display || (o.order_number != null ? `ORD-${o.order_number}` : o.id.slice(0, 8)),
      accountName: account?.name || null,
      dateTime: formatOrderDateTime(o.created_at),
      barcodeValue,
      barcodeDataUrl: renderBarcode(barcodeValue),
      patientName: patient?.name || o.patient_name || '',
      patientAgeGender: [ageStr, genderShort].filter(Boolean).join('/').toUpperCase(),
      refDoctor: o.doctor || 'SELF',
      investigations,
    });
  }

  return result;
}

const STATUS_COLORS: Record<ChecklistTestStatus, string> = {
  Pending: '#dc2626',
  'In Progress': '#d97706',
  Done: '#2563eb',
  Verified: '#16a34a',
};

/**
 * Build the printable Daily Checklist HTML (opens with its own Print button).
 */
export function generateDailyChecklistHTML(
  orders: ChecklistOrder[],
  options: {
    labName?: string;
    dateFrom: string;
    dateTo: string;
    pendingOnly?: boolean;
    doctorLabel?: string;
    accountLabel?: string;
  }
): string {
  const totalTests = orders.reduce((n, o) => n + o.investigations.length, 0);
  const pendingTests = orders.reduce(
    (n, o) => n + o.investigations.filter((i) => i.status === 'Pending' || i.status === 'In Progress').length,
    0
  );

  const rangeLabel =
    options.dateFrom === options.dateTo
      ? new Date(`${options.dateFrom}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      : `${new Date(`${options.dateFrom}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} to ${new Date(`${options.dateTo}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;

  const bodyRows = orders
    .map((o) => {
      const span = o.investigations.length;
      return o.investigations
        .map((inv, idx) => {
          const statusColor = STATUS_COLORS[inv.status];
          const orderCells =
            idx === 0
              ? `
            <td rowspan="${span}" class="c-sl">${o.slNo}</td>
            <td rowspan="${span}" class="c-invoice">${escapeHtml(o.invoice)}</td>
            <td rowspan="${span}" class="c-b2b">${escapeHtml(o.accountName || '')}</td>
            <td rowspan="${span}" class="c-datetime">${escapeHtml(o.dateTime)}</td>
            <td rowspan="${span}" class="c-barcode">${o.barcodeDataUrl ? `<img src="${o.barcodeDataUrl}" alt="${escapeHtml(o.barcodeValue)}" />` : escapeHtml(o.barcodeValue)}</td>
            <td rowspan="${span}" class="c-patient"><strong>${escapeHtml(o.patientName)}</strong>${o.patientAgeGender ? `<br /><span class="muted">(${escapeHtml(o.patientAgeGender)})</span>` : ''}</td>
            <td rowspan="${span}" class="c-doctor">${escapeHtml(o.refDoctor)}</td>`
              : '';
          return `
          <tr class="${idx === 0 ? 'order-start' : ''}">
            ${orderCells}
            <td class="c-test">${escapeHtml(inv.testName)}<div class="write-space"></div></td>
            <td class="c-status" style="color:${statusColor};">${inv.status} <span class="checkbox"></span></td>
          </tr>`;
        })
        .join('');
    })
    .join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Daily Checklist ${escapeHtml(rangeLabel)}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: A4 portrait; margin: 8mm; }
  html, body { margin: 0; padding: 0; background: #fff; color: #111; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; }
  .toolbar { display: flex; gap: 8px; padding: 10px 12px; background: #f3f4f6; border-bottom: 1px solid #d1d5db; position: sticky; top: 0; }
  .toolbar button { padding: 6px 16px; font-size: 13px; font-weight: 600; border: 1px solid #2563eb; background: #2563eb; color: #fff; border-radius: 6px; cursor: pointer; }
  .toolbar button:hover { background: #1d4ed8; }
  .report { padding: 10px 12px; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  .meta { font-size: 11px; color: #374151; margin-bottom: 8px; }
  .meta strong { color: #111; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #9ca3af; padding: 3px 5px; vertical-align: top; text-align: left; }
  th { background: #f3f4f6; font-size: 10px; text-transform: uppercase; letter-spacing: 0.02em; }
  tr.order-start td { border-top: 2px solid #4b5563; }
  .c-sl { width: 22px; text-align: center; }
  .c-invoice { width: 76px; word-break: break-all; }
  .c-b2b { width: 64px; }
  .c-datetime { width: 70px; }
  .c-barcode { width: 170px; text-align: center; vertical-align: middle; }
  .c-barcode img { max-width: 168px; height: auto; }
  .c-patient { width: 105px; }
  .c-doctor { width: 76px; }
  .c-status { width: 82px; font-weight: 700; white-space: nowrap; }
  .c-test .write-space { height: 22px; }
  .muted { color: #6b7280; font-weight: 400; }
  .checkbox { display: inline-block; width: 10px; height: 10px; border: 1.2px solid #6b7280; vertical-align: middle; margin-left: 5px; }
  tr { page-break-inside: avoid; }
  @media print {
    .toolbar { display: none !important; }
    .report { padding: 0; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button onclick="window.print()">🖨️ Print</button>
  </div>
  <div class="report">
    <h1>Daily Checklist — Invoice Summary</h1>
    <div class="meta">
      ${options.labName ? `<strong>${escapeHtml(options.labName)}</strong> &nbsp;|&nbsp; ` : ''}
      <strong>${escapeHtml(rangeLabel)}</strong>
      ${options.doctorLabel ? ` &nbsp;|&nbsp; Doctor: <strong>${escapeHtml(options.doctorLabel)}</strong>` : ''}
      ${options.accountLabel ? ` &nbsp;|&nbsp; B2B: <strong>${escapeHtml(options.accountLabel)}</strong>` : ''}
      ${options.pendingOnly ? ' &nbsp;|&nbsp; Pending investigations only' : ''}
      &nbsp;|&nbsp; Orders: <strong>${orders.length}</strong>
      &nbsp;|&nbsp; Investigations: <strong>${totalTests}</strong>
      &nbsp;|&nbsp; Pending: <strong style="color:#dc2626;">${pendingTests}</strong>
      &nbsp;|&nbsp; Generated: ${escapeHtml(new Date().toLocaleString('en-GB'))}
    </div>
    <table>
      <thead>
        <tr>
          <th class="c-sl">SL</th>
          <th class="c-invoice">Invoice</th>
          <th class="c-b2b">B2B</th>
          <th class="c-datetime">Date &amp; Time</th>
          <th class="c-barcode">Barcode</th>
          <th class="c-patient">Patient Name</th>
          <th class="c-doctor">Ref. Doctor</th>
          <th class="c-test">Investigation</th>
          <th class="c-status">Status ✓</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows || '<tr><td colspan="9" style="text-align:center; padding: 16px;">No orders found for the selected date range.</td></tr>'}
      </tbody>
    </table>
  </div>
</body>
</html>`;
}

/**
 * Open the checklist in a new window ready to print.
 */
export function openDailyChecklistWindow(html: string): void {
  const win = window.open('', '_blank');
  if (!win) {
    throw new Error('Popup blocked. Please allow popups to print the daily checklist.');
  }
  win.document.write(html);
  win.document.close();
  win.focus();
}

/**
 * Export the checklist rows as a CSV (Excel-compatible) download.
 */
export function exportDailyChecklistCSV(orders: ChecklistOrder[], dateFrom: string, dateTo: string): void {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines: string[] = [
    ['SL', 'Invoice', 'B2B', 'Date & Time', 'Barcode', 'Patient Name', 'Age/Gender', 'Ref. Doctor', 'Investigation', 'Status']
      .map(esc)
      .join(','),
  ];
  for (const o of orders) {
    for (const inv of o.investigations) {
      lines.push(
        [o.slNo, o.invoice, o.accountName || '', o.dateTime, o.barcodeValue, o.patientName, o.patientAgeGender, o.refDoctor, inv.testName, inv.status]
          .map(esc)
          .join(',')
      );
    }
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `daily-checklist-${dateFrom}${dateTo !== dateFrom ? `-to-${dateTo}` : ''}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
