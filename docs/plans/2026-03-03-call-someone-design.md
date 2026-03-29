# "Call Someone" Feature — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add contacts + ring functionality so users can sign in, manage contacts, and initiate calls that ring the other person's device — even when the browser tab is closed.

**Architecture:** Phone number + SMS OTP via Supabase Auth for identity. Postgres tables for profiles, contacts, call invitations, and push subscriptions. Supabase Realtime (Postgres Changes) for in-app call signaling. Web Push API + Service Worker for background notifications.

**Tech Stack:** `@supabase/supabase-js`, `@supabase/ssr`, Supabase Auth (Phone OTP via Twilio), Supabase Realtime, Web Push API, `web-push` (npm), Next.js middleware

**Supabase Project:** `wzpkqhhjvtztvcupwoqe` (ap-northeast-2)
**Supabase URL:** `https://wzpkqhhjvtztvcupwoqe.supabase.co`

---

## Database Schema Overview

```
profiles (extends auth.users)
├── id (uuid, FK → auth.users)
├── username (text, unique, lowercase)
├── display_name (text)
├── phone (text, from auth.users — used for contact discovery)
├── avatar_url (text, nullable)
└── created_at, updated_at

contacts
├── id (uuid)
├── requester_id (uuid, FK → profiles)
├── addressee_id (uuid, FK → profiles)
├── status ('pending' | 'accepted' | 'blocked')
└── created_at

call_invitations
├── id (uuid)
├── caller_id (uuid, FK → profiles)
├── callee_id (uuid, FK → profiles)
├── room_slug (text)
├── status ('ringing' | 'accepted' | 'declined' | 'missed' | 'cancelled')
└── created_at, updated_at

push_subscriptions
├── id (uuid)
├── user_id (uuid, FK → profiles)
├── endpoint (text)
├── p256dh (text)
├── auth_key (text)
└── created_at
```

---

## Phase 1: Auth + Profiles + Contacts

### Task 1: Install Supabase dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install packages**

```bash
npm install @supabase/supabase-js @supabase/ssr
```

**Step 2: Add env vars to `.env.local`**

Append to existing `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://wzpkqhhjvtztvcupwoqe.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6cGtxaGhqdnR6dHZjdXB3b3FlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NDExODksImV4cCI6MjA4ODExNzE4OX0.XFWVkwotryP5c4Tv3j-DGexKt-Gs2_QHWe1NCh-LRHQ
```

Update `.env.example` to match (without real values).

**Step 3: Verify**

Run `npm run dev` — no errors.

**Step 4: Commit**
```bash
git add package.json package-lock.json .env.example
git commit -m "chore: install @supabase/supabase-js and @supabase/ssr"
```

---

### Task 2: Create Supabase client utilities

**Files:**
- Create: `lib/supabase/client.ts` — browser client
- Create: `lib/supabase/server.ts` — server client (for Route Handlers + Server Components)
- Create: `lib/supabase/middleware.ts` — middleware helper

**Step 1: Browser client**

