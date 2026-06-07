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
