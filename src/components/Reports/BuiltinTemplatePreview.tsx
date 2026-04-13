import React, { useMemo } from 'react';

export interface BuiltinPrintOptions {
  tableBorders?: boolean;
  flagColumn?: boolean;
  alternateRows?: boolean;
  headerBackground?: string;
  baseFontSize?: number;
  flagAsterisk?: boolean;
  flagAsteriskCritical?: boolean;
  boldAllValues?: boolean;
  boldAbnormalValues?: boolean;
}

export interface PreviewAnalyte {
  parameter: string;
  value: string;
  unit: string;
  reference_range: string;
  flag: string;
  method?: string;
  interpretation_high?: string;
  interpretation_low?: string;
  interpretation_normal?: string;
  section_heading?: string;
  sort_order?: number;
}

interface Props {
  style: 'beautiful' | 'classic';
  showMethodology: boolean;
  showInterpretation: boolean;
  printOptions?: BuiltinPrintOptions;
  customAnalytes?: PreviewAnalyte[];
  testGroupName?: string;
}

// ── Sample CBC data ───────────────────────────────────────────────────────────
const SAMPLE_ANALYTES: PreviewAnalyte[] = [
  { parameter: 'Hemoglobin',            value: '8.2',   unit: 'g/dL',    reference_range: '13.5 – 17.5',    flag: 'low',  method: 'Photometry', interpretation_low: 'Low — Risk of Anemia',       section_heading: 'Red Blood Cell Indices', sort_order: 1 },
  { parameter: 'Red Blood Cell Count',  value: '4.5',   unit: '10⁶/µL', reference_range: '4.5 – 5.9',      flag: '',     method: 'Impedance',  section_heading: 'Red Blood Cell Indices', sort_order: 2 },
  { parameter: 'Hematocrit',            value: '27.1',  unit: '%',       reference_range: '42 – 52',         flag: 'low',  method: '',           interpretation_low: 'Low',                section_heading: 'Red Blood Cell Indices', sort_order: 3 },
  { parameter: 'MCV',                   value: '60.2',  unit: 'fL',      reference_range: '78 – 100',        flag: 'low',  method: '',           interpretation_low: 'Microcytic',         section_heading: 'Red Blood Cell Indices', sort_order: 4 },
  { parameter: 'Total Leukocyte Count', value: '12800', unit: '/cmm',    reference_range: '4000 – 10500',   flag: 'high', method: 'Impedance',  interpretation_high: 'Leukocytosis',      section_heading: 'White Blood Cell Differential', sort_order: 5 },
  { parameter: 'Neutrophils (%)',       value: '72',    unit: '%',       reference_range: '50 – 80',         flag: '',     method: '',           section_heading: 'White Blood Cell Differential', sort_order: 6 },
  { parameter: 'Lymphocytes (%)',       value: '20',    unit: '%',       reference_range: '25 – 50',         flag: 'low',  method: '',           interpretation_low: 'Lymphopenia',        section_heading: 'White Blood Cell Differential', sort_order: 7 },
  { parameter: 'Platelet Count',        value: '420000',unit: '/cmm',   reference_range: '150000 – 450000', flag: '',     method: 'Impedance',  section_heading: 'Platelet', sort_order: 8 },
  { parameter: 'ESR (After 1 hour)',    value: '38',    unit: 'mm/hr',   reference_range: '0 – 13',          flag: 'high', method: 'Westergren', interpretation_high: 'Elevated — Inflammation / Infection', section_heading: 'ESR', sort_order: 9 },
];

function normalizeFlag(flag: string): string {
  const f = (flag || '').toLowerCase().trim();
  if (f === 'high' || f === 'h') return 'high';
  if (f === 'low'  || f === 'l') return 'low';
  if (f === 'critical_high' || f === 'ch') return 'critical_high';
  if (f === 'critical_low'  || f === 'cl') return 'critical_low';
  return f;
}

