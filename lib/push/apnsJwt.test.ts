import { test, expect, beforeEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { buildApnsJwt, resetApnsJwtCache } from './apnsJwt'

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string

beforeEach(() => {
  resetApnsJwtCache()
  process.env.APNS_KEY_ID = 'KEY123'
  process.env.APNS_TEAM_ID = 'TEAM456'
  process.env.APNS_PRIVATE_KEY = pem
})

test('signs an ES256 JWT with kid + iss', () => {
  const token = buildApnsJwt({ now: 1_000 })
  const decoded = jwt.decode(token, { complete: true }) as {
    header: { alg: string; kid: string }
    payload: { iss: string; iat: number }
  }
  expect(decoded.header.alg).toBe('ES256')
  expect(decoded.header.kid).toBe('KEY123')
  expect(decoded.payload.iss).toBe('TEAM456')
  expect(decoded.payload.iat).toBe(1_000)
})

test('caches within 50 minutes, refreshes after', () => {
  const a = buildApnsJwt({ now: 1_000 })
  const b = buildApnsJwt({ now: 1_000 + 49 * 60 })
  expect(b).toBe(a)
  const c = buildApnsJwt({ now: 1_000 + 51 * 60 })
  expect(c).not.toBe(a)
})

test('throws when env vars missing', () => {
  delete process.env.APNS_KEY_ID
  resetApnsJwtCache()
  expect(() => buildApnsJwt({ now: 1 })).toThrow()
})
