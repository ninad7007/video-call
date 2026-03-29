'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

export type CallInvitation = {
  id: string
  caller_id: string
  callee_id: string
  room_slug: string
  status: string
  created_at: string
  caller_profile?: { username: string; display_name: string }
}

export function useIncomingCalls(userId: string | null) {
  const [incomingCall, setIncomingCall] = useState<CallInvitation | null>(null)
  const supabase = createClient()

  useEffect(() => {
    if (!userId) return

    const channel = supabase
      .channel('incoming-calls')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'call_invitations',
          filter: `callee_id=eq.${userId}`,
        },
        async (payload) => {
          const invitation = payload.new as CallInvitation

          const { data: callerProfile } = await supabase
            .from('profiles')
            .select('username, display_name')
            .eq('id', invitation.caller_id)
            .single()

          setIncomingCall({
            ...invitation,
            caller_profile: callerProfile || undefined,
          })
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'call_invitations',
          filter: `callee_id=eq.${userId}`,
        },
        (payload) => {
          const updated = payload.new as CallInvitation
          if (updated.status === 'cancelled' || updated.status === 'missed') {
            setIncomingCall((prev) => prev?.id === updated.id ? null : prev)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, supabase])

  const acceptCall = useCallback(async () => {
    if (!incomingCall) return null
    await supabase
      .from('call_invitations')
      .update({ status: 'accepted' })
      .eq('id', incomingCall.id)
    const roomSlug = incomingCall.room_slug
    setIncomingCall(null)
    return roomSlug
  }, [incomingCall, supabase])

  const declineCall = useCallback(async () => {
    if (!incomingCall) return
    await supabase
      .from('call_invitations')
      .update({ status: 'declined' })
      .eq('id', incomingCall.id)
    setIncomingCall(null)
  }, [incomingCall, supabase])

  return { incomingCall, acceptCall, declineCall }
}
