# Native Incoming-Call Notifications (iOS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an incoming call ring the callee's iPhone with the full-screen native CallKit screen — even when the app is backgrounded or fully killed — via APNs VoIP push + `expo-callkit-telecom`, with answer joining the LiveKit room and decline/cancel stopping the ring.

**Architecture:** The `video-call` Next.js backend signs and sends APNs VoIP pushes directly (no Expo push service, which cannot do VoIP). The `video-call-mobile` app uses `expo-callkit-telecom` (New-Architecture-compatible, LiveKit-aware) whose native layer reports the call to CallKit before JS runs. The `push_subscriptions` table is fixed (it currently rejects every mobile write) and extended for VoIP tokens.

**Tech Stack:** Next.js (Node runtime), `jsonwebtoken` (ES256 APNs JWT), Node `http2` (APNs), `vitest` (backend unit tests), Expo SDK + `expo-callkit-telecom`, Supabase Postgres, LiveKit.

> **Cross-repo note:** This plan touches two independent git repos (`video-call`, `video-call-mobile`) and one Supabase project. Commit per-repo. The DB migration and Apple credentials are gated on the user and are called out explicitly.
>
> **TDD scope:** Backend pure logic (JWT, payload, grouping, headers) is built test-first with `vitest`. Native CallKit behavior cannot be unit-tested headlessly; it is verified on a physical iPhone at the Phase 3 gate.

---

## File Structure

**`video-call` (web/backend):**
- Create `lib/push/voipPayload.ts` — build + validate the VoIP `incomingCall` payload (pure).
- Create `lib/push/apnsJwt.ts` — ES256 APNs provider JWT with caching (pure-ish).
- Create `lib/push/apns.ts` — APNs HTTP/2 sender + request-header builder.
- Create `lib/push/subscriptions.ts` — `groupSubscriptions()` + dead-token reason set (pure).
- Modify `app/api/push/subscribe/route.ts` — accept VoIP token rows.
- Modify `app/api/push/send/route.ts` — branch by `token_type`, send VoIP, prune, log; support `type:'ended'`.
- Modify `lib/hooks/useInitiateCall.ts` — on caller cancel, POST `type:'ended'`.
- Create `scripts/send-test-voip.ts` — dev tool to fire a VoIP push at a token.
- Tests: `lib/push/*.test.ts`.
- Config: `package.json` (vitest + jsonwebtoken), `.env.local` / `.env.example` (APNs vars).

**`video-call-mobile` (Expo app):**
- Modify `app.json` — add `expo-callkit-telecom` plugin, iOS `UIBackgroundModes: ["voip"]`.
- Modify `eas.json` — add `EXPO_PUBLIC_APNS_ENV` per profile.
- Create `lib/voip.ts` — register VoIP push, capture token, POST to `/api/push/subscribe`.
- Create `lib/callActions.ts` — `acceptInvitation(id)` / `declineInvitation(id)` (id-based).
- Modify `lib/hooks/useCallInvitations.ts` — reuse `callActions` (DRY).
- Modify `app/_layout.tsx` — register CallKit answer/end listeners at root (handles cold start).
- Modify `app/index.tsx` — replace `registerForPushNotifications()` with `registerVoip()`.
- Remove `lib/push.ts` (legacy Expo-token path) once `voip.ts` replaces it.

**Supabase:** one migration (gated on approval).

---

## Phase 0 — Database (GATED on user approval)

### Task 1: Fix and extend `push_subscriptions`

**Files:**
- Create (migration): apply via Supabase MCP `apply_migration` named `fix_push_subscriptions_for_voip`.

> ⚠️ This is DDL. Per the user's global rules, **do not run it without explicit approval.** Present the SQL, get a yes, then apply.

- [ ] **Step 1: Confirm current state**

Run (read-only):
```sql
select column_name, is_nullable from information_schema.columns
where table_name='push_subscriptions';
```
Expected: `p256dh` and `auth_key` are `NO` (not null); no `voip_token` column.

- [ ] **Step 2: Get explicit approval, then apply the migration**

```sql
alter table push_subscriptions alter column p256dh drop not null;
alter table push_subscriptions alter column auth_key drop not null;

alter table push_subscriptions add column if not exists voip_token text;
alter table push_subscriptions add column if not exists token_type text;
alter table push_subscriptions add column if not exists platform text;
alter table push_subscriptions add column if not exists apns_env text;

create unique index if not exists push_subscriptions_user_voip_uniq
  on push_subscriptions (user_id, voip_token)
  where voip_token is not null;
```

- [ ] **Step 3: Verify**

```sql
select column_name, is_nullable from information_schema.columns
where table_name='push_subscriptions' and column_name in ('p256dh','auth_key','voip_token','token_type','platform','apns_env');
```
Expected: `p256dh`/`auth_key` now `YES`; the four new columns present.

