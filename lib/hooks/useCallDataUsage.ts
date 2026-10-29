'use client'

import { useEffect, useRef } from 'react'
import type { Room } from 'livekit-client'
import { createClient } from '@/lib/supabase/client'

const POLL_MS = 5000

type Bytes = { sent: number; received: number }

// Candidate-pair counters include every track plus RTCP and SRTP overhead
// (but not IP/UDP/TURN headers), summed across both peer connections.
async function readBytes(room: Room): Promise<Bytes> {
  const totals = { sent: 0, received: 0 }
  const pcm = room.engine?.pcManager
  for (const pc of [pcm?.publisher, pcm?.subscriber]) {
    if (!pc) continue
    const report = await pc.getStats()
    report.forEach((s) => {
      if (s.type === 'candidate-pair') {
        totals.sent += s.bytesSent ?? 0
        totals.received += s.bytesReceived ?? 0
      }
    })
  }
  return totals
}

// Writes one room.data_usage row to app_events per call (same shape as the
// mobile logger). The peer connections are closed by the time the room
// unmounts, so this reports the last poll (up to POLL_MS stale).
export function useCallDataUsage(room: Room, isHD: boolean) {
  const isHDRef = useRef(isHD)
  useEffect(() => {
    isHDRef.current = isHD
  }, [isHD])

  useEffect(() => {
    const startedAt = Date.now()
    // A full reconnect replaces the peer connections and their counters
    // start over, so bank what the old ones had reached.
    let banked: Bytes = { sent: 0, received: 0 }
    let last: Bytes = { sent: 0, received: 0 }
    const timer = setInterval(() => {
      readBytes(room)
        .then((cur) => {
          if (cur.sent < last.sent || cur.received < last.received) {
            banked = { sent: banked.sent + last.sent, received: banked.received + last.received }
          }
          last = cur
        })
        .catch(() => {})
    }, POLL_MS)

    return () => {
      clearInterval(timer)
      const bytesSent = banked.sent + last.sent
      const bytesReceived = banked.received + last.received
      if (bytesSent + bytesReceived === 0) return
      const payload = {
        room: room.name,
        durationSec: Math.round((Date.now() - startedAt) / 1000),
        bytesSent,
        bytesReceived,
        quality: isHDRef.current ? 'hd' : 'sd',
      }
      const supabase = createClient()
      void supabase.auth.getSession().then(({ data }) =>
        supabase.from('app_events').insert({
          user_id: data.session?.user.id ?? null,
          event: 'room.data_usage',
          level: 'info',
          payload,
          client_ts: new Date().toISOString(),
          platform: 'web',
        }),
      )
    }
  }, [room])
}
