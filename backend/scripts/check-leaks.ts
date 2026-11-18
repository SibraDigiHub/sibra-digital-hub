// ═══════════════════════════════════════════════════════════
// T5 check:leaks — paid file references and secrets must never
// appear in any PUBLIC response (§6.5).
//
// Live calls (read-only / safe):
//   • GET /api                    (health)
//   • GET /api/products           (catalog list)
//   • GET /api/products?slug=…    (public product detail, per slug)
//   • GET /api/products?zone=…    (zone filter)
//   • GET /api/settings
//   • GET /api/download/<bogus>   (+ ?mode=json) — 40-char random token
// The bodies are scanned for: deliverableUrl, deliverableName,
// fileId, tokenHash, key_secret, ik-sig / ik-exp (T6 signed-URL
// parameters), and any "deliverable"/"fileId" substring per the
// master spec.
//
// Static inspection (no junk orders created):
//   • POST /api/orders route — the public create path builds its
//     response from publicOrderDTO; the script asserts that the
//     public order routes reference the public DTO and that
//     publicOrderDTO/toPublicProductDTO never emit leak fields;
//   • demo-pay route — asserts the production 404 guard exists;
//   • T6 — signed ImageKit URLs (`ik-sig=`) may be constructed ONLY
//     inside src/lib/storage.ts, and the download route must mint
//     them through that helper (the signed URL reaches the customer
//     only via the redirect Location / token-validated mode=json),
//     while the imagekit auth route stays admin-guarded when
//     configured and keeps the unconfigured 501 fallback.
//
// Exit 1 on any hit. Usage: bun scripts/check-leaks.ts
// ═══════════════════════════════════════════════════════════
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.LEAK_BASE_URL ?? 'http://localhost:3001'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Terms that must NEVER appear in a public response body.
// T6: ik-sig / ik-exp are the signed-URL parameters of ImageKit
// private-file links — a hit would mean a live signed URL leaked.
const LEAK_TERMS = ['deliverableUrl', 'deliverableName', 'deliverable', 'fileId', 'tokenHash', 'key_secret', 'client_secret', 'ik-sig', 'ik-exp'] as const

const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? ''
let failures = 0
const hits: string[] = []
const srcFiles: string[] = []

/** Collect every .ts/.tsx source file under src/ for the static checks. */
function walkSrc(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walkSrc(full)
    else if (/\.tsx?$/.test(entry)) srcFiles.push(full)
  }
}

// Bot UA: the slug-lookup path skips product_view analytics for bots, so the
// leak check never pollutes the ActivityEvent feed (which would churn the
// volatile admin-analytics/admin-system contract goldens).
const BOT_UA = 'T5-LeakCheck-Bot (compatible; bot)'

function scan(name: string, body: string, terms: readonly string[] = LEAK_TERMS): void {
  for (const term of terms) {
    if (body.toLowerCase().includes(term.toLowerCase())) {
      failures++
      hits.push(`${name}: contains "${term}"`)
    }
  }
}

/**
 * Fetch a PUBLIC endpoint and scan the body. A non-expected status is itself
 * a FAILURE — a 401/403 on a public endpoint means the transport guard
 * rejected this scan (INTERNAL_API_KEY mismatch between script env and the
 * server), which previously produced a VACUOUS pass: 401 bodies contain no
 * leak terms, so "clean" was indistinguishable from "unauthorized"
 * (FINDINGS #env-drift-401). Expected statuses are explicit per probe.
 */
async function call(name: string, path: string, expectStatus = 200): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'x-internal-key': INTERNAL_KEY, 'user-agent': BOT_UA },
    // 302 probes must NOT follow the redirect — following silently landed on
    // the frontend homepage (200 HTML) and scanned THAT instead of the API's
    // own response.
    redirect: expectStatus === 302 ? 'manual' : 'follow',
  })
  const body = await res.text()
  if (res.status !== expectStatus) {
    failures++
    const hint =
      res.status === 401 || res.status === 403
        ? ' — transport guard rejected this scan: INTERNAL_API_KEY mismatch between this script and the server. Fix the key pair before trusting any leak result.'
        : ` — expected ${expectStatus}; body: ${body.slice(0, 120)}`
    hits.push(`${name} ${path}: unexpected status ${res.status}${hint}`)
    console.log(`scanned ${name} ${path} → ${res.status} ✗ (expected ${expectStatus})`)
    return
  }
  if (expectStatus === 302) {
    // The redirect must land on the SITE origin (PUBLIC_WEB_URL), never the
    // API origin — the API host serves no SPA (#download-redirect-origin).
    const loc = res.headers.get('location') ?? ''
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.PUBLIC_WEB_URL
    const expectedOrigin = siteUrl ? new URL(siteUrl).origin : new URL(BASE).origin
    let originOk = false
    try {
      originOk = new URL(loc).origin === expectedOrigin
    } catch {
      /* unparseable Location is a failure below */
    }
    if (!originOk) {
      failures++
      hits.push(`${name} ${path}: redirect Location is not the SITE origin (got "${loc.slice(0, 100)}", expected origin ${expectedOrigin})`)
    }
  }
  scan(`${name} ${path} [${res.status}]`, body)
  console.log(`scanned ${name} ${path} → ${res.status}`)
}

