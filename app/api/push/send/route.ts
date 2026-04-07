import { NextRequest, NextResponse } from 'next/server'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const webpush = require('web-push')
import { createClient } from '@/lib/supabase/server'

async function sendExpoPush(tokens: string[], payload: object) {
  const messages = tokens.map((token) => ({
    to: token,
    sound: 'default',
    priority: 'high',
    ...payload,
  }))

  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    })
  } catch {
    // Expo push failed — non-critical
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { callerName, callInvitationId } = await request.json()

  // Validate the call invitation
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

  let sent = 0

  // Separate web push and Expo push subscriptions
  const webSubs = subscriptions.filter((s) => s.endpoint && !s.expo_token)
  const expoTokens = subscriptions
    .filter((s) => s.expo_token)
    .map((s) => s.expo_token as string)

  // Send web push notifications
  if (webSubs.length > 0) {
    if (process.env.VAPID_SUBJECT && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
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
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
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
    }
  }

  // Send Expo push notifications
  if (expoTokens.length > 0) {
    await sendExpoPush(expoTokens, {
      title: `${callerName} is calling`,
      body: 'Tap to answer',
      data: {
        roomSlug: invitation.room_slug,
        callInvitationId,
      },
    })
    sent += expoTokens.length
  }

  return NextResponse.json({ sent })
}
