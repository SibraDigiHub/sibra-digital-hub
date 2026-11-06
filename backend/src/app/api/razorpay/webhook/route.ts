// POST /api/razorpay/webhook — payment.captured / order.paid (§5.3)
//
// Hardening carried over from the Payment Links flow:
//  • signature = HMAC_SHA256(RAW body, RAZORPAY_WEBHOOK_SECRET) vs
//    X-Razorpay-Signature — computed on the raw body BEFORE any JSON
//    parsing, compared in constant time; bad signature → 400 before
//    any order processing;
//  • insert-first idempotency: every event records its id in
//    WebhookEvent (unique) — duplicates answer 200 with zero effects;
//  • the order is matched ONLY by Razorpay notes.orderRef/orderId
//    (no "latest pending order for this email" fallback);
//  • the paid amount + currency must equal the order's DB amount
//    (order.currency — INR for India, the configured foreign currency
//    otherwise) or the event is rejected (order stays pending);
//  • fulfillment goes through the single idempotent fulfillOrder();
//  • never logs signatures, tokens, payloads or emails.
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { asHandler } from '@/lib/api'
import { db } from '@/lib/db'
import { verifyWebhookSignature } from '@/lib/razorpay'
import { fulfillOrder, refundOrder, markPaidButNotDelivered } from '@/services/order-service'
import { claimEventForReprocessing } from '@/lib/webhook-idempotency'
import { orderExpectedMinor } from '@/lib/money'
import { sendPaymentAlert } from '@/lib/admin-alerts'
import { blockInternationalCards } from '@/config/env'
import { writeAudit, maskEmail } from '@/lib/audit'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

/** Re-audit B9: webhook bodies are tiny JSON events — refuse memory-DoS reads. */
const MAX_WEBHOOK_BYTES = 1024 * 1024

/** Best-effort result stamp on the recorded event (observability only). */
async function markResult(eventId: string, result: string): Promise<void> {
  try {
    await db.webhookEvent.update({ where: { eventId }, data: { result } })
  } catch {
    // recording details must never flip the webhook answer
  }
}

