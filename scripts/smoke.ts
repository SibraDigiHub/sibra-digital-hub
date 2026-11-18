// ═══════════════════════════════════════════════════════════
// smoke.ts — deployable-posture verifier for local, staging, prod.
//
//   bun scripts/smoke.ts --env local
//   FRONTEND_URL=https://… BACKEND_URL=https://… bun scripts/smoke.ts --env staging
//   FRONTEND_URL=… BACKEND_URL=… bun scripts/smoke.ts --env prod
//
// Safety law: in `prod` mode only GET/HEAD plus SAFE NEGATIVE POSTs
// (bad signature, invalid token, bogus id) are ever sent — nothing
// here can create an order, consume a download or touch data.
// Exit code is non-zero when any check FAILs; WARN rows are advisory.
// A markdown report is written to reports/verify-<env>-<ts>.md.
// ═══════════════════════════════════════════════════════════

import {
  type Check,
  type Env,
  type Targets,
  fail,
  fetchWithTimeout,
  findLeakTerms,
  pass,
  percentile,
  printCheckTable,
  resolveTargets,
  skip,
  warn,
  writeReport,
} from './_lib'

const LEAK_STRING_RE = /(localhost|127\.0\.0\.1|:3001)/
const budgets: {
  smokeP95LocalMs: number
  smokeP95RemoteMs: number
  adminProbes: string[]
} = require('../perf-budgets.json')

function argEnv(): Env {
  const i = process.argv.indexOf('--env')
  const value = i > -1 ? process.argv[i + 1] : undefined
  if (value === 'local' || value === 'staging' || value === 'prod') return value
  console.error('usage: bun scripts/smoke.ts --env local|staging|prod')
  process.exit(1)
}

async function timed(url: string, init: RequestInit = {}): Promise<{ res: Response; ms: number }> {
  const started = Date.now()
  try {
    const res = await fetchWithTimeout(url, init, 20_000)
    return { res, ms: Date.now() - started }
  } catch {
    // A dead/unreachable origin is EVIDENCE (deploy down), not a crash —
    // return a synthetic failed response so the affected checks FAIL and
    // the run still produces its full table + report.
    return { res: new Response('{"error":"unreachable"}', { status: 0, statusText: 'unreachable', headers: { 'content-type': 'application/json' } }), ms: Date.now() - started }
  }
}

// ── 1+2. home page + health + security headers ──────────────────
function headerCheck(id: string, label: string, headers: Headers, https: boolean, browserFacing: boolean): Check {
  const cspMode = headers.get('content-security-policy')
    ? 'enforce'
    : headers.get('content-security-policy-report-only')
      ? 'report-only'
      : null
  const missing: string[] = []
  if (headers.get('x-content-type-options') !== 'nosniff') missing.push('nosniff')
  if (!headers.get('referrer-policy')) missing.push('referrer-policy')
  if (https && !headers.get('strict-transport-security')) missing.push('hsts')
  if (browserFacing) {
    // Full browser hardening lives on the frontend app shell; the backend
    // serves JSON APIs only (see FINDINGS.md #backend-headers for the
    // defense-in-depth gap on the direct API origin).
    if (!headers.get('permissions-policy')) missing.push('permissions-policy')
    if (!headers.get('x-frame-options') && !(headers.get('content-security-policy-report-only') ?? headers.get('content-security-policy') ?? '').includes('frame-ancestors'))
      missing.push('frame-ancestors/xfo')
    if (!cspMode) missing.push('csp')
  }
  if (missing.length > 0) return fail(id, label, `missing: ${missing.join(', ')}`)
  return pass(id, label, `nosniff, referrer-policy${https ? ', hsts' : ''}${browserFacing ? `, permissions-policy, csp=${cspMode}` : ' (api origin — browser headers enforced on the frontend)'}`)
}

