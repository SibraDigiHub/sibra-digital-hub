import type { Product } from '@/types/marketplace'

/**
 * Same-origin YouTube thumbnail URL — the backend fetches + caches the
 * frame from i.ytimg.com once and serves it from our own origin
 * (/api/video/thumb). Direct third-party YouTube image URLs break for
 * visitors whose network or extensions block those hosts (the card then
 * showed the default hero photo) — same-origin makes the frame load
 * wherever the site itself loads. If a specific frame is still missing,
 * `imgFallbackToHq` retries with the always-present hq size.
 */
export function youtubeThumbnailUrl(videoPreview: Product['videoPreview']): string | null {
  if (!videoPreview || videoPreview.provider !== 'youtube') return null
  return `/api/video/thumb?v=${encodeURIComponent(videoPreview.videoId)}`
}

/** Media list for a product card/gallery: the video's own frame leads. */
export function productMediaImages(product: Pick<Product, 'images' | 'videoPreview'>): string[] {
  const thumb = youtubeThumbnailUrl(product.videoPreview)
  return thumb ? [thumb, ...product.images] : [...product.images]
}

/** onError fallback: retry once with the hq size, then stop. */
export function imgFallbackToHq(e: { currentTarget: { src: string } }): void {
  const el = e.currentTarget
  if (!el.src.includes('q=hq')) {
    el.src = `${el.src}${el.src.includes('?') ? '&' : '?'}q=hq`
  }
}
