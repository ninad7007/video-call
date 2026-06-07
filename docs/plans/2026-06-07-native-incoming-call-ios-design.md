# Native Incoming-Call Notifications (iOS) — Design

**Date:** 2026-06-07
**Status:** Approved design, pre-implementation
**Scope:** iOS only (first spec). Android is a deliberate follow-up — see "Out of Scope".

## Problem

Incoming calls do not notify the callee's phone at all. Diagnosis confirmed two
root causes, with the first being decisive:

1. **The mobile push token is never stored.** `push_subscriptions` was designed
   for web-push: `p256dh` and `auth_key` are `NOT NULL` with no default, and the
   only unique constraint is `UNIQUE (user_id, endpoint)`. The mobile app upserts
   `{ user_id, expo_token }` with `onConflict: 'user_id,expo_token'`
   (`video-call-mobile/lib/push.ts:50`). That write fails every time — NOT NULL
   violation *and* missing conflict target — and the error is silently swallowed.
   A DB check confirmed **0** mobile tokens stored (only 2 web rows). With no
   token, `/api/push/send` sends the call push to an empty list.
2. **No native call UI exists.** Even with a working token, the current design
   (Expo push + a Supabase realtime subscription in `useCallInvitations`) can at
   best produce a banner, and the realtime path only runs while the app is alive.
   There is no CallKit/PushKit integration, so nothing rings on a locked or
   killed phone.

## Goal

When a call comes in, the callee's iPhone shows the **full-screen native CallKit
ringing screen over the lock screen, even when the app is backgrounded or fully
killed** — the WhatsApp/Google Meet experience. Answering joins the LiveKit room;
declining stops the caller's ring.

## Success Criteria

- A registered iPhone rings with the native CallKit UI when: app foreground, app
  backgrounded, and app fully killed / device locked.
- Answer → app opens to `/room/[slug]?autoJoin=true` and joins LiveKit.
- Decline/end → `call_invitations` marked so the caller stops ringing.
- Caller cancel before answer → callee's ring is dismissed.
- Dead/expired tokens are pruned; send failures are logged, not swallowed.

## Approach

**Transport:** Self-hosted (Approach A). The `video-call` Next.js backend signs
and sends **APNs VoIP** pushes directly. No third-party push/call vendor. This is
mandatory because Expo's push service (`exp.host`) cannot send iOS VoIP/PushKit
pushes, which are required for a CallKit ring on a locked/killed device.

**Client library:** [`expo-callkit-telecom`](https://github.com/mfairley/expo-callkit-telecom)
(MIT). Chosen over the older `react-native-callkeep` + `react-native-voip-push-notification`
combo because it is built for the Expo config-plugin workflow, is tested on the
**New Architecture** (the app has `newArchEnabled: true`), and is explicitly
designed for LiveKit — it owns the iOS `RTCAudioSession` (manual-audio mode). Its
native layer parses the VoIP push and reports the call to CallKit *before JS
runs*, which is what enables cold-start ringing.

**Uniform native UI:** All incoming calls (foreground/background/killed) route
through the native CallKit UI. The existing in-app `IncomingCallOverlay` +
`useCallInvitations` realtime path is demoted to a secondary role: signalling
caller-cancel while the app is in the foreground, and in-call state. It is no
longer the primary ring.

## Architecture

Three layers, reusing the existing call-invitation flow.

### 1. Client — `video-call-mobile`

- Add `expo-callkit-telecom` and its config plugin to `app.json`:
  ```json
  ["expo-callkit-telecom", { "sounds": ["./assets/sounds/ringtone.wav"], "incomingCallTimeout": 45 }]
  ```
- Add `UIBackgroundModes: ["voip"]` to iOS `infoPlist` (alongside existing
  `audio`, `remote-notification`).
- On authenticated startup (replacing the current `registerForPushNotifications`
  call in `app/index.tsx`): call `registerVoIPPush()`, read `useVoIPPushToken()`
  → `{ token, type }` (`type === 'APNS_VOIP'` on iOS), and persist it by POSTing
  to the extended `/api/push/subscribe` endpoint (see backend). This single
  server path — rather than a direct Supabase client write — keeps column
  handling in one place and matches the web client.
- Listeners:
  - `addCallAnsweredListener` → mark `call_invitations` accepted (reuse existing
    `acceptCall()` logic from the mobile `useCallInvitations`), then navigate to
    `/room/[slug]?autoJoin=true`.
  - `addCallEndedListener` → mark `call_invitations` declined (reuse existing
    decline logic) so the caller's realtime subscription stops the ring.
  - `addVoIPPushTokenUpdatedListener` → re-upsert the new token.
- Audio: do **not** call LiveKit's `AudioSession.startAudioSession()` /
  `stopAudioSession()` — the library owns `RTCAudioSession`. Verify against the
  current room/audio setup and remove any conflicting calls.
- The legacy `lib/push.ts` Expo-token path is retired for calls.

### 2. Backend — `video-call`

- `lib/push/apns.ts`: ES256-sign a JWT with the Apple `.p8` VoIP auth key
  (`APNS_KEY_ID`, `APNS_TEAM_ID`), POST to APNs with headers
  `apns-push-type: voip`, `apns-topic: com.connekt.app.voip`. Support both
  `api.sandbox.push.apple.com` (dev builds) and `api.push.apple.com` (prod) —
  selected by the token's stored `apns_env`.
- VoIP payload (per `expo-callkit-telecom`):
  ```json
  { "incomingCall": {
      "eventId": "<uuid>",
      "serverCallId": "<call_invitation id>",
      "caller": { "id": "<caller user id>", "displayName": "<caller name>" },
      "hasVideo": true
  } }
  ```
- `app/api/push/send/route.ts`: branch by `token_type`. For `apns_voip` tokens
  send the VoIP push; keep the existing `web-push` path for browser rows. Remove
  the broken raw Expo-push block. **Log every result.** On APNs `410` /
  `BadDeviceToken` / `Unregistered`, delete the dead token row.
- A "call ended / canceled" VoIP push so a caller-cancel before answer dismisses
  the callee's CallKit ring (payload variant per the library's end-call report).
  Triggered when the caller cancels (the caller path already updates
  `call_invitations`; add the push send there).
