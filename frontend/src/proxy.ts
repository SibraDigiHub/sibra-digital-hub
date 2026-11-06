// ═══════════════════════════════════════════════════════════
// T4-b secure transport (§5.14) — hardens the existing
// /api/* → BACKEND_URL rewrites before they proxy server-side:
//   • x-internal-key  — the shared secret the backend middleware
//     requires (frontend/src/config/env.ts keeps it validated; keep it
//     identical to the backend deployment's value, rotate both together).
//   • x-client-ip     — first hop of x-forwarded-for, for the
//     backend's rate limiting / audit hashing.
//   • x-request-id    — crypto.randomUUID() correlation id.
//   • non-GET bodies capped at 1 MB → 413 JSON; non-GET responses
//     forced to Cache-Control: no-store.
// Runs only on the proxy path; the browser-visible site is
// untouched. Env is read at request time — this file executes on
// the server only, so a non-NEXT_PUBLIC secret is safe here.
// (Next 16.4: the request-hook file convention is `proxy.ts`, the
// successor of the deprecated `middleware.ts`.)
// ═══════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { internalApiKey } from '@/config/env'

const MAX_BODY_BYTES = 1024 * 1024 // 1 MB

export function proxy(req: NextRequest) {
  const isRead = req.method === 'GET' || req.method === 'HEAD'

  // Body cap for state-changing calls (header is checked when present;
  // the backend applies its own 64 KB JSON cap as the second gate).
  if (!isRead) {
    const length = Number(req.headers.get('content-length') ?? '0')
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    }
  }

  const headers = new Headers(req.headers)
  headers.set('x-internal-key', internalApiKey())
  // Client IP for the backend's rate limiting / audit hashing. The FIRST
  // XFF hop is client-forgeable (any browser can send `x-forwarded-for`),
  // so take the LAST hop — the one OUR edge appended — or the platform's
  // x-real-ip. Always overwritten here: an incoming x-client-ip is never
  // trusted. The relay forwards this server-to-server, so the backend
  // only ever rate-limits on an edge-derived address.
  const forwardedFor = req.headers.get('x-forwarded-for')
  const hops = forwardedFor
    ? forwardedFor
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean)
    : []
  const clientIp = hops[hops.length - 1] ?? req.headers.get('x-real-ip')
  if (clientIp) headers.set('x-client-ip', clientIp)
  const requestId = crypto.randomUUID()
  headers.set('x-request-id', requestId)

  const res = NextResponse.next({ request: { headers } })
  if (!isRead) res.headers.set('Cache-Control', 'no-store')
  return res
}

export const config = {
  matcher: '/api/:path*',
}