export const POST = asHandler(async (req: NextRequest) => {
  // RAW body first — the HMAC is computed over exactly these bytes.
  if (Number(req.headers.get('content-length') ?? '0') > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }
  const raw = await req.text()
  const signature = req.headers.get('x-razorpay-signature')

  if (!verifyWebhookSignature(raw, signature)) {
    // Security event: audit (best-effort) then 400 — before any processing.
    await writeAudit({ action: 'webhook.rejected', entity: 'webhook', diff: { reason: 'bad signature' } })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let event: {
    event?: string
    payload?: {
      payment?: { entity?: { id?: string; order_id?: string; notes?: Record<string, string>; amount?: number; currency?: string; international?: boolean; method?: string } }
      refund?: { entity?: { id?: string; payment_id?: string; notes?: Record<string, string>; amount?: number } }
      order?: { entity?: { id?: string; notes?: Record<string, string> } }
    }
  }
  try {
    event = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Bad payload' }, { status: 400 })
  }

  const type = event.event
  // Event id: Razorpay's header when present, else a stable digest of the
  // raw body — identical redeliveries dedupe either way.
  const headerEventId = req.headers.get('x-razorpay-event-id')?.trim()
  const eventId =
    headerEventId && headerEventId.length <= 200
      ? headerEventId
      : `sha256-${crypto.createHash('sha256').update(raw).digest('hex')}`

  // ── Insert-first idempotency: the unique index decides. ──
  // P3: a stored event is only a duplicate when its result is terminal —
  // a previous run that failed or never finished is re-processed now.
  try {
    await db.webhookEvent.create({ data: { eventId, type: type ?? 'unknown' } })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      if (!(await claimEventForReprocessing(eventId))) {
        logger.info({ type: type ?? null }, 'webhook duplicate delivery ignored')
        return NextResponse.json({ ok: true, duplicate: true })
      }
      logger.warn({ type: type ?? null }, 'webhook redelivery after failed/incomplete processing — re-processing')
    } else {
      throw e
    }
  }

  if (type !== 'payment.captured' && type !== 'order.paid') {
    // ── payment.failed: audit-only — the order stays pending for retry ──
    if (type === 'payment.failed') {
      const failed = event.payload?.payment?.entity
      const failedRef = failed?.notes?.orderRef
      if (failed?.id && failedRef) {
        await db.paymentAttempt
          .create({ data: { orderId: failedRef, gateway: 'razorpay', gatewayOrderId: failed.id, status: 'FAILED', errorCode: 'payment_failed' } })
          .catch(() => undefined)
      }
      await markResult(eventId, 'ignored')
      return NextResponse.json({ ok: true })
    }
    // ── refund.processed: revoke access + admin alert (§6.7) ──
    if (type === 'refund.processed') {
      const refund = event.payload?.refund?.entity
      const refundRef = refund?.notes?.orderRef
      if (refundRef) {
        const r = await refundOrder(refundRef, `refund.processed${refund?.id ? ` ${refund.id}` : ''}`)
        await markResult(eventId, r.ok ? 'fulfilled' : 'order_not_fulfillable')
        return NextResponse.json({ ok: true })
      }
      // Fallback: Razorpay refund entities don't always carry our notes —
      // match by the refunded payment id before giving up (a missed refund
      // must never silently keep download access alive).
      const refundedPaymentId = refund?.payment_id
      if (refundedPaymentId) {
        const owner = await db.order.findUnique({ where: { razorpayPaymentId: refundedPaymentId }, select: { id: true } })
        if (owner) {
          const r = await refundOrder(owner.id, `refund.processed${refund?.id ? ` ${refund.id}` : ''} (matched by payment id)`)
          await markResult(eventId, r.ok ? 'fulfilled' : 'order_not_fulfillable')
          return NextResponse.json({ ok: true })
        }
      }
      // Genuinely unmatched — someone must reconcile this manually.
      await markResult(eventId, 'unmatched')
      await sendPaymentAlert('Razorpay refund could not be matched', ['A refund.processed webhook carried no usable order reference.', refund?.id ? `Refund id: ${refund.id}` : null, 'No download access was revoked — check Admin → Orders.'].filter((l): l is string => Boolean(l)))
      return NextResponse.json({ ok: true, unmatched: true })
    }
    await markResult(eventId, 'ignored')
    return NextResponse.json({ ok: true, ignored: type ?? null })
  }

  const payment = event.payload?.payment?.entity
  const paymentId = payment?.id
  const notes = { ...(payment?.notes ?? {}), ...(event.payload?.order?.entity?.notes ?? {}) }
  // Match ONLY by the order reference we attached to the Razorpay order.
  const orderRef = notes.orderRef ?? notes.orderId

  if (!paymentId || !orderRef) {
    await markResult(eventId, 'unmatched')
    await writeAudit({ action: 'webhook.unmatched', entity: 'webhook', diff: { reason: 'missing orderRef or payment id', type: type ?? null } })
    logger.warn({ hasPaymentId: Boolean(paymentId), hasOrderRef: Boolean(orderRef) }, 'webhook: no matching order')
    return NextResponse.json({ ok: true, unmatched: true })
  }

  try {
    const order = await db.order.findUnique({
      where: { id: orderRef },
      select: { id: true, status: true, amountInr: true, amountMinor: true, currency: true, customerEmail: true, riskFlags: true },
    })
    if (!order) {
      // Unknown order id — nothing to fulfill; answer 200 so Razorpay stops retrying.
      await markResult(eventId, 'unmatched')
      await writeAudit({ action: 'webhook.unmatched', entity: 'webhook', entityId: orderRef, diff: { reason: 'order not found', type: type ?? null } })
      logger.warn({ orderRef }, 'webhook: no matching order')
      return NextResponse.json({ ok: true, unmatched: true })
    }

    // ── Paid amount + currency must equal the order's DB amount. ──
    const paidMinor = payment?.amount
    const currency = payment?.currency
    const expectedMinor = orderExpectedMinor(order)
    if (typeof paidMinor !== 'number' || currency !== order.currency || paidMinor !== expectedMinor) {
      await markResult(eventId, 'amount_mismatch')
      await writeAudit({
        action: 'webhook.amount_mismatch',
        entity: 'order',
        entityId: order.id,
        label: maskEmail(order.customerEmail),
        diff: { reason: 'paid amount/currency differs from order', currency: currency ?? null },
      })
      // An amount mismatch is a potential price-arbitrage/tamper signal —
      // the admin must always hear about it.
      await sendPaymentAlert('Razorpay payment amount mismatch', [`Order ${order.id}`, 'The webhook payment amount/currency differs from the order — fulfilment refused.'])
      logger.warn({ orderId: order.id }, 'webhook: paid amount/currency mismatch — rejected')
      return NextResponse.json({ error: 'Payment amount does not match the order' }, { status: 409 })
    }

    // ── §2.3 price-arbitrage guard: foreign card on an IN-billed order ──
    if (payment?.international === true) {
      if (blockInternationalCards()) {
        await markResult(eventId, 'order_not_fulfillable')
        // P6: customer-visible marker — the claim-gated status route reads it
        // to tell the buyer WHY the payment was refused and what to do next.
        // Deduped push: a re-processed event must not stack duplicate flags.
        if (!order.riskFlags.includes('INTERNATIONAL_CARD_BLOCKED')) {
          await db.order
            .update({ where: { id: order.id, status: { not: 'paid' } }, data: { riskFlags: { push: 'INTERNATIONAL_CARD_BLOCKED' } } })
            .catch(() => undefined)
        }
        await writeAudit({
          action: 'webhook.international_card_blocked',
          entity: 'order',
          entityId: order.id,
          label: maskEmail(order.customerEmail),
          diff: { reason: 'RAZORPAY_BLOCK_INTERNATIONAL_CARDS' },
        })
        await sendPaymentAlert('International card blocked on IN order', [`Order ${order.id}`, 'RAZORPAY_BLOCK_INTERNATIONAL_CARDS is enabled — payment not fulfilled.'])
        return NextResponse.json({ error: 'Payment method not accepted for this order' }, { status: 409 })
      }
      await db.order
        .update({ where: { id: order.id }, data: { riskFlags: { push: 'INTERNATIONAL_CARD_ON_IN_ORDER' } } })
        .catch(() => undefined)
      await sendPaymentAlert('International card used on IN order', [`Order ${order.id}`, 'Fulfilment continues (default). Review the order in Admin → Orders.'])
    }

    const result = await fulfillOrder(order.id, {
      paymentId,
      paymentMethod: payment?.method ?? null,
      paymentInternational: payment?.international ?? null,
    })

    if (result.outcome === 'fulfilled') {
      await markResult(eventId, 'fulfilled')
      return NextResponse.json({ ok: true })
    }
    if (result.outcome === 'duplicate') {
      await markResult(eventId, 'duplicate')
      logger.info({ orderId: order.id }, 'webhook: order already fulfilled — no-op')
      return NextResponse.json({ ok: true, duplicate: true })
    }
    // rejected (order not pending / payment id reuse)
    await markResult(eventId, 'order_not_fulfillable')
    // P5: the ONLY rejected reason that means captured-but-undeliverable
    // money — payment_id_reused already belongs to another (fulfilled) order.
    if (result.reason === 'order_not_fulfillable') {
      await markPaidButNotDelivered(order.id, `razorpay ${type}: capture landed for a non-fulfillable order`)
    }
    return NextResponse.json({ error: 'Order cannot be fulfilled' }, { status: 409 })
  } catch (e) {
    logger.error({ err: e instanceof Error ? { message: e.message } : e }, 'webhook processing failed')
    // P3: stamp the failure so the gateway's redelivery re-processes this
    // event instead of treating it as a handled duplicate.
    await markResult(eventId, 'failed')
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
})
