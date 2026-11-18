// Order creation rules (instant-download checkout) + admin order list.
// T5: one idempotent fulfillOrder() shared by the verify route, the
// webhook and the demo-pay route — atomic paid-transition inside a
// transaction, token minted exactly once, email sent after commit.
import crypto from 'crypto'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api'
import { orderRepo, ORDER_PRODUCT_INCLUDE, OrderWithProduct } from '@/repositories/order-repo'
import { productRepo } from '@/repositories/product-repo'
import { razorpayConfigured, createRazorpayOrder } from '@/lib/razorpay'
import { generateToken } from '@/lib/delivery'
import { downloadTtlHours, revokeOnRefund, allowRepeatPurchase } from '@/config/env'
import { sendDeliveryEmail, sendWatchDeliveryEmail, emailDemoMode } from '@/lib/email'
import { sendPaymentAlert } from '@/lib/admin-alerts'
import { logEvent } from '@/lib/activity'
import { writeAudit, maskEmail } from '@/lib/audit'
import { mintGrantForOrder } from '@/services/watch-service'
import { db } from '@/lib/db'

export const createOrderSchema = z.object({
  productId: z.string().min(1),
  customerName: z.string().trim().min(2, 'Please enter your name').max(80),
  customerEmail: z.string().trim().email('Please enter a valid email address').max(120),
})

export type CreateOrderInput = z.infer<typeof createOrderSchema>

export type CreateOrderResult =
  | { mode: 'razorpay'; order: OrderWithProduct; razorpay: { orderId: string; amount: number; currency: string }; amountInr: number }
  | { mode: 'demo'; order: OrderWithProduct; upiId: string; upiPayeeName: string; amountInr: number }

const MAX_PENDING_PER_EMAIL = 5