No code commit (schema lives in Supabase). Note the migration name in the PR/commit message of Task 7.

---

## Phase 1 — Backend (TDD)

### Task 2: Add the test runner and APNs JWT dependency

**Files:**
- Modify: `video-call/package.json`

- [ ] **Step 1: Install dev + runtime deps**

Run (in `video-call/`):
```bash
npm install --save-dev vitest && npm install jsonwebtoken && npm install --save-dev @types/jsonwebtoken
```

- [ ] **Step 2: Add test scripts**

Edit `package.json` `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Sanity-check the runner**

Create `video-call/lib/push/smoke.test.ts`:
```ts
import { test, expect } from 'vitest'
test('vitest runs', () => { expect(1 + 1).toBe(2) })
```
Run: `npm test`
Expected: 1 passing test.

- [ ] **Step 4: Remove the smoke test and commit**

```bash
rm lib/push/smoke.test.ts
git add package.json package-lock.json
git commit -m "chore: add vitest + jsonwebtoken for VoIP push"
```

---

### Task 3: VoIP payload builder + validator

**Files:**
- Create: `video-call/lib/push/voipPayload.ts`
- Test: `video-call/lib/push/voipPayload.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'vitest'
import { buildIncomingCallPayload, validateIncomingCallPayload } from './voipPayload'

test('builds the expo-callkit-telecom incomingCall payload', () => {
  const p = buildIncomingCallPayload({
    eventId: 'evt-1',
    callInvitationId: 'inv-1',
    callerId: 'user-1',
    callerName: 'Asha',
    roomSlug: 'room-xyz',
  })
  expect(p).toEqual({
    incomingCall: {
      eventId: 'evt-1',
      serverCallId: 'inv-1',
      caller: { id: 'user-1', displayName: 'Asha' },
      hasVideo: true,
      metadata: { roomSlug: 'room-xyz' },
    },
  })
})

test('validate returns errors for missing required fields', () => {
  const bad = { incomingCall: { eventId: '', serverCallId: '', caller: { id: '', displayName: '' }, hasVideo: true, metadata: { roomSlug: '' } } }
  expect(validateIncomingCallPayload(bad).length).toBeGreaterThan(0)
})

