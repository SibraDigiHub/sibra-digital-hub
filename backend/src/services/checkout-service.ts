// ═══════════════════════════════════════════════════════════
// Checkout v2 (dual payment §5.1) — quote, create, status.
//
// Server-authoritative end to end: gateway/currency/amount come
// from resolveGateway() + the DB product; the client sends only
// productId + customer details + CONFIRMED country.
//
//   • Idempotency-Key header → stored response replayed exactly;
//   • open-order reuse (same email+product+gateway ≤30 min);
//   • repeat-purchase guard (friendly "resend my link" path);
//   • risk flags: COUNTRY_MISMATCH (allowed, admin-visible);
//   • claim cookie set on every create response.
//
// Demo modes keep the shop fully usable without gateway keys:
//   razorpay without keys → 'demo' (UPI QR, India, existing pattern).
//   International orders require configured keys (real or local mock).
// ═══════════════════════════════════════════════════════════

import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api'
import { db } from '@/lib/db'
import { allowRepeatPurchase, internationalCheckoutEnabled, razorpayForeignCurrencies } from '@/config/env'
import { formatMinor } from '@/lib/money'
import { razorpayConfigured, createRazorpayOrder, fetchRazorpayOrder } from '@/lib/razorpay'
import { gatewayConfigFromEnv, normalizeCountry, resolveGateway } from '@/services/gateway-routing'
import { publicOrderDTO } from '@/services/order-service'
import { orderRepo, OrderWithProduct } from '@/repositories/order-repo'
import { writeAudit, maskEmail } from '@/lib/audit'
import { logger } from '@/lib/logger'

export const checkoutCreateSchema = z
  .object({
    productId: z.string().trim().min(1).max(80),
    customerName: z.string().trim().min(2, 'Please enter your name').max(80),
    customerEmail: z.string().trim().email('Please enter a valid email address').max(120),
    country: z.string().trim().length(2, 'Please confirm your billing country'),
    consent: z.literal(true),
  })
  .strict()

export type CheckoutCreateInput = z.infer<typeof checkoutCreateSchema>

export const quoteSchema = z.object({ productId: z.string().trim().min(1).max(80), country: z.string().trim().length(2) }).strict()

const OPEN_ORDER_WINDOW_MS = 30 * 60 * 1000
const MAX_PENDING_PER_EMAIL = 5
/** Marker proving a gateway session is being started for an order (crash-safe claim). */
const SESSION_STARTING = 'starting:'
/** How long a loser of the gateway-session claim waits for the winner's ref. */
const SESSION_WAIT_MS = 15_000
/** P5: order flag when a created gateway session could not be stored (mark for reconciliation). */
export const GATEWAY_SESSION_UNSTORED = 'GATEWAY_SESSION_UNSTORED'
/** P5: store retries before the order is marked GATEWAY_SESSION_UNSTORED. */
const SESSION_STORE_ATTEMPTS = 3

export interface QuoteResult {
  gateway: 'razorpay'
  currency: string
  amountMinor: number
  display: string
}

/** §5.1 quote — the exact total before paying. Creates nothing. */
export async function quoteCheckout(productId: string, country: string): Promise<QuoteResult> {
  const product = await productForCheckout(productId)
  const decision = resolveGateway(country, product, gatewayConfigFromEnv())
  if (!decision.ok) throw new ApiError(422, decision.message, decision.rejection)
  return {
    gateway: decision.gateway,
    currency: decision.currency,
    amountMinor: decision.amountMinor,
    display: formatMinor(decision.amountMinor, decision.currency),
  }
}

async function productForCheckout(productId: string) {
  const product = await db.product.findUnique({ where: { id: productId } })
  if (!product || product.status !== 'published') throw new ApiError(404, 'Product not found')
  return product
}

export type CheckoutPaymentMode = 'razorpay' | 'demo'

/** Public Standard Checkout options echoed to the browser (never a secret). */
export interface RazorpayCheckoutOptions {
  keyId: string
  orderId: string
  amount: number
  currency: string
  name: string
  description: string
  prefillName: string
  prefillEmail: string
  orderRef: string
}

export interface CheckoutCreateResult {
  order: ReturnType<typeof publicOrderDTO> & { gateway: string; currency: string; amountMinor: number | null; billingCountry: string | null }
  gateway: 'razorpay'
  currency: string
  amountMinor: number
  display: string
  paymentMode: CheckoutPaymentMode
  razorpay?: RazorpayCheckoutOptions
  upiId?: string
  upiPayeeName?: string
}

