/**
 * Simplified PDF Service
 * 
 * This service handles:
 * 1. Generate Final Report - Creates PDF and saves to Supabase Storage
 * 2. View Draft Report - Opens HTML in browser (user can print natively)
 * 
 * No PDF.co calls for viewing - just HTML rendering in browser
 */

import { supabase } from './supabase';
import nunjucks from 'nunjucks';
import { reportBaselineCss } from '../styles/reportBaselineString';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface ReportTemplateContext {
  orderId: string;
  patientId: string;
  labId: string;
  patient?: {
    name?: string;
    displayId?: string;
    phone?: string;
    age?: string;
    gender?: string;
    dateOfBirth?: string;
  };
  order?: {
    sampleId?: string;
    sampleCollectedAt?: string;
    sampleCollectedBy?: string;
    locationName?: string;
    referringDoctorName?: string;
    approvedAt?: string;
  };
  meta?: {
    orderNumber?: string;
    createdAt?: string;
    orderDate?: string;
    status?: string;
    totalAmount?: string;
    allAnalytesApproved?: boolean;
  };
  labBranding?: {
    defaultHeaderHtml?: string;
    defaultFooterHtml?: string;
  };
  placeholderValues?: Record<string, any>;
}

export interface LabTemplateRecord {
  id: string;
  lab_id: string;
  template_name: string;
  gjs_html: string;
  gjs_css?: string;
  is_active: boolean;
  created_at: string;
}

// Configure nunjucks
const nunjucksEnv = nunjucks.configure({
  autoescape: true,
  throwOnUndefined: false,
  trimBlocks: true,
  lstripBlocks: true,
});

// ============================================================================
// CONTEXT BUILDING (Reuse from existing pdfService.ts)
// ============================================================================

const buildDefaultTemplateContext = (): Record<string, any> => ({
  patientName: 'John Doe',
  patientId: 'P12345',
  age: '35',
  sex: 'Male',
  gender: 'Male',
  dateOfBirth: '1989-05-15',
  sampleId: 'S001',
  sampleCollectedAt: new Date().toISOString(),
  referringDoctorName: 'Dr. Smith',
  doctorName: 'Dr. Smith',
  reportDate: new Date().toISOString(),
  orderDate: new Date().toISOString(),
  labName: 'Central Lab',
  labAddress: '123 Main St',
  labPhone: '555-0100',
  labEmail: 'lab@example.com',
});

const normalizeDateValue = (value: string | null | undefined): string => {
  if (!value) return '';
  try {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  } catch (error) {
    return value ?? '';
  }
};

const buildContextFromReportTemplate = (context: ReportTemplateContext): Record<string, any> => {
  const patient = context.patient ?? ({} as ReportTemplateContext['patient']);
  const order = context.order ?? ({} as ReportTemplateContext['order']);
  const meta = context.meta ?? ({} as ReportTemplateContext['meta']);

  return {
    orderId: context.orderId,
    orderNumber: meta?.orderNumber ?? context.orderId,
    labId: context.labId ?? '',
    patientId: context.patientId ?? patient?.displayId ?? '',
    patientName: patient?.name ?? '',
    patientDisplayId: patient?.displayId ?? '',
    patientPhone: patient?.phone ?? '',
    age: patient?.age ?? '',
    sex: patient?.gender ?? '',
    gender: patient?.gender ?? '',
    dateOfBirth: patient?.dateOfBirth ? normalizeDateValue(patient.dateOfBirth) : '',
    sampleId: order?.sampleId ?? '',
    sampleCollectedAt: order?.sampleCollectedAt ? normalizeDateValue(order.sampleCollectedAt) : '',
    sampleCollectedBy: order?.sampleCollectedBy ?? '',
    locationName: order?.locationName ?? '',
    referringDoctorName: order?.referringDoctorName ?? '',
    doctorName: order?.referringDoctorName ?? '',
    approvedAt: order?.approvedAt ? normalizeDateValue(order.approvedAt) : '',
    reportDate: meta?.createdAt ? normalizeDateValue(meta.createdAt) : new Date().toISOString(),
    orderDate: meta?.orderDate ? normalizeDateValue(meta.orderDate) : '',
    orderStatus: meta?.status ?? '',
    totalAmount: meta?.totalAmount ?? '',
    allAnalytesApproved: meta?.allAnalytesApproved ?? false,
  };
};

