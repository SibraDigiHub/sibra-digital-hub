// ═══════════════════════════════════════════════════════════
// Single-gateway Razorpay — INTEGRATION tests (§12.1) against the real
// Postgres + the local mock Razorpay server (tests/mock-razorpay-server.ts,
// shared with the dev backend via RAZORPAY_API_BASE) +
// the live dev backend for the HTTP contract of new routes.
//
// Run: DATABASE_URL=… INTERNAL_API_KEY=… bun test tests/payments
// The dev backend must be running on :3001 for the HTTP section.
// ═══════════════════════════════════════════════════════════
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import crypto from 'node:crypto'
import { db } from '@/lib/db'
import { fulfillOrder, refundOrder, publicOrderDTO, flagDispute, recordDeliveryOutcome } from '@/services/order-service'
import { storeGatewaySession, GATEWAY_SESSION_UNSTORED } from '@/services/checkout-service'
import { maybeAlertStaleReconcile, RECONCILE_HEARTBEAT_KEY } from '@/services/cron-heartbeat'
import { mintGrantForOrder } from '@/services/watch-service'
import { claimDownload, hashToken } from '@/lib/delivery'

const BASE = process.env.CONTRACT_BASE_URL ?? 'http://127.0.0.1:3001'
const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? ''

async function api(path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-internal-key': INTERNAL_KEY,
      // Cron routes require `Authorization: Bearer $CRON_SECRET` whenever the
      // server has one configured. The suite reads the same env (bun autoloads
      // backend/.env) and authenticates exactly like production callers — an
      // explicitly passed authorization header (e.g. the wrong-bearer probe)
      // always wins.
      ...(process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {}),
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    body = { _raw: text.slice(0, 120) }
  }
  return { status: res.status, body, headers: res.headers }
}

// ── Shared mock Razorpay server (spawned once, port 3010) ──
// The dev backend on :3001 reads RAZORPAY_API_BASE=http://127.0.0.1:3010
// from backend/.env — the SAME mock instance serves both, mirroring how
// production points at api.razorpay.com. Deterministic port; a leftover
// instance from a crashed run is reused (the hooks reset state per run).
const MOCK_PORT = 3010
const MOCK_BASE = `http://127.0.0.1:${MOCK_PORT}`
let mockProc: Bun.Subprocess<'ignore', 'ignore', 'ignore'> | null = null

async function waitMockReady(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${MOCK_BASE}/__mock__/reset`, { method: 'POST' })
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('mock Razorpay server did not come up on :' + MOCK_PORT)
}

let testProduct: { id: string } | null = null
const createdOrders: string[] = []

beforeAll(async () => {
  // Audit guard: the workspace root .env leaks a SQLite file: DATABASE_URL
  // into sandboxed shells, which previously surfaced as cryptic Prisma
  // "URL must start with postgresql://" failures. Fail loudly instead.
  if (!process.env.DATABASE_URL?.startsWith('postgresql')) {
    throw new Error('DATABASE_URL must point at the backend Postgres (postgresql://…). Run: env -u DATABASE_URL bun run test:payments')
  }
  // Razorpay test-mode env — MUST match what the :3001 dev backend loaded
  // from backend/.env so signed webhook probes verify on both sides.
  process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_sandbox000000000'
  process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'sdh-dev-razorpay-secret-000000000000'
  process.env.RAZORPAY_MODE = 'test'
  process.env.RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'sdh-dev-razorpay-webhook-secret-000000'
  process.env.RAZORPAY_API_BASE = MOCK_BASE
  process.env.INTERNATIONAL_CHECKOUT_ENABLED = 'true'
  process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'dev-internal-key-not-used'
  mockProc = Bun.spawn(['bun', 'tests/mock-razorpay-server.ts'], {
    stdout: 'ignore',
    stderr: 'ignore',
    env: { ...process.env, MOCK_RAZORPAY_PORT: String(MOCK_PORT) },
  })
  await waitMockReady()
  // Test hygiene: clear the checkout rate-limit buckets so repeated test
  // runs never trip the 10-per-15-min IP limit.
  await db.rateLimit.deleteMany({ where: { key: { startsWith: 'checkout:' } } }).catch(() => undefined)
  testProduct = await db.product.findFirst({ where: { status: 'published', instantDownload: true }, select: { id: true } })
})

afterAll(async () => {
  // Sweep ANY leftover @sibra.local order — a test that fails mid-way never
  // reaches trackOrder(), and scripts/verify.ts no-fixture-leftovers counts
  // exactly this e-mail set. Cascade removes PaymentAttempt/EmailOutbox.
  const leftoverIds = (
    await db.order.findMany({ where: { customerEmail: { endsWith: '@sibra.local' } }, select: { id: true } })
  ).map((o) => o.id)
  const allIds = [...new Set([...createdOrders, ...leftoverIds])]
  await db.order.deleteMany({ where: { id: { in: allIds } } })
  await db.emailLog.deleteMany({ where: { orderId: { in: allIds } } }).catch(() => undefined)
  // IdempotencyKey rows are NOT FK-linked to orders (standalone replay
  // cache) — deleting the orders above leaves them behind, so the suite
  // removes the keys it created (test-*/audit-* prefixes are used by no
  // other caller: the frontend sends bare crypto.randomUUID() keys).
  await db.idempotencyKey
    .deleteMany({ where: { OR: [{ key: { startsWith: 'test-' } }, { key: { startsWith: 'audit-' } }] } })
    .catch(() => undefined)
  await db.webhookEvent.deleteMany({ where: { eventId: { startsWith: 'audit-test-' } } }).catch(() => undefined)
  await db.rateLimit.deleteMany({ where: { key: { startsWith: 'razorpay:verify:' } } }).catch(() => undefined)
  await db.rateLimit.deleteMany({ where: { key: { startsWith: 'checkout:' } } }).catch(() => undefined)
  await db.rateLimit.deleteMany({ where: { key: 'audit-test-old' } }).catch(() => undefined)
  // P4/P5 cleanup: alert emails + heartbeats written by this suite.
  await db.emailLog.deleteMany({ where: { OR: [{ subject: { contains: 'Payment captured but NOT delivered' } }, { subject: { contains: 'Payment reconciliation has not run' } }] } }).catch(() => undefined)
  await db.cronHeartbeat.deleteMany({ where: { key: { in: ['reconcile-payments', 'retry-emails'] } } }).catch(() => undefined)
  mockProc?.kill()
  mockProc = null
})

async function trackOrder(orderId: string): Promise<void> {
  createdOrders.push(orderId)
}

/** Fulfil an order through the shared fulfilOrder() (demo-pay answers 409
 *  once Razorpay keys are configured — the mock/test env has them). */
async function fulfilForToken(orderId: string): Promise<string> {
  const { fulfillOrder } = await import('@/services/order-service')
  const result = await fulfillOrder(orderId, { paymentId: `pay_test_${crypto.randomUUID().slice(0, 10)}` })
  if (result.outcome !== 'fulfilled') throw new Error(`fulfil failed: ${result.outcome}`)
  return result.token as string
}


// ── fulfillOrder idempotency + outbox (§6.4/§7) ─────────────
describe('fulfillOrder (both gateways share it)', () => {
  test('fulfils exactly once: one token, one outbox row, duplicate is a no-op', async () => {
    if (!testProduct) throw new Error('no published instant-download product in the dev DB')
    const order = await db.order.create({
      data: {
        productId: testProduct.id,
        customerName: 'Pay Test',
        customerEmail: 'pay-test@sibra.local',
        amountInr: 499,
        status: 'pending',
        gateway: 'razorpay',
        currency: 'INR',
        amountMinor: 49900,
        billingCountry: 'IN',
      },
    })
    await trackOrder(order.id)

    const first = await fulfillOrder(order.id, { paymentId: 'pay_test_fulfil_1' })
    if (first.outcome !== 'fulfilled') throw new Error(`fulfil failed: ${'reason' in first ? first.reason : ''}`)
    expect(first.token).toBeTruthy()

    const after = await db.order.findUnique({ where: { id: order.id } })
    expect(after?.status).toBe('paid')
    expect(after?.downloadTokenHash).toBe(hashToken(first.token as string))
    expect(after?.paypalOrderId).toBeNull() // razorpay flow never invents paypal refs

    const outbox = await db.emailOutbox.findMany({ where: { orderId: order.id } })
    expect(outbox.length).toBe(1)
    expect(outbox[0].template).toBe('delivery')

    // Racing fulfilments (verify vs webhook) → duplicate, no second token/email.
    const second = await fulfillOrder(order.id, { paymentId: 'pay_test_fulfil_1' })
    expect(second.outcome).toBe('duplicate')
    const outboxAgain = await db.emailOutbox.findMany({ where: { orderId: order.id } })
    expect(outboxAgain.length).toBe(1)
  })

  test('10 parallel fulfilments produce exactly ONE token and outbox row', async () => {
    if (!testProduct) throw new Error('no published instant-download product in the dev DB')
    const order = await db.order.create({
      data: {
        productId: testProduct.id,
        customerName: 'Race Test',
        customerEmail: 'race-test@sibra.local',
        amountInr: 499,
        status: 'pending',
      },
    })
    await trackOrder(order.id)
    const results = await Promise.all(Array.from({ length: 10 }, () => fulfillOrder(order.id, { paymentId: null })))
    const fulfilled = results.filter((r) => r.outcome === 'fulfilled')
    expect(fulfilled.length).toBe(1)
    const outbox = await db.emailOutbox.findMany({ where: { orderId: order.id } })
    expect(outbox.length).toBe(1)
  })

  test('refund revokes access atomically; the download claim then fails', async () => {
    if (!testProduct) throw new Error('no published instant-download product in the dev DB')
    const order = await db.order.create({
      data: {
        productId: testProduct.id,
        customerName: 'Refund Test',
        customerEmail: 'refund-test@sibra.local',
        amountInr: 299,
        status: 'pending',
      },
    })
    await trackOrder(order.id)
    const fulfil = await fulfillOrder(order.id, { paymentId: 'pay_test_refund_1' })
    if (fulfil.outcome !== 'fulfilled') throw new Error('fulfil failed for refund test')

    // Before refund: the claim succeeds.
    const okClaim = await claimDownload(hashToken(fulfil.token as string), 5)
    expect(okClaim).toBe(1)

    const refund = await refundOrder(order.id, 'test refund')
    expect(refund.ok).toBeTrue()
    const refunded = await db.order.findUnique({ where: { id: order.id } })
    expect(refunded?.status).toBe('refunded')

    // After refund: expiry moved → claim rejected even with the old token.
    const deniedClaim = await claimDownload(hashToken(fulfil.token as string), 5)
    expect(deniedClaim).toBe(0)

    // Double refund is a no-op.
    const again = await refundOrder(order.id, 'double refund')
    expect(again.ok).toBeFalse()
  })
})

// ── Razorpay Orders API lib against the mock server (§5.1) ──
describe('Razorpay Orders API (mock server)', () => {
  test('create → fetch → order payments → single payment fetch', async () => {
    const { createRazorpayOrder, fetchRazorpayOrder, fetchRazorpayOrderPayments, fetchRazorpayPayment } = await import('@/lib/razorpay')
    const created = await createRazorpayOrder({
      amountMinor: 49900,
      currency: 'INR',
      receipt: 'order_local_1',
      notes: { orderRef: 'order_local_1' },
    })
    if (!created.ok) throw new Error(`razorpay create failed: ${created.error}`)
    expect(created.razorpayOrderId?.startsWith('order_mock_')).toBeTrue()

    const fetched = await fetchRazorpayOrder(created.razorpayOrderId as string)
    expect(fetched.ok).toBeTrue()
    expect(fetched.data?.amount).toBe(49900)
    expect(fetched.data?.currency).toBe('INR')

    // Attach a captured payment through the test hook, then read it back
    // through the same two endpoints verify/reconcile use.
    const hooked = await fetch(`${MOCK_BASE}/__mock__/pay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: created.razorpayOrderId, amount: 49900, currency: 'INR', method: 'upi' }),
    })
    const payment = (await hooked.json()) as { id: string }
    expect(payment.id).toStartWith('pay_mock_')

    const listed = await fetchRazorpayOrderPayments(created.razorpayOrderId as string)
    expect(listed.ok).toBeTrue()
    expect(listed.data?.items?.some((p) => p.id === payment.id && p.status === 'captured')).toBeTrue()

    const single = await fetchRazorpayPayment(payment.id)
    expect(single.ok).toBeTrue()
    expect(single.payment?.order_id).toBe(created.razorpayOrderId)
    expect(single.payment?.amount).toBe(49900)
  })

  test('Razorpay rejections map to stable internal codes — raw errors never reach the buyer', async () => {
    const { createRazorpayOrder } = await import('@/lib/razorpay')
    // 4xx → RAZORPAY_REJECTED (deterministic — never retried)
    const rejected = await createRazorpayOrder({ amountMinor: 1, currency: 'INR', receipt: 'r1', notes: {} })
    await fetch(`${MOCK_BASE}/__mock__/fail-next`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 400 }) })
    const bad = await createRazorpayOrder({ amountMinor: 1, currency: 'INR', receipt: 'r2', notes: {} })
    expect(bad.ok).toBeFalse()
    expect(bad.code).toBe('RAZORPAY_REJECTED')
    void rejected
  })

  test('5xx gateway failures map to RAZORPAY_UNAVAILABLE', async () => {
    const { createRazorpayOrder } = await import('@/lib/razorpay')
    // The client retries network/429/5xx ONCE — both attempts must fail.
    await fetch(`${MOCK_BASE}/__mock__/fail-next`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 500, times: 2 }),
    })
    const down = await createRazorpayOrder({ amountMinor: 1, currency: 'INR', receipt: 'r3', notes: {} })
    expect(down.ok).toBeFalse()
    expect(down.code).toBe('RAZORPAY_UNAVAILABLE')
  })
})

