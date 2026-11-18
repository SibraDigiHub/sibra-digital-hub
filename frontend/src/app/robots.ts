import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/site-url'

// robots.txt — generated (not static) so the sitemap reference is an
// absolute URL built from the site-URL helper (no hard-coded domain).
// Public pages are crawlable; private/transactional paths are not.
// AI and search crawlers are NOT blocked.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/api', '/thank-you', '/download', '/watch'],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  }
}
