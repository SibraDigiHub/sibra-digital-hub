// ═══════════════════════════════════════════════════════════
// Metadata + JSON-LD builders for the real (crawlable) routes.
// Server-side only consumers (App Router pages). Every absolute
// URL comes from the existing site-url helper — no hard-coded
// domain — and every value is built from real product/page data
// (no invented ratings, counts or stats).
// ═══════════════════════════════════════════════════════════

import type { Metadata } from 'next'
import { siteUrl } from '@/lib/site-url'
import { SITE_NAME } from '@/lib/site'
import { realCategoryPath, realProductPath, realShopPath } from '@/lib/real-routes'
import { productMediaImages } from '@/lib/video-thumb'
import type { Product } from '@/types/marketplace'

/** Hard limits from the task: title ≤ 60, description ≤ 155 chars. */
function clamp(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`
}

const BRAND_FALLBACK_OG = '/brand/og-cover.png'
const BRAND_FALLBACK_ALT =
  'Sibra Digital Hub — SDH neon-gold cosmic crest with kids and creators. Digital products for kids and creators — instant downloads, pay by card, UPI, net banking & more via Razorpay.'

/** First public product image, absolutized; brand cover as fallback. */
function ogImageFor(product: Product | null): { url: string; width?: number; height?: number; alt: string } {
  if (product) {
    const media = productMediaImages(product)
    const first = media[0]
    if (first) {
      return {
        url: /^https?:\/\//i.test(first) ? first : `${siteUrl()}${first}`,
        alt: `${product.title} — ${SITE_NAME}`,
      }
    }
  }
  return { url: `${siteUrl()}${BRAND_FALLBACK_OG}`, width: 1200, height: 630, alt: BRAND_FALLBACK_ALT }
}

function baseOg(product: Product | null, title: string, description: string, path: string): Pick<Metadata, 'openGraph' | 'twitter' | 'alternates' | 'robots'> {
  const image = ogImageFor(product)
  return {
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      title,
      description,
      url: path,
      locale: 'en_IN',
      images: [
        {
          url: image.url,
          ...(image.width ? { width: image.width } : {}),
          ...(image.height ? { height: image.height } : {}),
          alt: image.alt,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image.url],
    },
    robots: { index: true, follow: true },
  }
}

// ── Per-page metadata ────────────────────────────────────────

export function productMetadata(product: Product): Metadata {
  const path = realProductPath(product.slug)
  const title = clamp(product.title, 60)
  const description = clamp(
    product.description || `Instant digital download — ${product.title} by ${product.authorBrand}.`,
    155,
  )
  return {
    title,
    description,
    ...baseOg(product, title, description, path),
  }
}

const ZONE_NAMES = { kids: 'Digital Kidosphere', creator: 'Creator & Developer Hub' } as const

export function shopMetadata(zone: string, category?: string | null): Metadata {
  const zoneName = zone === 'creator' ? ZONE_NAMES.creator : ZONE_NAMES.kids
  const title = clamp(category ? `${category.replace(/-/g, ' ')} — ${zoneName}` : `${zoneName} — Shop`, 60)
  const description = clamp(
    category
      ? `Browse ${category.replace(/-/g, ' ')} in the ${zoneName} — instant digital downloads with secure Razorpay checkout (UPI, cards, net banking).`
      : `Browse every ${zoneName} digital product — instant downloads with secure Razorpay checkout (UPI, cards, net banking & more).`,
    155,
  )
  return {
    title,
    description,
    ...baseOg(null, title, description, realShopPath(zone, category)),
  }
}

export function categoryMetadata(zone: string, category: string): Metadata {
  return shopMetadata(zone, category)
}

export function legalMetadata(page: string, label: string): Metadata {
  const title = clamp(label, 60)
  const description = clamp(
    `${label} of ${SITE_NAME} — instant digital downloads for kids and creators, paid securely via Razorpay.`,
    155,
  )
  return {
    title,
    description,
    ...baseOg(null, title, description, `/${page}`),
  }
}

// ── JSON-LD builders (values only from real, visible data) ──

export function breadcrumbJsonLd(items: { name: string; path: string }[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: `${siteUrl()}${item.path}`,
    })),
  }
}

export function catalogItemListJsonLd(products: Product[], listName: string): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: listName,
    numberOfItems: products.length,
    itemListElement: products.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${siteUrl()}${realProductPath(p.slug)}`,
      name: p.title,
    })),
  }
}
