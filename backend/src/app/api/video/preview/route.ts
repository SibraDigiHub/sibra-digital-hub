// GET /api/video/preview?slug=<product-slug> — click-to-play video source (T-V B).
//
// Called ONLY when the visitor presses Play on a product video. The server
// reads the stored (private) link, whitelist-parses it and returns:
//   • youtube  → { provider:'youtube', src: youtube-nocookie embed URL (fs=0) }
//   • imagekit → { provider:'imagekit', src: short-lived URL (~1h) }
//   • file     → { provider:'file', src: the direct https .mp4/.webm link }
// The raw admin link never appears in any page or listing (brief §B.1).
// Rate-limited (60/min/IP), no-cache, no referrer leak.
import { NextRequest, NextResponse } from 'next/server'
import { asHandler, tooMany } from '@/lib/api'
import { productRepo } from '@/repositories/product-repo'
import { parseVideoSource, youTubePrivacyEmbedUrl } from '@/lib/video-source'
import { imagekitSignedUrlFromRef } from '@/lib/storage'
import { videoPreviewLimitPerIp } from '@/lib/auth/rate-limit'
import { clientIp } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

const WATCH_FILE_TTL_SECONDS = 3600

export const GET = asHandler(async (req: NextRequest) => {
  const limit = await videoPreviewLimitPerIp(clientIp(req))
  if (!limit.allowed) return tooMany(limit.retryAfterSec)

  const slug = req.nextUrl.searchParams.get('slug') ?? ''
  if (!slug || slug.length > 200) {
    return NextResponse.json({ error: 'Missing product' }, { status: 400 })
  }

  const product = await productRepo.findBySlug(slug, 'published')
  if (!product || product.mediaType !== 'video' || !product.videoPreviewUrl) {
    return NextResponse.json({ error: 'Video not available' }, { status: 404 })
  }

  const source = parseVideoSource(product.videoPreviewUrl)
  if (!source) return NextResponse.json({ error: 'Video not available' }, { status: 404 })

  const src =
    source.provider === 'youtube'
      ? youTubePrivacyEmbedUrl(source.videoId)
      : imagekitSignedUrlFromRef(source.ref, { ttlSeconds: WATCH_FILE_TTL_SECONDS }) ??
        (source.ref.startsWith('https://') ? source.ref : null)
  if (!src) return NextResponse.json({ error: 'Video not available' }, { status: 404 })

  return NextResponse.json(
    { provider: source.provider, src },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Referrer-Policy': 'no-referrer',
      },
    },
  )
})
