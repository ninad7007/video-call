# Web Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user calls a contact, the callee receives a native push notification even when the browser is closed. Tapping it opens the app to the incoming call screen.

**Architecture:** Web Push API with VAPID keys. A Service Worker in `public/sw.js` listens for push events and shows OS notifications. When the caller initiates a call, the client-side code calls a Next.js API route (`/api/push/send`) which uses the `web-push` npm package to send a push to all of the callee's registered subscriptions. Push subscriptions are stored in a `push_subscriptions` Supabase table. The Service Worker handles notification click to open/focus the app.

**Tech Stack:** `web-push` (npm), Web Push API, Service Worker, Supabase (push_subscriptions table), Next.js API Routes

**Supabase Project:** `wzpkqhhjvtztvcupwoqe`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `public/sw.js` | Service Worker — handles `push` and `notificationclick` events |
| `lib/push.ts` | Client-side utility — registers SW, subscribes to push, saves subscription to server |
| `app/api/push/subscribe/route.ts` | API route — saves a push subscription to Supabase |
| `app/api/push/send/route.ts` | API route — sends push notification to a user's devices via `web-push` |
| `app/api/call/respond/route.ts` | API route — handles accept/decline from notification actions (used by SW) |
| `lib/hooks/useInitiateCall.ts` | Modify — fire push notification after creating call invitation |
| `app/page.tsx` | Modify — register SW and subscribe to push on login |
| `.env.local` | Modify — add VAPID keys |
| `.env.example` | Modify — add VAPID key placeholders |

---

### Task 1: Install web-push and generate VAPID keys

**Files:**
- Modify: `package.json`
- Modify: `.env.local`
- Modify: `.env.example`

- [ ] **Step 1: Install web-push**

```bash
npm install web-push
npm install -D @types/web-push
```

- [ ] **Step 2: Generate VAPID keys**

```bash
npx web-push generate-vapid-keys
```

Copy the output. It will look like:
```
Public Key: BNx...
Private Key: abc...
```

- [ ] **Step 3: Add VAPID keys to `.env.local`**

Append to the existing `.env.local`:
```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<paste public key>
VAPID_PRIVATE_KEY=<paste private key>
VAPID_SUBJECT=mailto:dighe.ninad7007@gmail.com
```

- [ ] **Step 4: Update `.env.example`**

Append to the existing `.env.example`:
```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com
```

- [ ] **Step 5: Verify**

```bash
node -e "require('web-push'); console.log('web-push OK')"
```

Expected: `web-push OK`

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: install web-push and add VAPID key env vars"
```

---

### Task 2: Database migration — push_subscriptions table

**Files:**
- Create: Supabase migration `create_push_subscriptions_table`

- [ ] **Step 1: Apply migration via Supabase MCP**

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

-- Users can insert/update/delete their own subscriptions
create policy "Users can manage own push subscriptions"
  on public.push_subscriptions for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Allow authenticated users to read any subscription (needed by /api/push/send
-- to look up callee's subscriptions; endpoint/keys are opaque, not PII)
create policy "Authenticated users can read push subscriptions"
  on public.push_subscriptions for select
  to authenticated
  using (true);
```

- [ ] **Step 2: Verify table exists**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'push_subscriptions' ORDER BY ordinal_position;
```

Expected: 5 columns — id, user_id, endpoint, p256dh, auth_key, created_at

- [ ] **Step 3: Commit** (no local files changed — migration is remote)

---

### Task 3: Create Service Worker

**Files:**
- Create: `public/sw.js`

- [ ] **Step 1: Write the Service Worker**

```javascript
// public/sw.js

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}

  // Skip push notification if the app is already open and focused
  // (the in-app Realtime listener + ringtone handles it)
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      var appFocused = windowClients.some(function(c) {
        return c.focused && c.url.includes(self.location.origin)
      })
      if (appFocused) return

      var title = data.title || 'Connekt'
      var options = {
        body: data.body || 'Incoming call',
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: 'incoming-call',
        renotify: true,
        requireInteraction: true,
        vibrate: [200, 100, 200, 100, 200],
        data: {
          roomSlug: data.roomSlug,
          callInvitationId: data.callInvitationId,
        },
        actions: [
          { action: 'accept', title: 'Accept' },
          { action: 'decline', title: 'Decline' },
        ],
      }

      return self.registration.showNotification(title, options)
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const { roomSlug, callInvitationId } = event.notification.data || {}

  if (event.action === 'decline') {
    event.waitUntil(
      fetch('/api/call/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callInvitationId, action: 'declined' }),
      })
        .then(function(res) {
          if (!res.ok) return clients.openWindow('/')
        })
        .catch(function() { return clients.openWindow('/') })
    )
    return
  }

  // Accept or bare notification click — open the app to the home page
  // (The Realtime subscription on the home page will show the incoming call overlay)
  const targetUrl = '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin)) {
          return client.focus()
        }
      }
      return clients.openWindow(targetUrl)
    })
  )
})
```

- [ ] **Step 2: Verify file is served**

```bash
curl -s http://localhost:3002/sw.js | head -3
```

Expected: first 3 lines of the Service Worker file.

- [ ] **Step 3: Commit**

```bash
git add public/sw.js
git commit -m "feat: add Service Worker for push notifications"
```

---

### Task 4: Create push subscription client utility

**Files:**
- Create: `lib/push.ts`

- [ ] **Step 1: Write the utility**

```typescript
// lib/push.ts

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    const registration = await navigator.serviceWorker.register('/sw.js')
    return registration
  } catch {
    return null
  }
}

