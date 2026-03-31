/**
 * pdfViewerService.ts
 * 
 * Lightweight PDF viewer service for the "View" button functionality.
 * Generates preview PDFs directly from JS data without heavy PDF.co API calls.
 * Uses jsPDF for direct JS-to-PDF generation.
 * 
 * Features:
 * - Lab header/footer from database
 * - Test results table
 * - Trend graphs (if enabled)
 * - Clinical summary (if enabled)
 * - Attachments marked for report inclusion
 * 
 * This is optimized for quick preview/viewing, not final report generation.
 */

import { jsPDF } from 'jspdf';
import { supabase, database, formatAge } from './supabase';
import type { ReportTemplateAnalyteRow } from './supabase';
import { getReportExtrasForOrder, type ReportExtras } from './reportExtrasService';

// ============ Types ============

export interface ViewerReportData {
  patient: {
    name: string;
    id: string;
    age: number;
    gender: string;
    phone?: string;
    referredBy?: string;
  };
  order: {
    orderId: string;
    sampleId?: string;
    sampleCollectedAt?: string;
    sampleCollectedBy?: string;
    locationName?: string;
    orderDate?: string;
  };
  lab: {
    id?: string;
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    headerHtml?: string | null;
    footerHtml?: string | null;
    headerUrl?: string | null;  // Image URL from lab_branding_assets
    footerUrl?: string | null;  // Image URL from lab_branding_assets
    signatureUrl?: string | null; // Signature image URL
  };
  testResults: Array<{
    parameter: string;
    result: string;
    unit: string;
    referenceRange: string;
    flag?: string;
    testName?: string;
    interpretation?: string; // Test interpretation/comments
  }>;
  meta: {
    isDraft: boolean;
    reportDate: string;
    reportType: string;
    interpretation?: string; // Overall report interpretation from workflow
  };
  // Report extras
  extras?: ReportExtras | null;
  // Attachments
  attachments?: Array<{
    url: string;
    heading: string;
    fileName: string;
    testName: string;
  }>;
}

export interface ViewerLabBranding {
  headerHtml?: string | null;
  footerHtml?: string | null;
  logoUrl?: string | null;
}

// ============ Helper Functions ============

const formatDateTime = (dateStr: string | null | undefined): string => {
  if (!dateStr) return 'N/A';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
};

const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
};

const getViewerFlagInfo = (flag?: string): {
  label: string;
  isAbnormal: boolean;
  color: { r: number; g: number; b: number };
} => {
  const raw = String(flag || '').trim();
  if (!raw) {
    return { label: '', isAbnormal: false, color: { r: 100, g: 100, b: 100 } };
  }

  const norm = raw
    .toLowerCase()
    .replace(/[-\s]/g, '_')
    .replace(/[^a-z0-9_*]/g, '');

  if (['n', 'normal', 'ok', 'wnl', 'within_range'].includes(norm)) {
    return { label: '', isAbnormal: false, color: { r: 100, g: 100, b: 100 } };
  }
  if (['critical_high', 'critical_h', 'criticalh', 'high_critical', 'criticalhigh', 'h*', 'ch'].includes(norm) || (norm.includes('critical') && norm.includes('high'))) {
    return { label: 'Critical High', isAbnormal: true, color: { r: 220, g: 38, b: 38 } };
  }
  if (['h', 'high', 'hh', 'hi'].includes(norm)) {
    return { label: 'High', isAbnormal: true, color: { r: 220, g: 38, b: 38 } };
  }
  if (['critical_low', 'critical_l', 'criticall', 'low_critical', 'criticallow', 'l*', 'cl'].includes(norm) || (norm.includes('critical') && norm.includes('low'))) {
    return { label: 'Critical Low', isAbnormal: true, color: { r: 30, g: 64, b: 175 } };
  }
  if (['l', 'low', 'll'].includes(norm)) {
    return { label: 'Low', isAbnormal: true, color: { r: 30, g: 64, b: 175 } };
  }
  if (['c', 'critical', 'crit', 'c*'].includes(norm) || norm.includes('critical')) {
    return { label: 'Critical', isAbnormal: true, color: { r: 180, g: 100, b: 50 } };
  }
  if (['a', 'abnormal', 'abn'].includes(norm)) {
    return { label: 'Abnormal', isAbnormal: true, color: { r: 180, g: 100, b: 50 } };
  }

  return { label: raw, isAbnormal: true, color: { r: 180, g: 100, b: 50 } };
};

// ============ Data Preparation ============

/**
 * Fetch and prepare report data from database for PDF generation
 * Includes: patient info, lab info, header/footer, test results, trend graphs, clinical summary, attachments
 */
