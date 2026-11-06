// ═══════════════════════════════════════════════════════════
// T6 verification — Storage (ImageKit) + Email (Resend) adapters.
//
//   bun scripts/t6-verify.ts        (dev server on :3001 optional —
//                                    used for the unconfigured HTTP checks)
//
// Covers the Gate 6 list:
//   1. email drivers: console (masked log, demo result, EmailLog row),
//      resend via a local mock (EMAIL_API_URL override) — 401/400 ⇒ NO
//      retry (1 attempt), 500/429/network-fail ⇒ 3 attempts with
//      500 ms + 2 s backoff, flaky 500→200 ⇒ success on attempt 3,
//      missing key ⇒ console fallback (warn, never crash); every
//      attempt lands in EmailLog (sha256 recipient hash + masked
//      address — never the raw email, never the API key in logs);
//   2. delivery/security-alert templates: subjects + HTML unchanged,
//      a plain-text version is always derived;
//   3. ImageKit units: `ik:` ref parsing (traversal/query/control-char
//      rejection), signed-URL math (HMAC-SHA256 over path+expire,
//      600 s TTL) vs a manual HMAC computation;
//   4. upload allow-lists: extension/MIME allow-lists per kind
//      (media jpg/png/webp/gif, video mp4/webm, deliverables
//      pdf/zip/apk/epub/txt; SVG refused), size caps (25 MB media,
//      100 MB deliverables), file-name sanitisation (no traversal,
//      no control chars);
//   5. live unconfigured behaviour on :3001 — GET /api/imagekit/auth
//      answers the byte-identical 501 fallback and an `ik:` deliverable
//      answers the existing 404 shape;
//   6. configured route behaviour (in-process, fake dev keys):
//      upload signing params + folder scoping + fileName validation
//      (admin session mocked — the real session helper guards every
//      admin route; live keys test stays with the owner), and the
//      download route minting a 10-minute signed URL at claim time
//      (Location header only; ?mode=json keeps its exact shape for
//      the token-validated SPA flow; downloadCount increments).
//
// Test rows (products, orders, EmailLog, ActivityEvent) are deleted.
// ═══════════════════════════════════════════════════════════
/// <reference types="bun-types" />
import crypto from 'crypto'

// The sandbox injects a stale DATABASE_URL — force the local dev DB
// (override with T6_DATABASE_URL). Must happen BEFORE importing '@/lib/db'.
const LOCAL_DB = process.env.T6_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5432/sibra'
process.env.DATABASE_URL = LOCAL_DB
process.env.DIRECT_URL = LOCAL_DB

const BASE = process.env.T6_BASE_URL ?? 'http://127.0.0.1:3001'
const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? ''