// ── 1. Live public handlers ─────────────────────────────────
async function liveChecks(): Promise<void> {
  await call('health', '/api')
  await call('products-list', '/api/products')
  await call('products-zone', '/api/products?zone=kids')
  await call('settings', '/api/settings')

  // Public detail per slug — cover every published slug (bounded).
  try {
    const res = await fetch(`${BASE}/api/products`, {
      headers: { 'x-internal-key': INTERNAL_KEY, 'user-agent': BOT_UA },
    })
    if (res.status !== 200) {
      failures++
      hits.push(`product-slug enumeration: unexpected status ${res.status} — transport guard or catalog broken; leak scan would have been vacuous`)
    }
    const data = (await res.json()) as { products?: { slug?: string }[] }
    const slugs = (data.products ?? []).map((p) => p.slug).filter((s): s is string => Boolean(s)).slice(0, 30)
    if (slugs.length === 0) {
      failures++
      hits.push('product-slug enumeration: 0 published slugs — the catalog is empty or the response shape changed')
    }
    for (const slug of slugs) await call('product-slug', `/api/products?slug=${encodeURIComponent(slug)}`)
  } catch (e) {
    failures++
    hits.push(`product-slug enumeration failed: ${e instanceof Error ? e.message : e}`)
  }

  // Download route with a bogus token (both response modes) — the browser
  // path answers 302 → SITE-origin download page; json answers 403 JSON.
  const bogus = 'leakcheck0000000000000000000000000000aa'
  await call('download-bogus', `/api/download/${bogus}`, 302)
  await call('download-bogus-json', `/api/download/${bogus}?mode=json`, 403)

  // Dual payment: public gateway config (ids + booleans only).
  await call('payments-config', '/api/payments/config')
}

// ── 2. Static code-path inspection (orders create is "dry") ──
function staticChecks(): void {
  const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')

  // 2a. publicOrderDTO must not reference leak fields.
  const service = read('src/services/order-service.ts')
  const publicDto = service.match(/export function publicOrderDTO[\s\S]*?\n\}/)?.[0]
  if (!publicDto) {
    failures++
    hits.push('static: publicOrderDTO not found in order-service')
  } else {
    scan('static publicOrderDTO', publicDto)
    const createRoute = read('src/app/api/orders/route.ts')
    if (!createRoute.includes('publicOrderDTO')) {
      failures++
      hits.push('static: POST /api/orders does not use publicOrderDTO')
    }
    const orderGet = read('src/app/api/orders/[id]/route.ts')
    if (!orderGet.includes('publicOrderDTO')) {
      failures++
      hits.push('static: GET /api/orders/[id] does not use publicOrderDTO')
    }
    // Dual payment: every new public order-emitting route must use the public DTO.
    const statusGet = read('src/app/api/orders/[id]/status/route.ts')
    if (!statusGet.includes('publicOrderDTO')) {
      failures++
      hits.push('static: GET /api/orders/[id]/status does not use publicOrderDTO')
    }
    // Single-gateway migration: the PayPal capture routes were removed —
    // their public-DTO guarantees moved entirely to the Razorpay paths.
  }

  // 2b. toPublicProductDTO must not reference leak fields, and the
  //     public slug path must use it.
  const productService = read('src/services/product-service.ts')
  const publicProduct = productService.match(/export function toPublicProductDTO[\s\S]*?\n\}/)?.[0]
  if (!publicProduct) {
    failures++
    hits.push('static: toPublicProductDTO not found')
  } else {
    scan('static toPublicProductDTO', publicProduct)
    const productsRoute = read('src/app/api/products/route.ts')
    if (!productsRoute.includes('toPublicProductDTO')) {
      failures++
      hits.push('static: GET /api/products?slug does not use toPublicProductDTO')
    }
  }

  // 2c. demo-pay must 404 in production. (Re-audit: the gate moved into
  //     config/env.ts#demoRouteBlocked — unit-tested in tests/payments —
  //     so the static check asserts the route actually calls it.)
  const demoPay = read('src/app/api/orders/[id]/demo-pay/route.ts')
  if (!(demoPay.includes('demoRouteBlocked()') && demoPay.includes('404'))) {
    failures++
    hits.push('static: demo-pay lacks the production 404 guard')
  }

  // 2c'. single-gateway migration: the PayPal demo capture route is gone —
  //      the only mock-payment surface left is demo-pay (checked above).
  // 2d. the webhook computes the HMAC on the raw body before parsing.
  const webhook = read('src/app/api/razorpay/webhook/route.ts')
  const rawFirst = /const raw = await req\.text\(\)[\s\S]*?verifyWebhookSignature\(raw/.test(webhook)
  if (!rawFirst) {
    failures++
    hits.push('static: webhook does not verify the signature on the raw body before parsing')
  }

  // 2e. T6 — ImageKit signed-URL parameters (`ik-sig`/`ik-exp`) may only
  //     be constructed inside lib/storage.ts. Any other src file touching
  //     them means a signed URL could leak into a non-storage code path.
  walkSrc(join(ROOT, 'src'))
  const allowedSigners = new Set(['src/lib/storage.ts'])
  for (const f of srcFiles) {
    const rel = relative(ROOT, f).split('\\').join('/')
    if (allowedSigners.has(rel)) continue
    if (/ik-sig|ik-exp/.test(read(relative(ROOT, f)))) {
      failures++
      hits.push(`static: signed-URL parameters referenced outside lib/storage (${rel})`)
    }
  }

  // 2f. T6 — the download route mints ImageKit private-file URLs through
  //     the storage helper (never inline).
  const downloadRoute = read('src/app/api/download/[token]/route.ts')
  if (!downloadRoute.includes('imagekitSignedUrlFromRef') || !downloadRoute.includes('isImagekitRef')) {
    failures++
    hits.push('static: download route does not route ik: refs through lib/storage')
  }

  // 2g. T6 — the imagekit auth route stays admin-guarded when configured
  //     and keeps the unconfigured 501 fallback shape.
  const ikRoute = read('src/app/api/imagekit/auth/route.ts')
  if (!ikRoute.includes('isAdmin()')) {
    failures++
    hits.push('static: /api/imagekit/auth lost its admin guard')
  }
  if (!ikRoute.includes('{ fallback: true, error: \'ImageKit not configured — using local upload fallback\' }')) {
    failures++
    hits.push('static: /api/imagekit/auth unconfigured 501 shape drifted')
  }
}

