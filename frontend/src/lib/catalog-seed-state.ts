import type { Zone } from '@/types/marketplace'

export type CatalogSort = 'featured' | 'newest' | 'price-asc' | 'price-desc'

export interface CatalogSeedRouteState {
  zone: Zone
  category: string | null
  search: string
  sort: CatalogSort
}

const SORT_VALUES = new Set<CatalogSort>(['featured', 'newest', 'price-asc', 'price-desc'])

/**
 * Read the route state encoded in catalogKey() while the client store is
 * still unhydrated. Search text may contain `|`, so parse from both ends.
 */
export function catalogSeedRouteState(key: string | undefined): CatalogSeedRouteState | null {
  if (!key) return null

  const parts = key.split('|')
  if (parts.length < 5 || parts[parts.length - 1] !== '0') return null

  const zone = parts[0]
  const sort = parts[parts.length - 2] as CatalogSort
  if ((zone !== 'kids' && zone !== 'creator') || !SORT_VALUES.has(sort)) return null

  return {
    zone,
    category: parts[1] || null,
    search: parts.slice(2, -2).join('|'),
    sort,
  }
}
