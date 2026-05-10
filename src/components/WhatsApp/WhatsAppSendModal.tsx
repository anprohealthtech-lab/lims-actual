// src/components/WhatsApp/WhatsAppSendModal.tsx
import React, { useState, useEffect } from 'react';
import { X, Send, Loader, Phone, MessageCircle } from 'lucide-react';
import { WhatsAppAPI } from '../../utils/whatsappAPI';
import { formatPhoneWithLabCountryCode } from '../../utils/phoneFormatter';
import { useEscapeModalClose } from '../../hooks/useEscapeModalClose';

interface WhatsAppSendModalProps {
  isOpen: boolean;
  onClose: () => void;
  file?: File;
  defaultPhone?: string;
  patientName?: string;
  testName?: string;
  onSuccess?: (messageId?: string) => void;
}

const WhatsAppSendModal: React.FC<WhatsAppSendModalProps> = ({
  isOpen,
  onClose,
  file,
  defaultPhone = '',
  patientName = '',
  testName = '',
  onSuccess
}) => {
  useEscapeModalClose(onClose, isOpen);
  const [phoneNumber, setPhoneNumber] = useState(defaultPhone);
  const [formattedPhone, setFormattedPhone] = useState('');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setPhoneNumber(defaultPhone);
      setMessage(generateDefaultMessage());
      setError(null);
    }
  }, [isOpen, defaultPhone, patientName, testName]);

  // Format phone number when it changes
  useEffect(() => {
    const updateFormattedPhone = async () => {
      if (phoneNumber) {
        const formatted = await formatPhoneWithLabCountryCode(phoneNumber);
        setFormattedPhone(formatted);
      } else {
        setFormattedPhone('');
      }
    };
    updateFormattedPhone();
  }, [phoneNumber]);

  const generateDefaultMessage = () => {
    if (patientName && testName) {
      return `Hello ${patientName},\n\nYour ${testName} report is ready. Please find the attached document.\n\nBest regards,\nLaboratory Team`;
    }
    return 'Please find the attached laboratory report.';
  };

  const handleSend = async () => {
    if (!file) {
      setError('No file selected');
      return;
    }

    if (!phoneNumber.trim()) {
      setError('Phone number is required');
      return;
    }

    setIsSending(true);
    setError(null);

    try {
      const result = await WhatsAppAPI.sendDocument(phoneNumber, file, {
        caption: message,
        patientName,
        testName
      });

      if (result.success) {
        onSuccess?.(result.messageId);
        onClose();
      } else {
        setError(result.message || 'Failed to send message');
      }
    } catch (error) {
      console.error('Send error:', error);
      setError('Failed to send message: ' + (error as Error).message);
    } finally {
      setIsSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center">
            <Phone className="h-5 w-5 mr-2 text-green-600" />
            Send via WhatsApp
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* File Info */}
          {file && (
            <div className="bg-gray-50 p-3 rounded-lg">
              <div className="text-sm text-gray-600">Sending:</div>
              <div className="font-medium text-gray-900">{file.name}</div>
              <div className="text-sm text-gray-500">
                Size: {(file.size / 1024 / 1024).toFixed(2)} MB
              </div>
            </div>
          )}

          {/* Phone Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Phone Number *
            </label>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="Enter phone number (e.g., 9876543210)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
              disabled={isSending}
            />
            <div className="text-xs text-gray-500 mt-1">
              Format: {formattedPhone || 'Enter number to see formatted version'}
            </div>
          </div>

          {/* Message */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center">
              <MessageCircle className="h-4 w-4 mr-1" />
              Message
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Enter your message (optional)"
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
              disabled={isSending}
            />
            <div className="text-xs text-gray-500 mt-1">
              {message.length}/1000 characters
            </div>
          </div>

          {/* Patient/Test Info */}
          {(patientName || testName) && (
            <div className="bg-blue-50 p-3 rounded-lg">
              <div className="text-sm text-blue-800">
                {patientName && (
                  <div><strong>Patient:</strong> {patientName}</div>
                )}
                {testName && (
                  <div><strong>Test:</strong> {testName}</div>
                )}
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="text-sm text-red-700">{error}</div>
            </div>
          )}
        </div>

        <div className="flex justify-end space-x-3 p-4 border-t">
          <button
            onClick={onClose}
            disabled={isSending}
            className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={isSending || !phoneNumber.trim()}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center"
          >
            {isSending ? (
              <Loader className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            {isSending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WhatsAppSendModal;