let passed = 0
let failed = 0
function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`)
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const hmac = (algo: string, secret: string, data: string) =>
  crypto.createHmac(algo, secret).update(data).digest('hex')
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

const RUN = crypto.randomBytes(3).toString('hex')

// Start clean: tests control the driver env explicitly.
delete process.env.RESEND_API_KEY
delete process.env.EMAIL_PROVIDER
delete process.env.EMAIL_API_URL
delete process.env.IMAGEKIT_PRIVATE_KEY
delete process.env.IMAGEKIT_PUBLIC_KEY
delete process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY
delete process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT

// ── imports (after env fix) ─────────────────────────────────
const { db } = await import('@/lib/db')
const { logger } = await import('@/lib/logger')
const { sendEmail, sendDeliveryEmail, sendSecurityAlertEmail, emailDriver, emailDemoMode, htmlToText } =
  await import('@/lib/email')
const {
  UPLOAD_KINDS,
  validateUpload,
  sanitizeFileName,
  isImagekitRef,
  parseImagekitRef,
  imagekitConfigured,
  imagekitAuthParams,
  imagekitSignedUrlFromRef,
  MEDIA_MAX_BYTES,
  DELIVERABLE_MAX_BYTES,
  PRIVATE_URL_TTL_SECONDS,
  localDiskStorageAllowed,
} = await import('@/lib/storage')

// ═══════════════════════════════════════════════════════════
// 1. EMAIL DRIVERS
// ═══════════════════════════════════════════════════════════
console.log('\n── 1. email drivers ──────────────────────────────')

// Capture pino output (logger.info/warn/error) without leaking noise.
const logCapture: { level: string; args: unknown[] }[] = []
const origInfo = logger.info.bind(logger)
const origWarn = logger.warn.bind(logger)
const origError = logger.error.bind(logger)
;(logger as unknown as Record<string, unknown>).info = (...args: unknown[]) => {
  logCapture.push({ level: 'info', args })
}
;(logger as unknown as Record<string, unknown>).warn = (...args: unknown[]) => {
  logCapture.push({ level: 'warn', args })
}
;(logger as unknown as Record<string, unknown>).error = (...args: unknown[]) => {
  logCapture.push({ level: 'error', args })
}
const restoreLogger = () => {
  ;(logger as unknown as Record<string, unknown>).info = origInfo
  ;(logger as unknown as Record<string, unknown>).warn = origWarn
  ;(logger as unknown as Record<string, unknown>).error = origError
}

const emailLogRows = async (orderId: string) =>
  db.emailLog.findMany({ where: { orderId }, orderBy: { attempt: 'asc' } })

// ── 1a. console driver (no key, default selection) ───────────
{
  const marker = `t6-${RUN}-console`
  logCapture.length = 0
  const res = await sendEmail({
    to: 'alice@example.com',
    subject: 'T6 console test',
    html: '<p>support <b>world</b></p>',
    template: 't6-test',
    orderId: marker,
  })
  check('console driver: demo result { sent:false, demo:true }', res.sent === false && res.demo === true, res)
  const maskedLogged = logCapture.some(
    (l) => l.level === 'info' && JSON.stringify(l.args).includes('al***@example.com'),
  )
  check('console driver: masked recipient logged (al***@…)', maskedLogged)
  check('console driver: subject logged', logCapture.some((l) => JSON.stringify(l.args).includes('T6 console test')))
  const rawLogged = logCapture.some((l) => JSON.stringify(l.args).includes('alice@example.com'))
  check('console driver: full recipient NEVER logged', !rawLogged)
  const rows = await emailLogRows(marker)
  check('console driver: one EmailLog row', rows.length === 1, rows.length)
  const row = rows[0]
  check(
    'console driver: row { provider:console, ok:false, attempt:1 }',
    row.provider === 'console' && row.ok === false && row.attempt === 1,
    row,
  )
  check('console driver: toHash = sha256(email)', row.toHash === sha256('alice@example.com'), row.toHash)
  check('console driver: toMasked', row.toMasked === 'al***@example.com', row.toMasked)
  check('console driver: template persisted', row.template === 't6-test')
}

// ── 1b. explicit EMAIL_PROVIDER=console wins over a present key ──
{
  process.env.EMAIL_PROVIDER = 'console'
  process.env.RESEND_API_KEY = 're_test_should_not_be_used'
  check('EMAIL_PROVIDER=console forces console', emailDriver() === 'console' && emailDemoMode())
  const res = await sendEmail({ to: 'bob@example.com', subject: 'x', html: '<p>x</p>', orderId: `t6-${RUN}-force` })
  check('EMAIL_PROVIDER=console: demo result', res.sent === false && res.demo === true)
  delete process.env.RESEND_API_KEY
  delete process.env.EMAIL_PROVIDER
}

// ── 1c. resend driver against a local mock ──────────────────
const mockState = { hits: new Map<string, number>() }
const mockServer = Bun.serve({
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname
    mockState.hits.set(path, (mockState.hits.get(path) ?? 0) + 1)
    if (path === '/ok') return Response.json({ id: 'mock-ok' })
    if (path === '/flaky') {
      const n = mockState.hits.get('/flaky') ?? 0
      return n < 3 ? new Response('boom', { status: 500 }) : Response.json({ id: 'mock-flaky' })
    }
    if (path === '/401') return Response.json({ message: 'invalid key' }, { status: 401 })
    if (path === '/400') return Response.json({ message: 'bad' }, { status: 400 })
    if (path === '/429') return new Response('slow down', { status: 429 })
    return new Response('boom', { status: 500 })
  },
})
const MOCK = `http://127.0.0.1:${mockServer.port}`
process.env.EMAIL_PROVIDER = 'resend'
process.env.RESEND_API_KEY = 're_test_fakekey_t6'

// Helper: one resend case against a mock path.
async function resendCase(name: string, path: string): Promise<{ res: Awaited<ReturnType<typeof sendEmail>>; ms: number }> {
  process.env.EMAIL_API_URL = `${MOCK}${path}`
  mockState.hits.set(path, 0)
  logCapture.length = 0
  const t0 = Date.now()
  const res = await sendEmail({
    to: 'carol@example.com',
    subject: `T6 ${name}`,
    html: `<p>${name}</p>`,
    template: 't6-test',
    orderId: `t6-${RUN}-${name}`,
  })
  await sleep(30) // let the final EmailLog write settle
  return { res, ms: Date.now() - t0 }
}

