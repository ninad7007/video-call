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
