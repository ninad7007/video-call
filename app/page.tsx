'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { nanoid } from 'nanoid'
import { createClient } from '@/lib/supabase/client'
import { useIncomingCalls } from '@/lib/hooks/useCallInvitations'
import { useInitiateCall } from '@/lib/hooks/useInitiateCall'
import { playRingback, playRingtone } from '@/lib/ringtone'
import { registerServiceWorker, subscribeToPush } from '@/lib/push'

type Profile = {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
}

type Contact = {
  id: string
  requester_id: string
  addressee_id: string
  status: string
  profile: Profile
}

export default function HomePage() {
  const router = useRouter()
  const supabase = createClient()

  const [user, setUser] = useState<Profile | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [pendingReceived, setPendingReceived] = useState<Contact[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResult, setSearchResult] = useState<Profile | null>(null)
  const [searchError, setSearchError] = useState('')
  const [loading, setLoading] = useState(true)

  const { incomingCall, acceptCall, declineCall } = useIncomingCalls(user?.id ?? null)
  const { outgoingCall, initiateCall, cancelCall, clearOutgoingCall } = useInitiateCall(user?.id ?? null)

  // Play ringback tone while outgoing call is ringing
  const stopRingbackRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (outgoingCall?.status === 'ringing') {
      stopRingbackRef.current = playRingback()
    } else {
      stopRingbackRef.current?.()
      stopRingbackRef.current = null
    }
    return () => {
      stopRingbackRef.current?.()
      stopRingbackRef.current = null
    }
  }, [outgoingCall?.status])

  // Play ringtone when receiving an incoming call
  const stopRingtoneRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (incomingCall) {
      stopRingtoneRef.current = playRingtone()
    } else {
      stopRingtoneRef.current?.()
      stopRingtoneRef.current = null
    }
    return () => {
      stopRingtoneRef.current?.()
      stopRingtoneRef.current = null
    }
  }, [incomingCall])

  // Navigate to room when outgoing call is accepted
  useEffect(() => {
    if (outgoingCall?.status === 'accepted') {
      const roomSlug = outgoingCall.roomSlug
      clearOutgoingCall()
      router.push(`/room/${roomSlug}?autoJoin=true`)
    }
  }, [outgoingCall, router, clearOutgoingCall])

  const handleAcceptCall = async () => {
    const roomSlug = await acceptCall()
    if (roomSlug) router.push(`/room/${roomSlug}?autoJoin=true`)
  }

  // Register Service Worker and subscribe to push notifications
  useEffect(() => {
    if (!user) return
    registerServiceWorker().then((reg) => {
      if (reg) subscribeToPush(reg)
    })
  }, [user])

  const loadData = useCallback(async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { router.push('/login'); return }

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .single()
    if (profile) setUser(profile)

    // Get accepted contacts
    const { data: myContacts } = await supabase
      .from('contacts')
      .select('*')
      .or(`requester_id.eq.${authUser.id},addressee_id.eq.${authUser.id}`)
      .eq('status', 'accepted')

    if (myContacts) {
      const enriched = await Promise.all(
        myContacts.map(async (c) => {
          const otherId = c.requester_id === authUser.id ? c.addressee_id : c.requester_id
          const { data: p } = await supabase.from('profiles').select('*').eq('id', otherId).single()
          return { ...c, profile: p! }
        })
      )
      setContacts(enriched.filter(c => c.profile))
    }

    // Get pending requests where I'm the addressee
    const { data: pending } = await supabase
      .from('contacts')
      .select('*')
      .eq('addressee_id', authUser.id)
      .eq('status', 'pending')

    if (pending) {
      const enriched = await Promise.all(
        pending.map(async (c) => {
          const { data: p } = await supabase.from('profiles').select('*').eq('id', c.requester_id).single()
          return { ...c, profile: p! }
        })
      )
      setPendingReceived(enriched.filter(c => c.profile))
    }

    setLoading(false)
  }, [supabase, router])

  useEffect(() => { loadData() }, [loadData])

  const handleSearch = async () => {
    setSearchError('')
    setSearchResult(null)
    const q = searchQuery.trim().toLowerCase()
    if (!q) return

    if (q === user?.username) {
      setSearchError("That's you!")
      return
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('username', q)
      .single()

    if (error || !data) {
      setSearchError('User not found')
      return
    }

    setSearchResult(data)
  }

  const handleAddContact = async (targetId: string) => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) return

    const { error } = await supabase.from('contacts').insert({
      requester_id: authUser.id,
      addressee_id: targetId,
    })

    if (error) {
      if (error.code === '23505') setSearchError('Already in your contacts')
      else setSearchError(error.message)
      return
    }

    setSearchResult(null)
    setSearchQuery('')
    loadData()
  }

  const handleAccept = async (contactId: string) => {
    await supabase.from('contacts').update({ status: 'accepted' }).eq('id', contactId)
    loadData()
  }

  const handleDecline = async (contactId: string) => {
    await supabase.from('contacts').delete().eq('id', contactId)
    loadData()
  }

  const handleCall = (contactProfile: Profile) => {
    initiateCall(contactProfile.id, contactProfile.username, user?.username || 'Someone')
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100dvh', background: 'var(--bg-primary)' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>
      </div>
    )
  }

  const cardStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px', borderRadius: 'var(--radius-md)',
    background: 'var(--bg-elevated)', marginBottom: '8px',
  }
  const btnStyle: React.CSSProperties = {
    padding: '8px 16px', borderRadius: 'var(--radius-pill)',
    border: 'none', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer',
  }

  return (
    <div style={{
      maxWidth: '480px', margin: '0 auto', padding: '24px',
      height: '100dvh', overflowY: 'auto', background: 'var(--bg-primary)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 600, color: 'var(--accent)', margin: 0 }}>Connekt</h1>
          <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.875rem' }}>@{user?.username}</p>
        </div>
        <button onClick={handleSignOut} style={{ ...btnStyle, background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>
          Sign out
        </button>
      </div>

      {/* Quick room */}
      <button
        onClick={() => router.push(`/room/${nanoid(10)}`)}
        style={{
          width: '100%', padding: '14px', marginBottom: '32px',
          borderRadius: 'var(--radius-md)', border: '1px dashed var(--border-subtle)',
          background: 'transparent', color: 'var(--text-secondary)',
          fontSize: '0.875rem', cursor: 'pointer',
        }}
      >
        + Start a room with a link (no contact needed)
      </button>

      {/* Pending requests */}
      {pendingReceived.length > 0 && (
        <section style={{ marginBottom: '32px' }}>
          <h2 style={{ fontSize: '0.875rem', color: 'var(--text-muted)', fontWeight: 500, marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Pending Requests ({pendingReceived.length})
          </h2>
          {pendingReceived.map((c) => (
            <div key={c.id} style={cardStyle}>
              <span style={{ color: 'var(--text-primary)' }}>@{c.profile.username}</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => handleAccept(c.id)} style={{ ...btnStyle, background: 'var(--accent)', color: '#111' }}>Accept</button>
                <button onClick={() => handleDecline(c.id)} style={{ ...btnStyle, background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>Decline</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Contacts */}
      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '0.875rem', color: 'var(--text-muted)', fontWeight: 500, marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Contacts ({contacts.length})
        </h2>
        {contacts.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No contacts yet. Add someone below.</p>
        ) : (
          contacts.map((c) => (
            <div key={c.id} style={cardStyle}>
              <span style={{ color: 'var(--text-primary)' }}>@{c.profile.username}</span>
              <button onClick={() => handleCall(c.profile)} style={{ ...btnStyle, background: 'var(--accent)', color: '#111' }}>
                Call
              </button>
            </div>
          ))
        )}
      </section>

      {/* Add contact */}
      <section>
        <h2 style={{ fontSize: '0.875rem', color: 'var(--text-muted)', fontWeight: 500, marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Add Contact
        </h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value.toLowerCase())}
            placeholder="Enter username"
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            style={{
              flex: 1, padding: '12px 16px', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)',
              color: 'var(--text-primary)', fontSize: '0.875rem', outline: 'none',
            }}
          />
          <button onClick={handleSearch} style={{ ...btnStyle, background: 'var(--accent)', color: '#111' }}>
            Search
          </button>
        </div>
        {searchError && <p style={{ color: '#ef4444', fontSize: '0.875rem', marginTop: '8px' }}>{searchError}</p>}
        {searchResult && (
          <div style={{ ...cardStyle, marginTop: '12px' }}>
            <span style={{ color: 'var(--text-primary)' }}>@{searchResult.username}</span>
            <button onClick={() => handleAddContact(searchResult.id)} style={{ ...btnStyle, background: 'var(--accent)', color: '#111' }}>
              Add
            </button>
          </div>
        )}
      </section>

      {/* Incoming call overlay */}
      {incomingCall && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(20px)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: '24px',
        }}>
          <div style={{
            width: '80px', height: '80px', borderRadius: '50%',
            background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '2rem', color: '#111', fontWeight: 700,
          }}>
            {(incomingCall.caller_profile?.username?.[0] || '?').toUpperCase()}
          </div>
          <p style={{ color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
            @{incomingCall.caller_profile?.username || 'Unknown'}
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', margin: 0 }}>Incoming call...</p>
          <div style={{ display: 'flex', gap: '24px', marginTop: '16px' }}>
            <button onClick={declineCall} style={{
              width: '64px', height: '64px', borderRadius: '50%',
              background: '#ef4444', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
              </svg>
            </button>
            <button onClick={handleAcceptCall} style={{
              width: '64px', height: '64px', borderRadius: '50%',
              background: '#22c55e', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Outgoing call overlay */}
      {outgoingCall && outgoingCall.status === 'ringing' && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(20px)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: '24px',
        }}>
          <div style={{
            width: '80px', height: '80px', borderRadius: '50%',
            background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '2rem', color: 'var(--text-primary)', fontWeight: 700,
          }}>
            {outgoingCall.calleeName[0]?.toUpperCase() || '?'}
          </div>
          <p style={{ color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
            @{outgoingCall.calleeName}
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', margin: 0 }}>Calling...</p>
          <button onClick={cancelCall} style={{
            width: '64px', height: '64px', borderRadius: '50%', marginTop: '16px',
            background: '#ef4444', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
            </svg>
          </button>
        </div>
      )}

      {/* Outgoing call declined */}
      {outgoingCall && outgoingCall.status === 'declined' && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(20px)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: '16px',
        }}>
          <p style={{ color: 'var(--text-primary)', fontSize: '1.25rem', margin: 0 }}>Call declined</p>
          <button onClick={clearOutgoingCall} style={{
            padding: '12px 32px', borderRadius: 'var(--radius-pill)',
            background: 'var(--bg-surface)', border: 'none',
            color: 'var(--text-primary)', cursor: 'pointer',
          }}>
            OK
          </button>
        </div>
      )}
    </div>
  )
}
