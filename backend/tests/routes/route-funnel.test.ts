// ═══════════════════════════════════════════════════════════
// Route-funnel contract (asHandler everywhere).
//
// Two layers of proof:
//   1. STATIC — every route.ts under src/app/api wires its
//      exported handlers through `asHandler` (the uniform error
//      funnel: ApiError → status, ZodError → 400, crash → generic
//      500 JSON, no-store default, Server-Timing). No route may
//      regress to a bare `export async function GET/POST/…`.
//   2. LIVE — every previously-unwrapped route still answers the
//      exact same status + body it always did (same response
//      shapes), now PLUS the funnel's universal signatures
//      (`server-timing`, no-store default) that the rest of the
//      API already carried.
//
// Run (dev backend on :3001):  bun run test:routes
// ═══════════════════════════════════════════════════════════
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '../..') // backend/
const SRC_API = path.join(ROOT, 'src/app/api')
const BASE = process.env.CONTRACT_BASE_URL ?? 'http://127.0.0.1:3001'
const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? ''

async function api(pathname: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-internal-key': INTERNAL_KEY, ...(init.headers ?? {}) },
  })
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    body = { _raw: text.slice(0, 120) }
  }
  return { status: res.status, body, headers: res.headers }
}

/** The funnel's universal signatures on every wrapped response. */
function expectFunnelHeaders(headers: Headers): void {
  expect(headers.get('server-timing')).toMatch(/^total;dur=\d+$/)
  expect(headers.get('cache-control')).toBe('no-store')
}

// ── 1. Static inventory: no bare handlers left ──────────────
function walkRouteFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walkRouteFiles(full, acc)
    else if (entry === 'route.ts') acc.push(full)
  }
  return acc
}

describe('asHandler static inventory', () => {
  test('every src/app/api/**/route.ts wires its handlers through asHandler', () => {
    const files = walkRouteFiles(SRC_API)
    expect(files.length).toBeGreaterThan(60)
    const bare: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      // Strip comments so a doc mention alone does not satisfy the check.
      const code = src
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n')
      const hasExportedHandler = /export\s+(async\s+function|const)\s+(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\b/.test(code)
      if (!hasExportedHandler) continue // no HTTP handlers in this file
      if (!code.includes('asHandler(')) bare.push(path.relative(ROOT, f))
    }
    expect(bare).toEqual([])
  })
})

// ── 2. Live shapes: the previously-unwrapped routes ─────────
describe('previously-unwrapped routes keep their exact response shapes', () => {
  test('GET /api/admin/security-events — 401 shape + funnel headers', async () => {
    const res = await api('/api/admin/security-events')
    expect(res.status).toBe(401)
    expect(typeof res.body.error).toBe('string')
    expectFunnelHeaders(res.headers)
  })

  test('DELETE /api/admin/sessions/[id] — 401 shape + funnel headers', async () => {
    const res = await api('/api/admin/sessions/some-session-id', { method: 'DELETE' })
    expect(res.status).toBe(401)
    expect(typeof res.body.error).toBe('string')
    expectFunnelHeaders(res.headers)
  })

  test('POST /api/admin/sessions/revoke-others — 401 shape + funnel headers', async () => {
    const res = await api('/api/admin/sessions/revoke-others', { method: 'POST' })
    expect(res.status).toBe(401)
    expect(typeof res.body.error).toBe('string')
    expectFunnelHeaders(res.headers)
  })

  test('POST /api/admin/step-up — 401 (session gate first), strict Zod body behind it', async () => {
    const res = await api('/api/admin/step-up', { method: 'POST', body: JSON.stringify({ password: 'x' }) })
    expect(res.status).toBe(401)
    expect(typeof res.body.error).toBe('string')
    expectFunnelHeaders(res.headers)
  })

  test('GET /api/download/[token]?mode=json — 400 short token / 403 unknown token shapes', async () => {
    const short = await api('/api/download/short?mode=json')
    expect(short.status).toBe(400)
    expect(short.body).toEqual({ ok: false, error: 'Invalid download link' })

    const unknown = await api(`/api/download/${'x'.repeat(32)}?mode=json`)
    expect(unknown.status).toBe(403)
    expect(unknown.body).toEqual({ ok: false, error: 'This download link is not valid' })
    expectFunnelHeaders(unknown.headers)
  })

  test('POST /api/events — always 204, funnel no-store default added', async () => {
    const res = await api('/api/events', { method: 'POST', body: JSON.stringify([]) })
    expect(res.status).toBe(204)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  test('POST /api/paypal/webhook — removed by the single-gateway migration (404, no funnel headers on a missing route)', async () => {
    const res = await api('/api/paypal/webhook', { method: 'POST', body: '{}' })
    expect(res.status).toBe(404)
  })

  test('POST /api/razorpay/webhook — bad signature 400 shape unchanged', async () => {
    const res = await api('/api/razorpay/webhook', { method: 'POST', body: '{}' })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Invalid signature' })
    expectFunnelHeaders(res.headers)
  })

  test('GET /api/watch/[token]/resolve — invalid token 403 {error} shape (unchanged, own no-store/noindex headers)', async () => {
    const res = await api(`/api/watch/${'x'.repeat(24)}/resolve`)
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'This watch link is not valid' })
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(res.headers.get('x-robots-tag')).toContain('noindex')
  })

  test('POST /api/watch/[token]/heartbeat — invalid token 403 {ok:false,reason,message} shape (unchanged)', async () => {
    const res = await api(`/api/watch/${'x'.repeat(24)}/heartbeat`, { method: 'POST', body: JSON.stringify({ sessionId: 'test' }) })
    expect(res.status).toBe(403)
    expect(res.body.ok).toBe(false)
    expect(res.body.reason).toBe('invalid')
    expect(typeof res.body.message).toBe('string')
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  test('GET /api/imagekit/auth — unconfigured 501 {fallback:true} golden shape (or 200 when configured)', async () => {
    const res = await api('/api/imagekit/auth')
    if (res.status === 501) {
      expect(res.body.fallback).toBe(true)
      expect(typeof res.body.error).toBe('string')
    } else {
      expect(res.status).toBe(200)
      expect(typeof res.body.token).toBe('string')
    }
    expectFunnelHeaders(res.headers)
  })

  test('POST /api/orders/[id]/demo-pay — 409 once Razorpay keys exist, else claim-cookie 403 shape', async () => {
    const res = await api(`/api/orders/${'nonexistent-order'}/demo-pay`, { method: 'POST' })
    const configured = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
    if (configured) {
      // A configured store never fulfils via simulation — even in dev.
      expect(res.status).toBe(409)
      expect(typeof res.body.error).toBe('string')
    } else {
      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'This order can only be paid by the checkout that created it' })
    }
  })

  test('admin order ops (refund/resend/token) and product duplicate — 401 shapes + funnel headers', async () => {
    const id = 'nonexistent-order'
    const refund = await api(`/api/orders/${id}/refund`, { method: 'POST' })
    expect(refund.status).toBe(401)
    expect(typeof refund.body.error).toBe('string')

    const resend = await api(`/api/orders/${id}/resend`, { method: 'POST' })
    expect(resend.status).toBe(401)
    expect(typeof resend.body.error).toBe('string')

    const token = await api(`/api/orders/${id}/token`, { method: 'PATCH', body: JSON.stringify({ action: 'revoke' }) })
    expect(token.status).toBe(401)
    expect(typeof token.body.error).toBe('string')

    const dup = await api(`/api/products/${'nonexistent-product'}/duplicate`, { method: 'POST' })
    expect(dup.status).toBe(401)
    expect(typeof dup.body.error).toBe('string')

    for (const h of [refund.headers, resend.headers, token.headers, dup.headers]) expectFunnelHeaders(h)
  })
})