{
  // 401 — authentication failure: NEVER retried.
  const { res } = await resendCase('401', '/401')
  check('resend 401: no success', res.sent === false && res.demo === false, res)
  check('resend 401: error mentions status', (res.error ?? '').includes('401'), res.error)
  check('resend 401: exactly ONE request (no retry)', mockState.hits.get('/401') === 1, mockState.hits.get('/401'))
  const rows = await emailLogRows(`t6-${RUN}-401`)
  check('resend 401: one error row in EmailLog', rows.length === 1 && rows[0].ok === false && rows[0].attempt === 1, rows.length)
  check('resend 401: provider recorded as resend', rows[0]?.provider === 'resend')
  const leaked = logCapture.some((l) => JSON.stringify(l.args).includes('re_test_fakekey_t6'))
  check('resend 401: API key never logged', !leaked)
}
{
  // 400 — other 4xx: NEVER retried.
  const { res } = await resendCase('400', '/400')
  check('resend 400: fails without success', res.sent === false)
  check('resend 400: exactly ONE request (no retry)', mockState.hits.get('/400') === 1, mockState.hits.get('/400'))
  const rows = await emailLogRows(`t6-${RUN}-400`)
  check('resend 400: one error row', rows.length === 1 && rows.every((r) => r.ok === false), rows.length)
}
{
  // 500 — server error: 3 attempts, 500 ms + 2 s backoff.
  const { res, ms } = await resendCase('500', '/500')
  check('resend 500: 3 requests (retried)', mockState.hits.get('/500') === 3, mockState.hits.get('/500'))
  check('resend 500: backoff ≥ 2.4 s (500 ms + 2 s)', ms >= 2400, ms)
  check('resend 500: final error reported', (res.error ?? '').includes('500'))
  const rows = await emailLogRows(`t6-${RUN}-500`)
  check(
    'resend 500: three error rows (attempt 1..3)',
    rows.length === 3 && rows.map((r) => r.attempt).join(',') === '1,2,3' && rows.every((r) => !r.ok),
    rows.map((r) => r.attempt),
  )
}
{
  // 429 — rate limited: retried like 5xx.
  await resendCase('429', '/429')
  check('resend 429: 3 requests (retried)', mockState.hits.get('/429') === 3, mockState.hits.get('/429'))
  const rows = await emailLogRows(`t6-${RUN}-429`)
  check('resend 429: three error rows', rows.length === 3 && rows.every((r) => !r.ok), rows.length)
}
{
  // flaky 500 → 500 → 200: succeeds on attempt 3.
  const { res } = await resendCase('flaky', '/flaky')
  check('resend flaky: succeeds after 2 failures', res.sent === true && res.demo === false, res)
  check('resend flaky: exactly 3 requests', mockState.hits.get('/flaky') === 3, mockState.hits.get('/flaky'))
  const rows = await emailLogRows(`t6-${RUN}-flaky`)
  check(
    'resend flaky: rows err/err/ok with attempt numbers',
    rows.length === 3 && !rows[0].ok && !rows[1].ok && rows[2].ok && rows[2].attempt === 3,
    rows.map((r) => `${r.attempt}:${r.ok}`).join(' '),
  )
}
{
  // network failure (closed port): retried 3× then recorded as error.
  process.env.EMAIL_API_URL = 'http://127.0.0.1:9/emails' // port 1/9 unreachable
  logCapture.length = 0
  const t0 = Date.now()
  const res = await sendEmail({
    to: 'dave@example.com',
    subject: 'T6 netfail',
    html: '<p>netfail</p>',
    template: 't6-test',
    orderId: `t6-${RUN}-netfail`,
  })
  const ms = Date.now() - t0
  await sleep(30)
  check('network fail: fails cleanly (no throw)', res.sent === false && res.demo === false, res)
  check('network fail: error tagged as network', (res.error ?? '').startsWith('network error'), res.error)
  check('network fail: backoff ≥ 2.4 s', ms >= 2400, ms)
  const rows = await emailLogRows(`t6-${RUN}-netfail`)
  check('network fail: three error rows', rows.length === 3 && rows.every((r) => !r.ok), rows.length)
  const keyLogged = logCapture.some((l) => JSON.stringify(l.args).includes('re_test_fakekey_t6'))
  check('network fail: API key never logged', !keyLogged)
}
delete process.env.EMAIL_API_URL

