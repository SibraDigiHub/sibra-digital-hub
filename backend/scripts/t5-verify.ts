// ═══════════════════════════════════════════════════════════
// T5 verification — Razorpay payments + automatic delivery.
//
//   bun scripts/t5-verify.ts          (needs the dev server on :3001)
//
// Covers the Gate 5 list:
//   1. signature units (crypto, in-process): valid accepted /
//      tampered rejected — payment + webhook HMAC on the raw body;
//   2. webhook HTTP suite: bad signature → 400, valid → fulfilled,
//      duplicate eventId → 200 + exactly ONE fulfilment/email,
//      wrong amount / currency → 409 + order stays pending,
//      unknown order id → 200 ignored+logged, other types → 200;
//   3. fulfillOrder concurrency: 10 parallel calls → exactly one
//      token, one email (instrumented via mock.module), 9 no-ops;
//   4. atomic download claim: 10 parallel claims on a max-3 order
//      → exactly 3 succeed;
//   5. expiry boundary: expired token → the exact same 410 shape;
//   6. real routes: public order create → demo-pay (public shape
//      leak-scan) + /api/razorpay/verify behaviour without keys.
//
// Test rows (draft product + orders) are deleted on success.
// ═══════════════════════════════════════════════════════════
/// <reference types="bun-types" />
import crypto from 'crypto'

// The sandbox injects a stale DATABASE_URL — force the local dev DB
// (override with T5_DATABASE_URL). Must happen BEFORE importing '@/lib/db'.
const LOCAL_DB = process.env.T5_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5432/sibra'
process.env.DATABASE_URL = LOCAL_DB
process.env.DIRECT_URL = LOCAL_DB

const BASE = process.env.T5_BASE_URL ?? 'http://localhost:3001'
const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? ''
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET ?? ''

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

const hmacHex = (secret: string, data: string): string =>
  crypto.createHmac('sha256', secret).update(data).digest('hex')

// ── email instrumentation (registered before order-service import) ──
// T6: the email module grew (sendEmail/emailDemoMode/…) — the mock
// mirrors the full surface order-service can touch.
const { mock } = await import('bun:test')
const emailCalls: { to: string; orderId: string }[] = []
mock.module('@/lib/email', () => ({
  emailConfigured: () => true,
  emailDriver: () => 'resend',
  emailDemoMode: () => false,
  sendEmail: async (input: { to: string; orderId?: string }) => {
    emailCalls.push({ to: input.to, orderId: input.orderId ?? '' })
    return { sent: true, demo: false }
  },
  sendDeliveryEmail: async (input: { to: string; orderId: string }) => {
    emailCalls.push({ to: input.to, orderId: input.orderId })
    return { sent: true, demo: false }
  },
  // T-V: order-service imports this too — a mock missing it fails the import.
  sendWatchDeliveryEmail: async (input: { to: string; orderId: string }) => {
    emailCalls.push({ to: input.to, orderId: input.orderId })
    return { sent: true, demo: false }
  },
  sendSecurityAlertEmail: async () => ({ sent: true, demo: false }),
}))

// ── env-dependent imports (after env fix + mock registration) ──
const { db } = await import('@/lib/db')
const { fulfillOrder } = await import('@/services/order-service')
const { claimDownload, hashToken } = await import('@/lib/delivery')
const { verifyCheckoutSignature, verifyWebhookSignature } = await import('@/lib/razorpay')

const RUN = crypto.randomBytes(3).toString('hex')
const startedAt = new Date()

async function http(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-internal-key': INTERNAL_KEY, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    /* non-JSON (redirect/html) */
  }
  return { status: res.status, json, text, headers: res.headers }
}

/**
 * The claim cookie value for an order (re-audit B3: demo-pay / verify /
 * status are claim-gated — the caller must present the checkout cookie).
 * Same construction as lib/claim-cookie.ts.
 */
function claimCookieFor(orderId: string): string {
  const pepper = process.env.SESSION_PEPPER || process.env.INTERNAL_API_KEY || 'sdh-dev-claim-pepper'
  const mac = crypto.createHmac('sha256', pepper).update(`claim:${orderId}`).digest('base64url')
  return `__Host-sdh_claim=${orderId}.${mac}`
}

