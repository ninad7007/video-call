import { test, expect, vi, beforeEach } from 'vitest'

// createServerClient is the only thing we care about here: which auth material
// the route hands it. Capture the options instead of talking to Supabase.
type ClientOptions = {
  global?: { headers?: Record<string, string> }
  cookies: { getAll: () => unknown[] }
}
const createServerClient = vi.fn((_url: string, _key: string, _opts: ClientOptions) => ({
  marker: 'client',
}))
vi.mock('@supabase/ssr', () => ({
  createServerClient: (url: string, key: string, opts: ClientOptions) =>
    createServerClient(url, key, opts),
}))

const cookieStore = { getAll: () => [{ name: 'sb-token', value: 'from-cookie' }], set: () => {} }
vi.mock('next/headers', () => ({ cookies: async () => cookieStore }))

beforeEach(() => {
  createServerClient.mockClear()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
})

async function optionsFor(headers: Record<string, string>) {
  const { createClientFromRequest } = await import('./server')
  await createClientFromRequest(new Request('https://x/api/push/send', { headers }))
  const opts = createServerClient.mock.calls[0]?.[2]
  if (!opts) throw new Error('createServerClient was not called')
  return opts
}

// Regression: both push routes used a cookie-only client, so every native
// request (which authenticates with a bearer token) returned 401 and no VoIP
// token was ever stored.
test('forwards a bearer token to PostgREST so RLS applies', async () => {
  const opts = await optionsFor({ Authorization: 'Bearer jwt-123' })
  expect(opts.global?.headers?.Authorization).toBe('Bearer jwt-123')
})

test('ignores cookies when a bearer token is present', async () => {
  const opts = await optionsFor({ Authorization: 'Bearer jwt-123' })
  expect(opts.cookies.getAll()).toEqual([])
})

test('falls back to the cookie session for web requests', async () => {
  const opts = await optionsFor({})
  expect(opts.global?.headers?.Authorization).toBeUndefined()
  expect(opts.cookies.getAll()).toEqual([{ name: 'sb-token', value: 'from-cookie' }])
})

test('a non-bearer Authorization scheme does not hijack the cookie path', async () => {
  const opts = await optionsFor({ Authorization: 'Basic abc' })
  expect(opts.global?.headers?.Authorization).toBeUndefined()
  expect(opts.cookies.getAll()).toEqual([{ name: 'sb-token', value: 'from-cookie' }])
})