export const prepareViewerReportData = async (orderId: string): Promise<ViewerReportData | null> => {
  try {
    // Get template context via existing API
    const { data: context, error } = await database.reports.getTemplateContext(orderId);
    
    if (error || !context) {
      console.error('Failed to load report context:', error);
      return null;
    }

    // Get lab info including header/footer
    let labInfo: ViewerReportData['lab'] = { name: '', address: '', phone: '', email: '' };
    if (context.labId) {
      const { data: labData } = await supabase
        .from('labs')
        .select('name, address, city, state, pincode, phone, email, default_report_header_html, default_report_footer_html')
        .eq('id', context.labId)
        .maybeSingle();
      
      // Also fetch branding asset URLs (header/footer images)
      const { data: brandingAssets } = await supabase
        .from('lab_branding_assets')
        .select('asset_type, file_url, imagekit_url, variants')
        .eq('lab_id', context.labId)
        .eq('is_default', true)
        .in('asset_type', ['header', 'footer']);

      // Extract URLs from branding assets (prefer imagekit_url, fallback to variants.optimized, then file_url)
      const headerAsset = brandingAssets?.find((a: any) => a.asset_type === 'header');
      const footerAsset = brandingAssets?.find((a: any) => a.asset_type === 'footer');
      
      const getAssetUrl = (asset: any): string | null => {
        if (!asset) return null;
        if (asset.imagekit_url) return asset.imagekit_url;
        if (asset.variants?.optimized) return asset.variants.optimized;
        if (asset.variants?.optimized_url) return asset.variants.optimized_url;
        return asset.file_url || null;
      };

      // Also fetch signature
      const { data: signatureAsset } = await supabase
        .from('lab_branding_assets')
        .select('file_url, imagekit_url')
        .eq('lab_id', context.labId)
        .eq('asset_type', 'signature')
        .eq('is_default', true)
        .maybeSingle();

      const signatureUrl = signatureAsset?.imagekit_url || signatureAsset?.file_url || null;

      if (labData) {
        const addressParts = [labData.address, labData.city, labData.state, labData.pincode].filter(Boolean);
        labInfo = {
          id: context.labId,
          name: labData.name || 'Laboratory',
          address: addressParts.join(', '),
          phone: labData.phone || '',
          email: labData.email || '',
          headerHtml: labData.default_report_header_html || null,
          footerHtml: labData.default_report_footer_html || null,
          headerUrl: getAssetUrl(headerAsset),
          footerUrl: getAssetUrl(footerAsset),
          signatureUrl: signatureUrl,
        };
        console.log('🏷️ Lab branding URLs:', { headerUrl: labInfo.headerUrl, footerUrl: labInfo.footerUrl, signatureUrl: labInfo.signatureUrl });
      }

      // override signature with doctor signature if available
      try {
        const { data: verifierData } = await supabase
          .from('results')
          .select('verified_by')
          .eq('order_id', orderId)
          .not('verified_by', 'is', null)
          .limit(1)
          .maybeSingle();

        if (verifierData?.verified_by) {
          const { data: userSignature } = await supabase
            .from('lab_user_signatures')
            .select('imagekit_url, file_url, variants')
            .eq('user_id', verifierData.verified_by)
            .eq('is_active', true)
            .order('is_default', { ascending: false })
            .limit(1)
            .maybeSingle();

          const variants = userSignature?.variants as any;
          const doctorSigUrl = variants?.optimized || userSignature?.imagekit_url || userSignature?.file_url;

          if (doctorSigUrl) {
            labInfo.signatureUrl = doctorSigUrl;
            console.log('✅ Overriding with Doctor Signature (Optimized):', doctorSigUrl);
          }
        }
      } catch (err) {
        console.error('Error fetching doctor signature:', err);
      }
    }

    // Build test results from analytes
    const testResults = (context.analytes || []).map((analyte: ReportTemplateAnalyteRow) => ({
      parameter: analyte.parameter || analyte.test_name || 'Unknown',
      result: analyte.value || '—',
      unit: analyte.unit || '',
      referenceRange: analyte.reference_range || '',
      flag: analyte.flag || '',
      testName: analyte.test_name || '',
      interpretation: (analyte as any).interpretation || (analyte as any).comment || '',
    }));

    const isDraft = context.meta?.allAnalytesApproved !== true;

    // Fetch report extras (trend graphs, clinical summary)
    let extras: ReportExtras | null = null;
    try {
      extras = await getReportExtrasForOrder(orderId);
      console.log('📊 Report extras fetched:', {
        hasTrends: extras?.trend_charts?.length || 0,
        includeTrends: extras?.include_trends_in_report,
        hasSummary: !!extras?.clinical_summary,
        includeSummary: extras?.include_summary_in_report,
      });
    } catch (extrasError) {
      console.warn('Failed to fetch report extras:', extrasError);
    }

    // Fetch attachments marked for report inclusion
    let attachments: ViewerReportData['attachments'] = [];
    try {
      const { data: reportAttachments, error: attachmentError } = await supabase
        .from('attachments')
        .select(`
          id,
          file_url,
          file_name,
          description,
          order_test_id,
          order_tests(
            test_groups(name)
          )
        `)
        .eq('order_id', orderId)
        .eq('tag', 'include_in_report')
        .order('order_test_id', { ascending: true });

      if (!attachmentError && reportAttachments && reportAttachments.length > 0) {
        console.log('📎 Found attachments for report:', reportAttachments.length);
        attachments = reportAttachments.map((att: any) => ({
          url: att.file_url,
          heading: att.description || att.file_name || 'Attachment',
          fileName: att.file_name || 'attachment',
          testName: att.order_tests?.test_groups?.name || 'Additional Information',
        }));
      }
    } catch (attachmentFetchError) {
      console.warn('Failed to fetch attachments:', attachmentFetchError);
    }

    return {
      patient: {
        name: context.patient?.name || 'Patient',
        id: context.patient?.displayId || context.patientId || 'N/A',
        age: context.patient?.age || 0,
        gender: context.patient?.gender || 'N/A',
        phone: context.patient?.phone || '',
        referredBy: context.order?.referringDoctorName || 'Self',
      },
      order: {
        orderId: context.orderId,
        sampleId: context.order?.sampleId || '',
        sampleCollectedAt: context.order?.sampleCollectedAt || undefined,
        sampleCollectedBy: context.order?.sampleCollectedBy || '',
        locationName: context.order?.locationName || '',
        orderDate: context.meta?.orderDate || undefined,
      },
      lab: labInfo,
      testResults,
      meta: {
        isDraft,
        reportDate: new Date().toISOString(),
        reportType: isDraft ? 'DRAFT REPORT' : 'Laboratory Report',
        // Get interpretation from placeholder values (workflow data)
        interpretation: (() => {
          const placeholders = context.placeholderValues ?? {};
          const interpretationValue =
            placeholders['report_interpretation'] ??
            placeholders['reportInterpretation'] ??
            placeholders['interpretation_summary'] ??
            placeholders['interpretationSummary'] ??
            placeholders['interpretation'];
          if (typeof interpretationValue === 'string' && interpretationValue.trim()) {
            return interpretationValue.trim();
          }
          return undefined;
        })(),
      },
      extras,
      attachments,
    };
  } catch (error) {
    console.error('Error preparing viewer report data:', error);
    return null;
  }
};