async function checkHealthAndHeaders(t: Targets, env: Env): Promise<Check[]> {
  const out: Check[] = []
  const https = t.frontendUrl.startsWith('https')
  const home = await timed(`${t.frontendUrl}/`)
  out.push(
    home.res.status === 200
      ? pass('fe-home', 'frontend / is 200', `status 200 in ${home.ms}ms`, home.ms)
      : fail('fe-home', 'frontend / is 200', `status ${home.res.status}`),
  )
  const homeHtml = await home.res.text()

  const health = await timed(`${t.frontendUrl}/api`)
  let healthBody: Record<string, unknown> = {}
  try {
    healthBody = (await health.res.json()) as Record<string, unknown>
  } catch {
    /* handled below */
  }
  const healthOk = health.res.status === 200 && healthBody.ok === true && healthBody.db === true
  if (!healthOk) {
    out.push(fail('health-proxy', 'health via proxy {ok,db}', `status ${health.res.status} body ${JSON.stringify(healthBody).slice(0, 120)}`))
  } else if (env === 'prod' && (healthBody.demoMode !== false || healthBody.testPaymentsAllowed !== false)) {
    out.push(fail('health-proxy', 'health via proxy {ok,db}', `PROD posture wrong: demoMode=${String(healthBody.demoMode)} testPaymentsAllowed=${String(healthBody.testPaymentsAllowed)} — demo/test flags must be off`))
  } else {
    out.push(pass('health-proxy', 'health via proxy {ok,db}', `ok:true db:true demoMode=${String(healthBody.demoMode)} testPaymentsAllowed=${String(healthBody.testPaymentsAllowed)}`))
  }

  const beHealth = await timed(`${t.backendUrl}/api`)
  out.push(
    beHealth.res.status === 200
      ? pass('health-direct', 'backend health direct', `status 200`)
      : warn('health-direct', 'backend health direct', `status ${beHealth.res.status} (may be private — advisory)`),
  )

  out.push(headerCheck('headers-fe', 'frontend security headers', home.res.headers, https, true))
  const beRes = await fetchWithTimeout(`${t.backendUrl}/api`)
  out.push(headerCheck('headers-be', 'backend security headers', beRes.headers, https, false))
  return out
}