export async function subscribeToPush(
  registration: ServiceWorkerRegistration
): Promise<PushSubscription | null> {
  if (!('PushManager' in window)) return null

  // Check for existing subscription — avoid re-prompting and redundant requests
  const existing = await registration.pushManager.getSubscription()
  if (existing) return existing

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return null

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!vapidKey) return null

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  })

  // Send subscription to server
  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription.toJSON()),
  })

  return subscription
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
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

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit --pretty
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/push.ts
git commit -m "feat: add push subscription client utility"
```

---

### Task 5: Create push API routes

**Files:**
- Create: `app/api/push/subscribe/route.ts`
- Create: `app/api/push/send/route.ts`
- Create: `app/api/call/respond/route.ts`

- [ ] **Step 1: Write the subscribe route**

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

- [ ] **Step 2: Write the send route**

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

  const { callerName, callInvitationId } = await request.json()

  // Validate the call invitation belongs to this caller and is active
  const { data: invitation } = await supabase
    .from('call_invitations')
    .select('id, callee_id, room_slug')
    .eq('id', callInvitationId)
    .eq('caller_id', user.id)
    .eq('status', 'ringing')
    .single()

  if (!invitation) return NextResponse.json({ error: 'Invalid invitation' }, { status: 403 })

  // Get callee's push subscriptions
  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', invitation.callee_id)

  if (!subscriptions || subscriptions.length === 0) {
    return NextResponse.json({ sent: 0 })
  }

  const payload = JSON.stringify({
    title: `${callerName} is calling`,
    body: 'Tap to answer',
    roomSlug: invitation.room_slug,
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
      const pushError = err as { statusCode?: number }
      if (pushError.statusCode === 410 || pushError.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id)
      }
    }
  }

  return NextResponse.json({ sent })
}
```

- [ ] **Step 3: Write the call respond route (for Service Worker actions)**

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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only the callee can respond to a call invitation
  const { error } = await supabase
    .from('call_invitations')
    .update({ status: action })
    .eq('id', callInvitationId)
    .eq('callee_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Verify types compile**

```bash
npx tsc --noEmit --pretty
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/push/ app/api/call/
git commit -m "feat: add push subscribe/send and call respond API routes"
```

---

### Task 6: Register Service Worker on login + send push on call

**Files:**
- Modify: `app/page.tsx` (add SW registration in useEffect)
- Modify: `lib/hooks/useInitiateCall.ts` (fire push after creating invitation)

- [ ] **Step 1: Add SW registration to home page**

In `app/page.tsx`, add import:
```typescript
import { registerServiceWorker, subscribeToPush } from '@/lib/push'
```

Add a `useEffect` after the existing `loadData` effect (around line 90):
```typescript
// Register Service Worker and subscribe to push notifications
useEffect(() => {
  if (!user) return
  registerServiceWorker().then((reg) => {
    if (reg) subscribeToPush(reg)
  })
}, [user])
```

- [ ] **Step 2: Modify useInitiateCall to send push notification**

In `lib/hooks/useInitiateCall.ts`, update the `initiateCall` callback. After the successful insert (after `setOutgoingCall(...)`), add:

```typescript
// Send push notification to callee (fire-and-forget)
fetch('/api/push/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    callerName,
    callInvitationId: data.id,
  }),
}).catch(() => {}) // Ignore push errors — in-app Realtime is the primary channel
```

Note: The `callerName` parameter is already passed to `initiateCall(calleeId, calleeName)` — but we need the CALLER's name for the notification. Update the hook signature to accept `callerName` as a third parameter:

```typescript
const initiateCall = useCallback(async (calleeId: string, calleeName: string, callerName: string) => {
```

And update the call site in `app/page.tsx`:
```typescript
const handleCall = (contactProfile: Profile) => {
  initiateCall(contactProfile.id, contactProfile.username, user?.username || 'Someone')
}
```

- [ ] **Step 3: Verify types compile**

```bash
npx tsc --noEmit --pretty
```

Expected: no errors.

- [ ] **Step 4: Verify build passes**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx lib/hooks/useInitiateCall.ts
git commit -m "feat: register SW on login and send push notification on call"
```

---

### Task 7: End-to-end verification

- [ ] **Step 1: Test push subscription registration**

1. Open `http://localhost:3002` in Chrome, log in
2. Browser should prompt for notification permission — allow it
3. Verify subscription was saved:

```sql
SELECT user_id, endpoint FROM public.push_subscriptions LIMIT 5;
```

Expected: at least one row for the logged-in user.

- [ ] **Step 2: Test push notification delivery**

1. Log in as User A in Chrome
2. Log in as User B in a different browser (or incognito)
3. Allow notification permissions on both
4. **Close User B's tab** (or minimize the browser)
5. From User A, tap "Call" on User B's contact card
6. User B should receive an OS-level push notification: "User_A is calling — Tap to answer"

- [ ] **Step 3: Test notification click**

1. Click the notification on User B's device
2. The app should open/focus with the home page showing the incoming call overlay
3. Accept the call — both users should enter the room

- [ ] **Step 4: Test notification decline action**

1. Repeat the call flow
2. On the notification, click "Decline" action button
3. The call invitation should be updated to `declined`
4. Caller should see "Call declined" overlay

---

## Notes

- **Push is a supplement, not a replacement.** The primary call notification channel is Supabase Realtime (postgres_changes). Push handles the case where the callee's tab is closed.
- **Expired subscriptions** are auto-cleaned: when `web-push` returns a 410 (Gone) status, that subscription is deleted from the database.
- **Multiple devices:** A user can have push subscriptions on multiple browsers/devices. All of them receive the notification.
- **iOS Safari limitation:** Web Push requires iOS 16.4+ and the site must be added to the home screen as a PWA. Standard Safari tabs don't support push. This is an OS limitation, not something we can work around.
