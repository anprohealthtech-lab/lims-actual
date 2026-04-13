// src/components/WhatsApp/WhatsAppMessaging.tsx
import React, { useState } from 'react';
import { 
  Send, 
  FileText, 
  Phone, 
  MessageSquare, 
  Loader, 
  CheckCircle, 
  XCircle,
  AlertCircle
} from 'lucide-react';
import { WhatsAppAPI, MessageResult } from '../../utils/whatsappAPI';
import { uploadFile, generateFilePath, database } from '../../utils/supabase';

interface WhatsAppMessagingProps {
  isConnected: boolean;
  onMessageSent?: (result: MessageResult) => void;
}

interface MessageData {
  phoneNumber: string;
  message: string;
  patientName?: string;
  testName?: string;
  reportUrl?: string;
  messageType: 'text' | 'report';
}

const messageTemplates = [
  {
    name: 'Report Ready',
    template: 'Hello [PatientName], your [TestName] report is ready. Please find it attached.',
    requiresReport: true
  },
  {
    name: 'Appointment Reminder',
    template: 'Hello [PatientName], this is a reminder for your upcoming appointment.',
    requiresReport: false
  },
  {
    name: 'Test Results Available',
    template: 'Hello [PatientName], your [TestName] results are now available.',
    requiresReport: false
  },
  {
    name: 'Custom Message',
    template: '',
    requiresReport: false
  }
];

