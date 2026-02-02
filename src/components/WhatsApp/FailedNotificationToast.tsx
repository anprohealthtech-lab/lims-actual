// src/components/WhatsApp/FailedNotificationToast.tsx
import React, { useEffect, useState } from 'react';
import { AlertTriangle, X, RefreshCw, Bell } from 'lucide-react';
import { useWhatsAppNotificationMonitor, FailedNotification } from '../../hooks/useWhatsAppNotificationMonitor';
import { useAuth } from '../../contexts/AuthContext';

interface ToastNotification {
  id: string;
  notification: FailedNotification;
  timestamp: Date;
}

export const FailedNotificationToast: React.FC = () => {
  const { labId } = useAuth();
  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  const { failedNotifications, retryNotification } = useWhatsAppNotificationMonitor({
    labId: labId || undefined,
    onFailedNotification: (notification) => {
      // Show toast for new failures
      const toast: ToastNotification = {
        id: notification.id,
        notification,
        timestamp: new Date()
      };
      setToasts(prev => [...prev, toast]);

      // Auto-dismiss after 10 seconds
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== toast.id));
      }, 10000);
    },
    onRetrySuccess: (notificationId) => {
      // Remove toast on success
      setToasts(prev => prev.filter(t => t.id !== notificationId));
    }
  });

  const dismissToast = (toastId: string) => {
    setToasts(prev => prev.filter(t => t.id !== toastId));
  };

  const handleRetry = async (toastId: string) => {
    const result = await retryNotification(toastId);
    if (result.success) {
      dismissToast(toastId);
    }
  };

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-md">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className="bg-white rounded-lg shadow-lg border border-red-200 p-4 flex items-start space-x-3 animate-slide-in"
        >
          {/* Icon */}
          <div className="flex-shrink-0">
            <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-900">
                  WhatsApp Send Failed
                </p>
                <p className="text-sm text-gray-600 mt-1">
                  {toast.notification.recipient_name || 'Unknown'} ({toast.notification.recipient_type})
                </p>
                {toast.notification.last_error && (
                  <p className="text-xs text-red-600 mt-1 line-clamp-2">
                    {toast.notification.last_error}
                  </p>
                )}
              </div>
              <button
                onClick={() => dismissToast(toast.id)}
                className="ml-2 flex-shrink-0 text-gray-400 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Actions */}
            <div className="mt-3 flex items-center space-x-2">
              <button
                onClick={() => handleRetry(toast.id)}
                className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors"
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Retry Now
              </button>
              <a
                href="/whatsapp?tab=queue"
                className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-600 rounded hover:bg-blue-50 transition-colors"
              >
                <Bell className="h-3 w-3 mr-1" />
                View Queue
              </a>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
