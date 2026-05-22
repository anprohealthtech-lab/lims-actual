// Browser-side "Quick Print" PDF builder.
// Mirrors generateBasicDefaultTemplateHtml from the edge function, but renders
// directly via jsPDF + jspdf-autotable instead of going through PDF.co.
//
// Usage:
//   import { printReport } from "./buildPrintPdf";
//   await printReport(reportData);   // opens browser print dialog
//
// Or, to get a Blob:
//   const blob = await buildPrintPdf(reportData);

import { jsPDF } from "jspdf";
import autoTable, { CellHookData } from "jspdf-autotable";

// ─── Types (mirror the shapes already used in the edge fn) ──────────────────

export type CanonicalFlag =
  | "normal"
  | "high"
  | "low"
  | "critical"
  | "critical_high"
  | "critical_low"
  | "abnormal"
  | null;

export interface Analyte {
  parameter?: string;
  name?: string;
  test_name?: string;
  value?: string | number;
  unit?: string;
  reference_range?: string;
  flag?: string | null;
  method?: string;
  section_heading?: string | null;
  sort_order?: number;
  is_calculated?: boolean;
  is_auto_calculated?: boolean;
  value_type?: string;
  specimen?: string;
}

export interface PatientInfo {
  patientName?: string;
  patientId?: string;
  patientAge?: string | number;
  patientGender?: string;
  orderDate?: string;
  reportDate?: string;
  referringDoctorName?: string;
  sampleId?: string;
  collectionDate?: string;
  receivedAt?: string;
  collectionCenter?: string;
}

export interface Signatory {
  name?: string;
  designation?: string;
  imageDataUrl?: string; // pre-fetched as data URL or http URL
}

export interface ReportData {
  orderId: string;
  patient: PatientInfo;
  // Ordered list — each entry is one test group
  groups: Array<{
    groupId: string;
    groupName: string;
    analytes: Analyte[];
  }>;
  signatory?: Signatory;
  letterheadDataUrl?: string | null; // pre-fetched as data URL
  showMethodology?: boolean;
  testNameBold?: boolean;
  boldAbnormal?: boolean;
}

// ─── Helpers ported from index.ts ───────────────────────────────────────────

function formatIndianNumber(val: string | number | undefined): string {
  if (val === undefined || val === null) return "";
  const str = String(val).replace(/,/g, "").trim();
  const num = parseFloat(str);
  if (!Number.isFinite(num) || Math.abs(num) < 1000) return str || String(val);
  return new Intl.NumberFormat("en-IN").format(num);
}

function normalizeFlag(flag?: string | null): CanonicalFlag {
  const raw = String(flag || "").trim();
  if (!raw) return null;
  const norm = raw.toLowerCase().replace(/[-\s]/g, "_").replace(/[^a-z0-9_*]/g, "");

  if (["n", "normal", "ok", "wnl", "within_range"].includes(norm)) return "normal";
  if (["h", "high", "hh", "hi"].includes(norm)) return "high";
  if (["l", "low", "ll"].includes(norm)) return "low";
  if (["critical_high", "critical_h", "criticalh", "h*", "ch"].includes(norm)) return "critical_high";
  if (["critical_low", "critical_l", "criticall", "l*", "cl"].includes(norm)) return "critical_low";
  if (["c", "critical", "crit"].includes(norm)) return "critical";
  if (["a", "abnormal", "abn"].includes(norm)) return "abnormal";
  if (norm.includes("critical") && norm.includes("high")) return "critical_high";
  if (norm.includes("critical") && norm.includes("low")) return "critical_low";
  if (norm.includes("high")) return "high";
  if (norm.includes("low")) return "low";
  return "abnormal";
}

function flagShortLabel(flag: CanonicalFlag): string {
  if (!flag || flag === "normal") return "";
  if (flag === "high") return "H";
  if (flag === "low") return "L";
  if (flag === "critical_high") return "H*";
  if (flag === "critical_low") return "L*";
  if (flag === "abnormal" || flag === "critical") return "A";
  return "";
}

function isDescriptive(a: Analyte): boolean {
  const unitText = String(a.unit || "").trim().toLowerCase();
  const refText = String(a.reference_range || "").trim();
  const hasNumericRef = /\d/.test(refText);
  const valueTypeRaw = String(a.value_type || "").toLowerCase();
  if (valueTypeRaw === "qualitative") return false;
  return (
    unitText === "n/a" || unitText === "na" || unitText === "-" ||
    unitText === "none" || unitText === "not applicable" ||
    (!unitText && !!refText && !hasNumericRef)
  );
}