export async function createOrder(input: CreateOrderInput, visitorCookie: string | null): Promise<CreateOrderResult> {
  const product = await productRepo.byId(input.productId)
  if (!product || product.status !== 'published') throw new ApiError(404, 'Product not found')
  if (!product.instantDownload) throw new ApiError(400, 'This product does not support instant download')
  // T-V: the deliverable depends on the delivery mode — download modes need
  // the file/link exactly as before; watch mode needs the protected full video.
  if (product.deliveryMode === 'watch') {
    if (!product.fullVideoUrl) throw new ApiError(409, 'Protected video not configured yet — contact support')
  } else if (!product.deliverableUrl) {
    throw new ApiError(409, 'Deliverable file not configured yet — contact support')
  }

  // Basic abuse guard: max 5 pending orders per email
  const pending = await orderRepo.countPendingByEmail(input.customerEmail)
  if (pending >= MAX_PENDING_PER_EMAIL) {
    throw new ApiError(429, 'Too many pending orders for this email. Complete a payment first.')
  }

  const email = input.customerEmail.toLowerCase().slice(0, 120)
  // Security re-audit B4: the legacy route gets the SAME concurrency
  // guarantees as checkout v2 — repeat-purchase (documented §2.3 policy)
  // is enforced under a per-email advisory lock, not just app-level checks.
  const order = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${email})::bigint)`
    if (!allowRepeatPurchase()) {
      const existing = await tx.order.findFirst({
        where: { productId: product.id, customerEmail: email, status: 'paid' },
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
    return tx.order.create({
      data: {
        productId: product.id,
        customerName: input.customerName.slice(0, 80),
        customerEmail: email,
        amountInr: product.priceInr,
        status: 'pending',
        visitorId: visitorCookie ?? null,
      },
      include: ORDER_PRODUCT_INCLUDE,
    })
  })

  if (razorpayConfigured()) {
    // Single-gateway migration: even the 410-gated legacy escape creates a
    // Razorpay ORDER now (Payment Links are retired) — the legacy dev flow
    // re-opens Standard Checkout with the same order id.
    const created = await createRazorpayOrder({
      amountMinor: Math.round(product.priceInr * 100),
      currency: 'INR',
      receipt: order.id,
      notes: { orderRef: order.id, orderId: order.id, productId: product.id, billingCountry: 'IN' },
    })
    if (created.ok && created.razorpayOrderId) {
      await db.order.update({ where: { id: order.id }, data: { razorpayOrderId: created.razorpayOrderId } }).catch(() => undefined)
      await db.paymentAttempt.create({
        data: { orderId: order.id, gateway: 'razorpay', gatewayOrderId: created.razorpayOrderId, status: 'CREATED' },
      }).catch(() => undefined)
      return {
        mode: 'razorpay',
        order,
        razorpay: { orderId: created.razorpayOrderId, amount: Math.round(product.priceInr * 100), currency: 'INR' },
        amountInr: product.priceInr,
      }
    }
    // fall through to demo if order creation failed
  }

  const settings = await db.siteSetting.findMany({ where: { key: { in: ['upiId', 'upiPayeeName'] } } })
  const upiId = settings.find((s) => s.key === 'upiId')?.value || 'sibra@upi'
  const upiPayeeName = settings.find((s) => s.key === 'upiPayeeName')?.value || 'Sibra Digital Hub'
  return { mode: 'demo', order, upiId, upiPayeeName, amountInr: product.priceInr }
}

export function orderDTO(o: OrderWithProduct) {
  return {
    id: o.id,
    productId: o.productId,
    product: o.product,
    razorpayPaymentId: o.razorpayPaymentId,
    razorpayPaymentLinkId: o.razorpayPaymentLinkId,
    // Single-gateway migration (additive keys — legacy consumers keep reading the rest).
    razorpayOrderId: o.razorpayOrderId,
    paymentMethod: o.paymentMethod,
    paymentInternational: o.paymentInternational,
    // Dual payment (additive keys — legacy consumers keep reading the rest).
    gateway: o.gateway,
    billingCountry: o.billingCountry,
    ipCountry: o.ipCountry,
    currency: o.currency,
    amountMinor: o.amountMinor,
    paypalOrderId: o.paypalOrderId,
    paypalCaptureId: o.paypalCaptureId,
    riskFlags: o.riskFlags,
    customerName: o.customerName,
    customerEmail: o.customerEmail,
    amountInr: o.amountInr,
    status: o.status,
    downloadTokenHash: o.downloadTokenHash,
    tokenExpiresAt: o.tokenExpiresAt,
    downloadCount: o.downloadCount,
    emailSent: o.emailSent,
    visitorId: o.visitorId,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  }
}

/**
 * T5: the PUBLIC order shape — same fields as orderDTO minus the
 * download-token hash (never leaves the server) and minus the paid
 * file name on the embedded product (paid file references never
 * appear in any public response — §6.5). Field order mirrors orderDTO
 * so the admin DTO stays byte-identical.
 */
export function publicOrderDTO(o: OrderWithProduct) {
  return {
    id: o.id,
    productId: o.productId,
    product: {
      title: o.product.title,
      slug: o.product.slug,
      zone: o.product.zone,
      instantDownload: o.product.instantDownload,
      // T-V: public delivery mode (thank-you page Watch now affordance).
      deliveryMode: o.product.deliveryMode,
    },
    razorpayPaymentId: o.razorpayPaymentId,
    razorpayPaymentLinkId: o.razorpayPaymentLinkId,
    // Single-gateway migration (public subset — riskFlags/ipCountry stay admin-only).
    razorpayOrderId: o.razorpayOrderId,
    paymentMethod: o.paymentMethod,
    paymentInternational: o.paymentInternational,
    // Dual payment (public subset — riskFlags/ipCountry stay admin-only).
    gateway: o.gateway,
    billingCountry: o.billingCountry,
    currency: o.currency,
    amountMinor: o.amountMinor,
    customerName: o.customerName,
    customerEmail: o.customerEmail,
    amountInr: o.amountInr,
    status: o.status,
    tokenExpiresAt: o.tokenExpiresAt,
    downloadCount: o.downloadCount,
    emailSent: o.emailSent,
    visitorId: o.visitorId,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  }
}

// ── T-V: fulfillment (verify route + webhook + demo-pay) ─────

export type FulfillOutcome = 'fulfilled' | 'duplicate' | 'rejected'
export type FulfillRejection = 'not_found' | 'order_not_fulfillable' | 'payment_id_reused'

export interface FulfillOpts {
  paymentId?: string | null
  paymentLinkId?: string | null
  /** Single-gateway: gateway-reported payment method + international flag (recorded at fulfilment). */
  paymentMethod?: string | null
  paymentInternational?: boolean | null
  /** LEGACY ONLY: PayPal refs — historical fulfilments keep their gateway columns readable. */
  paypalOrderId?: string | null
  paypalCaptureId?: string | null
}

export type FulfillResult =
  | { outcome: 'fulfilled'; order: OrderWithProduct; token: string; emailDemo: boolean }
  | { outcome: 'duplicate'; order: OrderWithProduct; token: null; emailDemo: boolean }
  | { outcome: 'rejected'; reason: FulfillRejection }

/** Prisma unique-constraint violation (e.g. razorpayPaymentId already taken). */
function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}

/**
 * Mark an order PAID exactly once and deliver the download link.
 *
 * Idempotency + concurrency: inside one transaction an atomic
 * conditional `updateMany` flips pending → paid and mints the token
 * (32 random bytes; only its SHA-256 is stored). If the claim matches
 * zero rows the order was already fulfilled (or is not fulfillable) —
 * no second token, no second email. The delivery email is sent AFTER
 * the transaction commits, exactly once (winner only).
 *
 * Shared by: POST /api/razorpay/verify, /api/razorpay/webhook and
 * POST /api/orders/[id]/demo-pay (demo mode).
 */
export async function fulfillOrder(
  orderId: string,
  opts: FulfillOpts = {},
): Promise<FulfillResult> {
  const paymentId = opts.paymentId ?? null
  const isPaypal = Boolean(opts.paypalOrderId || opts.paypalCaptureId)

  // Fast path: this payment id already completed a different order → reject.
  if (paymentId) {
    const owner = await db.order.findUnique({
      where: { razorpayPaymentId: paymentId },
      select: { id: true, status: true, customerEmail: true },
    })
    if (owner && owner.id !== orderId) {
      await writeAudit({
        action: 'payment.id_reused',
        entity: 'order',
        entityId: orderId,
        label: owner.customerEmail ? maskEmail(owner.customerEmail) : null,
        diff: { reason: 'razorpayPaymentId already attached to another order' },
      })
      return { outcome: 'rejected', reason: 'payment_id_reused' }
    }
    if (owner && owner.id === orderId && owner.status === 'paid') {
      const existing = await orderRepo.byId(orderId)
      if (existing) return { outcome: 'duplicate', order: existing, token: null, emailDemo: emailDemoMode() }
    }
  }

  const { plain, hash, expiresAt } = generateToken()
  const now = new Date()

  let winner: OrderWithProduct | null = null
  try {
    winner = await db.$transaction(async (tx) => {
      // The atomic claim: only a still-pending order transitions to paid.
      const claimed = await tx.order.updateMany({
        where: { id: orderId, status: { in: ['pending'] } },
        data: {
          status: 'paid',
          // Razorpay flow keeps the legacy behaviour (demo_ fallback); a
          // legacy PayPal fulfilment never invents a razorpay payment id.
          razorpayPaymentId: paymentId ?? (isPaypal ? null : `demo_${now.getTime()}_${crypto.randomBytes(4).toString('hex')}`),
          razorpayPaymentLinkId: opts.paymentLinkId ?? null,
          paypalOrderId: opts.paypalOrderId ?? null,
          paypalCaptureId: opts.paypalCaptureId ?? null,
          paymentMethod: opts.paymentMethod ?? null,
          paymentInternational: opts.paymentInternational ?? null,
          downloadTokenHash: hash,
          tokenExpiresAt: expiresAt,
          downloadCount: 0,
          emailSent: false,
        },
      })
      if (claimed.count === 0) return null
      const fulfilled = await tx.order.findUnique({ where: { id: orderId }, include: { product: true } })
      if (fulfilled) {
        // Outbox row is atomic with the fulfilment: exactly one delivery
        // email per order; the retry cron re-sends when the post-commit
        // send fails. Unique (orderId, template) makes re-runs no-ops.
        const template = fulfilled.product.deliveryMode === 'watch' ? 'watch_delivery' : 'delivery'
        await tx.emailOutbox
          .create({ data: { orderId, template, status: 'PENDING' } })
          .catch(() => undefined)
      }
      return fulfilled
    })
  } catch (e) {
    if (isUniqueViolation(e)) {
      // Another order took this payment id between the check and the claim.
      await writeAudit({
        action: 'payment.id_reused',
        entity: 'order',
        entityId: orderId,
        diff: { reason: 'razorpayPaymentId unique violation during fulfillment' },
      })
      return { outcome: 'rejected', reason: 'payment_id_reused' }
    }
    throw e
  }

  if (!winner) {
    // Zero rows claimed — the order was not pending. Distinguish the
    // idempotent duplicate from the genuinely unfulfillable.
    const current = await orderRepo.byId(orderId)
    if (!current) return { outcome: 'rejected', reason: 'not_found' }
    if (current.status === 'paid') {
      return { outcome: 'duplicate', order: current, token: null, emailDemo: emailDemoMode() }
    }
    await writeAudit({
      action: 'order.fulfill_rejected',
      entity: 'order',
      entityId: orderId,
      label: maskEmail(current.customerEmail),
      diff: { reason: 'order not pending', status: current.status },
    })
    return { outcome: 'rejected', reason: 'order_not_fulfillable' }
  }

  // ── Winner, post-commit: deliver exactly once, then funnel events ──
  // Fallback chain: PUBLIC_WEB_URL is the boot-guarded canonical origin —
  // an empty NEXT_PUBLIC_SITE_URL must never produce dead relative links
  // in customer emails.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.PUBLIC_WEB_URL || ''
  // T-V: watch-mode orders mint the protected-watch grant (1:1 with the
  // order) and email the ON-SITE watch link instead of a file download.
  // File/external modes keep the pre-existing email byte-for-byte.
  const isWatch = winner.product.deliveryMode === 'watch'
  if (isWatch) {
    await mintGrantForOrder(
      winner.id,
      plain,
      winner.product.watchTtlHours ?? downloadTtlHours(),
      winner.product.watchMaxConcurrent ?? 2,
    )
  }
  const email = isWatch
    ? await sendWatchDeliveryEmail({
        to: winner.customerEmail,
        customerName: winner.customerName,
        productTitle: winner.product.title,
        watchUrl: `${siteUrl}/#/watch/${plain}`,
        ttlHours: winner.product.watchTtlHours ?? downloadTtlHours(),
        maxConcurrent: winner.product.watchMaxConcurrent ?? 2,
        amountInr: winner.amountInr,
        orderId: winner.id,
        // Layer 2: the buyer's verified-review invite (same token, rate page).
        rateUrl: `${siteUrl}/#/rate/${plain}`,
      })
    : await sendDeliveryEmail({
        to: winner.customerEmail,
        customerName: winner.customerName,
        productTitle: winner.product.title,
        // The SPA download page: GET validates for free, the buyer's click
        // claims via POST — email prefetchers can't eat download slots.
        downloadUrl: `${siteUrl}/#/download/${plain}`,
        amountInr: winner.amountInr,
        orderId: winner.id,
        // Layer 2: the buyer's verified-review invite (same token, rate page).
        rateUrl: `${siteUrl}/#/rate/${plain}`,
      })
  const order = await db.order.update({ where: { id: winner.id }, data: { emailSent: email.sent } })
  const orderWithProduct: OrderWithProduct = { ...order, product: { ...winner.product } }

  // Outbox bookkeeping: SENT (done, or demo-logged — retrying can't change
  // the console driver's outcome) or FAILED (cron retries with a fresh token).
  const emailDone = email.sent || email.demo
  const outboxTemplate = isWatch ? 'watch_delivery' : 'delivery'
  await recordDeliveryOutcome(winner.id, outboxTemplate, emailDone, emailDone ? null : email.error ?? 'send_failed')

  await writeAudit({
    action: 'order.fulfilled',
    entity: 'order',
    entityId: order.id,
    label: maskEmail(order.customerEmail),
    diff: { amountInr: order.amountInr, emailSent: email.sent, demo: email.demo },
  })

  // Funnel: order paid + email outcome — feeds admin analytics + customer timeline
  await logEvent({
    type: 'order_paid',
    productId: orderWithProduct.productId,
    zone: orderWithProduct.product.zone,
    email: orderWithProduct.customerEmail,
    orderId: orderWithProduct.id,
    visitorId: orderWithProduct.visitorId,
  })
  if (email.sent) {
    await logEvent({ email: orderWithProduct.customerEmail, orderId: orderWithProduct.id, productId: orderWithProduct.productId, type: 'email_sent', meta: { kind: 'delivery' } })
  }

  return { outcome: 'fulfilled', order: orderWithProduct, token: plain, emailDemo: email.demo }
}

