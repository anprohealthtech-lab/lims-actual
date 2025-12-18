import React, { useState, useEffect } from 'react';
import { X, FileText, Download, AlertCircle, CheckCircle2, Loader2, MessageCircle } from 'lucide-react';
import { database } from '../../utils/supabase';
import { generateInvoicePDF } from '../../utils/invoicePdfService';
import { WhatsAppAPI } from '../../utils/whatsappAPI';
import { openWhatsAppManually } from '../../utils/whatsappUtils';

interface InvoiceTemplate {
  id: string;
  template_name: string;
  template_description: string;
  category: string;
  is_default: boolean;
  is_active: boolean;
}

interface InvoiceGenerationModalProps {
  invoiceId: string;
  onClose: () => void;
  onSuccess: (pdfUrl: string) => void;
}

const InvoiceGenerationModal: React.FC<InvoiceGenerationModalProps> = ({
  invoiceId,
  onClose,
  onSuccess,
}) => {
  const [templates, setTemplates] = useState<InvoiceTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [generatedPdfUrl, setGeneratedPdfUrl] = useState<string | null>(null);
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: err } = await database.invoiceTemplates.getAll();

      if (err) {
        throw new Error(err.message);
      }

      const activeTemplates = (data || []).filter((t: InvoiceTemplate) => t.is_active);
      setTemplates(activeTemplates);

      // Auto-select default template
      const defaultTemplate = activeTemplates.find((t: InvoiceTemplate) => t.is_default);
      if (defaultTemplate) {
        setSelectedTemplateId(defaultTemplate.id);
      } else if (activeTemplates.length > 0) {
        setSelectedTemplateId(activeTemplates[0].id);
      }
    } catch (err: any) {
      console.error('Error fetching templates:', err);
      setError(err.message || 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedTemplateId) {
      setError('Please select a template');
      return;
    }

    try {
      setGenerating(true);
      setError(null);

      const pdfUrl = await generateInvoicePDF(invoiceId, selectedTemplateId);

      setSuccess(true);
      setGeneratedPdfUrl(pdfUrl);
      onSuccess(pdfUrl);
      // Don't auto-close - let user download or send via WhatsApp
    } catch (err: any) {
      console.error('Error generating PDF:', err);
      setError(err.message || 'Failed to generate PDF');
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!generatedPdfUrl) return;
    
    // Create temporary anchor element to trigger download
    const link = document.createElement('a');
    link.href = generatedPdfUrl;
    link.download = `invoice-${invoiceId}.pdf`;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSendWhatsApp = async () => {
    if (!generatedPdfUrl) return;

    try {
      setSendingWhatsApp(true);
      setError(null);

      // Fetch invoice details for patient phone
      const { data: invoice, error: invoiceError } = await database.invoices.getById(invoiceId);
      
      if (invoiceError || !invoice) {
        throw new Error('Failed to fetch invoice details');
      }

      // Get patient phone number
      const { data: patient, error: patientError } = await database.patients.getById(invoice.patient_id);
      
      if (patientError || !patient || !patient.phone) {
        throw new Error('Patient phone number not found');
      }

      const message = `Dear ${patient.name},\n\nYour invoice is ready. Please find the invoice PDF here:\n\n${generatedPdfUrl}\n\nThank you for choosing our services!`;

      // Try backend API first
      try {
        const connection = await WhatsAppAPI.getConnectionStatus();
        
        if (!connection.connected) {
          throw new Error('WhatsApp not connected');
        }

        const result = await WhatsAppAPI.sendMessage(patient.phone, message);
        
        if (result.success) {
          alert('Invoice sent via WhatsApp successfully!');
          return;
        }
      } catch (apiError) {
        console.log('Backend API failed, falling back to manual WhatsApp:', apiError);
      }

      // Fallback to manual WhatsApp link
      const { success: manualSuccess } = await openWhatsAppManually(
        patient.phone,
        message
      );

      if (manualSuccess) {
        alert('WhatsApp opened. Please send the message manually.');
      }
    } catch (err: any) {
      console.error('Error sending via WhatsApp:', err);
      setError(err.message || 'Failed to send via WhatsApp');
    } finally {
      setSendingWhatsApp(false);
    }
  };

  const getCategoryBadgeColor = (category: string) => {
    const colors: Record<string, string> = {
      standard: 'bg-blue-100 text-blue-700',
      minimal: 'bg-gray-100 text-gray-700',
      professional: 'bg-purple-100 text-purple-700',
      b2b: 'bg-emerald-100 text-emerald-700',
      modern: 'bg-pink-100 text-pink-700',
    };
    return colors[category] || 'bg-gray-100 text-gray-700';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center space-x-3">
            <FileText className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-900">Generate Invoice PDF</h2>
          </div>
          <button
            onClick={onClose}
            disabled={generating}
            className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Error Alert */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-medium text-red-900">Error</h4>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* Success Alert */}
          {success && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start space-x-3">
              <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-medium text-green-900">Success!</h4>
                <p className="text-sm text-green-700 mt-1">PDF generated successfully</p>
              </div>
            </div>
          )}

          {/* Loading State */}
          {loading ? (
            <div className="py-12 text-center">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-3" />
              <p className="text-gray-600">Loading templates...</p>
            </div>
          ) : templates.length === 0 ? (
            <div className="py-12 text-center">
              <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600">No active templates available</p>
              <p className="text-sm text-gray-500 mt-2">Contact your administrator to create invoice templates</p>
            </div>
          ) : (
            <>
              {/* Template Selection */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Select Invoice Template
                </label>
                <div className="space-y-3">
                  {templates.map((template) => (
                    <label
                      key={template.id}
                      className={`block p-4 border-2 rounded-lg cursor-pointer transition-all ${
                        selectedTemplateId === template.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <div className="flex items-start space-x-3">
                        <input
                          type="radio"
                          name="template"
                          value={template.id}
                          checked={selectedTemplateId === template.id}
                          onChange={(e) => setSelectedTemplateId(e.target.value)}
                          disabled={generating}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 mb-1">
                            <span className="font-medium text-gray-900">{template.template_name}</span>
                            {template.is_default && (
                              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-medium">
                                Default
                              </span>
                            )}
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${getCategoryBadgeColor(template.category)}`}>
                              {template.category}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600">{template.template_description}</p>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Info Box */}
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-start space-x-3">
                <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-900">
                  <p className="font-medium mb-1">PDF Generation</p>
                  <ul className="list-disc list-inside space-y-1 text-blue-800">
                    <li>The PDF will be generated using the selected template</li>
                    <li>It will include all invoice details, items, and payment information</li>
                    <li>The PDF will be automatically saved to your invoices folder</li>
                    <li>You can regenerate the PDF anytime with a different template</li>
                  </ul>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && templates.length > 0 && (
          <div className="sticky bottom-0 bg-gray-50 px-6 py-4 border-t">
            {!success ? (
              <div className="flex items-center justify-end space-x-3">
                <button
                  onClick={onClose}
                  disabled={generating}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={generating || !selectedTemplateId}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {generating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Generating PDF...</span>
                    </>
                  ) : (
                    <>
                      <FileText className="w-4 h-4" />
                      <span>Generate PDF</span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-green-700">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="font-medium">PDF Generated Successfully!</span>
                </div>
                <div className="flex items-center space-x-3">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Close
                  </button>
                  <button
                    onClick={handleDownload}
                    disabled={!generatedPdfUrl}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center space-x-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download</span>
                  </button>
                  <button
                    onClick={handleSendWhatsApp}
                    disabled={!generatedPdfUrl || sendingWhatsApp}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center space-x-2"
                  >
                    {sendingWhatsApp ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Sending...</span>
                      </>
                    ) : (
                      <>
                        <MessageCircle className="w-4 h-4" />
                        <span>Send WhatsApp</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default InvoiceGenerationModal;
