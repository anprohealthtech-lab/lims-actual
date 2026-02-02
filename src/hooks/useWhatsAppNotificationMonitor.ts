// src/hooks/useWhatsAppNotificationMonitor.ts
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../utils/supabase';

export interface FailedNotification {
  id: string;
  recipient_name?: string;
  recipient_phone: string;
  recipient_type: 'patient' | 'doctor';
  trigger_type: string;
  last_error?: string;
  retry_count: number;
  attachment_url?: string;
  message_content?: string;
  created_at: string;
  order_id?: string;
  report_id?: string;
}

interface UseWhatsAppNotificationMonitorOptions {
  labId?: string;
  onFailedNotification?: (notification: FailedNotification) => void;
  onRetrySuccess?: (notificationId: string) => void;
  enabled?: boolean;
}

export function useWhatsAppNotificationMonitor(options: UseWhatsAppNotificationMonitorOptions = {}) {
  const { labId, onFailedNotification, onRetrySuccess, enabled = true } = options;
  
  const [failedNotifications, setFailedNotifications] = useState<FailedNotification[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  // Fetch initial failed notifications
  const fetchFailedNotifications = useCallback(async () => {
    if (!labId || !enabled) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('notification_queue')
        .select('*')
        .eq('lab_id', labId)
        .eq('status', 'failed')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Error fetching failed notifications:', error);
        return;
      }

      setFailedNotifications(data || []);
    } catch (err) {
      console.error('Error in fetchFailedNotifications:', err);
    } finally {
      setLoading(false);
    }
  }, [labId, enabled]);

  // Setup realtime subscription
  useEffect(() => {
    if (!enabled || !labId) {
      console.log('📡 WhatsApp Monitor: Disabled or no labId');
      return;
    }

    console.log('📡 Setting up WhatsApp notification monitor...', { labId });

    // Initial fetch
    fetchFailedNotifications();

    // Subscribe to notification_queue changes
    const channel = supabase
      .channel(`notification-queue-${labId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notification_queue',
          filter: `lab_id=eq.${labId}`
        },
        (payload) => {
          console.log('📲 Notification queue change:', payload);

          const { eventType, new: newRecord, old: oldRecord } = payload as {
            eventType: 'INSERT' | 'UPDATE' | 'DELETE';
            new: FailedNotification;
            old: FailedNotification;
          };

          if (eventType === 'INSERT' || eventType === 'UPDATE') {
            // Check if notification just failed
            if (newRecord.status === 'failed') {
              // Add or update in failed list
              setFailedNotifications(prev => {
                const exists = prev.find(n => n.id === newRecord.id);
                if (exists) {
                  // Update existing
                  return prev.map(n => n.id === newRecord.id ? newRecord : n);
                } else {
                  // Add new failed notification
                  onFailedNotification?.(newRecord);
                  return [newRecord, ...prev];
                }
              });
            } else if (newRecord.status === 'sent' && oldRecord?.status === 'failed') {
              // Notification was retried successfully
              setFailedNotifications(prev => prev.filter(n => n.id !== newRecord.id));
              onRetrySuccess?.(newRecord.id);
            } else if (newRecord.status === 'pending') {
              // Moved to pending (retry queued) - remove from failed list
              setFailedNotifications(prev => prev.filter(n => n.id !== newRecord.id));
            }
          } else if (eventType === 'DELETE') {
            // Notification deleted
            setFailedNotifications(prev => prev.filter(n => n.id !== oldRecord.id));
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('✅ WhatsApp notification monitor subscribed');
          setIsConnected(true);
        } else if (status === 'CHANNEL_ERROR') {
          console.error('❌ WhatsApp notification monitor error');
          setIsConnected(false);
        } else if (status === 'CLOSED') {
          console.log('🔌 WhatsApp notification monitor closed');
          setIsConnected(false);
        }
      });

    // Cleanup on unmount
    return () => {
      console.log('🔌 Cleaning up WhatsApp notification monitor');
      supabase.removeChannel(channel);
      setIsConnected(false);
    };
  }, [labId, enabled, onFailedNotification, onRetrySuccess, fetchFailedNotifications]);

  // Retry a failed notification
  const retryNotification = useCallback(async (notificationId: string) => {
    try {
      // Update status to pending to trigger retry
      const { error } = await supabase
        .from('notification_queue')
        .update({
          status: 'pending',
          scheduled_for: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', notificationId);

      if (error) {
        console.error('Error retrying notification:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err) {
      console.error('Error in retryNotification:', err);
      return { success: false, error: String(err) };
    }
  }, []);

  // Retry all failed notifications
  const retryAllFailed = useCallback(async () => {
    if (!labId) return { success: false, error: 'No lab ID' };

    try {
      const { error } = await supabase
        .from('notification_queue')
        .update({
          status: 'pending',
          scheduled_for: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('lab_id', labId)
        .eq('status', 'failed');

      if (error) {
        console.error('Error retrying all notifications:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err) {
      console.error('Error in retryAllFailed:', err);
      return { success: false, error: String(err) };
    }
  }, [labId]);

  // Delete a failed notification
  const deleteNotification = useCallback(async (notificationId: string) => {
    try {
      const { error } = await supabase
        .from('notification_queue')
        .delete()
        .eq('id', notificationId);

      if (error) {
        console.error('Error deleting notification:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err) {
      console.error('Error in deleteNotification:', err);
      return { success: false, error: String(err) };
    }
  }, []);

  return {
    failedNotifications,
    failedCount: failedNotifications.length,
    isConnected,
    loading,
    retryNotification,
    retryAllFailed,
    deleteNotification,
    refreshFailed: fetchFailedNotifications
  };
}