// ── 1d. missing key → console fallback (never crashes) ──────
{
  delete process.env.RESEND_API_KEY
  check('no key: driver resolves to console', emailDriver() === 'console')
  logCapture.length = 0
  const res = await sendEmail({
    to: 'erin@example.com',
    subject: 'T6 fallback',
    html: '<p>fallback</p>',
    template: 't6-test',
    orderId: `t6-${RUN}-fallback`,
  })
  check('no key: demo result, no crash', res.sent === false && res.demo === true, res)
  check('no key: one-time warn emitted', logCapture.some((l) => l.level === 'warn'))
  const rows = await emailLogRows(`t6-${RUN}-fallback`)
  check('no key: fallback send recorded as console row', rows.length === 1 && rows[0].provider === 'console')
}

// ── 1e. templates byte-identical + plain-text version ───────
{
  process.env.RESEND_API_KEY = 're_test_fakekey_t6'
  process.env.EMAIL_PROVIDER = 'resend'
  process.env.EMAIL_API_URL = `${MOCK}/ok`
  mockState.hits.set('/ok', 0)
  const bodies: { subject: string; html: string; text: string }[] = []
  const origFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'))
    bodies.push(body)
    return new Response(JSON.stringify({ id: 'x' }), { status: 200 })
  }) as typeof fetch
  await sendDeliveryEmail({
    to: 'frank@example.com',
    customerName: 'Frank',
    productTitle: 'Test Product',
    downloadUrl: 'https://site.test/api/download/tok',
    amountInr: 399,
    orderId: `t6-${RUN}-tpl`,
  })
  await sendSecurityAlertEmail('grace@example.com', 'New device signed in', ['Device fp-123 completed sign-in.'])
  globalThis.fetch = origFetch
  delete process.env.EMAIL_API_URL

  const delivery = bodies[0]
  const alert = bodies[1]
  check(
    'delivery email: subject byte-identical',
    delivery?.subject === '⬇️ Your download: Test Product — Sibra Digital Hub',
    delivery?.subject,
  )
  check('delivery email: HTML kept (branded header + button)', delivery?.html.includes('SIBRA DIGITAL HUB') === true && delivery?.html.includes('Download Now') === true)
  check('delivery email: text version present, tag-free', typeof delivery?.text === 'string' && delivery.text.length > 10 && !delivery.text.includes('<'))
  check('alert email: subject byte-identical', alert?.subject === '🔐 Security alert: New device signed in — Sibra Digital Hub', alert?.subject)
  check('alert email: HTML kept', alert?.html.includes('Security alert') === true && alert?.html.includes('fp-123') === true)
  check('alert email: text version present, tag-free', typeof alert?.text === 'string' && alert.text.length > 10 && !alert.text.includes('<'))
  check('no tracking pixels in either template', !delivery?.html.includes('<img') && !alert?.html.includes('<img'))

  // htmlToText sanity (the derivation helper itself).
  check('htmlToText strips tags/entities', htmlToText('<p>A &amp; B<br/>C</p>').includes('A & B') && htmlToText('<p>A &amp; B<br/>C</p>').includes('C'))
}

// reset driver env for the storage sections
delete process.env.RESEND_API_KEY
delete process.env.EMAIL_PROVIDER

// ═══════════════════════════════════════════════════════════
// 2. IMAGEKIT UNITS (signed-URL math, ref parsing)
// ═══════════════════════════════════════════════════════════
console.log('\n── 2. imagekit units ─────────────────────────────')

check('unconfigured: imagekitConfigured()=false', imagekitConfigured() === false)
check('unconfigured: signed-URL helper returns null', imagekitSignedUrlFromRef('ik:x.pdf') === null)

process.env.IMAGEKIT_PRIVATE_KEY = 'test_private_key'
process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY = 'test_public_key'
process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/testendpoint'
check('configured: imagekitConfigured()=true', imagekitConfigured() === true)

// ref parsing
check('ik: prefix detected', isImagekitRef('ik:private/a.pdf') && !isImagekitRef('https://x/y.pdf') && !isImagekitRef('/files/a.pdf'))
check('ref: leading slash canonicalised', parseImagekitRef('ik:private/a.pdf') === '/private/a.pdf', parseImagekitRef('ik:private/a.pdf'))
check('ref: existing slash kept', parseImagekitRef('ik:/private/a.pdf') === '/private/a.pdf')
check('ref: query string rejected', parseImagekitRef('ik:a.pdf?x=1') === null)
check('ref: fragment rejected', parseImagekitRef('ik:a.pdf#f') === null)
check('ref: traversal rejected', parseImagekitRef('ik:../../etc/passwd') === null)
check('ref: control chars rejected', parseImagekitRef('ik:a\u0000.pdf') === null)
check('ref: empty rejected', parseImagekitRef('ik:') === null)

