'use client'

import { useState, useCallback, useEffect } from 'react'
import { nanoid } from 'nanoid'
import { createClient } from '@/lib/supabase/client'

type OutgoingCallState = {
  invitationId: string
  roomSlug: string
  calleeName: string
  status: 'ringing' | 'accepted' | 'declined' | 'missed' | 'cancelled'
}

export function useInitiateCall(callerId: string | null) {
  const [outgoingCall, setOutgoingCall] = useState<OutgoingCallState | null>(null)
  const supabase = createClient()

  // Listen for callee's response
  useEffect(() => {
    if (!outgoingCall || !callerId) return

    const channel = supabase
      .channel('outgoing-call-status')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'call_invitations',
          filter: `caller_id=eq.${callerId}`,
        },
        (payload) => {
          const updated = payload.new as { id: string; status: string }
          if (updated.id !== outgoingCall.invitationId) return
          setOutgoingCall((prev) =>
            prev ? { ...prev, status: updated.status as OutgoingCallState['status'] } : null
          )
        }
      )
      .subscribe()

    // Auto-timeout after 30 seconds
    const timeout = setTimeout(async () => {
      if (outgoingCall.status === 'ringing') {
        await supabase
          .from('call_invitations')
          .update({ status: 'missed' })
          .eq('id', outgoingCall.invitationId)
          .eq('status', 'ringing')
        setOutgoingCall(null)
      }
    }, 30_000)

    return () => {
      supabase.removeChannel(channel)
      clearTimeout(timeout)
    }
  }, [outgoingCall, callerId, supabase])

  const initiateCall = useCallback(async (calleeId: string, calleeName: string, callerName: string) => {
    if (!callerId) return
    const roomSlug = nanoid(10)

    const { data, error } = await supabase
      .from('call_invitations')
      .insert({
        caller_id: callerId,
        callee_id: calleeId,
        room_slug: roomSlug,
        status: 'ringing',
      })
      .select('id')
      .single()

    if (error || !data) return

    setOutgoingCall({
      invitationId: data.id,
      roomSlug,
      calleeName,
      status: 'ringing',
    })

    // Send push notification to callee (fire-and-forget)
    fetch('/api/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callerName,
        callInvitationId: data.id,
      }),
    }).catch(() => {}) // Ignore push errors — in-app Realtime is the primary channel
  }, [callerId, supabase])

  const cancelCall = useCallback(async () => {
    if (!outgoingCall) return
    await supabase
      .from('call_invitations')
      .update({ status: 'cancelled' })
      .eq('id', outgoingCall.invitationId)
    setOutgoingCall(null)
  }, [outgoingCall, supabase])

  const clearOutgoingCall = useCallback(() => {
    setOutgoingCall(null)
  }, [])

  return { outgoingCall, initiateCall, cancelCall, clearOutgoingCall }
}