// ── 3. metadata surfaces + OG tags ──────────────────────────────
async function checkSurfaces(t: Targets, homeHtml: string): Promise<Check[]> {
  const out: Check[] = []
  for (const p of ['/robots.txt', '/sitemap.xml', '/llms.txt', '/manifest.webmanifest']) {
    const { res } = await timed(`${t.frontendUrl}${p}`)
    out.push(res.status === 200 ? pass(`surface:${p}`, `${p} is 200`, 'ok') : fail(`surface:${p}`, `${p} is 200`, `status ${res.status}`))
  }
  const ogNeeded = ['og:title', 'og:description', 'og:image', 'og:url']
  const ogTags = ogNeeded.map((tag) => {
    const m = homeHtml.match(new RegExp(`<meta[^>]+property="${tag}"[^>]+content="([^"]+)"`))
    return { tag, value: m?.[1] }
  })
  const missingOg = ogTags.filter((o) => !o.value)
  // og:url and og:image are URLs and must be absolute; og:title/og:description
  // are free text (presence only).
  const nonAbsolute = ogTags.filter((o) => o.value && (o.tag === 'og:url' || o.tag === 'og:image') && !/^https?:\/\//.test(o.value))
  if (missingOg.length > 0 || nonAbsolute.length > 0) {
    out.push(fail('og-tags', 'OG tags present + absolute', `missing: [${missingOg.map((o) => o.tag)}], non-absolute: [${nonAbsolute.map((o) => o.tag)}]`))
  } else {
    out.push(pass('og-tags', 'OG tags present + absolute', ogTags.map((o) => `${o.tag}=${o.value!.slice(0, 60)}`).join(' ')))
  }
  const ogImage = ogTags.find((o) => o.tag === 'og:image')?.value
  if (ogImage) {
    const { res } = await timed(ogImage)
    const type = res.headers.get('content-type') ?? ''
    out.push(
      res.status === 200 && type.startsWith('image/')
        ? pass('og-image', 'og:image fetches 200 image/*', `${type}`)
        : fail('og-image', 'og:image fetches 200 image/*', `status ${res.status} type ${type}`),
    )
  }
  return out
}

// ── 4. no private hosts in public output (staging/prod) ─────────
async function checkNoPrivateStrings(t: Targets, homeHtml: string): Promise<Check> {
  const bodies: string[] = [homeHtml]
  for (const p of ['/api/products', '/api/settings', '/api/faqs', '/api/reviews']) {
    const { res } = await timed(`${t.frontendUrl}${p}`)
    bodies.push(await res.text())
  }
  const headerBlob = [...(await fetchWithTimeout(`${t.frontendUrl}/`)).headers.entries()].map(([k, v]) => `${k}=${v}`).join('\n')
  bodies.push(headerBlob)
  const hits = bodies.map((b, i) => (LEAK_STRING_RE.test(b) ? `sample#${i}` : null)).filter(Boolean)
  if (hits.length > 0) return fail('no-local-strings', 'no localhost/:3001 in public output', `found in ${hits.length} response(s) — inspect reports file`)
  return pass('no-local-strings', 'no localhost/:3001 in public output', 'home HTML + 4 public APIs + headers clean')
}

// ── 5. catalog payload leak scan ────────────────────────────────
async function checkCatalogLeaks(t: Targets): Promise<Check[]> {
  const out: Check[] = []
  const paths = ['/api/products', '/api/products?zone=kids', '/api/products?search=a', '/api/settings', '/api/download/aaaaaaaaaaaaaaaaaaaaaaaa?mode=json', '/api/payments/config']
  for (const p of paths) {
    const { res } = await timed(`${t.frontendUrl}${p}`)
    const text = await res.text()
    let parsed: unknown = text
    try {
      parsed = JSON.parse(text)
    } catch {
      /* html responses scanned as text */
    }
    const hits = findLeakTerms(parsed)
    out.push(
      hits.length === 0
        ? pass(`leak:${p.split('?')[0]}`, `no leak terms in ${p.split('?')[0]}`, `status ${res.status}`)
        : fail(`leak:${p.split('?')[0]}`, `no leak terms in ${p.split('?')[0]}`, hits.slice(0, 4).join('; ')),
    )
  }
  return out
}

// ── 6+7. legacy/demo/webhook/cron negative probes ───────────────
async function checkNegativeProbes(t: Targets, env: Env): Promise<Check[]> {
  const out: Check[] = []
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    timed(`${t.frontendUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

  const legacy = await post('/api/orders', { productSlug: 'probe' })
  out.push(legacy.res.status === 410 ? pass('legacy-orders', 'legacy POST /api/orders is 410', 'retired') : fail('legacy-orders', 'legacy POST /api/orders is 410', `status ${legacy.res.status}`))

  if (env === 'prod') {
    const demo1 = await post('/api/orders/ckprobe00000000000000/demo-pay', {})
    const demo2 = await post('/api/checkout/paypal/demo-capture', {})
    const demoOk = demo1.res.status === 404 && demo2.res.status === 404
    out.push(demoOk ? pass('demo-routes', 'demo routes are 404 in prod', 'both 404') : fail('demo-routes', 'demo routes are 404 in prod', `demo-pay=${demo1.res.status} demo-capture=${demo2.res.status} — DEMO_MODE must be unset in prod`))
  } else {
    out.push(skip('demo-routes', 'demo routes are 404 in prod', 'prod-only check (staging/local may legitimately answer 403/409)'))
  }

  const rzp = await post('/api/razorpay/webhook', { event: 'probe' })
  const pp = await post('/api/paypal/webhook', { event_type: 'PROBE' })
  // Razorpay-only migration: the Razorpay webhook (no signature → 400) is the
  // only webhook route; the PayPal webhook route was removed (404).
  const webhookOk = rzp.res.status === 400 && pp.res.status === 404
  out.push(webhookOk ? pass('webhook-nosig', 'razorpay webhook without signature is 400; removed paypal webhook is 404', `razorpay=${rzp.res.status} paypal=${pp.res.status}`) : fail('webhook-nosig', 'razorpay webhook without signature is 400; removed paypal webhook is 404', `razorpay=${rzp.res.status} paypal=${pp.res.status}`))

  for (const cron of ['/api/cron/reconcile-payments', '/api/cron/retry-emails']) {
    const { res } = await timed(`${t.frontendUrl}${cron}`)
    if (res.status === 401) out.push(pass(`cron:${cron.split('/').pop()}`, `cron without bearer is 401 (${cron.split('/').pop()})`, '401'))
    else if (env === 'prod') out.push(fail(`cron:${cron.split('/').pop()}`, `cron without bearer is 401 (${cron.split('/').pop()})`, `status ${res.status} — CRON_SECRET must be set in prod`))
    else out.push(warn(`cron:${cron.split('/').pop()}`, `cron without bearer is 401 (${cron.split('/').pop()})`, `status ${res.status} — tolerated outside prod; set CRON_SECRET before go-live`))
  }
  return out
}

// ── 8. admin route inventory (unauthenticated) ──────────────────
async function checkAdminRoutes(t: Targets): Promise<Check[]> {
  const out: Check[] = []
  let blocked = 0
  const leaks: string[] = []
  for (const path of budgets.adminProbes) {
    const { res } = await timed(`${t.frontendUrl}${path}`)
    if (res.status === 401 || res.status === 403) blocked += 1
    else leaks.push(`${path}=${res.status}`)
  }
  out.push(
    leaks.length === 0
      ? pass('admin-401', `all ${budgets.adminProbes.length} admin probes blocked`, `${blocked}× 401/403`)
      : fail('admin-401', `all ${budgets.adminProbes.length} admin probes blocked`, `UNPROTECTED: ${leaks.join(', ')}`),
  )
  const session = await timed(`${t.frontendUrl}/api/admin/session`)
  let body: Record<string, unknown> = {}
  try {
    body = (await session.res.json()) as Record<string, unknown>
  } catch {
    /* fallthrough */
  }
  out.push(
    session.res.status === 200 && body.authenticated === false
      ? pass('admin-session', 'GET /api/admin/session → authenticated:false', 'anti-enumeration shape intact')
      : fail('admin-session', 'GET /api/admin/session → authenticated:false', `status ${session.res.status} body ${JSON.stringify(body).slice(0, 80)}`),
  )
  return out
}

// ── 9. quote routing table (local/staging only) ─────────────────
async function checkQuoteRouting(t: Targets): Promise<Check[]> {
  const out: Check[] = []
  const products = await fetchWithTimeout(`${t.frontendUrl}/api/products`)
  const list = (await products.json()) as { products?: Array<Record<string, unknown>> }
  const instant = (list.products ?? []).find((p) => p.instantDownload === true)
  if (!instant) return [fail('quote', 'quote routing table', 'no instant-download product found in /api/products')]
  const productId = String(instant.id)
  const quote = async (country: string) =>
    timed(`${t.frontendUrl}/api/checkout/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: t.frontendUrl },
      body: JSON.stringify({ productId, country }),
    })
  // Razorpay-only migration: PayPal is no longer a gateway. International
  // quotes are flag-gated (INTERNATIONAL_CHECKOUT_ENABLED): either 200
  // razorpay/USD (flag on) or 422 with the marketplace-fallback message
  // (flag off — the shipped default). Both prove the server decides.
  const intlOk = (status: number, b: Record<string, unknown>): boolean =>
    (status === 200 && b.gateway === 'razorpay' && b.currency === 'USD') ||
    (status === 422 && typeof b.error === 'string' && /marketplace/i.test(String(b.error)))
  const cases: Array<[string, (status: number, b: Record<string, unknown>) => boolean, string]> = [
    ['IN', (_s, b) => b.gateway === 'razorpay' && b.currency === 'INR', 'razorpay/INR'],
    ['US', intlOk, 'razorpay/USD | marketplace-fallback'],
    ['GB', intlOk, 'razorpay/USD | marketplace-fallback'],
    ['AE', intlOk, 'razorpay/USD | marketplace-fallback'],
    ['SG', intlOk, 'razorpay/USD | marketplace-fallback'],
  ]
  for (const [country, verify, expect] of cases) {
    const { res } = await quote(country)
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    out.push(
      verify(res.status, body)
        ? pass(`quote:${country}`, `quote ${country} → ${expect}`, `status ${res.status} display=${String(body.display ?? body.error ?? '').slice(0, 40)}`)
        : fail(`quote:${country}`, `quote ${country} → ${expect}`, `status ${res.status} body ${JSON.stringify(body).slice(0, 100)}`),
    )
  }
  // ZZ is not an assigned ISO country — same flag-gated international
  // posture as the named countries above (razorpay/USD when enabled,
  // marketplace fallback otherwise). The friendly-error path is exercised
  // with a bogus product id (404) and a bogus country shape (422) below.
  const zz = await quote('ZZ')
  const zzBody = (await zz.res.json().catch(() => ({}))) as Record<string, unknown>
  out.push(
    intlOk(zz.res.status, zzBody)
      ? pass('quote:ZZ', 'quote well-formed unknown country → intl posture (server-decided)', `status ${zz.res.status} display=${String(zzBody.display ?? zzBody.error ?? '').slice(0, 40)}`)
      : fail('quote:ZZ', 'quote well-formed unknown country → intl posture (server-decided)', `status ${zz.res.status} body ${JSON.stringify(zzBody).slice(0, 100)}`),
  )
  const missing = await timed(`${t.frontendUrl}/api/checkout/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: t.frontendUrl },
    body: JSON.stringify({ productId: 'ckprobe00000000000000', country: 'IN' }),
  })
  const missingBody = (await missing.res.json().catch(() => ({}))) as Record<string, unknown>
  out.push(
    [404, 422].includes(missing.res.status) && typeof missingBody.error === 'string' && missingBody.error.length > 10
      ? pass('quote:bogus-product', 'quote bogus product → friendly error', `status ${missing.res.status}: ${String(missingBody.error).slice(0, 60)}`)
      : fail('quote:bogus-product', 'quote bogus product → friendly error', `status ${missing.res.status} body ${JSON.stringify(missingBody).slice(0, 100)}`),
  )
  const foreign = await timed(`${t.frontendUrl}/api/checkout/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example.com' },
    body: JSON.stringify({ productId, country: 'IN' }),
  })
  out.push(foreign.res.status === 403 ? pass('quote:origin', 'quote cross-origin → 403', 'origin guard alive') : fail('quote:origin', 'quote cross-origin → 403', `status ${foreign.res.status}`))
  return out
}