/** Load order with product through the existing repo (keeps DTO parity). */
function withGateway(order: OrderWithProduct) {
  const dto = publicOrderDTO(order)
  return {
    ...dto,
    gateway: order.gateway,
    currency: order.currency,
    amountMinor: order.amountMinor,
    billingCountry: order.billingCountry,
  }
}

/** Repeat-purchase guard (§2.3): a PAID, non-revoked order for the same email+product. */
async function assertNotRepeatPurchase(
  productId: string,
  email: string,
  tx: Prisma.TransactionClient | typeof db = db,
): Promise<void> {
  if (allowRepeatPurchase()) return
  const existing = await tx.order.findFirst({
    where: { productId, customerEmail: email, status: 'paid' },
    select: { id: true },
  })
  if (existing) {
    throw new ApiError(
      409,
      'You already own this product — check your inbox for the delivery email, or use "Resend my link" below.',
      'REPEAT_PURCHASE',
    )
  }
}

// ── TOCTOU guards (security re-audit B4) ────────────────────
// Check-then-act races (repeat purchase, pending cap, open-order
// reuse) are serialized with a per-email Postgres advisory lock, and
// the gateway session itself is claimed atomically on the order row
// so concurrent creates can never start a SECOND gateway order.

/** Prisma interactive-transaction client (the callback's first argument). */
type CheckoutTx = Parameters<Parameters<typeof db.$transaction>[0]>[0]

/**
 * Serialize checkout for one email: every writer takes the same
 * transaction-scoped advisory lock before its checks, so two parallel
 * requests can no longer both pass `assertNotRepeatPurchase` or both
 * miss the open-order reuse window. The callback MUST use the passed
 * `tx` — global-client queries inside the lock would deadlock the pool.
 */
