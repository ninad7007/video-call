'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function OnboardingPage() {
  const router = useRouter()
  const supabase = createClient()
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const trimmed = username.trim().toLowerCase()

    if (!/^[a-z0-9_]{3,20}$/.test(trimmed)) {
      setError('3-20 characters, lowercase letters, numbers, underscores only')
      setLoading(false)
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('Not authenticated')
      setLoading(false)
      return
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ username: trimmed, display_name: trimmed })
      .eq('id', user.id)

    if (updateError) {
      if (updateError.code === '23505') {
        setError('Username already taken')
      } else {
        setError(updateError.message)
      }
      setLoading(false)
      return
    }

    router.push('/')
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100dvh',
      background: 'var(--bg-primary)',
      padding: '24px',
    }}>
      <h1 style={{
        fontSize: '1.75rem',
        fontWeight: 600,
        color: 'var(--text-primary)',
        marginBottom: '8px',
      }}>
        Choose a username
      </h1>
      <p style={{
        color: 'var(--text-secondary)',
        marginBottom: '32px',
        textAlign: 'center',
      }}>
        Your friends will use this to find and call you
      </p>

      <form onSubmit={handleSubmit} style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        width: '100%',
        maxWidth: '320px',
      }}>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          placeholder="e.g. ninad"
          autoFocus
          style={{
            padding: '14px 16px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            fontSize: '1rem',
            outline: 'none',
          }}
        />
        {error && (
          <p style={{ color: '#ef4444', fontSize: '0.875rem', margin: 0 }}>{error}</p>
        )}
        <button
          type="submit"
          disabled={loading || username.trim().length < 3}
          style={{
            padding: '14px',
            borderRadius: 'var(--radius-pill)',
            border: 'none',
            background: 'var(--accent)',
            color: '#111',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: 'pointer',
            opacity: (loading || username.trim().length < 3) ? 0.5 : 1,
          }}
        >
          {loading ? 'Saving...' : 'Continue'}
        </button>
      </form>
    </div>
  )
}