const WhatsAppMessaging: React.FC<WhatsAppMessagingProps> = ({
  isConnected,
  onMessageSent
}) => {
  const [messageData, setMessageData] = useState<MessageData>({
    phoneNumber: '',
    message: messageTemplates[0].template,
    messageType: messageTemplates[0].requiresReport ? 'report' : 'text'
  });
  const [isSending, setIsSending] = useState(false);
  const [sendingStatus, setSendingStatus] = useState<string>('');
  const [sendResult, setSendResult] = useState<MessageResult | null>(null);
  const [reportFile, setReportFile] = useState<File | null>(null);

  const [selectedTemplate, setSelectedTemplate] = useState(messageTemplates[0]);

  const handlePhoneNumberChange = (value: string) => {
    // Format phone number as user types
    const formatted = value.replace(/\D/g, '');
    setMessageData(prev => ({ ...prev, phoneNumber: formatted }));
  };

  const handleTemplateSelect = (template: typeof messageTemplates[0]) => {
    setSelectedTemplate(template);
    setMessageData(prev => ({
      ...prev,
      message: template.template,
      messageType: template.requiresReport ? 'report' : 'text'
    }));
  };

  const processMessageTemplate = (template: string, data: MessageData): string => {
    let processed = template;
    
    if (data.patientName) {
      processed = processed.replace(/\[PatientName\]/g, data.patientName);
    }
    
    if (data.testName) {
      processed = processed.replace(/\[TestName\]/g, data.testName);
    }
    
    return processed;
  };

  const validateForm = (): string[] => {
    const errors: string[] = [];
    
    if (!messageData.phoneNumber) {
      errors.push('Phone number is required');
    } else if (!WhatsAppAPI.validatePhoneNumber(messageData.phoneNumber)) {
      errors.push('Please enter a valid Indian mobile number (10 digits)');
    }
    
    if (!messageData.message.trim()) {
      errors.push('Message content is required');
    }
    
    if (messageData.messageType === 'report' && !reportFile && !messageData.reportUrl) {
      errors.push('Please select a PDF file or provide a report URL');
    }
    
    return errors;
  };

  const handleSendMessage = async () => {
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
    setSendingStatus('');

    try {
      const formattedPhone = WhatsAppAPI.formatPhoneNumber(messageData.phoneNumber);
      const processedMessage = processMessageTemplate(messageData.message, messageData);
      
      let result: MessageResult;

      if (messageData.messageType === 'report') {
        if (reportFile) {
          // Upload to Supabase Storage first, then send via URL
          // (avoids SESSION_NOT_READY on the binary multipart endpoint)
          setSendingStatus('Uploading PDF...');
          const labId = await database.getCurrentUserLabId();
          const filePath = generateFilePath(reportFile.name, undefined, labId || undefined, 'whatsapp-sends');
          const { publicUrl } = await uploadFile(reportFile, filePath, { upsert: false });
          setSendingStatus('Sending via WhatsApp...');
          result = await WhatsAppAPI.sendReportFromUrl(
            formattedPhone,
            publicUrl,
            processedMessage,
            messageData.patientName,
            messageData.testName
          );
        } else if (messageData.reportUrl) {
          // Send from URL
          result = await WhatsAppAPI.sendReportFromUrl(
            formattedPhone,
            messageData.reportUrl,
            processedMessage,
            messageData.patientName,
            messageData.testName
          );
        } else {
          throw new Error('No report file or URL provided');
        }
      } else {
        // Send text message
        result = await WhatsAppAPI.sendTextMessage(
          formattedPhone,
          processedMessage,
          {
            patientName: messageData.patientName || '',
            testName: messageData.testName || ''
          }
        );
      }

      setSendResult(result);
      setSendingStatus('');
      
      if (result.success) {
        // Reset form on success
        setMessageData({
          phoneNumber: '',
          message: selectedTemplate.template,
          messageType: selectedTemplate.requiresReport ? 'report' : 'text'
        });
        setReportFile(null);
      }
      
      if (onMessageSent) {
        onMessageSent(result);
      }
    } catch (error) {
      console.error('Send message error:', error);
      setSendResult({
        success: false,
        message: 'Failed to send message: ' + (error as Error).message
      });
    } finally {
      setIsSending(false);
      setSendingStatus('');
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        setReportFile(file);
      } else {
        setSendResult({
          success: false,
          message: 'Please select a PDF file only'
        });
        event.target.value = '';
      }
    }
  };

  if (!isConnected) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="text-center py-8">
          <XCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">WhatsApp Not Connected</h3>
          <p className="text-gray-600">
            Please connect WhatsApp first to start sending messages.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-center space-x-3 mb-6">
        <MessageSquare className="h-6 w-6 text-blue-600" />
        <h2 className="text-xl font-semibold text-gray-900">Send Message</h2>
      </div>

      {/* Message Templates */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Message Template
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {messageTemplates.map((template, index) => (
            <button
              key={index}
              onClick={() => handleTemplateSelect(template)}
              className={`p-3 text-left border rounded-lg transition-colors ${
                selectedTemplate.name === template.name
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="font-medium text-gray-900">{template.name}</div>
              {template.template && (
                <div className="text-sm text-gray-600 mt-1 line-clamp-2">
                  {template.template}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

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
            value={messageData.phoneNumber}
            onChange={(e) => handlePhoneNumberChange(e.target.value)}
            placeholder="9876543210"
            maxLength={10}
            className="w-full pl-12 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {messageData.phoneNumber && !WhatsAppAPI.validatePhoneNumber(messageData.phoneNumber) && (
          <p className="mt-1 text-sm text-red-600">
            Please enter a valid 10-digit mobile number
          </p>
        )}
      </div>

      {/* Patient and Test Info (Optional) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Patient Name (Optional)
          </label>
          <input
            type="text"
            value={messageData.patientName || ''}
            onChange={(e) => setMessageData(prev => ({ ...prev, patientName: e.target.value }))}
            placeholder="Enter patient name"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Test Name (Optional)
          </label>
          <input
            type="text"
            value={messageData.testName || ''}
            onChange={(e) => setMessageData(prev => ({ ...prev, testName: e.target.value }))}
            placeholder="Enter test name"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Message Content */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Message
        </label>
        <textarea
          value={messageData.message}
          onChange={(e) => setMessageData(prev => ({ ...prev, message: e.target.value }))}
          placeholder="Enter your message..."
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
        />
        <div className="mt-1 text-xs text-gray-500">
          Use [PatientName] and [TestName] as placeholders that will be replaced automatically.
        </div>
      </div>

      {/* File Upload for Reports */}
      {selectedTemplate.requiresReport && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            <FileText className="h-4 w-4 inline mr-1" />
            PDF Report
          </label>
          
          {/* File Upload */}
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
            <div className="text-center">
              <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <div className="text-sm text-gray-600 mb-4">
                {reportFile ? (
                  <div>
                    <div className="font-medium text-green-600">
                      Selected: {reportFile.name}
                    </div>
                    <div className="text-xs text-gray-500">
                      Size: {Math.round(reportFile.size / 1024)} KB
                    </div>
                  </div>
                ) : (
                  <div>
                    <div>Select a PDF file to send</div>
                    <div className="text-xs">Or provide a report URL below</div>
                  </div>
                )}
              </div>
              <input
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleFileSelect}
                className="hidden"
                id="pdf-upload"
              />
              <label
                htmlFor="pdf-upload"
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 cursor-pointer"
              >
                <FileText className="h-4 w-4 mr-2" />
                {reportFile ? 'Change File' : 'Select PDF'}
              </label>
            </div>
          </div>
          
          {/* Report URL Alternative */}
          <div className="mt-3">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Or provide PDF URL
            </label>
            <input
              type="url"
              value={messageData.reportUrl || ''}
              onChange={(e) => setMessageData(prev => ({ ...prev, reportUrl: e.target.value }))}
              placeholder="https://example.com/report.pdf"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      )}

      {/* Send Result */}
      {sendResult && (
        <div className={`mb-4 p-4 rounded-lg border ${
          sendResult.success 
            ? 'border-green-200 bg-green-50' 
            : 'border-red-200 bg-red-50'
        }`}>
          <div className="flex items-start space-x-2">
            {sendResult.success ? (
              <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
            ) : (
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
            )}
            <div>
              <div className={`font-medium ${
                sendResult.success ? 'text-green-900' : 'text-red-900'
              }`}>
                {sendResult.success ? 'Message Sent Successfully!' : 'Failed to Send Message'}
              </div>
              <div className={`text-sm ${
                sendResult.success ? 'text-green-800' : 'text-red-800'
              }`}>
                {sendResult.message}
              </div>
              {sendResult.messageId && (
                <div className="text-xs text-green-700 mt-1">
                  Message ID: {sendResult.messageId}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Send Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSendMessage}
          disabled={isSending}
          className="inline-flex items-center px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSending ? (
            <Loader className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Send className="h-4 w-4 mr-2" />
          )}
          {isSending ? (sendingStatus || 'Sending...') : 'Send Message'}
        </button>
      </div>
    </div>
  );
};

export default WhatsAppMessaging;