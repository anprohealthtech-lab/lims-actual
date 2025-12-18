import { useState, useCallback, useRef } from 'react';
import type { LabTemplateRecord, PreparedPDFBundle, PdfCoRequestOptions } from '../utils/pdfService';
import {
  generateAndSavePDFReportWithProgress,
  ReportData,
  selectTemplateForContext,
  createReportDataFromContext,
  preparePDFBundle,
  regeneratePDFWithSettings,
} from '../utils/pdfService';
import { supabase, database } from '../utils/supabase';

export async function isOrderReportReady(orderId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("v_result_panel_status")
    .select("panel_ready")
    .eq("order_id", orderId);

  if (error) return false;
  if (!data?.length) return false;
  return data.every(r => r.panel_ready);
}

interface PDFGenerationState {
  isGenerating: boolean;
  stage: string;
  progress: number;
  error?: string;
}

export const usePDFGeneration = () => {
  const [state, setState] = useState<PDFGenerationState>({
    isGenerating: false,
    stage: '',
    progress: 0
  });

  // Cache the last prepared bundle for regeneration with different settings
  const lastBundleRef = useRef<PreparedPDFBundle | null>(null);
  const lastReportDataRef = useRef<ReportData | null>(null);

  const generatePDF = useCallback(async (orderId: string, forceDraft = false) => {
    setState({
      isGenerating: true,
      stage: 'Initializing...',
      progress: 0,
      error: undefined
    });

    try {
      setState(prev => ({ ...prev, stage: 'Calling Edge Function...', progress: 10 }));

      // Call the Edge Function directly (same as auto PDF generation)
      const { data: authData } = await supabase.auth.getSession();
      if (!authData?.session) {
        throw new Error('Not authenticated');
      }

      setState(prev => ({ ...prev, stage: 'Generating PDF via Edge Function...', progress: 30 }));

      const response = await supabase.functions.invoke('generate-pdf-auto', {
        body: {
          orderId,
          isDraft: forceDraft
        }
      });

      if (response.error) {
        throw new Error(response.error.message || 'Edge Function failed');
      }

      const result = response.data;
      
      if (!result || !result.pdfUrl) {
        throw new Error('No PDF URL returned from Edge Function');
      }

      setState(prev => ({ ...prev, stage: 'PDF generated, downloading...', progress: 80 }));

      // Download the E-Copy PDF (Edge function returns 'pdfUrl' for e-copy)
      const pdfUrl = result.pdfUrl;
      const fetchResponse = await fetch(pdfUrl);
      
      if (fetchResponse.ok) {
        const blob = await fetchResponse.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        
        // Get patient name from context for filename
        const { data: context } = await database.reports.getTemplateContext(orderId);
        const safePatientName = context?.patient?.name?.replace(/\s+/g, '_') || 'Patient';
        const isDraft = result.status === 'draft';
        const filename = `${safePatientName}_${orderId}${isDraft ? '_DRAFT' : ''}.pdf`;
        
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(downloadUrl);
        
        setState(prev => ({
          ...prev,
          stage: 'PDF downloaded successfully!',
          progress: 100
        }));
        
        // Auto-hide after 2 seconds on success
        setTimeout(() => {
          setState(prev => ({ ...prev, isGenerating: false }));
        }, 2000);
      } else {
        throw new Error('Failed to download PDF from URL');
      }
    } catch (error) {
      console.error('Edge Function PDF generation failed:', error);
      setState(prev => ({
        ...prev,
        stage: 'PDF generation failed',
        progress: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  }, []);

  const resetState = useCallback(() => {
    setState({
      isGenerating: false,
      stage: '',
      progress: 0,
      error: undefined
    });
  }, []);

  /**
   * Regenerate PDF with custom settings using cached HTML bundle
   */
  const regenerateWithSettings = useCallback(async (
    orderId: string,
    options: PdfCoRequestOptions
  ): Promise<string | null> => {
    setState({
      isGenerating: true,
      stage: 'Preparing for regeneration...',
      progress: 0,
      error: undefined
    });

    try {
      let bundle = lastBundleRef.current;
      
      // If no cached bundle or different order, prepare fresh
      if (!bundle || bundle.orderId !== orderId) {
        setState(prev => ({ ...prev, stage: 'Loading report context...', progress: 10 }));
        
        const { data: context, error: contextError } = await database.reports.getTemplateContext(orderId);
        if (contextError || !context) {
          throw new Error(contextError?.message || 'Failed to load report context');
        }

        const isDraft = context.meta?.allAnalytesApproved !== true;
        
        let selectedTemplate: LabTemplateRecord | null = null;
        let allTemplates: LabTemplateRecord[] = [];
        try {
          const { data: templates } = await database.labTemplates.list();
          if (Array.isArray(templates) && templates.length > 0) {
            allTemplates = templates as LabTemplateRecord[];
            selectedTemplate = selectTemplateForContext(allTemplates, context);
          }
        } catch (e) {
          console.warn('Template fetch failed:', e);
        }

        setState(prev => ({ ...prev, stage: 'Preparing report data...', progress: 30 }));

        const reportData = createReportDataFromContext(context, {
          template: selectedTemplate,
          isDraft,
        });
        
        lastReportDataRef.current = reportData;
        
        setState(prev => ({ ...prev, stage: 'Building HTML bundle...', progress: 50 }));
        
        bundle = await preparePDFBundle(orderId, reportData, isDraft, allTemplates);
        lastBundleRef.current = bundle;
      }

      setState(prev => ({ ...prev, stage: 'Regenerating PDF with custom settings...', progress: 70 }));

      const pdfUrl = await regeneratePDFWithSettings(bundle, options);

      if (pdfUrl) {
        setState(prev => ({ ...prev, stage: 'Waiting for PDF to be ready...', progress: 85 }));
        
        // Retry downloading the PDF with exponential backoff
        // PDF.co S3 URLs sometimes need time to propagate
        const maxDownloadRetries = 5;
        const baseDelay = 1500;
        let lastError: Error | null = null;
        
        for (let attempt = 1; attempt <= maxDownloadRetries; attempt++) {
          try {
            setState(prev => ({ 
              ...prev, 
              stage: attempt > 1 ? `Retrying download (attempt ${attempt})...` : 'Downloading PDF...', 
              progress: 85 + (attempt * 2) 
            }));
            
            const response = await fetch(pdfUrl);
            if (response.ok) {
              const blob = await response.blob();
              const downloadUrl = window.URL.createObjectURL(blob);
              
              const link = document.createElement('a');
              link.href = downloadUrl;
              link.download = bundle.filename;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              window.URL.revokeObjectURL(downloadUrl);
              
              setState(prev => ({
                ...prev,
                stage: 'PDF downloaded successfully!',
                progress: 100
              }));
              
              setTimeout(() => {
                setState(prev => ({ ...prev, isGenerating: false }));
              }, 2000);
              
              return pdfUrl;
            } else {
              lastError = new Error(`Download failed with status ${response.status}`);
              console.warn(`PDF download attempt ${attempt} failed:`, response.status);
            }
          } catch (fetchError) {
            lastError = fetchError instanceof Error ? fetchError : new Error('Download failed');
            console.warn(`PDF download attempt ${attempt} error:`, fetchError);
          }
          
          // Wait before retry (exponential backoff)
          if (attempt < maxDownloadRetries) {
            await new Promise(resolve => setTimeout(resolve, baseDelay * attempt));
          }
        }
        
        throw lastError || new Error('Failed to download PDF after multiple attempts');
      }
      
      return null;
    } catch (error) {
      setState(prev => ({
        ...prev,
        stage: 'PDF regeneration failed',
        progress: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
      return null;
    }
  }, []);

  /**
   * Get the last cached bundle (for passing to settings modal)
   */
  const getCachedBundle = useCallback(() => lastBundleRef.current, []);

  return {
    ...state,
    generatePDF,
    regenerateWithSettings,
    getCachedBundle,
    resetState
  };
};

export default usePDFGeneration;