// ── 3b. real-URL SEO surfaces (canonical/OG absolute, robots rules, sitemap) ──
async function checkSeoRoutes(t: Targets): Promise<Check[]> {
  const out: Check[] = []
  const isLocalOrigin = /(localhost|127\.0\.0\.1)/.test(t.frontendUrl)
  // JSON-LD is required on catalog/product surfaces (ItemList/Breadcrumb/Product);
  // legal pages carry metadata only — no schema type applies, so none is asserted.
  const pages: { path: string; requireJsonLd: boolean }[] = [
    { path: '/shop?zone=kids', requireJsonLd: true },
    { path: '/privacy', requireJsonLd: false },
    { path: '/terms', requireJsonLd: false },
  ]
  // one published product slug straight from the sitemap (never hard-coded)
  const sm = await timed(`${t.frontendUrl}/sitemap.xml`)
  const smText = await sm.res.text()
  const slugMatch = smText.match(/<loc>[^<]*\/product\/([a-z0-9-]+)<\/loc>/)
  if (slugMatch) pages.push({ path: `/product/${slugMatch[1]}`, requireJsonLd: true })

  for (const { path: p, requireJsonLd } of pages) {
    const { res } = await timed(`${t.frontendUrl}${p}`)
    if (res.status !== 200) {
      out.push(fail(`seo:${p}`, `${p} renders (real route)`, `status ${res.status}`))
      continue
    }
    const html = await res.text()
    const problems: string[] = []
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1]
    if (!canonical) problems.push('no canonical')
    else {
      if (!/^https?:\/\//.test(canonical)) problems.push('canonical not absolute')
      if (canonical.includes('#')) problems.push('canonical has hash')
      if (!isLocalOrigin && /(localhost|127\.0\.0\.1)/.test(canonical)) problems.push('canonical localhost')
    }
    for (const tag of ['og:url', 'og:image']) {
      const v = html.match(new RegExp(`property="${tag}" content="([^"]+)"`))?.[1]
      if (!v) problems.push(`no ${tag}`)
      else if (!/^https?:\/\//.test(v)) problems.push(`${tag} not absolute`)
      else if (!isLocalOrigin && /(localhost|127\.0\.0\.1)/.test(v)) problems.push(`${tag} localhost`)
    }
    if (requireJsonLd && !html.includes('application/ld+json')) problems.push('no JSON-LD')
    out.push(
      problems.length === 0
        ? pass(`seo:${p}`, `${p} canonical/OG absolute + JSON-LD`, 'ok')
        : fail(`seo:${p}`, `${p} canonical/OG absolute + JSON-LD`, problems.join('; ')),
    )
  }

  out.push(
    sm.res.status === 200 && slugMatch
      ? pass('seo:sitemap-products', 'sitemap lists published product URLs', `${(smText.match(/\/product\//g) ?? []).length} product locs`)
      : fail('seo:sitemap-products', 'sitemap lists published product URLs', `status ${sm.res.status}`),
  )
  out.push(
    smText.includes('/admin') || smText.includes('thank-you')
      ? fail('seo:sitemap-private', 'sitemap excludes private routes', 'private path found')
      : pass('seo:sitemap-private', 'sitemap excludes private routes', 'ok'),
  )

  const rb = await timed(`${t.frontendUrl}/robots.txt`)
  const rbText = await rb.res.text()
  const robotsOk =
    rb.res.status === 200 &&
    rbText.includes('Disallow: /admin') &&
    rbText.includes('Disallow: /api') &&
    rbText.includes('Disallow: /thank-you') &&
    rbText.includes('Disallow: /download') &&
    rbText.includes('Disallow: /watch') &&
    /Sitemap: https?:\/\//.test(rbText)
  out.push(
    robotsOk
      ? pass('seo:robots', 'robots rules + absolute sitemap reference', 'ok')
      : fail('seo:robots', 'robots rules + absolute sitemap reference', `status ${rb.res.status}`),
  )
  return out
}

// ── 10. latency budget ──────────────────────────────────────────
async function checkLatency(t: Targets, env: Env): Promise<Check> {
  const budgetMs = env === 'local' ? budgets.smokeP95LocalMs : budgets.smokeP95RemoteMs
  const paths = ['/api/products', '/api/faqs', '/api/reviews', '/api/settings']
  const samples: number[] = []
  for (let i = 0; i < 6; i++) {
    for (const p of paths) {
      const { ms, res } = await timed(`${t.frontendUrl}${p}`)
      if (res.status === 200) samples.push(ms)
    }
  }
  if (samples.length === 0) return fail('latency', `public GET p95 ≤ ${budgetMs}ms`, '0 successful samples — public GETs are failing (proxy/backend down or transport 401)')
  const p95 = percentile(samples, 95)
  if (p95 <= budgetMs) return pass('latency', `public GET p95 ≤ ${budgetMs}ms`, `p95=${p95}ms over ${samples.length} samples`, p95)
  return fail('latency', `public GET p95 ≤ ${budgetMs}ms`, `p95=${p95}ms over ${samples.length} samples — exceeds budget`, p95)
}

// ── 11. TLS + mixed content (https environments) ────────────────
async function checkTls(t: Targets, homeHtml: string): Promise<Check[]> {
  const out: Check[] = []
  if (!t.frontendUrl.startsWith('https')) return [skip('tls', 'https redirect + mixed content', 'local is plain http — n/a')]
  const httpUrl = t.frontendUrl.replace('https://', 'http://')
  const redirect = await timed(`${httpUrl}/`)
  out.push(
    [301, 302, 307, 308].includes(redirect.res.status)
      ? pass('tls:redirect', 'http → https redirect', `status ${redirect.res.status}`)
      : fail('tls:redirect', 'http → https redirect', `status ${redirect.res.status}`),
  )
  const mixed = homeHtml.match(/(?:src|href)="http:\/\/(?![^"]*(?:w3\.org|schema\.org|purl\.org))/g) ?? []
  out.push(mixed.length === 0 ? pass('tls:mixed', 'no mixed content in home HTML', 'clean') : fail('tls:mixed', 'no mixed content in home HTML', `${mixed.length} http:// resource refs`))
  return out
}