// ── Dual payment: refunds & disputes (§6.7) ─────────────────

/**
 * Delivery-outcome bookkeeping for the exactly-once email outbox.
 * UPSERT (not update): if the in-transaction outbox insert was lost to a
 * transient error, this recreates the row — previously a lost insert meant
 * the retry cron could never engage (email permanently never queued).
 * Never throws: bookkeeping must not break the fulfillment result.
 */
export async function recordDeliveryOutcome(orderId: string, template: string, emailDone: boolean, lastError: string | null): Promise<void> {
  try {
    await db.emailOutbox.upsert({
      where: { orderId_template: { orderId, template } },
      create: emailDone
        ? { orderId, template, status: 'SENT', sentAt: new Date(), attempts: 1 }
        : { orderId, template, status: 'FAILED', attempts: 1, lastError: lastError ?? 'send_failed', nextAttemptAt: new Date(Date.now() + 60_000) },
      update: emailDone
        ? { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 }, lastError: null }
        : { status: 'FAILED', attempts: { increment: 1 }, lastError: lastError ?? 'send_failed', nextAttemptAt: new Date(Date.now() + 60_000) },
    })
  } catch {
    // the delivery email itself already went out; cron coverage is best-effort here
  }
}

/**
 * Mark an order REFUNDED exactly once (atomic paid → refunded) and revoke
 * download access when REVOKE_ON_REFUND is on (default): the token expiry
 * moves to now, so every later claim fails atomically. Watch entitlements
 * are revoked the same way flagDispute revokes them — a refunded buyer of
 * a watch-mode product must not keep watching until natural expiry.
 */
