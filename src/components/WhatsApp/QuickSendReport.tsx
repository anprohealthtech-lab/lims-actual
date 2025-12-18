// src/components/WhatsApp/QuickSendReport.tsx
import React, { useState } from 'react';
import { 
  MessageCircle, 
  Send, 
  Phone, 
  Loader, 
  CheckCircle, 
  XCircle,
  AlertTriangle
} from 'lucide-react';
import { WhatsAppAPI, MessageResult } from '../../utils/whatsappAPI';
import { convertToCustomDomain } from '../../utils/storageUrlBuilder';

const normalizePhoneForInput = (value?: string): string => {
  if (!value) return '';
  const digitsOnly = value.replace(/\D/g, '');
  if (digitsOnly.length <= 10) return digitsOnly;
  return digitsOnly.slice(-10);
};

interface QuickSendReportProps {
  reportUrl?: string;
  reportName?: string;
  patientName?: string;
  patientPhone?: string;
  testName?: string;
  onSent?: (result: MessageResult) => void;
}

const QuickSendReport: React.FC<QuickSendReportProps> = ({
  reportUrl,
  reportName = 'Lab Report',
  patientName = '',
  patientPhone = '',
  testName = '',
  onSent
}) => {
  // Convert old Supabase URLs to custom domain format
  const customDomainReportUrl = reportUrl ? convertToCustomDomain(reportUrl) : reportUrl;
  
  const [isOpen, setIsOpen] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState(() => normalizePhoneForInput(patientPhone));
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<MessageResult | null>(null);
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('default');
  const [templatesLoaded, setTemplatesLoaded] = useState(false);

  // Load templates when modal opens
  React.useEffect(() => {
    if (isOpen) {
      const loadTemplates = async () => {
        try {
          console.log('Loading WhatsApp templates...');
          const { database } = await import('../../utils/supabase');
          const { data } = await database.whatsappTemplates.list(undefined, 'report_ready');
          console.log('Templates loaded:', data);
          
          if (data && data.length > 0) {
            setTemplates(data);
            // Try to get default template
            const defaultTemplate = data.find((t: any) => t.is_default);
            console.log('Default template:', defaultTemplate);
            
            if (defaultTemplate) {
              setSelectedTemplateId(defaultTemplate.id);
              
              // Fetch lab details for placeholder
              const labId = await database.getCurrentUserLabId();
              console.log('Lab ID:', labId);
              
              const { supabase } = await import('../../utils/supabase');
              const { data: labData } = await supabase
                .from('labs')
                .select('name, address, phone, email')
                .eq('id', labId!)
                .single();
              
              console.log('Lab data:', labData);
              
              const { replacePlaceholders } = await import('../../utils/whatsappTemplates');
              const templateData = {
                PatientName: patientName || 'Patient',
                TestName: testName || 'test',
                ReportUrl: customDomainReportUrl || '',
                LabName: labData?.name || '',
                LabAddress: labData?.address || '',
                LabContact: labData?.phone || '',
                LabEmail: labData?.email || '',
              };
              console.log('Template data for replacement:', templateData);
              console.log('Original template content:', defaultTemplate.message_content);
              
              const templatedMessage = replacePlaceholders(defaultTemplate.message_content, templateData);
              console.log('Message after placeholder replacement:', templatedMessage);
              
              setMessage(templatedMessage);
            } else {
              // No default, use first template
              setSelectedTemplateId(data[0].id);
              const labId = await database.getCurrentUserLabId();
              const { supabase } = await import('../../utils/supabase');
              const { data: labData } = await supabase
                .from('labs')
                .select('name, address, phone, email')
                .eq('id', labId!)
                .single();
              const { replacePlaceholders } = await import('../../utils/whatsappTemplates');
              const templatedMessage = replacePlaceholders(data[0].message_content, {
                PatientName: patientName || 'Patient',
                TestName: testName || 'test',
                ReportUrl: customDomainReportUrl || '',
                LabName: labData?.name || '',
                LabAddress: labData?.address || '',
                LabContact: labData?.phone || '',
                LabEmail: labData?.email || '',
              });
              setMessage(templatedMessage);
            }
            setTemplatesLoaded(true);
          } else {
            // No templates found, use fallback
            setMessage(`Hello ${patientName || 'Patient'}, your ${testName || 'test'} report is ready. Please find it attached.`);
            setTemplatesLoaded(true);
          }
        } catch (err) {
          console.error('Error loading templates:', err);
          // Fallback on error
          setMessage(`Hello ${patientName || 'Patient'}, your ${testName || 'test'} report is ready. Please find it attached.`);
          setTemplatesLoaded(true);
        }
      };
      loadTemplates();
    } else {
      // Reset when modal closes
      setTemplatesLoaded(false);
    }
  }, [isOpen, patientName, testName, reportUrl]);

  // Update form fields when props change
  React.useEffect(() => {
    if (isOpen && !templatesLoaded) {
      setPhoneNumber(normalizePhoneForInput(patientPhone));
      setSendResult(null);
    }
  }, [isOpen, patientPhone, templatesLoaded]);

  // Prevent modal from closing due to viewport changes (e.g., dev console opening)
  React.useEffect(() => {
    if (isOpen) {
      // Prevent body scroll when modal is open
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      
      // Handle escape key
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setIsOpen(false);
        }
      };
      
      document.addEventListener('keydown', handleEscape);
      
      return () => {
        document.body.style.overflow = originalOverflow;
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [isOpen]);

  const checkConnection = async () => {
    setIsCheckingConnection(true);
    try {
      const status = await WhatsAppAPI.getConnectionStatus();
      setIsConnected(status.isConnected);
      return status.isConnected;
    } catch (error) {
      console.error('Failed to check WhatsApp connection:', error);
      setIsConnected(false);
      return false;
    } finally {
      setIsCheckingConnection(false);
    }
  };

  const handleOpen = async () => {
    setIsOpen(true);
    setSendResult(null);
    await checkConnection();
  };

  const handlePhoneNumberChange = (value: string) => {
    const digitsOnly = value.replace(/\D/g, '');
    const trimmed = digitsOnly.length > 10 ? digitsOnly.slice(-10) : digitsOnly;
    setPhoneNumber(trimmed);
  };

  const validateForm = (): string[] => {
    const errors: string[] = [];
    
    if (!phoneNumber) {
      errors.push('Phone number is required');
    } else if (!WhatsAppAPI.validatePhoneNumber(phoneNumber)) {
      errors.push('Please enter a valid Indian mobile number (10 digits)');
    }
    
    if (!message.trim()) {
      errors.push('Message content is required');
    }
    
    if (!reportUrl) {
      errors.push('No report URL provided');
    }
    
    return errors;
  };

  const handleSend = async () => {
    const errors = validateForm();
    if (errors.length > 0) {
      setSendResult({
        success: false,
        message: errors.join(', ')
      });
      return;
    }

    setIsSending(true);
    setSendResult(null);

    try {
      const formattedPhone = WhatsAppAPI.formatPhoneNumber(phoneNumber);
      
      // Check connection status before sending
      const connection = await WhatsAppAPI.getConnectionStatus();
      
      if (!connection?.success || !connection.isConnected) {
        console.log('⚠️ WhatsApp not connected, using manual fallback...');
        
        // Import the fallback utility
        const { openWhatsAppManually, buildMessageWithReportLink } = await import('../../utils/whatsappUtils');
        
        // Build message with report link embedded
        const messageWithLink = customDomainReportUrl 
          ? buildMessageWithReportLink(message, customDomainReportUrl, 'patient')
          : message;
        
        // Open WhatsApp manually
        const { success, method } = await openWhatsAppManually(
          phoneNumber,
          messageWithLink,
          customDomainReportUrl,
          'patient'
        );
        
        if (success && method === 'manual_link') {
          setSendResult({
            success: true,
            message: 'WhatsApp opened. Please send the message manually.',
            method: 'manual_link'
          });
          
          // Close modal after showing success
          setTimeout(() => {
            setIsOpen(false);
          }, 2000);
          
          if (onSent) {
            onSent({
              success: true,
              message: 'Manual link opened',
              method: 'manual_link'
            });
          }
        } else {
          setSendResult({
            success: false,
            message: 'User cancelled manual send'
          });
        }
        
        setIsSending(false);
        return;
      }
      
      // Connected - use normal backend send
      const result = await WhatsAppAPI.sendReportFromUrl(
        formattedPhone,
        customDomainReportUrl!,
        message,
        patientName,
        testName
      );

      setSendResult(result);
      
      if (result.success) {
        // Close modal after success
        setTimeout(() => {
          setIsOpen(false);
        }, 2000);
      }
      
      if (onSent) {
        onSent(result);
      }
    } catch (error) {
      console.error('Send report error:', error);
      setSendResult({
        success: false,
        message: 'Failed to send report: ' + (error as Error).message
      });
    } finally {
      setIsSending(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={handleOpen}
        className="inline-flex items-center px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
        title="Send via WhatsApp"
      >
        <MessageCircle className="h-4 w-4 mr-2" />
        Send via WhatsApp
      </button>
    );
  }

  return (
    <div 
      className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50 p-4"
      style={{ 
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999
      }}
      onClick={(e) => {
        // Close modal if clicking the backdrop
        if (e.target === e.currentTarget) {
          setIsOpen(false);
        }
      }}
    >
      <div 
        className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        style={{ 
          position: 'relative',
          margin: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <MessageCircle className="h-6 w-6 text-green-600" />
            <h3 className="text-lg font-semibold text-gray-900">
              Send Report via WhatsApp
            </h3>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="text-gray-400 hover:text-gray-600"
          >
            <XCircle className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Connection Status */}
          {isCheckingConnection ? (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center space-x-2">
                <Loader className="h-4 w-4 animate-spin text-blue-600" />
                <span className="text-blue-800 text-sm">Checking WhatsApp connection...</span>
              </div>
            </div>
          ) : !isConnected ? (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-start space-x-2">
                <XCircle className="h-4 w-4 text-red-600 mt-0.5" />
                <div>
                  <div className="text-red-800 text-sm font-medium">WhatsApp Not Connected</div>
                  <div className="text-red-700 text-xs mt-1">
                    Please go to WhatsApp Integration page to connect your WhatsApp account first.
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center space-x-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="text-green-800 text-sm">WhatsApp connected and ready to send</span>
              </div>
            </div>
          )}

          {/* Report Info */}
          <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="text-sm text-gray-700">
              <div className="font-medium">Report: {reportName}</div>
              {patientName && <div>Patient: {patientName}</div>}
              {testName && <div>Test: {testName}</div>}
            </div>
          </div>

          {/* Template Selector */}
          {templates.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Message Template
              </label>
              <select
                value={selectedTemplateId}
                onChange={async (e) => {
                  setSelectedTemplateId(e.target.value);
                  if (e.target.value === 'custom') {
                    setMessage(`Hello ${patientName || 'Patient'}, your ${testName || 'test'} report is ready. Please find it attached.`);
                  } else {
                    const template = templates.find((t: any) => t.id === e.target.value);
                    if (template) {
                      const { database, supabase } = await import('../../utils/supabase');
                      const labId = await database.getCurrentUserLabId();
                      const { data: labData } = await supabase
                        .from('labs')
                        .select('name, address, phone, email')
                        .eq('id', labId!)
                        .single();
                      
                      const { replacePlaceholders } = await import('../../utils/whatsappTemplates');
                      const templatedMessage = replacePlaceholders(template.message_content, {
                        PatientName: patientName || 'Patient',
                        TestName: testName || 'test',
                        ReportUrl: reportUrl || '',
                        LabName: labData?.name || '',
                        LabAddress: labData?.address || '',
                        LabContact: labData?.phone || '',
                        LabEmail: labData?.email || '',
                      });
                      setMessage(templatedMessage);
                    }
                  }
                }}
                disabled={!isConnected}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 disabled:opacity-50"
              >
                {templates.map((template: any) => (
                  <option key={template.id} value={template.id}>
                    {template.name} {template.is_default ? '(Default)' : ''}
                  </option>
                ))}
                <option value="custom">Custom Message</option>
              </select>
            </div>
          )}

          {/* Phone Number */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Phone className="h-4 w-4 inline mr-1" />
              Phone Number
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">
                +91
              </span>
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => handlePhoneNumberChange(e.target.value)}
                placeholder="9876543210"
                maxLength={10}
                className="w-full pl-12 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
              />
            </div>
            {phoneNumber && !WhatsAppAPI.validatePhoneNumber(phoneNumber) && (
              <p className="mt-1 text-sm text-red-600">
                Please enter a valid 10-digit mobile number
              </p>
            )}
          </div>

          {/* Message */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Message
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Enter your message..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
            />
          </div>

          {/* Send Result */}
          {sendResult && (
            <div className={`mb-4 p-3 rounded-lg border ${
              sendResult.success 
                ? 'border-green-200 bg-green-50' 
                : 'border-red-200 bg-red-50'
            }`}>
              <div className="flex items-start space-x-2">
                {sendResult.success ? (
                  <CheckCircle className="h-4 w-4 text-green-600 mt-0.5" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
                )}
                <div>
                  <div className={`text-sm font-medium ${
                    sendResult.success ? 'text-green-900' : 'text-red-900'
                  }`}>
                    {sendResult.success ? 'Report sent successfully!' : 'Failed to send report'}
                  </div>
                  <div className={`text-xs ${
                    sendResult.success ? 'text-green-800' : 'text-red-800'
                  }`}>
                    {sendResult.message}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end space-x-3">
            <button
              onClick={() => setIsOpen(false)}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={isSending || !phoneNumber || !message.trim()}
              className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSending ? (
                <Loader className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              {isSending ? 'Sending...' : 'Send Report'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuickSendReport;