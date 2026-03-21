import { useEffect, useState } from 'react'
import { supabase } from '../utils/supabase'

export interface AnalyzerActivity {
  orderId: string
  count: number
  latestStatus: string
  receivedAt: string
  isNew: boolean // true if received within last 2 minutes
}

const TWO_MINUTES_MS = 2 * 60 * 1000

function wasRecentlyReceived(receivedAt: string): boolean {
  return Date.now() - new Date(receivedAt).getTime() < TWO_MINUTES_MS
}

/**
 * Subscribes to analyzer_raw_messages for the lab and returns a Map
 * of order_id → AnalyzerActivity. isNew pulses for 2 minutes after receipt.
 */
export function useAnalyzerRealtime(labId: string | null): Map<string, AnalyzerActivity> {
  const [activityMap, setActivityMap] = useState<Map<string, AnalyzerActivity>>(new Map())

  // Initial fetch: last 24 hours of completed messages with a linked order
  useEffect(() => {
    if (!labId) return
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    supabase
      .from('analyzer_raw_messages')
      .select('order_id, ai_status, created_at')
      .eq('lab_id', labId)
      .eq('direction', 'INBOUND')
      .not('order_id', 'is', null)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!data) return
        const map = new Map<string, AnalyzerActivity>()
        for (const msg of data) {
          if (!msg.order_id) continue
          const existing = map.get(msg.order_id)
          map.set(msg.order_id, {
            orderId: msg.order_id,
            count: (existing?.count ?? 0) + 1,
            latestStatus: msg.ai_status,
            receivedAt: msg.created_at,
            isNew: wasRecentlyReceived(msg.created_at),
          })
        }
        setActivityMap(map)
      })
  }, [labId])

  // Realtime: listen for UPDATEs where order_id is now set (processing completed)
  useEffect(() => {
    if (!labId) return

    const channel = supabase
      .channel(`analyzer-realtime-${labId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'analyzer_raw_messages',
          filter: `lab_id=eq.${labId}`,
        },
        (payload) => {
          const msg = payload.new as {
            order_id: string | null
            ai_status: string
            created_at: string
          }
          if (!msg.order_id || msg.ai_status !== 'completed') return

          setActivityMap((prev) => {
            const next = new Map(prev)
            const existing = next.get(msg.order_id!)
            next.set(msg.order_id!, {
              orderId: msg.order_id!,
              count: (existing?.count ?? 0) + 1,
              latestStatus: msg.ai_status,
              receivedAt: msg.created_at,
              isNew: true,
            })
            return next
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [labId])

  // Clear isNew flag after 2 minutes
  useEffect(() => {
    const timer = setInterval(() => {
      setActivityMap((prev) => {
        let changed = false
        const next = new Map(prev)
        for (const [key, val] of next) {
          if (val.isNew && !wasRecentlyReceived(val.receivedAt)) {
            next.set(key, { ...val, isNew: false })
            changed = true
          }
        }
        return changed ? next : prev
      })
    }, 30_000)
    return () => clearInterval(timer)
  }, [])

  return activityMap
}
