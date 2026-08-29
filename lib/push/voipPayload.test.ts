import { test, expect } from 'vitest'
import { buildIncomingCallPayload, validateIncomingCallPayload } from './voipPayload'

test('builds the expo-callkit-telecom incomingCall payload', () => {
  const p = buildIncomingCallPayload({
    eventId: 'evt-1',
    callInvitationId: 'inv-1',
    callerId: 'user-1',
    callerName: 'Asha',
    roomSlug: 'room-xyz',
  })
  expect(p).toEqual({
    incomingCall: {
      eventId: 'evt-1',
      serverCallId: 'inv-1',
      caller: { id: 'user-1', displayName: 'Asha' },
      hasVideo: true,
      metadata: { roomSlug: 'room-xyz' },
    },
  })
})

test('validate returns errors for missing required fields', () => {
  const bad = { incomingCall: { eventId: '', serverCallId: '', caller: { id: '', displayName: '' }, hasVideo: true, metadata: { roomSlug: '' } } }
  expect(validateIncomingCallPayload(bad).length).toBeGreaterThan(0)
})

test('validate passes a well-formed payload', () => {
  const ok = buildIncomingCallPayload({ eventId: 'e', callInvitationId: 'i', callerId: 'c', callerName: 'n', roomSlug: 'r' })
  expect(validateIncomingCallPayload(ok)).toEqual([])
})
