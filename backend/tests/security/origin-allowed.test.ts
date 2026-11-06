// ═══════════════════════════════════════════════════════════
// originAllowed unit tests (checkout §10.5) — pure header logic,
// no DB, no network. Covers the classic same-host paths AND the
// sandboxed preview-tunnel shape (Host rewritten by an outer FC
// gateway) where only browser-asserted Fetch Metadata survives.
// Run: bun test tests/security/origin-allowed.test.ts
// ═══════════════════════════════════════════════════════════

import { describe, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { originAllowed } from '@/lib/claim-cookie'

const BROWSER_ORIGIN = 'https://preview-chat-abc.space-z.ai'
const EVIL_ORIGIN = 'https://evil.example.com'
const TUNNEL_HOST = 'ws-tunnel.internal.example'

function req(headers: Record<string, string>, url = 'https://backend.internal/api/checkout/quote'): NextRequest {
  return new NextRequest(url, { method: 'POST', headers })
}

describe('originAllowed', () => {
  test('no Origin → allowed (server-to-server callers, unchanged)', () => {
    expect(originAllowed(req({}))).toBe(true)
  })

  test('Origin host equals x-forwarded-host → allowed (same-host via proxy, unchanged)', () => {
    expect(originAllowed(req({ origin: BROWSER_ORIGIN, 'x-forwarded-host': 'preview-chat-abc.space-z.ai' }))).toBe(true)
  })

  test('Origin host equals host → allowed (direct same-host, unchanged)', () => {
    expect(originAllowed(req({ origin: 'https://shop.example.com', host: 'shop.example.com' }))).toBe(true)
  })

  test('cross-site Origin without Fetch Metadata → refused (unchanged)', () => {
    expect(originAllowed(req({ origin: EVIL_ORIGIN, 'x-forwarded-host': TUNNEL_HOST }))).toBe(false)
  })

  test('cross-site Origin with sec-fetch-site: cross-site → refused (guard intact)', () => {
    expect(originAllowed(req({ origin: EVIL_ORIGIN, 'x-forwarded-host': TUNNEL_HOST, 'sec-fetch-site': 'cross-site' }))).toBe(false)
  })

  test('tunnel shape: mismatched Host but browser-asserted sec-fetch-site: same-origin → allowed (the fix)', () => {
    expect(originAllowed(req({ origin: BROWSER_ORIGIN, 'x-forwarded-host': TUNNEL_HOST, 'sec-fetch-site': 'same-origin' }))).toBe(true)
  })

  test('malformed Origin → refused (unchanged)', () => {
    expect(originAllowed(req({ origin: 'not-a-url', 'sec-fetch-site': 'same-origin' }))).toBe(false)
  })

  test('Origin matching PUBLIC_WEB_URL → allowed (site fallback, unchanged)', () => {
    const site = process.env.PUBLIC_WEB_URL || process.env.NEXT_PUBLIC_SITE_URL || ''
    if (!site) return // fallback inert in this environment — nothing to assert
    expect(originAllowed(req({ origin: site, 'x-forwarded-host': TUNNEL_HOST }))).toBe(true)
  })
})