function buildHtml(
  templateStyle: 'beautiful' | 'classic',
  showMethodology: boolean,
  showInterpretation: boolean,
  opts: BuiltinPrintOptions,
  analytes: PreviewAnalyte[],
  testGroupName: string,
): string {
  const basePx   = Math.max(8, Math.min(24, opts.baseFontSize ?? 13));
  const smallPx  = basePx - 2;
  const borders  = opts.tableBorders !== false;
  const showFlag = opts.flagColumn !== false;
  const altRows  = opts.alternateRows !== false;
  const headerBg = opts.headerBackground || (templateStyle === 'beautiful' ? '#0b4aa2' : '#4b5563');
  const isBeautiful = templateStyle === 'beautiful';

  const cellBorder = borders ? `border: 1px solid #d1d5db;` : `border: none; border-bottom: 1px solid #f3f4f6;`;
  const theadBorder = borders ? `border-bottom: 2px solid #9ca3af;` : '';

  const highColor   = '#b42318';
  const lowColor    = '#b54708';
  const normalColor = isBeautiful ? '#027a48' : '#111';
  const boldAbnormal = opts.boldAbnormalValues !== false;
  const boldAll      = opts.boldAllValues !== false;

  // Group analytes by section_heading
  const sorted = [...analytes].sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
  const blocks: { heading: string | null; rows: PreviewAnalyte[] }[] = [];
  let curHeading: string | null = null;
  let curRows: PreviewAnalyte[] = [];
  for (const a of sorted) {
    const h = a.section_heading || null;
    if (h !== curHeading) {
      if (curRows.length) blocks.push({ heading: curHeading, rows: curRows });
      curHeading = h;
      curRows = [];
    }
    curRows.push(a);
  }
  if (curRows.length) blocks.push({ heading: curHeading, rows: curRows });

  let rowsHtml = '';
  let rowIdx = 0;
  const colSpan = showFlag ? 5 : 4;

  for (const block of blocks) {
    if (block.heading) {
      rowsHtml += `
        <tr>
          <td colspan="${colSpan}" style="
            padding: 8px 8px 3px;
            font-size: ${smallPx}px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #6b7280;
            ${borders ? 'border: 1px solid #e5e7eb;' : 'border: none;'}
            background: #f9fafb;
          ">${block.heading}</td>
        </tr>`;
    }

    for (const analyte of block.rows) {
      const canon = normalizeFlag(analyte.flag);
      const isHigh = canon === 'high' || canon === 'critical_high';
      const isLow  = canon === 'low'  || canon === 'critical_low';
      const valColor = isBeautiful
        ? (isHigh ? highColor : isLow ? lowColor : normalColor)
        : '#111';
      const valWeight = (boldAbnormal && (isHigh || isLow)) ? '700' : boldAll ? '600' : 'normal';
      const flagText = isHigh
        ? (canon === 'critical_high' ? 'H*' : 'H')
        : isLow
          ? (canon === 'critical_low' ? 'L*' : 'L')
          : '';
      const asterisk = opts.flagAsterisk && flagText
        ? (opts.flagAsteriskCritical && (canon === 'critical_high' || canon === 'critical_low') ? '**' : '*')
        : '';
      const rowBg = altRows && rowIdx % 2 === 1 ? '#f9fafb' : '#ffffff';
      rowIdx++;

      const methodHtml = showMethodology && analyte.method
        ? `<div style="font-size:${smallPx}px;color:#6b7280;font-style:italic;margin-top:1px;">${analyte.method}</div>`
        : '';
      const interpText = isHigh ? analyte.interpretation_high : isLow ? analyte.interpretation_low : analyte.interpretation_normal;
      const interpHtml = showInterpretation && interpText
        ? `<div style="font-size:${smallPx}px;color:#4b5563;font-style:italic;margin-top:1px;">${interpText}</div>`
        : '';

      const flagTd = showFlag
        ? `<td style="padding:6px 8px;${cellBorder}font-size:${basePx}px;text-align:center;font-weight:700;color:${isBeautiful ? valColor : '#111'};background:${rowBg};">${flagText}</td>`
        : '';

      rowsHtml += `
        <tr style="background:${rowBg};">
          <td style="padding:6px 8px;${cellBorder}font-size:${basePx}px;">
            <span style="font-weight:600;">${analyte.parameter}</span>
            ${methodHtml}${interpHtml}
          </td>
          <td style="padding:6px 8px;${cellBorder}font-size:${basePx}px;text-align:right;font-weight:${valWeight};color:${valColor};">
            ${analyte.value}${asterisk}
          </td>
          <td style="padding:6px 8px;${cellBorder}font-size:${basePx}px;color:#4b5563;">${analyte.unit}</td>
          <td style="padding:6px 8px;${cellBorder}font-size:${smallPx + 1}px;color:#6b7280;text-align:right;">${analyte.reference_range}</td>
          ${flagTd}
        </tr>`;
    }
  }

  const flagNote = opts.flagAsterisk
    ? `<p style="font-size:${smallPx}px;color:#6b7280;margin:6px 0 0;font-style:italic;">* Abnormal value${opts.flagAsteriskCritical ? ' &nbsp;·&nbsp; ** Critical value' : ''}</p>`
    : '';

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:${basePx}px;color:#111;line-height:1.4;">
      <h2 style="text-align:center;font-size:${basePx + 3}px;border-top:2px solid #000;border-bottom:2px solid #000;padding:6px 0;margin:0 0 10px;font-weight:700;">TEST REPORT</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:10px;font-size:${basePx}px;">
        <tbody>
          <tr>
            <td style="padding:2px 6px;font-weight:700;white-space:nowrap;">Name</td>
            <td style="padding:2px 6px;">: John Doe</td>
            <td style="padding:2px 6px;font-weight:700;white-space:nowrap;">Reg. No</td>
            <td style="padding:2px 6px;">: LB-2026-00142</td>
          </tr>
          <tr>
            <td style="padding:2px 6px;font-weight:700;">Age / Sex</td>
            <td style="padding:2px 6px;">: 42Y / Male</td>
            <td style="padding:2px 6px;font-weight:700;">Ref. By</td>
            <td style="padding:2px 6px;">: Dr. A. Sharma</td>
          </tr>
          <tr>
            <td style="padding:2px 6px;font-weight:700;">Report Date</td>
            <td style="padding:2px 6px;">: 10-Apr-2026</td>
            <td style="padding:2px 6px;font-weight:700;">Sample ID</td>
            <td style="padding:2px 6px;">: SMP-2026-1042</td>
          </tr>
        </tbody>
      </table>

      <p style="text-align:center;font-weight:700;text-transform:uppercase;font-size:${basePx + 1}px;text-decoration:underline;margin:10px 0 4px;">${testGroupName}</p>

      <table style="width:100%;border-collapse:collapse;${borders ? 'border:1px solid #d1d5db;' : ''}">
        <thead>
          <tr style="${theadBorder}">
            <th style="padding:7px 8px;background:${headerBg};color:#fff;text-align:left;font-size:${basePx}px;${cellBorder}">Test Parameter</th>
            <th style="padding:7px 8px;background:${headerBg};color:#fff;text-align:right;font-size:${basePx}px;${cellBorder}">Result</th>
            <th style="padding:7px 8px;background:${headerBg};color:#fff;text-align:left;font-size:${basePx}px;${cellBorder}">Unit</th>
            <th style="padding:7px 8px;background:${headerBg};color:#fff;text-align:right;font-size:${basePx}px;${cellBorder}">Bio. Ref. Interval</th>
            ${showFlag ? `<th style="padding:7px 8px;background:${headerBg};color:#fff;text-align:center;font-size:${basePx}px;${cellBorder}">Flag</th>` : ''}
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
      ${flagNote}
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:24px;padding-top:8px;border-top:1px solid #e5e7eb;">
        <div style="font-size:${smallPx}px;color:#6b7280;font-style:italic;">Authenticated Electronic Report</div>
        <div style="text-align:right;">
          <div style="font-weight:700;font-size:${basePx}px;">Dr. Signatory Name</div>
          <div style="font-size:${smallPx}px;color:#4b5563;">MD Pathology</div>
        </div>
      </div>
    </div>`;
}

// ── Toggle ────────────────────────────────────────────────────────────────────
function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-500 disabled:opacity-40 ${checked ? 'bg-indigo-600' : 'bg-gray-300'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-1'}`} />
    </button>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-gray-100 last:border-0">
      <div>
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0 flex items-center">{children}</div>
    </div>
  );
}

