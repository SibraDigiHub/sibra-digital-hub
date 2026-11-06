// ═══════════════════════════════════════════════════════════
// /product/[slug] — real crawlable product route.
// Server-fetches the product (+ related rail), seeds the unchanged
// ProductDetailView with it so the first HTML carries title,
// description, price and what's-inside; Product JSON-LD comes from
// the detail view itself, breadcrumbs from here. Unknown slugs →
// real HTTP 404 (existing not-found look).
// ═══════════════════════════════════════════════════════════

import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import RealRouteShell from '@/components/real/RealRouteShell'
import { getProductBySlug, getRelatedProducts } from '@/lib/seo-data'
import { breadcrumbJsonLd, productMetadata } from '@/lib/seo-metadata'
import { realProductPath, realShopPath } from '@/lib/real-routes'
import { jsonLdString } from '@/lib/json-ld'

interface ProductProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: ProductProps): Promise<Metadata> {
  const { slug: rawSlug } = await params
  const product = await getProductBySlug(decodeURIComponent(rawSlug).toLowerCase())
  if (!product) return { title: 'Product not found' }
  return productMetadata(product)
}

export default async function ProductPage({ params }: ProductProps) {
  const { slug: rawSlug } = await params
  const slug = decodeURIComponent(rawSlug)

  // Slug canonicalisation — slugs are lowercase; an upper/mixed-case
  // variant gets a permanent redirect to the canonical URL.
  if (slug !== slug.toLowerCase()) {
    permanentRedirect(realProductPath(slug.toLowerCase()))
  }

  const product = await getProductBySlug(slug)
  if (!product) notFound()
  const related = await getRelatedProducts(product.zone, product.slug)

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdString(
            breadcrumbJsonLd([
              { name: 'Home', path: '/' },
              { name: 'Shop', path: realShopPath(product.zone) },
              { name: product.category, path: `/category/${product.zone}/${product.category}` },
              { name: product.title, path: realProductPath(product.slug) },
            ]),
          ),
        }}
      />
      <RealRouteShell
        view="product"
        zone={product.zone}
        productSlug={product.slug}
        detail={{
          slug: product.slug,
          product,
          related,
          notFound: false,
          error: false,
        }}
        showFooter={false}
      />
    </>
  )
}
