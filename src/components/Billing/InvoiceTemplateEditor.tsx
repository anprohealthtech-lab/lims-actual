import React, { useState, useEffect } from 'react';
import { X, Save, Eye, Code, Palette, AlertCircle } from 'lucide-react';
import { database } from '../../utils/supabase';

// CKEditor CDN URLs (matching TemplateStudioCKE.tsx)
const CKEDITOR_VERSION = '47.1.0';
const CKEDITOR_SCRIPT_URL = `https://cdn.ckeditor.com/ckeditor5/${CKEDITOR_VERSION}/ckeditor5.umd.js`;
const CKEDITOR_CSS_URL = `https://cdn.ckeditor.com/ckeditor5/${CKEDITOR_VERSION}/ckeditor5.css`;

interface InvoiceTemplateEditorProps {
  templateId: string;
  onClose: () => void;
  onSave: () => void;
}

const InvoiceTemplateEditor: React.FC<InvoiceTemplateEditorProps> = ({ templateId, onClose, onSave }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'html' | 'css' | 'preview' | 'wysiwyg'>('wysiwyg');
  const [editorInstance, setEditorInstance] = useState<any>(null);
  const [ckeditorLoaded, setCkeditorLoaded] = useState(false);
  const editorRef = React.useRef<HTMLDivElement>(null);
  
  const [templateData, setTemplateData] = useState({
    template_name: '',
    template_description: '',
    category: '',
    gjs_html: '',
    gjs_css: '',
    page_size: 'A4' as 'A4' | 'A5' | 'Letter',
    letterhead_space_mm: 0,
  });

  // Load CKEditor from CDN
  useEffect(() => {
    const loadCKEditor = async () => {
      if (typeof window === 'undefined') return;
      
      // Check if already loaded
      if ((window as any).CKEDITOR) {
        setCkeditorLoaded(true);
        return;
      }

      try {
        // Load CSS
        if (!document.querySelector(`link[href="${CKEDITOR_CSS_URL}"]`)) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = CKEDITOR_CSS_URL;
          document.head.appendChild(link);
        }

        // Load JS
        if (!document.querySelector(`script[src="${CKEDITOR_SCRIPT_URL}"]`)) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = CKEDITOR_SCRIPT_URL;
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load CKEditor'));
            document.head.appendChild(script);
          });
        }

        setCkeditorLoaded(true);
      } catch (err) {
        console.error('Failed to load CKEditor:', err);
      }
    };

    loadCKEditor();
  }, []);

  // Initialize CKEditor when loaded AND template data is available
  useEffect(() => {
    if (!ckeditorLoaded || !editorRef.current || editorInstance || !templateData.gjs_html) return;

    const initEditor = async () => {
      try {
        const CKEDITOR = (window as any).CKEDITOR;
        if (!CKEDITOR) return;

        const licenseKey = import.meta.env.VITE_CKEDITOR_LICENSE_KEY as string | undefined;

        // Get plugins from CKEDITOR
        const {
          Essentials,
          Bold,
          Italic,
          Underline,
          Link,
          List,
          Paragraph,
          Heading,
          Alignment,
          Indent,
          IndentBlock,
          Table,
          TableToolbar,
          BlockQuote,
          Undo,
          SourceEditing
        } = CKEDITOR;

        const editor = await CKEDITOR.ClassicEditor.create(editorRef.current, {
          licenseKey: licenseKey || '',
          plugins: [
            Essentials,
            Bold,
            Italic,
            Underline,
            Link,
            List,
            Paragraph,
            Heading,
            Alignment,
            Indent,
            IndentBlock,
            Table,
            TableToolbar,
            BlockQuote,
            Undo,
            SourceEditing
          ],
          toolbar: [
            'heading', '|',
            'bold', 'italic', 'underline', '|',
            'link', 'bulletedList', 'numberedList', '|',
            'alignment', 'indent', 'outdent', '|',
            'insertTable', 'blockQuote', '|',
            'undo', 'redo', '|',
            'sourceEditing'
          ],
          table: {
            contentToolbar: ['tableColumn', 'tableRow', 'mergeTableCells']
          }
        });

        editor.setData(templateData.gjs_html);
        
        editor.model.document.on('change:data', () => {
          const data = editor.getData();
          setTemplateData(prev => ({ ...prev, gjs_html: data }));
        });

        // Set editor height
        const editorElement = editor.ui.view.editable.element;
        if (editorElement) {
          editorElement.style.minHeight = '400px';
          editorElement.style.maxHeight = 'calc(90vh - 350px)';
          editorElement.style.overflowY = 'auto';
        }

        setEditorInstance(editor);
      } catch (err) {
        console.error('Failed to initialize CKEditor:', err);
      }
    };

    initEditor();

    // Cleanup only on component unmount
    return () => {
      if (editorInstance) {
        editorInstance.destroy().catch((err: any) => console.error('Editor cleanup error:', err));
      }
    };
  }, [ckeditorLoaded, templateData.gjs_html]);

  useEffect(() => {
    loadTemplate();
  }, [templateId]);

  const loadTemplate = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: err } = await database.invoiceTemplates.getById(templateId);

      if (err) throw new Error(err.message);
      if (!data) throw new Error('Template not found');

      setTemplateData({
        template_name: data.template_name || '',
        template_description: data.template_description || '',
        category: data.category || '',
        gjs_html: data.gjs_html || '',
        gjs_css: data.gjs_css || '',
        page_size: (data.page_size as 'A4' | 'A5' | 'Letter') || 'A4',
        letterhead_space_mm: data.letterhead_space_mm || 0,
      });
    } catch (err: any) {
      console.error('Error loading template:', err);
      setError(err.message || 'Failed to load template');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);

      const { error: err } = await database.invoiceTemplates.update(templateId, {
        gjs_html: templateData.gjs_html,
        gjs_css: templateData.gjs_css,
        page_size: templateData.page_size,
        letterhead_space_mm: templateData.letterhead_space_mm || 0,
        updated_at: new Date().toISOString(),
      });

      if (err) throw new Error(err.message);

      onSave();
      onClose();
    } catch (err: any) {
      console.error('Error saving template:', err);
      setError(err.message || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  // Sample data for preview
  const getSampleData = () => {
    return {
      lab_name: 'Advanced Diagnostics Lab',
      lab_address: '123 Medical Center Blvd',
      lab_city: 'Mumbai',
      lab_state: 'Maharashtra',
      lab_pincode: '400001',
      lab_phone: '+91 22 1234 5678',
      lab_email: 'info@advanceddiagnostics.com',
      lab_license: 'MH/LAB/2024/12345',
      lab_registration: 'NABL-12345',
      patient_name: 'Rajesh Kumar',
      patient_age: '45',
      patient_gender: 'Male',
      patient_id: 'PAT-2024-001',
      invoice_number: 'INV-2024-12345',
      invoice_date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      invoice_items: `
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <thead>
            <tr style="background: #f3f4f6; border-bottom: 2px solid #e5e7eb;">
              <th style="padding: 12px; text-align: left;">Test Name</th>
              <th style="padding: 12px; text-align: center;">Qty</th>
              <th style="padding: 12px; text-align: right;">Rate</th>
              <th style="padding: 12px; text-align: right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 10px;">Complete Blood Count (CBC)</td>
              <td style="padding: 10px; text-align: center;">1</td>
              <td style="padding: 10px; text-align: right;">₹500.00</td>
              <td style="padding: 10px; text-align: right;">₹500.00</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 10px;">Lipid Profile</td>
              <td style="padding: 10px; text-align: center;">1</td>
              <td style="padding: 10px; text-align: right;">₹800.00</td>
              <td style="padding: 10px; text-align: right;">₹800.00</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 10px;">Thyroid Function Test (TFT)</td>
              <td style="padding: 10px; text-align: center;">1</td>
              <td style="padding: 10px; text-align: right;">₹600.00</td>
              <td style="padding: 10px; text-align: right;">₹600.00</td>
            </tr>
          </tbody>
        </table>
      `,
      subtotal: '₹1,900.00',
      tax_amount: '₹342.00',
      tax_percentage: '18',
      total: '₹2,242.00',
      amount_paid: '₹1,000.00',
      balance_due: '₹1,242.00',
      payment_terms: 'Payment is due within 7 days of invoice date. Late payments may incur additional charges.',
      bank_details: `
        <div style="margin-top: 20px; padding: 15px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px;">
          <p style="margin: 0; font-weight: 600; margin-bottom: 8px;">Bank Transfer Details:</p>
          <p style="margin: 4px 0;"><strong>Bank Name:</strong> HDFC Bank</p>
          <p style="margin: 4px 0;"><strong>Account Name:</strong> Advanced Diagnostics Lab</p>
          <p style="margin: 4px 0;"><strong>Account Number:</strong> 12345678901234</p>
          <p style="margin: 4px 0;"><strong>IFSC Code:</strong> HDFC0001234</p>
          <p style="margin: 4px 0;"><strong>Branch:</strong> Mumbai Central</p>
        </div>
      `,
      notes: 'Thank you for choosing our laboratory services. For any queries, please contact us.',
    };
  };

  const replacePlaceholders = (html: string) => {
    const sampleData = getSampleData();
    let result = html;
    
    // Replace all placeholders
    Object.entries(sampleData).forEach(([key, value]) => {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      result = result.replace(regex, String(value));
    });
    
    return result;
  };

  const renderPreview = () => {
    const htmlWithData = replacePlaceholders(templateData.gjs_html);
    const fullHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>${templateData.gjs_css}</style>
        </head>
        <body>
          ${htmlWithData}
        </body>
      </html>
    `;
    return (
      <iframe
        srcDoc={fullHtml}
        className="w-full h-full border-0"
        title="Template Preview"
        sandbox="allow-same-origin"
      />
    );
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8">
          <div className="flex items-center space-x-3">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            <span className="text-gray-700">Loading template...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-none">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Edit Template: {templateData.template_name}
            </h2>
            <p className="text-sm text-gray-600 mt-1">{templateData.template_description}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
            <X className="h-6 w-6" />
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start space-x-2">
            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center space-x-1 px-6 pt-4 border-b border-gray-200 flex-none">
          <button
            onClick={() => setActiveTab('wysiwyg')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-t-lg transition-colors ${
              activeTab === 'wysiwyg'
                ? 'bg-white text-blue-600 border-t border-x border-gray-200'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <Eye className="w-4 h-4" />
            <span>Visual Editor</span>
          </button>
          <button
            onClick={() => setActiveTab('html')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-t-lg transition-colors ${
              activeTab === 'html'
                ? 'bg-white text-blue-600 border-t border-x border-gray-200'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <Code className="w-4 h-4" />
            <span>HTML</span>
          </button>
          <button
            onClick={() => setActiveTab('css')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-t-lg transition-colors ${
              activeTab === 'css'
                ? 'bg-white text-blue-600 border-t border-x border-gray-200'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <Palette className="w-4 h-4" />
            <span>CSS</span>
          </button>
          <button
            onClick={() => setActiveTab('preview')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-t-lg transition-colors ${
              activeTab === 'preview'
                ? 'bg-white text-blue-600 border-t border-x border-gray-200'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <Eye className="w-4 h-4" />
            <span>Preview with Data</span>
          </button>

          {/* Page Size + Letterhead Space — lives in the tab bar, right side */}
          <div className="ml-auto flex items-center gap-4 pb-1">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-500 whitespace-nowrap">Letterhead Space:</label>
              <input
                type="number"
                min={0}
                max={100}
                value={templateData.letterhead_space_mm}
                onChange={(e) => setTemplateData(prev => ({ ...prev, letterhead_space_mm: Number(e.target.value) }))}
                className="text-sm border border-gray-300 rounded px-2 py-1 w-16 focus:outline-none focus:ring-1 focus:ring-blue-500"
                title="Top margin reserved for pre-printed letterhead (mm)"
              />
              <span className="text-xs text-gray-400">mm</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-500 whitespace-nowrap">Page Size:</label>
              <select
                value={templateData.page_size}
                onChange={(e) => setTemplateData(prev => ({ ...prev, page_size: e.target.value as 'A4' | 'A5' | 'Letter' }))}
                className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="A4">A4 — Full Page</option>
                <option value="A5">A5 — Half Page</option>
                <option value="Letter">Letter (US)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Editor Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Visual Editor - Always render but show/hide */}
          <div className={`h-full flex flex-col min-h-0 ${activeTab === 'wysiwyg' ? '' : 'hidden'}`}>
            <label className="block text-sm font-medium text-gray-700 mb-2 flex-none">
              Visual HTML Editor (WYSIWYG)
            </label>
            {!ckeditorLoaded ? (
              <div className="flex-1 flex items-center justify-center border border-gray-300 rounded-md">
                <div className="flex items-center space-x-3">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                  <span className="text-gray-600">Loading editor...</span>
                </div>
              </div>
            ) : (
              <div className="flex-1 border border-gray-300 rounded-md overflow-y-auto min-h-0" style={{ maxHeight: 'calc(90vh - 300px)' }}>
                <div ref={editorRef}></div>
              </div>
            )}
            <p className="text-xs text-gray-500 mt-2 flex-none">
              Use <strong>Source Editing</strong> button in toolbar to insert placeholders: {'{{'} patient_name {'}}'},  {'{{'} invoice_number {'}}'},  {'{{'} invoice_items {'}}'},  {'{{'} total {'}}'},  {'{{'} lab_name {'}}'}, etc.
            </p>
          </div>

          {activeTab === 'html' && (
            <div className="h-full flex flex-col">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                HTML Template (Raw Code)
              </label>
              <textarea
                value={templateData.gjs_html}
                onChange={(e) => setTemplateData(prev => ({ ...prev, gjs_html: e.target.value }))}
                className="flex-1 w-full px-4 py-3 border border-gray-300 rounded-md font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Enter HTML template code..."
                spellCheck={false}
              />
              <p className="text-xs text-gray-500 mt-2">
                Use placeholders: {'{{'} patient_name {'}}'},  {'{{'} invoice_number {'}}'},  {'{{'} invoice_items {'}}'},  {'{{'} total {'}}'},  {'{{'} lab_name {'}}'}, etc.
              </p>
            </div>
          )}

          {activeTab === 'css' && (
            <div className="h-full flex flex-col">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                CSS Styles
              </label>
              <textarea
                value={templateData.gjs_css}
                onChange={(e) => setTemplateData(prev => ({ ...prev, gjs_css: e.target.value }))}
                className="flex-1 w-full px-4 py-3 border border-gray-300 rounded-md font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Enter CSS styles..."
                spellCheck={false}
              />
              <p className="text-xs text-gray-500 mt-2">
                Define styles for your template elements. Use classes and IDs from your HTML.
              </p>
            </div>
          )}

          {activeTab === 'preview' && (
            <div className="h-full flex flex-col">
              <div className="mb-2 flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">
                  Template Preview with Sample Data
                </label>
                <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded">✓ Placeholders Replaced</span>
              </div>
              <div className="flex-1 border-2 border-gray-300 rounded-md overflow-hidden bg-white">
                {renderPreview()}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Preview shows how your template will look with actual invoice data. All placeholders are replaced with sample values.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50 flex-none">
          <div className="text-sm text-gray-600">
            <span className="font-medium">Category:</span> {templateData.category}
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 flex items-center space-x-2"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvoiceTemplateEditor;
