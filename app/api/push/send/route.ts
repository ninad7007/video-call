import { NextRequest, NextResponse } from 'next/server'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const webpush = require('web-push')
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  if (!process.env.VAPID_SUBJECT || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return NextResponse.json({ error: 'Push not configured' }, { status: 500 })
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )

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
