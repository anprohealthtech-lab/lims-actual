import { jsPDF } from "jspdf";
import type { ReportTemplateAnalyteRow, ReportTemplateContext } from "./supabase";

export interface CompactGroupDefinition {
  testGroupId: string;
  testName: string;
  analyteCount: number;
  pageNumber?: number;
}

export interface CompactPrintPlan {
  orderedGroupIds?: string[];
  pageAssignments?: Record<string, number>;
  maxClubbedAnalytes?: number;
}

export interface CompactPlannerSuggestion {
  kind: "standalone-large" | "page-starter" | "clubbed" | "manual-shared";
  label: string;
  description: string;
}

interface ResolvedCompactGroup extends CompactGroupDefinition {
  analytes: ReportTemplateAnalyteRow[];
  pageNumber: number;
}

const DEFAULT_MAX_CLUBBED_ANALYTES = 5;

const groupAnalytes = (context: ReportTemplateContext) => {
  const grouped = new Map<string, ReportTemplateAnalyteRow[]>();
  for (const analyte of context.analytes || []) {
    const key = analyte.test_group_id || "ungrouped";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(analyte);
  }
  return grouped;
};

const resolveGroupLabel = (rows: ReportTemplateAnalyteRow[], fallback: string) =>
  rows.find((row) => row.test_name)?.test_name || fallback;

export const buildCompactGroupDefinitions = (
  context: ReportTemplateContext,
  orderedGroupIds?: string[],
): CompactGroupDefinition[] => {
  const grouped = groupAnalytes(context);
  const discoveredIds = [...grouped.keys()];
  const resolvedOrder = [
    ...(orderedGroupIds || []).filter((id) => grouped.has(id)),
    ...discoveredIds.filter((id) => !(orderedGroupIds || []).includes(id)),
  ];

  return resolvedOrder.map((testGroupId) => {
    const rows = grouped.get(testGroupId) || [];
    return {
      testGroupId,
      testName: resolveGroupLabel(rows, `Test Group ${testGroupId}`),
      analyteCount: rows.filter((row) => !!row.parameter).length,
    };
  });
};

export const autoAssignCompactPages = (
  groups: CompactGroupDefinition[],
  maxClubbedAnalytes = DEFAULT_MAX_CLUBBED_ANALYTES,
): Record<string, number> => {
  let currentPage = 1;
  let currentPageCount = 0;
  const assignments: Record<string, number> = {};

  for (const group of groups) {
    const analyteCount = Math.max(group.analyteCount, 1);
    if (analyteCount > maxClubbedAnalytes) {
      if (currentPageCount > 0) {
        currentPage += 1;
      }
      assignments[group.testGroupId] = currentPage;
      currentPage += 1;
      currentPageCount = 0;
      continue;
    }

    if (currentPageCount > 0 && currentPageCount + analyteCount > maxClubbedAnalytes) {
      currentPage += 1;
      currentPageCount = 0;
    }

    assignments[group.testGroupId] = currentPage;
    currentPageCount += analyteCount;
  }

  return assignments;
};

export const resolveCompactPages = (
  context: ReportTemplateContext,
  plan: CompactPrintPlan = {},
): ResolvedCompactGroup[][] => {
  const grouped = groupAnalytes(context);
  const groupDefinitions = buildCompactGroupDefinitions(context, plan.orderedGroupIds);
  const pageAssignments = Object.keys(plan.pageAssignments || {}).length > 0
    ? (plan.pageAssignments as Record<string, number>)
    : autoAssignCompactPages(groupDefinitions, plan.maxClubbedAnalytes || DEFAULT_MAX_CLUBBED_ANALYTES);

  const resolvedGroups: ResolvedCompactGroup[] = groupDefinitions.map((group) => ({
    ...group,
    analytes: grouped.get(group.testGroupId) || [],
    pageNumber: Math.max(1, Number(pageAssignments[group.testGroupId] || 1)),
  }));

  const pageNumbers = [...new Set(resolvedGroups.map((group) => group.pageNumber))].sort((a, b) => a - b);
  return pageNumbers.map((pageNumber) => resolvedGroups.filter((group) => group.pageNumber === pageNumber));
};

export const getCompactPlannerSuggestion = (
  groups: CompactGroupDefinition[],
  targetGroupId: string,
  pageAssignments: Record<string, number>,
  maxClubbedAnalytes = DEFAULT_MAX_CLUBBED_ANALYTES,
): CompactPlannerSuggestion => {
  const target = groups.find((group) => group.testGroupId === targetGroupId);
  if (!target) {
    return {
      kind: "page-starter",
      label: "Page Starter",
      description: "Starts a fresh page.",
    };
  }

  const pageNumber = Math.max(1, Number(pageAssignments[targetGroupId] || 1));
  const pageGroups = groups.filter((group) => Math.max(1, Number(pageAssignments[group.testGroupId] || 1)) === pageNumber);
  const pageTotal = pageGroups.reduce((sum, group) => sum + Math.max(group.analyteCount, 1), 0);

  if (target.analyteCount > maxClubbedAnalytes) {
    return {
      kind: "standalone-large",
      label: "Large Panel",
      description: "Best kept on its own page because it has many analytes.",
    };
  }

  if (pageGroups.length === 1) {
    return {
      kind: "page-starter",
      label: "Page Starter",
      description: "Starts a fresh compact page.",
    };
  }

  if (pageTotal <= maxClubbedAnalytes) {
    return {
      kind: "clubbed",
      label: "Clubbed",
      description: "Grouped with other smaller tests on the same page.",
    };
  }

  return {
    kind: "manual-shared",
    label: "Manual Shared",
    description: "Shared page chosen manually because the page is denser than the auto suggestion.",
  };
};

