// ═══════════════════════════════════════════════════════════
// Real-URL routes for the storefront (SEO foundation task).
//
// Pure path builders + parser shared by:
//   • the SPA store (navigate() emits real paths when the app is
//     on a real route, so in-site clicks keep real URLs)
//   • the hash→real redirect bridge
//   • sitemap / llms.txt generation
//
// Kept dependency-free (no env access, no server imports) so both
// client and server bundles can use it.
// ═══════════════════════════════════════════════════════════

import type { Zone } from '@/types/marketplace'

/** Legal pages that have real routes (about/pricing stay hash-only). */
export const REAL_LEGAL_PAGES = ['privacy', 'terms', 'refund-policy', 'contact'] as const
export type RealLegalPage = (typeof REAL_LEGAL_PAGES)[number]

export function isRealLegalPage(id: string): id is RealLegalPage {
  return (REAL_LEGAL_PAGES as readonly string[]).includes(id)
}

export function realShopPath(
  zone?: string | null,
  category?: string | null,
  search?: string | null,
  sort?: string | null,
): string {
  const p = new URLSearchParams()
  if (zone) p.set('zone', zone)
  if (category) p.set('category', category)
  if (search && search.trim()) p.set('q', search.trim())
  if (sort && sort !== 'featured') p.set('sort', sort)
  const qs = p.toString()
  return `/shop${qs ? `?${qs}` : ''}`
}

export function realProductPath(slug: string): string {
  return `/product/${encodeURIComponent(slug)}`
}

export function realCategoryPath(zone: string, category: string): string {
  return `/category/${encodeURIComponent(zone)}/${encodeURIComponent(category)}`
}

export function realLegalPath(page: RealLegalPage): string {
  return `/${page}`
}

/** Catalog request key — must match CatalogEngine's internal
 *  `requestKey` exactly so a server-fetched seed suppresses the
 *  client fetch flash on the real /shop + /category routes. */
export function catalogKey(zone: string, category: string | null, search: string, sort: string): string {
  return `${zone}|${category ?? ''}|${search.trim()}|${sort}|0`
}

/** Result of parsing a real (non-hash) storefront location. */
export interface RealRoute {
  kind: 'shop' | 'product' | 'legal' | 'other'
  zone: string | null
  category: string | null
  slug: string | null
  legalPage: string | null
  search: string
  sort: string
}

const SORT_VALUES = ['featured', 'newest', 'price-asc', 'price-desc'] as const

/** Parse a real pathname + query into store-seedable route state.
 *  Unknown paths return kind:'other' (leave the SPA untouched). */
export function parseRealPath(pathname: string, search: string): RealRoute {
  const out: RealRoute = { kind: 'other', zone: null, category: null, slug: null, legalPage: null, search: '', sort: 'featured' }
  const q = new URLSearchParams(search)
  const parts = pathname.split('/').filter(Boolean)

  if (parts[0] === 'shop') {
    out.kind = 'shop'
    out.zone = (q.get('zone') as Zone) || null
    out.category = q.get('category')
    out.search = q.get('q') || ''
    const s = q.get('sort')
    out.sort = (SORT_VALUES as readonly string[]).includes(s ?? '') ? (s as string) : 'featured'
    return out
  }
  if (parts[0] === 'product' && parts[1]) {
    out.kind = 'product'
    out.slug = decodeURIComponent(parts[1])
    return out
  }
  if (parts.length === 1 && isRealLegalPage(parts[0])) {
    out.kind = 'legal'
    out.legalPage = parts[0]
    return out
  }
  return out
}

/** Hash fragment → real path, or null when the hash has no real-route
 *  equivalent (gateway, admin, thank-you, download, watch, rate,
 *  about/pricing legal views keep their existing hash behaviour). */
export function realPathForHash(hash: string): string | null {
  const clean = hash.replace(/^#\/?/, '')
  if (!clean) return null
  const [path, query] = clean.split('?')
  const parts = path.split('/')
  const q = new URLSearchParams(query ?? '')

  switch (parts[0]) {
    case 'shop': {
      const p = new URLSearchParams()
      const zone = q.get('zone') || parts[1]
      if (zone) p.set('zone', zone)
      const category = q.get('category')
      if (category) p.set('category', category)
      const qs = p.toString()
      return `/shop${qs ? `?${qs}` : ''}`
    }
    case 'product':
      return parts[1] ? realProductPath(decodeURIComponent(parts[1])) : '/shop'
    case 'privacy':
    case 'terms':
    case 'refund-policy':
    case 'contact':
      return `/${parts[0]}`
    default:
      return null
  }
}
