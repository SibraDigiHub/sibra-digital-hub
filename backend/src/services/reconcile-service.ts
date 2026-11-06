// ═══════════════════════════════════════════════════════════
// Reconciliation (§6.6) — repairs lost webhooks.
//
//   reconcileOrder(orderId)      — one order, asked by the admin
//   reconcilePendingBatch()      — cron sweep: pending orders
//                                  10 min … 24 h old are checked
//                                  against Razorpay; paid ones
//                                  fulfil, >24 h pendings expire.
//
// Matches ONLY by our own stored razorpayOrderId (the Orders-API
// session created at checkout) and re-validates amount + currency
// before fulfilling through the single idempotent fulfillOrder().
// ═══════════════════════════════════════════════════════════

import { db } from '@/lib/db'
import { fetchRazorpayOrder, fetchRazorpayOrderPayments } from '@/lib/razorpay'
import { fulfillOrder } from '@/services/order-service'
import { orderExpectedMinor } from '@/lib/money'
import { writeAudit, maskEmail } from '@/lib/audit'

export interface ReconcileOutcome {
  orderId: string
  action: 'fulfilled' | 'still_pending' | 'expired' | 'skipped' | 'error'
  detail?: string
}

const PENDING_BATCH_LIMIT = 50

/** Atomic pending → failed expiry (existing status vocabulary; see DECISIONS.md #5). */
async function expireOrder(orderId: string): Promise<boolean> {
  const claimed = await db.order.updateMany({
    where: { id: orderId, status: 'pending', createdAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } },
    data: { status: 'failed' },
  })
  return claimed.count > 0
}

/**
 * Razorpay Orders API reconciliation: the order's payments are fetched and
 * a CAPTURED payment whose amount + currency match the DB order fulfils it.
 * Authorized-but-not-captured payments never fulfil (they are completed by
 * a later webhook/reconcile pass once captured).
 */
async function reconcileRazorpay(orderId: string, razorpayOrderId: string): Promise<ReconcileOutcome> {
  const payments = await fetchRazorpayOrderPayments(razorpayOrderId)
  if (!payments.ok) return { orderId, action: 'error', detail: payments.error }
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { amountInr: true, amountMinor: true, currency: true, customerEmail: true, createdAt: true },
  })
  if (!order) return { orderId, action: 'skipped', detail: 'not_found' }

  const captured = payments.data?.items?.find((p) => p.status === 'captured')
  if (captured) {
    const expectedMinor = orderExpectedMinor(order)
    if (
      typeof captured.amount !== 'number' ||
      captured.currency !== order.currency ||
      captured.amount !== expectedMinor
    ) {
      await writeAudit({
        action: 'reconcile.amount_mismatch',
        entity: 'order',
        entityId: orderId,
        label: maskEmail(order.customerEmail),
        diff: { reason: 'razorpay payment amount differs from order', currency: captured.currency ?? null },
      })
      return { orderId, action: 'skipped', detail: 'amount_mismatch' }
    }
    const result = await fulfillOrder(orderId, {
      paymentId: captured.id,
      paymentMethod: captured.method ?? null,
      paymentInternational: captured.international ?? null,
    })
    return { orderId, action: result.outcome === 'fulfilled' ? 'fulfilled' : 'still_pending', detail: result.outcome }
  }

  // No captured payment: expire only when the order itself is past 24 h.
  if (Date.now() - order.createdAt.getTime() > 24 * 3600 * 1000) {
    return (await expireOrder(orderId)) ? { orderId, action: 'expired' } : { orderId, action: 'still_pending' }
  }
  return { orderId, action: 'still_pending', detail: 'no_captured_payment' }
}

/** Reconcile ONE order (admin "Reconcile now" + the cron sweep). */
export async function reconcileOrder(orderId: string): Promise<ReconcileOutcome> {
  const order = await db.order.findUnique({ where: { id: orderId } })
  if (!order) return { orderId, action: 'skipped', detail: 'not_found' }
  if (order.status !== 'pending') return { orderId, action: 'skipped', detail: `status_${order.status}` }
  // `starting:` refs are the checkout concurrency claim marker — the real
  // gateway ref lands seconds later; reconciling the marker would 404-loop.
  if (order.razorpayOrderId?.startsWith('starting:')) {
    return { orderId, action: 'skipped', detail: 'gateway_session_starting' }
  }
  // Legacy Payment-Link / PayPal rows have no Orders-API session — nothing
  // to poll (historical rows stay readable; their flows are retired).
  if (!order.razorpayOrderId) {
    return { orderId, action: 'skipped', detail: 'no_razorpay_order' }
  }
  // A quick status probe keeps expired Razorpay orders from pointless payment fetches.
  const rzpOrder = await fetchRazorpayOrder(order.razorpayOrderId)
  if (rzpOrder.ok && rzpOrder.data?.status && !['created', 'attempted'].includes(rzpOrder.data.status)) {
    // Terminal Razorpay order state without fulfilment — expiry rules apply.
    if (Date.now() - order.createdAt.getTime() > 24 * 3600 * 1000) {
      return (await expireOrder(orderId)) ? { orderId, action: 'expired' } : { orderId, action: 'still_pending' }
    }
    return { orderId, action: 'still_pending', detail: `razorpay_${rzpOrder.data.status}` }
  }
  return reconcileRazorpay(orderId, order.razorpayOrderId)
}

/** Cron sweep — pending orders 10 min … 24 h old (§6.6). */
export async function reconcilePendingBatch(budgetMs = 11_000): Promise<ReconcileOutcome[]> {
  const candidates = await db.order.findMany({
    where: {
      status: 'pending',
      createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000), lte: new Date(Date.now() - 10 * 60 * 1000) },
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: PENDING_BATCH_LIMIT,
  })
  const out: ReconcileOutcome[] = []
  const startedAt = Date.now()
  for (const { id } of candidates) {
    // Serverless budget (re-audit C): each check hits the gateway (10 s
    // timeout) — stop cleanly before the 15 s function budget expires;
    // whatever remains is picked up by the next cron invocation.
    if (Date.now() - startedAt > budgetMs) break
    try {
      out.push(await reconcileOrder(id))
    } catch (e) {
      out.push({ orderId: id, action: 'error', detail: e instanceof Error ? e.message : String(e) })
    }
  }
  return out
}

/** Audit the cron sweep result (observability, no sensitive data). */
export async function auditReconcile(results: ReconcileOutcome[], triggeredBy: string): Promise<void> {
  const fulfilled = results.filter((r) => r.action === 'fulfilled').length
  const expired = results.filter((r) => r.action === 'expired').length
  const errors = results.filter((r) => r.action === 'error').length
  if (results.length === 0) return
  await writeAudit({
    action: 'payments.reconciled',
    entity: 'order',
    label: maskEmail(triggeredBy),
    diff: { checked: results.length, fulfilled, expired, errors },
  })
}