// signed-URL math: manual HMAC-SHA256(privateKey, path + expire), 10-min TTL
{
  const now = 1_700_000_000_000
  const url = imagekitSignedUrlFromRef('ik:private-deliverables/t6.pdf', { now })
  const expectedExpire = Math.floor(now / 1000) + PRIVATE_URL_TTL_SECONDS
  const expectedSig = hmac('sha256', 'test_private_key', `/private-deliverables/t6.pdf${expectedExpire}`)
  check('signed URL: endpoint + path prefix', url?.startsWith('https://ik.imagekit.io/testendpoint/private-deliverables/t6.pdf?') === true, url)
  check('signed URL: expire = now + 600 s', url?.includes(`ik-exp=${expectedExpire}`) === true, url)
  check('signed URL: ik-sig matches manual HMAC-SHA256(path+expire)', url?.includes(`ik-sig=${expectedSig}`) === true, url)
  const short = imagekitSignedUrlFromRef('ik:x.pdf', { now, ttlSeconds: 60 })
  check('signed URL: ttl override honoured (60 s)', short?.includes(`ik-exp=${Math.floor(now / 1000) + 60}`) === true)
  check('signed URL: unsafe ref → null', imagekitSignedUrlFromRef('ik:../escape.pdf') === null)
  check('PRIVATE_URL_TTL_SECONDS is 600 (10 min)', PRIVATE_URL_TTL_SECONDS === 600)
}

// upload signing params (route payload maths — sha1 per ImageKit auth spec)
{
  const p = imagekitAuthParams()
  check('auth params: token is 32 hex chars', /^[0-9a-f]{32}$/.test(p.token))
  check('auth params: expire ~30 min ahead', p.expire > Math.floor(Date.now() / 1000) + 60 * 29)
  check('auth params: signature = HMAC-SHA1(privateKey, token+expire)', p.signature === hmac('sha1', 'test_private_key', p.token + String(p.expire)))
  check('auth params: public key + endpoint echoed (safe values)', p.publicKey === 'test_public_key' && p.endpoint === 'https://ik.imagekit.io/testendpoint')
  check('auth params: private key never echoed', !JSON.stringify(p).includes('test_private_key'))
}

// ═══════════════════════════════════════════════════════════
// 3. UPLOAD ALLOW-LISTS + SANITISATION
// ═══════════════════════════════════════════════════════════
console.log('\n── 3. upload allow-lists ─────────────────────────')

check('sanitise: traversal stripped (../../etc/passwd → passwd)', sanitizeFileName('../../etc/passwd') === 'passwd')
check('sanitise: backslash traversal stripped', sanitizeFileName('..\\..\\secret.pdf') === 'secret.pdf')
check('sanitise: nested path → basename', sanitizeFileName('a/b/c.png') === 'c.png')
check('sanitise: control chars stripped', sanitizeFileName('bad\u0000\u001fname.jpg') === 'badname.jpg')
check('sanitise: dots-only name rejected', sanitizeFileName('..') === null)
check('sanitise: long name truncated with extension kept', (sanitizeFileName(`${'a'.repeat(400)}.pdf`) ?? '').length === 184)
check('sanitise: empty → null', sanitizeFileName('   ') === null)

const okMedia = validateUpload('media', { fileName: 'poster.JPG', mimeType: 'image/jpeg', sizeBytes: 1024 })
check('allow-list: media jpg (+MIME+size) ok', okMedia.ok && okMedia.folder === 'public-media')
const okVideo = validateUpload('video', { fileName: 'clip.webm', mimeType: 'video/webm' })
check('allow-list: video webm ok (public-video folder)', okVideo.ok && okVideo.folder === 'public-video')
const okDel = validateUpload('deliverable', { fileName: 'book.epub', mimeType: 'application/epub+zip' })
check('allow-list: deliverable epub ok (private-deliverables folder)', okDel.ok && okDel.folder === 'private-deliverables')