test('validate passes a well-formed payload', () => {
  const ok = buildIncomingCallPayload({ eventId: 'e', callInvitationId: 'i', callerId: 'c', callerName: 'n', roomSlug: 'r' })
  expect(validateIncomingCallPayload(ok)).toEqual([])
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/push/voipPayload.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export interface IncomingCallPayloadInput {
  eventId: string
  callInvitationId: string
  callerId: string
  callerName: string
  roomSlug: string
  hasVideo?: boolean
}

export interface VoipPayload {
  incomingCall: {
    eventId: string
    serverCallId: string
    caller: { id: string; displayName: string }
    hasVideo: boolean
    metadata: { roomSlug: string }
  }
}

export function buildIncomingCallPayload(input: IncomingCallPayloadInput): VoipPayload {
  return {
    incomingCall: {
      eventId: input.eventId,
      serverCallId: input.callInvitationId,
      caller: { id: input.callerId, displayName: input.callerName },
      hasVideo: input.hasVideo ?? true,
      metadata: { roomSlug: input.roomSlug },
    },
  }
}

export function validateIncomingCallPayload(p: VoipPayload): string[] {
  const errors: string[] = []
  const c = p?.incomingCall
  if (!c) return ['missing incomingCall']
  if (!c.eventId) errors.push('missing eventId')
  if (!c.serverCallId) errors.push('missing serverCallId')
  if (!c.caller?.id) errors.push('missing caller.id')
  if (!c.caller?.displayName) errors.push('missing caller.displayName')
  if (!c.metadata?.roomSlug) errors.push('missing metadata.roomSlug')
  return errors
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/push/voipPayload.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/push/voipPayload.ts lib/push/voipPayload.test.ts
git commit -m "feat(push): VoIP incomingCall payload builder + validator"
```

---

### Task 4: APNs provider JWT (ES256, cached)

**Files:**
- Create: `video-call/lib/push/apnsJwt.ts`
- Test: `video-call/lib/push/apnsJwt.test.ts`

- [ ] **Step 1: Write the failing test** (generates a throwaway P-256 key so no real secrets needed)

```ts
import { test, expect, beforeEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { buildApnsJwt, resetApnsJwtCache } from './apnsJwt'

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string

beforeEach(() => {
  resetApnsJwtCache()
  process.env.APNS_KEY_ID = 'KEY123'
  process.env.APNS_TEAM_ID = 'TEAM456'
  process.env.APNS_PRIVATE_KEY = pem
})

test('signs an ES256 JWT with kid + iss', () => {
  const token = buildApnsJwt({ now: 1_000 })
  const decoded = jwt.decode(token, { complete: true }) as any
  expect(decoded.header.alg).toBe('ES256')
  expect(decoded.header.kid).toBe('KEY123')
  expect(decoded.payload.iss).toBe('TEAM456')
  expect(decoded.payload.iat).toBe(1_000)
})

test('caches within 50 minutes, refreshes after', () => {
  const a = buildApnsJwt({ now: 1_000 })
  const b = buildApnsJwt({ now: 1_000 + 49 * 60 })
  expect(b).toBe(a)
  const c = buildApnsJwt({ now: 1_000 + 51 * 60 })
  expect(c).not.toBe(a)
})

test('throws when env vars missing', () => {
  delete process.env.APNS_KEY_ID
  resetApnsJwtCache()
  expect(() => buildApnsJwt({ now: 1 })).toThrow()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/push/apnsJwt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import jwt from 'jsonwebtoken'

let cache: { token: string; iat: number } | null = null

export function resetApnsJwtCache(): void {
  cache = null
}

export function buildApnsJwt(opts?: { now?: number }): string {
  const now = opts?.now ?? Math.floor(Date.now() / 1000)
  if (cache && now - cache.iat < 50 * 60) return cache.token

  const keyId = process.env.APNS_KEY_ID
  const teamId = process.env.APNS_TEAM_ID
  const privateKey = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!keyId || !teamId || !privateKey) {
    throw new Error('APNS_KEY_ID, APNS_TEAM_ID and APNS_PRIVATE_KEY must be set')
  }

  const token = jwt.sign({ iss: teamId, iat: now }, privateKey, {
    algorithm: 'ES256',
    header: { alg: 'ES256', kid: keyId },
  })
  cache = { token, iat: now }
  return token
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/push/apnsJwt.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/push/apnsJwt.ts lib/push/apnsJwt.test.ts
git commit -m "feat(push): cached ES256 APNs provider JWT"
```

---

### Task 5: APNs sender (HTTP/2) + request-header builder

**Files:**
- Create: `video-call/lib/push/apns.ts`
- Test: `video-call/lib/push/apns.test.ts`

- [ ] **Step 1: Write the failing test for the pure header builder + reason classifier**

```ts
import { test, expect } from 'vitest'
import { buildApnsHeaders, isDeadTokenReason } from './apns'

test('builds VoIP APNs headers', () => {
  const h = buildApnsHeaders({ deviceToken: 'devtok', topic: 'com.connekt.app.voip', jwt: 'jwt123', contentLength: 42 })
  expect(h[':method']).toBe('POST')
  expect(h[':path']).toBe('/3/device/devtok')
  expect(h['authorization']).toBe('bearer jwt123')
  expect(h['apns-push-type']).toBe('voip')
  expect(h['apns-topic']).toBe('com.connekt.app.voip')
  expect(h['apns-priority']).toBe('10')
  expect(h['content-length']).toBe(42)
})

test('classifies dead-token reasons', () => {
  expect(isDeadTokenReason(410, 'Unregistered')).toBe(true)
  expect(isDeadTokenReason(400, 'BadDeviceToken')).toBe(true)
  expect(isDeadTokenReason(400, 'DeviceTokenNotForTopic')).toBe(true)
  expect(isDeadTokenReason(200, undefined)).toBe(false)
  expect(isDeadTokenReason(429, 'TooManyRequests')).toBe(false)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/push/apns.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (header builder + classifier are pure and tested; `sendVoipPush` is integration-tested via the Task 9 dev script and the Phase 3 device test)

```ts
import http2 from 'node:http2'
import { buildApnsJwt } from './apnsJwt'
import type { VoipPayload } from './voipPayload'

export type ApnsEnv = 'sandbox' | 'production'
export interface ApnsResult { ok: boolean; status: number; reason?: string }

const HOSTS: Record<ApnsEnv, string> = {
  sandbox: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
}

const DEAD_REASONS = new Set(['Unregistered', 'BadDeviceToken', 'DeviceTokenNotForTopic'])

export function isDeadTokenReason(status: number, reason?: string): boolean {
  if (status === 410) return true
  return reason ? DEAD_REASONS.has(reason) : false
}

export function buildApnsHeaders(p: { deviceToken: string; topic: string; jwt: string; contentLength: number }) {
  return {
    ':method': 'POST',
    ':path': `/3/device/${p.deviceToken}`,
    authorization: `bearer ${p.jwt}`,
    'apns-push-type': 'voip',
    'apns-topic': p.topic,
    'apns-priority': '10',
    'content-type': 'application/json',
    'content-length': p.contentLength,
  } as const
}

export async function sendVoipPush(params: {
  deviceToken: string
  env: ApnsEnv
  payload: VoipPayload
  topic?: string
}): Promise<ApnsResult> {
  const topic = params.topic ?? `${process.env.APNS_BUNDLE_ID}.voip`
  const body = Buffer.from(JSON.stringify(params.payload))
  const headers = buildApnsHeaders({ deviceToken: params.deviceToken, topic, jwt: buildApnsJwt(), contentLength: body.length })
  const client = http2.connect(HOSTS[params.env])
  try {
    return await new Promise<ApnsResult>((resolve, reject) => {
      const req = client.request(headers)
      let status = 0
      let data = ''
      req.on('response', (h) => { status = Number(h[':status']) })
      req.setEncoding('utf8')
      req.on('data', (chunk) => { data += chunk })
      req.on('end', () => {
        if (status === 200) return resolve({ ok: true, status })
        let reason: string | undefined
        try { reason = JSON.parse(data)?.reason } catch { /* non-JSON body */ }
        resolve({ ok: false, status, reason })
      })
      req.on('error', reject)
      req.end(body)
    })
  } finally {
    client.close()
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/push/apns.test.ts`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/push/apns.ts lib/push/apns.test.ts
git commit -m "feat(push): APNs HTTP/2 VoIP sender + header/reason helpers"
```

---

### Task 6: Subscription grouping helper

**Files:**
- Create: `video-call/lib/push/subscriptions.ts`
- Test: `video-call/lib/push/subscriptions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'vitest'
import { groupSubscriptions } from './subscriptions'

test('splits web and apns_voip rows', () => {
  const rows = [
    { id: '1', endpoint: 'https://x', p256dh: 'a', auth_key: 'b', voip_token: null, token_type: null },
    { id: '2', endpoint: null, voip_token: 'vt', token_type: 'apns_voip', apns_env: 'production' },
    { id: '3', endpoint: null, voip_token: 'vt2', token_type: 'apns_voip', apns_env: 'sandbox' },
  ]
  const { webSubs, voipSubs } = groupSubscriptions(rows as any)
  expect(webSubs.map(s => s.id)).toEqual(['1'])
  expect(voipSubs.map(s => s.id)).toEqual(['2', '3'])
})

test('ignores apns_voip rows with no token', () => {
  const rows = [{ id: '9', voip_token: null, token_type: 'apns_voip' }]
  const { voipSubs } = groupSubscriptions(rows as any)
  expect(voipSubs).toEqual([])
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/push/subscriptions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export interface PushRow {
  id: string
  endpoint?: string | null
  p256dh?: string | null
  auth_key?: string | null
  voip_token?: string | null
  token_type?: string | null
  platform?: string | null
  apns_env?: 'sandbox' | 'production' | null
}

export function groupSubscriptions(rows: PushRow[]) {
  const voipSubs = rows.filter((s) => s.token_type === 'apns_voip' && !!s.voip_token)
  const webSubs = rows.filter((s) => !!s.endpoint && !s.voip_token)
  return { webSubs, voipSubs }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/push/subscriptions.test.ts`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/push/subscriptions.ts lib/push/subscriptions.test.ts
git commit -m "feat(push): groupSubscriptions helper"
```

---

### Task 7: Extend `/api/push/subscribe` for VoIP tokens

**Files:**
- Modify: `video-call/app/api/push/subscribe/route.ts`

- [ ] **Step 1: Add a VoIP branch at the top of the handler** (after the `user` check, before the `expo_token` branch)

```ts
  // VoIP push token (native mobile — CallKit/PushKit on iOS)
  if (body.voip_token) {
    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: user.id,
        voip_token: body.voip_token,
        token_type: body.token_type ?? 'apns_voip',
        platform: body.platform ?? 'ios',
        apns_env: body.apns_env ?? 'production',
      },
      { onConflict: 'user_id,voip_token' }
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
```

- [ ] **Step 2: Build to confirm types compile**

Run: `npm run build`
Expected: build succeeds (route compiles).

- [ ] **Step 3: Commit**

```bash
git add app/api/push/subscribe/route.ts
git commit -m "feat(push): accept VoIP token registration in /api/push/subscribe"
```

---

### Task 8: Rewrite `/api/push/send` to send VoIP, prune, and log

**Files:**
- Modify: `video-call/app/api/push/send/route.ts`

- [ ] **Step 1: Replace the Expo block with a VoIP block and add `nodejs` runtime + `type` support**

At the top of the file add (ensures `http2` is available — not Edge):
```ts
export const runtime = 'nodejs'
```

Replace the `sendExpoPush` function and the Expo-send block. New imports near the top:
```ts
import { groupSubscriptions } from '@/lib/push/subscriptions'
import { buildIncomingCallPayload, validateIncomingCallPayload } from '@/lib/push/voipPayload'
import { sendVoipPush, isDeadTokenReason, type ApnsEnv } from '@/lib/push/apns'
import { randomUUID } from 'node:crypto'
```

Replace the body that currently computes `webSubs`/`expoTokens` and sends, with:
```ts
  const { type } = await safeBody(request) // see Step 2 — read once

  const { webSubs, voipSubs } = groupSubscriptions(subscriptions as any)
  let sent = 0

  // --- Web push (browser) — unchanged behavior ---
  if (webSubs.length > 0 && process.env.VAPID_SUBJECT && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY)
    const payload = JSON.stringify({ title: `${callerName} is calling`, body: 'Tap to answer', roomSlug: invitation.room_slug, callInvitationId })
    for (const sub of webSubs) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint!, keys: { p256dh: sub.p256dh!, auth: sub.auth_key! } }, payload)
        sent++
      } catch (err: unknown) {
        const e = err as { statusCode?: number }
        if (e.statusCode === 410 || e.statusCode === 404) await supabase.from('push_subscriptions').delete().eq('id', sub.id)
      }
    }
  }

  // --- VoIP push (iOS CallKit) ---
  for (const sub of voipSubs) {
    const payload = buildIncomingCallPayload({
      eventId: randomUUID(),
      callInvitationId,
      callerId: user.id,
      callerName,
      roomSlug: invitation.room_slug,
    })
    const errors = validateIncomingCallPayload(payload)
    if (errors.length) {
      console.error('[push/send] invalid VoIP payload, skipping', { callInvitationId, errors })
      continue
    }
    try {
      const res = await sendVoipPush({ deviceToken: sub.voip_token!, env: (sub.apns_env as ApnsEnv) ?? 'production', payload })
      if (res.ok) {
        sent++
      } else {
        console.error('[push/send] APNs VoIP failed', { id: sub.id, status: res.status, reason: res.reason })
        if (isDeadTokenReason(res.status, res.reason)) await supabase.from('push_subscriptions').delete().eq('id', sub.id)
      }
    } catch (err) {
      console.error('[push/send] APNs VoIP threw', { id: sub.id, err: String(err) })
    }
  }

  return NextResponse.json({ sent })
```

- [ ] **Step 2: Read the request body once and support `type:'ended'`**

The handler currently destructures `{ callerName, callInvitationId }` from `await request.json()`. Change it to also read an optional `type` and reuse it. At the top of the handler:
```ts
  const { callerName, callInvitationId, type = 'ringing' } = await request.json()
```
Remove the placeholder `safeBody(request)` reference from Step 1 (it was shorthand) — `type` now comes from this single read. For `type === 'ended'`, after loading the invitation + subscriptions, send an end payload instead of an incoming-call payload:
```ts
  if (type === 'ended') {
    // Dismiss any ringing CallKit screen on the callee's devices.
    // NOTE: confirm the exact end-call push shape against the installed
    // expo-callkit-telecom version (see Task 13, Step 1). Implement the
    // documented "end"/"cancel" data payload here, send to voipSubs, return.
    // Until confirmed, the 'incomingCallTimeout' (45s) is the dismissal fallback.
  }
```

> The end-call payload shape is an external-library detail not fully documented on the landing page. Task 13 confirms it from the installed package before this branch is finalized. The core ring/answer/decline path (Tasks 1–12) does not depend on it.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/push/send/route.ts
git commit -m "feat(push): send APNs VoIP pushes, prune dead tokens, log failures

Replaces the broken silent Expo-push path. DB migration: fix_push_subscriptions_for_voip."
```

---

### Task 9: Dev tool to fire a test VoIP push

**Files:**
- Create: `video-call/scripts/send-test-voip.ts`

- [ ] **Step 1: Implement the script**

```ts
// Usage: APNS_KEY_ID=.. APNS_TEAM_ID=.. APNS_BUNDLE_ID=com.connekt.app \
//   APNS_PRIVATE_KEY="$(cat AuthKey.p8)" npx tsx scripts/send-test-voip.ts <deviceToken> <sandbox|production>
import { sendVoipPush } from '@/lib/push/apns'
import { buildIncomingCallPayload } from '@/lib/push/voipPayload'

async function main() {
  const [deviceToken, env] = process.argv.slice(2)
  if (!deviceToken) throw new Error('usage: send-test-voip.ts <deviceToken> <sandbox|production>')
  const payload = buildIncomingCallPayload({
    eventId: 'test-' + Date.now(),
    callInvitationId: 'test-invitation',
    callerId: 'test-caller',
    callerName: 'Test Caller',
    roomSlug: 'test-room',
  })
  const res = await sendVoipPush({ deviceToken, env: (env as 'sandbox' | 'production') ?? 'sandbox', payload })
  console.log(res)
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Verify it loads (without a real token it should error clearly, not crash on import)**

Run: `npx tsx scripts/send-test-voip.ts`
Expected: throws the usage error (proves imports resolve). Real send is exercised in Phase 3.

- [ ] **Step 3: Commit**

```bash
git add scripts/send-test-voip.ts
git commit -m "chore(push): dev script to send a test VoIP push"
```

---

## Phase 2 — Mobile client (`video-call-mobile`)

> No headless test runner here; native CallKit behavior is verified on device in Phase 3. Each task ends with a TypeScript check (`npx tsc --noEmit`) and a commit.

### Task 10: Install the library and configure the app

**Files:**
- Modify: `video-call-mobile/app.json`
- Modify: `video-call-mobile/eas.json`

- [ ] **Step 1: Install**

Run (in `video-call-mobile/`):
```bash
npx expo install expo-callkit-telecom
```

- [ ] **Step 2: Add the config plugin + iOS VoIP background mode in `app.json`**

In `expo.plugins`, add:
```json
["expo-callkit-telecom", { "incomingCallTimeout": 45 }]
```
In `expo.ios.infoPlist.UIBackgroundModes`, add `"voip"` so it reads:
```json
"UIBackgroundModes": ["audio", "remote-notification", "voip"]
```

- [ ] **Step 3: Add `EXPO_PUBLIC_APNS_ENV` to each `eas.json` build profile**

`development` and `preview` → `"EXPO_PUBLIC_APNS_ENV": "sandbox"`; `production` → `"EXPO_PUBLIC_APNS_ENV": "production"`. Add the key inside each profile's existing `env` object.

- [ ] **Step 4: Verify config is valid**

Run: `npx expo config --type public > /dev/null && echo OK`
Expected: `OK` (config parses; plugin resolves).

- [ ] **Step 5: Commit**

```bash
git add app.json eas.json package.json package-lock.json
git commit -m "feat(voip): add expo-callkit-telecom plugin + iOS voip background mode"
```

---

### Task 11: Id-based call actions + DRY the realtime hook

**Files:**
- Create: `video-call-mobile/lib/callActions.ts`
- Modify: `video-call-mobile/lib/hooks/useCallInvitations.ts`

- [ ] **Step 1: Create `lib/callActions.ts`** (id-based, usable without React state — required for cold-start answers)

```ts
import { supabase } from '@/lib/supabase';
import { log } from '@/lib/logger';

export async function acceptInvitation(invitationId: string): Promise<void> {
  await supabase.from('call_invitations').update({ status: 'accepted' }).eq('id', invitationId);
  log('incoming_call.accepted', { invitationId });
}

export async function declineInvitation(invitationId: string): Promise<void> {
  await supabase.from('call_invitations').update({ status: 'declined' }).eq('id', invitationId);
  log('incoming_call.declined', { invitationId });
}
```

- [ ] **Step 2: Refactor `useCallInvitations.ts` to reuse them** (DRY)

In `acceptCall`, replace the inline `supabase...update({ status: 'accepted' })` + log with:
```ts
    await acceptInvitation(incomingCall.id);
```
In `declineCall`, replace the inline update + log with:
```ts
    await declineInvitation(incomingCall.id);
```
Add the import at the top:
```ts
import { acceptInvitation, declineInvitation } from '@/lib/callActions';
```
Keep the surrounding state handling (`inFlightIdsRef.delete`, `setIncomingCall(null)`, returning `roomSlug`).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/callActions.ts lib/hooks/useCallInvitations.ts
git commit -m "refactor(calls): id-based acceptInvitation/declineInvitation, reuse in hook"
```

---

### Task 12: VoIP registration module

**Files:**
- Create: `video-call-mobile/lib/voip.ts`
- Modify: `video-call-mobile/app/index.tsx`
- Delete: `video-call-mobile/lib/push.ts` (after wiring `voip.ts`)

- [ ] **Step 1: Confirm exact export names** of the installed package

Run: `grep -RoE "export (function|const) [A-Za-z]+|addCall(Answered|Ended)Listener|registerVoIPPush|useVoIPPushToken|addVoIPPushTokenUpdatedListener" node_modules/expo-callkit-telecom/build node_modules/expo-callkit-telecom/src 2>/dev/null | sort -u`
Expected: confirms `registerVoIPPush`, the token accessor/hook, and the listener names. Use the exact names found in the code below.

- [ ] **Step 2: Implement `lib/voip.ts`**

```ts
import { registerVoIPPush, addVoIPPushTokenUpdatedListener } from 'expo-callkit-telecom';
import { supabase } from '@/lib/supabase';
import { log } from '@/lib/logger';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL!;
const APNS_ENV = process.env.EXPO_PUBLIC_APNS_ENV ?? 'production';

async function saveToken(token: string) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const res = await fetch(`${API_BASE_URL}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ voip_token: token, token_type: 'apns_voip', platform: 'ios', apns_env: APNS_ENV }),
  });
  if (!res.ok) log('voip.token_save_failed', { status: res.status });
  else log('voip.token_saved', {});
}

export function registerVoip(): () => void {
  registerVoIPPush();
  const sub = addVoIPPushTokenUpdatedListener((e: { token: string }) => {
    void saveToken(e.token);
  });
  return () => sub.remove();
}
```

> Adjust the listener's event field name (`e.token`) and `registerVoIPPush` signature to match what Step 1 prints.

- [ ] **Step 3: Wire it in `app/index.tsx`** — replace the registration effect

Replace:
```ts
  useEffect(() => {
    if (!user) return;
    registerForPushNotifications();
  }, [user]);
```
with:
```ts
  useEffect(() => {
    if (!user) return;
    const unsub = registerVoip();
    return unsub;
  }, [user]);
```
Update the import: remove `registerForPushNotifications` (and the now-unused `addNotificationResponseListener` if the tap handler effect is removed — see Task 13), add:
```ts
import { registerVoip } from '@/lib/voip';
```

- [ ] **Step 4: Delete the legacy module**

Run: `rm lib/push.ts`
Then remove any remaining imports of it (the sign-out cleanup `unregisterPushToken` call in `app/index.tsx:271` — replace with a no-op for now or delete; VoIP tokens are pruned server-side on APNs failure).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (no dangling references to `lib/push`).

- [ ] **Step 6: Commit**

```bash
git add lib/voip.ts app/index.tsx
git rm lib/push.ts
git commit -m "feat(voip): register APNs VoIP token and save to backend"
```

---

### Task 13: Root-level CallKit answer/end listeners (handles cold start) + caller-cancel push

**Files:**
- Modify: `video-call-mobile/app/_layout.tsx`
- Modify: `video-call-mobile/lib/hooks/useInitiateCall.ts`
- Modify: `video-call/app/api/push/send/route.ts` (finalize the `type:'ended'` branch from Task 8)

- [ ] **Step 1: Confirm the answered/ended event shape** from the installed package

Run: `sed -n '1,200p' node_modules/expo-callkit-telecom/build/*.d.ts 2>/dev/null | grep -iE "Answered|Ended|serverCallId|metadata|incomingCall|end" `
Expected: shows the event payload fields (notably `serverCallId` and `metadata`) and any end/cancel push shape. Use these exact fields below.

- [ ] **Step 2: Register listeners at the router root** in `app/_layout.tsx`

Add near the top-level component body (after `registerGlobals()` / polyfill imports, inside the component so `useRouter` is available):
```ts
import { addCallAnsweredListener, addCallEndedListener } from 'expo-callkit-telecom';
import { acceptInvitation, declineInvitation } from '@/lib/callActions';
import { useRouter } from 'expo-router';
// ...
  const router = useRouter();
  useEffect(() => {
    const answered = addCallAnsweredListener(async (e) => {
      const invitationId = e.serverCallId;
      const roomSlug = e.metadata?.roomSlug;
      await acceptInvitation(invitationId);
      if (roomSlug) router.push(`/room/${roomSlug}?autoJoin=true`);
    });
    const ended = addCallEndedListener(async (e) => {
      await declineInvitation(e.serverCallId);
    });
    return () => { answered.remove(); ended.remove(); };
  }, [router]);
```

> Match `e.serverCallId` / `e.metadata?.roomSlug` to the field names from Step 1. The library reports a cold-start answer once JS boots, so registering here (root) covers killed-app answers.

- [ ] **Step 3: Send a caller-cancel push** in `lib/hooks/useInitiateCall.ts`

Find where the caller cancels (updates `call_invitations` to `cancelled`). Immediately after that update, add:
```ts
    fetch(`${API_BASE_URL}/api/push/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ callInvitationId: data.id, callerName, type: 'ended' }),
    }).catch(() => {});
```
(Reuse the existing `API_BASE_URL`, `session`, `callerName`, and invitation id variables already present in that file.)

- [ ] **Step 4: Finalize the backend `type:'ended'` branch** (Task 8, Step 2) using the end-call push shape confirmed in Step 1, sending to `voipSubs`. If the installed version exposes no server-end payload, leave the 45s `incomingCallTimeout` as the documented fallback and log that active-cancel is deferred.

- [ ] **Step 5: Typecheck (mobile) + build (web)**

Run (mobile): `npx tsc --noEmit` → no errors.
Run (web): `npm run build` → succeeds.

- [ ] **Step 6: Commit (two repos)**

```bash
# in video-call-mobile
git add app/_layout.tsx lib/hooks/useInitiateCall.ts
git commit -m "feat(voip): root CallKit answer/end listeners + caller-cancel push"
# in video-call
git add app/api/push/send/route.ts
git commit -m "feat(push): finalize type:ended VoIP cancel push"
```

---

### Task 14: Demote the in-app overlay to foreground-secondary

**Files:**
- Modify: `video-call-mobile/app/index.tsx`

- [ ] **Step 1: Keep `IncomingCallOverlay` only as a foreground convenience**

The CallKit UI is now primary for all states. Leave the `useIncomingCalls` realtime subscription and `IncomingCallOverlay` in place (they still help when the app is already foregrounded and for `cancelled`/`missed` dismissal), but ensure answering via either path is idempotent: both `acceptCall()` (overlay) and the CallKit `acceptInvitation()` write `status:'accepted'` by id, so a double-accept is harmless. No behavioral change required beyond confirming both navigate to `/room/[slug]?autoJoin=true`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit (only if changes were needed)**

```bash
git add app/index.tsx
git commit -m "chore(calls): keep in-app overlay as foreground-secondary to CallKit"
```

---

## Phase 3 — Credentials, build, device verification (GATED on user)

### Task 15: Apple credentials + backend env + deploy

**Files:** none in repo (secrets); `video-call/.env.local`, `.env.example`, Vercel env.

- [ ] **Step 1 (user):** In the Apple Developer portal, create an **APNs Auth Key (.p8)** with push enabled (works for both alert + VoIP), note the **Key ID** (Team ID is `8ZSFN9U3R5`). Confirm the App ID `com.connekt.app` has Push Notifications capability.

- [ ] **Step 2:** Add to `video-call/.env.local` and Vercel project env:
```
APNS_KEY_ID=<key id>
APNS_TEAM_ID=8ZSFN9U3R5
APNS_BUNDLE_ID=com.connekt.app
APNS_PRIVATE_KEY=<contents of AuthKey.p8, newlines preserved or \n-escaped>
```
Add the same keys (without values) to `.env.example`. Commit only `.env.example`.

- [ ] **Step 3:** Redeploy `video-call` to Vercel so `/api/push/*` reflects the new code (mobile hits the deployed URL).

- [ ] **Step 4:** Smoke-test the deployed VoIP path with the dev script once a device token exists (after Task 16, Step 2): `npx tsx scripts/send-test-voip.ts <token> sandbox`. Expected: `{ ok: true, status: 200 }`.

### Task 16: Dev-client build + device test matrix

- [ ] **Step 1 (user):** Build a new iOS dev client (native module added):
```bash
cd video-call-mobile && eas build --profile development --platform ios
```
Install on a **physical iPhone** (push tokens don't work on the simulator).

- [ ] **Step 2:** Launch, log in, grant the call/notification prompt. Verify a row appears:
```sql
select user_id, token_type, apns_env, left(voip_token, 8) from push_subscriptions where token_type='apns_voip';
```
Expected: one `apns_voip` / `sandbox` row (the bug is fixed — previously 0).

- [ ] **Step 3:** From a second account, call this device and verify the **CallKit full-screen ring** in each state:
  - App foreground → rings, answer joins LiveKit.
  - App backgrounded → rings, answer joins.
  - App **fully killed + phone locked** → rings over lock screen, answer cold-starts into `/room/[slug]?autoJoin=true` and joins.
  - Decline → caller sees the call stop (status `declined`).
  - Caller cancels before answer → callee ring dismisses (active-cancel push, or within the 45s timeout fallback).

- [ ] **Step 4:** Confirm audio works both directions on answer (the library owns `RTCAudioSession`; verify no double audio-session management remains in the room/LiveKit setup).

- [ ] **Step 5:** Mark the plan's Phase 3 checklist complete and summarize results to the user.

---

## Self-Review notes

- **Spec coverage:** schema fix (Task 1), self-hosted APNs transport (Tasks 4–8), `expo-callkit-telecom` client + LiveKit audio (Tasks 10–14), uniform native UI (Task 14), answer/decline/cancel data flow (Tasks 11, 13), error handling + dead-token pruning + logging (Tasks 5, 8), prerequisites + manual device matrix (Tasks 15–16). iOS-only; Android explicitly deferred per spec.
- **Known external-API risks (verify against the installed package, not memory):** exact export/event field names for `expo-callkit-telecom` (Tasks 12 Step 1, 13 Step 1) and the server-side end-call push shape (Task 13 Step 4). The core ring/answer/decline path does not depend on the end-call shape.
- **APNs env** is resolved deterministically via `EXPO_PUBLIC_APNS_ENV` per EAS profile (no `__DEV__` guessing).
