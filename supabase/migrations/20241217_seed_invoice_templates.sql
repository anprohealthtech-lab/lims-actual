-- Seed 5 default invoice templates for all existing labs
-- Each template uses CKEditor-compatible HTML/CSS structure

-- Template 1: Standard Invoice (Default)
INSERT INTO public.invoice_templates (
  lab_id,
  template_name,
  template_description,
  category,
  is_default,
  is_active,
  include_payment_terms,
  payment_terms_text,
  include_tax_breakdown,
  include_bank_details,
  gjs_html,
  gjs_css
)
SELECT 
  l.id as lab_id,
  'Standard Invoice',
  'Clean and professional invoice template with all essential details',
  'standard',
  true,
  true,
  true,
  'Payment due within 15 days from invoice date',
  true,
  false,
  '<div class="invoice-wrapper">
    <div class="invoice-header">
      <div class="lab-info">
        <h1 class="lab-name">{{lab_name}}</h1>
        <p class="lab-details">{{lab_address}}</p>
        <p class="lab-details">Phone: {{lab_phone}} | Email: {{lab_email}}</p>
        <p class="lab-details">License No: {{lab_license}} | Reg. No: {{lab_registration}}</p>
      </div>
      <div class="invoice-meta">
        <h2 class="invoice-title">INVOICE</h2>
        <p><strong>Invoice No:</strong> {{invoice_number}}</p>
        <p><strong>Date:</strong> {{invoice_date}}</p>
        <p><strong>Due Date:</strong> {{due_date}}</p>
      </div>
    </div>
    
    {{partial_badge}}
    
    <div class="invoice-body">
      <div class="bill-to">
        <h3>Bill To:</h3>
        <p class="patient-name"><strong>{{patient_name}}</strong></p>
        <p>{{patient_address}}</p>
        <p>Phone: {{patient_phone}}</p>
        <p>Referring Doctor: {{doctor}}</p>
        <p>Payment Type: {{payment_type}}</p>
      </div>
      
      <table class="items-table">
        <thead>
          <tr>
            <th>Test / Service</th>
            <th style="text-align: center;">Qty</th>
            <th style="text-align: right;">Rate</th>
            <th style="text-align: right;">Amount</th>
          </tr>
        </thead>
        <tbody>
          {{invoice_items}}
        </tbody>
      </table>
      
      <div class="totals-section">
        <table class="totals-table">
          <tr><td>Subtotal:</td><td>{{subtotal}}</td></tr>
          <tr><td>Discount:</td><td>-{{discount}}</td></tr>
          <tr><td>Tax (GST 18%):</td><td>{{tax}}</td></tr>
          <tr class="total-row"><td><strong>Total Amount:</strong></td><td><strong>{{total}}</strong></td></tr>
          <tr class="paid-row"><td>Amount Paid:</td><td>{{amount_paid}}</td></tr>
          <tr class="balance-row"><td><strong>Balance Due:</strong></td><td><strong>{{balance_due}}</strong></td></tr>
        </table>
      </div>
      
      <div class="terms-section">
        {{payment_terms}}
      </div>
      
      {{bank_details}}
      
      <div class="notes-section">
        <p><strong>Notes:</strong> {{notes}}</p>
      </div>
    </div>
    
    <div class="invoice-footer">
      <p>{{tax_disclaimer}}</p>
      <p class="thank-you"><em>Thank you for choosing our services!</em></p>
      <p class="print-date">Generated on {{current_date}}</p>
    </div>
  </div>',
  'body { font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; }
  .invoice-wrapper { max-width: 210mm; margin: 0 auto; padding: 20mm; background: white; }
  .invoice-header { display: flex; justify-content: space-between; border-bottom: 3px solid #2563eb; padding-bottom: 20px; margin-bottom: 30px; }
  .lab-name { font-size: 24px; color: #1e40af; margin-bottom: 10px; }
  .lab-details { font-size: 13px; color: #6b7280; margin: 4px 0; }
  .invoice-meta { text-align: right; }
  .invoice-title { font-size: 32px; color: #2563eb; margin-bottom: 10px; }
  .bill-to { margin-bottom: 30px; padding: 20px; background: #f3f4f6; border-radius: 8px; }
  .bill-to h3 { color: #1f2937; margin-bottom: 15px; }
  .patient-name { font-size: 16px; color: #111827; margin: 8px 0; }
  .items-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
  .items-table th { background: #2563eb; color: white; padding: 12px; text-align: left; font-weight: 600; }
  .items-table td { border-bottom: 1px solid #e5e7eb; padding: 12px; }
  .totals-section { margin-left: auto; width: 350px; }
  .totals-table { width: 100%; }
  .totals-table td { padding: 10px; border-bottom: 1px solid #e5e7eb; }
  .totals-table td:last-child { text-align: right; font-weight: 500; }
  .total-row { background: #f3f4f6; font-size: 18px; }
  .total-row td { padding: 15px 10px; font-weight: bold; color: #1f2937; }
  .balance-row { background: #fef3c7; font-size: 16px; }
  .balance-row td { padding: 12px 10px; font-weight: bold; color: #92400e; }
  .terms-section, .bank-details { margin: 20px 0; padding: 15px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; }
  .notes-section { margin: 20px 0; padding: 15px; background: #f0fdf4; border-left: 4px solid #10b981; border-radius: 4px; }
  .invoice-footer { margin-top: 50px; text-align: center; padding-top: 20px; border-top: 2px solid #e5e7eb; color: #6b7280; font-size: 12px; }
  .thank-you { font-size: 14px; color: #059669; margin: 10px 0; }
  .partial-invoice-badge { position: absolute; top: 30px; right: 30px; background: #f97316; color: white; padding: 12px 24px; font-weight: bold; font-size: 14px; border-radius: 4px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }'
FROM public.labs l
WHERE NOT EXISTS (
  SELECT 1 FROM public.invoice_templates it 
  WHERE it.lab_id = l.id AND it.template_name = 'Standard Invoice'
);

-- Template 2: Minimal Invoice
INSERT INTO public.invoice_templates (
  lab_id,
  template_name,
  template_description,
  category,
  is_default,
  is_active,
  include_payment_terms,
  payment_terms_text,
  include_tax_breakdown,
  include_bank_details,
  gjs_html,
  gjs_css
)
SELECT 
  l.id as lab_id,
  'Minimal Invoice',
  'Simple and clean invoice design with minimal styling',
  'minimal',
  false,
  true,
  true,
  'Payment due on receipt',
  true,
  false,
  '<div class="minimal-invoice">
    <div class="header-simple">
      <h1>{{lab_name}}</h1>
      <p>{{lab_phone}} | {{lab_email}}</p>
    </div>
    
    <div class="invoice-info">
      <h2>Invoice {{invoice_number}}</h2>
      <p>Date: {{invoice_date}} | Due: {{due_date}}</p>
    </div>
    
    {{partial_badge}}
    
    <div class="recipient">
      <strong>{{patient_name}}</strong><br>
      {{patient_phone}}<br>
      Doctor: {{doctor}}
    </div>
    
    <table class="simple-table">
      <tr><th>Item</th><th>Qty</th><th>Rate</th><th>Total</th></tr>
      {{invoice_items}}
    </table>
    
    <div class="simple-totals">
      <p>Subtotal: {{subtotal}}</p>
      <p>Discount: -{{discount}}</p>
      <p>Tax: {{tax}}</p>
      <p class="total-line"><strong>Total: {{total}}</strong></p>
      <p>Paid: {{amount_paid}}</p>
      <p class="balance-line"><strong>Due: {{balance_due}}</strong></p>
    </div>
    
    {{payment_terms}}
    {{bank_details}}
    
    <div class="footer-simple">
      <p>Thank you!</p>
    </div>
  </div>',
  'body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
  .minimal-invoice { max-width: 800px; margin: 20px auto; padding: 40px; }
  .header-simple { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #000; padding-bottom: 15px; }
  .header-simple h1 { font-size: 28px; margin-bottom: 10px; }
  .invoice-info { text-align: right; margin-bottom: 30px; }
  .invoice-info h2 { font-size: 24px; }
  .recipient { margin-bottom: 30px; line-height: 1.8; }
  .simple-table { width: 100%; border-collapse: collapse; margin: 30px 0; }
  .simple-table th, .simple-table td { border: 1px solid #ddd; padding: 10px; text-align: left; }
  .simple-table th { background: #000; color: #fff; }
  .simple-totals { margin-left: auto; width: 300px; padding: 20px; background: #f9f9f9; }
  .simple-totals p { margin: 8px 0; }
  .total-line { font-size: 18px; border-top: 2px solid #000; padding-top: 10px; margin-top: 10px; }
  .balance-line { font-size: 16px; color: #d00; margin-top: 10px; }
  .footer-simple { text-align: center; margin-top: 50px; padding-top: 20px; border-top: 1px solid #ddd; }
  .partial-invoice-badge { position: absolute; top: 20px; right: 20px; background: #ff6b6b; color: white; padding: 8px 16px; font-weight: bold; }'
FROM public.labs l
WHERE NOT EXISTS (
  SELECT 1 FROM public.invoice_templates it 
  WHERE it.lab_id = l.id AND it.template_name = 'Minimal Invoice'
);

-- Template 3: Professional Invoice
INSERT INTO public.invoice_templates (
  lab_id,
  template_name,
  template_description,
  category,
  is_default,
  is_active,
  include_payment_terms,
  payment_terms_text,
  include_tax_breakdown,
  include_bank_details,
  gjs_html,
  gjs_css
)
SELECT 
  l.id as lab_id,
  'Professional Invoice',
  'Corporate-style invoice with detailed information and branding',
  'professional',
  false,
  true,
  true,
  'Payment due within 30 days. Late payments subject to 2% monthly interest.',
  true,
  true,
  '<div class="pro-invoice">
    <div class="pro-header">
      <div class="branding">
        <h1>{{lab_name}}</h1>
        <p class="tagline">Excellence in Laboratory Services</p>
      </div>
      <div class="invoice-badge">
        <div class="badge-title">INVOICE</div>
        <div class="badge-number">{{invoice_number}}</div>
      </div>
    </div>
    
    {{partial_badge}}
    
    <div class="contact-bar">
      <span>📍 {{lab_address}}</span>
      <span>📞 {{lab_phone}}</span>
      <span>✉ {{lab_email}}</span>
    </div>
    
    <div class="pro-body">
      <div class="info-grid">
        <div class="info-box">
          <h3>Bill To</h3>
          <p class="highlight">{{patient_name}}</p>
          <p>{{patient_address}}</p>
          <p>Phone: {{patient_phone}}</p>
          <p>Email: {{patient_email}}</p>
        </div>
        <div class="info-box">
          <h3>Invoice Details</h3>
          <table class="meta-table">
            <tr><td>Invoice Date:</td><td>{{invoice_date}}</td></tr>
            <tr><td>Due Date:</td><td>{{due_date}}</td></tr>
            <tr><td>Payment Type:</td><td>{{payment_type}}</td></tr>
            <tr><td>Referring Doctor:</td><td>{{doctor}}</td></tr>
          </table>
        </div>
      </div>
      
      <div class="items-section">
        <h3>Services Provided</h3>
        <table class="pro-items-table">
          <thead>
            <tr>
              <th>Description</th>
              <th style="text-align: center;">Quantity</th>
              <th style="text-align: right;">Unit Price</th>
              <th style="text-align: right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            {{invoice_items}}
          </tbody>
        </table>
      </div>
      
      <div class="summary-section">
        <div class="summary-box">
          <table class="summary-table">
            <tr><td>Subtotal</td><td>{{subtotal}}</td></tr>
            <tr><td>Discount Applied</td><td>-{{discount}}</td></tr>
            <tr><td>GST (18%)</td><td>{{tax}}</td></tr>
            <tr class="grand-total"><td>Grand Total</td><td>{{total}}</td></tr>
            <tr class="amount-paid"><td>Amount Paid</td><td>{{amount_paid}}</td></tr>
            <tr class="outstanding"><td>Outstanding Balance</td><td>{{balance_due}}</td></tr>
          </table>
        </div>
      </div>
      
      <div class="additional-info">
        <div class="info-panel">
          {{payment_terms}}
        </div>
        <div class="info-panel">
          {{bank_details}}
        </div>
      </div>
      
      <div class="notes-panel">
        <h4>Additional Notes</h4>
        <p>{{notes}}</p>
      </div>
    </div>
    
    <div class="pro-footer">
      <div class="footer-row">
        <div>{{tax_disclaimer}}</div>
        <div>License: {{lab_license}} | Registration: {{lab_registration}}</div>
      </div>
      <div class="footer-bottom">
        <p><strong>Thank you for your business!</strong></p>
        <p class="small-text">This is a computer-generated invoice. Generated on {{current_date}}</p>
      </div>
    </div>
  </div>',
  'body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
  .pro-invoice { max-width: 210mm; margin: 0 auto; background: white; }
  .pro-header { display: flex; justify-content: space-between; align-items: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px 40px; }
  .branding h1 { font-size: 28px; margin-bottom: 5px; }
  .tagline { font-size: 14px; opacity: 0.9; }
  .invoice-badge { text-align: right; }
  .badge-title { font-size: 14px; letter-spacing: 2px; opacity: 0.8; }
  .badge-number { font-size: 24px; font-weight: bold; }
  .contact-bar { display: flex; justify-content: space-around; background: #f8f9fa; padding: 15px; font-size: 13px; border-bottom: 2px solid #e9ecef; }
  .pro-body { padding: 40px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 40px; }
  .info-box { padding: 20px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #667eea; }
  .info-box h3 { margin-bottom: 15px; color: #495057; font-size: 16px; }
  .highlight { font-size: 18px; font-weight: bold; color: #212529; margin: 10px 0; }
  .meta-table { width: 100%; font-size: 14px; }
  .meta-table td { padding: 6px 0; }
  .meta-table td:first-child { color: #6c757d; width: 120px; }
  .items-section h3 { color: #495057; margin-bottom: 15px; }
  .pro-items-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
  .pro-items-table thead { background: #495057; color: white; }
  .pro-items-table th { padding: 15px; font-weight: 600; }
  .pro-items-table td { padding: 15px; border-bottom: 1px solid #dee2e6; }
  .summary-section { display: flex; justify-content: flex-end; margin-bottom: 30px; }
  .summary-box { width: 400px; }
  .summary-table { width: 100%; font-size: 16px; }
  .summary-table td { padding: 12px 15px; border-bottom: 1px solid #dee2e6; }
  .summary-table td:last-child { text-align: right; font-weight: 500; }
  .grand-total { background: #495057; color: white; font-size: 18px; font-weight: bold; }
  .amount-paid { background: #d4edda; color: #155724; }
  .outstanding { background: #fff3cd; color: #856404; font-weight: bold; }
  .additional-info { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
  .info-panel { padding: 20px; background: #e7f3ff; border-radius: 8px; border-left: 4px solid #0066cc; }
  .notes-panel { padding: 20px; background: #f8f9fa; border-radius: 8px; margin-bottom: 30px; }
  .pro-footer { background: #f8f9fa; padding: 30px 40px; border-top: 3px solid #667eea; }
  .footer-row { display: flex; justify-content: space-between; font-size: 12px; color: #6c757d; margin-bottom: 20px; }
  .footer-bottom { text-align: center; }
  .footer-bottom p { margin: 5px 0; }
  .small-text { font-size: 11px; color: #adb5bd; }
  .partial-invoice-badge { position: absolute; top: 50px; right: 50px; background: #ff6b6b; color: white; padding: 12px 24px; font-weight: bold; border-radius: 50px; box-shadow: 0 4px 8px rgba(0,0,0,0.2); }'
FROM public.labs l
WHERE NOT EXISTS (
  SELECT 1 FROM public.invoice_templates it 
  WHERE it.lab_id = l.id AND it.template_name = 'Professional Invoice'
);

-- Template 4: B2B Detailed Invoice
INSERT INTO public.invoice_templates (
  lab_id,
  template_name,
  template_description,
  category,
  is_default,
  is_active,
  include_payment_terms,
  payment_terms_text,
  include_tax_breakdown,
  include_bank_details,
  tax_disclaimer,
  gjs_html,
  gjs_css
)
SELECT 
  l.id as lab_id,
  'B2B Detailed Invoice',
  'Comprehensive invoice for corporate clients with detailed tax breakdown',
  'b2b',
  false,
  true,
  true,
  'Payment terms: Net 30. Bank transfer preferred. Please quote invoice number.',
  true,
  true,
  'This is a tax invoice. GST is applicable as per CGST/SGST/IGST regulations.',
  '<div class="b2b-invoice">
    <div class="letterhead">
      <div class="company-logo">
        <h1>{{lab_name}}</h1>
        <p class="company-tagline">Accredited Laboratory Services</p>
      </div>
      <div class="company-details">
        <p>{{lab_address}}</p>
        <p>Phone: {{lab_phone}} | Email: {{lab_email}}</p>
        <p><strong>GSTIN:</strong> {{lab_license}}</p>
        <p><strong>CIN:</strong> {{lab_registration}}</p>
      </div>
    </div>
    
    <div class="document-title">
      <h2>TAX INVOICE</h2>
      {{partial_badge}}
    </div>
    
    <div class="invoice-details-grid">
      <div class="detail-section">
        <h4>Invoice Information</h4>
        <table class="detail-table">
          <tr><td>Invoice No:</td><td><strong>{{invoice_number}}</strong></td></tr>
          <tr><td>Invoice Date:</td><td>{{invoice_date}}</td></tr>
          <tr><td>Due Date:</td><td>{{due_date}}</td></tr>
          <tr><td>Payment Type:</td><td>{{payment_type}}</td></tr>
        </table>
      </div>
      <div class="detail-section">
        <h4>Bill To</h4>
        <p class="client-name">{{patient_name}}</p>
        <p>{{patient_address}}</p>
        <p>Phone: {{patient_phone}}</p>
        <p>Email: {{patient_email}}</p>
        <p>Ref. Doctor: {{doctor}}</p>
      </div>
    </div>
    
    <div class="services-section">
      <h4>Services & Charges</h4>
      <table class="b2b-items-table">
        <thead>
          <tr>
            <th style="width: 50%;">Description of Services</th>
            <th style="text-align: center; width: 10%;">Qty</th>
            <th style="text-align: right; width: 15%;">Rate (₹)</th>
            <th style="text-align: right; width: 10%;">Discount</th>
            <th style="text-align: right; width: 15%;">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {{invoice_items}}
        </tbody>
        <tfoot>
          <tr class="subtotal-row">
            <td colspan="4" style="text-align: right;"><strong>Subtotal:</strong></td>
            <td style="text-align: right;"><strong>{{subtotal}}</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>
    
    <div class="tax-section">
      <div class="tax-breakdown">
        <h4>Tax Breakdown</h4>
        <table class="tax-table">
          <tr><td>Taxable Amount:</td><td>{{subtotal}}</td></tr>
          <tr><td>Less: Discount:</td><td>-{{discount}}</td></tr>
          <tr><td>CGST @ 9%:</td><td>{{tax}}</td></tr>
          <tr><td>SGST @ 9%:</td><td>{{tax}}</td></tr>
          <tr class="tax-total"><td><strong>Total Tax (GST):</strong></td><td><strong>{{tax}}</strong></td></tr>
        </table>
      </div>
      <div class="amount-summary">
        <table class="summary-amounts">
          <tr class="total-amount"><td>Invoice Total:</td><td>{{total}}</td></tr>
          <tr class="paid-amount"><td>Amount Paid:</td><td>{{amount_paid}}</td></tr>
          <tr class="due-amount"><td>Balance Due:</td><td>{{balance_due}}</td></tr>
        </table>
      </div>
    </div>
    
    <div class="terms-bank-section">
      <div class="terms-box">
        {{payment_terms}}
      </div>
      <div class="bank-box">
        {{bank_details}}
      </div>
    </div>
    
    <div class="notes-section-b2b">
      <h4>Notes & Remarks</h4>
      <p>{{notes}}</p>
    </div>
    
    <div class="declaration">
      <p><strong>Declaration:</strong> {{tax_disclaimer}}</p>
      <p>We declare that this invoice shows the actual price of the services described and that all particulars are true and correct.</p>
    </div>
    
    <div class="signature-section">
      <div class="signature-box">
        <p>For <strong>{{lab_name}}</strong></p>
        <div class="signature-line"></div>
        <p>Authorized Signatory</p>
      </div>
    </div>
    
    <div class="b2b-footer">
      <p>This is a system-generated invoice. Generated on {{current_date}}</p>
      <p><em>Thank you for your business partnership!</em></p>
    </div>
  </div>',
  'body { font-family: "Times New Roman", Times, serif; margin: 0; padding: 0; }
  .b2b-invoice { max-width: 210mm; margin: 0 auto; padding: 15mm; background: white; }
  .letterhead { border-bottom: 3px double #000; padding-bottom: 15px; margin-bottom: 20px; }
  .company-logo h1 { font-size: 26px; margin-bottom: 5px; }
  .company-tagline { font-style: italic; color: #555; font-size: 13px; }
  .company-details { margin-top: 10px; font-size: 12px; line-height: 1.6; }
  .document-title { text-align: center; margin: 20px 0; position: relative; }
  .document-title h2 { font-size: 28px; border: 2px solid #000; display: inline-block; padding: 10px 30px; }
  .invoice-details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
  .detail-section { border: 1px solid #ddd; padding: 15px; }
  .detail-section h4 { margin-bottom: 10px; border-bottom: 2px solid #000; padding-bottom: 5px; }
  .detail-table { width: 100%; font-size: 14px; }
  .detail-table td { padding: 5px 0; }
  .detail-table td:first-child { width: 120px; color: #666; }
  .client-name { font-size: 16px; font-weight: bold; margin: 10px 0; }
  .services-section { margin-bottom: 20px; }
  .services-section h4 { background: #000; color: white; padding: 10px; margin-bottom: 0; }
  .b2b-items-table { width: 100%; border-collapse: collapse; border: 1px solid #000; }
  .b2b-items-table th { background: #f0f0f0; padding: 12px 8px; border: 1px solid #000; font-weight: bold; }
  .b2b-items-table td { padding: 12px 8px; border: 1px solid #ddd; }
  .subtotal-row { background: #f5f5f5; font-weight: bold; }
  .tax-section { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
  .tax-breakdown { border: 1px solid #ddd; padding: 15px; }
  .tax-breakdown h4 { margin-bottom: 10px; }
  .tax-table { width: 100%; font-size: 14px; }
  .tax-table td { padding: 8px; border-bottom: 1px solid #eee; }
  .tax-table td:last-child { text-align: right; }
  .tax-total { background: #f0f0f0; font-weight: bold; border-top: 2px solid #000; }
  .amount-summary { border: 2px solid #000; padding: 15px; }
  .summary-amounts { width: 100%; font-size: 16px; }
  .summary-amounts td { padding: 10px; }
  .summary-amounts td:last-child { text-align: right; font-weight: bold; }
  .total-amount { font-size: 18px; border-bottom: 2px solid #000; }
  .paid-amount { color: #28a745; }
  .due-amount { font-size: 20px; background: #fff3cd; color: #856404; }
  .terms-bank-section { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
  .terms-box, .bank-box { border: 1px solid #ddd; padding: 15px; background: #fafafa; }
  .notes-section-b2b { border: 1px solid #ddd; padding: 15px; margin-bottom: 20px; }
  .declaration { border: 1px solid #000; padding: 15px; margin-bottom: 20px; font-size: 12px; background: #fffacd; }
  .signature-section { text-align: right; margin: 30px 0; }
  .signature-box { display: inline-block; text-align: center; }
  .signature-line { width: 200px; height: 50px; border-bottom: 1px solid #000; margin: 20px 0; }
  .b2b-footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 11px; color: #666; }
  .partial-invoice-badge { position: absolute; top: -10px; right: 20px; background: #dc3545; color: white; padding: 10px 20px; font-weight: bold; border: 2px solid #000; }'
FROM public.labs l
WHERE NOT EXISTS (
  SELECT 1 FROM public.invoice_templates it 
  WHERE it.lab_id = l.id AND it.template_name = 'B2B Detailed Invoice'
);

-- Template 5: Modern Invoice
INSERT INTO public.invoice_templates (
  lab_id,
  template_name,
  template_description,
  category,
  is_default,
  is_active,
  include_payment_terms,
  payment_terms_text,
  include_tax_breakdown,
  include_bank_details,
  gjs_html,
  gjs_css
)
SELECT 
  l.id as lab_id,
  'Modern Invoice',
  'Contemporary design with vibrant colors and modern aesthetics',
  'modern',
  false,
  true,
  true,
  'Please pay within 7 days. Thank you!',
  true,
  true,
  '<div class="modern-invoice">
    <div class="modern-header">
      <div class="header-content">
        <div class="logo-section">
          <h1 class="modern-title">{{lab_name}}</h1>
          <p class="modern-subtitle">Premium Healthcare Services</p>
        </div>
        <div class="invoice-label">
          <div class="label-badge">INVOICE</div>
          <div class="invoice-num">{{invoice_number}}</div>
        </div>
      </div>
    </div>
    
    {{partial_badge}}
    
    <div class="modern-container">
      <div class="info-cards">
        <div class="info-card card-from">
          <div class="card-header">From</div>
          <div class="card-content">
            <p><strong>{{lab_name}}</strong></p>
            <p>{{lab_address}}</p>
            <p>📞 {{lab_phone}}</p>
            <p>✉ {{lab_email}}</p>
          </div>
        </div>
        <div class="info-card card-to">
          <div class="card-header">To</div>
          <div class="card-content">
            <p><strong>{{patient_name}}</strong></p>
            <p>{{patient_address}}</p>
            <p>📞 {{patient_phone}}</p>
            <p>👨‍⚕️ Dr. {{doctor}}</p>
          </div>
        </div>
        <div class="info-card card-dates">
          <div class="card-header">Details</div>
          <div class="card-content">
            <p><strong>Date:</strong> {{invoice_date}}</p>
            <p><strong>Due:</strong> {{due_date}}</p>
            <p><strong>Type:</strong> {{payment_type}}</p>
          </div>
        </div>
      </div>
      
      <div class="items-modern">
        <div class="section-title">Services Rendered</div>
        <table class="modern-table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Qty</th>
              <th>Rate</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {{invoice_items}}
          </tbody>
        </table>
      </div>
      
      <div class="totals-modern">
        <div class="total-line">
          <span>Subtotal</span>
          <span>{{subtotal}}</span>
        </div>
        <div class="total-line">
          <span>Discount</span>
          <span class="discount-amt">-{{discount}}</span>
        </div>
        <div class="total-line">
          <span>Tax (GST)</span>
          <span>{{tax}}</span>
        </div>
        <div class="total-line grand">
          <span>Total Amount</span>
          <span>{{total}}</span>
        </div>
        <div class="total-line paid">
          <span>Amount Paid</span>
          <span>{{amount_paid}}</span>
        </div>
        <div class="total-line balance">
          <span>Balance Due</span>
          <span>{{balance_due}}</span>
        </div>
      </div>
      
      <div class="modern-panels">
        {{payment_terms}}
        {{bank_details}}
      </div>
      
      <div class="modern-notes">
        <strong>Notes:</strong> {{notes}}
      </div>
    </div>
    
    <div class="modern-footer">
      <div class="footer-wave"></div>
      <p class="footer-text">Thank you for choosing {{lab_name}}!</p>
      <p class="footer-small">Generated {{current_date}} | {{tax_disclaimer}}</p>
    </div>
  </div>',
  'body { font-family: "Inter", "Segoe UI", sans-serif; margin: 0; padding: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
  .modern-invoice { max-width: 210mm; margin: 20px auto; background: white; box-shadow: 0 10px 40px rgba(0,0,0,0.2); border-radius: 12px; overflow: hidden; }
  .modern-header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px 40px 60px 40px; position: relative; }
  .header-content { display: flex; justify-content: space-between; align-items: flex-start; }
  .modern-title { font-size: 32px; margin-bottom: 8px; font-weight: 700; }
  .modern-subtitle { font-size: 14px; opacity: 0.9; letter-spacing: 1px; }
  .invoice-label { text-align: right; }
  .label-badge { background: rgba(255,255,255,0.2); padding: 8px 20px; border-radius: 20px; font-size: 12px; letter-spacing: 2px; margin-bottom: 10px; }
  .invoice-num { font-size: 24px; font-weight: bold; }
  .modern-container { padding: 40px; margin-top: -30px; position: relative; }
  .info-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 40px; }
  .info-card { background: white; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); overflow: hidden; }
  .card-header { padding: 12px 20px; font-weight: 600; font-size: 14px; color: white; }
  .card-from .card-header { background: linear-gradient(135deg, #667eea, #764ba2); }
  .card-to .card-header { background: linear-gradient(135deg, #f093fb, #f5576c); }
  .card-dates .card-header { background: linear-gradient(135deg, #4facfe, #00f2fe); }
  .card-content { padding: 20px; font-size: 13px; line-height: 1.8; }
  .section-title { font-size: 20px; font-weight: 600; color: #333; margin-bottom: 20px; padding-left: 15px; border-left: 4px solid #667eea; }
  .modern-table { width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 30px; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .modern-table thead { background: linear-gradient(135deg, #667eea, #764ba2); color: white; }
  .modern-table th { padding: 15px; text-align: left; font-weight: 600; }
  .modern-table td { padding: 15px; border-bottom: 1px solid #f0f0f0; }
  .modern-table tbody tr:hover { background: #f8f9fa; }
  .totals-modern { max-width: 400px; margin-left: auto; background: #f8f9fa; border-radius: 12px; padding: 20px; }
  .total-line { display: flex; justify-content: space-between; padding: 12px 0; font-size: 15px; border-bottom: 1px solid #e0e0e0; }
  .total-line.grand { font-size: 20px; font-weight: bold; background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 15px 20px; margin: 10px -20px; border-radius: 8px; border: none; }
  .total-line.paid { color: #28a745; font-weight: 600; }
  .total-line.balance { font-size: 18px; font-weight: bold; color: #dc3545; background: #fff3cd; padding: 15px 20px; margin: 10px -20px 0 -20px; border-radius: 8px; border: none; }
  .discount-amt { color: #28a745; }
  .modern-panels { margin: 30px 0; padding: 20px; background: linear-gradient(135deg, #e0c3fc, #8ec5fc); border-radius: 12px; }
  .modern-notes { padding: 20px; background: #fff9e6; border-left: 4px solid #ffc107; border-radius: 8px; margin-bottom: 30px; }
  .modern-footer { background: linear-gradient(135deg, #667eea, #764ba2); color: white; text-align: center; padding: 30px 40px; position: relative; }
  .footer-wave { height: 40px; background: white; border-radius: 0 0 50% 50%; margin: -30px -40px 20px -40px; }
  .footer-text { font-size: 18px; font-weight: 600; margin-bottom: 10px; }
  .footer-small { font-size: 11px; opacity: 0.8; }
  .partial-invoice-badge { position: absolute; top: 100px; right: 50px; background: #ff6b6b; color: white; padding: 12px 24px; font-weight: bold; border-radius: 50px; box-shadow: 0 6px 12px rgba(0,0,0,0.2); transform: rotate(-5deg); z-index: 10; }'
FROM public.labs l
WHERE NOT EXISTS (
  SELECT 1 FROM public.invoice_templates it 
  WHERE it.lab_id = l.id AND it.template_name = 'Modern Invoice'
);