export async function refundOrder(orderId: string, reason: string): Promise<{ ok: boolean; status?: string }> {
  const revoke = revokeOnRefund()
  const claimed = await db.order.updateMany({
    where: { id: orderId, status: 'paid' },
    data: {
      status: 'refunded',
      ...(revoke ? { tokenExpiresAt: new Date() } : {}),
    },
  })
  if (claimed.count === 0) {
    const current = await db.order.findUnique({ where: { id: orderId }, select: { status: true } })
    return { ok: false, status: current?.status }
  }
  if (revoke) {
    await db.watchGrant.updateMany({ where: { orderId }, data: { revokedAt: new Date() } }).catch(() => undefined)
  }
  await writeAudit({
    action: 'order.refunded',
    entity: 'order',
    entityId: orderId,
    diff: { reason, accessRevoked: revoke },
  })
  await sendPaymentAlert('Order refunded — access revoked', [`Order ${orderId}`, `Reason: ${reason}`, revoke ? 'Download access has been revoked.' : 'Download access left intact (REVOKE_ON_REFUND=false).'])
  return { ok: true, status: 'refunded' }
}

/** Flag a dispute on the order (idempotent — the flag set is deduped) and alert. */
export async function flagDispute(orderId: string, reason: string): Promise<void> {
  const order = await db.order.findUnique({ where: { id: orderId }, select: { riskFlags: true, status: true } })
  if (!order) return
  if (!order.riskFlags.includes('DISPUTED')) {
    await db.order.update({ where: { id: orderId }, data: { riskFlags: { push: 'DISPUTED' } } })
  }
  if (order.status === 'paid' && revokeOnRefund()) {
    await db.order.updateMany({ where: { id: orderId, status: 'paid' }, data: { tokenExpiresAt: new Date() } })
    // Disputes must revoke the WATCH entitlement too — previously only the
    // download token expired and a disputed buyer kept full watch access.
    await db.watchGrant.updateMany({ where: { orderId }, data: { revokedAt: new Date() } }).catch(() => undefined)
  }
  await writeAudit({ action: 'order.disputed', entity: 'order', entityId: orderId, diff: { reason } })
  await sendPaymentAlert('Payment dispute opened', [`Order ${orderId}`, `Reason: ${reason}`])
}

