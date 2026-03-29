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
