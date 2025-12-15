// src/components/WhatsApp/WhatsAppSendButton.tsx
import React, { useState, useEffect } from 'react';
import { MessageCircle, Loader, AlertTriangle, CheckCircle } from 'lucide-react';
import WhatsAppSendModal from './WhatsAppSendModal';
import { WhatsAppAPI } from '../../utils/whatsappAPI';
import { checkWhatsAppStatus, sendWhatsAppDocument, formatPhoneNumber } from '../../utils/whatsappConnection';
import WhatsAppConnectionManager from './WhatsAppConnectionManager';

interface WhatsAppSendButtonProps {
  file?: File;
  fileUrl?: string;
  fileName?: string;
  phoneNumber?: string;
  patientName?: string;
  testName?: string;
  className?: string;
  variant?: 'button' | 'icon';
  size?: 'sm' | 'md' | 'lg';
  onSuccess?: (messageId?: string) => void;
  onError?: (error: string) => void;
  /** Current user ID for connection management */
  userId?: string;
  /** Lab ID for connection management */
  labId?: string;
  /** Show enhanced connection management */
  enhanced?: boolean;
}

const WhatsAppSendButton: React.FC<WhatsAppSendButtonProps> = ({
  file,
  fileUrl,
  fileName,
  phoneNumber = '',
  patientName = '',
  testName = '',
  className = '',
  variant = 'button',
  size = 'md',
  onSuccess,
  onError,
  userId,
  labId,
  enhanced = false,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);
  const [fileToSend, setFileToSend] = useState<File | null>(file || null);
  const [connectionStatus, setConnectionStatus] = useState<{
    connected: boolean;
    sessionId: string | null;
    showManager: boolean;
  }>({
    connected: false,
    sessionId: null,
    showManager: false,
  });
  const [sendStatus, setSendStatus] = useState<{
    loading: boolean;
    success: boolean;
    error: string | null;
  }>({
    loading: false,
    success: false,
    error: null,
  });

  const sizeClasses = {
    sm: 'px-2 py-1 text-sm',
    md: 'px-3 py-2',
    lg: 'px-4 py-3 text-lg'
  };

  const iconSizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6'
  };

  // Check connection status if enhanced mode and userId is available
  useEffect(() => {
    if (enhanced && userId) {
      const checkConnection = async () => {
        const status = await checkWhatsAppStatus(userId, labId);
        setConnectionStatus({
          connected: status.connected,
          sessionId: status.sessionId || null,
          showManager: false,
        });
      };
      checkConnection();
    }
  }, [enhanced, userId, labId]);

  // Download file from URL if needed
  const downloadFile = async (url: string, name: string): Promise<File> => {
    const response = await fetch(url);
    const blob = await response.blob();
    return new File([blob], name, { type: blob.type });
  };

  // Enhanced send function that bypasses modal
  const handleEnhancedSend = async () => {
    if (!enhanced || !userId || !connectionStatus.sessionId) {
      setConnectionStatus(prev => ({ ...prev, showManager: true }));
      return;
    }

    if (!fileUrl) {
      onError?.('No file URL provided');
      return;
    }

    setSendStatus({ loading: true, success: false, error: null });

    try {
      const formattedPhone = formatPhoneNumber(phoneNumber);
      
      // Try to fetch default report_ready template for caption
      let content = `Report for ${patientName || 'Patient'}`;
      try {
        const { database } = await import('../../utils/supabase');
        const labId = await database.getCurrentUserLabId();
        const { data: template } = await database.whatsappTemplates.getDefault('report_ready', labId);
        
        if (template) {
          // Fetch lab details for placeholder
          const { supabase: supabaseClient } = await import('../../utils/supabase');
          const { data: labData } = await supabaseClient
            .from('labs')
            .select('name, address, phone, email')
            .eq('id', labId!)
            .single();
          
          const { replacePlaceholders } = await import('../../utils/whatsappTemplates');
          content = replacePlaceholders(template.message_content, {
            PatientName: patientName || 'Patient',
            TestName: testName || 'Test',
            ReportUrl: fileUrl,
            LabName: labData?.name || '',
            LabAddress: labData?.address || '',
            LabContact: labData?.phone || '',
            LabEmail: labData?.email || '',
          });
        }
      } catch (err) {
        console.error('Error fetching template:', err);
      }
      
      const result = await sendWhatsAppDocument(connectionStatus.sessionId, formattedPhone, fileUrl, {
        fileName: fileName || 'report.pdf',
        patientName,
        testName,
        content,
      });

      if (result.success) {
        setSendStatus({ loading: false, success: true, error: null });
        onSuccess?.(result.messageId);
        
        // Reset success state after 3 seconds
        setTimeout(() => {
          setSendStatus(prev => ({ ...prev, success: false }));
        }, 3000);
      } else {
        setSendStatus({ loading: false, success: false, error: result.error || 'Failed to send' });
        
        if (result.needsConnection) {
          setConnectionStatus(prev => ({ ...prev, showManager: true }));
        }
        
        onError?.(result.error || 'Failed to send message');
      }
    } catch (error) {
      const errorMsg = String(error);
      setSendStatus({ loading: false, success: false, error: errorMsg });
      onError?.(errorMsg);
    }
  };

  const handleClick = async () => {
    // Use enhanced mode if available
    if (enhanced && userId && fileUrl) {
      await handleEnhancedSend();
      return;
    }

    // Fall back to original modal-based approach
    setIsCheckingConnection(true);

    try {
      // Check WhatsApp connection first
      const status = await WhatsAppAPI.getConnectionStatus();
      if (!status.isConnected) {
        onError?.('WhatsApp is not connected. Please connect WhatsApp first.');
        return;
      }

      // Prepare file if we have a URL instead of File object
      let finalFile = fileToSend;
      if (!finalFile && fileUrl && fileName) {
        try {
          finalFile = await downloadFile(fileUrl, fileName);
          setFileToSend(finalFile);
        } catch (error) {
          onError?.('Failed to prepare file for sending');
          return;
        }
      }

      if (!finalFile) {
        onError?.('No file available to send');
        return;
      }

      setIsModalOpen(true);
    } catch (error) {
      console.error('WhatsApp check error:', error);
      onError?.('Failed to check WhatsApp connection');
    } finally {
      setIsCheckingConnection(false);
    }
  };

  const handleConnectionChange = (connected: boolean, sessionId?: string) => {
    setConnectionStatus(prev => ({
      ...prev,
      connected,
      sessionId: sessionId || null,
      showManager: !connected,
    }));
  };

  const handleSuccess = (messageId?: string) => {
    setIsModalOpen(false);
    onSuccess?.(messageId);
  };

  // Get button icon based on state
  const getButtonIcon = () => {
    if (enhanced) {
      if (sendStatus.loading) return <Loader className={`${iconSizeClasses[size]} animate-spin`} />;
      if (sendStatus.success) return <CheckCircle className={iconSizeClasses[size]} />;
      if (sendStatus.error) return <AlertTriangle className={iconSizeClasses[size]} />;
    }
    
    if (isCheckingConnection || sendStatus.loading) {
      return <Loader className={`${iconSizeClasses[size]} animate-spin`} />;
    }
    
    return <MessageCircle className={iconSizeClasses[size]} />;
  };

  // Get button text based on state
  const getButtonText = () => {
    if (enhanced) {
      if (sendStatus.loading) return 'Sending...';
      if (sendStatus.success) return 'Sent!';
      if (!connectionStatus.connected) return 'Connect & Send';
    }
    
    if (isCheckingConnection) return 'Checking...';
    return 'Send via WhatsApp';
  };

  const isDisabled = isCheckingConnection || sendStatus.loading;

  if (variant === 'icon') {
    return (
      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <button
            onClick={handleClick}
            disabled={isDisabled}
            className={`inline-flex items-center justify-center p-2 ${
              sendStatus.success ? 'bg-green-500' : sendStatus.error ? 'bg-red-500' : 'bg-green-600'
            } text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
            title="Send via WhatsApp"
          >
            {getButtonIcon()}
          </button>
          
          {enhanced && (
            <div 
              className={`w-2 h-2 rounded-full ${
                connectionStatus.connected ? 'bg-green-500' : 'bg-red-500'
              }`}
              title={connectionStatus.connected ? 'WhatsApp Connected' : 'WhatsApp Not Connected'}
            />
          )}
        </div>

        {/* Error display for enhanced mode */}
        {enhanced && sendStatus.error && (
          <div className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded">
            {sendStatus.error}
          </div>
        )}

        {/* Connection manager for enhanced mode */}
        {enhanced && connectionStatus.showManager && userId && (
          <div className="p-3 border border-gray-200 rounded-lg bg-gray-50">
            <WhatsAppConnectionManager
              userId={userId}
              labId={labId}
              onConnectionChange={handleConnectionChange}
            />
          </div>
        )}

        <WhatsAppSendModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          file={fileToSend || undefined}
          defaultPhone={phoneNumber}
          patientName={patientName}
          testName={testName}
          onSuccess={handleSuccess}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleClick}
        disabled={isDisabled}
        className={`inline-flex items-center ${sizeClasses[size]} ${
          sendStatus.success ? 'bg-green-500' : sendStatus.error ? 'bg-red-500' : 'bg-green-600'
        } text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        {getButtonIcon()}
        <span className="ml-2">{getButtonText()}</span>
        {enhanced && (
          <div 
            className={`ml-2 w-2 h-2 rounded-full ${
              connectionStatus.connected ? 'bg-green-300' : 'bg-red-300'
            }`}
            title={connectionStatus.connected ? 'WhatsApp Connected' : 'WhatsApp Not Connected'}
          />
        )}
      </button>

      {/* Error display for enhanced mode */}
      {enhanced && sendStatus.error && (
        <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">
          {sendStatus.error}
        </div>
      )}

      {/* Connection manager for enhanced mode */}
      {enhanced && connectionStatus.showManager && userId && (
        <div className="p-3 border border-gray-200 rounded-lg bg-gray-50">
          <WhatsAppConnectionManager
            userId={userId}
            labId={labId}
            onConnectionChange={handleConnectionChange}
          />
        </div>
      )}

      <WhatsAppSendModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        file={fileToSend || undefined}
        defaultPhone={phoneNumber}
        patientName={patientName}
        testName={testName}
        onSuccess={handleSuccess}
      />
    </div>
  );
};

export default WhatsAppSendButton;