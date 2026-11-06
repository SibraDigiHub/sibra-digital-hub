// GET /api/video/thumb?v=<youtube-video-id>&q=maxres|hq — same-origin
// YouTube thumbnail proxy (T-V).
//
// Product cards and the detail gallery show the video's own frame. Fetching
// i.ytimg.com straight from the browser breaks for visitors whose network or
// extensions block third-party YouTube hosts — the card then falls back to
// the default hero photo (the exact bug this endpoint replaces). The server
// fetches the frame ONCE, caches it in memory (24h) and serves it
// same-origin, so the thumbnail loads wherever the site itself loads.
//
// Security: the video id is strict-validated ([A-Za-z0-9_-]{11}) and the
// upstream host is hardcoded to YouTube's public thumbnail CDN — this can
// never become an open proxy, and no admin link or product field is involved.
import { NextRequest, NextResponse } from 'next/server'
import { asHandler, tooMany } from '@/lib/api'
import { consumeRateLimitSafe } from '@/lib/auth/rate-limit'
import { clientIp } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

/** Strict YouTube id — 11 chars of [A-Za-z0-9_-] (the alphabet parseVideoSource emits). */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_MAX_ENTRIES = 80

interface CachedThumb {
  bytes: ArrayBuffer
  contentType: string
  at: number
}

/** Process-lifetime thumbnail cache: one upstream fetch per video per TTL. */
const cache = new Map<string, CachedThumb>()

function cacheGet(key: string): CachedThumb | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit
}

function cachePut(key: string, value: CachedThumb): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Simple FIFO eviction — enough for a storefront-scale id set.
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
}

async function fetchThumb(
  id: string,
  quality: 'maxres' | 'hq',
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const file = quality === 'hq' ? 'hqdefault.jpg' : 'maxresdefault.jpg'
  try {
    const res = await fetch(`https://i.ytimg.com/vi/${id}/${file}`, {
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const bytes = await res.arrayBuffer()
    // ytimg answers soft-404s with a tiny grey placeholder — treat as miss.
    if (bytes.byteLength < 100) return null
    return { bytes, contentType: res.headers.get('content-type') || 'image/jpeg' }
  } catch {
    return null
  }
}

function imageResponse(bytes: ArrayBuffer, contentType: string): NextResponse {
  return new NextResponse(new Blob([bytes]), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      // Same bytes for a day; browsers revalidate lazily afterwards.
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
  })
}

export const GET = asHandler(async (req: NextRequest) => {
  const limit = await consumeRateLimitSafe(`yt-thumb:${clientIp(req)}`, 240, 60_000)
  if (!limit.allowed) return tooMany(limit.retryAfterSec)

  const id = req.nextUrl.searchParams.get('v') ?? ''
  if (!VIDEO_ID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid video id' }, { status: 400 })
  }
  const quality = req.nextUrl.searchParams.get('q') === 'hq' ? 'hq' : 'maxres'
  const key = `${id}:${quality}`

  const cached = cacheGet(key)
  if (cached) return imageResponse(cached.bytes, cached.contentType)

  // maxres (1280×720) is optional on some uploads — fall back to the
  // always-present hq size server-side, so the browser gets a frame in
  // one round-trip either way.
  const thumb =
    (await fetchThumb(id, quality)) ?? (quality === 'maxres' ? await fetchThumb(id, 'hq') : null)
  if (!thumb) {
    return NextResponse.json({ error: 'Thumbnail unavailable' }, { status: 502 })
  }

  cachePut(key, { ...thumb, at: Date.now() })
  return imageResponse(thumb.bytes, thumb.contentType)
})