const wrapText = (doc: jsPDF, text: string, maxWidth: number) =>
  doc.splitTextToSize(String(text || "-"), maxWidth) as string[];

const drawTableHeader = (doc: jsPDF, y: number) => {
  doc.setFillColor(241, 245, 249);
  doc.rect(32, y, 531, 20, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Parameter", 36, y + 13);
  doc.text("Result", 258, y + 13);
  doc.text("Unit", 330, y + 13);
  doc.text("Reference", 392, y + 13);
  doc.text("Flag", 528, y + 13, { align: "right" });
};

export const generateCompactReportPdf = (
  context: ReportTemplateContext,
  plan: CompactPrintPlan = {},
): Blob => {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pages = resolveCompactPages(context, plan);
  const pageHeight = doc.internal.pageSize.getHeight();
  let printedPageNumber = 1;

  const renderPageHeader = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text(context.patient.name || "Patient Report", 32, 36);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(
      `Sample: ${context.order.sampleId || "-"}   Age/Gender: ${context.patient.age ?? "-"} / ${context.patient.gender || "-"}`,
      32,
      54,
    );
    doc.text(
      `Doctor: ${context.order.referringDoctorName || "-"}   Collected: ${context.order.sampleCollectedAt ? new Date(context.order.sampleCollectedAt).toLocaleString("en-IN") : "-"}`,
      32,
      68,
    );
    doc.text(
      `Page ${printedPageNumber}`,
      563,
      36,
      { align: "right" },
    );
    doc.setDrawColor(209, 213, 219);
    doc.line(32, 78, 563, 78);
  };

  pages.forEach((pageGroups, pageIndex) => {
    if (pageIndex > 0) doc.addPage();
    if (pageIndex > 0) printedPageNumber += 1;
    renderPageHeader();

    let y = 98;
    for (const group of pageGroups) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(group.testName, 32, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(`${group.analyteCount} analyte${group.analyteCount === 1 ? "" : "s"}`, 563, y, { align: "right" });
      y += 10;

      drawTableHeader(doc, y);
      y += 22;

      const resultRows = group.analytes.filter((row) => !!row.parameter);
      for (const row of resultRows) {
        const parameterLines = wrapText(doc, `${row.parameter || "-"}${row.is_auto_calculated || row.is_calculated ? " (calc)" : ""}`, 210);
        const resultLines = wrapText(doc, row.value || "-", 58);
        const unitLines = wrapText(doc, row.unit || "-", 48);
        const referenceLines = wrapText(doc, row.reference_range || "-", 120);
        const flagLines = wrapText(doc, row.flag || "-", 32);
        const lineCount = Math.max(parameterLines.length, resultLines.length, unitLines.length, referenceLines.length, flagLines.length);
        const rowHeight = Math.max(18, lineCount * 11 + 6);

        if (y + rowHeight > pageHeight - 44) {
          doc.addPage();
          printedPageNumber += 1;
          renderPageHeader();
          y = 98;
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          doc.text(`${group.testName} (cont.)`, 32, y);
          y += 10;
          drawTableHeader(doc, y);
          y += 22;
        }

        doc.setDrawColor(229, 231, 235);
        doc.rect(32, y - 12, 531, rowHeight);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.text(parameterLines, 36, y);
        doc.text(resultLines, 258, y);
        doc.text(unitLines, 330, y);
        doc.text(referenceLines, 392, y);
        doc.text(flagLines, 528, y, { align: "right" });

        y += rowHeight;
      }

      const interpretationSource = group.analytes.find((row) => row.show_group_interpretation_in_report && row.group_interpretation?.trim());
      if (interpretationSource?.group_interpretation) {
        const interpretationLines = wrapText(doc, interpretationSource.group_interpretation, 515);
        const blockHeight = interpretationLines.length * 11 + 16;
        if (y + blockHeight > pageHeight - 44) {
          doc.addPage();
          printedPageNumber += 1;
          renderPageHeader();
          y = 98;
        }
        doc.setFillColor(248, 250, 252);
        doc.rect(32, y - 8, 531, blockHeight, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.text("Interpretation", 38, y + 4);
        doc.setFont("helvetica", "normal");
        doc.text(interpretationLines, 38, y + 18);
        y += blockHeight + 6;
      }

      y += 12;
    }
  });

  return doc.output("blob");
};

export const openCompactReportPdf = (
  context: ReportTemplateContext,
  plan: CompactPrintPlan = {},
) => {
  const blob = generateCompactReportPdf(context, plan);
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  return url;
};
