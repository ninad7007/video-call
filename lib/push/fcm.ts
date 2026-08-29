import jwt from 'jsonwebtoken'
import { buildFcmMessage } from './fcmPayload'
import type { VoipPayload } from './voipPayload'

export interface FcmResult { ok: boolean; status: number; reason?: string }

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'

let cache: { token: string; expiresAt: number } | null = null

export function resetFcmTokenCache(): void {
  cache = null
}

/**
 * FCM v1 needs a short-lived OAuth2 access token, obtained by signing a JWT
 * with the service account key and exchanging it. Unlike APNs (where the
 * signed JWT *is* the credential) this costs a network round trip, so the
 * token is cached until shortly before it expires.
 */
export async function getFcmAccessToken(now = Math.floor(Date.now() / 1000)): Promise<string> {
  if (cache && now < cache.expiresAt - 60) return cache.token

  const clientEmail = process.env.FCM_CLIENT_EMAIL
  const privateKey = process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!clientEmail || !privateKey) {
    throw new Error('FCM_CLIENT_EMAIL and FCM_PRIVATE_KEY must be set')
  }

  const assertion = jwt.sign(
    { iss: clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 },
    privateKey,
    { algorithm: 'RS256' }
  )

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!res.ok) {
    throw new Error(`FCM token exchange failed: ${res.status} ${await res.text()}`)
  }

  const body = (await res.json()) as { access_token: string; expires_in: number }
  cache = { token: body.access_token, expiresAt: now + body.expires_in }
  return body.access_token
}

export async function sendFcmDataMessage(params: {
  deviceToken: string
  payload: VoipPayload
}): Promise<FcmResult> {
  const projectId = process.env.FCM_PROJECT_ID
  if (!projectId) throw new Error('FCM_PROJECT_ID must be set')

  const accessToken = await getFcmAccessToken()
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildFcmMessage(params.deviceToken, params.payload)),
  })

  if (res.ok) return { ok: true, status: res.status }

  let reason: string | undefined
  try {
    const body = (await res.json()) as {
      error?: { status?: string; details?: { errorCode?: string }[] }
    }
    reason = body.error?.details?.find((d) => d.errorCode)?.errorCode ?? body.error?.status
  } catch {
    /* non-JSON error body */
  }
  return { ok: false, status: res.status, reason }
}