- `app/api/push/subscribe/route.ts`: accept `{ voip_token, token_type, platform,
  apns_env }` and upsert into the fixed schema.

### 3. Database — Supabase (`wzpkqhhjvtztvcupwoqe`)

Migration (DDL — requires explicit user approval before running):

- `ALTER COLUMN p256dh DROP NOT NULL`, `ALTER COLUMN auth_key DROP NOT NULL`
  (web-only fields).
- `ADD COLUMN voip_token text`, `token_type text`, `platform text`,
  `apns_env text`.
- `CREATE UNIQUE INDEX ... ON push_subscriptions (user_id, voip_token) WHERE
  voip_token IS NOT NULL` — gives the client upsert a real conflict target.
- The unused `expo_token` column is retired for calls (left in place for now;
  dropping it is a later cleanup).
- RLS is already correct (`auth.uid() = user_id` for writes; read = true).

## Data Flow (incoming call)

1. Caller inserts `call_invitations` row (`status='ringing'`) — unchanged.
2. Caller client POSTs `/api/push/send` — unchanged trigger.
3. Backend looks up the callee's `apns_voip` token(s) and sends a VoIP push.
4. iOS PushKit wakes the app's native layer; `expo-callkit-telecom` reports the
   call to CallKit → full-screen ring appears (locked/killed included).
5. **Answer** → `addCallAnsweredListener` → mark accepted → navigate to
   `/room/[slug]?autoJoin=true` → fetch LiveKit JWT → join.
6. **Decline/end** → `addCallEndedListener` → mark declined → caller's realtime
   subscription stops the ring.
7. **Caller cancel before answer** → backend sends "call ended" VoIP push →
   callee CallKit ring dismissed.

## Error Handling

- **Token write failures** are surfaced (no more silent swallow); registration
  logs failures.
- **Send failures** are logged with the APNs status/reason; dead tokens
  (`410`/`BadDeviceToken`/`Unregistered`) are pruned.
- **Payload validation** before send: a malformed VoIP payload can cause iOS to
  *terminate* the app for failing to report a call, so the backend validates
  required fields (`eventId`, `serverCallId`, `caller.id`) before sending.
- **APNs env mismatch** (`BadDeviceToken`) handled via per-token `apns_env`.

## Prerequisites (external — user provides)

- Apple VoIP-capable APNs **`.p8` auth key** (Team ID `8ZSFN9U3R5`). Env vars in
  `video-call`: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`,
  `APNS_BUNDLE_ID` (`com.connekt.app`).
- iOS `UIBackgroundModes: ["voip"]` + VoIP entitlement (config plugin handles
  `aps-environment`).
- A new custom **dev-client build** (native module added); backend changes
  redeployed to Vercel (`https://video-call-seven-liart.vercel.app`) so the
  mobile app hits the updated `/api/push/*`.

## Testing

- **Unit (backend):** APNs ES256 JWT signing; VoIP payload builder;
  `/api/push/send` routing by `token_type`; dead-token pruning on error codes.
- **Dev tool:** a script/endpoint to fire a test VoIP push to a registered token.
- **DB:** verify a token row is actually written after login (the currently
  broken behavior).
- **Manual device matrix (physical iPhone, can't be automated headlessly):**
  ring + answer + decline with app foreground, backgrounded, and fully killed /
  locked; caller-cancel dismissal. This is an explicit phase gate.

## Out of Scope (this spec)

- **Android** (FCM v1 high-priority data messages, core-telecom full-screen
  intent, Firebase project + `google-services.json`, `minSdkVersion` 24→26).
  Planned as the next spec once iOS is verified. `expo-callkit-telecom` already
  supports Android, so the client side largely carries over; the new work is the
  FCM transport and Firebase credentials.
- Missed-call list / call history UI.
- Dropping the legacy `expo_token` column (later cleanup).

## References

- `expo-callkit-telecom`: https://expo-callkit-telecom.mfairley.com/ ·
  https://github.com/mfairley/expo-callkit-telecom
- Existing call flow: `lib/hooks/useInitiateCall.ts`, `useCallInvitations.ts`
  (both apps); `app/api/push/send/route.ts`, `app/api/push/subscribe/route.ts`
  (web).