```typescript
// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

**Step 2: Server client**

```typescript
// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from Server Component — ignore
          }
        },
      },
    }
  )
}
```

**Step 3: Middleware helper**

```typescript
// lib/supabase/middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Public routes that don't require auth
  const publicPaths = ['/login']
  const isPublicPath = publicPaths.some(p => request.nextUrl.pathname.startsWith(p))

  // Room pages remain accessible without auth (legacy link sharing still works)
  const isRoomPath = request.nextUrl.pathname.startsWith('/room/')

  if (!user && !isPublicPath && !isRoomPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // If logged in but no profile username, redirect to onboarding
  // (except if already on onboarding or auth callback)
  if (user && !isPublicPath && !request.nextUrl.pathname.startsWith('/onboarding')) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .single()

    if (!profile?.username) {
      const url = request.nextUrl.clone()
      url.pathname = '/onboarding'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}
```

**Step 4: Create Next.js middleware**

```typescript
// middleware.ts (project root)
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

**Step 5: Verify**

Run `npm run build` — no type errors.

**Step 6: Commit**
```bash
git add lib/supabase/ middleware.ts
git commit -m "feat: add Supabase client utilities and auth middleware"
```

---

### Task 3: Database migration — profiles table

**Step 1: Apply migration via Supabase MCP**

```sql
-- Create profiles table
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  username text unique,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Add constraint: username must be lowercase alphanumeric + underscores, 3-20 chars
alter table public.profiles
  add constraint username_format
  check (username ~ '^[a-z0-9_]{3,20}$');

-- Enable RLS
alter table public.profiles enable row level security;

-- Anyone can read profiles (needed for contact search)
create policy "Profiles are viewable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

-- Users can update their own profile
create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Users can insert their own profile (for onboarding)
create policy "Users can insert own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- Auto-create profile row when a new user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.phone, '')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Auto-update updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger on_profile_updated
  before update on public.profiles
  for each row execute function public.handle_updated_at();
```

Migration name: `create_profiles_table`

**Step 2: Verify**

```sql
SELECT * FROM public.profiles LIMIT 1;
-- Should return empty result set with correct columns
```

---

### Task 4: Database migration — contacts table

**Step 1: Apply migration**

```sql
-- Create contacts table
create table public.contacts (
  id uuid default gen_random_uuid() primary key,
  requester_id uuid references public.profiles(id) on delete cascade not null,
  addressee_id uuid references public.profiles(id) on delete cascade not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz default now() not null,
  unique(requester_id, addressee_id)
);

-- Prevent self-contacts
alter table public.contacts
  add constraint no_self_contact
  check (requester_id != addressee_id);

-- Enable RLS
alter table public.contacts enable row level security;

-- Users can see contacts where they are requester or addressee
create policy "Users can view own contacts"
  on public.contacts for select
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Users can send contact requests (they are the requester)
create policy "Users can send contact requests"
  on public.contacts for insert
  to authenticated
  with check (auth.uid() = requester_id and status = 'pending');

-- Users can update contacts they're involved in (accept/block)
create policy "Users can update contact status"
  on public.contacts for update
  to authenticated
  using (auth.uid() = addressee_id or auth.uid() = requester_id);

-- Users can delete their own contact relationships
create policy "Users can delete own contacts"
  on public.contacts for delete
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Index for fast lookups
create index idx_contacts_requester on public.contacts(requester_id);
create index idx_contacts_addressee on public.contacts(addressee_id);
```

Migration name: `create_contacts_table`

**Step 2: Verify**

```sql
SELECT * FROM public.contacts LIMIT 1;
```

---

### Task 5: Configure Phone OTP auth in Supabase

This requires a Twilio account for SMS delivery.

**Step 1: Create Twilio account**

1. Sign up at https://www.twilio.com
2. Get a phone number that can send SMS
3. Note your Account SID, Auth Token, and Twilio phone number (or Messaging Service SID)

**Step 2: Enable Phone provider in Supabase Dashboard**

1. Go to Authentication → Providers → Phone
2. Enable Phone provider
3. Select Twilio as the SMS provider
4. Enter:
   - Twilio Account SID
   - Twilio Auth Token
   - Twilio Message Service SID (or Twilio phone number as sender)
5. Set OTP expiry (default 60 seconds is fine)
6. Save

**Step 3: Verify**

Phone provider should show as enabled in the Supabase Dashboard.

Note: No OAuth callback route is needed — phone OTP is entirely client-side (no redirects).

---

### Task 6: Login page (phone + OTP)

**Files:**
- Create: `app/login/page.tsx`

**Step 1: Build two-step login page**

The login flow has two steps:
1. Enter phone number → send OTP
2. Enter 6-digit OTP → verify and sign in

```tsx
// app/login/page.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    // Ensure phone starts with + country code
    const normalized = phone.startsWith('+') ? phone : `+${phone}`

    const { error: sendError } = await supabase.auth.signInWithOtp({
      phone: normalized,
    })

    if (sendError) {
      setError(sendError.message)
      setLoading(false)
      return
    }

    setStep('otp')
    setLoading(false)
  }

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const normalized = phone.startsWith('+') ? phone : `+${phone}`

    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone: normalized,
      token: otp,
      type: 'sms',
    })

    if (verifyError) {
      setError(verifyError.message)
      setLoading(false)
      return
    }

    router.push('/')
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '14px 16px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-subtle)',
    background: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    fontSize: '1.125rem',
    outline: 'none',
    letterSpacing: step === 'otp' ? '0.3em' : 'normal',
    textAlign: step === 'otp' ? 'center' : 'left',
    boxSizing: 'border-box',
  }

  const buttonStyle: React.CSSProperties = {
    width: '100%',
    padding: '14px',
    borderRadius: 'var(--radius-pill)',
    border: 'none',
    background: 'var(--accent)',
    color: '#111',
    fontSize: '1rem',
    fontWeight: 600,
    cursor: 'pointer',
    opacity: loading ? 0.5 : 1,
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
        fontSize: '2.5rem',
        fontWeight: 600,
        color: 'var(--accent)',
        marginBottom: '8px',
      }}>
        Connekt
      </h1>
      <p style={{
        color: 'var(--text-secondary)',
        marginBottom: '48px',
        textAlign: 'center',
      }}>
        Lightweight, low-bandwidth video calls
      </p>

      {step === 'phone' ? (
        <form onSubmit={handleSendOtp} style={{
          display: 'flex', flexDirection: 'column', gap: '16px',
          width: '100%', maxWidth: '320px',
        }}>
          <label style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Phone number (with country code)
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98765 43210"
            autoFocus
            style={inputStyle}
          />
          {error && <p style={{ color: '#ef4444', fontSize: '0.875rem', margin: 0 }}>{error}</p>}
          <button type="submit" disabled={loading || phone.length < 8} style={buttonStyle}>
            {loading ? 'Sending...' : 'Send OTP'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp} style={{
          display: 'flex', flexDirection: 'column', gap: '16px',
          width: '100%', maxWidth: '320px',
        }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', textAlign: 'center', margin: 0 }}>
            Enter the 6-digit code sent to {phone}
          </p>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            autoFocus
            style={inputStyle}
          />
          {error && <p style={{ color: '#ef4444', fontSize: '0.875rem', margin: 0 }}>{error}</p>}
          <button type="submit" disabled={loading || otp.length !== 6} style={buttonStyle}>
            {loading ? 'Verifying...' : 'Verify'}
          </button>
          <button
            type="button"
            onClick={() => { setStep('phone'); setOtp(''); setError('') }}
            style={{
              background: 'none', border: 'none',
              color: 'var(--text-secondary)', cursor: 'pointer',
              fontSize: '0.875rem', textDecoration: 'underline',
            }}
          >
            Use a different number
          </button>
        </form>
      )}
    </div>
  )
}
```

**Step 2: Verify**

Navigate to `http://localhost:3000/login` — should see phone input. Enter number → OTP screen appears. Enter OTP → redirects to `/`.

**Step 3: Commit**
```bash
git add app/login/page.tsx
git commit -m "feat: add phone OTP login page"
```

---

### Task 7: Onboarding page (set username)

**Files:**
- Create: `app/onboarding/page.tsx`

**Step 1: Build onboarding page**

After first Google login, the user has a profile row (from the trigger) but no username. This page lets them set one.

```tsx
// app/onboarding/page.tsx
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

    // Client-side validation
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
```

**Step 2: Verify**

Sign in with Google → should redirect to `/onboarding` → set username → redirects to `/`.

**Step 3: Commit**
```bash
git add app/onboarding/page.tsx
git commit -m "feat: add username onboarding page"
```

---

### Task 8: Transform landing page into authenticated home (contacts list)

**Files:**
- Modify: `app/page.tsx` — replace with authenticated contacts home

The current landing page just has a "Start Call" button. It becomes the contacts list for logged-in users.

**Step 1: Rewrite `app/page.tsx`**

The new home page shows:
- User's avatar + username in a header
- "Start random room" button (existing functionality preserved)
- Contacts list with call buttons
- "Add contact" section (search by username)
- Pending contact requests
- Sign out button

```tsx
// app/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { nanoid } from 'nanoid'
import { createClient } from '@/lib/supabase/client'

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
  profile: Profile  // the OTHER person's profile
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

  const loadData = useCallback(async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { router.push('/login'); return }

    // Get own profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .single()
    if (profile) setUser(profile)

    // Get accepted contacts (where I'm requester or addressee)
    const { data: myContacts } = await supabase
      .from('contacts')
      .select('*')
      .or(`requester_id.eq.${authUser.id},addressee_id.eq.${authUser.id}`)
      .eq('status', 'accepted')

    if (myContacts) {
      // For each contact, fetch the OTHER person's profile
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
    const slug = nanoid(10)
    // Phase 2 will replace this with call invitation flow
    router.push(`/room/${slug}`)
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

  // Shared styles
  const cardStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px', borderRadius: 'var(--radius-md)',
    background: 'var(--bg-elevated)', marginBottom: '8px',
  }
  const buttonStyle: React.CSSProperties = {
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
        <button onClick={handleSignOut} style={{ ...buttonStyle, background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>
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
                <button onClick={() => handleAccept(c.id)} style={{ ...buttonStyle, background: 'var(--accent)', color: '#111' }}>Accept</button>
                <button onClick={() => handleDecline(c.id)} style={{ ...buttonStyle, background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>Decline</button>
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
              <button onClick={() => handleCall(c.profile)} style={{ ...buttonStyle, background: 'var(--accent)', color: '#111' }}>
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
          <button onClick={handleSearch} style={{ ...buttonStyle, background: 'var(--accent)', color: '#111' }}>
            Search
          </button>
        </div>
        {searchError && <p style={{ color: '#ef4444', fontSize: '0.875rem', marginTop: '8px' }}>{searchError}</p>}
        {searchResult && (
          <div style={{ ...cardStyle, marginTop: '12px' }}>
            <span style={{ color: 'var(--text-primary)' }}>@{searchResult.username}</span>
            <button onClick={() => handleAddContact(searchResult.id)} style={{ ...buttonStyle, background: 'var(--accent)', color: '#111' }}>
              Add
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
```

**Step 2: Verify**

Navigate to `http://localhost:3000` while logged in — contacts list renders, search works.

**Step 3: Commit**
```bash
git add app/page.tsx
git commit -m "feat: replace landing page with authenticated contacts home"
```

---

## Phase 2: In-App Call Signaling

### Task 9: Database migration — call_invitations table

**Step 1: Apply migration**

```sql
-- Create call_invitations table
create table public.call_invitations (
  id uuid default gen_random_uuid() primary key,
  caller_id uuid references public.profiles(id) on delete cascade not null,
  callee_id uuid references public.profiles(id) on delete cascade not null,
  room_slug text not null,
  status text not null default 'ringing'
    check (status in ('ringing', 'accepted', 'declined', 'missed', 'cancelled')),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Enable RLS
alter table public.call_invitations enable row level security;

-- Users can see invitations where they are caller or callee
create policy "Users can view own call invitations"
  on public.call_invitations for select
  to authenticated
  using (auth.uid() = caller_id or auth.uid() = callee_id);

-- Users can create call invitations (they are the caller)
create policy "Users can create call invitations"
  on public.call_invitations for insert
  to authenticated
  with check (auth.uid() = caller_id and status = 'ringing');

-- Users can update call invitations they're part of
create policy "Users can update own call invitations"
  on public.call_invitations for update
  to authenticated
  using (auth.uid() = caller_id or auth.uid() = callee_id);

-- Auto-update updated_at
create trigger on_call_invitation_updated
  before update on public.call_invitations
  for each row execute function public.handle_updated_at();

-- Enable Realtime for this table
alter publication supabase_realtime add table public.call_invitations;

-- Indexes
create index idx_call_invitations_callee on public.call_invitations(callee_id, status);
create index idx_call_invitations_caller on public.call_invitations(caller_id, status);
```

Migration name: `create_call_invitations_table`

**Step 2: Verify**

```sql
SELECT * FROM public.call_invitations LIMIT 1;
```

---

### Task 10: Modify token API route to support authenticated calls

**Files:**
- Modify: `app/api/token/route.ts`

The current token route is unauthenticated. Keep it working for legacy link-sharing, but also support authenticated callers. When a Supabase JWT is provided in the Authorization header, use the user's profile name as the participant name.

```typescript
// app/api/token/route.ts
import { AccessToken } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const roomName = request.nextUrl.searchParams.get('roomName');
  let participantName = request.nextUrl.searchParams.get('participantName');

  // If no participantName provided, try to get from auth
  if (!participantName) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('username, display_name')
        .eq('id', user.id)
        .single();
      participantName = profile?.display_name || profile?.username || 'User';
    }
  }

  if (!roomName || !participantName) {
    return NextResponse.json(
      { error: 'Missing roomName or participantName' },
      { status: 400 }
    );
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      { error: 'Server misconfigured' },
      { status: 500 }
    );
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity: `${participantName}-${Date.now()}`,
    name: participantName,
    ttl: '10m',
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
  });

  const token = await at.toJwt();
  return NextResponse.json({ token });
}
```

**Step 1: Verify**

Existing flow still works: `GET /api/token?roomName=test&participantName=Test` returns a token.

**Step 2: Commit**
```bash
git add app/api/token/route.ts
git commit -m "feat: support authenticated users in token API route"
```

---

### Task 11: Create call invitation hook and incoming call listener

**Files:**
- Create: `lib/hooks/useCallInvitations.ts` — hook that listens for incoming calls via Realtime
- Create: `lib/hooks/useInitiateCall.ts` — hook that creates a call invitation

**Step 1: Incoming call listener**

```typescript
// lib/hooks/useCallInvitations.ts
'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'

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

    // Subscribe to new call invitations where I'm the callee
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
        async (payload: RealtimePostgresChangesPayload<CallInvitation>) => {
          if (payload.eventType !== 'INSERT') return
          const invitation = payload.new as CallInvitation

          // Fetch caller profile
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
        (payload: RealtimePostgresChangesPayload<CallInvitation>) => {
          if (payload.eventType !== 'UPDATE') return
          const updated = payload.new as CallInvitation
          // If the call was cancelled by caller, clear it
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
```

**Step 2: Initiate call hook**

```typescript
// lib/hooks/useInitiateCall.ts
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

  // Listen for callee's response to our outgoing call
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
          if (payload.eventType !== 'UPDATE') return
          const updated = payload.new as { id: string; status: string }
          if (updated.id !== outgoingCall.invitationId) return
          setOutgoingCall((prev) => prev ? { ...prev, status: updated.status as OutgoingCallState['status'] } : null)
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

  const initiateCall = useCallback(async (calleeId: string, calleeName: string) => {
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
```

**Step 3: Commit**
```bash
git add lib/hooks/
git commit -m "feat: add call invitation hooks with Realtime listeners"
```

---

### Task 12: Add incoming call overlay + outgoing call screen to home page

**Files:**
- Modify: `app/page.tsx` — integrate call hooks, add incoming/outgoing call overlays

**Step 1: Add call overlays to `app/page.tsx`**

At the top of the component, add:
```tsx
import { useIncomingCalls } from '@/lib/hooks/useCallInvitations'
import { useInitiateCall } from '@/lib/hooks/useInitiateCall'
```

Inside the component, add:
```tsx
const { incomingCall, acceptCall, declineCall } = useIncomingCalls(user?.id ?? null)
const { outgoingCall, initiateCall, cancelCall, clearOutgoingCall } = useInitiateCall(user?.id ?? null)
```

Replace `handleCall`:
```tsx
const handleCall = (contactProfile: Profile) => {
  initiateCall(contactProfile.id, contactProfile.username)
}
```

Handle outgoing call acceptance — navigate to room:
```tsx
useEffect(() => {
  if (outgoingCall?.status === 'accepted') {
    clearOutgoingCall()
    router.push(`/room/${outgoingCall.roomSlug}`)
  }
}, [outgoingCall, router, clearOutgoingCall])
```

Handle incoming call acceptance:
```tsx
const handleAcceptCall = async () => {
  const roomSlug = await acceptCall()
  if (roomSlug) router.push(`/room/${roomSlug}`)
}
```

Add overlays before the closing `</div>`:

```tsx
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
    <p style={{ color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: 600 }}>
      @{incomingCall.caller_profile?.username || 'Unknown'}
    </p>
    <p style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>Incoming call...</p>
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
    <p style={{ color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: 600 }}>
      @{outgoingCall.calleeName}
    </p>
    <p style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>Calling...</p>
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
    <p style={{ color: 'var(--text-primary)', fontSize: '1.25rem' }}>Call declined</p>
    <button onClick={clearOutgoingCall} style={{
      padding: '12px 32px', borderRadius: 'var(--radius-pill)',
      background: 'var(--bg-surface)', border: 'none',
      color: 'var(--text-primary)', cursor: 'pointer',
    }}>
      OK
    </button>
  </div>
)}
```

**Step 2: Verify**

Open app in two browser windows with two different users. User A calls User B. User B sees incoming call overlay. Accept → both navigate to room.

**Step 3: Commit**
```bash
git add app/page.tsx
git commit -m "feat: add incoming/outgoing call overlays with Realtime signaling"
```

---

## Phase 3: Push Notifications

### Task 13: Install web-push and generate VAPID keys

**Step 1: Install web-push**

```bash
npm install web-push
npm install -D @types/web-push
```

**Step 2: Generate VAPID keys**

```bash
npx web-push generate-vapid-keys
```

This outputs a public key and private key. Add to `.env.local`:
```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<generated public key>
VAPID_PRIVATE_KEY=<generated private key>
VAPID_SUBJECT=mailto:your@email.com
```

Update `.env.example` accordingly.

**Step 3: Commit**
```bash
git add package.json package-lock.json .env.example
git commit -m "chore: install web-push and add VAPID key env vars"
```

---

### Task 14: Database migration — push_subscriptions table

**Step 1: Apply migration**

```sql
create table public.push_subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz default now() not null,
  unique(user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

create policy "Users can manage own push subscriptions"
  on public.push_subscriptions for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

Migration name: `create_push_subscriptions_table`

---

### Task 15: Create Service Worker for push events

**Files:**
- Create: `public/sw.js` — Service Worker that handles push events

```javascript
// public/sw.js
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}

  const title = data.title || 'Connekt'
  const options = {
    body: data.body || 'Incoming call',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: 'incoming-call',
    renotify: true,
    requireInteraction: true,
    data: {
      roomSlug: data.roomSlug,
      callInvitationId: data.callInvitationId,
    },
    actions: [
      { action: 'accept', title: 'Accept' },
      { action: 'decline', title: 'Decline' },
    ],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const { roomSlug, callInvitationId } = event.notification.data || {}

  if (event.action === 'decline') {
    // Fire decline request to the server
    event.waitUntil(
      fetch(`/api/call/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callInvitationId, action: 'declined' }),
      })
    )
    return
  }

  // Accept or just clicked notification — open the room
  const url = roomSlug ? `/room/${roomSlug}` : '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Try to focus existing window
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin)) {
          client.navigate(url)
          return client.focus()
        }
      }
      // Open new window
      return clients.openWindow(url)
    })
  )
})
```

**Step 1: Commit**
```bash
git add public/sw.js
git commit -m "feat: add Service Worker for push notifications"
```

---

### Task 16: Create push subscription API routes

**Files:**
- Create: `app/api/push/subscribe/route.ts` — save push subscription
- Create: `app/api/push/send/route.ts` — send push notification (called when creating a call invitation)
- Create: `app/api/call/respond/route.ts` — handle accept/decline from push notification

**Step 1: Subscribe route**

```typescript
// app/api/push/subscribe/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { endpoint, keys } = await request.json()

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth_key: keys.auth,
    },
    { onConflict: 'user_id,endpoint' }
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

**Step 2: Send push route**

```typescript
// app/api/push/send/route.ts
import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient } from '@/lib/supabase/server'

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { calleeId, callerName, roomSlug, callInvitationId } = await request.json()

  // Get callee's push subscriptions
  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', calleeId)

  if (!subscriptions || subscriptions.length === 0) {
    return NextResponse.json({ sent: 0 })
  }

  const payload = JSON.stringify({
    title: `${callerName} is calling`,
    body: 'Tap to answer',
    roomSlug,
    callInvitationId,
  })

  let sent = 0
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth_key },
        },
        payload
      )
      sent++
    } catch (err: unknown) {
      // If subscription is expired/invalid, delete it
      const pushError = err as { statusCode?: number }
      if (pushError.statusCode === 410 || pushError.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id)
      }
    }
  }

  return NextResponse.json({ sent })
}
```

**Step 3: Call respond route (for Service Worker)**

```typescript
// app/api/call/respond/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const { callInvitationId, action } = await request.json()

  if (!callInvitationId || !['accepted', 'declined'].includes(action)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const supabase = await createClient()

  const { error } = await supabase
    .from('call_invitations')
    .update({ status: action })
    .eq('id', callInvitationId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

**Step 4: Commit**
```bash
git add app/api/push/ app/api/call/
git commit -m "feat: add push notification subscribe/send API routes"
```

---

### Task 17: Register Service Worker and request push permission

**Files:**
- Create: `lib/push.ts` — utility to register SW and subscribe to push

```typescript
// lib/push.ts
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null
  const registration = await navigator.serviceWorker.register('/sw.js')
  return registration
}

export async function subscribeToPush(registration: ServiceWorkerRegistration) {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return null

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
    ),
  })

  // Send subscription to server
  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription.toJSON()),
  })

  return subscription
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
```

**Step 2: Integrate into home page**

In `app/page.tsx`, add on mount (inside `loadData` or a separate `useEffect`):

```tsx
import { registerServiceWorker, subscribeToPush } from '@/lib/push'

// Inside useEffect after confirming user is logged in:
useEffect(() => {
  if (!user) return
  registerServiceWorker().then((reg) => {
    if (reg) subscribeToPush(reg)
  })
}, [user])
```

**Step 3: Modify `useInitiateCall` to send push after creating invitation**

In `lib/hooks/useInitiateCall.ts`, after the `supabase.from('call_invitations').insert(...)` call, add:

```tsx
// Send push notification to callee
fetch('/api/push/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    calleeId,
    callerName: /* pass caller's username */,
    roomSlug,
    callInvitationId: data.id,
  }),
})
```

This requires adding the caller's username as a parameter to `useInitiateCall`.

**Step 4: Verify**

1. Log in on two different browsers
2. Close User B's tab
3. User A calls User B
4. User B should receive a push notification
5. Clicking the notification opens the app and shows the incoming call screen

**Step 5: Commit**
```bash
git add lib/push.ts lib/hooks/useInitiateCall.ts app/page.tsx
git commit -m "feat: register Service Worker and send push notifications on call"
```

---

## Post-Implementation Checklist

- [ ] Run Supabase security advisors: `get_advisors(type: 'security')` to verify RLS policies
- [ ] Test full flow: Login → Add contact → Call → Ring → Accept → Video call → Disconnect
- [ ] Test push notifications: Call with tab closed → notification → tap → join call
- [ ] Test edge cases: simultaneous calls, cancel mid-ring, timeout, declined
- [ ] Verify legacy link-sharing still works (unauthenticated `/room/[slug]` access)
- [ ] Update `CLAUDE.md` with new architecture details
- [ ] Update `.env.example` with all new env vars
