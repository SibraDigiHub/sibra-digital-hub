// POST /api/events — public analytics beacon (PRD §12)
// Accepts small batches of client events (buy clicks, etc.).
// Always returns 204; never errors the client; issues the
// anonymous visitor cookie so events link to customer timelines.
//
// T7 (§8.2): the per-IP limiter is now PG-backed (RateLimit table,
// atomic upsert — never process memory, survives restarts and holds
// across serverless instances). Over-limit answers 429 + Retry-After
// (the beacon is fire-and-forget on the client, so nothing changes
// visually); limiter DB errors fail OPEN — analytics must never break
// the page.
import { NextRequest, NextResponse } from 'next/server'
import { tooMany, readJsonCapped, asHandler } from '@/lib/api'
import { eventsLimitPerIp } from '@/lib/auth/rate-limit'
import { clientIp } from '@/lib/auth/session'
import { ensureVisitorId, eventContext, isKnownEventType, logEvent } from '@/lib/activity'

export const dynamic = 'force-dynamic'

const MAX_STR = 300

function clean(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_STR) : null
}

export const POST = asHandler(async (req: NextRequest) => {
  // T7: 60 events/min/IP, Postgres-backed (replaces the old in-memory Map).
  const limit = await eventsLimitPerIp(clientIp(req))
  if (!limit.allowed) return tooMany(limit.retryAfterSec)

  try {
    // Never let a beacon break the page — oversized/invalid bodies are swallowed as no-ops.
    let body: unknown
    try {
      body = await readJsonCapped(req)
    } catch {
      return new NextResponse(null, { status: 204 })
    }
    const list: unknown[] = Array.isArray(body) ? body.slice(0, 20) : body ? [body] : []

    if (list.length > 0) {
      // Prepare the response first so we can mint the visitor cookie
      const res = new NextResponse(null, { status: 204 })
      const ctx = eventContext(req)
      const visitorId = ensureVisitorId(req, res)

      for (const raw of list) {
        if (!raw || typeof raw !== 'object') continue
        const item = raw as Record<string, unknown>
        if (!isKnownEventType(item.type)) continue
        // Ignore obvious bots — keep the funnel honest
        if (ctx.device === 'bot') continue
        const metaRaw = item.meta && typeof item.meta === 'object' ? (item.meta as Record<string, unknown>) : {}
        await logEvent({
          type: item.type,
          productId: clean(item.productId),
          zone: clean(item.zone) === 'creator' ? 'creator' : clean(item.zone) === 'kids' ? 'kids' : null,
          platform: clean(item.platform),
          visitorId,
          path: ctx.path,
          referrer: ctx.referrer,
          country: ctx.country,
          device: ctx.device,
          meta: { url: typeof metaRaw.url === 'string' ? String(metaRaw.url).slice(0, MAX_STR) : null },
        })
      }
      return res
    }
  } catch {
    // swallow — beacon errors must never surface
  }
  return new NextResponse(null, { status: 204 })
})
