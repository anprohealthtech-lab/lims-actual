/**
 * PDF Generation Provider Configuration
 * 
 * This module provides centralized configuration for PDF generation,
 * allowing easy switching between Puppeteer and PDF.co providers.
 */

export type PDFProvider = 'puppeteer' | 'pdfco' | 'auto';

export interface PDFProviderConfig {
  /** Primary provider to use */
  provider: PDFProvider;
  
  /** Enable automatic fallback to PDF.co if Puppeteer fails */
  enableFallback: boolean;
  
  /** Puppeteer service URL (DigitalOcean deployment) */
  puppeteerServiceUrl: string;
  
  /** PDF.co API key */
  pdfcoApiKey: string;
  
  /** Timeout for PDF generation (milliseconds) */
  timeout: number;
  
  /** Enable debug logging */
  debug: boolean;
}

/**
 * Default configuration
 * Can be overridden via environment variables
 */
const defaultConfig: PDFProviderConfig = {
  // Provider selection: 'puppeteer' | 'pdfco' | 'auto'
  // 'auto' = try Puppeteer first, fallback to PDF.co on failure
  // Changed to 'pdfco' for faster generation (now that CSS variables are fixed)
  provider: (import.meta.env.VITE_PDF_PROVIDER as PDFProvider) || 'pdfco',
  
  // Enable automatic fallback
  enableFallback: import.meta.env.VITE_PDF_FALLBACK !== 'false',
  
  // Puppeteer service endpoint
  puppeteerServiceUrl: import.meta.env.VITE_PUPPETEER_SERVICE_URL || 
    'https://plankton-app-oakzv.ondigitalocean.app',
  
  // PDF.co API key
  pdfcoApiKey: import.meta.env.VITE_PDFCO_API_KEY || 
    'landinquiryfirm@gmail.com_AEu7lrDUacQsWOHuJ757dQDYPrJz6XbsYQcX2HrSVXf1LX8cvBn94TPzmfpeVgrT',
  
  // Timeout (30 seconds)
  timeout: 30000,
  
  // Debug logging
  debug: import.meta.env.MODE === 'development'
};

/**
 * Current active configuration
 */
let activeConfig: PDFProviderConfig = { ...defaultConfig };

/**
 * Get current PDF provider configuration
 */
export function getPDFConfig(): Readonly<PDFProviderConfig> {
  return { ...activeConfig };
}

/**
 * Update PDF provider configuration
 */
export function setPDFConfig(config: Partial<PDFProviderConfig>): void {
  activeConfig = { ...activeConfig, ...config };
  if (activeConfig.debug) {
    console.log('📄 PDF Config Updated:', activeConfig);
  }
}

/**
 * Reset configuration to defaults
 */
export function resetPDFConfig(): void {
  activeConfig = { ...defaultConfig };
}

/**
 * Check if Puppeteer should be used
 */
export function shouldUsePuppeteer(): boolean {
  const config = getPDFConfig();
  
  // If explicitly set to pdfco, don't use Puppeteer
  if (config.provider === 'pdfco') {
    return false;
  }
  
  // If explicitly set to puppeteer or auto, try Puppeteer
  if (config.provider === 'puppeteer' || config.provider === 'auto') {
    return true;
  }
  
  return false;
}

/**
 * Check if fallback to PDF.co is enabled
 */
export function shouldFallbackToPDFCO(): boolean {
  const config = getPDFConfig();
  return config.enableFallback && config.provider === 'auto';
}

/**
 * Log PDF generation event
 */
export function logPDFEvent(
  event: 'start' | 'success' | 'error' | 'fallback',
  provider: 'puppeteer' | 'pdfco',
  details?: any
): void {
  const config = getPDFConfig();
  if (!config.debug) return;

  const emoji = {
    start: '🚀',
    success: '✅',
    error: '❌',
    fallback: '🔄'
  }[event];

  console.log(`${emoji} PDF [${provider}] ${event.toUpperCase()}`, details || '');
}

/**
 * Get performance metrics comparison
 */
export interface PerformanceMetrics {
  provider: 'puppeteer' | 'pdfco';
  totalTime: number;
  stages: {
    preparation?: number;
    generation?: number;
    upload?: number;
  };
}

const performanceHistory: PerformanceMetrics[] = [];

export function recordPerformanceMetrics(metrics: PerformanceMetrics): void {
  performanceHistory.push(metrics);
  
  // Keep only last 50 entries
  if (performanceHistory.length > 50) {
    performanceHistory.shift();
  }
  
  const config = getPDFConfig();
  if (config.debug) {
    console.log('📊 PDF Performance:', {
      ...metrics,
      averagePuppeteer: getAverageTime('puppeteer'),
      averagePDFCO: getAverageTime('pdfco')
    });
  }
}

export function getAverageTime(provider: 'puppeteer' | 'pdfco'): number | null {
  const filtered = performanceHistory.filter(m => m.provider === provider);
  if (filtered.length === 0) return null;
  
  const total = filtered.reduce((sum, m) => sum + m.totalTime, 0);
  return Math.round(total / filtered.length);
}

export function getPerformanceStats() {
  return {
    puppeteerAvg: getAverageTime('puppeteer'),
    pdfcoAvg: getAverageTime('pdfco'),
    totalGenerated: performanceHistory.length,
    history: performanceHistory.slice(-10) // Last 10
  };
}

/**
 * Environment variable guide for .env file:
 * 
 * # PDF Provider Selection
 * VITE_PDF_PROVIDER=auto          # 'puppeteer' | 'pdfco' | 'auto' (default: auto)
 * 
 * # Enable/Disable Fallback
 * VITE_PDF_FALLBACK=true          # true | false (default: true)
 * 
 * # Puppeteer Service URL
 * VITE_PUPPETEER_SERVICE_URL=https://plankton-app-oakzv.ondigitalocean.app
 * 
 * # PDF.co API Key (fallback)
 * VITE_PDFCO_API_KEY=your-api-key
 */
