import http2 from 'node:http2'
import { buildApnsJwt } from './apnsJwt'
import type { VoipPayload } from './voipPayload'

export type ApnsEnv = 'sandbox' | 'production'
export interface ApnsResult { ok: boolean; status: number; reason?: string }

const HOSTS: Record<ApnsEnv, string> = {
  sandbox: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
}

const DEAD_REASONS = new Set(['Unregistered', 'BadDeviceToken', 'DeviceTokenNotForTopic'])

export function isDeadTokenReason(status: number, reason?: string): boolean {
  if (status === 410) return true
  return reason ? DEAD_REASONS.has(reason) : false
}

export function buildApnsHeaders(p: { deviceToken: string; topic: string; jwt: string; contentLength: number }) {
  return {
    ':method': 'POST',
    ':path': `/3/device/${p.deviceToken}`,
    authorization: `bearer ${p.jwt}`,
    'apns-push-type': 'voip',
    'apns-topic': p.topic,
    'apns-priority': '10',
    'content-type': 'application/json',
    'content-length': p.contentLength,
  } as const
}

export async function sendVoipPush(params: {
  deviceToken: string
  env: ApnsEnv
  payload: VoipPayload
  topic?: string
}): Promise<ApnsResult> {
  const topic = params.topic ?? `${process.env.APNS_BUNDLE_ID}.voip`
  const body = Buffer.from(JSON.stringify(params.payload))
  const headers = buildApnsHeaders({ deviceToken: params.deviceToken, topic, jwt: buildApnsJwt(), contentLength: body.length })
  const client = http2.connect(HOSTS[params.env])
  try {
    return await new Promise<ApnsResult>((resolve, reject) => {
      const req = client.request(headers)
      let status = 0
      let data = ''
      req.on('response', (h) => { status = Number(h[':status']) })
      req.setEncoding('utf8')
      req.on('data', (chunk) => { data += chunk })
      req.on('end', () => {
        if (status === 200) return resolve({ ok: true, status })
        let reason: string | undefined
        try { reason = JSON.parse(data)?.reason } catch { /* non-JSON body */ }
        resolve({ ok: false, status, reason })
      })
      req.on('error', reject)
      req.end(body)
    })
  } finally {
    client.close()
  }
}
