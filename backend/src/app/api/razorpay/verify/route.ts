// POST /api/razorpay/verify — Standard Checkout payment verification (§5.3).
//
// Called by the frontend after Razorpay Standard Checkout completes, carrying
// { razorpay_order_id, razorpay_payment_id, razorpay_signature } plus the
// local orderId from checkout context. Hardened per §6:
//   1. signature  = HMAC_SHA256(`${order_id}|${payment_id}`, KEY_SECRET),
//      compared in constant time (tampered → 400 + audit, nothing processed);
//   2. the payment is then fetched server-side and its captured amount +
//      currency must equal the ORDER's DB amount (order.currency — INR for
//      India, the configured foreign currency otherwise) — the client is
//      never trusted about amounts (mismatch → 409 + audit);
//   3. fulfillment goes through the single idempotent fulfillOrder().
// In demo mode (no Razorpay keys) the route answers 400 — demo checkout
// uses POST /api/orders/[id]/demo-pay instead.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { asHandler, badRequest, conflict, forbidden, notFound, parseBody, tooMany } from '@/lib/api'
import { db } from '@/lib/db'
import { razorpayConfigured, verifyCheckoutSignature, fetchRazorpayPayment } from '@/lib/razorpay'
import { fulfillOrder, publicOrderDTO, markPaidButNotDelivered } from '@/services/order-service'
import { orderExpectedMinor } from '@/lib/money'
import { ORDER_PRODUCT_INCLUDE } from '@/repositories/order-repo'
import { razorpayVerifyLimitPerIp } from '@/lib/auth/rate-limit'
import { clientIp } from '@/lib/auth/session'
import { readClaimedOrderId } from '@/lib/claim-cookie'
import { writeAudit, maskEmail } from '@/lib/audit'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const verifySchema = z
  .object({
    razorpayOrderId: z.string().trim().min(6).max(80),
    razorpayPaymentId: z.string().trim().min(6).max(80),
    razorpaySignature: z.string().trim().min(16).max(256),
    orderId: z.string().trim().min(1).max(80),
  })
  .strict()

export const POST = asHandler(async (req: NextRequest) => {
  // Unthrottled before the audit — each call triggers a Razorpay API fetch,
  // so an open loop here is an amplification surface (§8.2).
  const limit = await razorpayVerifyLimitPerIp(clientIp(req))
  if (!limit.allowed) return tooMany(limit.retryAfterSec)

  const body = await parseBody(req, verifySchema)

  const order = await db.order.findUnique({
    where: { id: body.orderId },
    select: { id: true, status: true, amountInr: true, amountMinor: true, currency: true, customerEmail: true, razorpayOrderId: true, razorpayPaymentLinkId: true },
  })
  if (!order) throw notFound('Order not found')

  // §2.3 binding: when OUR order holds a real Razorpay ref (Orders-API id for
  // new orders, payment-link id for historical rows), the submitted razorpay
  // order id must BE that ref — a payment pair from a different order/checkout
  // can never be verified against this one, even when amounts coincide.
  const storedRef = order.razorpayOrderId ?? order.razorpayPaymentLinkId
  if (storedRef && !storedRef.startsWith('starting:') && storedRef !== body.razorpayOrderId) {
    await writeAudit({
      action: 'payment.order_mismatch',
      entity: 'order',
      entityId: order.id,
      label: maskEmail(order.customerEmail),
      diff: { reason: 'submitted razorpay order id does not match the stored gateway ref' },
    })
    throw badRequest('Payment does not belong to this order')
  }

  // Re-audit B3: only the browser that CREATED the order may verify it
  // (the __Host-sdh_claim cookie is HMAC-bound to this order id).
  const claimed = readClaimedOrderId(req)
  if (!claimed || claimed !== body.orderId) {
    throw forbidden('This payment can only be verified by the checkout that created it')
  }

  if (!razorpayConfigured()) {
    // Demo mode: there is nothing to verify — the demo checkout flow
    // uses /api/orders/[id]/demo-pay. A clean 400, never a 500.
    throw badRequest('Razorpay payments are not configured')
  }

  // 1 — authenticity: constant-time signature check (no Razorpay API needed).
  if (!verifyCheckoutSignature(body.razorpayOrderId, body.razorpayPaymentId, body.razorpaySignature)) {
    await writeAudit({
      action: 'payment.signature_invalid',
      entity: 'order',
      entityId: order.id,
      label: maskEmail(order.customerEmail),
      diff: { reason: 'HMAC verification failed' },
    })
    logger.warn({ orderId: order.id }, 'verify: invalid payment signature')
    throw badRequest('Payment signature verification failed')
  }

  // 2 — server-side truth: fetch the payment and compare amount + currency.
  const fetched = await fetchRazorpayPayment(body.razorpayPaymentId)
  if (!fetched.ok || !fetched.payment) {
    logger.warn({ orderId: order.id }, 'verify: could not fetch payment from Razorpay')
    return NextResponse.json({ error: 'Could not verify the payment right now — please try again' }, { status: 502 })
  }
  const payment = fetched.payment
  if (payment.order_id && payment.order_id !== body.razorpayOrderId) {
    await writeAudit({
      action: 'payment.order_mismatch',
      entity: 'order',
      entityId: order.id,
      label: maskEmail(order.customerEmail),
      diff: { reason: 'payment belongs to a different razorpay order' },
    })
    throw badRequest('Payment does not belong to this order')
  }
  const paidMinor = payment.amount
  const expectedMinor = orderExpectedMinor(order)
  if (payment.currency !== order.currency || typeof paidMinor !== 'number' || paidMinor !== expectedMinor) {
    await writeAudit({
      action: 'payment.amount_mismatch',
      entity: 'order',
      entityId: order.id,
      label: maskEmail(order.customerEmail),
      diff: { reason: 'paid amount/currency differs from order', currency: payment.currency ?? null },
    })
    throw conflict('Payment amount does not match the order')
  }
  if (payment.status && payment.status !== 'captured') {
    throw conflict('Payment has not been captured yet')
  }

  // 3 — fulfillment (idempotent: duplicates and re-verified payments are no-ops).
  const result = await fulfillOrder(order.id, {
    paymentId: body.razorpayPaymentId,
    paymentMethod: payment.method ?? null,
    paymentInternational: payment.international ?? null,
  })
  if (result.outcome === 'rejected') {
    // P5: the payment was verified as captured — if the order cannot be
    // fulfilled (failed/expired/revoked) the owner must hear about it.
    if (result.reason === 'order_not_fulfillable') {
      await markPaidButNotDelivered(order.id, 'razorpay checkout.js verify: captured payment on a non-fulfillable order')
    }
    throw conflict('Order cannot be fulfilled')
  }

  const paid = await db.order.findUnique({ where: { id: order.id }, include: ORDER_PRODUCT_INCLUDE })
  return NextResponse.json({
    ok: true,
    ...(result.outcome === 'duplicate' ? { alreadyFulfilled: true } : {}),
    order: paid ? publicOrderDTO(paid) : null,
    downloadUrl: result.token ? `/api/download/${result.token}` : null,
  })
})
