import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()

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

  // Expo push token (mobile)
  if (body.expo_token) {
    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: user.id,
        expo_token: body.expo_token,
      },
      { onConflict: 'user_id,expo_token' }
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // Web push (browser)
  const { endpoint, keys } = body
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
