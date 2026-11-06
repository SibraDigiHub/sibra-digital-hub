// ═══════════════════════════════════════════════════════════
// /category/[zone]/[category] — real crawlable category route.
// Same components as the shop view, pre-filtered to the category;
// unknown zone/category combinations render a real HTTP 404.
// ═══════════════════════════════════════════════════════════

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import RealRouteShell from '@/components/real/RealRouteShell'
import { getCatalogProducts, getCategories } from '@/lib/seo-data'
import { breadcrumbJsonLd, catalogItemListJsonLd, shopMetadata } from '@/lib/seo-metadata'
import { catalogKey, realShopPath } from '@/lib/real-routes'
import { jsonLdString } from '@/lib/json-ld'
import type { Zone } from '@/types/marketplace'

interface CategoryProps {
  params: Promise<{ zone: string; category: string }>
}

async function resolveCategory(rawZone: string, rawCategory: string): Promise<{ zone: Zone; slug: string; label: string } | null> {
  if (rawZone !== 'kids' && rawZone !== 'creator') return null
  const categories = await getCategories()
  const match = categories.find((c) => c.zone === rawZone && c.slug === rawCategory)
  if (!match) return null
  return { zone: rawZone, slug: match.slug, label: match.label }
}

export async function generateMetadata({ params }: CategoryProps): Promise<Metadata> {
  const { zone, category } = await params
  const resolved = await resolveCategory(zone, category)
  if (!resolved) return shopMetadata('kids', null)
  return shopMetadata(resolved.zone, resolved.slug)
}

export default async function CategoryPage({ params }: CategoryProps) {
  const { zone: rawZone, category: rawCategory } = await params
  const resolved = await resolveCategory(rawZone, rawCategory)
  if (!resolved) notFound()

  const products = await getCatalogProducts(resolved.zone, resolved.slug)

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdString(
            breadcrumbJsonLd([
              { name: 'Home', path: '/' },
              { name: resolved.zone === 'creator' ? 'Creator & Developer Hub' : 'Digital Kidosphere', path: realShopPath(resolved.zone) },
              { name: resolved.label, path: `/category/${resolved.zone}/${resolved.slug}` },
            ]),
          ),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdString(catalogItemListJsonLd(products, resolved.label)),
        }}
      />
      <RealRouteShell
        view="shop"
        zone={resolved.zone}
        category={resolved.slug}
        catalog={{ key: catalogKey(resolved.zone, resolved.slug, '', 'featured'), products }}
        showFooter
      />
    </>
  )
}
