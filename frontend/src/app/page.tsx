// ═══════════════════════════════════════════════════════════
// T8 (§9.1): SERVER component for the single-route storefront.
// Emits site-level JSON-LD (Organization + WebSite) server-side —
// no client JS added — then renders the unchanged client SPA shell
// (moved verbatim to @/components/HomeShell).
//
// Hash-router note (§9.1): catalog, product and legal views live under
// #/… fragments, so only SITE-LEVEL metadata/JSON-LD is possible;
// per-product share previews need real routes (future task).
// ═══════════════════════════════════════════════════════════

import HomeShell from '@/components/HomeShell'
import { jsonLdString } from '@/lib/json-ld'
import { siteUrl } from '@/lib/site-url'

// Organization + WebSite JSON-LD — public, factual values only
// (brand name, site origin, site icon). No sameAs: the storefront
// exposes no site-level marketplace profile URLs (marketplace links
// are per-product admin entries, not official brand profiles).
const site = siteUrl()
const organizationId = `${site}/#organization`
const websiteId = `${site}/#website`

const siteJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': organizationId,
      name: 'Sibra Digital Hub',
      url: `${site}/`,
      logo: {
        '@type': 'ImageObject',
        url: `${site}/icon.svg`,
      },
    },
    {
      '@type': 'WebSite',
      '@id': websiteId,
      url: `${site}/`,
      name: 'Sibra Digital Hub',
      publisher: { '@id': organizationId },
      inLanguage: 'en-IN',
    },
  ],
}

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(siteJsonLd) }}
      />
      <HomeShell />
    </>
  )
}
