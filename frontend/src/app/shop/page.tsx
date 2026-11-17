// ═══════════════════════════════════════════════════════════
// /shop?zone=…&category=… — real crawlable catalog route.
// Server-fetches the same catalog query the SPA uses, renders the
// unchanged CatalogEngine seeded with it (first HTML carries the
// grid), and emits BreadcrumbList + ItemList JSON-LD.
// ═══════════════════════════════════════════════════════════

import type { Metadata } from 'next'
import RealRouteShell from '@/components/real/RealRouteShell'
import { getCatalogProducts } from '@/lib/seo-data'
import { breadcrumbJsonLd, catalogItemListJsonLd, shopMetadata } from '@/lib/seo-metadata'
import { catalogKey, realShopPath } from '@/lib/real-routes'
import { jsonLdString } from '@/lib/json-ld'
import type { Zone } from '@/types/marketplace'

interface ShopProps {
  searchParams: Promise<{ zone?: string; category?: string; q?: string; sort?: string }>
}

export async function generateMetadata({ searchParams }: ShopProps): Promise<Metadata> {
  const { zone, category } = await searchParams
  return shopMetadata(zone === 'creator' ? 'creator' : 'kids', category ?? null)
}

export default async function ShopPage({ searchParams }: ShopProps) {
  const { zone: zoneParam, category, q, sort: sortParam } = await searchParams
  const zone: Zone = zoneParam === 'creator' ? 'creator' : 'kids'
  const sort = sortParam === 'newest' || sortParam === 'price-asc' || sortParam === 'price-desc' ? sortParam : 'featured'
  const search = q ?? ''
  const products = await getCatalogProducts(zone, category ?? null, search, sort)

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdString(
            breadcrumbJsonLd([
              { name: 'Home', path: '/' },
              { name: zone === 'creator' ? 'Creator & Developer Hub' : 'Digital Kidosphere', path: realShopPath(zone) },
              ...(category ? [{ name: category, path: realShopPath(zone, category) }] : []),
            ]),
          ),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdString(
            catalogItemListJsonLd(
              products,
              zone === 'creator' ? 'Creator & Developer Hub products' : 'Digital Kidosphere products',
            ),
          ),
        }}
      />
      <RealRouteShell
        view="shop"
        zone={zone}
        category={category ?? null}
        search={search}
        sort={sort}
        catalog={{ key: catalogKey(zone, category ?? null, search, sort), products }}
        showFooter
      />
    </>
  )
}
