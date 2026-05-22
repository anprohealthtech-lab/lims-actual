import React, { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';

export interface RealtimeOrderUpdate {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  order: any;
  oldOrder?: any;
}

interface UseRealtimeOrdersOptions {
  labId?: string;
  onInsert?: (order: any) => void;
  onUpdate?: (order: any, oldOrder: any) => void;
  onDelete?: (orderId: string) => void;
  enabled?: boolean;
}

/**
 * Hook to subscribe to real-time order changes from Supabase
 * 
 * @example
 * ```tsx
 * const { isConnected, lastUpdate } = useRealtimeOrders({
 *   labId: userLabId,
 *   onInsert: (order) => {
 *     setOrders(prev => [order, ...prev]);
 *     showNotification('New order created!');
 *   },
 *   onUpdate: (order) => {
 *     setOrders(prev => prev.map(o => o.id === order.id ? order : o));
 *   }
 * });
 * ```
 */
export function useRealtimeOrders(options: UseRealtimeOrdersOptions = {}) {
  const { labId, onInsert, onUpdate, onDelete, enabled = true } = options;
  
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<RealtimeOrderUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Use refs for callbacks to avoid re-subscriptions when callbacks change
  const onInsertRef = React.useRef(onInsert);
  const onUpdateRef = React.useRef(onUpdate);
  const onDeleteRef = React.useRef(onDelete);

  // Update refs when callbacks change
  useEffect(() => {
    onInsertRef.current = onInsert;
    onUpdateRef.current = onUpdate;
    onDeleteRef.current = onDelete;
  }, [onInsert, onUpdate, onDelete]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Build filter based on lab_id
    const filter = labId ? `lab_id=eq.${labId}` : undefined;
    
    const channel = supabase
      .channel('orders-realtime')
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to all events (INSERT, UPDATE, DELETE)
          schema: 'public',
          table: 'orders',
          ...(filter && { filter })
        },
        (payload: any) => {
          const update: RealtimeOrderUpdate = {
            type: payload.eventType,
            order: payload.new,
            oldOrder: payload.old
          };
          
          setLastUpdate(update);
          
          // Call event-specific handlers
          switch (payload.eventType) {
            case 'INSERT':
              if (onInsertRef.current) onInsertRef.current(payload.new);
              break;
              
            case 'UPDATE':
              if (onUpdateRef.current) onUpdateRef.current(payload.new, payload.old);
              break;
              
            case 'DELETE':
              if (onDeleteRef.current) onDeleteRef.current(payload.old.id);
              break;
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsConnected(true);
          setError(null);
        } else if (status === 'CHANNEL_ERROR') {
          setIsConnected(false);
          setError('Failed to connect to realtime channel');
          console.error('❌ Failed to subscribe to order changes');
        } else if (status === 'TIMED_OUT') {
          setIsConnected(false);
          setError('Connection timed out');
          console.warn('⏱️ Subscription timed out');
        }
      });

    // Cleanup on unmount
    return () => {
      channel.unsubscribe();
      setIsConnected(false);
    };
  }, [labId, enabled]);

  return {
    isConnected,
    lastUpdate,
    error
  };
}
