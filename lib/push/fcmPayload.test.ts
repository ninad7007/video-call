import { test, expect } from 'vitest'
import { buildFcmMessage, isDeadFcmReason } from './fcmPayload'
import { buildIncomingCallPayload } from './voipPayload'

const payload = buildIncomingCallPayload({
  eventId: 'evt-1',
  callInvitationId: 'inv-1',
  callerId: 'user-1',
  callerName: 'Ninad',
  roomSlug: 'abc123',
})

test('sends a data-only message so a terminated app is woken', () => {
  const msg = buildFcmMessage('device-tok', payload)
  expect(msg.message.token).toBe('device-tok')
  expect(msg.message.android.priority).toBe('HIGH')
  // A notification block would route to the system tray and the call would
  // never reach ExpoCallKitTelecomMessagingService.
  expect(msg.message).not.toHaveProperty('notification')
})

test('nests the call event as a JSON string under the documented keys', () => {
  const { data } = buildFcmMessage('device-tok', payload).message
  expect(data.messageType).toBe('incomingCall')
  expect(JSON.parse(data.incomingCall)).toEqual(payload.incomingCall)
})

test('every data value is a string, as FCM requires', () => {
  const { data } = buildFcmMessage('device-tok', payload).message
  for (const value of Object.values(data)) expect(typeof value).toBe('string')
})

test('classifies dead tokens', () => {
  expect(isDeadFcmReason(404)).toBe(true)
  expect(isDeadFcmReason(400, 'UNREGISTERED')).toBe(true)
  expect(isDeadFcmReason(400, 'SENDER_ID_MISMATCH')).toBe(true)
  expect(isDeadFcmReason(503, 'UNAVAILABLE')).toBe(false)
  expect(isDeadFcmReason(500)).toBe(false)
})