// ============ PDF Generation ============

/**
 * Generate a preview PDF using jsPDF
 * This is optimized for quick viewing, not final reports
 */
export const generateViewerPDF = async (
  data: ViewerReportData,
  options: { openInNewTab?: boolean } = {}
): Promise<string | null> => {
  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - 2 * margin;
    let yPos = margin;

    // ============ Helper Function: Add Letterhead as Full-Page Background ============
    // Letterhead is rendered as a full A4 background image (same as server-side PDF generation).
    // Content overlays on top with a fixed top margin matching the letterhead's header area.
    // 35mm top ≈ 130px at 96dpi (matches server-side topSpacerHeight default).
    const LETTERHEAD_TOP_MARGIN = 35;   // mm — space for letterhead header area
    const LETTERHEAD_BOTTOM_MARGIN = 32; // mm — space for letterhead footer area

    let _cachedLetterheadBase64: string | null = null;
    let _cachedLetterheadFormat: 'PNG' | 'JPEG' = 'PNG';

    const addHeaderImage = async (): Promise<{ success: boolean; headerHeight: number }> => {
      if (!data.lab.headerUrl) {
        return { success: false, headerHeight: 0 };
      }

      try {
        // Load and cache the letterhead image so it's only fetched once
        if (!_cachedLetterheadBase64) {
          const response = await fetch(data.lab.headerUrl);
          if (!response.ok) return { success: false, headerHeight: 0 };
          const blob = await response.blob();
          _cachedLetterheadBase64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          _cachedLetterheadFormat = (_cachedLetterheadBase64.includes('image/jpeg') || _cachedLetterheadBase64.includes('image/jpg'))
            ? 'JPEG' : 'PNG';
        }

        // Draw letterhead as full A4 background — content overlays on top
        doc.addImage(_cachedLetterheadBase64, _cachedLetterheadFormat, 0, 0, pageWidth, pageHeight, undefined, 'FAST');
        return { success: true, headerHeight: LETTERHEAD_TOP_MARGIN };
      } catch (error) {
        console.warn('Failed to load letterhead image:', error);
      }

      return { success: false, headerHeight: 0 };
    };

    // ============ Header Section ============
    
    // Try to load header image if URL available
    let headerImageLoaded = false;
    let headerHeight = 0;
    
    const headerResult = await addHeaderImage();
    if (headerResult.success) {
      headerImageLoaded = true;
      headerHeight = headerResult.headerHeight;
      yPos = LETTERHEAD_TOP_MARGIN;
      console.log('✅ Letterhead loaded as full-page background');
    }

    // Fallback to text header if no image
    if (!headerImageLoaded) {
      // Lab Name (Title)
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175); // Blue color
      doc.text(data.lab.name || 'Laboratory Report', pageWidth / 2, yPos, { align: 'center' });
      yPos += 8;

      // Lab Address
      if (data.lab.address) {
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 100, 100);
        doc.text(data.lab.address, pageWidth / 2, yPos, { align: 'center' });
        yPos += 5;
      }

      // Lab Contact
      if (data.lab.phone || data.lab.email) {
        const contactLine = [data.lab.phone, data.lab.email].filter(Boolean).join(' | ');
        doc.setFontSize(8);
        doc.text(contactLine, pageWidth / 2, yPos, { align: 'center' });
        yPos += 5;
      }
    }

    // Header line — only draw when using text fallback header (letterhead image has its own design)
    if (!headerImageLoaded) {
      yPos += 3;
      doc.setDrawColor(59, 130, 246);
      doc.setLineWidth(0.5);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 8;
    } else {
      yPos += 3;
    }

    // ============ DRAFT Watermark ============
    if (data.meta.isDraft) {
      doc.setFontSize(60);
      doc.setTextColor(255, 200, 200);
      doc.setFont('helvetica', 'bold');
      
      // Rotate and add watermark
      doc.text('DRAFT', pageWidth / 2, pageHeight / 2, {
        align: 'center',
        angle: 45,
      });
      
      // Reset text color
      doc.setTextColor(0, 0, 0);
    }

    // ============ Patient Information Section ============
    doc.setFillColor(240, 249, 255);
    doc.rect(margin, yPos, contentWidth, 28, 'F');
    
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 64, 175);
    doc.text('Patient Information', margin + 3, yPos + 6);
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(50, 50, 50);
    
    const col1X = margin + 3;
    const col2X = pageWidth / 2 + 5;
    let infoY = yPos + 12;

    // Left column
    doc.setFont('helvetica', 'bold');
    doc.text('Name:', col1X, infoY);
    doc.setFont('helvetica', 'normal');
    doc.text(truncateText(data.patient.name, 30), col1X + 18, infoY);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Age/Sex:', col1X, infoY + 5);
    doc.setFont('helvetica', 'normal');
    doc.text(`${formatAge(data.patient.age, (data.patient as any).age_unit)} / ${data.patient.gender}`, col1X + 18, infoY + 5);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Patient ID:', col1X, infoY + 10);
    doc.setFont('helvetica', 'normal');
    doc.text(data.patient.id, col1X + 22, infoY + 10);

    // Right column
    doc.setFont('helvetica', 'bold');
    doc.text('Referred By:', col2X, infoY);
    doc.setFont('helvetica', 'normal');
    doc.text(truncateText(data.patient.referredBy || 'Self', 25), col2X + 25, infoY);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Sample ID:', col2X, infoY + 5);
    doc.setFont('helvetica', 'normal');
    doc.text(data.order.sampleId || 'N/A', col2X + 22, infoY + 5);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Collection:', col2X, infoY + 10);
    doc.setFont('helvetica', 'normal');
    doc.text(formatDateTime(data.order.sampleCollectedAt), col2X + 22, infoY + 10);

    yPos += 35;

    // Group results by Test Name
    const resultsByTest: Record<string, typeof data.testResults> = {};
    const testNames: string[] = []; // Store order to preserve sequence if possible
    
    for (const result of data.testResults) {
      const testName = result.testName || 'Test Results';
      if (!resultsByTest[testName]) {
        resultsByTest[testName] = [];
        testNames.push(testName);
      }
      resultsByTest[testName].push(result);
    }

    // Loop through each test group
    for (const testName of testNames) {
        const groupResults = resultsByTest[testName];

        // Check for new page (heuristic)
        if (yPos > pageHeight - 50) {
            doc.addPage();
            // Add header to new page
            const newPageHeader = await addHeaderImage();
            yPos = newPageHeader.success ? LETTERHEAD_TOP_MARGIN : margin;
        }

        // Test Header
        doc.setFillColor(30, 64, 175);
        doc.rect(margin, yPos, contentWidth, 8, 'F');
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(255, 255, 255);
        
        // Use test name as header if it's specific, otherwise use report type
        const headerText = testName === 'Test Results' ? data.meta.reportType : testName;
        doc.text(headerText, pageWidth / 2, yPos + 5.5, { align: 'center' });
        yPos += 12;

        // Table Header
        doc.setFillColor(59, 130, 246);
        doc.rect(margin, yPos, contentWidth, 8, 'F');
        
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(255, 255, 255);
        
        // Define column widths
        const colWidths = {
            parameter: contentWidth * 0.35,
            result: contentWidth * 0.18,
            unit: contentWidth * 0.15,
            range: contentWidth * 0.22,
            flag: contentWidth * 0.10,
        };
        
        let colX = margin + 2;
        doc.text('Parameter', colX, yPos + 5.5);
        colX += colWidths.parameter;
        doc.text('Result', colX, yPos + 5.5);
        colX += colWidths.result;
        doc.text('Unit', colX, yPos + 5.5);
        colX += colWidths.unit;
        doc.text('Ref. Range', colX, yPos + 5.5);
        colX += colWidths.range;
        doc.text('Flag', colX, yPos + 5.5);
        
        yPos += 8;

        // Table Rows
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        
        let rowIndex = 0;
        for (const result of groupResults) {
            // Check if we need a new page
            if (yPos > pageHeight - LETTERHEAD_BOTTOM_MARGIN) {
                doc.addPage();
                // Add header to new page
                const newPageHeader = await addHeaderImage();
                yPos = newPageHeader.success ? LETTERHEAD_TOP_MARGIN : margin;
                
                // Re-add table header on new page
                doc.setFillColor(59, 130, 246);
                doc.rect(margin, yPos, contentWidth, 8, 'F');
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(255, 255, 255);
                
                colX = margin + 2;
                doc.text('Parameter', colX, yPos + 5.5);
                colX += colWidths.parameter;
                doc.text('Result', colX, yPos + 5.5);
                colX += colWidths.result;
                doc.text('Unit', colX, yPos + 5.5);
                colX += colWidths.unit;
                doc.text('Ref. Range', colX, yPos + 5.5);
                colX += colWidths.range;
                doc.text('Flag', colX, yPos + 5.5);
                
                yPos += 8;
                doc.setFont('helvetica', 'normal');
            }

            // Alternating row background
            if (rowIndex % 2 === 0) {
                doc.setFillColor(248, 250, 252);
                doc.rect(margin, yPos, contentWidth, 7, 'F');
            }

            // Normalize flag for styling
          const flagInfo = getViewerFlagInfo(result.flag);
          const isAbnormal = flagInfo.isAbnormal;
      
      // Row content
      colX = margin + 2;
      doc.setTextColor(50, 50, 50);
      doc.text(truncateText(result.parameter, 35), colX, yPos + 5);
      
      colX += colWidths.parameter;
      // Highlight abnormal results
      if (isAbnormal) {
        doc.setFont('helvetica', 'bold');

        doc.setTextColor(flagInfo.color.r, flagInfo.color.g, flagInfo.color.b);
      }
      doc.text(result.result, colX, yPos + 5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(50, 50, 50);
      
      colX += colWidths.result;
      doc.text(result.unit, colX, yPos + 5);
      
      colX += colWidths.unit;
      doc.text(truncateText(result.referenceRange, 18), colX, yPos + 5);
      
      colX += colWidths.range;
      if (flagInfo.label) {
        // Redetermine color for flag column
        let r=100, g=100, b=100;
        if (isAbnormal) {
             r = flagInfo.color.r; g = flagInfo.color.g; b = flagInfo.color.b;
        }

        doc.setTextColor(r, g, b);
        if (isAbnormal) doc.setFont('helvetica', 'bold');
        doc.text(flagInfo.label, colX + 5, yPos + 5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(50, 50, 50);
      }
            yPos += 7;
            rowIndex++;
        }

        // Table bottom border
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.3);
        doc.line(margin, yPos, pageWidth - margin, yPos);
        yPos += 15; // Space after each table
    }

    // ============ Interpretation Section (from workflow) ============
    if (data.meta.interpretation) {
      // Check if we need a new page
      if (yPos > pageHeight - 40) {
        doc.addPage();
        // Add header to new page
        const newPageHeader = await addHeaderImage();
        yPos = newPageHeader.success ? LETTERHEAD_TOP_MARGIN : margin;
      }

      // Section header
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(107, 33, 168); // Purple
      doc.text('Clinical Interpretation', margin, yPos);
      yPos += 6;

      // Interpretation box
      doc.setFillColor(250, 245, 255); // Light purple
      const interpLines = doc.splitTextToSize(data.meta.interpretation, contentWidth - 8);
      const interpBoxHeight = Math.min(interpLines.length * 4 + 6, 50);
      
      doc.rect(margin, yPos, contentWidth, interpBoxHeight, 'F');
      doc.setDrawColor(180, 150, 200);
      doc.setLineWidth(0.3);
      doc.rect(margin, yPos, contentWidth, interpBoxHeight, 'S');
      
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(50, 50, 50);
      doc.text(interpLines.slice(0, 10), margin + 4, yPos + 5);
      
      yPos += interpBoxHeight + 8;
    }

    // ============ Trend Graphs Section ============
    if (data.extras?.include_trends_in_report && data.extras?.trend_charts && data.extras.trend_charts.length > 0) {
      // Check if we need a new page
      if (yPos > pageHeight - 80) {
        doc.addPage();
        // Add header to new page
        const newPageHeader = await addHeaderImage();
        yPos = newPageHeader.success ? LETTERHEAD_TOP_MARGIN : margin;
      }

      // Section header (no emojis - jsPDF doesn't support them properly)
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('Trend Analysis', margin, yPos);
      yPos += 8;
      
      doc.setDrawColor(30, 64, 175);
      doc.setLineWidth(0.5);
      doc.line(margin, yPos, margin + 50, yPos);
      yPos += 8;

      for (const chart of data.extras.trend_charts) {
        if (yPos > pageHeight - 70) {
          doc.addPage();
          // Add header to new page
          const newPageHeader = await addHeaderImage();
          yPos = newPageHeader.success ? LETTERHEAD_TOP_MARGIN : margin;
        }

        // Trend item header
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(50, 50, 50);
        const analyteName = chart.analyte_name || 'Unknown Analyte';
        const unit = chart.unit || '';
        doc.text(analyteName + (unit ? ' (' + unit + ')' : ''), margin, yPos);
        yPos += 6;

        // Try to embed the actual trend chart IMAGE
        let chartImageLoaded = false;
        
        // Prefer base64 (already loaded), then try URL
        if (chart.image_base64) {
          try {
            const chartHeight = 40; // ~40mm height for chart
            const chartWidth = contentWidth * 0.7; // 70% of content width
            doc.addImage(chart.image_base64, 'PNG', margin, yPos, chartWidth, chartHeight, undefined, 'FAST');
            yPos += chartHeight + 4;
            chartImageLoaded = true;
            console.log('Trend chart embedded from base64:', analyteName);
          } catch (imgErr) {
            console.warn('Failed to embed trend chart base64:', imgErr);
          }
        } else if (chart.image_url) {
          try {
            const response = await fetch(chart.image_url);
            if (response.ok) {
              const blob = await response.blob();
              const base64 = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
              });
              
              const chartHeight = 40;
              const chartWidth = contentWidth * 0.7;
              doc.addImage(base64, 'PNG', margin, yPos, chartWidth, chartHeight, undefined, 'FAST');
              yPos += chartHeight + 4;
              chartImageLoaded = true;
              console.log('Trend chart embedded from URL:', analyteName);
            }
          } catch (urlErr) {
            console.warn('Failed to fetch trend chart image:', urlErr);
          }
        }

        // Fallback: Show simple data table if no image
        if (!chartImageLoaded && chart.data && chart.data.length > 0) {
          doc.setFontSize(8);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(80, 80, 80);
          
          // Simple table header
          doc.setFillColor(240, 245, 255);
          doc.rect(margin, yPos, contentWidth * 0.6, 6, 'F');
          doc.text('Date', margin + 2, yPos + 4);
          doc.text('Value', margin + 45, yPos + 4);
          doc.text('Flag', margin + 80, yPos + 4);
          yPos += 6;
          
          // Data rows (last 5)
          const points = chart.data.slice(-5);
          for (const p of points) {
            const dateStr = p.order_date ? new Date(p.order_date).toLocaleDateString('en-IN') : '-';
            doc.text(dateStr, margin + 2, yPos + 4);
            doc.text(String(p.value), margin + 45, yPos + 4);
            doc.text(p.flag || '-', margin + 80, yPos + 4);
            yPos += 5;
          }
          yPos += 4;
        }
        
        yPos += 6;
      }
      
      yPos += 4;
    }

    // ============ Clinical Summary Section ============
    if (data.extras?.include_summary_in_report && data.extras?.clinical_summary?.text) {
      // Always start clinical summary on a new page for better layout
      doc.addPage();
      
      // Add header to new page
      const summaryPageHeader = await addHeaderImage();
      yPos = summaryPageHeader.success ? LETTERHEAD_TOP_MARGIN : margin;

      // Section header (no emojis - jsPDF doesn't support them properly)
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(22, 163, 74); // Green
      doc.text('Clinical Summary for Referring Physician', margin, yPos);
      yPos += 8;
      
      doc.setDrawColor(22, 163, 74);
      doc.setLineWidth(0.5);
      doc.line(margin, yPos, margin + 80, yPos);
      yPos += 6;

      // Summary box
      doc.setFillColor(240, 253, 244); // Light green background
      let summaryText = data.extras.clinical_summary.text;
      
      // Clean the text for jsPDF (remove markdown, duplicates)
      // Remove duplicate Executive Summary headers
      summaryText = summaryText.replace(/(\*\*Executive Summary\*\*\s*\n?){2,}/gi, '');
      summaryText = summaryText.replace(/^(\*\*Executive Summary\*\*\s*\n)+/gi, '');
      // Remove markdown bold markers
      summaryText = summaryText.replace(/\*\*([^*]+)\*\*/g, '$1');
      
      const summaryLines = doc.splitTextToSize(summaryText, contentWidth - 8);
      const boxHeight = Math.min(summaryLines.length * 4 + 8, 60);
      
      doc.rect(margin, yPos, contentWidth, boxHeight, 'F');
      doc.setDrawColor(22, 163, 74);
      doc.setLineWidth(0.3);
      doc.rect(margin, yPos, contentWidth, boxHeight, 'S');
      
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(50, 50, 50);
      doc.text(summaryLines.slice(0, 12), margin + 4, yPos + 5); // Limit lines
      
      yPos += boxHeight + 4;

      // Recommendation if present
      if (data.extras.clinical_summary.recommendation) {
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(22, 163, 74);
        doc.text('Recommendation:', margin, yPos);
        yPos += 4;
        
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(50, 50, 50);
        const recLines = doc.splitTextToSize(data.extras.clinical_summary.recommendation, contentWidth - 4);
        doc.text(recLines.slice(0, 4), margin + 2, yPos);
        yPos += recLines.length * 4 + 4;
      }
      
      yPos += 6;
    }

    // ============ Attachments Section ============
    if (data.attachments && data.attachments.length > 0) {
      // Start attachments on a new page
      doc.addPage();
      yPos = margin;

      // Section header (no emojis - jsPDF doesn't support them properly)
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(107, 33, 168); // Purple
      doc.text('Supporting Documentation', margin, yPos);
      yPos += 8;
      
      doc.setDrawColor(107, 33, 168);
      doc.setLineWidth(0.5);
      doc.line(margin, yPos, margin + 60, yPos);
      yPos += 8;

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80, 80, 80);
      doc.text(`${data.attachments.length} attachment(s) included with this report`, margin, yPos);
      yPos += 10;

      // List attachments (jsPDF can't embed images from URLs easily, so we list them)
      for (let i = 0; i < data.attachments.length; i++) {
        const attachment = data.attachments[i];
        
        if (yPos > pageHeight - LETTERHEAD_BOTTOM_MARGIN) {
          doc.addPage();
          // Add header to new page
          const attachmentPageHeader = await addHeaderImage();
          yPos = attachmentPageHeader.success ? LETTERHEAD_TOP_MARGIN : margin;
        }

        // Attachment card
        doc.setFillColor(250, 245, 255); // Light purple
        doc.rect(margin, yPos, contentWidth, 18, 'F');
        doc.setDrawColor(200, 180, 220);
        doc.setLineWidth(0.2);
        doc.rect(margin, yPos, contentWidth, 18, 'S');

        // Attachment number
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(107, 33, 168);
        doc.text(`${i + 1}.`, margin + 3, yPos + 6);

        // Attachment name/heading
        doc.setTextColor(50, 50, 50);
        const heading = attachment.heading || attachment.fileName || 'Attachment';
        doc.text(truncateText(heading, 50), margin + 12, yPos + 6);

        // Test name if available
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        if (attachment.testName) {
          doc.text(`Test: ${attachment.testName}`, margin + 12, yPos + 12);
        }
        
        // File name
        if (attachment.fileName) {
          doc.text(`File: ${truncateText(attachment.fileName, 40)}`, margin + 80, yPos + 12);
        }

        doc.setFontSize(9);
        yPos += 22;
      }

      // Note about viewing attachments
      yPos += 6;
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.setFont('helvetica', 'italic');
      doc.text('Note: Full attachment images are available in the complete report.', margin, yPos);
    }

    // ============ Signature Section ============
    // Add signature before footer if available
    if (data.lab.signatureUrl) {
      try {
        // Ensure we're on the first page for signature (unless there are attachments)
        const totalPages = doc.getNumberOfPages();
        if (totalPages === 1 || (data.attachments && data.attachments.length === 0)) {
          // Check if we have space for signature
          if (yPos > pageHeight - 50) {
            // Not enough space, signature will be at bottom of current page
            yPos = pageHeight - 55;
          } else {
            // Move signature towards bottom
            yPos = Math.max(yPos + 10, pageHeight - 55);
          }
        } else {
          // Go back to first page for signature
          doc.setPage(1);
          yPos = pageHeight - 55;
        }

        const response = await fetch(data.lab.signatureUrl);
        if (response.ok) {
          const blob = await response.blob();
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          
          // Signature box on the right side — use aspect-ratio-preserving dimensions
          const MAX_SIG_WIDTH = 32; // mm
          const MAX_SIG_HEIGHT = 12; // mm
          // Probe natural image dimensions via Image element for proper aspect ratio
          const imgDims = await new Promise<{ w: number; h: number }>((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
            img.onerror = () => resolve({ w: 1, h: 1 });
            img.src = base64;
          });
          const aspect = imgDims.h / imgDims.w;
          let sigWidth = MAX_SIG_WIDTH;
          let sigHeight = MAX_SIG_WIDTH * aspect;
          if (sigHeight > MAX_SIG_HEIGHT) {
            sigHeight = MAX_SIG_HEIGHT;
            sigWidth = MAX_SIG_HEIGHT / aspect;
          }
          const sigX = pageWidth - margin - sigWidth;

          // Label
          doc.setFontSize(8);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(100, 100, 100);
          doc.text('Authorized Signatory', sigX, yPos);

          // Signature image
          const imgFmt = base64.includes('image/jpeg') || base64.includes('image/jpg') ? 'JPEG' : 'PNG';
          doc.addImage(base64, imgFmt, sigX, yPos + 2, sigWidth, sigHeight, undefined, 'FAST');
          
          // Line under signature
          doc.setDrawColor(150, 150, 150);
          doc.setLineWidth(0.3);
          doc.line(sigX, yPos + 2 + sigHeight + 2, sigX + sigWidth, yPos + 2 + sigHeight + 2);
          
          console.log('✅ Signature image loaded');
        }
      } catch (sigError) {
        console.warn('Failed to load signature image:', sigError);
      }
    }

    // ============ Footer Section ============
    
    // Try to load footer image if URL available
    let footerImageLoaded = false;
    if (data.lab.footerUrl) {
      try {
        const response = await fetch(data.lab.footerUrl);
        if (response.ok) {
          const blob = await response.blob();
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          
          // Footer image at bottom of page (FULL PAGE WIDTH - no margins)
          const footerHeight = 20; // ~20mm footer height
          const footerY = pageHeight - footerHeight;
          doc.addImage(base64, 'PNG', 0, footerY, pageWidth, footerHeight, undefined, 'FAST');
          footerImageLoaded = true;
          console.log('✅ Footer image loaded from URL');
        }
      } catch (footerError) {
        console.warn('Failed to load footer image, using text fallback:', footerError);
      }
    }

    // Fallback text footer if no image
    if (!footerImageLoaded) {
      // Report generation info
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(`Report Generated: ${formatDateTime(data.meta.reportDate)}`, margin, yPos);
      
      if (data.order.locationName) {
        doc.text(`Collection Location: ${data.order.locationName}`, margin, yPos + 4);
      }
    }

    // Draft notice
    if (data.meta.isDraft) {
      yPos += 12;
      doc.setFillColor(254, 243, 199);
      doc.rect(margin, yPos, contentWidth, 12, 'F');
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(146, 64, 14);
      doc.text('DRAFT REPORT - Some results may still be pending verification', pageWidth / 2, yPos + 7, { align: 'center' });
    }

    // Page footer text — placed inside the safe content area (above letterhead footer)
    const footerY = pageHeight - LETTERHEAD_BOTTOM_MARGIN + 5;
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text('This is a computer-generated report preview.', pageWidth / 2, footerY, { align: 'center' });

    // ============ Output ============
    
    if (options.openInNewTab) {
      // Create blob URL and open in new tab
      const pdfBlob = doc.output('blob');
      const blobUrl = URL.createObjectURL(pdfBlob);
      window.open(blobUrl, '_blank');
      return blobUrl;
    } else {
      // Return as Blob URL (better for iframes)
      const pdfBlob = doc.output('blob');
      return URL.createObjectURL(pdfBlob);
    }

  } catch (error) {
    console.error('Error generating viewer PDF:', error);
    return null;
  }
};

// ============ Main Entry Point ============

/**
 * Quick view PDF report - main function for the View button
 * Fetches data and generates PDF in one call
 */
export const quickViewPDF = async (orderId: string, options: { openInNewTab?: boolean } = { openInNewTab: true }): Promise<string | null> => {
  console.log('📄 quickViewPDF called for order:', orderId);
  
  try {
    // Prepare data
    const reportData = await prepareViewerReportData(orderId);
    if (!reportData) {
      console.error('Failed to prepare report data');
      return null;
    }

    console.log('📄 Report data prepared:', {
      patient: reportData.patient.name,
      testCount: reportData.testResults.length,
      isDraft: reportData.meta.isDraft,
    });

    // Generate PDF
    const pdfUrl = await generateViewerPDF(reportData, options);
    
    if (pdfUrl) {
      console.log('✅ PDF generated successfully');
    }

    return pdfUrl;
  } catch (error) {
    console.error('❌ quickViewPDF error:', error);
    return null;
  }
};

export default {
  prepareViewerReportData,
  generateViewerPDF,
  quickViewPDF,
};