const renderTemplateWithContext = (template: string, context: Record<string, any>): string => {
  try {
    return nunjucksEnv.renderString(template, context);
  } catch (error) {
    console.error('Nunjucks rendering error:', error);
    return template;
  }
};

// ============================================================================
// HTML BUILDING
// ============================================================================

const sanitizeHtmlFragment = (html?: string | null): string => {
  if (!html) return '<p>No content available</p>';
  const trimmed = html.trim();
  return trimmed.length > 0 ? trimmed : '<p>No content available</p>';
};

const normalizeCustomCss = (css?: string | null): string => {
  if (!css) return '';
  return css.trim();
};

/**
 * Inject watermark HTML into report based on lab settings
 */
const injectWatermarkIfEnabled = async (html: string, labId: string): Promise<string> => {
  try {
    const { data: labSettings, error } = await supabase
      .from('labs')
      .select('watermark_enabled, watermark_image_url, watermark_opacity, watermark_position, watermark_size, watermark_rotation')
      .eq('id', labId)
      .single();
    
    if (error || !labSettings || !labSettings.watermark_enabled || !labSettings.watermark_image_url) {
      return html; // No watermark configured
    }

    console.log('💧 Injecting watermark:', {
      url: labSettings.watermark_image_url,
      opacity: labSettings.watermark_opacity,
      position: labSettings.watermark_position
    });

    // Calculate size percentage
    const sizeMap = { small: '40%', medium: '60%', large: '80%', full: '100%' };
    const maxWidth = sizeMap[labSettings.watermark_size as keyof typeof sizeMap] || '60%';

    // Calculate position styles
    const positionMap: Record<string, string> = {
      'center': 'top:50%;left:50%;transform:translate(-50%, -50%)',
      'top-left': 'top:10%;left:10%',
      'top-right': 'top:10%;right:10%',
      'bottom-left': 'bottom:10%;left:10%',
      'bottom-right': 'bottom:10%;right:10%'
    };

    const positionStyle = positionMap[labSettings.watermark_position] || positionMap['center'];
    const rotation = labSettings.watermark_rotation || 0;

    const watermarkHtml = `<img src="${labSettings.watermark_image_url}" style="position:absolute;${positionStyle};${rotation !== 0 ? `transform:translate(-50%, -50%) rotate(${rotation}deg);` : ''}max-width:${maxWidth};height:auto;opacity:${labSettings.watermark_opacity};z-index:1;pointer-events:none;" alt="Watermark" />`;

    // Inject watermark after body opening tag
    const bodyMatch = html.match(/<body[^>]*>/i);
    if (bodyMatch) {
      const insertIndex = bodyMatch.index! + bodyMatch[0].length;
      return html.slice(0, insertIndex) + watermarkHtml + html.slice(insertIndex);
    }

    return watermarkHtml + html;
  } catch (error) {
    console.error('Failed to inject watermark:', error);
    return html;
  }
};

/**
 * Build complete HTML document for browser viewing
 */
const buildViewableHtml = (
  bodyHtml: string,
  customCss: string = '',
  headerHtml?: string,
  footerHtml?: string
): string => {
  const styles = [
    `<style id="lims-report-baseline">${reportBaselineCss}</style>`,
    customCss ? `<style>${customCss}</style>` : '',
  ].filter(Boolean).join('\n');

  const parts = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<title>Lab Report</title>',
    styles,
    '</head>',
    '<body>',
    '<div class="limsv2-report limsv2-report--print">',
  ];

  if (headerHtml) {
    parts.push(`<header class="limsv2-report-header">${headerHtml}</header>`);
  }

  parts.push(`<main class="limsv2-report-body">${bodyHtml}</main>`);

  if (footerHtml) {
    parts.push(`<footer class="limsv2-report-footer">${footerHtml}</footer>`);
  }

  parts.push(
    '</div>',
    '</body>',
    '</html>'
  );

  return parts.join('\n');
};

/**
 * Build HTML optimized for PDF generation (print styles)
 */
