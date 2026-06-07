import jwt from 'jsonwebtoken'

let cache: { token: string; iat: number } | null = null

export function resetApnsJwtCache(): void {
  cache = null
}

export function buildApnsJwt(opts?: { now?: number }): string {
  const now = opts?.now ?? Math.floor(Date.now() / 1000)
  if (cache && now - cache.iat < 50 * 60) return cache.token

  const keyId = process.env.APNS_KEY_ID
  const teamId = process.env.APNS_TEAM_ID
  const privateKey = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!keyId || !teamId || !privateKey) {
    throw new Error('APNS_KEY_ID, APNS_TEAM_ID and APNS_PRIVATE_KEY must be set')
  }

  const token = jwt.sign({ iss: teamId, iat: now }, privateKey, {
    algorithm: 'ES256',
    header: { alg: 'ES256', kid: keyId },
  })
  cache = { token, iat: now }
  return token
}