// ── 3. Frontend static scan (public storefront surfaces) ────
// The frontend is a separate deployable, so its PUBLIC surfaces get
// their own leak pass (the audit listed this as a gap: the scanner
// used to cover the backend only):
//   • frontend/public/**  (text assets: llms.txt, robots.txt, svg, …)
//     — full LEAK_TERMS scan, zero tolerance;
//   • frontend/src/** excluding components/admin/ — secret-shaped
//     terms only (fileId/tokenHash/key_secret/client_secret/ik-sig/
//     ik-exp). Deliverable field NAMES legitimately appear in the
//     shared product type + the dialog's display fallback (the
//     public DTO provably never emits those fields), so a name-scan
//     of non-admin source would only false-positive; a secret term
//     has no such excuse. Admin components are authenticated-by-
//     design and skipped here.
const FE_SECRET_TERMS = ['fileId', 'tokenHash', 'key_secret', 'client_secret', 'ik-sig', 'ik-exp'] as const
const FE_PUBLIC_TEXT = /\.(txt|xml|json|html?|md|svg|csv|webmanifest)$/i
const FE_SRC_TEXT = /\.(tsx?|jsx?|css|json|md|svg)$/i

function frontendStaticChecks(): void {
  const feRoot = join(ROOT, '..', 'frontend')
  if (!existsSync(join(feRoot, 'src'))) {
    console.log('frontend static scan skipped (frontend/ not present)')
    return
  }

  const files: string[] = []
  function walk(dir: string, extFilter: RegExp): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const st = statSync(full)
      if (st.isDirectory()) walk(full, extFilter)
      else if (extFilter.test(entry)) files.push(full)
    }
  }

  walk(join(feRoot, 'public'), FE_PUBLIC_TEXT)
  for (const f of files) {
    scan(`frontend-public ${relative(feRoot, f).split('\\').join('/')}`, readFileSync(f, 'utf8'))
  }

  files.length = 0
  walk(join(feRoot, 'src'), FE_SRC_TEXT)
  for (const f of files) {
    const rel = relative(feRoot, f).split('\\').join('/')
    if (rel.startsWith('src/components/admin/')) continue
    scan(`frontend-src ${rel}`, readFileSync(f, 'utf8'), FE_SECRET_TERMS)
  }
  console.log(`frontend static scan — ${files.length > 0 ? 'done' : 'no src files found'}`)
}

console.log('check:leaks — scanning public responses for paid-file references / secrets')
await liveChecks()
staticChecks()
frontendStaticChecks()

if (failures > 0) {
  console.error(`\ncheck:leaks FAILED — ${failures} hit(s):`)
  for (const h of hits) console.error(`  ✗ ${h}`)
  process.exit(1)
}
console.log('\ncheck:leaks PASSED — no leak terms in public responses or public code paths')