const buildPdfHtml = (
  bodyHtml: string,
  customCss: string = '',
  headerHtml?: string,
  footerHtml?: string
): string => {
  const styles = [
    `<style id="lims-report-baseline">${reportBaselineCss}</style>`,
    customCss ? `<style>${customCss}</style>` : '',
    `<style>
      @media print {
        body { margin: 0; }
        .limsv2-report { page-break-inside: avoid; }
      }
      /* Ensure proper positioning context for watermark */
      body { position: relative; min-height: 100vh; }
      .limsv2-report { position: relative; z-index: 2; }
    </style>`,
  ].filter(Boolean).join('\n');

  const parts = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    styles,
    '</head>',
    '<body>',
    '<div class="limsv2-report limsv2-report--print">',
  ];

  if (headerHtml) {
    parts.push(`<header class="limsv2-report-header">${headerHtml}</header>`);
  }

  parts.push(`<main class="limsv2-report-body limsv2-report-body--print">${bodyHtml}</main>`);

  if (footerHtml) {
    parts.push(`<footer class="limsv2-report-footer">${footerHtml}</footer>`);
  }

  parts.push(
    '</div>',
    '</body>',
    '</html>'
  );

  return parts.join('\n');
};

// ============================================================================
// TEMPLATE RENDERING
// ============================================================================

export const renderTemplateToHtml = (
  template: LabTemplateRecord,
  context: ReportTemplateContext,
  overrides?: Record<string, any>
): { viewHtml: string; pdfHtml: string } => {
  if (!template?.gjs_html) {
    throw new Error('Template is missing HTML content');
  }

  console.log('🎨 renderTemplateToHtml - labBranding:', context.labBranding);
  console.log('🎨 Header HTML:', context.labBranding?.defaultHeaderHtml?.substring(0, 100));
  console.log('🎨 Footer HTML:', context.labBranding?.defaultFooterHtml?.substring(0, 100));

  // Build render context
  const baseContext = buildDefaultTemplateContext();
  const derivedContext = buildContextFromReportTemplate(context);
  const placeholderValues = context.placeholderValues ?? {};
  
  const renderContext = {
    ...baseContext,
    ...derivedContext,
    ...placeholderValues,
    ...(overrides || {}),
  };

  // Render template
  const renderedBody = renderTemplateWithContext(template.gjs_html, renderContext);
  const sanitizedBody = sanitizeHtmlFragment(renderedBody);
  const customCss = normalizeCustomCss(template.gjs_css);

  // Extract header/footer from branding
  const headerHtml = context.labBranding?.defaultHeaderHtml || '';
  const footerHtml = context.labBranding?.defaultFooterHtml || '';

  console.log('📄 Using header HTML:', headerHtml ? 'YES (' + headerHtml.length + ' chars)' : 'NO');
  console.log('📄 Using footer HTML:', footerHtml ? 'YES (' + footerHtml.length + ' chars)' : 'NO');

  return {
    viewHtml: buildViewableHtml(sanitizedBody, customCss, headerHtml, footerHtml),
    pdfHtml: buildPdfHtml(sanitizedBody, customCss, headerHtml, footerHtml),
  };
};

// ============================================================================
// VIEW DRAFT REPORT (Open HTML in Browser)
// ============================================================================

/**
 * Open draft report in new browser window
 * User can use browser's native print (Ctrl+P) to generate PDF
 */
