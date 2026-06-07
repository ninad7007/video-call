export interface IncomingCallPayloadInput {
  eventId: string
  callInvitationId: string
  callerId: string
  callerName: string
  roomSlug: string
  hasVideo?: boolean
}

export interface VoipPayload {
  incomingCall: {
    eventId: string
    serverCallId: string
    caller: { id: string; displayName: string }
    hasVideo: boolean
    metadata: { roomSlug: string }
  }
}

export function buildIncomingCallPayload(input: IncomingCallPayloadInput): VoipPayload {
  return {
    incomingCall: {
      eventId: input.eventId,
      serverCallId: input.callInvitationId,
      caller: { id: input.callerId, displayName: input.callerName },
      hasVideo: input.hasVideo ?? true,
      metadata: { roomSlug: input.roomSlug },
    },
  }
}

export function validateIncomingCallPayload(p: VoipPayload): string[] {
  const errors: string[] = []
  const c = p?.incomingCall
  if (!c) return ['missing incomingCall']
  if (!c.eventId) errors.push('missing eventId')
  if (!c.serverCallId) errors.push('missing serverCallId')
  if (!c.caller?.id) errors.push('missing caller.id')
  if (!c.caller?.displayName) errors.push('missing caller.displayName')
  if (!c.metadata?.roomSlug) errors.push('missing metadata.roomSlug')
  return errors
}
