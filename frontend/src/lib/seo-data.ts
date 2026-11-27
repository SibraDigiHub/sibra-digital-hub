// ═══════════════════════════════════════════════════════════
// Server-only data fetching for the real (crawlable) routes.
//
// Mirrors the browser proxy contract exactly: backend URL from the
// env module + `x-internal-key` — the same headers the /api catch-all
// attaches, so no new backend capability is used and no secret can
// reach the client bundle (this module is imported by server
// components only).
//
// Caching: ISR with a short revalidate plus a shared fetch tag so the
// whole SEO surface is revalidated after published-product mutations via
// the authenticated backend-to-frontend /api/revalidate endpoint.
// ═══════════════════════════════════════════════════════════

// NOTE: imported by server components only — reads INTERNAL_API_KEY,
// which must never reach a client bundle. Enforced by convention (no
// 'server-only' package installed; adding one would be a new dependency).

import { feEnv } from '@/config/env'
import { parseProduct } from '@/lib/parse-product'
import type { Product, ProductRow } from '@/types/marketplace'

export const REAL_ROUTES_TAG = 'real-routes'
const REVALIDATE_SECONDS = 60

function backendBase(): string {
  const env = feEnv()
  return (env.BACKEND_URL ?? 'http://localhost:3001').replace(/\/+$/, '')
}

async function backendGet<T>(path: string): Promise<T | null> {
  const env = feEnv()
  const key = env.INTERNAL_API_KEY
  try {
    const res = await fetch(`${backendBase()}${path}`, {
      headers: key ? { 'x-internal-key': key } : undefined,
      next: { revalidate: REVALIDATE_SECONDS, tags: [REAL_ROUTES_TAG] },
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    // Real routes must degrade to the not-found/empty look, never 500
    return null
  }
}

function toProduct(row: ProductRow): Product {
  const product = parseProduct(row as unknown as Record<string, unknown>) as unknown as Product
  // Defence in depth: private/fulfilment fields must never ride into a
  // page's HTML (RSC payload) even when the API returns them as null.
  delete (product as unknown as Record<string, unknown>).videoPreviewUrl
  delete (product as unknown as Record<string, unknown>).deliverableUrl
  delete (product as unknown as Record<string, unknown>).deliverableName
  return product
}

export interface ProductList {
  products: Product[]
}

/** Published product by slug (or null when unknown/backend down). */
export async function getProductBySlug(slug: string): Promise<Product | null> {
  const data = await backendGet<{ products: ProductRow[] }>(
    `/api/products?slug=${encodeURIComponent(slug)}`,
  )
  const row = data?.products?.[0]
  return row ? toProduct(row) : null
}

/** Related rail: up to `limit` other published products of the same zone. */
export async function getRelatedProducts(zone: string, excludeSlug: string): Promise<Product[]> {
  const data = await backendGet<{ products: ProductRow[] }>(
    `/api/products?zone=${encodeURIComponent(zone)}&limit=8`,
  )
  if (!data?.products) return []
  return data.products
    .filter((row) => row.slug !== excludeSlug)
    .slice(0, 4)
    .map(toProduct)
}

/** Catalog for a zone (+ optional category/search/sort), the same query
 *  the SPA catalog uses — search/sort let a fresh load of /shop?q=…&sort=…
 *  render the filtered grid in the first HTML. */
export async function getCatalogProducts(
  zone: string,
  category?: string | null,
  search?: string | null,
  sort?: string | null,
): Promise<Product[]> {
  const params = new URLSearchParams({ zone, sort: sort || 'featured', limit: '60' })
  if (category) params.set('category', category)
  if (search && search.trim()) params.set('q', search.trim())
  const data = await backendGet<{ products: ProductRow[] }>(`/api/products?${params.toString()}`)
  if (!data?.products) return []
  return data.products.map(toProduct)
}

/** Public category registry (zone → categories with real labels). */
export async function getCategories(): Promise<{ zone: string; slug: string; label: string }[]> {
  const data = await backendGet<{ categories: { zone: string; slug: string; label: string }[] }>(
    '/api/categories',
  )
  return data?.categories ?? []
}

/** Strict category registry for SEO documents that must not silently omit URLs. */
export async function getCategoriesStrict(): Promise<{ zone: string; slug: string; label: string }[]> {
  const data = await backendGet<{ categories: { zone: string; slug: string; label: string }[] }>(
    '/api/categories',
  )
  if (
    !data ||
    !Array.isArray(data.categories) ||
    !data.categories.every(
      (category) =>
        category &&
        typeof category.zone === 'string' &&
        typeof category.slug === 'string' &&
        typeof category.label === 'string',
    )
  ) {
    throw new Error('Unable to load the complete category registry for SEO discovery')
  }
  return data.categories
}

/** Small featured-first list for the concise llms.txt overview. */
export async function getFeaturedProducts(limit = 10): Promise<Product[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit) || 10))
  const data = await backendGet<{ products: ProductRow[] }>(
    `/api/products?limit=${safeLimit}&sort=featured`,
  )
  if (!data || !Array.isArray(data.products)) {
    throw new Error('Unable to load featured products for llms.txt')
  }
  return data.products.map(toProduct)
}

/** Every published product for the sitemap, read in bounded pages.
 *  The public API caps each page at 200; offset pagination prevents newer
 *  catalogs from silently truncating at the first 200 products. The stable
 *  newest/id ordering keeps page boundaries deterministic between requests. */
export async function getAllPublishedProducts(): Promise<Product[]> {
  const pageSize = 200
  const products: Product[] = []

  for (let offset = 0; ; offset += pageSize) {
    const data = await backendGet<{ products: ProductRow[] }>(
      `/api/products?limit=${pageSize}&offset=${offset}&sort=newest`,
    )
    // Never publish a deceptively incomplete sitemap on an API
    // failure. Let the route fail so crawlers can retry; the last good cache
    // remains preferable to a successful sitemap that drops every product.
    if (!data || !Array.isArray(data.products)) {
      throw new Error(`Unable to load published products for SEO discovery (offset ${offset})`)
    }

    const page = data.products.map(toProduct)
    products.push(...page)
    if (page.length < pageSize) return products
  }
}