export const viewDraftReportInBrowser = async (
  orderId: string,
  onProgress?: (message: string) => void
): Promise<void> => {
  try {
    onProgress?.('Loading report data...');

    // Get context from database
    const { data: context, error: contextError } = await supabase
      .rpc('get_report_template_context', { order_id_input: orderId });

    if (contextError || !context) {
      throw new Error('Failed to load report data');
    }

    onProgress?.('Loading template...');

    // Get lab templates
    const { data: templates, error: templateError } = await supabase
      .from('lab_templates')
      .select('*')
      .eq('lab_id', context.labId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (templateError || !templates || templates.length === 0) {
      throw new Error('No active template found');
    }

    // Use first template (or implement selection logic)
    const template = templates[0] as LabTemplateRecord;

    onProgress?.('Rendering HTML...');

    // Render HTML
    const { viewHtml } = renderTemplateToHtml(template, context, {
      preview_mode: true,
      is_draft: !context.meta?.allAnalytesApproved,
    });

    onProgress?.('Opening in browser...');

    // Open in new window
    const previewWindow = window.open('', '_blank', 'noopener,noreferrer');
    if (!previewWindow) {
      throw new Error('Popup blocked. Please allow popups for this site.');
    }

    previewWindow.document.write(viewHtml);
    previewWindow.document.close();

    onProgress?.('Done! Use Ctrl+P to print or save as PDF.');
  } catch (error) {
    console.error('View draft report error:', error);
    throw error;
  }
};

// ============================================================================
// GENERATE PRINT PDF (No header/footer/watermark for physical letterhead)
// ============================================================================

/**
 * Generate print-optimized PDF without digital branding
 * For use with pre-printed physical letterhead
 */
const generatePrintPDF = async (
  orderId: string,
  context: ReportTemplateContext,
  template: LabTemplateRecord,
  attachmentHtml: string
): Promise<string | null> => {
  try {
    console.log('🖨️ Generating print PDF for physical letterhead...');

    // Render body without header/footer
    const baseContext = buildDefaultTemplateContext();
    const derivedContext = buildContextFromReportTemplate(context);
    const placeholderValues = context.placeholderValues ?? {};
    
    const renderContext = {
      ...baseContext,
      ...derivedContext,
      ...placeholderValues,
      is_final: true,
      is_draft: false,
    };

    const renderedBody = renderTemplateWithContext(template.gjs_html, renderContext);
    const sanitizedBody = sanitizeHtmlFragment(renderedBody);
    const customCss = normalizeCustomCss(template.gjs_css);

    // Build print-optimized HTML (NO header, footer, watermark, backgrounds)
    const printCss = `
      /* Print-optimized styles for physical letterhead */
      .limsv2-report--print {
        background: none !important;
      }
      
      .limsv2-report--print .limsv2-report-body {
        padding-top: 80px;  /* Space for pre-printed letterhead */
        padding-bottom: 40px;
        background: none !important;
      }
      
      /* Hide all digital branding elements */
      .limsv2-report--print img[data-role="watermark"],
      .limsv2-report--print img[data-role="logo"],
      .limsv2-report--print .lab-header-branding,
      .limsv2-report--print .lab-footer-branding,
      .limsv2-report--print .digital-only {
        display: none !important;
      }
      
      /* Remove all background colors and gradients */
      .limsv2-report--print .test-group-section,
      .limsv2-report--print .result-table,
      .limsv2-report--print th,
      .limsv2-report--print td {
        background: none !important;
        background-color: transparent !important;
        background-image: none !important;
      }
      
      .limsv2-report--print {
        color: #000 !important;
      }
      
      .limsv2-report--print h1,
      .limsv2-report--print h2,
      .limsv2-report--print h3 {
        color: #000 !important;
      }
      
      /* Keep doctor signature visible */
      .limsv2-report--print .doctor-signature {
        display: block !important;
      }
      
      body { position: relative; min-height: 100vh; }
      .limsv2-report { position: relative; z-index: 2; }
    `;

    const styles = [
      `<style id="lims-report-baseline">${reportBaselineCss}</style>`,
      customCss ? `<style>${customCss}</style>` : '',
      `<style id="print-overrides">${printCss}</style>`,
    ].filter(Boolean).join('\\n');

    const printHtmlParts = [
      '<!DOCTYPE html>',
      '<html>',
      '<head>',
      '<meta charset="utf-8" />',
      '<meta name="viewport" content="width=device-width, initial-scale=1" />',
      styles,
      '</head>',
      '<body>',
      '<div class="limsv2-report limsv2-report--print">',
      `<main class="limsv2-report-body limsv2-report-body--print">${sanitizedBody}</main>`,
      '</div>',
      '</body>',
      '</html>'
    ];

    let printHtml = printHtmlParts.join('\\n');

    // Add attachments if any
    if (attachmentHtml) {
      printHtml = printHtml.replace('</body>', `${attachmentHtml}</body>`);
    }

    // Generate PDF with PDF.co API
    const PDFCO_API_KEY = import.meta.env.VITE_PDFCO_API_KEY;
    if (!PDFCO_API_KEY) {
      throw new Error('PDF.co API key not configured');
    }

    const filename = `${orderId}_${Date.now()}_print.pdf`;
    
    const pdfcoResponse = await fetch('https://api.pdf.co/v1/pdf/convert/from/html', {
      method: 'POST',
      headers: {
        'x-api-key': PDFCO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: filename,
        html: printHtml,
        async: false,
        margins: '40px 20px 40px 20px',
        paperSize: 'A4',
        orientation: 'portrait',
        printBackground: false,  // NO backgrounds for physical letterhead
        scale: 1.0,
        mediaType: 'print',
        displayHeaderFooter: false,  // NO digital header/footer
      }),
    });

    if (!pdfcoResponse.ok) {
      throw new Error(`PDF.co API failed: ${pdfcoResponse.status}`);
    }

    const pdfcoResult = await pdfcoResponse.json();
    
    if (pdfcoResult.error || !pdfcoResult.url) {
      throw new Error(`PDF.co generation failed: ${pdfcoResult.message || 'Unknown error'}`);
    }

    // Download and upload to Supabase Storage
    const pdfResponse = await fetch(pdfcoResult.url);
    if (!pdfResponse.ok) {
      throw new Error('Failed to download print PDF from PDF.co');
    }
    const pdfBlob = await pdfResponse.blob();

    const storagePath = `reports/${orderId}/${filename}`;
    const { error: uploadError } = await supabase.storage
      .from('attachments')
      .upload(storagePath, pdfBlob, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      throw new Error('Failed to upload print PDF to storage');
    }

    const { data: { publicUrl } } = supabase.storage
      .from('attachments')
      .getPublicUrl(storagePath);

    return publicUrl;
  } catch (error) {
    console.error('Print PDF generation error:', error);
    return null;
  }
};

