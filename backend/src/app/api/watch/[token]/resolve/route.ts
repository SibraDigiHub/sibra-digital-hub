// GET /api/watch/[token]/resolve — protected watch-page source (T-V C).
//
// Every protection check runs here FIRST (paid · not expired · not revoked
// · not locked); the video source is built server-side and returned ONLY
// on success. The raw unlisted link never leaves the server. Responses are
// no-store (never cached), no-referrer, and the route is rate-limited.
import { NextRequest, NextResponse } from 'next/server'
import { tooMany, asHandler } from '@/lib/api'
import { watchResolveLimitPerIp } from '@/lib/auth/rate-limit'
import { clientIp } from '@/lib/auth/session'
import { resolveWatch } from '@/services/watch-service'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  const limit = await watchResolveLimitPerIp(clientIp(req))
  if (!limit.allowed) return tooMany(limit.retryAfterSec)

  const { token } = await params
  try {
    const result = await resolveWatch(token)
    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0, must-revalidate',
        'Referrer-Policy': 'no-referrer',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    })
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500
    const message = (e as { message?: string }).message ?? 'This watch link is not valid'
    return NextResponse.json(
      { error: message },
      { status, headers: { 'Cache-Control': 'no-store, max-age=0', 'X-Robots-Tag': 'noindex, nofollow' } },
    )
  }
})

// The asHandler funnel now also covers unhandled crashes (rate-limit/
// client-ip failures answer the generic 500 JSON instead of an HTML page);
// every success AND handled-error path below still sets its own
// no-store/noindex/no-referrer headers, which asHandler never overrides.
export const runtime = 'nodejs'
