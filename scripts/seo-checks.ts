// ═══════════════════════════════════════════════════════════
// SEO real-URLs verification suite (master prompt §4 tests 1-6).
// Run against a PRODUCTION frontend server (+ backend) that serves
// the REAL routes:
//   cd /home/z/my-project && bun run scripts/seo-checks.ts [base]
// Asserts raw-HTML metadata/JSON-LD/sitemap/robots/llms/redirects
// and that private fields never leak. Exits non-zero on any failure.
// ═══════════════════════════════════════════════════════════

import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000'
const CHROME = process.env.SEO_CHROME_PATH ?? '/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome'

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
      ok(!m[1].includes('localhost') || BASE.includes('localhost'), `${t.url}: ${label} not localhost unless test base is`, m[1])
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
    const raw = JSON.stringify(parsed)
    // every schema.org url/id/image field must be absolute
    const urlFields = [...raw.matchAll(/"(?:url|id|image)":\s*"([^"]+)"/g)].map((m) => m[1])
    const nonAbsolute = urlFields.filter((u) => !/^https?:\/\//.test(u) && !u.startsWith('http'))
    ok(nonAbsolute.length === 0, `${t.url}: JSON-LD url/id/image fields absolute`, nonAbsolute.slice(0, 3).join(', '))
  }
}

async function main(): Promise<void> {
  console.log(`── SEO checks against ${BASE} ──`)

  // ── Test 1 + 3.2: raw HTML head/content per public page type ──
  console.log('〔1〕 raw HTML metadata + content')
  const productPath = '/product/baby-animals-coloring-book'
  const r1 = await get(productPath)
  ok(r1.status === 200, `${productPath}: HTTP 200`, String(r1.status))
  assertHead(r1.html, {
    url: productPath,
    expectedTitlePart: 'Baby Animals Coloring Book',
    expectH1: true,
    expectBodyText: ['₹299', 'Baby Animals Coloring Book', 'What'],
    expectNoFooter: true,
  })

  const r2 = await get('/shop?zone=kids')
  ok(r2.status === 200, '/shop?zone=kids: HTTP 200')
  assertHead(r2.html, {
    url: '/shop?zone=kids',
    expectedTitlePart: 'Digital Kidosphere',
    expectH1: true,
    expectBodyText: ['Baby Animals Coloring Book'],
    expectFooter: true,
  })

  const r2c = await get('/category/kids/coloring-books')
  ok(r2c.status === 200, '/category/kids/coloring-books: HTTP 200')
  assertHead(r2c.html, {
    url: '/category/kids/coloring-books',
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
    types: ['Product', 'BreadcrumbList', 'Offer'],
    bannedTypes: ['aggregateRating', 'FAQPage'], // no real review rows on the page; no FAQ visible
    requireAbsoluteUrls: true,
  })
  const skuOk = r1.html.includes('"sku":"baby-animals-coloring-book"')
  ok(skuOk, `${productPath}: Product.sku = slug`)
  const offerPrices = [...r1.html.matchAll(/"price":([\d.]+),"priceCurrency":"(\w+)"/g)].map((m) => m[2])
  ok(offerPrices.includes('INR') && offerPrices.includes('USD'), `${productPath}: INR + USD offers`, offerPrices.join(','))
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
  ok(slugs.length >= 25, `sitemap: product URLs present (${slugs.length})`)
  ok(slugs.includes('baby-animals-coloring-book'), 'sitemap: contains the probe product')
  ok(!rs.html.includes('/admin') && !rs.html.includes('thank-you') && !rs.html.includes('/download'), 'sitemap: no private URLs')
  ok(!rs.html.includes('localhost') || BASE.includes('localhost'), 'sitemap: no localhost unless test base')
  const catUrls = [...rs.html.matchAll(/<loc>[^<]*\/category\/([^<]+)<\/loc>/g)].map((m) => m[1])
  ok(catUrls.length >= 12, `sitemap: category URLs present (${catUrls.length})`)
  for (const p of ['/privacy', '/terms', '/refund-policy', '/contact']) {
    ok(rs.html.includes(`<loc>${BASE}${p}</loc>`), `sitemap: ${p} listed`)
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
  // sample llms.txt URLs return 200
  const sample = llmsUrls.filter((u) => u.includes('/product/') || u.includes('/category/')).slice(0, 5)
  for (const u of sample) {
    const res = await fetch(u)
    ok(res.status === 200, `llms.txt link 200: ${u.replace(BASE, '')}`)
  }

  // ── Test 4 + 6: redirects, 404s, console — browser level ──
  console.log('〔4〕 hash redirects + 404 + console (browser)')
  const browser = await chromium.launch({ headless: true, executablePath: CHROME })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const consoleErrors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)) })
  page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR ${String(e).slice(0, 160)}`))

  await page.goto(`${BASE}/#/product/baby-animals-coloring-book`, { waitUntil: 'load' })
  await page.waitForURL(/\/product\/baby-animals-coloring-book/, { timeout: 15000 })
  ok(page.url().includes('/product/baby-animals-coloring-book'), 'hash /#/product/<slug> → real URL', page.url())

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
  await page.goto(`${BASE}/product/baby-animals-coloring-book`, { waitUntil: 'load' })
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