// ═══ 1. Signature units ═════════════════════════════════════
console.log('\n1. signature units (constant-time compare)')
process.env.RAZORPAY_KEY_SECRET = 't5-unit-key-secret'
const sig = hmacHex('t5-unit-key-secret', 'order_ab12|pay_cd34')
check('payment signature: valid accepted', verifyCheckoutSignature('order_ab12', 'pay_cd34', sig) === true)
check('payment signature: tampered rejected', verifyCheckoutSignature('order_ab12', 'pay_cd34', sig.replace(/^./, 'f')) === false)
check('payment signature: wrong length rejected', verifyCheckoutSignature('order_ab12', 'pay_cd34', 'abcd') === false)
check('payment signature: non-hex garbage rejected', verifyCheckoutSignature('order_ab12', 'pay_cd34', 'zzzz'.repeat(16)) === false)
check('payment signature: missing rejected', verifyCheckoutSignature('order_ab12', 'pay_cd34', null) === false)

const rawBody = JSON.stringify({ event: 'unit.test', payload: { x: 1 } })
const wsig = hmacHex(WEBHOOK_SECRET, rawBody)
check('webhook HMAC (raw body): valid accepted', verifyWebhookSignature(rawBody, wsig) === true)
check('webhook HMAC (raw body): tampered rejected', verifyWebhookSignature(rawBody, wsig.replace(/^./, '0')) === false)
check('webhook HMAC: body byte-flip rejected', verifyWebhookSignature(rawBody.replace('1', '2'), wsig) === false)
// Hex decoding normalises case: an uppercase rendition of the SAME bytes is the
// same signature (Buffer.from(hex) is case-insensitive) — must still verify.
check('webhook HMAC: uppercase rendition of same bytes verifies', verifyWebhookSignature(rawBody, wsig.toUpperCase()) === true)
check('webhook HMAC: different-length signature rejected', verifyWebhookSignature(rawBody, wsig.slice(0, -2)) === false)
check('webhook HMAC: odd-length hex rejected', verifyWebhookSignature(rawBody, `${wsig}a`) === false)

// ═══ shared fixture: draft test product (never public) ══════
const testProduct = await db.product.create({
  data: {
    title: `T5 Verify Product ${RUN}`,
    slug: `t5-verify-${RUN}`,
    zone: 'kids',
    priceInr: 199,
    instantDownload: true,
    deliverableUrl: '/files/t5-sample.pdf',
    deliverableName: 't5-sample.pdf',
    status: 'draft', // draft → invisible to the public catalog
  },
})

const mkOrder = async (over: Partial<{ status: string; amountInr: number; email: string }> = {}) =>
  db.order.create({
    data: {
      productId: testProduct.id,
      customerName: 'T5 Verify',
      customerEmail: over.email ?? `t5-${RUN}-${crypto.randomBytes(3).toString('hex')}@test.local`,
      amountInr: over.amountInr ?? 199,
      status: over.status ?? 'pending',
    },
  })

const orderIds: string[] = []
async function track<T extends { id: string }>(o: T): Promise<T> {
  orderIds.push(o.id)
  return o
}

