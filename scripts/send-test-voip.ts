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
