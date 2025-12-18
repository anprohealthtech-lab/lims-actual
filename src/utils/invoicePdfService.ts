/**
 * Invoice PDF Generation Service
 * 
 * Handles PDF generation for invoices using CKEditor templates and PDF.co API.
 * Features:
 * - Template-based HTML generation with placeholder replacement
 * - Partial invoice support (INV-2024-001-P1 suffix pattern)
 * - Financial validation before generation
 * - Upload to Supabase Storage (invoices bucket)
 */

import { supabase } from './supabase';

// Edge Function URL for PDF generation (keeps API key secure)
const PDF_GENERATION_FUNCTION_URL = import.meta.env.VITE_SUPABASE_URL 
  ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-invoice-pdf`
  : 'http://localhost:54321/functions/v1/generate-invoice-pdf';

export interface Invoice {
  id: string;
  lab_id: string;
  invoice_number?: string;
  invoice_date: string;
  due_date: string;
  patient_id: string;
  patient_name: string;
  order_id?: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  amount_paid: number;
  status: string;
  is_partial: boolean;
  parent_invoice_id?: string;
  payment_type: string;
  notes?: string;
  invoice_items?: InvoiceItem[];
  lab?: {
    name: string;
    address?: string;
    phone?: string;
    email?: string;
    license_number?: string;
    registration_number?: string;
  };
  patient?: {
    phone?: string;
    email?: string;
    address?: string;
  };
  doctor?: string;
}

export interface InvoiceItem {
  id: string;
  test_name: string;
  quantity: number;
  price: number;
  total: number;
  discount_amount?: number;
}

export interface InvoiceTemplate {
  id: string;
  lab_id: string;
  template_name: string;
  gjs_html?: string;
  gjs_css?: string;
  is_default: boolean;
  include_payment_terms: boolean;
  payment_terms_text?: string;
  include_bank_details: boolean;
  bank_details?: {
    account_name?: string;
    account_number?: string;
    ifsc?: string;
    bank_name?: string;
    upi_id?: string;
  };
  tax_disclaimer?: string;
}

/**
 * Main function to generate invoice PDF
 */
export async function generateInvoicePDF(
  invoiceId: string,
  templateId?: string
): Promise<string> {
  try {
    // 1. Fetch invoice data with all relations
    const invoice = await fetchInvoiceData(invoiceId);
    if (!invoice) {
      throw new Error('Invoice not found');
    }

    // 2. Financial validation
    await validateInvoiceForPdf(invoice);

    // 3. Load template (user-selected or default)
    const template = templateId
      ? await fetchTemplateById(templateId)
      : await fetchDefaultTemplate(invoice.lab_id);

    if (!template) {
      throw new Error('No invoice template found. Please create a default template first.');
    }

    // 4. Generate invoice number if not exists
    if (!invoice.invoice_number) {
      invoice.invoice_number = await generateInvoiceNumber(invoice);
    }

    // 5. Build HTML bundle with data
    const htmlBundle = buildInvoiceHtmlBundle(invoice, template);

    // 6. Call Edge Function to generate and upload PDF
    const pdfUrl = await callEdgeFunctionPdfGeneration(
      htmlBundle,
      invoice.invoice_number,
      invoiceId,
      invoice.lab_id
    );

    // 7. Update invoice record
    await updateInvoiceWithPdf(invoiceId, pdfUrl, template.id, invoice.invoice_number);

    return pdfUrl;
  } catch (error) {
    console.error('Invoice PDF generation failed:', error);
    throw error;
  }
}

/**
 * Fetch complete invoice data with relations
 */
async function fetchInvoiceData(invoiceId: string): Promise<Invoice | null> {
  const { data, error } = await supabase
    .from('invoices')
    .select(`
      *,
      lab:labs(name, address, phone, email, license_number, registration_number),
      patient:patients(phone, email, address),
      invoice_items(*)
    `)
    .eq('id', invoiceId)
    .single();

  if (error) {
    console.error('Failed to fetch invoice:', error);
    throw new Error(`Failed to fetch invoice: ${error.message}`);
  }

  return data as Invoice;
}

/**
 * Fetch template by ID
 */
async function fetchTemplateById(templateId: string): Promise<InvoiceTemplate | null> {
  const { data, error } = await supabase
    .from('invoice_templates')
    .select('*')
    .eq('id', templateId)
    .eq('is_active', true)
    .single();

  if (error) {
    console.error('Failed to fetch template:', error);
    return null;
  }

  return data;
}

/**
 * Fetch default template for lab
 */
async function fetchDefaultTemplate(labId: string): Promise<InvoiceTemplate | null> {
  const { data, error } = await supabase
    .from('invoice_templates')
    .select('*')
    .eq('lab_id', labId)
    .eq('is_default', true)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    // Fallback: get any active template for this lab
    const { data: fallback } = await supabase
      .from('invoice_templates')
      .select('*')
      .eq('lab_id', labId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return fallback || null;
  }

  return data;
}

/**
 * Build HTML bundle with template and invoice data
 */
function buildInvoiceHtmlBundle(invoice: Invoice, template: InvoiceTemplate): string {
  let html = template.gjs_html || getDefaultInvoiceHtml();
  let css = template.gjs_css || getDefaultInvoiceCss();

  // Replace basic placeholders
  const placeholders: Record<string, string> = {
    '{{invoice_number}}': invoice.invoice_number || 'N/A',
    '{{invoice_date}}': formatDate(invoice.invoice_date),
    '{{due_date}}': formatDate(invoice.due_date),
    '{{patient_name}}': invoice.patient_name || 'N/A',
    '{{patient_phone}}': invoice.patient?.phone || '',
    '{{patient_email}}': invoice.patient?.email || '',
    '{{patient_address}}': invoice.patient?.address || '',
    '{{doctor}}': invoice.doctor || '',
    '{{subtotal}}': formatCurrency(invoice.subtotal),
    '{{discount}}': formatCurrency(invoice.discount),
    '{{tax}}': formatCurrency(invoice.tax),
    '{{total}}': formatCurrency(invoice.total),
    '{{amount_paid}}': formatCurrency(invoice.amount_paid),
    '{{balance_due}}': formatCurrency(invoice.total - invoice.amount_paid),
    '{{payment_type}}': formatPaymentType(invoice.payment_type),
    '{{lab_name}}': invoice.lab?.name || '',
    '{{lab_address}}': invoice.lab?.address || '',
    '{{lab_phone}}': invoice.lab?.phone || '',
    '{{lab_email}}': invoice.lab?.email || '',
    '{{lab_license}}': invoice.lab?.license_number || '',
    '{{lab_registration}}': invoice.lab?.registration_number || '',
    '{{notes}}': invoice.notes || '',
    '{{current_date}}': formatDate(new Date().toISOString()),
  };

  // Replace all placeholders
  Object.entries(placeholders).forEach(([key, value]) => {
    html = html.replace(new RegExp(key, 'g'), value);
  });

  // Build invoice items table
  const itemsHtml = buildInvoiceItemsTable(invoice.invoice_items || []);
  html = html.replace(/{{invoice_items}}/g, itemsHtml);

  // Add payment terms if enabled
  if (template.include_payment_terms && template.payment_terms_text) {
    const paymentTermsHtml = `
      <div class="payment-terms">
        <h4>Payment Terms</h4>
        <p>${template.payment_terms_text}</p>
      </div>
    `;
    html = html.replace(/{{payment_terms}}/g, paymentTermsHtml);
  } else {
    html = html.replace(/{{payment_terms}}/g, '');
  }

  // Add bank details if enabled
  if (template.include_bank_details && template.bank_details) {
    const bankHtml = buildBankDetailsHtml(template.bank_details);
    html = html.replace(/{{bank_details}}/g, bankHtml);
  } else {
    html = html.replace(/{{bank_details}}/g, '');
  }

  // Add tax disclaimer if present
  if (template.tax_disclaimer) {
    html = html.replace(/{{tax_disclaimer}}/g, template.tax_disclaimer);
  } else {
    html = html.replace(/{{tax_disclaimer}}/g, '');
  }

  // Partial invoice indicator
  if (invoice.is_partial) {
    const partialBadge = '<div class="partial-invoice-badge">PARTIAL INVOICE</div>';
    html = html.replace(/{{partial_badge}}/g, partialBadge);
  } else {
    html = html.replace(/{{partial_badge}}/g, '');
  }

  // Wrap in complete HTML document
  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Invoice ${invoice.invoice_number}</title>
        <style>${css}</style>
      </head>
      <body>
        ${html}
      </body>
    </html>
  `;
}