// ── HTTP contract of the NEW routes (live dev backend) ──────
describe('checkout HTTP contract', () => {
  test('GET /api/payments/config — public values only, no secrets', async () => {
    const { status, body } = await api('/api/payments/config')
    expect(status).toBe(200)
    expect(body).toHaveProperty('razorpayConfigured')
    expect(body).toHaveProperty('internationalEnabled')
    expect(body).toHaveProperty('foreignCurrencies')
    const raw = JSON.stringify(body)
    expect(raw.toLowerCase()).not.toContain('secret')
    expect(raw.toLowerCase()).not.toContain('rzp_')
  })

  test('quote: IN → razorpay/INR; US → razorpay/USD (flag on); bad product → 404', async () => {
    if (!testProduct) throw new Error('no product')
    const inn = await api('/api/checkout/quote', { method: 'POST', body: JSON.stringify({ productId: testProduct.id, country: 'IN' }) })
    expect(inn.status).toBe(200)
    expect(inn.body.gateway).toBe('razorpay')
    expect(inn.body.currency).toBe('INR')
    expect(typeof inn.body.amountMinor).toBe('number')

    const us = await api('/api/checkout/quote', { method: 'POST', body: JSON.stringify({ productId: testProduct.id, country: 'US' }) })
    expect(us.status).toBe(200)
    expect(us.body.gateway).toBe('razorpay')
    expect(us.body.currency).toBe('USD')

    const bad = await api('/api/checkout/quote', { method: 'POST', body: JSON.stringify({ productId: 'nope', country: 'US' }) })
    expect(bad.status).toBe(404)
  })

  test('create: razorpay order options echoed, idempotency replay, claim cookie set; status is claim-gated', async () => {
    if (!testProduct) throw new Error('no product')
    const key = `test-${crypto.randomUUID()}`
    const createBody = JSON.stringify({
      productId: testProduct.id,
      customerName: 'HTTP Test',
      customerEmail: 'http-test@sibra.local',
      country: 'IN',
      consent: true,
    })
    const first = await api('/api/checkout/create', { method: 'POST', headers: { 'Idempotency-Key': key }, body: createBody })
    expect(first.status).toBe(201)
    expect(first.body.paymentMode).toBe('razorpay')
    // Standard Checkout options: public key id + Razorpay order id, never a secret.
    const rzp = first.body.razorpay as { keyId: string; orderId: string; amount: number; currency: string; orderRef: string }
    expect(rzp.keyId).toStartWith('rzp_test_')
    expect(rzp.orderId).toStartWith('order_mock_')
    expect(rzp.currency).toBe('INR')
    expect(typeof rzp.amount).toBe('number')
    const order = (first.body.order as { id: string }) ?? null
    expect(order?.id).toBeTruthy()
    await trackOrder(order.id)
    const rawCreate = JSON.stringify(first.body)
    expect(rawCreate).not.toContain(process.env.RAZORPAY_KEY_SECRET as string)
    expect(rawCreate.toLowerCase()).not.toContain('webhooksecret')

    const setCookie = first.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('__Host-sdh_claim')

    // Same key → same stored response (no second order).
    const replay = await api('/api/checkout/create', { method: 'POST', headers: { 'Idempotency-Key': key }, body: createBody })
    expect(replay.status).toBe(201)
    expect((replay.body.order as { id: string })?.id).toBe(order.id)

    // Claim-gated status: no cookie → 403; with cookie → 200.
    const noClaim = await api(`/api/orders/${order.id}/status`)
    expect(noClaim.status).toBe(403)
    const claimValue = /__Host-sdh_claim=([^;]+)/.exec(setCookie)?.[1] ?? ''
    const withClaim = await api(`/api/orders/${order.id}/status`, { headers: { cookie: `__Host-sdh_claim=${claimValue}` } })
    expect(withClaim.status).toBe(200)
    expect((withClaim.body.order as { status: string }).status).toBe('pending')

    // Security-audit regression: the LEGACY public order route must carry
    // the same claim gate (it used to serve buyer PII to anyone with the id).
    const legacyNoClaim = await api(`/api/orders/${order.id}`)
    expect(legacyNoClaim.status).toBe(403)
    const legacyWithClaim = await api(`/api/orders/${order.id}`, { headers: { cookie: `__Host-sdh_claim=${claimValue}` } })
    expect(legacyWithClaim.status).toBe(200)
    expect((legacyWithClaim.body.order as { id: string }).id).toBe(order.id)

    // publicOrderDTO on the status response must not leak token/file fields.
    const dtoKeys = Object.keys((withClaim.body.order as Record<string, unknown>) ?? {})
    expect(dtoKeys).not.toContain('downloadTokenHash')
    expect(dtoKeys).not.toContain('riskFlags')
    const dto = publicOrderDTO({
      product: {
        title: '', slug: '', zone: 'kids', instantDownload: true, deliveryMode: 'file',
        deliverableName: null, fullVideoUrl: null, watchTtlHours: null, watchMaxConcurrent: 2,
      },
      razorpayPaymentId: null, razorpayPaymentLinkId: null, razorpayOrderId: null, paymentMethod: null, paymentInternational: null, gateway: 'razorpay', billingCountry: 'US', currency: 'USD', amountMinor: 599, customerName: '', customerEmail: '', amountInr: 0, status: 'pending', tokenExpiresAt: null, downloadCount: 0, emailSent: false, visitorId: null, createdAt: new Date(), updatedAt: new Date(), id: 'x', productId: 'x', paypalOrderId: null, paypalCaptureId: null, ipCountry: null, riskFlags: [],
    } as unknown as Parameters<typeof publicOrderDTO>[0])
    expect(JSON.stringify(dto)).not.toContain('deliverable')
  })

  test('webhooks reject unverified deliveries with 400; the removed PayPal webhook route is gone', async () => {
    const rzp = await fetch(`${BASE}/api/razorpay/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'deadbeef' },
      body: '{"event":"payment.captured"}',
    })
    expect(rzp.status).toBe(400)

    // PayPal routes were removed in the single-gateway migration — 404
    // (through the transport guard, so the probe carries the internal key).
    const pp = await api('/api/paypal/webhook', { method: 'POST', body: '{}' })
    expect(pp.status).toBe(404)
    const cap = await api('/api/checkout/paypal/capture', { method: 'POST', body: '{}' })
    expect(cap.status).toBe(404)
  })

  test('cron routes require the bearer token when CRON_SECRET is configured', async () => {
    // The cron contract: with CRON_SECRET set, a wrong bearer is 401; with
    // none configured (local dev), the route is deliberately open (§6.6).
    const secretConfigured = Boolean(process.env.CRON_SECRET)
    const res = await api('/api/cron/reconcile-payments', { headers: { authorization: 'Bearer wrong' } })
    expect(res.status).toBe(secretConfigured ? 401 : 200)
    const retry = await api('/api/cron/retry-emails', { headers: { authorization: 'Bearer wrong' } })
    expect(retry.status).toBe(secretConfigured ? 401 : 200)
  })
})

// ═══════════════════════════════════════════════════════════
// Security-audit regressions — each test corresponds to a
// verified audit finding; it fails against the pre-fix code.
// ═══════════════════════════════════════════════════════════

/** Sign a webhook body the way Razorpay does (HMAC-SHA256 hex of the raw body). */
function signedRazorpay(body: string): Record<string, string> {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? ''
  expect(secret.length).toBeGreaterThan(0) // backend/.env provides the dev secret
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex')
  return { 'content-type': 'application/json', 'x-razorpay-signature': signature }
}

describe('security-audit regressions (backend)', () => {
  test('flagDispute revokes the WATCH entitlement, not just the download token', async () => {
    if (!testProduct) throw new Error('no product')
    const order = await db.order.create({
      data: { productId: testProduct.id, customerName: 'Dispute Test', customerEmail: 'dispute-test@sibra.local', amountInr: 199, status: 'paid' },
    })
    await trackOrder(order.id)
    await mintGrantForOrder(order.id, 'audit-dispute-plain-token', 48, 2)
    await flagDispute(order.id, 'audit test dispute')
    const grant = await db.watchGrant.findUnique({ where: { orderId: order.id } })
    expect(grant?.revokedAt).not.toBeNull()
    // The download token expiry also moved (existing behaviour preserved).
    const fresh = await db.order.findUnique({ where: { id: order.id }, select: { riskFlags: true, tokenExpiresAt: true } })
    expect(fresh?.riskFlags).toContain('DISPUTED')
    expect(fresh?.tokenExpiresAt?.getTime()).toBeLessThanOrEqual(Date.now())
  })

  test('recordDeliveryOutcome UPSERT recreates a lost outbox row (retry chain self-heals)', async () => {
    if (!testProduct) throw new Error('no product')
    const order = await db.order.create({
      data: { productId: testProduct.id, customerName: 'Outbox Test', customerEmail: 'outbox-test@sibra.local', amountInr: 199, status: 'paid' },
    })
    await trackOrder(order.id)
    await db.emailOutbox.deleteMany({ where: { orderId: order.id } })
    // Lost insert → FAILED row appears (previously: silence, no retries ever).
    await recordDeliveryOutcome(order.id, 'delivery', false, 'boom')
    const failed = await db.emailOutbox.findUnique({ where: { orderId_template: { orderId: order.id, template: 'delivery' } } })
    expect(failed?.status).toBe('FAILED')
    expect(failed?.lastError).toBe('boom')
    expect(failed?.attempts).toBe(1)
    expect(failed?.nextAttemptAt).not.toBeNull()
    // Later success flips it to SENT.
    await recordDeliveryOutcome(order.id, 'delivery', true, null)
    const sent = await db.emailOutbox.findUnique({ where: { orderId_template: { orderId: order.id, template: 'delivery' } } })
    expect(sent?.status).toBe('SENT')
    expect(sent?.sentAt).not.toBeNull()
    expect(sent?.lastError).toBeNull()
    expect(sent?.attempts).toBe(2)
  })

  test('watch delivery retry must NOT resurrect an admin-revoked grant', async () => {
    const watchProduct = await db.product.findFirst({ where: { deliveryMode: 'watch' }, select: { id: true } })
    if (!watchProduct) {
      console.log('skipping watch-retry test — no watch-mode product in the dev DB')
      return
    }
    const order = await db.order.create({
      data: { productId: watchProduct.id, customerName: 'Watch Retry Test', customerEmail: 'watch-retry@sibra.local', amountInr: 199, status: 'paid' },
    })
    await trackOrder(order.id)
    await mintGrantForOrder(order.id, 'audit-watch-plain-token', 48, 2)
    await db.watchGrant.updateMany({ where: { orderId: order.id }, data: { revokedAt: new Date() } })
    await db.emailOutbox.create({ data: { orderId: order.id, template: 'watch_delivery', status: 'PENDING', nextAttemptAt: new Date(Date.now() - 1000) } })

    const res = await api('/api/cron/retry-emails', { method: 'POST' })
    expect(res.status).toBe(200)

    const grant = await db.watchGrant.findUnique({ where: { orderId: order.id } })
    expect(grant?.revokedAt).not.toBeNull() // revocation survived the retry
    expect(grant?.tokenHash).toBe(hashToken('audit-watch-plain-token')) // not re-minted
    const row = await db.emailOutbox.findUnique({ where: { orderId_template: { orderId: order.id, template: 'watch_delivery' } } })
    expect(row?.status).toBe('FAILED')
    expect(row?.lastError).toBe('watch_access_revoked')
  })

  test('outbox rows at max attempts are parked FAILED (admin alert path)', async () => {
    if (!testProduct) throw new Error('no product')
    const order = await db.order.create({
      data: { productId: testProduct.id, customerName: 'Exhaust Test', customerEmail: 'exhaust-test@sibra.local', amountInr: 199, status: 'paid' },
    })
    await trackOrder(order.id)
    await db.emailOutbox.create({ data: { orderId: order.id, template: 'delivery', status: 'PENDING', attempts: 5, nextAttemptAt: new Date(Date.now() - 1000) } })
    const res = await api('/api/cron/retry-emails', { method: 'POST' })
    expect(res.status).toBe(200)
    const row = await db.emailOutbox.findUnique({ where: { orderId_template: { orderId: order.id, template: 'delivery' } } })
    expect(row?.status).toBe('FAILED')
  })

  test('reconcile cron prunes expired rate-limit windows', async () => {
    await db.$executeRaw`INSERT INTO "RateLimit" ("key", "count", "resetAt") VALUES ('audit-test-old', 1, now() - interval '2 days') ON CONFLICT ("key") DO NOTHING`
    const res = await api('/api/cron/reconcile-payments', { method: 'POST' })
    expect(res.status).toBe(200)
    const pruned = await db.rateLimit.findUnique({ where: { key: 'audit-test-old' } })
    expect(pruned).toBeNull()
  })

  test('razorpay webhook: amount/currency mismatch → 409, order stays pending', async () => {
    if (!testProduct) throw new Error('no product')
    const order = await db.order.create({
      data: { productId: testProduct.id, customerName: 'Mismatch Test', customerEmail: 'mismatch-test@sibra.local', amountInr: 499, status: 'pending', gateway: 'razorpay', currency: 'INR', amountMinor: 49900, billingCountry: 'IN', razorpayPaymentLinkId: 'plink_audit_mismatch' },
    })
    await trackOrder(order.id)
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_audit_mismatch_1', amount: 100, currency: 'INR', notes: { orderRef: order.id } } } } })
    const res = await fetch(`${BASE}/api/razorpay/webhook`, { method: 'POST', headers: { ...signedRazorpay(body), 'x-razorpay-event-id': `audit-test-mismatch-${crypto.randomUUID()}` }, body })
    expect(res.status).toBe(409)
    const fresh = await db.order.findUnique({ where: { id: order.id }, select: { status: true } })
    expect(fresh?.status).toBe('pending')
  })

  test('razorpay webhook: refund.processed falls back to payment_id when notes are missing', async () => {
    if (!testProduct) throw new Error('no product')
    const order = await db.order.create({
      data: { productId: testProduct.id, customerName: 'Refund Fallback Test', customerEmail: 'refund-fb@sibra.local', amountInr: 499, status: 'paid', razorpayPaymentId: 'pay_audit_refund_fb_1' },
    })
    await trackOrder(order.id)
    const body = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfn_audit_fb_1', payment_id: 'pay_audit_refund_fb_1' } } } })
    const res = await fetch(`${BASE}/api/razorpay/webhook`, { method: 'POST', headers: { ...signedRazorpay(body), 'x-razorpay-event-id': `audit-test-refund-fb-${crypto.randomUUID()}` }, body })
    expect(res.status).toBe(200)
    const fresh = await db.order.findUnique({ where: { id: order.id }, select: { status: true, tokenExpiresAt: true } })
    expect(fresh?.status).toBe('refunded')
    expect(fresh?.tokenExpiresAt?.getTime()).toBeLessThanOrEqual(Date.now())
  })

  test('razorpay webhook: truly unmatched refund answers 200 unmatched (no crash)', async () => {
    const body = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfn_audit_none', payment_id: 'pay_audit_unknown' } } } })
    const res = await fetch(`${BASE}/api/razorpay/webhook`, { method: 'POST', headers: { ...signedRazorpay(body), 'x-razorpay-event-id': `audit-test-refund-none-${crypto.randomUUID()}` }, body })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { unmatched?: boolean }
    expect(json.unmatched).toBe(true)
  })

  test('POST /api/razorpay/verify is rate-limited (was an unthrottled gateway-fetch amplifier)', async () => {
    let saw429 = false
    for (let i = 0; i < 25; i++) {
      const res = await fetch(`${BASE}/api/razorpay/verify`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-key': INTERNAL_KEY }, body: '{}' })
      if (res.status === 429) {
        saw429 = true
        break
      }
    }
    expect(saw429).toBeTrue()
  })
})

// ═══════════════════════════════════════════════════════════
// Security RE-AUDIT regressions (B4 concurrency + outbox lease)
// ═══════════════════════════════════════════════════════════
describe('checkout concurrency (re-audit B4)', () => {
  test('parallel creates for one email+product yield ONE order and ONE gateway session', async () => {
    if (!testProduct) throw new Error('no product')
    const { createCheckout } = await import('@/services/checkout-service')
    const email = `parallel-${crypto.randomUUID()}@sibra.local`
    const input = {
      productId: testProduct.id,
      customerName: 'Parallel Test',
      customerEmail: email,
      country: 'IN',
      consent: true as const,
    }
    // The loser of the gateway-session claim polls (600 ms ticks) for the
    // winner's ref — give the test more headroom than bun's 5 s default.
    const [a, b] = await Promise.all([
      createCheckout(input, { ipCountry: null, visitorCookie: null }),
      createCheckout(input, { ipCountry: null, visitorCookie: null }),
    ])
    // Open-order reuse is serialized — both responses are the SAME order.
    expect(a.order.id).toBe(b.order.id)
    const orders = await db.order.findMany({ where: { customerEmail: email } })
    expect(orders).toHaveLength(1)
    await trackOrder(a.order.id)
    // Exactly ONE gateway session was started for it (no double charge attempt).
    const attempts = await db.paymentAttempt.findMany({ where: { orderId: a.order.id, status: 'CREATED' } })
    expect(attempts).toHaveLength(1)
    expect(orders[0]?.razorpayOrderId ?? null).toBe(a.razorpay?.orderId ?? null)
    expect(b.razorpay?.orderId ?? null).toBe(a.razorpay?.orderId ?? null)
    expect(a.razorpay?.orderId?.startsWith('order_mock_')).toBeTrue()
  }, 20_000)

  test('repeat purchase is enforced under concurrency (409 REPEAT_PURCHASE for every parallel create)', async () => {
    if (!testProduct) throw new Error('no product')
    const { ApiError } = await import('@/lib/api')
    const { createCheckout } = await import('@/services/checkout-service')
    const email = `repeat-${crypto.randomUUID()}@sibra.local`
    const paid = await db.order.create({
      data: {
        productId: testProduct.id,
        customerName: 'Repeat Test',
        customerEmail: email,
        amountInr: 499,
        status: 'paid',
        gateway: 'razorpay',
        currency: 'INR',
        amountMinor: 49900,
      },
    })
    await trackOrder(paid.id)
    const input = {
      productId: testProduct.id,
      customerName: 'Repeat Test',
      customerEmail: email,
      country: 'IN',
      consent: true as const,
    }
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => createCheckout(input, { ipCountry: null, visitorCookie: null })),
    )
    for (const r of results) {
      expect(r.status).toBe('rejected')
      const err = (r as PromiseRejectedResult).reason as { code?: string }
      expect(err.code).toBe('REPEAT_PURCHASE')
    }
    // Not a single extra order slipped through the check-then-act window.
    const orders = await db.order.findMany({ where: { customerEmail: email } })
    expect(orders).toHaveLength(1)
  })
})

describe('outbox lease (re-audit: concurrent cron cannot double-send)', () => {
  test('only one of two parallel leases wins; the loser must skip the send', async () => {
    const { leaseOutboxRow } = await import('@/app/api/cron/retry-emails/route')
    const order = await db.order.create({
      data: {
        productId: (testProduct ?? (await db.product.findFirst({ where: { status: 'published' } })))!.id,
        customerName: 'Lease Test',
        customerEmail: `lease-${crypto.randomUUID()}@sibra.local`,
        amountInr: 0,
        status: 'paid',
      },
    })
    await trackOrder(order.id)
    await db.emailOutbox.create({
      data: { orderId: order.id, template: 'delivery', status: 'FAILED', attempts: 1, nextAttemptAt: new Date(Date.now() - 1000) },
    })
    const [a, b] = await Promise.all([leaseOutboxRow(order.id, 'delivery'), leaseOutboxRow(order.id, 'delivery')])
    expect([a, b].sort((x, y) => x - y)).toEqual([0, 1])
  })
})

// ═══════════════════════════════════════════════════════════
// Payment-audit fixes — regression tests for THIS audit round.
// Each test fails against the pre-fix code.
// ═══════════════════════════════════════════════════════════
describe('payment-audit fixes (this audit)', () => {
  test('demo checkout: the create AFTER a demo create reuses the same open order (no stuck session claim)', async () => {
    if (!testProduct) throw new Error('no product')
    const email = `demo-reuse-${crypto.randomUUID()}@sibra.local`
    const body = JSON.stringify({ productId: testProduct.id, customerName: 'Demo Reuse', customerEmail: email, country: 'IN', consent: true })
    const first = await api('/api/checkout/create', {
      method: 'POST',
      headers: { 'Idempotency-Key': `audit-fix-${crypto.randomUUID()}` },
      body,
    })
    expect(first.status).toBe(201)
    const firstId = (first.body.order as { id: string }).id
    await trackOrder(firstId)
    // Pre-fix this call waited out SESSION_WAIT_MS (15 s) on the leftover
    // `starting:` marker and answered 502 GATEWAY_UNAVAILABLE.
    const second = await api('/api/checkout/create', {
      method: 'POST',
      headers: { 'Idempotency-Key': `audit-fix-${crypto.randomUUID()}` },
      body,
    })
    expect(second.status).toBe(201)
    expect((second.body.order as { id: string }).id).toBe(firstId)
    // The SAME Razorpay order is resumed (never a second session).
    expect((second.body.razorpay as { orderId: string }).orderId).toBe((first.body.razorpay as { orderId: string }).orderId)
    const row = await db.order.findUnique({ where: { id: firstId }, select: { razorpayOrderId: true } })
    expect(row?.razorpayOrderId).toStartWith('order_mock_')
  }, 20_000)

  test('price drift: an open order is replaced (old expired) when the product price changes', async () => {
    if (!testProduct) throw new Error('no product')
    const product = await db.product.findUnique({ where: { id: testProduct.id }, select: { priceInr: true } })
    if (!product) throw new Error('product vanished')
    const originalPrice = product.priceInr
    const newPrice = originalPrice === 499 ? 599 : 499
    const email = `drift-${crypto.randomUUID()}@sibra.local`
    const body = (key: string) => ({
      method: 'POST' as const,
      headers: { 'Idempotency-Key': `audit-drift-${key}` },
      body: JSON.stringify({ productId: testProduct!.id, customerName: 'Drift Test', customerEmail: email, country: 'IN', consent: true }),
    })
    try {
      const first = await api('/api/checkout/create', body(`1-${crypto.randomUUID()}`))
      expect(first.status).toBe(201)
      const oldId = (first.body.order as { id: string }).id
      await trackOrder(oldId)
      expect(first.body.amountMinor).toBe(originalPrice * 100)

      await db.product.update({ where: { id: testProduct!.id }, data: { priceInr: newPrice } })
      const second = await api('/api/checkout/create', body(`2-${crypto.randomUUID()}`))
      expect(second.status).toBe(201)
      const newId = (second.body.order as { id: string }).id
      await trackOrder(newId)
      // A NEW order at the NEW price — the stale one cannot be paid anymore.
      expect(newId).not.toBe(oldId)
      expect(second.body.amountMinor).toBe(newPrice * 100)
      const oldRow = await db.order.findUnique({ where: { id: oldId }, select: { status: true } })
      const newRow = await db.order.findUnique({ where: { id: newId }, select: { status: true, amountMinor: true } })
      expect(oldRow?.status).toBe('failed')
      expect(newRow?.amountMinor).toBe(newPrice * 100)
    } finally {
      await db.product.update({ where: { id: testProduct!.id }, data: { priceInr: originalPrice } })
    }
  }, 20_000)

  test('razorpay webhook: a duplicate event id is a no-op (no second fulfilment)', async () => {
    if (!testProduct) throw new Error('no product')
    const order = await db.order.create({
      data: {
        productId: testProduct.id,
        customerName: 'Webhook Dup Test',
        customerEmail: `webhook-dup-${crypto.randomUUID()}@sibra.local`,
        amountInr: 499,
        status: 'pending',
        gateway: 'razorpay',
        currency: 'INR',
        amountMinor: 49900,
        billingCountry: 'IN',
      },
    })
    await trackOrder(order.id)
    const eventId = `audit-test-dup-${crypto.randomUUID()}`
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: { entity: { id: `pay_dup_${crypto.randomUUID().slice(0, 8)}`, amount: 49900, currency: 'INR', notes: { orderRef: order.id } } },
      },
    })
    const headers = { ...signedRazorpay(body), 'x-razorpay-event-id': eventId }
    const first = await fetch(`${BASE}/api/razorpay/webhook`, { method: 'POST', headers, body })
    expect(first.status).toBe(200)
    const second = await fetch(`${BASE}/api/razorpay/webhook`, { method: 'POST', headers, body })
    expect(second.status).toBe(200)
    expect(((await second.json()) as { duplicate?: boolean }).duplicate).toBe(true)
    // Exactly one token, one outbox row despite the redelivery.
    const fresh = await db.order.findUnique({ where: { id: order.id } })
    expect(fresh?.status).toBe('paid')
    const outbox = await db.emailOutbox.findMany({ where: { orderId: order.id } })
    expect(outbox).toHaveLength(1)
    // The duplicate must be rejected by insert-first idempotency BEFORE any
    // processing — the recorded result stays 'fulfilled' from the first
    // delivery (a re-processed event would stamp it 'duplicate').
    const eventRow = await db.webhookEvent.findUnique({ where: { eventId } })
    expect(eventRow?.result).toBe('fulfilled')
  })

  test('checkout create: a reused Idempotency-Key with a different payload is rejected', async () => {
    if (!testProduct) throw new Error('no product')
    const key = `audit-idem-${crypto.randomUUID()}`
    const first = await api('/api/checkout/create', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ productId: testProduct.id, customerName: 'Idem Test', customerEmail: `idem-${crypto.randomUUID()}@sibra.local`, country: 'IN', consent: true }),
    })
    expect(first.status).toBe(201)
    // Leak hygiene: the 201 create made a REAL order — register it so
    // afterAll deletes it (this test used to leak one order per run).
    await trackOrder((first.body.order as { id: string }).id)
    const second = await api('/api/checkout/create', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ productId: testProduct.id, customerName: 'Idem Test DIFFERENT', customerEmail: `idem-${crypto.randomUUID()}@sibra.local`, country: 'US', consent: true }),
    })
    expect(second.status).toBe(409)
    expect(second.body.code).toBe('IDEMPOTENCY_KEY_REUSED')
  })

  test('download: repeated GETs never consume a slot — the POST claim does', async () => {
    if (!testProduct) throw new Error('no product')
    // Test hygiene (same as the download-contract test): fresh download
    // rate-limit bucket — back-to-back suite runs share the 30/min/IP key.
    await db.rateLimit.deleteMany({ where: { key: { startsWith: 'dl:ip:' } } }).catch(() => undefined)
    await db.rateLimit.deleteMany({ where: { key: { startsWith: 'checkout:demopay:' } } }).catch(() => undefined)
    const email = `dl-claim-${crypto.randomUUID()}@sibra.local`
    const create = await api('/api/checkout/create', {
      method: 'POST',
      headers: { 'Idempotency-Key': `audit-dl-${crypto.randomUUID()}` },
      body: JSON.stringify({ productId: testProduct.id, customerName: 'DL Claim', customerEmail: email, country: 'IN', consent: true }),
    })
    expect(create.status).toBe(201)
    const orderId = (create.body.order as { id: string }).id
    await trackOrder(orderId)
    const setCookie = create.headers.get('set-cookie') ?? ''
    const claimValue = /__Host-sdh_claim=([^;]+)/.exec(setCookie)?.[1] ?? ''
    const token = await fulfilForToken(orderId)
    expect(typeof token).toBe('string')

    // Email-scanner simulation: repeated GETs (SPA validate + prefetch) — free.
    for (let i = 0; i < 3; i++) {
      const validate = await api(`/api/download/${token}?mode=json`)
      expect(validate.status).toBe(200)
      expect(validate.body.ok).toBe(true)
      expect(validate.body.claimable).toBe(true)
      expect(validate.body.fileUrl).toBeUndefined()
    }
    let row = await db.order.findUnique({ where: { id: orderId }, select: { downloadCount: true } })
    expect(row?.downloadCount).toBe(0)

    // The claim: exactly the POST consumes one slot.
    const claimed = await api(`/api/download/${token}?mode=json`, { method: 'POST' })
    expect(claimed.status).toBe(200)
    expect(claimed.body.ok).toBe(true)
    expect(typeof claimed.body.fileUrl).toBe('string')
    row = await db.order.findUnique({ where: { id: orderId }, select: { downloadCount: true } })
    expect(row?.downloadCount).toBe(1)

    // And a later GET is STILL free (validation, not consumption).
    const again = await api(`/api/download/${token}?mode=json`)
    expect(again.status).toBe(200)
    row = await db.order.findUnique({ where: { id: orderId }, select: { downloadCount: true } })
    expect(row?.downloadCount).toBe(1)
  })

  test('download contract: 10 GETs never consume; exactly 5 POST claims succeed; the 6th is refused', async () => {
    if (!testProduct) throw new Error('no product')
    // Hermetic setup: the order is created DIRECTLY in the DB (paid + fresh
    // token) — no checkout/create call, so this test never consumes the
    // shared 10-per-15-min checkout rate-limit budget of the HTTP tests.
    // Test hygiene: fresh download rate-limit bucket (POST claims are limited 30/min/IP)
    // + the demo-pay bucket (20/5 min/IP) — back-to-back suite runs share them.
    await db.rateLimit.deleteMany({ where: { key: { startsWith: 'dl:ip:' } } }).catch(() => undefined)
    await db.rateLimit.deleteMany({ where: { key: { startsWith: 'checkout:demopay:' } } }).catch(() => undefined)
    const plain = `dl-contract-${crypto.randomUUID().replace(/-/g, '')}`
    const order = await db.order.create({
      data: {
        productId: testProduct.id,
        customerName: 'DL Contract',
        customerEmail: `dl-contract-${crypto.randomUUID()}@sibra.local`,
        amountInr: 199,
        status: 'paid',
        downloadTokenHash: hashToken(plain),
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      },
    })
    await trackOrder(order.id)
    const token = plain
    expect(token.length).toBeGreaterThanOrEqual(16)

    const count = async (): Promise<number> =>
      (await db.order.findUnique({ where: { id: order.id }, select: { downloadCount: true } }))?.downloadCount ?? -1

    // §2.7: 10 GET validations (email scanners, prefetchers, SPA polls) — all free.
    for (let i = 0; i < 10; i++) {
      const res = await api(`/api/download/${token}?mode=json`)
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(res.body.claimable).toBe(true)
      expect(res.body.fileUrl).toBeUndefined()
    }
    expect(await count()).toBe(0)

    // Exactly 5 claims succeed (DOWNLOAD_MAX_DEFAULT = 5) — one slot each.
    for (let i = 1; i <= 5; i++) {
      const res = await api(`/api/download/${token}?mode=json`, { method: 'POST' })
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(typeof res.body.fileUrl).toBe('string')
      expect(await count()).toBe(i)
    }

    // The 6th claim is refused — cap reached, count unchanged.
    const sixth = await api(`/api/download/${token}?mode=json`, { method: 'POST' })
    expect(sixth.status).toBe(429)
    expect(sixth.body.ok).toBe(false)
    expect(String(sixth.body.error)).toContain('Download limit reached (5)')
    expect(await count()).toBe(5)

    // GET still only VALIDATES after the cap (429 state) — never consumes.
    const validate = await api(`/api/download/${token}?mode=json`)
    expect(validate.status).toBe(429)
    expect(validate.body.ok).toBe(false)
    expect(validate.body.claimable).toBeUndefined()
    expect(await count()).toBe(5)
  })

  test('download: browser-facing GET redirect lands on the SITE origin, not the API origin', async () => {
    if (!testProduct) throw new Error('no product')
    const email = `dl-redir-${crypto.randomUUID()}@sibra.local`
    const create = await api('/api/checkout/create', {
      method: 'POST',
      headers: { 'Idempotency-Key': `audit-dlr-${crypto.randomUUID()}` },
      body: JSON.stringify({ productId: testProduct.id, customerName: 'DL Redirect', customerEmail: email, country: 'IN', consent: true }),
    })
    expect(create.status).toBe(201)
    const orderId = (create.body.order as { id: string }).id
    await trackOrder(orderId)
    const token = await fulfilForToken(orderId)

    // Non-JSON GET (success-button click / email link / bookmark) → 302 to
    // the SPA page on the SITE origin (NEXT_PUBLIC_SITE_URL/PUBLIC_WEB_URL).
    // The API origin serves no SPA, so a req.url-based redirect 404s for the
    // buyer (regression: split frontend/backend topology).
    const res = await fetch(`${BASE}/api/download/${token}`, { redirect: 'manual', headers: { 'x-internal-key': INTERNAL_KEY } })
    expect(res.status).toBe(302)
    const loc = res.headers.get('location') ?? ''
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.PUBLIC_WEB_URL
    const expectedOrigin = siteUrl ? new URL(siteUrl).origin : new URL(BASE).origin
    const parsed = new URL(loc)
    expect(parsed.origin).toBe(expectedOrigin)
    expect(`${parsed.pathname}${parsed.hash}`).toBe(`/#/download/${token}`)
  })

  test('admin token extend can no longer resurrect a revoked order to paid', async () => {
    const adminEmail = process.env.CONTRACT_ADMIN_EMAIL
    const adminPassword = process.env.CONTRACT_ADMIN_PASSWORD
    if (!adminEmail || !adminPassword) {
      console.log('skipping token-route guard test — CONTRACT_ADMIN_EMAIL/PASSWORD not set')
      return
    }
    const login = await fetch(`${BASE}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    })
    if (!login.ok) {
      console.log('skipping token-route guard test — admin login failed')
      return
    }
    const adminCookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
    if (!testProduct) throw new Error('no product')
    const order = await db.order.create({
      data: {
        productId: testProduct.id,
        customerName: 'Revoke Test',
        customerEmail: `revoke-${crypto.randomUUID()}@sibra.local`,
        amountInr: 199,
        status: 'paid',
        downloadTokenHash: hashToken('audit-revoke-plain-token-0000000000'),
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      },
    })
    await trackOrder(order.id)
    await mintGrantForOrder(order.id, 'audit-revoke-plain-token-0000000000', 48, 2)

    const revoke = await api(`/api/orders/${order.id}/token`, { method: 'PATCH', headers: { cookie: adminCookie }, body: JSON.stringify({ action: 'revoke' }) })
    expect(revoke.status).toBe(200)
    // The revoke response must not leak the token hash.
    expect(JSON.stringify(revoke.body)).not.toContain('downloadTokenHash')
    // Revoke now also revokes the watch entitlement.
    const grant = await db.watchGrant.findUnique({ where: { orderId: order.id } })
    expect(grant?.revokedAt).not.toBeNull()

    // THE FIX: extend on a revoked order must NOT flip it back to paid.
    const extend = await api(`/api/orders/${order.id}/token`, { method: 'PATCH', headers: { cookie: adminCookie }, body: JSON.stringify({ action: 'extend' }) })
    expect(extend.status).toBe(409)
    const after = await db.order.findUnique({ where: { id: order.id }, select: { status: true } })
    expect(after?.status).toBe('revoked')
  })
})

// ═══════════════════════════════════════════════════════════
// Payment fixes P1–P6 — end-to-end regressions against the
// live dev backend + real Postgres (webhook paths signed).
// ═══════════════════════════════════════════════════════════
describe('payment fixes P1–P6', () => {
  /** The 10-per-15-min checkout bucket is shared by the whole file — clear it before each create here. */
  async function clearCheckoutLimits(): Promise<void> {
    await db.rateLimit.deleteMany({ where: { key: { startsWith: 'checkout:' } } }).catch(() => undefined)
  }

  test('P1: legacy POST /api/orders is 410-Gone and calling it twice never creates orders', async () => {
    const before = await db.order.count()
    for (let i = 0; i < 2; i++) {
      const res = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ productId: testProduct?.id ?? 'any', customerName: 'Legacy Probe', customerEmail: `legacy-${crypto.randomUUID()}@sibra.local` }),
      })
      expect(res.status).toBe(410)
      expect(res.body.code).toBe('LEGACY_CHECKOUT_RETIRED')
    }
    expect(await db.order.count()).toBe(before)
  })

  test('P1: checkout v2 remains the only create path — confirmed country + stored consentAt', async () => {
    if (!testProduct) throw new Error('no product')
    await clearCheckoutLimits()
    const create = await api('/api/checkout/create', {
      method: 'POST',
      headers: { 'Idempotency-Key': `p1-${crypto.randomUUID()}` },
      body: JSON.stringify({ productId: testProduct.id, customerName: 'Consent Test', customerEmail: `consent-${crypto.randomUUID()}@sibra.local`, country: 'IN', consent: true }),
    })
    expect(create.status).toBe(201)
    const id = (create.body.order as { id: string }).id
    await trackOrder(id)
    const row = await db.order.findUnique({ where: { id }, select: { consentAt: true, currency: true, gateway: true, billingCountry: true } })
    expect(row?.consentAt).not.toBeNull()
    expect(row?.currency).toBe('INR')
    expect(row?.gateway).toBe('razorpay')
    expect(row?.billingCountry).toBe('IN')
  })

  test('P3: redelivery after a failed run re-processes — order PAID exactly once, one token, one email', async () => {
    if (!testProduct) throw new Error('no product')
    const order = await db.order.create({
      data: {
        productId: testProduct.id,
        customerName: 'Reprocess Test',
        customerEmail: `reprocess-${crypto.randomUUID()}@sibra.local`,
        amountInr: 499,
        status: 'pending',
        gateway: 'razorpay',
        currency: 'INR',
        amountMinor: 49900,
        billingCountry: 'IN',
      },
    })
    await trackOrder(order.id)
    const eventId = `audit-test-p3-${crypto.randomUUID()}`
    // Simulate the previous crash/500: the row was inserted but processing failed.
    await db.webhookEvent.create({ data: { eventId, gateway: 'razorpay', type: 'payment.captured', result: 'failed' } })
    const paymentId = `pay_p3_${crypto.randomUUID().slice(0, 8)}`
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: paymentId, amount: 49900, currency: 'INR', notes: { orderRef: order.id } } } },
    })
    const first = await fetch(`${BASE}/api/razorpay/webhook`, { method: 'POST', headers: { ...signedRazorpay(body), 'x-razorpay-event-id': eventId }, body })
    expect(first.status).toBe(200)
    const paid = await db.order.findUnique({ where: { id: order.id } })
    expect(paid?.status).toBe('paid')
    expect(paid?.razorpayPaymentId).toBe(paymentId)
    expect(paid?.downloadTokenHash).toBeTruthy()
    const outbox = await db.emailOutbox.findMany({ where: { orderId: order.id } })
    expect(outbox).toHaveLength(1)
    const eventRow = await db.webhookEvent.findUnique({ where: { eventId } })
    expect(eventRow?.result).toBe('fulfilled')

    // A further redelivery is a terminal duplicate — nothing changes.
    const second = await fetch(`${BASE}/api/razorpay/webhook`, { method: 'POST', headers: { ...signedRazorpay(body), 'x-razorpay-event-id': eventId }, body })
    expect(second.status).toBe(200)
    expect(((await second.json()) as { duplicate?: boolean }).duplicate).toBe(true)
    expect(await db.emailOutbox.count({ where: { orderId: order.id } })).toBe(1)
    const still = await db.order.findUnique({ where: { id: order.id }, select: { downloadTokenHash: true } })
    expect(still?.downloadTokenHash).toBe(paid?.downloadTokenHash) // one token, never re-minted
  })

  test('P5: capture on an unfulfillable order → 409 + PAID_BUT_NOT_DELIVERED flag + admin alert (no auto refund)', async () => {
    if (!testProduct) throw new Error('no product')
    const order = await db.order.create({
      data: {
        productId: testProduct.id,
        customerName: 'Undeliverable Test',
        customerEmail: `undeliv-${crypto.randomUUID()}@sibra.local`,
        amountInr: 499,
        status: 'failed', // expired/cancelled — cannot be fulfilled
        gateway: 'razorpay',
        currency: 'INR',
        amountMinor: 49900,
        billingCountry: 'IN',
      },
    })
    await trackOrder(order.id)
    const eventId = `audit-test-p5-${crypto.randomUUID()}`
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: `pay_p5_${crypto.randomUUID().slice(0, 8)}`, amount: 49900, currency: 'INR', notes: { orderRef: order.id } } } },
    })
    const res = await fetch(`${BASE}/api/razorpay/webhook`, { method: 'POST', headers: { ...signedRazorpay(body), 'x-razorpay-event-id': eventId }, body })
    expect(res.status).toBe(409)
    const row = await db.order.findUnique({ where: { id: order.id }, select: { status: true, riskFlags: true } })
    expect(row?.status).toBe('failed') // NO auto fulfilment, NO auto refund
    expect(row?.riskFlags.filter((f) => f === 'PAID_BUT_NOT_DELIVERED')).toHaveLength(1)
    const alerts = await db.emailLog.findMany({ where: { subject: { contains: 'Payment captured but NOT delivered' } } })
    expect(alerts.length).toBe(1)
    // Redelivery: result is terminal → duplicate no-op, no second alert/flag.
    const again = await fetch(`${BASE}/api/razorpay/webhook`, { method: 'POST', headers: { ...signedRazorpay(body), 'x-razorpay-event-id': eventId }, body })
    expect(again.status).toBe(200)
    expect(((await again.json()) as { duplicate?: boolean }).duplicate).toBe(true)
    const row2 = await db.order.findUnique({ where: { id: order.id }, select: { riskFlags: true } })
    expect(row2?.riskFlags.filter((f) => f === 'PAID_BUT_NOT_DELIVERED')).toHaveLength(1)
    expect(await db.emailLog.count({ where: { subject: { contains: 'Payment captured but NOT delivered' } } })).toBe(1)
  })

  test('P5: a gateway session that cannot be stored is retried, logged and marked (order unreusable)', async () => {
    if (!testProduct) throw new Error('no product')
    const order = await db.order.create({
      data: {
        productId: testProduct.id,
        customerName: 'Unstored Test',
        customerEmail: `unstored-${crypto.randomUUID()}@sibra.local`,
        amountInr: 499,
        status: 'pending',
        gateway: 'razorpay',
        currency: 'INR',
        amountMinor: 49900,
        billingCountry: 'IN',
        razorpayOrderId: `starting:${'x'.repeat(20)}`, // the claim marker
      },
    })
    await trackOrder(order.id)
    // Inject DB failures for the first 3 store attempts (the retry budget).
    const original = db.order.updateMany.bind(db.order)
    let failures = 0
    type UpdateManyArgs = Parameters<typeof original>
    const broken = db.order as unknown as { updateMany: (...args: UpdateManyArgs) => Promise<Awaited<ReturnType<typeof original>>> }
    broken.updateMany = async (...args: UpdateManyArgs) => {
      failures += 1
      if (failures <= 3) throw new Error('injected db outage')
      return original(...args)
    }
    let stored: boolean
    try {
      stored = await storeGatewaySession(order.id, 'razorpay', 'order_mock_P5_TEST')
    } finally {
      broken.updateMany = original
    }
    expect(stored).toBeFalse()
    expect(failures).toBeGreaterThanOrEqual(3)
    const row = await db.order.findUnique({ where: { id: order.id }, select: { riskFlags: true } })
    expect(row?.riskFlags).toContain(GATEWAY_SESSION_UNSTORED)
    const attempt = await db.paymentAttempt.findFirst({ where: { orderId: order.id, status: 'SESSION_UNSTORED' } })
    expect(attempt?.gatewayOrderId).toBe('order_mock_P5_TEST')
  })

  test('P5: checkout create never reuses a GATEWAY_SESSION_UNSTORED order (no second payable session on it)', async () => {
    if (!testProduct) throw new Error('no product')
    const email = `unstored-reuse-${crypto.randomUUID()}@sibra.local`
    const flagged = await db.order.create({
      data: {
        productId: testProduct.id,
        customerName: 'Unstored Reuse',
        customerEmail: email,
        amountInr: 499,
        status: 'pending',
        gateway: 'razorpay',
        currency: 'INR',
        amountMinor: 49900,
        billingCountry: 'IN',
        riskFlags: [GATEWAY_SESSION_UNSTORED],
      },
    })
    await trackOrder(flagged.id)
    await clearCheckoutLimits()
    const create = await api('/api/checkout/create', {
      method: 'POST',
      headers: { 'Idempotency-Key': `p5-${crypto.randomUUID()}` },
      body: JSON.stringify({ productId: testProduct.id, customerName: 'Unstored Reuse', customerEmail: email, country: 'IN', consent: true }),
    })
    expect(create.status).toBe(201)
    const newId = (create.body.order as { id: string }).id
    await trackOrder(newId)
    expect(newId).not.toBe(flagged.id) // a FRESH order, not a second session on the flagged one
    const still = await db.order.findUnique({ where: { id: flagged.id }, select: { status: true, razorpayOrderId: true } })
    expect(still?.status).toBe('pending') // webhook/reconcile can still heal the orphan session
  })

  test('P4: both cron runs record heartbeats (Admin → System freshness source)', async () => {
    const rec = await api('/api/cron/reconcile-payments')
    expect(rec.status).toBe(200)
    const beat1 = await db.cronHeartbeat.findUnique({ where: { key: RECONCILE_HEARTBEAT_KEY } })
    expect(beat1).not.toBeNull()
    expect(Date.now() - (beat1?.lastSuccessAt?.getTime() ?? 0)).toBeLessThan(10_000)
    const rem = await api('/api/cron/retry-emails')
    expect(rem.status).toBe(200)
    const beat2 = await db.cronHeartbeat.findUnique({ where: { key: 'retry-emails' } })
    expect(beat2).not.toBeNull()
    expect(Date.now() - (beat2?.lastSuccessAt?.getTime() ?? 0)).toBeLessThan(10_000)
  })

  test('P4: reconcile silence >2h fires ONE alert (suppressed) from the buddy cron', async () => {
    const stale = new Date(Date.now() - 3 * 3600_000)
    await db.cronHeartbeat.upsert({
      where: { key: RECONCILE_HEARTBEAT_KEY },
      create: { key: RECONCILE_HEARTBEAT_KEY, lastSuccessAt: stale },
      update: { lastSuccessAt: stale, staleAlertedAt: null },
    })
    const first = await api('/api/cron/retry-emails')
    expect(first.status).toBe(200)
    expect(await db.emailLog.count({ where: { subject: { contains: 'Payment reconciliation has not run' } } })).toBe(1)
    const row = await db.cronHeartbeat.findUnique({ where: { key: RECONCILE_HEARTBEAT_KEY } })
    expect(row?.staleAlertedAt).not.toBeNull()
    // Second run inside the suppression window: no duplicate alert.
    await api('/api/cron/retry-emails')
    expect(await db.emailLog.count({ where: { subject: { contains: 'Payment reconciliation has not run' } } })).toBe(1)
    // Restore a healthy heartbeat for later tests.
    await db.cronHeartbeat.update({ where: { key: RECONCILE_HEARTBEAT_KEY }, data: { lastSuccessAt: new Date(), staleAlertedAt: null } })
  })

  test('P4: reconcile still fulfils a paid order whose webhook was lost (Razorpay mock)', async () => {
    if (!testProduct) throw new Error('no product')
    // The local mock Razorpay holds the order + its captured payment; the
    // local row only knows the razorpayOrderId — the webhook never arrived.
    const created = await fetch(`${MOCK_BASE}/v1/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount: 49900, currency: 'INR', receipt: 'reconcile_test', notes: {} }),
    })
    const rzpOrder = (await created.json()) as { id: string }
    await fetch(`${MOCK_BASE}/__mock__/pay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: rzpOrder.id, amount: 49900, currency: 'INR', method: 'card' }),
    })
    const order = await db.order.create({
      data: {
        productId: testProduct.id,
        customerName: 'Lost Webhook Test',
        customerEmail: `lost-webhook-${crypto.randomUUID()}@sibra.local`,
        amountInr: 499,
        status: 'pending',
        gateway: 'razorpay',
        currency: 'INR',
        amountMinor: 49900,
        billingCountry: 'IN',
        razorpayOrderId: rzpOrder.id,
        createdAt: new Date(Date.now() - 11 * 60_000), // inside the cron sweep window
      },
    })
    await trackOrder(order.id)
    // The sweep runs in-process (the mock is reachable at RAZORPAY_API_BASE);
    // the HTTP route + heartbeat are covered by the P4 heartbeat test.
    const { reconcilePendingBatch } = await import('@/services/reconcile-service')
    const results = await reconcilePendingBatch()
    const mine = results.find((r) => r.orderId === order.id)
    expect(mine?.action).toBe('fulfilled')
    const fresh = await db.order.findUnique({ where: { id: order.id }, select: { status: true, razorpayPaymentId: true, paymentMethod: true } })
    expect(fresh?.status).toBe('paid')
    expect(fresh?.razorpayPaymentId).toStartWith('pay_mock_')
    expect(fresh?.paymentMethod).toBe('card')
  })

  test('P6: international card on an IN order is blocked, flagged, and surfaced to the buyer', async () => {
    if (!testProduct) throw new Error('no product')
    const email = `intl-block-${crypto.randomUUID()}@sibra.local`
    await clearCheckoutLimits()
    const create = await api('/api/checkout/create', {
      method: 'POST',
      headers: { 'Idempotency-Key': `p6-${crypto.randomUUID()}` },
      body: JSON.stringify({ productId: testProduct.id, customerName: 'Intl Test', customerEmail: email, country: 'IN', consent: true }),
    })
    expect(create.status).toBe(201)
    const orderId = (create.body.order as { id: string }).id
    await trackOrder(orderId)
    const claimValue = /__Host-sdh_claim=([^;]+)/.exec(create.headers.get('set-cookie') ?? '')?.[1] ?? ''
    const row = await db.order.findUnique({ where: { id: orderId }, select: { amountMinor: true } })
    const amount = row?.amountMinor ?? 49900
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: `pay_p6_${crypto.randomUUID().slice(0, 8)}`, amount, currency: 'INR', international: true, notes: { orderRef: orderId } } } },
    })
    const res = await fetch(`${BASE}/api/razorpay/webhook`, { method: 'POST', headers: { ...signedRazorpay(body), 'x-razorpay-event-id': `audit-test-p6-${crypto.randomUUID()}` }, body })
    expect(res.status).toBe(409) // refused — no fulfilment
    const flagged = await db.order.findUnique({ where: { id: orderId }, select: { status: true, riskFlags: true } })
    expect(flagged?.status).toBe('pending')
    expect(flagged?.riskFlags).toContain('INTERNATIONAL_CARD_BLOCKED')
    // The claim-gated status route tells the buyer's dialog what happened.
    const status = await api(`/api/orders/${orderId}/status`, { headers: { cookie: `__Host-sdh_claim=${claimValue}` } })
    expect(status.status).toBe(200)
    expect((status.body.order as { paymentBlocked?: boolean }).paymentBlocked).toBe(true)
  })

  test('P5 sanity: markPaidButNotDelivered is idempotent (flag pushed once)', async () => {
    if (!testProduct) throw new Error('no product')
    const order = await db.order.create({
      data: {
        productId: testProduct.id,
        customerName: 'Flag Idem Test',
        customerEmail: `flag-idem-${crypto.randomUUID()}@sibra.local`,
        amountInr: 499,
        status: 'revoked',
      },
    })
    await trackOrder(order.id)
    const { markPaidButNotDelivered } = await import('@/services/order-service')
    await markPaidButNotDelivered(order.id, 'test call 1')
    await markPaidButNotDelivered(order.id, 'test call 2')
    const row = await db.order.findUnique({ where: { id: order.id }, select: { riskFlags: true } })
    expect(row?.riskFlags.filter((f) => f === 'PAID_BUT_NOT_DELIVERED')).toHaveLength(1)
  })
})
