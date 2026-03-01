'use client';

import { useRouter } from 'next/navigation';
import { nanoid } from 'nanoid';

export default function Home() {
  const router = useRouter();

  function startCall() {
    const slug = nanoid(10);
    router.push(`/room/${slug}`);
  }

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1.5rem',
        padding: '1.5rem',
      }}
    >
      <h1
        style={{
          fontSize: 'clamp(2rem, 5vw, 3rem)',
          fontWeight: 500,
          color: 'var(--text-primary)',
          letterSpacing: '-0.02em',
        }}
      >
        Connekt
      </h1>
      <p
        style={{
          color: 'var(--text-secondary)',
          fontSize: '1rem',
          textAlign: 'center',
          maxWidth: '24rem',
        }}
      >
        Lightweight, low-bandwidth 1-on-1 video calls
      </p>
      <button
        onClick={startCall}
        style={{
          background: 'var(--accent)',
          color: '#111',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          padding: '14px 32px',
          fontSize: '1rem',
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'var(--transition)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--accent-hover)';
          e.currentTarget.style.transform = 'scale(1.02)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--accent)';
          e.currentTarget.style.transform = 'scale(1)';
        }}
      >
        Start Call
      </button>
    </main>
  );
}
