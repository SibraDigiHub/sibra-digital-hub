// POST/GET /api/cron/retry-emails — re-send failed delivery emails (§6.6).
// PENDING/FAILED outbox rows with nextAttemptAt due get a FRESH download
// token (same pattern as the admin resend) and a rebuild from the order —
// nothing sensitive is stored in the outbox row itself.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { asHandler, unauthorized } from '@/lib/api'
import { secretsEqual } from '@/lib/timing-safe'
import { generateToken } from '@/lib/delivery'
import { sendPaymentAlert } from '@/lib/admin-alerts'
import { sendDeliveryEmail, sendWatchDeliveryEmail, emailDemoMode } from '@/lib/email'
import { mintGrantForOrder } from '@/services/watch-service'
import { downloadTtlHours } from '@/config/env'
import { writeAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { recordCronSuccess, maybeAlertStaleReconcile, RETRY_EMAILS_HEARTBEAT_KEY } from '@/services/cron-heartbeat'

export const dynamic = 'force-dynamic'

const MAX_ATTEMPTS = 5
const RETRY_BATCH = 25
/** Backoff after a failed retry (§6.5): 5 min → 30 min → 2 h → 6 h. */
const BACKOFF_MS = [5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000]
/** Lease window claimed by a worker while it sends (concurrent cron guard). */
const LEASE_MS = 3 * 60_000
/** Stop processing before the 15 s serverless budget is exhausted (re-audit C). */
const RUN_BUDGET_MS = 11_000

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  const header = req.headers.get('authorization') ?? ''
  return secretsEqual(header, `Bearer ${secret}`)
}

/**
 * Atomically lease one outbox row: pushes nextAttemptAt forward so a
 * concurrent cron run (overlap, double-fire) cannot send the same email
 * twice. Returns the number of rows leased (0 ⇒ someone else has it).
 */
export async function leaseOutboxRow(orderId: string, template: string): Promise<number> {
  return db.emailOutbox
    .updateMany({
      where: {
        orderId,
        template,
        status: { in: ['PENDING', 'FAILED'] },
        nextAttemptAt: { lte: new Date() },
      },
      data: { nextAttemptAt: new Date(Date.now() + LEASE_MS) },
    })
    .then((r) => r.count)
    .catch(() => 0)
}