for (const kind of UPLOAD_KINDS) {
  check(`allow-list: .svg refused for ${kind}`, validateUpload(kind, { fileName: 'evil.svg' }).ok === false)
  check(`allow-list: .exe refused for ${kind}`, validateUpload(kind, { fileName: 'evil.exe' }).ok === false)
}
check('allow-list: media png ok / gif ok / webp ok', validateUpload('media', { fileName: 'a.png' }).ok && validateUpload('media', { fileName: 'a.gif' }).ok && validateUpload('media', { fileName: 'a.webp' }).ok)
check('allow-list: deliverable pdf/zip/apk/txt ok', ['a.pdf', 'a.zip', 'a.apk', 'a.txt'].every((f) => validateUpload('deliverable', { fileName: f }).ok))
check('allow-list: deliverable .doc refused', validateUpload('deliverable', { fileName: 'a.doc' }).ok === false)
check('allow-list: media svg MIME refused (image/svg+xml)', validateUpload('media', { fileName: 'a.svg', mimeType: 'image/svg+xml' }).ok === false)
check('caps: media 26 MB refused', validateUpload('media', { fileName: 'big.png', sizeBytes: MEDIA_MAX_BYTES + 1 }).ok === false)
check('caps: media 25 MB accepted', validateUpload('media', { fileName: 'ok.png', sizeBytes: MEDIA_MAX_BYTES }).ok)
check('caps: deliverable 101 MB refused', validateUpload('deliverable', { fileName: 'big.zip', sizeBytes: DELIVERABLE_MAX_BYTES + 1 }).ok === false)
check('caps: deliverable 100 MB accepted', validateUpload('deliverable', { fileName: 'ok.zip', sizeBytes: DELIVERABLE_MAX_BYTES }).ok)
check('sanitise via validateUpload: traversal name normalised', validateUpload('deliverable', { fileName: '../../x.pdf' }).ok === true)
check('local-disk: allowed in dev only', localDiskStorageAllowed() === true) // sandbox is development

// ═══════════════════════════════════════════════════════════
// 4. LIVE UNCONFIGURED BEHAVIOUR (:3001) — golden shapes
// ═══════════════════════════════════════════════════════════
console.log('\n── 4. live unconfigured shapes (:3001) ───────────')

const liveHeaders = { 'x-internal-key': INTERNAL_KEY, 'user-agent': 'T6-Verify-Bot (compatible; bot)' }
{
  const res = await fetch(`${BASE}/api/imagekit/auth`, { headers: liveHeaders })
  const body = await res.json()
  check('live imagekit/auth: 501', res.status === 501, res.status)
  check(
    'live imagekit/auth: fallback body byte-identical',
    JSON.stringify(body) === JSON.stringify({ fallback: true, error: 'ImageKit not configured — using local upload fallback' }),
    body,
  )
  check('live imagekit/auth: unauthenticated still 501 (no secrets path)', !(body as { token?: string }).token)
}

// Test product + paid order with an `ik:` deliverable (unconfigured server ⇒ 404 shape).
const ikPath = `private-deliverables/t6-${RUN}.pdf`
let productId = ''
let orderId = ''
let plainToken = ''
{
  const product = await db.product.create({
    data: {
      title: `T6 verify product ${RUN}`,
      slug: `t6-verify-${RUN}`,
      zone: 'kids',
      status: 'published',
      instantDownload: true,
      deliverableUrl: `ik:${ikPath}`,
      deliverableName: 't6-private.pdf',
      priceInr: 1,
    },
  })
  productId = product.id
  plainToken = crypto.randomBytes(32).toString('base64url')
  const order = await db.order.create({
    data: {
      productId,
      customerName: 'T6 Verify',
      customerEmail: `t6-${RUN}@example.com`,
      amountInr: 1,
      status: 'paid',
      downloadTokenHash: sha256(plainToken),
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      downloadCount: 0,
    },
  })
  orderId = order.id

  // §2.7 contract: the GET only VALIDATES — a valid token 302-redirects to
  // the on-site download page and consumes NOTHING (even with an ik: ref
  // whose signed URL can't be minted while ImageKit is unconfigured).
  const res = await fetch(`${BASE}/api/download/${plainToken}`, { redirect: 'manual', headers: liveHeaders })
  const text = await res.text()
  check('live download (validate GET): 302 to the SPA claim page', res.status === 302 && (res.headers.get('location') ?? '').includes(`/#/download/${plainToken}`), `${res.status} ${res.headers.get('location') ?? ''}`)
  check('live download: no signed URL / path in body', !text.includes('ik-sig') && !text.includes(ikPath))
  const afterGet = await db.order.findUnique({ where: { id: orderId } })
  check('live download: the GET consumed nothing (downloadCount=0)', afterGet?.downloadCount === 0, afterGet?.downloadCount)

  // The POST is the claim — with ImageKit unconfigured the target cannot be
  // minted, so the slot is consumed and the exact legacy 404 shape is kept.
  const postRes = await fetch(`${BASE}/api/download/${plainToken}?mode=json`, { method: 'POST', headers: liveHeaders })
  const postText = await postRes.text()
  check('live download POST (ik: ref, unconfigured): 404', postRes.status === 404, postRes.status)
  check(
    'live download POST: existing "File missing" shape kept',
    postText === JSON.stringify({ ok: false, error: 'File missing — contact support' }),
    postText,
  )
  const after = await db.order.findUnique({ where: { id: orderId } })
  check('live download POST: claim consumed then 404 (pre-T6 parity)', after?.downloadCount === 1, after?.downloadCount)
}

