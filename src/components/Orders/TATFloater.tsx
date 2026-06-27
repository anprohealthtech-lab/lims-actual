import React, { useState, useEffect } from 'react';
import { AlertTriangle, X, Clock, ChevronUp, ChevronDown, ExternalLink } from 'lucide-react';
import { supabase, database } from '../../utils/supabase';
import { useNavigate } from 'react-router-dom';

interface TATAlertOrder {
  order_id: string;
  order_number: number | null;
  sample_id: string | null;
  patient_name: string;
  test_group_name: string;
  hours_until_tat_breach: number;
  is_tat_breached: boolean;
  tat_hours: number;
  sample_received_at: string | null;
}

interface TATFloaterProps {
  className?: string;
}

export const TATFloater: React.FC<TATFloaterProps> = ({ className = '' }) => {
  const [alerts, setAlerts] = useState<TATAlertOrder[]>([]);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isDismissed, setIsDismissed] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchTATAlerts();
    
    // Refresh every 2 minutes
    const interval = setInterval(fetchTATAlerts, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const fetchTATAlerts = async () => {
    try {
      const lab_id = await database.getCurrentUserLabId();
      if (!lab_id) return;

      // Query orders with TAT breach or approaching breach (< 2 hours)
      const { data, error } = await supabase
        .from('v_order_test_progress_enhanced')
        .select(`
          order_id,
          order_number,
          sample_id,
          patient_name,
          test_group_name,
          hours_until_tat_breach,
          is_tat_breached,
          tat_hours,
          sample_received_at
        `)
        .eq('lab_id', lab_id)
        .in('order_status', ['Order Created', 'Sample Collection', 'In Progress', 'Pending Approval'])
        .or('is_tat_breached.eq.true,hours_until_tat_breach.lt.2')
        .not('hours_until_tat_breach', 'is', null)
        .order('hours_until_tat_breach', { ascending: true })
        .limit(10);

      if (error) {
        console.error('Error fetching TAT alerts:', error);
        return;
      }

      const formatted: TATAlertOrder[] = (data || []).map((row: any) => ({
        order_id: row.order_id,
        order_number: typeof row.order_number === 'number' ? row.order_number : null,
        sample_id: row.sample_id || null,
        patient_name: row.patient_name || 'Unknown',
        test_group_name: row.test_group_name || 'Unknown Test',
        hours_until_tat_breach: row.hours_until_tat_breach,
        is_tat_breached: row.is_tat_breached,
        tat_hours: row.tat_hours,
        sample_received_at: row.sample_received_at,
      }));

      setAlerts(formatted);
    } catch (err) {
      console.error('TAT alerts fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (hours: number): string => {
    if (hours < 0) return `${Math.abs(Math.round(hours * 10) / 10)}h overdue`;
    if (hours < 1) return `${Math.round(hours * 60)}m left`;
    return `${Math.round(hours * 10) / 10}h left`;
  };

  const getOrderLabel = (alert: TATAlertOrder): string => {
    if (typeof alert.order_number === 'number' && Number.isFinite(alert.order_number)) {
      return String(alert.order_number);
    }

    const sampleTail = alert.sample_id?.match(/(?:^|[/-])(\d+)\s*$/)?.[1];
    return sampleTail || alert.sample_id || alert.order_id.slice(0, 8);
  };

  const handleOrderClick = (orderId: string) => {
    navigate(`/orders/${orderId}`);
  };

  // Don't show if dismissed or no alerts
  if (isDismissed || (!loading && alerts.length === 0)) {
    return null;
  }

  const breachedCount = alerts.filter(a => a.is_tat_breached).length;
  const warningCount = alerts.filter(a => !a.is_tat_breached).length;

  return (
    <div 
      className={`fixed bottom-4 right-4 z-50 w-80 shadow-2xl rounded-lg overflow-hidden border ${
        breachedCount > 0 ? 'border-red-300 bg-red-50' : 'border-orange-300 bg-orange-50'
      } ${className}`}
    >
      {/* Header */}
      <div 
        className={`px-3 py-2 flex items-center justify-between cursor-pointer ${
          breachedCount > 0 ? 'bg-red-500 text-white' : 'bg-orange-500 text-white'
        }`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 animate-pulse" />
          <span className="font-semibold text-sm">TAT Alerts</span>
          <span className="text-xs opacity-90">
            ({breachedCount > 0 ? `${breachedCount} breached` : `${warningCount} warning`})
          </span>
        </div>
        <div className="flex items-center gap-1">
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          <button 
            onClick={(e) => { e.stopPropagation(); setIsDismissed(true); }}
            className="p-0.5 hover:bg-white/20 rounded"
            title="Dismiss"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="max-h-64 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              Loading TAT alerts...
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {alerts.map((alert, idx) => (
                <div 
                  key={`${alert.order_id}-${alert.test_group_name}-${idx}`}
                  className={`p-2 hover:bg-white/50 cursor-pointer transition-colors ${
                    alert.is_tat_breached ? 'bg-red-100/50' : 'bg-orange-100/50'
                  }`}
                  onClick={() => handleOrderClick(alert.order_id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-sm text-gray-900 truncate">
                          #{getOrderLabel(alert)}
                        </span>
                        <span className="text-xs text-gray-500 truncate">
                          {alert.patient_name}
                        </span>
                      </div>
                      <div className="text-xs text-gray-600 truncate mt-0.5">
                        {alert.test_group_name}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={`text-xs font-semibold whitespace-nowrap px-1.5 py-0.5 rounded ${
                        alert.is_tat_breached 
                          ? 'bg-red-500 text-white' 
                          : 'bg-yellow-400 text-yellow-900'
                      }`}>
                        <Clock className="w-3 h-3 inline mr-0.5" />
                        {formatTime(alert.hours_until_tat_breach)}
                      </span>
                      <ExternalLink className="w-3 h-3 text-gray-400" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      {isExpanded && alerts.length > 0 && (
        <div className="px-3 py-1.5 bg-gray-100 border-t text-xs text-gray-500 text-center">
          Click order to view details • Auto-refreshes every 2 min
        </div>
      )}
    </div>
  );
};

export default TATFloater;
