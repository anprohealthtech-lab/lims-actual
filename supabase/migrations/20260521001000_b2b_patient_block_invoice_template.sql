-- Updates the lab-agnostic B2B detailed invoice template to use the richer
-- service-generated patient block placeholders while keeping legacy invoice
-- placeholders available for older templates.

UPDATE public.invoice_templates
SET
  template_description = 'Corporate invoice with patient-wise tests, packages, totals, and amount in words',
  gjs_html = $html$
<div class="b2b-invoice">
  <div class="invoice-brand">
    <div>
      <h1>{{lab_name}}</h1>
      <p>{{lab_address}}</p>
      <p>Phone: {{lab_phone}} | Email: {{lab_email}}</p>
      <p><strong>GSTIN:</strong> {{lab_gst}} <span class="muted">|</span> <strong>License:</strong> {{lab_license}}</p>
    </div>
    <div class="invoice-title">
      <h2>TAX INVOICE</h2>
      <p>{{invoice_number}}</p>
      {{partial_badge}}
    </div>
  </div>

  <div class="invoice-meta">
    <div>
      <h3>Bill To</h3>
      <p class="party-name">{{account_name}}</p>
      <p>{{account_address}}</p>
      <p>Phone: {{account_phone}}</p>
      <p>Email: {{account_email}}</p>
      <p><strong>GSTIN:</strong> {{account_gst}}</p>
    </div>
    <div>
      <h3>Invoice Details</h3>
      <table>
        <tr><td>Invoice Date</td><td>{{invoice_date}}</td></tr>
        <tr><td>Billing Period</td><td>{{billing_period}}</td></tr>
        <tr><td>Due Date</td><td>{{due_date}}</td></tr>
        <tr><td>Patients</td><td>{{patient_count}}</td></tr>
        <tr><td>Invoices</td><td>{{invoice_count}}</td></tr>
      </table>
    </div>
  </div>

  <section class="patient-section">
    <h3>Patient Wise Services</h3>
    {{b2b_patient_blocks}}
  </section>

  <section class="totals-section">
    <div class="amount-words">
      <h3>Amount in Words</h3>
      <p>{{amount_in_words}}</p>
      <div class="notes">{{notes}}</div>
    </div>
    <div class="amount-table-wrap">
      <table class="amount-table">
        <tr><td>Subtotal</td><td>{{subtotal}}</td></tr>
        <tr><td>Discount</td><td>-{{discount}}</td></tr>
        <tr><td>CGST</td><td>{{cgst}}</td></tr>
        <tr><td>SGST</td><td>{{sgst}}</td></tr>
        <tr class="grand-total"><td>Grand Total</td><td>{{grand_total}}</td></tr>
        <tr><td>Amount Paid</td><td>{{amount_paid}}</td></tr>
        <tr class="balance"><td>Balance Due</td><td>{{balance_due}}</td></tr>
      </table>
    </div>
  </section>

  <div class="terms-bank-section">
    <div>{{payment_terms}}</div>
    <div>{{bank_details}}</div>
  </div>

  <div class="declaration">
    <p><strong>Declaration:</strong> {{tax_disclaimer}}</p>
    <p>This is a system-generated invoice and does not require a physical signature.</p>
  </div>

  <div class="signature-section">
    <div>
      <p>For <strong>{{lab_name}}</strong></p>
      <div class="signature-line"></div>
      <p>Authorized Signatory</p>
    </div>
  </div>
</div>
$html$,
  gjs_css = $css$