// ── P5: captured money the shop cannot deliver ──────────────

/** Order risk flag: gateway captured the money but the order is not fulfillable. */
export const PAID_BUT_NOT_DELIVERED = 'PAID_BUT_NOT_DELIVERED'

/**
 * A REAL capture landed for an order that is failed/expired/revoked — the
 * money is taken but nothing can be delivered. Flag the order (visible in
 * Admin → Orders) and alert the owner; NO auto refund (the owner decides).
 * Idempotent (deduped flag) and never throws: callers are webhook/route
 * rejection paths whose own response must stay intact.
 */
export async function markPaidButNotDelivered(orderId: string, context: string): Promise<void> {
  try {
    const order = await db.order.findUnique({ where: { id: orderId }, select: { riskFlags: true, customerEmail: true } })
    if (!order) return
    if (!order.riskFlags.includes(PAID_BUT_NOT_DELIVERED)) {
      await db.order.update({ where: { id: orderId }, data: { riskFlags: { push: PAID_BUT_NOT_DELIVERED } } })
    }
    await writeAudit({
      action: 'payment.paid_not_delivered',
      entity: 'order',
      entityId: orderId,
      label: maskEmail(order.customerEmail),
      diff: { reason: context },
    })
    await sendPaymentAlert('Payment captured but NOT delivered', [
      `Order ${orderId}`,
      `Reason: ${context}`,
      'The order is not fulfillable (failed/expired/revoked) but the gateway captured the money. Review Admin → Orders and refund or restore manually — no auto refund was made.',
    ])
  } catch {
    // alerting must never break the webhook/route answer that surfaced it
  }
}
