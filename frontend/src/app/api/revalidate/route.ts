// POST /api/revalidate — server-to-server cache revalidation (additive).
//
// The BACKEND calls this after a media-changing admin save so cached
// catalog pages / sitemap re-pull within seconds instead of waiting for
// the ≤60 s ISR window. Tag: REAL_ROUTES_TAG — the shared tag already
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
  revalidateTag(REAL_ROUTES_TAG, 'max')
  return NextResponse.json({ ok: true })
}
