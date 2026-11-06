// ═══════════════════════════════════════════════════════════
// CSRF / Origin regression tests (run in `verify`).
//   • cross-origin POSTs to the checkout endpoints are refused 403
//   • requests WITHOUT an Origin header (curl, server-to-server)
//     are answered by validation, not by the origin guard
//   • checkout create demands an Idempotency-Key
//   • sandboxed preview-tunnel shape (Host rewritten by an outer
//     gateway): browser-asserted sec-fetch-site: same-origin passes,
//     sec-fetch-site: cross-site is still refused
// Needs the dev backend on :3001 (CONTRACT_BASE_URL) and
// INTERNAL_API_KEY in env — read-only probes, no fixtures.
// ═══════════════════════════════════════════════════════════

import { describe, test, afterAll } from 'bun:test'

const BASE = process.env.CONTRACT_BASE_URL ?? 'http://127.0.0.1:3001'
const KEY = process.env.INTERNAL_API_KEY ?? ''

async function post(
  path: string,
  body: unknown,
  origin?: string,
  idempotencyKey?: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(KEY ? { 'x-internal-key': KEY } : {}),
      ...(origin ? { origin } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  })
}

let failures = 0
function check(label: string, ok: boolean, evidence: string): void {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${evidence}`)
}

describe('csrf/origin guards', () => {
  test('cross-origin quote is refused 403', async () => {
    const res = await post('/api/checkout/quote', { productId: 'ckprobe00000000000000', country: 'IN' }, 'https://evil.example.com')
    check('quote cross-origin 403', res.status === 403, `status ${res.status}`)
  })

  test('no-origin quote reaches validation (404/422), not the origin guard', async () => {
    const res = await post('/api/checkout/quote', { productId: 'ckprobe00000000000000', country: 'IN' })
    check('quote no-origin → validation', res.status === 404 || res.status === 422, `status ${res.status}`)
  })

  test('checkout create without Idempotency-Key is rejected', async () => {
    const res = await post('/api/checkout/create', { productId: 'ckprobe00000000000000', customerEmail: 'probe@sibra.local', country: 'IN', consent: true })
    check('create needs Idempotency-Key', [400, 422].includes(res.status), `status ${res.status}`)
  })

  test('tunnel shape: mismatched Host but sec-fetch-site: same-origin reaches validation', async () => {
    // Outer FC gateways rewrite x-forwarded-host to an internal hostname;
    // the browser's Fetch Metadata is the surviving trusted signal.
    const res = await post(
      '/api/checkout/quote',
      { productId: 'ckprobe00000000000000', country: 'IN' },
      'https://preview-tunnel.example',
      undefined,
      { 'sec-fetch-site': 'same-origin', 'x-forwarded-host': 'ws-tunnel.internal.example' },
    )
    check('quote tunnel same-origin → validation', res.status === 404 || res.status === 422, `status ${res.status}`)
  })

  test('tunnel shape: sec-fetch-site: cross-site is still refused 403', async () => {
    const res = await post(
      '/api/checkout/quote',
      { productId: 'ckprobe00000000000000', country: 'IN' },
      'https://evil.example.com',
      undefined,
      { 'sec-fetch-site': 'cross-site', 'x-forwarded-host': 'ws-tunnel.internal.example' },
    )
    check('quote tunnel cross-site 403', res.status === 403, `status ${res.status}`)
  })

  test('public event beacon accepts same-origin posts without leaking errors', async () => {
    const res = await post('/api/events', { type: 'product_view', productId: 'ckprobe00000000000000' }, `${BASE}`)
    check('event beacon same-origin ok', [200, 202, 204, 400].includes(res.status), `status ${res.status}`)
  })

  afterAll(() => {
    console.log(`CSRF/ORIGIN: ${failures === 0 ? 'all checks passed' : `${failures} failure(s)`}`)
    if (failures > 0) process.exitCode = 1
  })
})
