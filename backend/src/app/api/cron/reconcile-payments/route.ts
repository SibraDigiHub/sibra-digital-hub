// POST/GET /api/cron/reconcile-payments — repair lost webhooks (§6.6).
// Protected by `Authorization: Bearer $CRON_SECRET` (the transport guard
// already exempts /api/cron/*). Runs the pending-order sweep + prunes the
// 24 h IdempotencyKey TTL.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { asHandler, unauthorized } from '@/lib/api'
import { pruneRateLimits } from '@/lib/rate-limit'
import { secretsEqual } from '@/lib/timing-safe'
import { reconcilePendingBatch, auditReconcile } from '@/services/reconcile-service'
import { recordCronSuccess, maybeAlertStaleReconcile, RECONCILE_HEARTBEAT_KEY } from '@/services/cron-heartbeat'

export const dynamic = 'force-dynamic'

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  const header = req.headers.get('authorization') ?? ''
  return secretsEqual(header, `Bearer ${secret}`)
}

async function handle(req: NextRequest) {
  if (!authorized(req)) throw unauthorized('Cron bearer token required')
  // P4: post-outage self-detection — if the schedule was dead and just
  // resumed, the stored heartbeat is >2 h old and the owner gets one alert.
  await maybeAlertStaleReconcile()
  const results = await reconcilePendingBatch()
  await auditReconcile(results, 'cron')
  // §4: idempotency keys live 24 h — prune opportunistically on each sweep.
  await db.idempotencyKey.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } } }).catch(() => undefined)
  // Same housekeeping pass: expired rate-limit windows (previously never pruned).
  await pruneRateLimits()
  // P4: heartbeat AFTER the sweep — it only records runs that completed.
  await recordCronSuccess(RECONCILE_HEARTBEAT_KEY)
  return NextResponse.json({ ok: true, checked: results.length, results })
}

export const GET = asHandler(handle)
export const POST = asHandler(handle)