// ── 3. Admin-401 regression (FINDINGS #admin-routes-500) ────
// The newer admin routes (categories, channels, watch*, plus the admin
// branches of reviews/faqs/settings/products) THREW the shim's
// `unauthorized()` from '@/lib/admin-auth' — which RETURNS a Response
// instead of an ApiError. Throwing a Response is not an Error, so the
// funnel answered 500 {"error":"Something went wrong…"} for unauthenticated
// callers (and logged `err:{}`). Throw-style routes must import the
// throwable ApiError version from '@/lib/api'.
describe('admin routes answer 401 (never 500) without a session', () => {
  test('static: no route throws the Response-returning unauthorized from @/lib/admin-auth', () => {
    const offenders: string[] = []
    for (const f of walkRouteFiles(SRC_API)) {
      const src = readFileSync(f, 'utf8')
      const importsResponseVersion = /import\s*\{[^}]*\bunauthorized\b[^}]*\}\s*from\s*'@\/lib\/admin-auth'/.test(src)
      const throwsIt = /throw\s+unauthorized\(\)/.test(src)
      if (importsResponseVersion && throwsIt) offenders.push(path.relative(ROOT, f))
    }
    expect(offenders).toEqual([])
  })

  test('live: the previously-500ing admin routes answer 401 without a session', async () => {
    const id = 'ckfakeid00000000000000'
    const cases: Array<[string, string, RequestInit]> = [
      ['GET', '/api/admin/categories', {}],
      ['POST', '/api/admin/categories', { body: JSON.stringify({}) }],
      ['GET', '/api/admin/channels', {}],
      ['POST', '/api/admin/channels', { body: JSON.stringify({}) }],
      ['PATCH', `/api/admin/channels/${id}`, { body: JSON.stringify({}) }],
      ['GET', `/api/admin/orders/${id}/watch`, {}],
      ['PATCH', `/api/admin/orders/${id}/watch`, { body: JSON.stringify({}) }],
      ['POST', `/api/admin/orders/${id}/watch-preview`, { body: JSON.stringify({}) }],
      // Admin branches of public routes (same bug class):
      ['PUT', '/api/settings', { body: JSON.stringify({}) }],
      ['POST', '/api/faqs', { body: JSON.stringify({}) }],
      ['POST', '/api/reviews', { body: JSON.stringify({}) }],
      ['POST', '/api/products', { body: JSON.stringify({}) }],
    ]
    for (const [method, pathname, init] of cases) {
      const res = await api(pathname, { method, ...init })
      expect([method, pathname, res.status]).toEqual([method, pathname, 401])
      expect(typeof res.body.error).toBe('string')
      expectFunnelHeaders(res.headers)
    }
  })
})