/**
 * Build invoice items table HTML
 */
function buildInvoiceItemsTable(items: InvoiceItem[]): string {
  if (!items || items.length === 0) {
    return '<tr><td colspan="4">No items</td></tr>';
  }

  return items
    .map(
      (item) => `
    <tr>
      <td>${item.test_name}</td>
      <td style="text-align: center;">${item.quantity}</td>
      <td style="text-align: right;">₹${item.price.toFixed(2)}</td>
      <td style="text-align: right;">₹${item.total.toFixed(2)}</td>
    </tr>
  `
    )
    .join('');
}

/**
 * Build bank details HTML
 */
function buildBankDetailsHtml(bankDetails: InvoiceTemplate['bank_details']): string {
  if (!bankDetails) return '';

  return `
    <div class="bank-details">
      <h4>Bank Details for Payment</h4>
      <table style="width: 100%; font-size: 14px;">
        ${bankDetails.account_name ? `<tr><td><strong>Account Name:</strong></td><td>${bankDetails.account_name}</td></tr>` : ''}
        ${bankDetails.account_number ? `<tr><td><strong>Account Number:</strong></td><td>${bankDetails.account_number}</td></tr>` : ''}
        ${bankDetails.ifsc ? `<tr><td><strong>IFSC Code:</strong></td><td>${bankDetails.ifsc}</td></tr>` : ''}
        ${bankDetails.bank_name ? `<tr><td><strong>Bank Name:</strong></td><td>${bankDetails.bank_name}</td></tr>` : ''}
        ${bankDetails.upi_id ? `<tr><td><strong>UPI ID:</strong></td><td>${bankDetails.upi_id}</td></tr>` : ''}
      </table>
    </div>
  `;
}

