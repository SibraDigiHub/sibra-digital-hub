// POST /api/revalidate — server-to-server cache revalidation (additive).
//
// The BACKEND calls this after a public product/category mutation so cached
// catalog pages / sitemap / llms.txt re-pull on their next request instead
// of waiting for the ≤60 s ISR window. Tag: REAL_ROUTES_TAG — the shared tag
// used by seo-data.ts.
//
// AUTH NOTE: the frontend proxy.ts middleware RE-STAMPS `x-internal-key`
// on every /api/* request (that is how the browser-facing proxy talks to
// the backend), so that header cannot authenticate a frontend-local
// route. This endpoint therefore requires `x-revalidate-key` — the same
// shared secret under a header the middleware does not touch. Only the
// backend (which holds the secret) can call this; browser requests
// without it answer 401.
import { revalidateTag } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { REAL_ROUTES_TAG } from '@/lib/seo-data'

export const dynamic = 'force-dynamic'

function revalidateKeyValid(req: NextRequest): boolean {
  const expected = process.env.INTERNAL_API_KEY
  if (!expected) return false
  const provided = req.headers.get('x-revalidate-key') ?? ''
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!revalidateKeyValid(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  // Product/category mutations must be reflected on the next sitemap,
  // category, product and llms.txt request. expire: 0 makes the next read
  // block for fresh data instead of serving one stale-while-revalidate copy.
  revalidateTag(REAL_ROUTES_TAG, { expire: 0 })
  return NextResponse.json({ ok: true })
}
