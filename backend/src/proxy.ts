// ═══════════════════════════════════════════════════════════
// T4-b transport guard (§5.14) — the backend only accepts /api/*
// requests that carry the frontend proxy's shared secret.
//
// The browser never talks to this host directly: the frontend's Next
// proxy (src/proxy.ts) adds `x-internal-key` (+ x-client-ip,
// x-request-id) before its server-to-server rewrite forwards the
// call here. Exemptions (per §5.14):
//   • exact GET /api            → health route (booleans only)
//   • /api/razorpay/webhook     → HMAC-verified, called by Razorpay
//   • /api/cron/*               → routes check `Authorization: Bearer
//                                 CRON_SECRET` themselves
// Reads process.env directly: middleware runs before the app's
// route context and must stay dependency-free (dev convenience:
// INTERNAL_API_KEY_PREVIOUS keeps rotation zero-downtime).
//
// T7 (§8.3): every /api response also carries the baseline security
// headers `X-Content-Type-Options: nosniff` and `Referrer-Policy:
// no-referrer` (cache policy stays with lib/api.ts per T3).
// ═══════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { secretsEqual } from '@/lib/timing-safe'

/** Baseline security headers applied to EVERY /api response (§8.3). */
function withSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'no-referrer')
  return res
}

function isExempt(pathname: string, method: string): boolean {
  if (pathname === '/api' && method === 'GET') return true
  if (pathname === '/api/razorpay/webhook') return true
  if (pathname === '/api/cron' || pathname.startsWith('/api/cron/')) return true
  return false
}

export function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname
  const method = req.method.toUpperCase()

  if (isExempt(pathname, method)) return withSecurityHeaders(NextResponse.next())

  const key = req.headers.get('x-internal-key') ?? ''
  const expected = process.env.INTERNAL_API_KEY ?? ''
  const previous = process.env.INTERNAL_API_KEY_PREVIOUS ?? ''
  const valid = Boolean(expected) && (secretsEqual(key, expected) || (Boolean(previous) && secretsEqual(key, previous)))
  if (!valid) {
    return withSecurityHeaders(NextResponse.json({ error: 'unauthorized' }, { status: 401 }))
  }
  return withSecurityHeaders(NextResponse.next())
}

export const config = {
  matcher: ['/api', '/api/:path*'],
}