/**
 * Edge Function to generate PDF and upload to storage
 * This keeps PDF.co API key secure on the server side
 */
async function callEdgeFunctionPdfGeneration(
  html: string,
  filename: string,
  invoiceId: string,
  labId: string
): Promise<string> {
  // Get auth token for edge function call
  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session?.access_token) {
    throw new Error('User not authenticated');
  }

  const response = await fetch(PDF_GENERATION_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      html,
      filename: `${filename}.pdf`,
      invoiceId,
      labId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Edge function error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(`PDF generation failed: ${result.error || 'Unknown error'}`);
  }

  return result.pdfUrl

  return await pdfResponse.blob();
}

/**
 * Note: PDF upload is now handled by the edge function
 * This function is no longer needed but kept for reference
 */

/**
 * Update invoice record with PDF URL and metadata
 */
async function updateInvoiceWithPdf(
  invoiceId: string,
  pdfUrl: string,
  templateId: string,
  invoiceNumber: string
): Promise<void> {
  const { error } = await supabase
    .from('invoices')
    .update({
      pdf_url: pdfUrl,
      pdf_generated_at: new Date().toISOString(),
      template_id: templateId,
      invoice_number: invoiceNumber,
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId);

  if (error) {
    console.error('Failed to update invoice:', error);
    throw new Error(`Failed to update invoice: ${error.message}`);
  }
}

/**
 * Generate invoice number (INV-YYYY-NNNN or INV-YYYY-NNNN-PN for partials)
 */
async function generateInvoiceNumber(invoice: Invoice): Promise<string> {
  const year = new Date(invoice.invoice_date).getFullYear();

  // If partial invoice, get parent invoice number and add suffix
  if (invoice.is_partial && invoice.parent_invoice_id) {
    const { data: parentInvoice } = await supabase
      .from('invoices')
      .select('invoice_number')
      .eq('id', invoice.parent_invoice_id)
      .single();

    if (parentInvoice?.invoice_number) {
      // Count existing partial invoices for this parent
      const { data: partialInvoices } = await supabase
        .from('invoices')
        .select('invoice_number')
        .eq('parent_invoice_id', invoice.parent_invoice_id)
        .not('invoice_number', 'is', null);

      const partialCount = (partialInvoices?.length || 0) + 1;
      return `${parentInvoice.invoice_number}-P${partialCount}`;
    }
  }

  // Regular invoice: get last invoice number for this lab/year
  const { data: lastInvoice } = await supabase
    .from('invoices')
    .select('invoice_number')
    .eq('lab_id', invoice.lab_id)
    .like('invoice_number', `INV-${year}-%`)
    .not('invoice_number', 'ilike', '%-P%') // Exclude partial invoices
    .order('created_at', { ascending: false })
    .limit(1);

  let nextSequence = 1;
  if (lastInvoice?.invoice_number) {
    const parts = lastInvoice.invoice_number.split('-');
    const lastSequence = parseInt(parts[parts.length - 1]) || 0;
    nextSequence = lastSequence + 1;
  }

  return `INV-${year}-${String(nextSequence).padStart(4, '0')}`;
}

/**
 * Financial validation before PDF generation
 */
async function validateInvoiceForPdf(invoice: Invoice): Promise<void> {
  // 1. Check if invoice has items
  if (!invoice.invoice_items || invoice.invoice_items.length === 0) {
    throw new Error('Cannot generate PDF: Invoice has no line items');
  }

  // 2. Validate financial totals
  const itemsTotal = invoice.invoice_items.reduce((sum, item) => sum + item.total, 0);
  const expectedSubtotal = itemsTotal;

  if (Math.abs(invoice.subtotal - expectedSubtotal) > 0.01) {
    console.warn(`Invoice subtotal mismatch: ${invoice.subtotal} vs calculated ${expectedSubtotal}`);
  }

  // 3. Validate partial invoice constraints
  if (invoice.is_partial) {
    if (!invoice.parent_invoice_id) {
      throw new Error('Partial invoice must have parent_invoice_id');
    }

    // Check parent invoice exists and total is valid
    const { data: parentInvoice } = await supabase
      .from('invoices')
      .select('total, amount_paid')
      .eq('id', invoice.parent_invoice_id)
      .single();

    if (!parentInvoice) {
      throw new Error('Parent invoice not found');
    }

    // Get sum of all partial invoices
    const { data: allPartials } = await supabase
      .from('invoices')
      .select('total')
      .eq('parent_invoice_id', invoice.parent_invoice_id)
      .eq('is_partial', true);

    const totalPartials = allPartials?.reduce((sum, p) => sum + p.total, 0) || 0;

    // Validate not over-invoicing
    if (totalPartials > parentInvoice.total) {
      throw new Error(
        `Partial invoices total (₹${totalPartials}) exceeds parent invoice total (₹${parentInvoice.total})`
      );
    }
  }

  // 4. Check if amount_paid exceeds total
  if (invoice.amount_paid > invoice.total + 0.01) {
    throw new Error(
      `Amount paid (₹${invoice.amount_paid}) exceeds invoice total (₹${invoice.total})`
    );
  }

  // 5. Validate status consistency
  if (invoice.status === 'Paid' && invoice.amount_paid < invoice.total - 0.01) {
    console.warn(`Invoice marked as Paid but amount_paid (₹${invoice.amount_paid}) < total (₹${invoice.total})`);
  }
}

// Helper functions
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatCurrency(amount: number): string {
  return `₹${amount.toFixed(2)}`;
}

function formatPaymentType(type: string): string {
  const types: Record<string, string> = {
    self: 'Self Pay',
    credit: 'Credit Account',
    insurance: 'Insurance',
    corporate: 'Corporate',
  };
  return types[type] || type;
}

/**
 * Default invoice HTML template (fallback)
 */
function getDefaultInvoiceHtml(): string {
  return `
    <div class="invoice-container">
      <div class="invoice-header">
        <h1>{{lab_name}}</h1>
        <p>{{lab_address}}</p>
        <p>Phone: {{lab_phone}} | Email: {{lab_email}}</p>
        <p>License: {{lab_license}}</p>
      </div>
      
      {{partial_badge}}
      
      <div class="invoice-title">
        <h2>INVOICE</h2>
        <p><strong>Invoice #:</strong> {{invoice_number}}</p>
        <p><strong>Date:</strong> {{invoice_date}}</p>
        <p><strong>Due Date:</strong> {{due_date}}</p>
      </div>
      
      <div class="patient-info">
        <h3>Bill To:</h3>
        <p><strong>{{patient_name}}</strong></p>
        <p>{{patient_address}}</p>
        <p>Phone: {{patient_phone}}</p>
        <p>Doctor: {{doctor}}</p>
      </div>
      
      <table class="invoice-items">
        <thead>
          <tr>
            <th>Test Name</th>
            <th>Qty</th>
            <th>Price</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {{invoice_items}}
        </tbody>
      </table>
      
      <div class="invoice-totals">
        <table>
          <tr><td>Subtotal:</td><td>{{subtotal}}</td></tr>
          <tr><td>Discount:</td><td>-{{discount}}</td></tr>
          <tr><td>Tax (GST):</td><td>{{tax}}</td></tr>
          <tr class="total-row"><td><strong>Total:</strong></td><td><strong>{{total}}</strong></td></tr>
          <tr><td>Amount Paid:</td><td>{{amount_paid}}</td></tr>
          <tr class="balance-row"><td><strong>Balance Due:</strong></td><td><strong>{{balance_due}}</strong></td></tr>
        </table>
      </div>
      
      {{payment_terms}}
      {{bank_details}}
      
      <div class="invoice-footer">
        <p>{{tax_disclaimer}}</p>
        <p><em>Thank you for your business!</em></p>
      </div>
    </div>
  `;
}

/**
 * Default invoice CSS (fallback)
 */
function getDefaultInvoiceCss(): string {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333; }
    .invoice-container { max-width: 800px; margin: 0 auto; padding: 20px; }
    .invoice-header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 20px; }
    .invoice-header h1 { font-size: 24px; margin-bottom: 10px; }
    .invoice-title { text-align: right; margin-bottom: 30px; }
    .invoice-title h2 { font-size: 28px; color: #0066cc; }
    .patient-info { margin-bottom: 30px; padding: 15px; background: #f5f5f5; border-radius: 5px; }
    .invoice-items { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    .invoice-items th, .invoice-items td { border: 1px solid #ddd; padding: 10px; text-align: left; }
    .invoice-items th { background: #0066cc; color: white; font-weight: bold; }
    .invoice-totals { margin-left: auto; width: 300px; }
    .invoice-totals table { width: 100%; }
    .invoice-totals td { padding: 8px; border-bottom: 1px solid #eee; }
    .total-row { font-size: 18px; background: #f5f5f5; }
    .balance-row { font-size: 16px; color: #cc0000; }
    .payment-terms, .bank-details { margin: 20px 0; padding: 15px; background: #f9f9f9; border-left: 4px solid #0066cc; }
    .invoice-footer { margin-top: 40px; text-align: center; font-size: 12px; color: #666; }
    .partial-invoice-badge { position: absolute; top: 20px; right: 20px; background: #ff9800; color: white; padding: 10px 20px; font-weight: bold; transform: rotate(10deg); }
  `;
}