* { box-sizing: border-box; }
body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; color: #202124; background: #fff; }
.b2b-invoice { max-width: 210mm; margin: 0 auto; padding: 14mm; font-size: 12px; line-height: 1.45; }
.invoice-brand { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #202124; padding-bottom: 14px; margin-bottom: 18px; }
.invoice-brand h1 { margin: 0 0 6px; font-size: 24px; letter-spacing: 0; }
.invoice-brand p { margin: 2px 0; }
.invoice-title { text-align: right; min-width: 190px; }
.invoice-title h2 { margin: 0 0 8px; font-size: 22px; letter-spacing: 0; }
.invoice-title p { margin: 0; font-weight: 700; }
.muted { color: #6b7280; margin: 0 4px; }
.invoice-meta { display: grid; grid-template-columns: 1.25fr 1fr; gap: 18px; margin-bottom: 18px; }
.invoice-meta > div { border: 1px solid #d7dce2; padding: 12px; }
h3 { margin: 0 0 9px; font-size: 13px; text-transform: uppercase; letter-spacing: 0; color: #111827; }
.party-name { margin: 0 0 4px; font-size: 15px; font-weight: 700; }
.invoice-meta table { width: 100%; border-collapse: collapse; }
.invoice-meta td { padding: 4px 0; }
.invoice-meta td:first-child { color: #5f6368; width: 110px; }
.patient-section { margin-top: 8px; }
.patient-service-block { border: 1px solid #cfd6dd; margin-bottom: 12px; page-break-inside: avoid; }
.patient-service-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; background: #f4f6f8; border-bottom: 1px solid #cfd6dd; padding: 10px 12px; }
.patient-service-index { font-size: 10px; color: #5f6368; text-transform: uppercase; font-weight: 700; }
.patient-service-name { font-size: 15px; font-weight: 700; margin-top: 2px; }
.patient-service-meta { color: #5f6368; margin-top: 2px; }
.patient-service-total { text-align: right; min-width: 140px; }
.patient-service-total span { display: block; color: #5f6368; font-size: 10px; text-transform: uppercase; font-weight: 700; }
.patient-service-total strong { display: block; font-size: 16px; margin-top: 2px; }
.patient-service-items { width: 100%; border-collapse: collapse; }
.patient-service-items th { background: #fff; border-bottom: 1px solid #d7dce2; padding: 8px 10px; font-size: 11px; color: #374151; }
.patient-service-items td { border-bottom: 1px solid #edf0f2; padding: 8px 10px; vertical-align: top; }
.patient-service-items tr:last-child td { border-bottom: 0; }
.patient-item-package { margin-top: 2px; font-size: 10px; color: #5f6368; }
.patient-service-words { border-top: 1px solid #edf0f2; padding: 7px 10px; font-size: 11px; color: #374151; }
.totals-section { display: grid; grid-template-columns: 1fr 260px; gap: 18px; margin-top: 18px; align-items: start; }
.amount-words { border: 1px solid #d7dce2; padding: 12px; min-height: 92px; }
.amount-words p { margin: 0; font-weight: 700; }
.notes { margin-top: 10px; color: #5f6368; }
.amount-table { width: 100%; border-collapse: collapse; border: 1px solid #202124; }
.amount-table td { padding: 8px 10px; border-bottom: 1px solid #d7dce2; }
.amount-table td:last-child { text-align: right; font-weight: 700; }
.grand-total td { background: #202124; color: #fff; font-size: 14px; }
.balance td { background: #f9fafb; font-size: 13px; }
.terms-bank-section { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 18px; }
.payment-terms, .bank-details { border: 1px solid #d7dce2; padding: 12px; min-height: 90px; }
.payment-terms h4, .bank-details h4 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; }
.payment-terms p { margin: 0; }
.bank-details table { width: 100%; border-collapse: collapse; }
.bank-details td { padding: 3px 0; }
.declaration { margin-top: 16px; border: 1px solid #202124; padding: 10px 12px; font-size: 11px; }
.declaration p { margin: 3px 0; }
.signature-section { display: flex; justify-content: flex-end; margin-top: 24px; text-align: center; }
.signature-line { width: 190px; height: 42px; border-bottom: 1px solid #202124; margin-bottom: 6px; }
.partial-invoice-badge { display: inline-block; margin-top: 8px; border: 1px solid #202124; padding: 4px 8px; font-size: 11px; font-weight: 700; }
@media print {
  .b2b-invoice { padding: 12mm; }
  .patient-service-block { page-break-inside: avoid; }
}
$css$,
  include_payment_terms = true,
  include_tax_breakdown = true,
  include_bank_details = true,
  tax_disclaimer = COALESCE(NULLIF(tax_disclaimer, ''), 'GST is applicable as per current regulations.'),
  updated_at = now()
WHERE category = 'b2b'
  AND template_name = 'B2B Detailed Invoice';
