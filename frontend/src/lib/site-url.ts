// ═══════════════════════════════════════════════════════════
// T8 (§9.1) — canonical site origin for absolute metadata URLs.
// Single source for metadataBase / JSON-LD / sitemap. Reads the
// T7 env module (NEXT_PUBLIC_SITE_URL, server-side only) with a
// localhost fallback for development. Trailing slashes stripped.
// The owner MUST set NEXT_PUBLIC_SITE_URL in production so OG
// images, canonical and sitemap URLs are absolute.
// ═══════════════════════════════════════════════════════════

import { feEnv } from '@/config/env'

export const SITE_FALLBACK_URL = 'http://localhost:3000'

export function siteUrl(): string {
  const raw = feEnv().NEXT_PUBLIC_SITE_URL?.trim()
  const candidate = raw && raw.length > 0 ? raw : SITE_FALLBACK_URL
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad protocol')
    return candidate.replace(/\/+$/, '')
  } catch {
    return SITE_FALLBACK_URL
  }
}