// ── Main export ──────────────────────────────────────────────────────────────
export default function BuiltinTemplatePreview({
  style,
  showMethodology,
  showInterpretation,
  printOptions = {},
  customAnalytes,
  testGroupName,
}: Props) {
  const analytes  = customAnalytes && customAnalytes.length > 0 ? customAnalytes : SAMPLE_ANALYTES;
  const groupName = testGroupName || (customAnalytes && customAnalytes.length > 0 ? 'Test Results' : 'Complete Blood Count (CBC)');
  const label     = style === 'beautiful' ? 'Beautiful (3-Band Color)' : 'Classic (Plain Table)';
  const subLabel  = style === 'beautiful'
    ? 'Blue header · Green normal · Red high · Orange low · sample data'
    : 'Plain header · No colour coding · sample data';

  const [localOpts, setLocalOpts]           = React.useState<BuiltinPrintOptions>(printOptions);
  const [localMethodology, setLocalMethodology]     = React.useState(showMethodology);
  const [localInterpretation, setLocalInterpretation] = React.useState(showInterpretation);

  React.useEffect(() => { setLocalOpts(printOptions); }, [JSON.stringify(printOptions)]);
  React.useEffect(() => { setLocalMethodology(showMethodology); }, [showMethodology]);
  React.useEffect(() => { setLocalInterpretation(showInterpretation); }, [showInterpretation]);

  const setPO = (patch: Partial<BuiltinPrintOptions>) =>
    setLocalOpts(prev => ({ ...prev, ...patch }));

  const html = useMemo(
    () => buildHtml(style, localMethodology, localInterpretation, localOpts, analytes, groupName),
    [style, localMethodology, localInterpretation, localOpts, analytes, groupName],
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
        <span className="text-sm font-semibold text-gray-800">{label} — Live Preview</span>
        <span className="ml-2 text-xs text-gray-400">{subLabel}</span>
      </div>

      <div className="flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-gray-200">
        {/* Options panel */}
        <div className="lg:w-64 shrink-0 p-4 space-y-0.5">
          <Row label="Show Methodology" hint="Italic method below test name">
            <Toggle checked={localMethodology} onChange={setLocalMethodology} />
          </Row>
          <Row label="Show Interpretation" hint="Italic text below flagged rows">
            <Toggle checked={localInterpretation} onChange={setLocalInterpretation} />
          </Row>
          <Row label="Table Borders" hint="Show borders around cells">
            <Toggle checked={localOpts.tableBorders !== false} onChange={(v) => setPO({ tableBorders: v })} />
          </Row>
          <Row label="Flag Column" hint="Show H / L flag column">
            <Toggle checked={localOpts.flagColumn !== false} onChange={(v) => setPO({ flagColumn: v })} />
          </Row>
          <Row label="Alternate Row Shading" hint="Light grey on every other row">
            <Toggle checked={localOpts.alternateRows !== false} onChange={(v) => setPO({ alternateRows: v })} />
          </Row>
          <Row label="Bold Abnormal Values" hint="Extra bold for H / L values">
            <Toggle checked={localOpts.boldAbnormalValues !== false} onChange={(v) => setPO({ boldAbnormalValues: v })} />
          </Row>
          <Row label="Flag Asterisk (*)" hint="Append * to H/L values">
            <Toggle
              checked={!!localOpts.flagAsterisk}
              onChange={(v) => setPO({ flagAsterisk: v, flagAsteriskCritical: v ? localOpts.flagAsteriskCritical : false })}
            />
          </Row>
          <Row label="Critical Double (**)" hint="** for critical values">
            <Toggle
              checked={!!localOpts.flagAsteriskCritical}
              disabled={!localOpts.flagAsterisk}
              onChange={(v) => setPO({ flagAsteriskCritical: v })}
            />
          </Row>
          <Row label="Base Font Size" hint="8 – 24 px">
            <div className="flex items-center gap-2">
              <input
                type="range" min={8} max={24} step={1}
                value={localOpts.baseFontSize ?? 13}
                onChange={(e) => setPO({ baseFontSize: Number(e.target.value) })}
                className="w-20 accent-indigo-600"
              />
              <span className="w-6 text-sm font-mono font-semibold text-gray-700">
                {localOpts.baseFontSize ?? 13}
              </span>
            </div>
          </Row>
          <Row label="Header Color" hint="Table header background colour">
            <input
              type="color"
              value={localOpts.headerBackground || (style === 'beautiful' ? '#0b4aa2' : '#4b5563')}
              onChange={(e) => setPO({ headerBackground: e.target.value })}
              className="h-7 w-10 rounded border border-gray-300 cursor-pointer"
            />
          </Row>
          <p className="text-xs text-gray-400 pt-2 italic">
            Preview-only sliders — apply changes via the form fields above to persist them.
          </p>
        </div>

        {/* Preview */}
        <div className="flex-1 p-5 bg-gray-50 overflow-auto" style={{ maxHeight: 580 }}>
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  );
}