async function withCheckoutLock<T>(email: string, fn: (tx: CheckoutTx) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${email})::bigint)`
    return fn(tx)
  })
}

type GatewayRefOrder = { id: string; razorpayOrderId: string | null; paypalOrderId: string | null }

function gatewayRef(order: GatewayRefOrder, _gateway: 'razorpay'): string | null {
  // Razorpay session refs live in razorpayOrderId (Orders API). The legacy
  // razorpayPaymentLinkId column keeps historical Payment-Link rows readable.
  return order.razorpayOrderId
}

/** True when the stored ref is a real gateway id (not the starting marker, not null). */
function hasRealGatewayRef(order: GatewayRefOrder, gateway: 'razorpay'): boolean {
  const ref = gatewayRef(order, gateway)
  return Boolean(ref) && !ref!.startsWith(SESSION_STARTING)
}

/** True when another request is currently starting the gateway session. */
function isSessionStarting(order: GatewayRefOrder, gateway: 'razorpay'): boolean {
  return Boolean(gatewayRef(order, gateway)?.startsWith(SESSION_STARTING))
}

/** Atomically claim the right to start the ONE gateway session for this order. */
async function claimGatewaySession(orderId: string, gateway: 'razorpay'): Promise<boolean> {
  const marker = `${SESSION_STARTING}${orderId}`
  const refCol = 'razorpayOrderId'
  // Claim ONLY from the empty state — a marker means another request is
  // already starting the session and must win the wait/poll path instead.
  const claimed = await db.order.updateMany({
    where: { id: orderId, [refCol]: null },
    data: { [refCol]: marker },
  })
  return claimed.count > 0
}

/**
 * Store the real gateway ref (only where the starting marker still is).
 * P5: a silent storage failure used to strand a PAYABLE gateway session
 * with no local reference. Now: retried, then loudly logged with the order
 * ref, flagged GATEWAY_SESSION_UNSTORED (reconcile + reuse-skip marker) and
 * reported — the caller answers 502 instead of handing out a second
 * payable session on the next attempt.
 * Returns true when the ref is durably stored.
 */
export async function storeGatewaySession(orderId: string, gateway: 'razorpay', ref: string): Promise<boolean> {
  const marker = `${SESSION_STARTING}${orderId}`
  const refCol = 'razorpayOrderId'
  for (let attempt = 1; attempt <= SESSION_STORE_ATTEMPTS; attempt++) {
    const stored = await db.order
      .updateMany({ where: { id: orderId, [refCol]: marker }, data: { [refCol]: ref } })
      .then((r) => r.count > 0)
      .catch(() => false)
    if (stored) return true
    await new Promise((r) => setTimeout(r, 250 * attempt))
  }
  logger.error({ orderId, gateway, gatewayRef: ref }, 'gateway session could not be stored — order marked for reconciliation')
  // Best-effort marks: if the DB is fully down these fail too, but the log
  // above always carries the order + gateway refs for manual recovery.
  await db.order
    .update({ where: { id: orderId }, data: { riskFlags: { push: GATEWAY_SESSION_UNSTORED } } })
    .catch(() => undefined)
  await db.paymentAttempt
    .create({ data: { orderId, gateway, gatewayOrderId: ref, status: 'SESSION_UNSTORED' } })
    .catch(() => undefined)
  await writeAudit({
    action: 'checkout.gateway_session_unstored',
    entity: 'order',
    entityId: orderId,
    diff: { gateway, gatewayRef: ref, reason: 'gateway session created but not stored — webhook/reconcile recovery only' },
  }).catch(() => undefined)
  return false
}

/** Clear a stale starting marker so a later request can claim the session. */
async function clearGatewaySession(orderId: string, gateway: 'razorpay'): Promise<void> {
  const marker = `${SESSION_STARTING}${orderId}`
  const refCol = 'razorpayOrderId'
  await db.order
    .updateMany({ where: { id: orderId, [refCol]: marker }, data: { [refCol]: null } })
    .catch(() => undefined)
}

/** Poll until the winner of the claim has stored its real gateway ref. */
async function waitForGatewayRef(
  orderId: string,
  gateway: 'razorpay',
): Promise<OrderWithProduct | null> {
  const deadline = Date.now() + SESSION_WAIT_MS
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 600))
    const order = await orderRepo.byId(orderId)
    if (!order) return null
    if (order.status !== 'pending') return order // fulfilled/expired meanwhile — surface it
    if (hasRealGatewayRef(order, gateway)) return order
    // The winner cleared its marker (start failed) — stop waiting; the
    // caller answers 502 and the next request can claim cleanly.
    if (!isSessionStarting(order, gateway)) return null
  }
  return null
}

function riskFlagsFor(billingCountry: string | null, ipCountry: string | null): string[] {
  if (billingCountry && ipCountry && normalizeCountry(ipCountry) && billingCountry !== normalizeCountry(ipCountry)) {
    return ['COUNTRY_MISMATCH']
  }
  return []
}

/** Upsert the Idempotency-Key row and return the previously stored response, if any. */
export async function replayIdempotent(key: string, requestHash: string): Promise<{ status: number; body: unknown } | null> {
  const existing = await db.idempotencyKey.findUnique({ where: { key } })
  if (!existing) return null
  if (existing.requestHash !== requestHash) {
    throw new ApiError(409, 'This Idempotency-Key was already used with a different payload.', 'IDEMPOTENCY_KEY_REUSED')
  }
  const stored = JSON.parse(existing.responseJson) as { status: number; body: unknown }
  return stored
}

export async function storeIdempotent(key: string, requestHash: string, status: number, body: unknown): Promise<void> {
  await db.idempotencyKey
    .create({ data: { key, requestHash, responseJson: JSON.stringify({ status, body }) } })
    .catch(() => undefined) // a lost race here only costs a replay — never fail checkout for it
}

/**
 * Create (or reuse) a checkout order and start the gateway payment.
 * Throws ApiError with stable codes; the ROUTE sets the claim cookie on
 * its own response (keep this function response-free).
 *
 * Concurrency (security re-audit B4): the repeat-purchase / pending-cap /
 * open-order-reuse checks run inside a per-email advisory lock, and the
 * gateway session is claimed exactly once per order — a concurrent twin
 * request resumes the SAME Razorpay order instead of creating a second
 * chargeable session.
 */
export async function createCheckout(
  input: CheckoutCreateInput,
  opts: { ipCountry: string | null; visitorCookie: string | null },
): Promise<CheckoutCreateResult> {
  const country = normalizeCountry(input.country)
  if (!country) throw new ApiError(422, 'Please confirm your billing country.', 'BAD_COUNTRY')

  const product = await productForCheckout(input.productId)
  const decision = resolveGateway(country, product, gatewayConfigFromEnv())
  if (!decision.ok) throw new ApiError(422, decision.message, decision.rejection)

  const email = input.customerEmail.toLowerCase()
  const order = await withCheckoutLock(email, async (tx) => {
    await assertNotRepeatPurchase(product.id, email, tx)
    const pending = await tx.order.count({ where: { customerEmail: email, status: 'pending' } })
    if (pending >= MAX_PENDING_PER_EMAIL) {
      throw new ApiError(429, 'Too many pending orders for this email. Complete a payment first.')
    }
    const reused = await tx.order.findFirst({
      where: {
        productId: product.id,
        customerEmail: email,
        status: 'pending',
        gateway: decision.gateway,
        createdAt: { gte: new Date(Date.now() - OPEN_ORDER_WINDOW_MS) },
        // P5: an order whose gateway session was created but never stored has
        // an unknown PAYABLE session out there — it must never be resumed (no
        // ref) nor reused as the base for a second session. Skip it: the
        // create falls through to a FRESH order, while webhook/cron
        // reconciliation still heals the orphan if the customer pays it.
        NOT: { riskFlags: { has: GATEWAY_SESSION_UNSTORED } },
      },
      include: { product: true },
      orderBy: { createdAt: 'desc' },
    })
    const orderFields = {
      productId: product.id,
      customerName: input.customerName.slice(0, 80),
      customerEmail: email,
      amountInr: decision.gateway === 'razorpay' ? product.priceInr : 0,
      status: 'pending',
      visitorId: opts.visitorCookie ?? null,
      gateway: decision.gateway,
      billingCountry: country,
      ipCountry: opts.ipCountry,
      currency: decision.currency,
      amountMinor: decision.amountMinor,
      riskFlags: riskFlagsFor(country, opts.ipCountry),
      consentAt: new Date(), // P1: the confirmed-country/terms moment is stored, not just validated
    }
    // Price-drift guard (§2.1): an open order is only resumable at the SAME
    // amount + currency it was created with. If the product price or the
    // gateway currency changed since creation, expire the stale order and
    // fall through to a fresh one — the old payment session must never be
    // payable at an amount that no longer matches the product.
    if (reused && (reused.currency !== decision.currency || reused.amountMinor !== decision.amountMinor)) {
      await tx.order.updateMany({ where: { id: reused.id, status: 'pending' }, data: { status: 'failed' } })
      await writeAudit({
        action: 'checkout.price_drift_replaced',
        entity: 'order',
        entityId: reused.id,
        label: maskEmail(email),
        diff: { oldAmountMinor: reused.amountMinor, newAmountMinor: decision.amountMinor, currency: decision.currency },
      })
      return tx.order.create({ data: orderFields, include: { product: true } })
    }
    if (reused) return reused
    return tx.order.create({ data: orderFields, include: { product: true } })
  })

  const base = {
    currency: decision.currency,
    amountMinor: decision.amountMinor,
    display: formatMinor(decision.amountMinor, decision.currency),
  }

  // A real gateway session already exists (30-min reuse window) — resume it.
  if (hasRealGatewayRef(order, decision.gateway)) {
    return resumeRazorpay(order, base)
  }

  // Another request is starting the session — wait for its ref, then resume.
  if (isSessionStarting(order, decision.gateway)) {
    const waited = await waitForGatewayRef(order.id, decision.gateway)
    if (!waited) {
      await clearGatewaySession(order.id, decision.gateway) // crashed winner — free the claim
      throw new ApiError(502, 'Could not start the payment right now — please try again.', 'GATEWAY_UNAVAILABLE')
    }
    return resumeRazorpay(waited, base)
  }

  // Claim the right to start the ONE gateway session for this order.
  if (!(await claimGatewaySession(order.id, decision.gateway))) {
    const waited = await waitForGatewayRef(order.id, decision.gateway)
    if (!waited) {
      await clearGatewaySession(order.id, decision.gateway)
      throw new ApiError(502, 'Could not start the payment right now — please try again.', 'GATEWAY_UNAVAILABLE')
    }
    return resumeRazorpay(waited, base)
  }

  try {
    const result = await startRazorpay(order, product, base)
    // Demo flows never start a real gateway session — release the claim so
    // the next create on this open order can proceed immediately (it used
    // to wait out SESSION_WAIT_MS and then answer 502: the stuck marker).
    if (result.paymentMode === 'demo') {
      await clearGatewaySession(order.id, decision.gateway)
    }
    return result
  } catch (e) {
    await clearGatewaySession(order.id, decision.gateway) // retryable — session never completed
    throw e
  }
}

type StartBase = { currency: string; amountMinor: number; display: string }

/** Checkout dialog display name/description (Standard Checkout options). */
function checkoutDisplay(product: { title: string }): { name: string; description: string } {
  return { name: 'Sibra Digital Hub', description: `Sibra Digital Hub — ${product.title}` }
}

/** Razorpay: real Order + Standard Checkout options when keys exist. Caller holds the session claim. */
async function startRazorpay(
  order: OrderWithProduct,
  product: { id: string; title: string },
  base: StartBase,
): Promise<CheckoutCreateResult> {
  if (razorpayConfigured()) {
    const created = await createRazorpayOrder({
      amountMinor: base.amountMinor,
      currency: base.currency,
      receipt: order.id,
      notes: { orderRef: order.id, orderId: order.id, productId: product.id, billingCountry: order.billingCountry ?? '' },
    })
    if (created.ok && created.razorpayOrderId) {
      // P5: an unstored session means an orphan PAYABLE order — answer 502
      // instead of returning 201 for a session the order cannot resume.
      if (!(await storeGatewaySession(order.id, 'razorpay', created.razorpayOrderId))) {
        throw new ApiError(502, 'Could not start the payment right now — please try again.', 'GATEWAY_UNAVAILABLE')
      }
      await db.paymentAttempt.create({
        data: { orderId: order.id, gateway: 'razorpay', gatewayOrderId: created.razorpayOrderId, status: 'CREATED' },
      })
      const display = checkoutDisplay(product)
      return {
        order: withGateway(order),
        gateway: 'razorpay',
        paymentMode: 'razorpay',
        razorpay: {
          keyId: process.env.RAZORPAY_KEY_ID as string,
          orderId: created.razorpayOrderId,
          amount: base.amountMinor,
          currency: base.currency,
          name: display.name,
          description: display.description,
          prefillName: order.customerName,
          prefillEmail: order.customerEmail,
          orderRef: order.id,
        },
        ...base,
      }
    }
    await db.paymentAttempt.create({
      data: { orderId: order.id, gateway: 'razorpay', status: 'FAILED', errorCode: created.code ?? created.error ?? 'order_failed' },
    })
    // Raw Razorpay errors never reach the buyer — a stable friendly 502 with
    // the internal code recorded on the attempt (migration plan §2.5).
    logger.warn({ orderId: order.id, code: created.code, status: created.status }, 'razorpay order creation failed')
    throw new ApiError(502, 'Could not start the payment right now — please try again.', 'GATEWAY_UNAVAILABLE')
  }
  // Key-less demo (dev/staging, India only): same UPI simulation the legacy
  // flow uses. International orders require configured keys (real or mock) —
  // the router already gates them behind INTERNATIONAL_CHECKOUT_ENABLED.
  const settings = await db.siteSetting.findMany({ where: { key: { in: ['upiId', 'upiPayeeName'] } } })
  return {
    order: withGateway(order),
    gateway: 'razorpay',
    paymentMode: 'demo',
    upiId: settings.find((s) => s.key === 'upiId')?.value || 'sibra@upi',
    upiPayeeName: settings.find((s) => s.key === 'upiPayeeName')?.value || 'Sibra Digital Hub',
    ...base,
  }
}

/**
 * Resume an existing Razorpay order (Standard Checkout re-opens the SAME
 * order id — never a second one). The order is re-fetched to confirm it is
 * still payable (not expired/cancelled) before handing the options back.
 */
async function resumeRazorpay(order: OrderWithProduct, base: StartBase): Promise<CheckoutCreateResult> {
  const rzpOrderId = order.razorpayOrderId as string
  if (!razorpayConfigured()) {
    // Keys were removed after the order was created (dev/staging edge):
    // India falls back to the UPI demo surface.
    const settings = await db.siteSetting.findMany({ where: { key: { in: ['upiId', 'upiPayeeName'] } } })
    return {
      order: withGateway(order),
      gateway: 'razorpay',
      paymentMode: 'demo',
      upiId: settings.find((s) => s.key === 'upiId')?.value || 'sibra@upi',
      upiPayeeName: settings.find((s) => s.key === 'upiPayeeName')?.value || 'Sibra Digital Hub',
      ...base,
    }
  }
  const fetched = await fetchRazorpayOrder(rzpOrderId)
  if (!fetched.ok) {
    throw new ApiError(502, 'Could not reopen your payment — please try again.', 'GATEWAY_UNAVAILABLE')
  }
  const display = checkoutDisplay({ title: order.product.title })
  return {
    order: withGateway(order),
    gateway: 'razorpay',
    paymentMode: 'razorpay',
    razorpay: {
      keyId: process.env.RAZORPAY_KEY_ID as string,
      orderId: rzpOrderId,
      amount: base.amountMinor,
      currency: base.currency,
      name: display.name,
      description: display.description,
      prefillName: order.customerName,
      prefillEmail: order.customerEmail,
      orderRef: order.id,
    },
    ...base,
  }
}

/** Gateway availability + public flags for GET /api/payments/config (no secrets). */
export function paymentsConfig() {
  return {
    razorpayConfigured: razorpayConfigured(),
    internationalEnabled: internationalCheckoutEnabled(),
    foreignCurrencies: razorpayForeignCurrencies(),
    enabledGateways: { razorpay: process.env.RAZORPAY_ENABLED !== 'false' },
  }
}
