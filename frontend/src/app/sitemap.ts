import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/site-url'
import { getAllPublishedProducts, getCategoriesStrict } from '@/lib/seo-data'
import { REAL_LEGAL_PAGES } from '@/lib/real-routes'

// Refresh the sitemap on the same short cadence as its tagged catalog fetches.
// Product mutations also invalidate the shared tag through /api/revalidate.
export const revalidate = 60

// Generated sitemap — home, shop (both zones), every real category page,
// EVERY published product URL (with its real lastModified) and the real
// legal pages. Drafts/archived products never reach this list (the
// catalog API only returns published rows), and private routes
// (admin/thank-you/download/watch/reset-password) are deliberately absent.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl()
  const [products, categories] = await Promise.all([getAllPublishedProducts(), getCategoriesStrict()])

  const lastProductEdit = products.reduce<string | null>(
    (latest, p) => (!latest || p.updatedAt > latest ? p.updatedAt : latest),
    null,
  )
  const lastModified = lastProductEdit ? new Date(lastProductEdit) : new Date()

  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/shop?zone=kids`, lastModified, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/shop?zone=creator`, lastModified, changeFrequency: 'daily', priority: 0.9 },
  ]

  for (const category of categories) {
    entries.push({
      url: `${base}/category/${category.zone}/${category.slug}`,
      lastModified,
      changeFrequency: 'daily',
      priority: 0.7,
    })
  }

  for (const product of products) {
    entries.push({
      url: `${base}/product/${product.slug}`,
      lastModified: new Date(product.updatedAt),
      changeFrequency: 'weekly',
      priority: 0.8,
    })
  }

  for (const page of REAL_LEGAL_PAGES) {
    entries.push({ url: `${base}/${page}`, lastModified, changeFrequency: 'monthly', priority: 0.5 })
  }

  // Google accepts at most 50,000 URLs in one sitemap. Fail visibly rather
  // than emitting an invalid sitemap if the catalog ever reaches that scale;
  // split into an index + child sitemaps before approaching this threshold.
  if (entries.length > 50_000) {
    throw new Error('Sitemap exceeds the 50,000 URL limit; split it into indexed child sitemaps.')
  }

  return entries
}