async function retryRow(orderId: string, template: string): Promise<boolean> {
  // Lease first: a twin cron run sees nextAttemptAt in the future and skips.
  if ((await leaseOutboxRow(orderId, template)) === 0) return false
  const order = await db.order.findUnique({ where: { id: orderId }, include: { product: true } })
  if (!order || order.status !== 'paid') {
    // Order no longer deliverable — park the row instead of retrying forever.
    await db.emailOutbox.update({ where: { orderId_template: { orderId, template } }, data: { status: 'FAILED', lastError: 'order_not_deliverable' } }).catch(() => undefined)
    return false
  }
  // Fresh token for every retry — the old link may have been part of the failure.
  const { plain, hash, expiresAt } = generateToken()
  await db.order.update({ where: { id: order.id }, data: { downloadTokenHash: hash, tokenExpiresAt: expiresAt, downloadCount: 0 } })

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.PUBLIC_WEB_URL || ''
  const isWatch = template === 'watch_delivery' && order.product.deliveryMode === 'watch'
  if (isWatch && order.product.deliveryMode === 'watch') {
    // H-audit fix: an admin revocation/lock must survive retries — re-minting
    // here used to CLEAR revokedAt/lockedAt and email a fresh link to a
    // customer whose access was deliberately revoked.
    const grant = await db.watchGrant.findUnique({ where: { orderId: order.id }, select: { revokedAt: true, lockedAt: true } })
    if (grant && (grant.revokedAt || grant.lockedAt)) {
      await db.emailOutbox.update({ where: { orderId_template: { orderId, template } }, data: { status: 'FAILED', lastError: 'watch_access_revoked' } }).catch(() => undefined)
      await writeAudit({ action: 'email.watch_retry_skipped', entity: 'order', entityId: order.id, diff: { reason: 'watch grant revoked/locked — access not re-minted' } })
      return false
    }
    await mintGrantForOrder(order.id, plain, order.product.watchTtlHours ?? downloadTtlHours(), order.product.watchMaxConcurrent ?? 2)
  }
  const email = isWatch
    ? await sendWatchDeliveryEmail({
        to: order.customerEmail,
        customerName: order.customerName,
        productTitle: order.product.title,
        watchUrl: `${siteUrl}/#/watch/${plain}`,
        ttlHours: order.product.watchTtlHours ?? downloadTtlHours(),
        maxConcurrent: order.product.watchMaxConcurrent ?? 2,
        amountInr: order.amountInr,
        orderId: order.id,
      })
    : await sendDeliveryEmail({
        to: order.customerEmail,
        customerName: order.customerName,
        productTitle: order.product.title,
        downloadUrl: `${siteUrl}/#/download/${plain}`,
        amountInr: order.amountInr,
        orderId: order.id,
      })

  const attempts = { increment: 1 }
  if (email.sent || email.demo) {
    // Demo-logged emails (console driver) count as delivered — retrying
    // them can never change the outcome; only real failures stay queued.
    await db.emailOutbox.update({ where: { orderId_template: { orderId, template } }, data: { status: 'SENT', sentAt: new Date(), attempts, lastError: null } })
    await db.order.update({ where: { id: order.id }, data: { emailSent: email.sent } })
    return true
  }
  const row = await db.emailOutbox.findUnique({ where: { orderId_template: { orderId, template } }, select: { attempts: true } })
  const attemptNo = (row?.attempts ?? 0) + 1
  const exhausted = attemptNo >= MAX_ATTEMPTS
  await db.emailOutbox.update({
    where: { orderId_template: { orderId, template } },
    data: {
      status: exhausted ? 'FAILED' : 'PENDING',
      attempts,
      lastError: email.error ?? 'send_failed',
      nextAttemptAt: new Date(Date.now() + (BACKOFF_MS[Math.min(attemptNo - 2, BACKOFF_MS.length - 1)] ?? 6 * 3600_000)),
    },
  })
  if (exhausted) {
    // Paid customer with no delivery email and no more retries — the admin
    // must hear about it (alert matrix gap; §6.8 covers delivery failures).
    await sendPaymentAlert('Delivery email retries exhausted', [`Order ${orderId}`, 'All retry attempts failed — the customer has no delivery email. Use Admin → Orders to resend manually.'])
  }
  return false
}

async function handle(req: NextRequest) {
  if (!authorized(req)) throw unauthorized('Cron bearer token required')
  // P4: buddy check — this schedule runs even when reconcile's does not,
  // so it is the one that notices a >2 h reconcile gap and alerts (once
  // per 2 h while the outage persists; a successful reconcile clears it).
  await maybeAlertStaleReconcile()
  const due = await db.emailOutbox.findMany({
    where: {
      status: { in: ['PENDING', 'FAILED'] },
      nextAttemptAt: { lte: new Date() },
    },
    select: { orderId: true, template: true, attempts: true },
    orderBy: { createdAt: 'asc' },
    take: RETRY_BATCH,
  })
  let sent = 0
  const startedAt = Date.now()
  for (const row of due) {
    // Serverless budget: stop cleanly before the platform kills the run —
    // due rows are simply picked up by the next invocation.
    if (Date.now() - startedAt > RUN_BUDGET_MS) break
    if (row.attempts >= MAX_ATTEMPTS) {
      // A bare `{ orderId_template: row }` carries the extra `attempts`
      // column and Prisma rejects it — the park silently never happened.
      await db.emailOutbox.update({ where: { orderId_template: { orderId: row.orderId, template: row.template } }, data: { status: 'FAILED' } }).catch(() => undefined)
      await sendPaymentAlert('Delivery email retries exhausted', [`Order ${row.orderId}`, 'All retry attempts failed — the customer has no delivery email. Use Admin → Orders to resend manually.'])
      continue
    }
    try {
      const ok = await retryRow(row.orderId, row.template)
      if (ok) sent += 1
    } catch (e) {
      logger.error({ err: e instanceof Error ? { message: e.message } : e, orderId: row.orderId }, 'outbox retry failed')
    }
  }
  if (due.length > 0) {
    await writeAudit({ action: 'email.outbox_retry', entity: 'order', diff: { due: due.length, sent } })
  }
  // P4: heartbeat AFTER the sweep — it only records runs that completed.
  await recordCronSuccess(RETRY_EMAILS_HEARTBEAT_KEY)
  return NextResponse.json({ ok: true, due: due.length, sent })
}

export const GET = asHandler(handle)
export const POST = asHandler(handle)
