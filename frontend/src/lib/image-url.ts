// ═══════════════════════════════════════════════════════════
// image-url.ts — bandwidth-aware ImageKit CDN transformations.
//
// Product image URLs come from the database. Today the seed data
// uses same-origin paths (/images/…) — tomorrow the admin uploads
// land on the account's ImageKit CDN (https://ik.imagekit.io/…).
// Remote originals cost real ImageKit bandwidth, so every list/
// gallery surface asks ImageKit for a right-sized derivative:
//
//   list thumbnails   → tr:w-400,q-75,f-auto  (cards, marquee covers)
//   detail main image → tr:w-900,q-80,f-auto  (3:4 gallery frame)
//   detail thumbnails → tr:w-200,q-70,f-auto  (64–72px wide strips)
//
// Safety rules (never break a URL):
//   • ONLY https URLs whose host is ik.imagekit.io / *.imagekit.io
//     are transformed — same-origin paths, YouTube same-origin
//     thumbs and any other external host pass through untouched.
//   • URLs that already carry a query string or fragment are
//     NEVER touched: that covers signed/tokenised ImageKit URLs
//     (ik-s / ik-t / token) and URLs that declare their own
//     transformations, so existing signatures stay valid.
//   • Width-only transforms (no h-/cropping) — ImageKit keeps the
//     original aspect ratio, so any source ratio (3:4, 1:1, 16:9)
//     arrives undistorted and `object-contain` fits it fully.
// ═══════════════════════════════════════════════════════════

const LIST_THUMB_TRANSFORM = 'tr:w-400,q-75,f-auto'
const DETAIL_MAIN_TRANSFORM = 'tr:w-900,q-80,f-auto'
const DETAIL_THUMB_TRANSFORM = 'tr:w-200,q-70,f-auto'

function isTransformableImageKitUrl(url: string): boolean {
  if (!url.startsWith('https://')) return false
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    return false
  }
  const isImageKitHost = host === 'ik.imagekit.io' || host.endsWith('.imagekit.io')
  if (!isImageKitHost) return false
  // A query string / fragment means the URL already carries auth
  // params or explicit transformations — leave it exactly as-is.
  return !url.includes('?') && !url.includes('#')
}

function applyTransform(url: string, transform: string): string {
  return isTransformableImageKitUrl(url) ? `${url}?${transform}` : url
}

/** Card / marquee cover thumbnail (≈400px wide, q75, auto format). */
export function listThumbUrl(url: string): string {
  return applyTransform(url, LIST_THUMB_TRANSFORM)
}

/** Product-detail main gallery image (≈900px wide, q80, auto format). */
export function detailMainUrl(url: string): string {
  return applyTransform(url, DETAIL_MAIN_TRANSFORM)
}

/** Product-detail thumbnail strip (≈200px wide, q70, auto format). */
export function detailThumbUrl(url: string): string {
  return applyTransform(url, DETAIL_THUMB_TRANSFORM)
}
