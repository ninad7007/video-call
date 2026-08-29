import type { VoipPayload } from './voipPayload'

export interface FcmMessage {
  message: {
    token: string
    data: Record<string, string>
    android: { priority: 'HIGH' }
  }
}

/**
 * expo-callkit-telecom's ExpoCallKitTelecomMessagingService reads a *data-only*
 * message shaped as:
 *   data["messageType"] = "incomingCall"
 *   data["incomingCall"] = JSON string of the IncomingCallEvent (camelCase)
 *
 * Data-only + HIGH priority is what lets the service wake a backgrounded or
 * terminated app; adding a `notification` block would hand the message to the
 * system tray instead and the call would never be reported.
 */
export function buildFcmMessage(deviceToken: string, payload: VoipPayload): FcmMessage {
  return {
    message: {
      token: deviceToken,
      data: {
        messageType: 'incomingCall',
        incomingCall: JSON.stringify(payload.incomingCall),
      },
      android: { priority: 'HIGH' },
    },
  }
}

const DEAD_REASONS = new Set(['UNREGISTERED', 'INVALID_ARGUMENT', 'SENDER_ID_MISMATCH'])

/** Mirrors isDeadTokenReason for APNs: which failures mean "drop this row". */
export function isDeadFcmReason(status: number, reason?: string): boolean {
  if (status === 404) return true
  return reason ? DEAD_REASONS.has(reason) : false
}
