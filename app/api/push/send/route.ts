import { NextRequest, NextResponse } from 'next/server'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const webpush = require('web-push')
import { createClientFromRequest } from '@/lib/supabase/server'
import { groupSubscriptions, type PushRow } from '@/lib/push/subscriptions'
import { buildIncomingCallPayload, validateIncomingCallPayload } from '@/lib/push/voipPayload'
import { sendVoipPush, isDeadTokenReason, type ApnsEnv } from '@/lib/push/apns'
import { randomUUID } from 'node:crypto'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const supabase = await createClientFromRequest(request)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { callerName, callInvitationId, type = 'ringing' } = await request.json()

  // Validate the call invitation (caller-owned). For ringing we additionally
  // require status='ringing'; for 'ended' (caller cancelled) any status is fine.
  const baseQuery = supabase
    .from('call_invitations')
    .select('id, callee_id, room_slug')
    .eq('id', callInvitationId)
    .eq('caller_id', user.id)
  const { data: invitation } =
    type === 'ringing'
      ? await baseQuery.eq('status', 'ringing').single()
      : await baseQuery.single()

  if (!invitation) return NextResponse.json({ error: 'Invalid invitation' }, { status: 403 })

  // Get callee's push subscriptions
  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', invitation.callee_id)

  if (!subscriptions || subscriptions.length === 0) {
    return NextResponse.json({ sent: 0 })
  }

  const { webSubs, voipSubs } = groupSubscriptions(subscriptions as unknown as PushRow[])

  if (type === 'ended') {
    // Deliberately a no-op: PushKit reports *every* VoIP push to CallKit as a
    // new incoming call (Apple terminates the app otherwise), so an "end call"
    // push would ring the callee a second time rather than dismiss the first.
    // The callee tears the native call down itself by watching the invitation
    // row — see watchForCallerCancel in the mobile app's app/_layout.tsx.
    return NextResponse.json({ sent: 0 })
  }

  let sent = 0

  // --- Web push (browser) ---
  if (
    webSubs.length > 0 &&
    process.env.VAPID_SUBJECT &&
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY
  ) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT,
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    )
    const payload = JSON.stringify({
      title: `${callerName} is calling`,
      body: 'Tap to answer',
      roomSlug: invitation.room_slug,
      callInvitationId,
    })
    for (const sub of webSubs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint!, keys: { p256dh: sub.p256dh!, auth: sub.auth_key! } },
          payload
        )
        sent++
      } catch (err: unknown) {
        const e = err as { statusCode?: number }
        if (e.statusCode === 410 || e.statusCode === 404) {
          await supabase.from('push_subscriptions').delete().eq('id', sub.id)
        }
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
      const res = await sendVoipPush({
        deviceToken: sub.voip_token!,
        env: (sub.apns_env as ApnsEnv) ?? 'production',
        payload,
      })
      if (res.ok) {
        sent++
      } else {
        console.error('[push/send] APNs VoIP failed', { id: sub.id, status: res.status, reason: res.reason })
        if (isDeadTokenReason(res.status, res.reason)) {
          await supabase.from('push_subscriptions').delete().eq('id', sub.id)
        }
      }
    } catch (err) {
      console.error('[push/send] APNs VoIP threw', { id: sub.id, err: String(err) })
    }
  }

  return NextResponse.json({ sent })
}
