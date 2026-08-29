import { test, expect } from 'vitest'
import { groupSubscriptions } from './subscriptions'
import type { PushRow } from './subscriptions'

test('splits web and apns_voip rows', () => {
  const rows = [
    { id: '1', endpoint: 'https://x', p256dh: 'a', auth_key: 'b', voip_token: null, token_type: null },
    { id: '2', endpoint: null, voip_token: 'vt', token_type: 'apns_voip', apns_env: 'production' },
    { id: '3', endpoint: null, voip_token: 'vt2', token_type: 'apns_voip', apns_env: 'sandbox' },
  ]
  const { webSubs, voipSubs } = groupSubscriptions(rows as unknown as PushRow[])
  expect(webSubs.map(s => s.id)).toEqual(['1'])
  expect(voipSubs.map(s => s.id)).toEqual(['2', '3'])
})

test('ignores apns_voip rows with no token', () => {
  const rows = [{ id: '9', voip_token: null, token_type: 'apns_voip' }]
  const { voipSubs } = groupSubscriptions(rows as unknown as PushRow[])
  expect(voipSubs).toEqual([])
})

test('splits fcm rows out from apns_voip rows', () => {
  const rows = [
    { id: '1', voip_token: 'apns-tok', token_type: 'apns_voip' },
    { id: '2', voip_token: 'fcm-tok', token_type: 'fcm', platform: 'android' },
  ]
  const { voipSubs, fcmSubs } = groupSubscriptions(rows as unknown as PushRow[])
  expect(voipSubs.map(s => s.id)).toEqual(['1'])
  expect(fcmSubs.map(s => s.id)).toEqual(['2'])
})

test('ignores fcm rows with no token', () => {
  const rows = [{ id: '9', voip_token: null, token_type: 'fcm' }]
  const { fcmSubs } = groupSubscriptions(rows as unknown as PushRow[])
  expect(fcmSubs).toEqual([])
})