// ============================================================================
// GENERATE FINAL REPORT (PDF via PDF.co + Save to Storage)
// ============================================================================

/**
 * Generate final report PDF and save to Supabase Storage
 */
export const generateFinalReport = async (
  orderId: string,
  onProgress?: (message: string, percent?: number) => void
): Promise<{ pdfUrl: string; reportId: string }> => {
  try {
    onProgress?.('Loading report data...', 10);

    // Get context from database using the centralized API
    const { data: context, error: contextError } = await supabase.rpc('get_report_template_context', {
      p_order_id: orderId
    });

    if (contextError || !context) {
      console.error('Failed to load report context:', contextError);
      throw new Error('Failed to load report data');
    }

    // Check if all analytes approved
    if (!context.meta?.allAnalytesApproved) {
      throw new Error('Cannot generate final report: Not all results are approved');
    }

    onProgress?.('Loading template...', 20);

    // Get lab templates
    const { data: templates, error: templateError } = await supabase
      .from('lab_templates')
      .select('*')
      .eq('lab_id', context.labId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (templateError || !templates || templates.length === 0) {
      throw new Error('No active template found');
    }

    const template = templates[0] as LabTemplateRecord;

    onProgress?.('Rendering HTML...', 30);

    // Fetch attachments marked for report inclusion
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

    if (attachmentError) {
      console.error('Error fetching attachments:', attachmentError);
    }

    let attachmentHtml = '';
    if (reportAttachments && reportAttachments.length > 0) {
      onProgress?.('Processing attachments...', 35);
      
      console.log('Found attachments for report:', reportAttachments.length);
      
      // Group attachments by test
      const groupedAttachments: Record<string, Array<{ url: string; heading: string; fileName: string }>> = {};
      reportAttachments.forEach((att: any) => {
        const testName = att.order_tests?.test_groups?.name || 'Additional Information';
        console.log('Processing attachment:', att.id, 'Test:', testName);
        if (!groupedAttachments[testName]) {
          groupedAttachments[testName] = [];
        }
        groupedAttachments[testName].push({
          url: att.file_url,
          heading: att.description || att.file_name || 'Attachment',
          fileName: att.file_name || 'attachment'
        });
      });

      // Generate HTML for attachments
      attachmentHtml = '<div style="page-break-before: always; padding: 20px;">';
      attachmentHtml += '<h2 style="text-align: center; margin-bottom: 30px; color: #333; border-bottom: 2px solid #4A90E2; padding-bottom: 10px;">Supporting Documentation</h2>';
      
      for (const [testName, attachments] of Object.entries(groupedAttachments)) {
        attachmentHtml += `<h3 style="margin-top: 30px; margin-bottom: 15px; color: #555; font-size: 18px;">${testName}</h3>`;
        
        attachments.forEach((att) => {
          attachmentHtml += '<div style="margin-bottom: 30px; border: 1px solid #ddd; border-radius: 8px; padding: 15px; background-color: #f9f9f9;">';
          attachmentHtml += `<h4 style="margin: 0 0 10px 0; color: #333; font-size: 16px;">${att.heading}</h4>`;
          attachmentHtml += `<img src="${att.url}" alt="${att.fileName}" style="max-width: 100%; height: auto; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);" />`;
          attachmentHtml += '</div>';
        });
      }
      
      attachmentHtml += '</div>';
    }

    // Render PDF-optimized HTML
    const { pdfHtml: basePdfHtml } = renderTemplateToHtml(template, context, {
      is_final: true,
      is_draft: false,
    });

    // Insert attachment HTML before closing body tag
    let pdfHtml = attachmentHtml 
      ? basePdfHtml.replace('</body>', `${attachmentHtml}</body>`)
      : basePdfHtml;

    // Inject watermark if enabled
    onProgress?.('Applying watermark...', 45);
    pdfHtml = await injectWatermarkIfEnabled(pdfHtml, context.labId);

    onProgress?.('Generating PDF with PDF.co...', 50);

    // Generate PDF using PDF.co API
    const PDFCO_API_KEY = import.meta.env.VITE_PDFCO_API_KEY;
    if (!PDFCO_API_KEY) {
      throw new Error('PDF.co API key not configured');
    }

    const filename = `${orderId}_${Date.now()}_final.pdf`;
    
    console.log('📄 PDF.co Request Details:');
    console.log('  Filename:', filename);
    console.log('  HTML Length:', pdfHtml.length);
    console.log('  HTML Preview (first 1000 chars):', pdfHtml.substring(0, 1000));
    console.log('  Has <header>:', pdfHtml.includes('<header'));
    console.log('  Has <footer>:', pdfHtml.includes('<footer'));
    console.log('  Has watermark img:', pdfHtml.includes('Watermark'));
    
    const pdfcoResponse = await fetch('https://api.pdf.co/v1/pdf/convert/from/html', {
      method: 'POST',
      headers: {
        'x-api-key': PDFCO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: filename,
        html: pdfHtml,
        async: false, // Synchronous generation
        margins: '40px 20px 40px 20px',
        paperSize: 'A4',
        orientation: 'portrait',
        printBackground: true,
        scale: 1.0,
        mediaType: 'print',
        displayHeaderFooter: false,
      }),
    });

    if (!pdfcoResponse.ok) {
      const errorText = await pdfcoResponse.text();
      console.error('PDF.co API error:', pdfcoResponse.status, errorText);
      throw new Error(`PDF.co API failed: ${pdfcoResponse.status}`);
    }

    const pdfcoResult = await pdfcoResponse.json();
    
    if (pdfcoResult.error || !pdfcoResult.url) {
      console.error('PDF.co result error:', pdfcoResult);
      throw new Error(`PDF.co generation failed: ${pdfcoResult.message || 'Unknown error'}`);
    }

    onProgress?.('Uploading to Supabase Storage...', 70);

    // Download PDF from PDF.co temporary URL
    const pdfResponse = await fetch(pdfcoResult.url);
    if (!pdfResponse.ok) {
      throw new Error('Failed to download PDF from PDF.co');
    }
    const pdfBlob = await pdfResponse.blob();

    // Upload to Supabase Storage
    const storagePath = `reports/${orderId}/${filename}`;
    const { error: uploadError } = await supabase.storage
      .from('attachments')
      .upload(storagePath, pdfBlob, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      throw new Error('Failed to upload PDF to storage');
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('attachments')
      .getPublicUrl(storagePath);

    const pdfUrl = publicUrl;

    onProgress?.('Saving report record...', 90);

    // Generate print PDF in background (no header/footer/watermark for physical letterhead)
    const printPdfPromise = generatePrintPDF(orderId, context, template, attachmentHtml).catch((err: unknown) => {
      console.error('Print PDF generation failed:', err);
      return null;
    });

    // Save report metadata to database
    const { data: reportData, error: reportError } = await supabase
      .from('reports')
      .upsert({
        order_id: orderId,
        patient_id: context.patientId,
        lab_id: context.labId,
        report_type: 'final',
        status: 'completed',
        pdf_url: pdfUrl,
        generated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (reportError) {
      console.error('Failed to save report record:', reportError);
      // Don't throw - PDF is already generated and uploaded
    }

    // Wait for print PDF and update if successful
    const printPdfUrl = await printPdfPromise;
    if (printPdfUrl && reportData) {
      await supabase
        .from('reports')
        .update({
          print_pdf_url: printPdfUrl,
          print_pdf_generated_at: new Date().toISOString(),
        })
        .eq('id', reportData.id);
      console.log('✅ Print PDF also generated:', printPdfUrl);
    }

    onProgress?.('Complete!', 100);

    return {
      pdfUrl,
      reportId: reportData?.id || orderId,
    };
  } catch (error) {
    console.error('Generate final report error:', error);
    throw error;
  }
};