function groupBySectionHeading(
  analytes: Analyte[],
): { heading: string | null; analytes: Analyte[] }[] {
  const sorted = [...analytes].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const hasHeadings = sorted.some((a) => a.section_heading);
  if (!hasHeadings) return [{ heading: null, analytes: sorted }];

  const blocks: { heading: string | null; analytes: Analyte[] }[] = [];
  let currentHeading: string | null = null;
  let currentBlock: Analyte[] = [];
  for (const a of sorted) {
    const h = a.section_heading ?? null;
    if (h !== currentHeading) {
      if (currentBlock.length) blocks.push({ heading: currentHeading, analytes: currentBlock });
      currentHeading = h;
      currentBlock = [a];
    } else {
      currentBlock.push(a);
    }
  }
  if (currentBlock.length) blocks.push({ heading: currentHeading, analytes: currentBlock });
  return blocks;
}

// ─── Code 128-B barcode → PNG data URL (rendered in an offscreen canvas) ────

const CODE128_PATTERNS = [
  "11011001100","11001101100","11001100110","10010011000","10010001100","10001001100",
  "10011001000","10011000100","10001100100","11001001000","11001000100","11000100100",
  "10110011100","10011011100","10011001110","10111001100","10011101100","10011100110",
  "11001110010","11001011100","11001001110","11011100100","11001110100","11101101110",
  "11101001100","11100101100","11100100110","11101100100","11100110100","11100110010",
  "11011011000","11011000110","11000110110","10100011000","10001011000","10001000110",
  "10110001000","10001101000","10001100010","11010001000","11000101000","11000100010",
  "10110111000","10110001110","10001101110","10111011000","10111000110","10001110110",
  "11101110110","11010001110","11000101110","11011101000","11011100010","11011101110",
  "11101011000","11101000110","11100010110","11101101000","11101100010","11100011010",
  "11101111010","11001000010","11110001010","10100110000","10100001100","10010110000",
  "10010000110","10000101100","10000100110","10110010000","10110000100","10011010000",
  "10011000010","10000110100","10000110010","11000010010","11001010000","11110111010",
  "11000010100","10001111010","10100111100","10010111100","10010011110","10111100100",
  "10011110100","10011110010","11110100100","11110010100","11110010010","11011011110",
  "11011110110","11110110110","10101111000","10100011110","10001011110","10111101000",
  "10111100010","11110101000","11110100010","10111011110","10111101110","11101011110",
  "11110101110","11010000100","11010010000","11010011100","11000111010",
];

function barcodeDataUrl(data: string, widthPx = 200, heightPx = 36): string | null {
  if (!data) return null;
  const START_B = 104;
  const STOP = 106;
  const values: number[] = [START_B];
  let checksum = START_B;
  for (let i = 0; i < data.length; i++) {
    const c = data.charCodeAt(i);
    if (c < 32 || c > 126) continue;
    const v = c - 32;
    values.push(v);
    checksum += (i + 1) * v;
  }
  values.push(checksum % 103);
  values.push(STOP);

  let bits = "";
  for (const v of values) bits += CODE128_PATTERNS[v];
  bits += "11"; // termination bar

  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.fillStyle = "#000";
  const moduleW = widthPx / bits.length;
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === "1") ctx.fillRect(i * moduleW, 0, moduleW + 0.5, heightPx);
  }
  return canvas.toDataURL("image/png");
}

// ─── Color palette (matches the edge fn defaults: red high, orange low) ─────

const COLOR_HIGH: [number, number, number] = [220, 38, 38];   // #dc2626
const COLOR_LOW: [number, number, number]  = [234, 88, 12];   // #ea580c
const COLOR_CRIT: [number, number, number] = [185, 28, 28];   // dark red
const COLOR_MUTED: [number, number, number] = [102, 102, 102]; // #666
const COLOR_BLACK: [number, number, number] = [0, 0, 0];

function flagTextColor(flag: CanonicalFlag): [number, number, number] {
  if (flag === "high") return COLOR_HIGH;
  if (flag === "low") return COLOR_LOW;
  if (flag === "critical_high" || flag === "critical_low" || flag === "critical") return COLOR_CRIT;
  if (flag === "abnormal") return COLOR_HIGH;
  return COLOR_BLACK;
}

// ─── Main builder ───────────────────────────────────────────────────────────

const A4_WIDTH = 210;   // mm
const A4_HEIGHT = 297;  // mm
const MARGIN_X = 12;
const MARGIN_TOP = 16;
const MARGIN_BOTTOM = 18;
const LETTERHEAD_TOP_GAP = 38; // reserved space at top for letterhead image
const LETTERHEAD_BOT_GAP = 22; // reserved space at bottom for footer image