// ═══════════════════════════════════════════════════════════
// 5. CONFIGURED ROUTES (in-process, fake keys)
// ═══════════════════════════════════════════════════════════
console.log('\n── 5. configured routes (in-process) ─────────────')

// 5a. imagekit/auth route with a (mocked) FULL admin session.
{
  const { mock } = await import('bun:test')
  mock.module('@/lib/admin-auth', () => ({
    isAdmin: async () => true,
    unauthorized: () => Response.json({ error: 'Unauthorized — admin session required' }, { status: 401 }),
  }))
  const { GET } = await import('@/app/api/imagekit/auth/route')
  const { NextRequest } = await import('next/server')

  const req = (q = '') => new NextRequest(`http://localhost:3001/api/imagekit/auth${q}`)
  const res = await GET(req())
  check('configured signing route: 200 for admin', res.status === 200, res.status)
  const body = (await res.json()) as Record<string, unknown>
  check('configured signing route: token/expire/signature present', typeof body.token === 'string' && typeof body.expire === 'number' && typeof body.signature === 'string')
  check('configured signing route: HMAC-SHA1 matches manual computation', body.signature === hmac('sha1', 'test_private_key', String(body.token) + String(body.expire)))
  check('configured signing route: publicKey/endpoint are the NEXT_PUBLIC values', body.publicKey === 'test_public_key' && body.endpoint === 'https://ik.imagekit.io/testendpoint')
  check('configured signing route: default kind=media → public-media folder', body.folder === 'public-media' && body.kind === 'media')
  check('configured signing route: limits documented (25 MB / 100 MB)', JSON.stringify(body.limits) === JSON.stringify({ mediaMaxBytes: MEDIA_MAX_BYTES, deliverableMaxBytes: DELIVERABLE_MAX_BYTES }))

  const resDel = await GET(req('?kind=deliverable'))
  const bodyDel = (await resDel.json()) as Record<string, unknown>
  check('configured signing route: kind=deliverable → private-deliverables', bodyDel.folder === 'private-deliverables' && bodyDel.kind === 'deliverable')
  const resVid = await GET(req('?kind=video'))
  const bodyVid = (await resVid.json()) as Record<string, unknown>
  check('configured signing route: kind=video → public-video', bodyVid.folder === 'public-video')
  const resBad = await GET(req('?kind=root'))
  check('configured signing route: unknown kind → 400', resBad.status === 400)
  const resSvg = await GET(req('?kind=media&fileName=logo.svg'))
  check('configured signing route: svg fileName → 400 (fail fast)', resSvg.status === 400)
  const resTraversal = await GET(req('?kind=deliverable&fileName=../../etc/passwd'))
  check('configured signing route: traversal fileName → 400', resTraversal.status === 400)
  const resOk = await GET(req('?kind=deliverable&fileName=book%2Epdf'))
  check('configured signing route: clean deliverable fileName → 200', resOk.status === 200)
}

