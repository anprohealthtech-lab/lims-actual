// src/components/WhatsApp/NotificationBadge.tsx
import React from 'react';
import { Bell, AlertCircle } from 'lucide-react';
import { useWhatsAppNotificationMonitor } from '../../hooks/useWhatsAppNotificationMonitor';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

export const NotificationBadge: React.FC = () => {
  const { labId } = useAuth();
  const navigate = useNavigate();
  
  const { failedCount, isConnected } = useWhatsAppNotificationMonitor({
    labId: labId || undefined,
    enabled: true
  });

  if (failedCount === 0) return null;

  return (
    <button
      onClick={() => navigate('/whatsapp?tab=queue')}
      className="relative inline-flex items-center p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
      title={`${failedCount} failed WhatsApp notification${failedCount > 1 ? 's' : ''}`}
    >
      <Bell className="h-5 w-5" />
      
      {/* Badge */}
      <span className="absolute -top-1 -right-1 flex items-center justify-center h-5 w-5 text-xs font-bold text-white bg-red-600 rounded-full">
        {failedCount > 99 ? '99+' : failedCount}
      </span>

      {/* Connection indicator */}
      {!isConnected && (
        <AlertCircle className="absolute -bottom-1 -right-1 h-3 w-3 text-yellow-500" />
      )}
    </button>
  );
};