export async function buildPrintPdf(data: ReportData): Promise<Blob> {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN_X * 2;

  const boldAbnormal = data.boldAbnormal ?? true;
  const testNameBold = data.testNameBold ?? true;
  const showMethodology = data.showMethodology ?? true;

  // Pre-rendered images
  const letterhead = data.letterheadDataUrl || null;
  const barcodePng = barcodeDataUrl(data.orderId, 240, 36);

  // ── Per-page chrome (letterhead background + page number) ──
  const drawPageChrome = (pageNum: number, totalPages: number) => {
    if (letterhead) {
      // Letterhead drawn full-bleed; safe area is enforced by margins above
      try {
        doc.addImage(letterhead, "PNG", 0, 0, pageWidth, pageHeight, undefined, "FAST");
      } catch {
        // letterhead may be JPEG — retry
        try { doc.addImage(letterhead, "JPEG", 0, 0, pageWidth, pageHeight, undefined, "FAST"); } catch {}
      }
    }
    doc.setFontSize(8);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(
      `Page ${pageNum} of ${totalPages}`,
      pageWidth - MARGIN_X,
      pageHeight - 6,
      { align: "right" },
    );
  };

  // ── Title bar (TEST REPORT + barcode) ──
  let cursorY = MARGIN_TOP + LETTERHEAD_TOP_GAP;
  doc.setDrawColor(0);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, cursorY, pageWidth - MARGIN_X, cursorY);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...COLOR_BLACK);
  doc.text("TEST REPORT", pageWidth / 2, cursorY + 6, { align: "center" });

  if (barcodePng) {
    doc.addImage(barcodePng, "PNG", pageWidth - MARGIN_X - 34, cursorY + 1, 32, 8);
  }
  cursorY += 9;
  doc.line(MARGIN_X, cursorY, pageWidth - MARGIN_X, cursorY);
  cursorY += 4;

  // ── Patient header (2-column key/value grid) ──
  const p = data.patient;
  const patientRows: Array<[string, string, string, string]> = [
    ["Name",     p.patientName    || "-",        "Reg. No",     p.patientId   || "-"],
    ["Age / Sex", `${p.patientAge ?? "-"} / ${p.patientGender ?? "-"}`, "Reg. Date", p.orderDate || "-"],
    ["Ref. By",  p.referringDoctorName || "-",   "Report Date", p.reportDate  || "-"],
  ];

  autoTable(doc, {
    startY: cursorY,
    margin: { left: MARGIN_X, right: MARGIN_X },
    body: patientRows,
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 0.6, textColor: [17, 17, 17] },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: contentWidth * 0.18 },
      1: { cellWidth: contentWidth * 0.32 },
      2: { fontStyle: "bold", cellWidth: contentWidth * 0.18 },
      3: { cellWidth: contentWidth * 0.32 },
    },
    didParseCell: (hook) => {
      if (hook.column.index === 1 || hook.column.index === 3) {
        hook.cell.text = [": " + hook.cell.raw];
      }
    },
  });
  cursorY = (doc as any).lastAutoTable.finalY + 4;

  // ── Analyte tables, one per group ──
  for (const group of data.groups) {
    if (!group.analytes?.length) continue;

    // Group title strip (centered, underlined, uppercase — matches basic template)
    if (cursorY > pageHeight - MARGIN_BOTTOM - LETTERHEAD_BOT_GAP - 30) {
      doc.addPage();
      cursorY = MARGIN_TOP + LETTERHEAD_TOP_GAP;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...COLOR_BLACK);
    doc.text(
      group.groupName.toUpperCase(),
      pageWidth / 2,
      cursorY + 4,
      { align: "center" },
    );
    // underline
    const titleWidth = doc.getTextWidth(group.groupName.toUpperCase());
    doc.setLineWidth(0.2);
    doc.line(
      pageWidth / 2 - titleWidth / 2,
      cursorY + 5,
      pageWidth / 2 + titleWidth / 2,
      cursorY + 5,
    );
    cursorY += 8;

    // Build rows, expanding section-heading sub-sections inline
    const head = [["TEST NAME", "VALUE", "UNITS", "Bio. Ref. Interval"]];
    const body: any[][] = [];
    // Track which body rows are sub-section headers / which carry flags
    const subHeaderRows = new Set<number>();
    const flagByRow = new Map<number, CanonicalFlag>();

    for (const block of groupBySectionHeading(group.analytes)) {
      if (block.heading) {
        body.push([
          { content: block.heading.toUpperCase(), colSpan: 4 },
          "", "", "",
        ]);
        subHeaderRows.add(body.length - 1);
      }
      for (const a of block.analytes) {
        const parameterName = a.parameter || a.name || a.test_name || "";
        const isCalc = !!(a.is_auto_calculated || a.is_calculated);
        const rawValue = a.value ?? "";
        const valueStr = formatIndianNumber(
          isCalc && rawValue !== "" && !isNaN(Number(rawValue))
            ? String(parseFloat(Number(rawValue).toFixed(2)))
            : (rawValue as any),
        );
        const flag = normalizeFlag(a.flag);
        const flagSuffix = flagShortLabel(flag);
        const display = flagSuffix ? `${valueStr} ${flagSuffix}` : valueStr;

        const testNameCell = showMethodology && a.method
          ? `${parameterName}${isCalc ? " *" : ""}\n${a.method}`
          : `${parameterName}${isCalc ? " *" : ""}`;

        body.push([
          testNameCell,
          display,
          a.unit || "",
          (a.reference_range || "").replace(/\n/g, " "),
        ]);
        flagByRow.set(body.length - 1, flag);
      }
    }

    autoTable(doc, {
      startY: cursorY,
      margin: {
        left: MARGIN_X,
        right: MARGIN_X,
        top: MARGIN_TOP + LETTERHEAD_TOP_GAP,
        bottom: MARGIN_BOTTOM + LETTERHEAD_BOT_GAP,
      },
      head,
      body,
      theme: "plain",
      styles: { fontSize: 9, cellPadding: 1.2, textColor: COLOR_BLACK, lineColor: [229, 229, 229] },
      headStyles: {
        fontStyle: "bold",
        textColor: COLOR_BLACK,
        fillColor: false as any,
        lineWidth: { top: 0.4, bottom: 0.4, left: 0, right: 0 },
        cellPadding: 1.5,
      },
      columnStyles: {
        0: { cellWidth: contentWidth * 0.34 },
        1: { cellWidth: contentWidth * 0.22, halign: "right" },
        2: { cellWidth: contentWidth * 0.12, overflow: "linebreak" },
        3: { cellWidth: contentWidth * 0.32, overflow: "linebreak", textColor: [102, 102, 102] },
      },
      didParseCell: (hook: CellHookData) => {
        const rowIdx = hook.row.index;
        if (hook.section === "body") {
          // Sub-section heading row
          if (subHeaderRows.has(rowIdx)) {
            hook.cell.styles.fontStyle = "bold";
            hook.cell.styles.fontSize = 8.5;
            hook.cell.styles.lineWidth = { top: 0, bottom: 0.2, left: 0, right: 0 } as any;
            return;
          }
          // Dotted bottom border (autotable doesn't do dotted — use a thin solid line)
          hook.cell.styles.lineWidth = { top: 0, bottom: 0.1, left: 0, right: 0 } as any;
          hook.cell.styles.lineColor = [229, 229, 229];

          // Test name column
          if (hook.column.index === 0 && testNameBold) {
            hook.cell.styles.fontStyle = "bold";
          }
          // Value column — flag coloring
          if (hook.column.index === 1) {
            const flag = flagByRow.get(rowIdx);
            if (flag && flag !== "normal") {
              hook.cell.styles.textColor = flagTextColor(flag);
              if (boldAbnormal) hook.cell.styles.fontStyle = "bold";
            }
          }
        }
      },
    });

    cursorY = (doc as any).lastAutoTable.finalY + 4;
  }

  // ── Signature footer (drawn on the final page only) ──
  if (data.signatory) {
    const footerY = Math.max(cursorY + 8, pageHeight - MARGIN_BOTTOM - LETTERHEAD_BOT_GAP - 22);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(...COLOR_MUTED);
    doc.text("Authenticated Electronic Report", MARGIN_X, footerY + 18);

    if (data.signatory.imageDataUrl) {
      try {
        doc.addImage(data.signatory.imageDataUrl, "PNG", pageWidth - MARGIN_X - 35, footerY, 35, 12);
      } catch {
        try { doc.addImage(data.signatory.imageDataUrl, "JPEG", pageWidth - MARGIN_X - 35, footerY, 35, 12); } catch {}
      }
    }
    if (data.signatory.name) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...COLOR_BLACK);
      doc.text(data.signatory.name, pageWidth - MARGIN_X, footerY + 16, { align: "right" });
    }
    if (data.signatory.designation) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...COLOR_MUTED);
      doc.text(data.signatory.designation, pageWidth - MARGIN_X, footerY + 20, { align: "right" });
    }
  }

  // ── Stamp page chrome onto every page (letterhead + page numbers) ──
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    drawPageChrome(i, total);
  }

  return doc.output("blob");
}

// ─── Convenience: open native print dialog ──────────────────────────────────

export async function printReport(data: ReportData): Promise<void> {
  const blob = await buildPrintPdf(data);
  const url = URL.createObjectURL(blob);
  const w = window.open(url);
  if (!w) {
    // popup blocked — fall back to download
    const a = document.createElement("a");
    a.href = url;
    a.download = `Report_${data.orderId}.pdf`;
    a.click();
    return;
  }
  w.addEventListener("load", () => {
    try { w.print(); } catch { /* user-initiated print only on some browsers */ }
  });
  // Revoke later so the print preview has time to load
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