try {
  // ═══ 2. fulfillOrder concurrency ═══════════════════════════
  console.log('\n2. fulfillOrder concurrency (10 parallel)')
  const o1 = await track(await mkOrder())
  const results = await Promise.all(Array.from({ length: 10 }, () => fulfillOrder(o1.id)))
  const fulfilled = results.filter((r) => r.outcome === 'fulfilled')
  const duplicates = results.filter((r) => r.outcome === 'duplicate')
  check('exactly 1 fulfillment wins', fulfilled.length === 1, results.map((r) => r.outcome).join(','))
  check('9 no-op duplicates', duplicates.length === 9)
  check('exactly 1 token minted', typeof fulfilled[0]?.token === 'string' && fulfilled[0].token.length >= 40)
  const o1after = await db.order.findUnique({ where: { id: o1.id } })
  check('order paid once with token hash only', Boolean(o1after?.downloadTokenHash && o1after.status === 'paid'))
  check('tokenExpiresAt set (TTL window)', Boolean(o1after?.tokenExpiresAt && o1after.tokenExpiresAt.getTime() > Date.now()))
  check('emailSent recorded', o1after?.emailSent === true)
  check('exactly 1 email send (instrumented)', emailCalls.length === 1, emailCalls.length)
  const paidEvents = await db.activityEvent.count({ where: { orderId: o1.id, type: 'order_paid' } })
  check('exactly 1 order_paid funnel event', paidEvents === 1, paidEvents)
  const audits = await db.auditLog.count({ where: { entity: 'order', entityId: o1.id, action: 'order.fulfilled' } })
  check('exactly 1 order.fulfilled audit row', audits === 1, audits)

  console.log('\n2b. payment-id reuse rejected')
  const o2 = await track(await mkOrder())
  const reuse = await fulfillOrder(o2.id, { paymentId: fulfilled[0]!.order.razorpayPaymentId! })
  check('payment id reuse rejected', reuse.outcome === 'rejected' && reuse.reason === 'payment_id_reused')
  const o2after = await db.order.findUnique({ where: { id: o2.id } })
  check('reused order stays pending', o2after?.status === 'pending')

  // ═══ 3. atomic download claim ══════════════════════════════
  console.log('\n3. atomic download claim (10 parallel, max 3)')
  const token3 = crypto.randomBytes(32).toString('base64url')
  const o3 = await track(
    await db.order.create({
      data: {
        productId: testProduct.id,
        customerName: 'T5 Verify',
        customerEmail: `t5-${RUN}-claim@test.local`,
        amountInr: 199,
        status: 'paid',
        downloadTokenHash: hashToken(token3),
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      },
    }),
  )
  const claims = await Promise.all(Array.from({ length: 10 }, () => claimDownload(hashToken(token3), 3)))
  check('exactly 3 of 10 claims succeed', claims.filter((c) => c === 1).length === 3, claims.join(','))
  const o3after = await db.order.findUnique({ where: { id: o3.id } })
  check('downloadCount is exactly 3', o3after?.downloadCount === 3, o3after?.downloadCount)

  console.log('\n3b. claim past the cap / expiry returns 0')
  check('claim beyond cap → 0', (await claimDownload(hashToken(token3), 3)) === 0)

  // ═══ 4. expiry + limit HTTP shapes (byte-identical messages) ═══
  console.log('\n4. expiry boundary + limit (HTTP shapes)')
  const tokenExpired = crypto.randomBytes(32).toString('base64url')
  const o4 = await track(
    await db.order.create({
      data: {
        productId: testProduct.id,
        customerName: 'T5 Verify',
        customerEmail: `t5-${RUN}-exp@test.local`,
        amountInr: 199,
        status: 'paid',
        downloadTokenHash: hashToken(tokenExpired),
        tokenExpiresAt: new Date(Date.now() - 3600 * 1000),
      },
    }),
  )
  const expired = await http('GET', `/api/download/${tokenExpired}?mode=json`)
  check('expired token → 410', expired.status === 410, expired.status)
  check(
    'expired message identical',
    expired.json?.error === 'This download link has expired — contact us for a fresh link',
    expired.json,
  )
  check('expired body shape { ok:false, error }', expired.json?.ok === false && typeof expired.json?.error === 'string')

  const tokenLimit = crypto.randomBytes(32).toString('base64url')
  const o5 = await track(
    await db.order.create({
      data: {
        productId: testProduct.id,
        customerName: 'T5 Verify',
        customerEmail: `t5-${RUN}-limit@test.local`,
        amountInr: 199,
        status: 'paid',
        downloadTokenHash: hashToken(tokenLimit),
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        downloadCount: 5, // DOWNLOAD_MAX_DEFAULT
      },
    }),
  )
  const limit = await http('GET', `/api/download/${tokenLimit}?mode=json`)
  check('limit token → 429', limit.status === 429, limit.status)
  check('limit message identical', limit.json?.error === 'Download limit reached (5) — contact us to reset it', limit.json)

  // ═══ 5. real routes: create → demo-pay → public order ═══════
  console.log('\n5. real routes: checkout (demo) + leak scan of public shapes')
  const pubProduct = await db.product.findFirst({
    where: { status: 'published', instantDownload: true, deliverableUrl: { not: null } },
    orderBy: { createdAt: 'asc' },
  })
  check('a published instant-download product exists for the checkout check', Boolean(pubProduct))
  if (pubProduct) {
    // P1: the legacy POST /api/orders is retired (410) — the verify script
    // now walks the SAME checkout v2 flow the frontend uses.
    const retired = await http('POST', '/api/orders', {
      productId: pubProduct.id,
      customerName: 'T5 Verify',
      customerEmail: `t5-${RUN}-checkout@test.local`,
    })
    check('legacy POST /api/orders is retired → 410', retired.status === 410, retired.status)
    const created = await http(
      'POST',
      '/api/checkout/create',
      {
        productId: pubProduct.id,
        customerName: 'T5 Verify',
        customerEmail: `t5-${RUN}-checkout@test.local`,
        country: 'IN',
        consent: true,
      },
      { 'Idempotency-Key': `t5-${RUN}-checkout` },
    )
    check('POST /api/checkout/create → 201', created.status === 201, created.status)
    const coId = created.json?.order?.id
    check('create response has order + demo payment fields', Boolean(coId) && created.json?.paymentMode === 'demo')
    const createBody = created.text
    check(
      'create response leak-free (no tokenHash/deliverable/fileId)',
      !/tokenHash|deliverable|fileId|key_secret/i.test(createBody),
    )
    if (coId) {
      orderIds.push(coId)
      // The claim cookie rides on the create response (B3 gate).
      const claim = /__Host-sdh_claim=([^;]+)/.exec(created.headers.get('set-cookie') ?? '')?.[1] ?? ''
      const cookieHeader: Record<string, string> = claim ? { cookie: `__Host-sdh_claim=${claim}` } : {}
      const pay = await http('POST', `/api/orders/${coId}/demo-pay`, undefined, cookieHeader)
      check('demo-pay → 200', pay.status === 200, pay.status)
      check('demo-pay returns token + SPA downloadUrl', typeof pay.json?.token === 'string' && pay.json?.downloadUrl === `/#/download/${pay.json.token}`)
      const payBody = pay.text
      check('demo-pay order shape leak-free', !/tokenHash|deliverable|fileId|key_secret/i.test(payBody))
      const got = await http('GET', `/api/orders/${coId}`, undefined, cookieHeader)
      check('public order GET → 200 paid', got.status === 200 && got.json?.order?.status === 'paid')
      check('public order GET leak-free', !/tokenHash|deliverable|fileId|key_secret/i.test(got.text))
      // §2.7: the GET validates WITHOUT consuming — the claim is the POST.
      const dlValidate = await http('GET', `/api/download/${pay.json.token}?mode=json`)
      check('download GET validates without fileUrl (free)', dlValidate.status === 200 && dlValidate.json?.ok === true && dlValidate.json?.claimable === true && dlValidate.json?.fileUrl === undefined)
      const dl = await http('POST', `/api/download/${pay.json.token}?mode=json`)
      check('download POST claims (json fileUrl)', dl.status === 200 && dl.json?.ok === true && typeof dl.json?.fileUrl === 'string')
    }
  }

  console.log('\n5b. /api/razorpay/verify without Razorpay keys (demo mode)')
  const o6 = await track(await mkOrder())
  const v404 = await http('POST', '/api/razorpay/verify', {
    razorpayOrderId: 'order_missing0001',
    razorpayPaymentId: 'pay_missing0001',
    razorpaySignature: crypto.randomBytes(32).toString('hex'),
    orderId: 't5-does-not-exist',
  })
  check('verify: unknown order → 404', v404.status === 404, v404.status)
  const vDemo = await http('POST', '/api/razorpay/verify', {
    razorpayOrderId: 'order_razorpay0001',
    razorpayPaymentId: 'pay_razorpay0001',
    razorpaySignature: crypto.randomBytes(32).toString('hex'),
    orderId: o6.id,
  }, { cookie: claimCookieFor(o6.id) })
  check('verify: demo mode → clean 400 (never 500)', vDemo.status === 400, { status: vDemo.status, body: vDemo.json })
  const vNoClaim = await http('POST', '/api/razorpay/verify', {
    razorpayOrderId: 'order_razorpay0001',
    razorpayPaymentId: 'pay_razorpay0001',
    razorpaySignature: crypto.randomBytes(32).toString('hex'),
    orderId: o6.id,
  })
  check('verify without the claim cookie → 403 (B3 gate)', vNoClaim.status === 403, vNoClaim.status)
  const vBad = await http('POST', '/api/razorpay/verify', { razorpayOrderId: 'x', razorpayPaymentId: 'y', razorpaySignature: 'short', orderId: o6.id })
  check('verify: malformed body → 400', vBad.status === 400, vBad.status)

  // ═══ 6. webhook suite (live server) ═════════════════════════
  console.log('\n6. webhook suite (live server)')
  check('RAZORPAY_WEBHOOK_SECRET present (dev .env)', Boolean(WEBHOOK_SECRET))

  const whPayload = (o: { id: string; amountInr: number }, over: Partial<{ amount: number; currency: string; paymentId: string; orderRef: string; type: string }> = {}) =>
    JSON.stringify({
      event: over.type ?? 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: over.paymentId ?? `pay_t5_${RUN}_${crypto.randomBytes(3).toString('hex')}`,
            amount: over.amount ?? Math.round(o.amountInr * 100),
            currency: over.currency ?? 'INR',
            notes: { orderRef: over.orderRef ?? o.id },
          },
        },
      },
    })

  // POST the webhook with a RAW string body (signature is computed over these bytes)
  const webhookPost = async (body: string, sigHex: string | null, eventId?: string) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (sigHex) headers['x-razorpay-signature'] = sigHex
    if (eventId) headers['x-razorpay-event-id'] = eventId
    const res = await fetch(`${BASE}/api/razorpay/webhook`, { method: 'POST', headers, body })
    const text = await res.text()
    let json: any = null
    try {
      json = JSON.parse(text)
    } catch {
      /* ignore */
    }
    return { status: res.status, json }
  }

  // 6a. bad signature → 400 (and NOTHING processed)
  const o7 = await track(await mkOrder())
  const badSig = await webhookPost(whPayload(o7), hmacHex('wrong-secret', 'x'))
  check('bad signature → 400', badSig.status === 400, badSig.status)
  const o7mid = await db.order.findUnique({ where: { id: o7.id } })
  check('bad signature: no DB work (order untouched)', o7mid?.status === 'pending' && !o7mid?.downloadTokenHash)

  // 6b. valid signature → fulfilled
  const o8 = await track(await mkOrder())
  const payload8 = whPayload(o8)
  const okSig = await webhookPost(payload8, hmacHex(WEBHOOK_SECRET, payload8), `evt-t5-${RUN}-ok`)
  check('valid webhook → 200', okSig.status === 200, { status: okSig.status, body: okSig.json })
  const o8after = await db.order.findUnique({ where: { id: o8.id } })
  check('webhook fulfilled the order', o8after?.status === 'paid' && Boolean(o8after?.downloadTokenHash))
  const okAudits = await db.auditLog.count({ where: { entity: 'order', entityId: o8.id, action: 'order.fulfilled' } })
  check('webhook fulfillment audited once', okAudits === 1, okAudits)

  // 6c. duplicate eventId → 200, exactly ONE fulfilment
  const dupSame = await webhookPost(payload8, hmacHex(WEBHOOK_SECRET, payload8), `evt-t5-${RUN}-ok`)
  check('duplicate event id → 200', dupSame.status === 200, dupSame.status)
  check('duplicate flagged', dupSame.json?.duplicate === true, dupSame.json)
  const dupRows = await db.webhookEvent.count({ where: { eventId: `evt-t5-${RUN}-ok` } })
  check('webhookEvent recorded exactly once', dupRows === 1, dupRows)
  const dupAudits = await db.auditLog.count({ where: { entity: 'order', entityId: o8.id, action: 'order.fulfilled' } })
  check('no second fulfilment/email (audit count still 1)', dupAudits === 1, dupAudits)
  const o8final = await db.order.findUnique({ where: { id: o8.id } })
  check('token unchanged after duplicate', o8final?.downloadTokenHash === o8after?.downloadTokenHash)
  const dupEmails = await db.activityEvent.count({ where: { orderId: o8.id, type: 'email_sent' } })
  check('exactly one email funnel event (server demo driver logs, no email_sent)', dupEmails === 0, dupEmails)

  // 6d. identical raw body without event-id header → sha256 fallback dedupe
  const dupBody = await webhookPost(payload8, hmacHex(WEBHOOK_SECRET, payload8))
  check('identical body (sha256 event id) → 200 duplicate', dupBody.status === 200 && dupBody.json?.duplicate === true, dupBody.json)

  // 6e. wrong amount → rejected, order stays pending
  const o9 = await track(await mkOrder())
  const wrongAmt = whPayload(o9, { amount: 99900 })
  const wrongAmtRes = await webhookPost(wrongAmt, hmacHex(WEBHOOK_SECRET, wrongAmt), `evt-t5-${RUN}-amt`)
  check('wrong amount → 409', wrongAmtRes.status === 409, wrongAmtRes.status)
  const o9after = await db.order.findUnique({ where: { id: o9.id } })
  check('wrong amount: order stays pending', o9after?.status === 'pending' && !o9after?.downloadTokenHash)
  const amtResult = await db.webhookEvent.findUnique({ where: { eventId: `evt-t5-${RUN}-amt` } })
  check('wrong amount recorded as amount_mismatch', amtResult?.result === 'amount_mismatch', amtResult?.result)

  // 6f. wrong currency → rejected
  const o10 = await track(await mkOrder())
  const wrongCur = whPayload(o10, { currency: 'USD' })
  const wrongCurRes = await webhookPost(wrongCur, hmacHex(WEBHOOK_SECRET, wrongCur), `evt-t5-${RUN}-cur`)
  check('wrong currency → 409', wrongCurRes.status === 409, wrongCurRes.status)
  const o10after = await db.order.findUnique({ where: { id: o10.id } })
  check('wrong currency: order stays pending', o10after?.status === 'pending')

  // 6g. unknown order id → 200 ignored + logged
  const unknownPayload = whPayload(o9, { orderRef: 't5-unknown-order-id' })
  const unknown = await webhookPost(unknownPayload, hmacHex(WEBHOOK_SECRET, unknownPayload), `evt-t5-${RUN}-unk`)
  check('unknown order id → 200', unknown.status === 200, unknown.status)
  check('unknown flagged unmatched', unknown.json?.unmatched === true, unknown.json)
  const unkResult = await db.webhookEvent.findUnique({ where: { eventId: `evt-t5-${RUN}-unk` } })
  check('unknown recorded as unmatched', unkResult?.result === 'unmatched', unkResult?.result)

  // 6h. no email-fallback matching: a valid event with the buyer email but NO orderRef
  const o11 = await track(await mkOrder({ email: `t5-${RUN}-fallback@test.local` }))
  const noRef = JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: `pay_t5_${RUN}_noref`, amount: Math.round(o11.amountInr * 100), currency: 'INR', email: o11.customerEmail, notes: {} } } },
  })
  const noRefRes = await webhookPost(noRef, hmacHex(WEBHOOK_SECRET, noRef), `evt-t5-${RUN}-noref`)
  check('email-only event (no orderRef) is NOT fulfilled', noRefRes.status === 200 && noRefRes.json?.unmatched === true, noRefRes.json)
  const o11after = await db.order.findUnique({ where: { id: o11.id } })
  check('email fallback removed: order stays pending', o11after?.status === 'pending')

  // 6i. irrelevant event type → 200 ignored + recorded (a type with no
  // handler and no payment/refund entity — e.g. a payout notification).
  const other = JSON.stringify({ event: 'payout.settled', payload: { payout: { entity: { id: 'pout_1' } } } })
  const otherRes = await webhookPost(other, hmacHex(WEBHOOK_SECRET, other), `evt-t5-${RUN}-other`)
  check('irrelevant type → 200 ignored', otherRes.status === 200 && otherRes.json?.ignored === 'payout.settled', otherRes.json)
  const otherRow = await db.webhookEvent.findUnique({ where: { eventId: `evt-t5-${RUN}-other` } })
  check('irrelevant type recorded', otherRow?.result === 'ignored', otherRow?.result)

  // 6j. malformed JSON with valid signature → 400
  const badJson = '{not json'
  const badJsonRes = await webhookPost(badJson, hmacHex(WEBHOOK_SECRET, badJson), `evt-t5-${RUN}-badjson`)
  check('valid signature + malformed JSON → 400', badJsonRes.status === 400, badJsonRes.status)
} finally {
  // ═══ cleanup (best-effort) ═══════════════════════════════
  try {
    const ids = orderIds
    await db.activityEvent.deleteMany({ where: { OR: [{ orderId: { in: ids } }, { productId: testProduct.id }] } })
    await db.auditLog.deleteMany({
      where: {
        OR: [
          { entity: 'order', entityId: { in: ids } },
          { action: { in: ['webhook.rejected', 'webhook.unmatched', 'webhook.amount_mismatch'] }, createdAt: { gte: startedAt } },
          { action: { in: ['payment.id_reused', 'order.fulfill_rejected'] }, createdAt: { gte: startedAt } },
        ],
      },
    })
    await db.order.deleteMany({ where: { id: { in: ids } } })
    await db.webhookEvent.deleteMany({ where: { eventId: { startsWith: 'evt-t5-' } } })
    await db.product.delete({ where: { id: testProduct.id } })
    console.log(`\ncleanup: ${ids.length} test order(s), 1 draft product, related events/audits removed`)
  } catch (e) {
    console.error('cleanup warning:', e instanceof Error ? e.message : e)
  }
  await db.$disconnect()
}

console.log(`\nT5 VERIFY: ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
