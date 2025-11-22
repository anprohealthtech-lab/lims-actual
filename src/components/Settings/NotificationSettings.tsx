import React, { useEffect, useState } from 'react';
import { Bell, BellOff, Check } from 'lucide-react';
import { 
  getFirebaseToken, 
  subscribeToTopic, 
  unsubscribeFromTopic 
} from '../../utils/firebaseMessaging';
import { isNative } from '../../utils/platformHelper';

interface NotificationPreferences {
  orderUpdates: boolean;
  resultReady: boolean;
  paymentReminders: boolean;
  systemAlerts: boolean;
}

export const NotificationSettings: React.FC = () => {
  const [isNativeApp, setIsNativeApp] = useState(false);
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    orderUpdates: true,
    resultReady: true,
    paymentReminders: true,
    systemAlerts: true,
  });
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const checkPlatform = async () => {
      const isNativeCheck = isNative();
      setIsNativeApp(isNativeCheck);
      
      if (isNativeCheck) {
        const token = await getFirebaseToken();
        setFcmToken(token);
        
        // Load preferences from localStorage
        const savedPrefs = localStorage.getItem('notificationPreferences');
        if (savedPrefs) {
          setPreferences(JSON.parse(savedPrefs));
        }
      }
    };
    
    checkPlatform();
  }, []);

  const handleToggle = async (key: keyof NotificationPreferences) => {
    setLoading(true);
    const newValue = !preferences[key];
    
    const topicMap = {
      orderUpdates: 'order-updates',
      resultReady: 'result-ready',
      paymentReminders: 'payment-reminders',
      systemAlerts: 'system-alerts',
    };
    
    const topic = topicMap[key];
    
    try {
      if (newValue) {
        await subscribeToTopic(topic);
      } else {
        await unsubscribeFromTopic(topic);
      }
      
      const newPreferences = { ...preferences, [key]: newValue };
      setPreferences(newPreferences);
      
      // Save to localStorage
      localStorage.setItem('notificationPreferences', JSON.stringify(newPreferences));
      
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('Failed to update notification preference:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!isNativeApp) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <Bell className="h-5 w-5 text-blue-600 mt-0.5" />
          <div>
            <h3 className="text-sm font-medium text-blue-900">
              Push Notifications
            </h3>
            <p className="text-sm text-blue-700 mt-1">
              Push notifications are available in the Android app. Download the app to receive real-time updates.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Push Notifications</h2>
            <p className="text-sm text-gray-500 mt-1">
              Manage your notification preferences
            </p>
          </div>
          {saved && (
            <div className="flex items-center space-x-2 text-green-600">
              <Check className="h-5 w-5" />
              <span className="text-sm font-medium">Saved</span>
            </div>
          )}
        </div>

        {fcmToken && (
          <div className="mb-6 p-3 bg-gray-50 rounded-md">
            <p className="text-xs text-gray-500 mb-1">Device Token (for debugging)</p>
            <p className="text-xs font-mono text-gray-700 break-all">{fcmToken}</p>
          </div>
        )}

        <div className="space-y-4">
          <NotificationToggle
            icon={<Bell className="h-5 w-5" />}
            title="Order Updates"
            description="Get notified when order status changes"
            enabled={preferences.orderUpdates}
            loading={loading}
            onToggle={() => handleToggle('orderUpdates')}
          />
          
          <NotificationToggle
            icon={<Bell className="h-5 w-5" />}
            title="Results Ready"
            description="Get notified when test results are ready"
            enabled={preferences.resultReady}
            loading={loading}
            onToggle={() => handleToggle('resultReady')}
          />
          
          <NotificationToggle
            icon={<Bell className="h-5 w-5" />}
            title="Payment Reminders"
            description="Get reminders for pending payments"
            enabled={preferences.paymentReminders}
            loading={loading}
            onToggle={() => handleToggle('paymentReminders')}
          />
          
          <NotificationToggle
            icon={<Bell className="h-5 w-5" />}
            title="System Alerts"
            description="Important system notifications and updates"
            enabled={preferences.systemAlerts}
            loading={loading}
            onToggle={() => handleToggle('systemAlerts')}
          />
        </div>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <BellOff className="h-5 w-5 text-yellow-600 mt-0.5" />
          <div>
            <h3 className="text-sm font-medium text-yellow-900">
              Notification Permissions
            </h3>
            <p className="text-sm text-yellow-700 mt-1">
              If you're not receiving notifications, check your device settings to ensure notifications are enabled for LIMS Builder.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

interface NotificationToggleProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  loading: boolean;
  onToggle: () => void;
}

const NotificationToggle: React.FC<NotificationToggleProps> = ({
  icon,
  title,
  description,
  enabled,
  loading,
  onToggle,
}) => {
  return (
    <div className="flex items-start justify-between py-3 border-b border-gray-100 last:border-b-0">
      <div className="flex items-start space-x-3 flex-1">
        <div className={`mt-0.5 ${enabled ? 'text-blue-600' : 'text-gray-400'}`}>
          {icon}
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-medium text-gray-900">{title}</h3>
          <p className="text-sm text-gray-500 mt-0.5">{description}</p>
        </div>
      </div>
      <button
        onClick={onToggle}
        disabled={loading}
        className={`
          relative inline-flex h-6 w-11 items-center rounded-full
          transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
          ${enabled ? 'bg-blue-600' : 'bg-gray-200'}
          ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        <span
          className={`
            inline-block h-4 w-4 transform rounded-full bg-white transition-transform
            ${enabled ? 'translate-x-6' : 'translate-x-1'}
          `}
        />
      </button>
    </div>
  );
};
