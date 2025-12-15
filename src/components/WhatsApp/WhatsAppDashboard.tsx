// src/components/WhatsApp/WhatsAppDashboard.tsx
import React, { useState, useEffect } from 'react';
import { 
  Smartphone, 
  CheckCircle, 
  XCircle, 
  Loader, 
  RefreshCw, 
  AlertCircle,
  QrCode,
  Power,
  PowerOff
} from 'lucide-react';
import { WhatsAppAPI, WhatsAppConnectionStatus } from '../../utils/whatsappAPI';
import { useAuth } from '../../contexts/AuthContext';

interface WhatsAppDashboardProps {
  onConnectionChange?: (isConnected: boolean) => void;
}

const WhatsAppDashboard: React.FC<WhatsAppDashboardProps> = ({ onConnectionChange }) => {
  const { user } = useAuth();
  const [connectionStatus, setConnectionStatus] = useState<WhatsAppConnectionStatus>({
    success: false,
    isConnected: false,
    message: 'Checking connection...'
  });
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [connectAttempts, setConnectAttempts] = useState<number>(0);
  
  // Refs for managing component state and preventing race conditions
  const pollingIntervalRef = React.useRef<number | null>(null);
  const pollingTimeoutRef = React.useRef<number | null>(null);
  const pollingStartedAtRef = React.useRef<number>(0);
  const currentDelayRef = React.useRef<number>(5000);
  const stoppedRef = React.useRef<boolean>(false);
  const isOperationInProgressRef = React.useRef<boolean>(false);
  const isMountedRef = React.useRef<boolean>(true);

  // Build an img src when backend only returns raw QR data
  const buildQrFromRaw = (raw?: string | null, size = 256) => {
    if (!raw) return null;
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(raw)}`;
  };

  useEffect(() => {
    checkConnectionStatus();
    
    // Set up WebSocket for real-time updates
    const ws = WhatsAppAPI.createWebSocketConnection(handleWebSocketMessage);
    if (!ws) {
      // Explicit debug log so we can see why WS isn't active
      // If VITE_WHATSAPP_WS_ENABLED=false, it will be disabled in the API class and logged there too
      console.info('[WA-WS] No WebSocket instance returned (WS disabled or all candidates failed). Using HTTP polling only.');
    }
    
    const onVisChange = () => {
      // When tab is hidden, stretch polling to reduce load
      if (document.hidden) {
        currentDelayRef.current = Math.max(currentDelayRef.current, 10000);
      }
    };
    document.addEventListener('visibilitychange', onVisChange);

    return () => {
      isMountedRef.current = false;
      stoppedRef.current = true;
      
      if (ws) {
        ws.close();
      }
      cleanupPollingTimers();
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, []);

  useEffect(() => {
    // Notify parent component of connection changes
    if (onConnectionChange) {
      onConnectionChange(connectionStatus.isConnected);
    }
  }, [connectionStatus.isConnected, onConnectionChange]);

  const handleWebSocketMessage = (data: any) => {
    // Support both { event, ...payload } and { type, data: payload } shapes
    const eventType = data?.event || data?.type;
    const payload = data?.data ? data.data : data;

    // Ignore events for other users
    if (payload?.userId && user?.id && payload.userId !== user.id) return;

    switch (eventType) {
      case 'user-qr-code': {
        const qr = payload?.qrCode || buildQrFromRaw(payload?.rawQR);
        if (qr) setQrCode(qr);
        setConnectionStatus(prev => ({
          ...prev,
          message: 'QR Code generated. Scan with WhatsApp to connect.'
        }));
        break;
      }
      case 'user-connected': {
        setConnectionStatus({
          success: true,
          isConnected: true,
          phoneNumber: payload?.phoneNumber,
          sessionId: payload?.sessionId,
          message: 'WhatsApp connected successfully!'
        });
        setQrCode(null);
        setIsConnecting(false);
        setLastUpdated(new Date());
        // Stop any pending polling immediately
        stopPollingForStatus();
        break;
      }
      case 'user-disconnected': {
        setConnectionStatus({
          success: true,
          isConnected: false,
          message: payload?.shouldReconnect ? 'Disconnected. Click connect to reconnect.' : 'Disconnected by user.'
        });
        setQrCode(null);
        setIsConnecting(false);
        setIsDisconnecting(false);
        setLastUpdated(new Date());
        break;
      }
      case 'connection-error': {
        setConnectionStatus({
          success: false,
          isConnected: false,
          message: payload?.message || 'Connection error occurred.'
        });
        setQrCode(null);
        setIsConnecting(false);
        setIsDisconnecting(false);
        break;
      }
      default:
        // Ignore other events or multi-user-status
        break;
    }
  };

  const checkConnectionStatus = async () => {
    try {
      const status = await WhatsAppAPI.getConnectionStatus();
      setConnectionStatus(status);
      let rawQR = (status as any)?.rawQR as string | undefined;
      let qr = status.qrCode || buildQrFromRaw(rawQR);
      // If backend doesn't include QR in status, try a dedicated QR fetch (HTTP-only deployments)
      if (!qr && !status.isConnected) {
        const latest = await WhatsAppAPI.getLatestQr();
        rawQR = latest?.rawQR;
        qr = latest?.qrCode || buildQrFromRaw(rawQR);
      }
      if (qr) setQrCode(qr);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to check connection status:', error);
      setConnectionStatus({
        success: false,
        isConnected: false,
        message: 'Failed to check connection status'
      });
    }
  };

  const handleConnect = async () => {
    // Prevent multiple simultaneous connect attempts
    if (isConnecting || isOperationInProgressRef.current || !isMountedRef.current) return;
    
    isOperationInProgressRef.current = true;
    setIsConnecting(true);
    setQrCode(null);
    
    try {
      // Check if already connected or has active QR
      const existing = await WhatsAppAPI.getConnectionStatus();
      if (existing?.isConnected) {
        setConnectionStatus(existing);
        setConnectAttempts(0);
        setIsConnecting(false);
        return;
      }

      // Track attempts and hard reset stale session after 3 tries
      let nextAttemptCount = connectAttempts + 1;
      if (nextAttemptCount > 3) {
        const reset = await WhatsAppAPI.resetUserWhatsAppSession();
        console.info('Resetting WhatsApp session before reconnect:', reset);
        nextAttemptCount = 1; // restart counting after reset
        if (!reset.success) {
          setConnectionStatus({
            success: false,
            isConnected: false,
            message: reset.message || 'Failed to reset WhatsApp session before reconnecting.'
          });
        }
      }
      setConnectAttempts(nextAttemptCount);
      
      // If existing QR found, use it and start polling
      if ((existing as any)?.qrCode || (existing as any)?.rawQR) {
        setConnectionStatus(existing);
        const rawQR = (existing as any)?.rawQR as string | undefined;
        const qr = (existing as any)?.qrCode || buildQrFromRaw(rawQR);
        if (qr) setQrCode(qr);
        startPollingForStatus();
        return;
      }
      
      // Initiate new connection
      console.log('Initiating new WhatsApp connection...');
      const result = await WhatsAppAPI.connectWhatsApp();
      setConnectionStatus(result);
      
      // Parse QR code from result
      // The backend might return qrCode as raw string or as image URL
      const rawQR = (result as any)?.rawQR as string | undefined;
      const qrCodeFromResult = (result as any)?.qrCode as string | undefined;
      
      // If qrCode is a data URL or http URL, use it directly
      // Otherwise, treat it as raw QR data and convert it
      let qr: string | null = null;
      if (qrCodeFromResult) {
        if (qrCodeFromResult.startsWith('data:') || qrCodeFromResult.startsWith('http')) {
          qr = qrCodeFromResult;
        } else {
          // It's raw QR data, convert it to image URL
          qr = buildQrFromRaw(qrCodeFromResult);
        }
      } else if (rawQR) {
        qr = buildQrFromRaw(rawQR);
      }
      
      console.log('Connect result:', result, 'Parsed QR:', qr);
      if (qr) setQrCode(qr);
      
      if (result.success && qr) {
        setConnectAttempts(0);
        startPollingForStatus();
      } else {
        setIsConnecting(false);
        isOperationInProgressRef.current = false;
      }
    } catch (error) {
      console.error('Connection failed:', error);
      setConnectionStatus({
        success: false,
        isConnected: false,
        message: 'Connection failed: ' + (error as Error).message
      });
      setConnectAttempts((count) => count + 1);
      setIsConnecting(false);
      stopPollingForStatus();
      isOperationInProgressRef.current = false;
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    
    try {
      const result = await WhatsAppAPI.disconnectWhatsApp();
      setConnectionStatus(result);
      stopPollingForStatus();
    } catch (error) {
      console.error('Disconnect failed:', error);
      setConnectionStatus({
        success: false,
        isConnected: false,
        message: 'Disconnect failed: ' + (error as Error).message
      });
    } finally {
      setIsDisconnecting(false);
    }
  };

  const startPollingForStatus = () => {
    if (pollingTimeoutRef.current || stoppedRef.current === false) return; // already polling
    
    console.log('Starting WhatsApp status polling...');
    stoppedRef.current = false;
    pollingStartedAtRef.current = Date.now();
    currentDelayRef.current = 5000; // Start with 5s interval
    
    const tick = async () => {
      if (stoppedRef.current || !isMountedRef.current) return;
      
      try {
        const status = await WhatsAppAPI.getConnectionStatus();
        if (!isMountedRef.current) return; // Check again after async call
        setConnectionStatus(status);
        
        // Update QR if needed
        let qr: string | null = status.qrCode || null;
        if (!qr && !status.isConnected) {
          const latest = await WhatsAppAPI.getLatestQr();
          const raw = latest?.rawQR;
          qr = latest?.qrCode || (raw ? buildQrFromRaw(raw) : null);
        }
        if (qr) setQrCode(qr);
        setLastUpdated(new Date());
        
        const elapsed = Date.now() - pollingStartedAtRef.current;
        
        // Stop polling if connected or timed out (3 minutes)
        if (status.isConnected || elapsed > 3 * 60 * 1000) {
          stopPollingForStatus();
          setIsConnecting(false);
          isOperationInProgressRef.current = false;
          return;
        }
        
        // Adaptive backoff: increase delay over time
        if (elapsed > 30 * 1000 && currentDelayRef.current < 8000) {
          currentDelayRef.current = 8000; // After 30s, poll every 8s
        }
        if (elapsed > 60 * 1000 && currentDelayRef.current < 12000) {
          currentDelayRef.current = 12000; // After 1min, poll every 12s
        }
        
        // If tab hidden, use longer delays
        const delay = document.hidden ? Math.max(currentDelayRef.current, 15000) : currentDelayRef.current;
        pollingTimeoutRef.current = window.setTimeout(tick, delay);
      } catch (error) {
        console.error('Polling error:', error);
        pollingTimeoutRef.current = window.setTimeout(tick, 10000); // Retry in 10s on error
      }
    };
    
    // Start polling immediately
    tick();
  };

  const stopPollingForStatus = () => {
    stoppedRef.current = true;
    cleanupPollingTimers();
  };

  const cleanupPollingTimers = () => {
    if (pollingTimeoutRef.current) {
      window.clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }
    if (pollingIntervalRef.current) {
      window.clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  };

  const getStatusIcon = () => {
    if (isConnecting || isDisconnecting) {
      return <Loader className="h-5 w-5 animate-spin" />;
    }
    
    if (connectionStatus.isConnected) {
      return <CheckCircle className="h-5 w-5 text-green-600" />;
    }
    
    return <XCircle className="h-5 w-5 text-red-600" />;
  };

  const getStatusColor = () => {
    if (connectionStatus.isConnected) {
      return 'border-green-200 bg-green-50';
    }
    
    if (isConnecting) {
      return 'border-blue-200 bg-blue-50';
    }
    
    return 'border-red-200 bg-red-50';
  };

  const getStatusText = () => {
    if (isConnecting) return 'Connecting...';
    if (isDisconnecting) return 'Disconnecting...';
    if (connectionStatus.isConnected) return 'Connected';
    return 'Disconnected';
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <Smartphone className="h-6 w-6 text-green-600" />
          <h2 className="text-xl font-semibold text-gray-900">WhatsApp Integration</h2>
        </div>
        <button
          onClick={checkConnectionStatus}
          disabled={isConnecting || isDisconnecting}
          className="p-2 text-gray-500 hover:text-gray-700 disabled:opacity-50"
          title="Refresh Status"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Connection Status Card */}
      <div className={`border rounded-lg p-4 mb-6 ${getStatusColor()}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {getStatusIcon()}
            <div>
              <div className="font-medium text-gray-900">{getStatusText()}</div>
              {connectionStatus.phoneNumber && (
                <div className="text-sm text-gray-600">
                  Phone: {connectionStatus.phoneNumber}
                </div>
              )}
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            {!connectionStatus.isConnected && (
              <button
                onClick={handleConnect}
                disabled={isConnecting || isDisconnecting}
                className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isConnecting ? (
                  <Loader className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Power className="h-4 w-4 mr-2" />
                )}
                {isConnecting ? 'Connecting...' : 'Connect'}
              </button>
            )}
            
            {connectionStatus.isConnected && (
              <button
                onClick={handleDisconnect}
                disabled={isConnecting || isDisconnecting}
                className="inline-flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDisconnecting ? (
                  <Loader className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <PowerOff className="h-4 w-4 mr-2" />
                )}
                {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
              </button>
            )}
          </div>
        </div>
        
        {/* Status Message */}
        {connectionStatus.message && (
          <div className="mt-3 text-sm text-gray-700">
            {connectionStatus.message}
          </div>
        )}
        
        {/* Last Updated */}
        <div className="mt-2 text-xs text-gray-500">
          Last updated: {lastUpdated.toLocaleString()}
        </div>
      </div>

      {/* QR Code Section */}
      {qrCode && (
        <div className="border border-blue-200 bg-blue-50 rounded-lg p-6 mb-6">
          <div className="flex items-center space-x-2 mb-4">
            <QrCode className="h-5 w-5 text-blue-600" />
            <h3 className="font-medium text-blue-900">Scan QR Code with WhatsApp</h3>
          </div>
          
          <div className="flex flex-col items-center space-y-4">
            <div className="bg-white p-4 rounded-lg border-2 border-blue-200">
              <img 
                src={qrCode} 
                alt="WhatsApp QR Code" 
                className="w-64 h-64 object-contain"
              />
            </div>
            
            <div className="text-center">
              <div className="text-sm text-blue-800 font-medium mb-1">
                Steps to connect:
              </div>
              <ol className="text-xs text-blue-700 text-left space-y-1">
                <li>1. Open WhatsApp on your phone</li>
                <li>2. Tap Menu or Settings and select Linked Devices</li>
                <li>3. Tap "Link a Device" and scan this code</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* Connection Instructions */}
      {!connectionStatus.isConnected && !qrCode && !isConnecting && (
        <div className="border border-yellow-200 bg-yellow-50 rounded-lg p-4">
          <div className="flex items-start space-x-2">
            <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
            <div>
              <div className="font-medium text-yellow-900 mb-1">
                WhatsApp Not Connected
              </div>
              <div className="text-sm text-yellow-800">
                Click "Connect" to generate a QR code and link your WhatsApp account. 
                This will enable you to send PDF reports and messages directly to patients.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Connected Features */}
      {connectionStatus.isConnected && (
        <div className="border border-green-200 bg-green-50 rounded-lg p-4">
          <div className="flex items-start space-x-2">
            <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
            <div>
              <div className="font-medium text-green-900 mb-1">
                Ready to Send Messages
              </div>
              <div className="text-sm text-green-800">
                WhatsApp is connected and ready. You can now:
                <ul className="mt-2 space-y-1 ml-4">
                  <li>• Send PDF reports to patients</li>
                  <li>• Send appointment reminders</li>
                  <li>• Send custom messages</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WhatsAppDashboard;