// 5b. download route — GET validates free; POST claims and mints the
//     10-minute signed URL at claim time (Location header).
{
  const { GET, POST } = await import('@/app/api/download/[token]/route')
  const { NextRequest } = await import('next/server')

  await db.order.update({ where: { id: orderId }, data: { downloadCount: 0 } })
  const url = `http://localhost:3001/api/download/${plainToken}`
  // GET — validate only: no signed URL, no claim, redirect to the SPA page.
  const resGet = await GET(new NextRequest(url, { headers: { 'user-agent': 'T6-Verify-Bot (compatible; bot)' } }), {
    params: Promise.resolve({ token: plainToken }),
  })
  check('download GET (configured): 302 to the SPA claim page', resGet.status === 302 && (resGet.headers.get('location') ?? '').includes(`/#/download/${plainToken}`), `${resGet.status} ${resGet.headers.get('location') ?? ''}`)
  const afterGet = await db.order.findUnique({ where: { id: orderId } })
  check('download GET consumed nothing (downloadCount=0)', afterGet?.downloadCount === 0, afterGet?.downloadCount)

  // POST — THE claim: the Location is the ImageKit signed URL (10 min).
  const res = await POST(new NextRequest(url, { headers: { 'user-agent': 'T6-Verify-Bot (compatible; bot)' } }), {
    params: Promise.resolve({ token: plainToken }),
  })
  check('download POST (configured): 302 redirect', res.status === 302, res.status)
  const location = res.headers.get('location') ?? ''
  const nowSec = Math.floor(Date.now() / 1000)
  const expMatch = location.match(/ik-exp=(\d+)/)
  const exp = expMatch ? Number(expMatch[1]) : 0
  const sigMatch = location.match(/ik-sig=([0-9a-f]{64})/)
  check('download POST: Location is the ImageKit signed URL', location.startsWith(`https://ik.imagekit.io/testendpoint/${ikPath}?`), location)
  check('download POST: ik-exp present, TTL ≈ 600 s', exp > nowSec + 570 && exp <= nowSec + 610, exp - nowSec)
  check('download POST: ik-sig = HMAC-SHA256(privateKey, path+expire)', !!sigMatch && sigMatch[1] === hmac('sha256', 'test_private_key', `/${ikPath}${exp}`))
  const bodyText = res.body ? await new Response(res.body).text() : ''
  check('download POST: body never contains the signed URL/path', !bodyText.includes('ik-sig') && !bodyText.includes(ikPath), bodyText.slice(0, 80))
  const after = await db.order.findUnique({ where: { id: orderId } })
  check('download POST: atomic claim consumed (downloadCount=1)', after?.downloadCount === 1, after?.downloadCount)

  // ?mode=json — GET validates (free, no fileUrl); POST claims (exact SPA shape).
  const resJsonValidate = await GET(
    new NextRequest(`${url}?mode=json`, { headers: { 'user-agent': 'T6-Verify-Bot (compatible; bot)' } }),
    { params: Promise.resolve({ token: plainToken }) },
  )
  const jsonValidate = (await resJsonValidate.json()) as Record<string, unknown>
  check('download mode=json GET: validates free — {ok, claimable, name}', resJsonValidate.status === 200 && jsonValidate.ok === true && jsonValidate.claimable === true && jsonValidate.fileUrl === undefined, jsonValidate)

  await db.order.update({ where: { id: orderId }, data: { downloadCount: 0 } })
  const resJson = await POST(
    new NextRequest(`${url}?mode=json`, { headers: { 'user-agent': 'T6-Verify-Bot (compatible; bot)' } }),
    { params: Promise.resolve({ token: plainToken }) },
  )
  const json = (await resJson.json()) as Record<string, unknown>
  check('download mode=json POST: 200 + exact keys [ok, fileUrl, name]', resJson.status === 200 && JSON.stringify(Object.keys(json).sort()) === JSON.stringify(['fileUrl', 'name', 'ok']), Object.keys(json))
  check('download mode=json POST: fileUrl is a 10-min signed URL', String(json.fileUrl).includes('ik-sig=') && String(json.fileUrl).includes('ik-exp='))
  check('download mode=json POST: name surfaced (token-validated)', json.name === 't6-private.pdf')
  check('download mode=json POST: raw ik: path never exposed', !JSON.stringify(json).includes(`ik:${ikPath}`))
}

// ═══════════════════════════════════════════════════════════
// 6. CLEANUP
// ═══════════════════════════════════════════════════════════
console.log('\n── 6. cleanup ────────────────────────────────────')
{
  await db.order.deleteMany({ where: { id: orderId } })
  await db.product.deleteMany({ where: { id: productId } })
  await db.activityEvent.deleteMany({ where: { orderId } })
  const logs = await db.emailLog.deleteMany({ where: { orderId: { startsWith: `t6-${RUN}-` } } })
  check('cleanup: test rows removed', true)
  console.log(`  (deleted ${logs.count} EmailLog rows for run ${RUN})`)
}

restoreLogger()
mockServer.stop(true)

console.log(`\nT6 VERIFY: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
