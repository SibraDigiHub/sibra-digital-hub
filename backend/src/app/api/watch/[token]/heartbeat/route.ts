// POST /api/watch/[token]/heartbeat — viewing-session maintenance (T-V C).
// Body: { sessionId } (client UUID persisted in sessionStorage).
// Runs every 30s while the player page is open: refreshes the session,
// enforces the concurrent-viewer cap and the 24h distinct-network share
// check (auto-lock + admin alert). no-store responses, rate-limited.
import { NextRequest, NextResponse } from 'next/server'
import { tooMany, asHandler } from '@/lib/api'
import { watchHeartbeatLimitPerIp } from '@/lib/auth/rate-limit'
import { clientIp } from '@/lib/auth/session'
import { watchHeartbeat } from '@/services/watch-service'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0', 'X-Robots-Tag': 'noindex, nofollow' } as const

export const POST = asHandler(async (req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  const limit = await watchHeartbeatLimitPerIp(clientIp(req))
  if (!limit.allowed) return tooMany(limit.retryAfterSec)

  const { token } = await params
  let sessionId = ''
  try {
    const body = (await req.json()) as { sessionId?: string }
    sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
  } catch {
    sessionId = ''
  }

  const result = await watchHeartbeat(token, {
    sessionId,
    ip: clientIp(req),
    ua: req.headers.get('user-agent') ?? 'unknown',
  })
  return NextResponse.json(result, { status: result.ok ? 200 : 403, headers: NO_STORE })
})