async function main(): Promise<void> {
  const env = argEnv()
  const t = resolveTargets(env)
  console.log(`smoke ${env} → frontend=${t.frontendUrl} backend=${t.backendUrl}`)

  const checks: Check[] = []
  checks.push(...(await checkHealthAndHeaders(t, env)))
  // one home-HTML fetch reused by every later text-level check
  const homeRes = await fetchWithTimeout(`${t.frontendUrl}/`)
  const html = homeRes.status === 200 ? await homeRes.text() : ''
  checks.push(...(await checkSurfaces(t, html)))
  checks.push(...(await checkSeoRoutes(t)))
  if (env !== 'local') checks.push(await checkNoPrivateStrings(t, html))
  else checks.push(skip('no-local-strings', 'no localhost/:3001 in public output', 'local runs on localhost — n/a'))
  checks.push(...(await checkCatalogLeaks(t)))
  checks.push(...(await checkNegativeProbes(t, env)))
  checks.push(...(await checkAdminRoutes(t)))
  if (env === 'local' || env === 'staging') checks.push(...(await checkQuoteRouting(t)))
  else checks.push(skip('quote', 'quote routing table', 'prod: quote probes are skipped (no test product assumed)'))
  checks.push(await checkLatency(t, env))
  checks.push(...(await checkTls(t, html)))

  printCheckTable(`smoke ${env}`, checks)
  const report = writeReport(env, `Smoke verification — ${env}`, checks)
  console.log(`report: ${report}`)
  if (checks.some((c) => c.kind === 'fail')) process.exit(1)
}

main().catch((e: Error) => {
  console.error(`smoke failed: ${e.message}`)
  process.exit(1)
})
