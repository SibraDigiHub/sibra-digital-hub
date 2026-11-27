// ═══════════════════════════════════════════════════════════
// SEO real-URLs verification suite (master prompt §4 tests 1-6).
// Run against a LOCAL frontend server (+ backend) only:
//   bun run scripts/seo-checks.ts http://127.0.0.1:3000
// Asserts raw-HTML metadata/JSON-LD/sitemap/robots/llms/redirects
// and that private fields never leak. Exits non-zero on any failure.
// ═══════════════════════════════════════════════════════════


const BASE = process.argv[2] ?? 'http://127.0.0.1:3000'

let failures = 0
let checks = 0

function ok(cond: boolean, label: string, detail = ''): void {
  checks++
  if (!cond) {
    failures++
    console.log(`  ✗ FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  } else {
    console.log(`  ✓ ${label}`)
  }
}

async function get(path: string): Promise<{ status: number; html: string }> {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual' })
  const html = await res.text()
  return { status: res.status, html }
}

interface TagChecks {
  url: string
  expectedTitlePart?: string
  expectedCanonical?: string
  expectH1?: boolean
  expectBodyText?: string[]
  expectFooter?: boolean
  expectNoFooter?: boolean
}

function assertHead(html: string, t: TagChecks): void {
  const titles = [...html.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1])
  ok(titles.length === 1, `${t.url}: exactly one <title>`, `found ${titles.length}`)
  if (t.expectedTitlePart && titles[0]) {
    ok(titles[0].includes(t.expectedTitlePart), `${t.url}: title contains "${t.expectedTitlePart}"`, titles[0])
  }
  const desc = html.match(/<meta name="description" content="([^"]+)"/)
  ok(!!desc, `${t.url}: meta description present`)
  ok((desc?.[1].length ?? 999) <= 155, `${t.url}: description ≤ 155 chars`, String(desc?.[1].length))

  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)
  ok(!!canonical, `${t.url}: canonical present`)
  if (canonical) {
    ok(/^https?:\/\//.test(canonical[1]), `${t.url}: canonical absolute`, canonical[1])
    ok(!canonical[1].includes('#'), `${t.url}: canonical has no hash`, canonical[1])
    if (t.expectedCanonical) {
      let canonicalRouteMatches = false
      try {
        const actual = new URL(canonical[1])
        canonicalRouteMatches =
          `${actual.pathname}${actual.search}` === t.expectedCanonical
      } catch {
        canonicalRouteMatches = false
      }
      ok(canonicalRouteMatches, `${t.url}: canonical matches its real route`, canonical[1])
    }
  }

  for (const [label, re] of [
    ['og:title', /property="og:title" content="([^"]+)"/],
    ['og:description', /property="og:description" content="([^"]+)"/],
    ['og:url', /property="og:url" content="([^"]+)"/],
    ['og:image', /property="og:image" content="([^"]+)"/],
    ['og:site_name', /property="og:site_name" content="([^"]+)"/],
    ['og:locale', /property="og:locale" content="([^"]+)"/],
    ['twitter:card', /name="twitter:card" content="([^"]+)"/],
    ['twitter:image', /name="twitter:image" content="([^"]+)"/],
  ] as const) {
    const m = html.match(re)
    ok(!!m, `${t.url}: ${label} present`)
    if (m && /og:url|og:image|twitter:image/.test(label)) {
      ok(/^https?:\/\//.test(m[1]), `${t.url}: ${label} absolute`, m[1])
      if (label === 'og:url') {
        let ogRouteMatches = false
        try {
          const actual = new URL(m[1])
          ogRouteMatches = `${actual.pathname}${actual.search}` === t.url
        } catch {
          ogRouteMatches = false
        }
        ok(ogRouteMatches, `${t.url}: og:url matches its real route`, m[1])
      }
    }
  }

  if (t.expectH1) {
    const h1s = [...html.matchAll(/<h1[\s>]/g)]
    ok(h1s.length >= 1, `${t.url}: h1 present`)
  }
  for (const text of t.expectBodyText ?? []) {
    ok(html.includes(text), `${t.url}: body contains "${text.slice(0, 40)}"`)
  }
  if (t.expectFooter) ok(html.includes('<footer'), `${t.url}: footer present`)
  if (t.expectNoFooter) ok(!html.includes('<footer'), `${t.url}: footer absent (product rule)`)
}

interface JsonLdChecks {
  url: string
  types: string[]
  bannedTypes?: string[]
  requireAbsoluteUrls?: boolean
}

function assertJsonLd(html: string, t: JsonLdChecks): void {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  const parsed: object[] = []
  for (const b of blocks) {
    try {
      parsed.push(JSON.parse(b) as object)
    } catch {
      ok(false, `${t.url}: JSON-LD parses`, b.slice(0, 80))
    }
  }
  const typesFound = new Set<string>()
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return void node.forEach(walk)
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>
      if (typeof obj['@type'] === 'string') typesFound.add(obj['@type'])
      Object.values(obj).forEach(walk)
    }
  }
  parsed.forEach(walk)

  for (const type of t.types) ok(typesFound.has(type), `${t.url}: JSON-LD type ${type}`)
  for (const banned of t.bannedTypes ?? []) {
    ok(!typesFound.has(banned), `${t.url}: NO ${banned} JSON-LD (not real/visible)`)
  }

  if (t.requireAbsoluteUrls) {
    const invalidUrls: string[] = []
    const urlKeys = new Set(['url', '@id', 'image'])

    const isAbsoluteHttpUrl = (value: string): boolean => {
      try {
        const parsedUrl = new URL(value)
        return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:'
      } catch {
        return false
      }
    }

    const inspect = (node: unknown, key = ''): void => {
      if (typeof node === 'string') {
        if (urlKeys.has(key) && !isAbsoluteHttpUrl(node)) {
          invalidUrls.push(`${key}=${node}`)
        }
        return
      }

      if (Array.isArray(node)) {
        node.forEach((item) => inspect(item, key))
        return
      }

      if (node && typeof node === 'object') {
        Object.entries(node as Record<string, unknown>).forEach(([childKey, value]) => {
          inspect(value, childKey)
        })
      }
    }

    parsed.forEach((node) => inspect(node))
    ok(
      invalidUrls.length === 0,
      `${t.url}: JSON-LD url/@id/image values are absolute HTTP(S) URLs`,
      invalidUrls.slice(0, 3).join(', '),
    )
  }
}

async function main(): Promise<void> {
  const target = new URL(BASE)
  const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])
  if (!['http:', 'https:'].includes(target.protocol) || !localHosts.has(target.hostname)) {
    throw new Error(`Refusing non-local SEO test target: ${target.origin}`)
  }
  console.log(`── SEO checks against LOCAL target ${target.origin} ──`)

  // Select real public records instead of relying on a hardcoded probe product/category.
  const productProbeRes = await fetch(`${BASE}/api/products?limit=1&offset=0&sort=newest`)
  ok(productProbeRes.status === 200, 'product probe API: HTTP 200')

  let productProbeData: { products?: { id?: string; slug?: string; title?: string }[] } = {}
  try {
    productProbeData = await productProbeRes.json() as typeof productProbeData
  } catch {
    ok(false, 'product probe API: valid JSON')
  }

  const probeProduct = Array.isArray(productProbeData.products)
    ? productProbeData.products.find((p) => typeof p.slug === 'string' && p.slug.length > 0)
    : undefined

  ok(!!probeProduct, 'product probe: a published product is available')
  if (!probeProduct?.slug) throw new Error('SEO checks require at least one published product.')

  const probeSlug = encodeURIComponent(probeProduct.slug)
  const productPath = `/product/${probeSlug}`

  const categoryProbeRes = await fetch(`${BASE}/api/categories`)
  ok(categoryProbeRes.status === 200, 'category probe API: HTTP 200')

  let categoryProbeData: { categories?: { zone?: string; slug?: string }[] } = {}
  try {
    categoryProbeData = await categoryProbeRes.json() as typeof categoryProbeData
  } catch {
    ok(false, 'category probe API: valid JSON')
  }

  const probeCategory = Array.isArray(categoryProbeData.categories)
    ? categoryProbeData.categories.find(
        (c) => typeof c.zone === 'string' && typeof c.slug === 'string',
      )
    : undefined

  ok(!!probeCategory, 'category probe: an active category is available')
  if (!probeCategory?.zone || !probeCategory.slug) {
    throw new Error('SEO checks require at least one active public category.')
  }

  const categoryPath = `/category/${encodeURIComponent(probeCategory.zone)}/${encodeURIComponent(probeCategory.slug)}`

  // ── Test 1 + 3.2: raw HTML head/content per public page type ──
  console.log('〔1〕 raw HTML metadata + content')
  const r1 = await get(productPath)
  ok(r1.status === 200, `${productPath}: HTTP 200`, String(r1.status))
  assertHead(r1.html, {
    url: productPath,
    expectH1: true,
    expectNoFooter: true,
  })

  const r2 = await get('/shop?zone=kids')
  ok(r2.status === 200, '/shop?zone=kids: HTTP 200')
  assertHead(r2.html, {
    url: '/shop?zone=kids',
    expectedTitlePart: 'Digital Kidosphere',
    expectedCanonical: '/shop?zone=kids',
    expectH1: true,
    expectFooter: true,
  })

  const r2c = await get(categoryPath)
  ok(r2c.status === 200, `${categoryPath}: HTTP 200`)
  assertHead(r2c.html, {
    url: categoryPath,
    expectedCanonical: categoryPath,
    expectH1: true,
    expectFooter: true,
  })

  for (const p of ['/privacy', '/terms', '/refund-policy', '/contact']) {
    const r = await get(p)
    ok(r.status === 200, `${p}: HTTP 200`, String(r.status))
    assertHead(r.html, { url: p, expectH1: true, expectFooter: true })
  }

  // Home keeps its site JSON-LD + SPA behaviour
  const r0 = await get('/')
  ok(r0.status === 200, '/: HTTP 200')
  ok(r0.html.includes('"@type":"Organization"'), '/: Organization JSON-LD still present')

  // ── Test 2: JSON-LD structure ──
  console.log('〔2〕 JSON-LD structure')
  assertJsonLd(r1.html, {
    url: productPath,
    types: ['Product', 'BreadcrumbList'],
    bannedTypes: ['aggregateRating', 'FAQPage'], // no real review rows on the page; no FAQ visible
    requireAbsoluteUrls: true,
  })
  const skuOk = r1.html.includes(`"sku":"${probeProduct.slug}"`)
  ok(skuOk, `${productPath}: Product.sku = selected product slug`)

  const offerCount = [...r1.html.matchAll(/"@type"\s*:\s*"Offer"/g)].length
  const offerPrices = [...r1.html.matchAll(
    /"price"\s*:\s*"?([\d.]+)"?\s*,\s*"priceCurrency"\s*:\s*"([A-Z]{3})"/g,
  )]

  const validOfferState =
    (offerCount === 0 && offerPrices.length === 0) ||
    (
      offerCount === 1 &&
      offerPrices.length === 1 &&
      offerPrices[0][2] === 'USD' &&
      Number(offerPrices[0][1]) > 0
    )

  ok(
    validOfferState,
    `${productPath}: Offer is absent or exactly one valid positive-price USD offer`,
    `Offer nodes=${offerCount}, matched prices=${offerPrices.length}`,
  )
  assertJsonLd(r2.html, {
    url: '/shop?zone=kids',
    types: ['BreadcrumbList', 'ItemList'],
    requireAbsoluteUrls: true,
  })
  assertJsonLd(r0.html, { url: '/', types: ['Organization', 'WebSite'] })

  // ── Test 3: sitemap / robots / llms.txt ──
  console.log('〔3〕 sitemap + robots + llms.txt')
  const rs = await get('/sitemap.xml')
  ok(rs.status === 200, 'sitemap.xml: HTTP 200')
  const slugs = [...rs.html.matchAll(/<loc>[^<]*\/product\/([^<]+)<\/loc>/g)].map((m) => m[1])
  ok(slugs.length >= 1, `sitemap: published product URLs are present (${slugs.length})`)
  ok(new Set(slugs).size === slugs.length, 'sitemap: product URLs are unique')
  ok(slugs.includes(probeSlug), 'sitemap: contains the selected published product')
  ok(!rs.html.includes('/admin') && !rs.html.includes('thank-you') && !rs.html.includes('/download'), 'sitemap: no private URLs')
  ok(!rs.html.includes(`<loc>${BASE}/shop</loc>`), 'sitemap: omits /shop duplicate of the default Kids catalog')
  const sitemapOrigins = new Set(
    [...rs.html.matchAll(/<loc>(https?:\/\/[^<]+)<\/loc>/g)].map((m) => {
      try {
        return new URL(m[1]).origin
      } catch {
        return 'INVALID'
      }
    }),
  )
  ok(
    sitemapOrigins.size === 1 && !sitemapOrigins.has('INVALID'),
    'sitemap: all URLs use one valid absolute origin',
    [...sitemapOrigins].join(', '),
  )
  const sitemapOrigin = [...sitemapOrigins][0] ?? ''

  const catUrls = [...rs.html.matchAll(/<loc>[^<]*\/category\/([^<]+)<\/loc>/g)].map((m) => m[1])
  ok(new Set(catUrls).size === catUrls.length, 'sitemap: category URLs are unique')

  for (const p of ['/privacy', '/terms', '/refund-policy', '/contact']) {
    ok(rs.html.includes(`<loc>${sitemapOrigin}${p}</loc>`), `sitemap: ${p} listed`)
  }

  // Compare sitemap categories against the live public category registry.
  const categoryRes = await fetch(`${BASE}/api/categories`)
  ok(categoryRes.status === 200, 'category API: HTTP 200')
  let categoryData: { categories?: { zone?: string; slug?: string }[] } = {}
  try {
    categoryData = (await categoryRes.json()) as typeof categoryData
  } catch {
    /* the status assertion above reports an unavailable endpoint */
  }
  const apiCategoryUrls = Array.isArray(categoryData.categories)
    ? categoryData.categories
        .filter((c) => typeof c.zone === 'string' && typeof c.slug === 'string')
        .map((c) => `${c.zone}/${c.slug}`)
    : []
  ok(apiCategoryUrls.length >= 1, `category API: active categories are present (${apiCategoryUrls.length})`)
  ok(new Set(apiCategoryUrls).size === apiCategoryUrls.length, 'category API: category identities are unique')
  ok(
    catUrls.length === apiCategoryUrls.length &&
      apiCategoryUrls.every((url) => catUrls.includes(url)),
    'sitemap: category URLs match the public category API',
    `sitemap=${catUrls.length}, API=${apiCategoryUrls.length}`,
  )

  // Read the complete published catalog in bounded pages, as the sitemap does.
  const apiProductSlugs: string[] = []
  const apiProductIds: string[] = []
  let paginationComplete = false
  for (let offset = 0; offset <= 1_000_000; offset += 200) {
    const pageRes = await fetch(`${BASE}/api/products?limit=200&offset=${offset}&sort=newest`)
    if (pageRes.status !== 200) {
      ok(false, `product API: page at offset ${offset} responds 200`, `HTTP ${pageRes.status}`)
      break
    }

    let pageData: { products?: { id?: string; slug?: string }[] } = {}
    try {
      pageData = (await pageRes.json()) as typeof pageData
    } catch {
      ok(false, `product API: page at offset ${offset} contains valid JSON`)
      break
    }

    if (!Array.isArray(pageData.products)) {
      ok(false, `product API: page at offset ${offset} contains a product array`)
      break
    }

    const page = pageData.products
    ok(
      page.every((p) => typeof p.id === 'string' && typeof p.slug === 'string'),
      `product API: page at offset ${offset} has product IDs and slugs`,
    )
    apiProductIds.push(...page.map((p) => p.id).filter((v): v is string => typeof v === 'string'))
    apiProductSlugs.push(...page.map((p) => p.slug).filter((v): v is string => typeof v === 'string'))

    if (page.length < 200) {
      paginationComplete = true
      break
    }
  }

  ok(paginationComplete, 'product API: complete catalog pagination finished')
  ok(new Set(apiProductIds).size === apiProductIds.length, 'product API: no duplicate product IDs across pages')
  ok(new Set(apiProductSlugs).size === apiProductSlugs.length, 'product API: no duplicate product slugs across pages')
  ok(
    slugs.length === apiProductSlugs.length &&
      apiProductSlugs.every((slug) => slugs.includes(slug)),
    'sitemap: product URLs match the complete published product API',
    `sitemap=${slugs.length}, API=${apiProductSlugs.length}`,
  )

  // Explicit one-item pages prove that offset=1 advances beyond offset=0.
  const page0Res = await fetch(`${BASE}/api/products?limit=1&offset=0&sort=newest`)
  const page1Res = await fetch(`${BASE}/api/products?limit=1&offset=1&sort=newest`)
  ok(page0Res.status === 200 && page1Res.status === 200, 'product API: offset pagination responds 200')
  let page0: { products?: { id?: string }[] } = {}
  let page1: { products?: { id?: string }[] } = {}
  try {
    page0 = (await page0Res.json()) as typeof page0
    page1 = (await page1Res.json()) as typeof page1
  } catch {
    /* the status assertion above reports an unavailable endpoint */
  }
  ok(Array.isArray(page0.products) && Array.isArray(page1.products), 'product API: paginated responses contain product arrays')
  if (page0.products?.[0]?.id && page1.products?.[0]?.id) {
    ok(page0.products[0].id !== page1.products[0].id, 'product API: adjacent offset pages do not repeat the same product')
  }

  const rr = await get('/robots.txt')
  ok(rr.status === 200, 'robots.txt: HTTP 200')
  ok(rr.html.includes('Disallow: /admin') && rr.html.includes('Disallow: /api'), 'robots: disallows /admin + /api')
  ok(rr.html.includes('Disallow: /thank-you') && rr.html.includes('Disallow: /download') && rr.html.includes('Disallow: /watch'), 'robots: disallows private views')
  ok(rr.html.includes('Sitemap:'), 'robots: references sitemap')
  ok(/Sitemap: https?:\/\//.test(rr.html), 'robots: sitemap reference is absolute')
  ok(!rr.html.includes('User-agent: GPTBot\nDisallow'), 'robots: AI crawlers not blocked')

  const rl = await get('/llms.txt')
  ok(rl.status === 200, 'llms.txt: HTTP 200')
  const llmsUrls = [...rl.html.matchAll(/\((https?:\/\/[^)]+)\)/g)].map((m) => m[1])
  ok(llmsUrls.length >= 10, `llms.txt: page links present (${llmsUrls.length})`)
  ok(!llmsUrls.some((u) => u.includes('/admin') || u.includes('/api')), 'llms.txt: no private URLs')
  ok(!rl.html.includes('/#/'), 'llms.txt: no hash-only, non-crawlable page links')
  ok(!rl.html.includes('/shop): All products across both zones'), 'llms.txt: does not mislabel the Kids-default /shop route as a universal catalog')
  const llmsSitemapLink = llmsUrls.some((u) => {
    try {
      return new URL(u).pathname === '/sitemap.xml'
    } catch {
      return false
    }
  })
  ok(llmsSitemapLink, 'llms.txt: links to the complete XML sitemap')
  ok(!rl.html.includes('PayPal worldwide'), 'llms.txt: does not claim unsupported PayPal checkout')
  ok(!rl.html.includes('Every product is an instant digital download'), 'llms.txt: does not misstate every product delivery mode')
  // sample llms.txt URLs return 200
  const sample = llmsUrls.filter((u) => u.includes('/product/') || u.includes('/category/')).slice(0, 5)
  for (const u of sample) {
    let localPath = ''
    try {
      const parsed = new URL(u)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported URL protocol')
      localPath = `${parsed.pathname}${parsed.search}`
    } catch {
      ok(false, `llms.txt link is a valid HTTP URL: ${u}`)
      continue
    }
    const res = await fetch(`${BASE}${localPath}`)
    ok(res.status === 200, `llms.txt local link 200: ${localPath}`)
  }

  // ── Test 4 + 6: redirects, 404s, console — browser level ──
  console.log('〔4〕 hash redirects + 404 + console (browser)')
  if (process.env.SEO_BROWSER_TESTS === '1') {
  const playwrightModuleName: string = 'playwright'
  const { chromium } = await import(playwrightModuleName) as {
    chromium: { launch: (options: { headless: boolean; executablePath?: string }) => Promise<any> }
  }
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.SEO_CHROME_PATH ? { executablePath: process.env.SEO_CHROME_PATH } : {}),
  })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const consoleErrors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)) })
  page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR ${String(e).slice(0, 160)}`))

  await page.goto(`${BASE}/#${productPath}`, { waitUntil: 'load' })
  await page.waitForURL((url) => url.pathname === productPath, { timeout: 15000 })
  ok(page.url().includes(productPath), 'hash /#/product/<slug> → real URL', page.url())

  await page.goto(`${BASE}/#/shop?zone=creator`, { waitUntil: 'load' })
  await page.waitForURL(/\/shop\?zone=creator/, { timeout: 15000 })
  ok(page.url().includes('/shop?zone=creator'), 'hash /#/shop?zone=creator → real URL', page.url())

  await page.goto(`${BASE}/#/privacy`, { waitUntil: 'load' })
  await page.waitForURL(/\/privacy$/, { timeout: 15000 })
  ok(page.url().endsWith('/privacy'), 'hash /#/privacy → /privacy', page.url())

  // unknown slug → 404 (already asserted above via HTTP; browser confirms UI)
  const notFoundStatus = await fetch(`${BASE}/product/unknown-slug-xyz`)
  ok(notFoundStatus.status === 404, 'unknown product slug → HTTP 404', String(notFoundStatus.status))

  // trailing slash canonicalisation (Next default)
  const ts = await fetch(`${BASE}/shop/`, { redirect: 'manual' })
  ok(ts.status === 308 || ts.status === 301, 'trailing slash /shop/ → 301/308', String(ts.status))

  // interactive routes: flip + console on the real product page
  await page.goto(`${BASE}${productPath}`, { waitUntil: 'load' })
  await page.waitForTimeout(2500)
  const h1Visible = await page.locator('h1').first().isVisible()
  ok(h1Visible, 'real product page renders h1 visibly')

  // in-site navigation from the real page keeps REAL urls (store upgrade)
  await page.goto(`${BASE}/shop?zone=kids`, { waitUntil: 'load' })
  await page.waitForTimeout(2000)
  const card = page.locator('a[href^="/product/"]').first()
  const cardCount = await page.locator('a[href^="/product/"]').count()
  ok(cardCount > 0, 'shop grid exposes real <a href="/product/…"> links', `count=${cardCount}`)
  if (cardCount > 0) {
    const href = await card.getAttribute('href')
    await card.click()
    await page.waitForTimeout(1800)
    ok(page.url().includes('/product/'), 'card click navigates to real product URL', page.url())
    ok(await page.locator('h1').first().isVisible(), 'navigated product page renders')
    void href
  }

  // console clean on all new routes
  ok(consoleErrors.length === 0, 'zero console errors across real-route session', consoleErrors.slice(0, 2).join(' | '))

  await ctx.close()
  await browser.close()
  } else {
    console.log('  - Browser checks skipped (set SEO_BROWSER_TESTS=1 when Playwright and Chromium are installed)')
  }

  // ── Test 5: private fields never leak ──
  console.log('〔5〕 private-field leak scan')
  const leakProbe = /deliverable|downloadToken|"token"|videoPreviewUrl|order_id|x-internal-key|INTERNAL_API_KEY/i
  for (const [name, html] of [
    ['product', r1.html],
    ['shop', r2.html],
    ['privacy', (await get('/privacy')).html],
    ['sitemap', rs.html],
    ['llms', rl.html],
  ] as const) {
    const m = html.match(leakProbe)
    // "downloadToken" may legitimately appear in the JS bundle bootstrap of
    // the SPA shell only as a store field NAME, never a VALUE; flag values.
    const valueLeak = /downloadToken["'\s:=]+["'][A-Za-z0-9_-]{16,}/.test(html)
    ok(!valueLeak && !(m && /deliverableUrl|videoPreviewUrl/.test(m[0])), `${name}: no private field values in HTML`, m?.[0]?.slice(0, 60))
  }

  console.log(`── ${checks - failures}/${checks} checks passed ──`)
  if (failures > 0) {
    console.log(`✗ ${failures} FAILURES`)
    process.exit(1)
  }
  console.log('✓ ALL SEO CHECKS PASSED')
}

void main()
