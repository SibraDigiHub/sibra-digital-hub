// ═══════════════════════════════════════════════════════════
// T8 (§9.1) — canonical site origin for absolute metadata URLs.
// Single source for metadataBase / JSON-LD / sitemap. Reads the
// T7 env module (NEXT_PUBLIC_SITE_URL, server-side only) with a
// localhost fallback for development. Trailing slashes stripped.
// The owner MUST set NEXT_PUBLIC_SITE_URL in production so OG
// images, canonical and sitemap URLs are absolute.
// ═══════════════════════════════════════════════════════════


export const SITE_FALLBACK_URL = 'http://localhost:3000'

export function siteUrl(): string {
  // Direct access lets Next.js inline this NEXT_PUBLIC_ variable
  // into client bundles that also import siteUrl().
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  const production = process.env.NODE_ENV === 'production'
  const allowLocalProduction = process.env.ALLOW_LOCAL_SITE_URL === 'true'

  // In production this origin feeds sitemap.xml, robots.txt, llms.txt,
  // canonical URLs and JSON-LD. Falling back to localhost would silently
  // publish unusable discovery URLs, so fail visibly instead.
  if (!raw) {
    if (production && !allowLocalProduction) throw new Error('NEXT_PUBLIC_SITE_URL must be set to the public HTTPS site origin in production')
    return SITE_FALLBACK_URL
  }

  try {
    const url = new URL(raw)
    const isLocal =
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '0.0.0.0' ||
      url.hostname === '::1' ||
      url.hostname.endsWith('.local')
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad protocol')
    if (production && !allowLocalProduction && (url.protocol !== 'https:' || isLocal || url.pathname !== '/' || url.search || url.hash)) {
      throw new Error('production site URL must be a public HTTPS origin without a path, query or fragment')
    }
    return url.origin
  } catch (error) {
    if (production) {
      throw new Error(
        `Invalid NEXT_PUBLIC_SITE_URL for production: ${error instanceof Error ? error.message : 'invalid URL'}`,
      )
    }
    return SITE_FALLBACK_URL
  }
}
