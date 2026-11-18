// POST/GET /api/cron/storage-cleanup — refcounted storage deletion retry.
//
// Drains the StorageCleanup queue created by product saves / purges /
// abandoned-upload discards. Same skeleton as retry-emails (owner's cron
// pattern): Bearer CRON_SECRET, atomic leases, serverless budget, batch,
// heartbeat AFTER the sweep so Admin → System sees liveness.
import { NextRequest, NextResponse } from 'next/server'
import { asHandler, unauthorized } from '@/lib/api'
import { secretsEqual } from '@/lib/timing-safe'
import { logger } from '@/lib/logger'
import { runPendingDeletes } from '@/services/storage-cleanup'
import { recordCronSuccess, STORAGE_CLEANUP_HEARTBEAT_KEY } from '@/services/cron-heartbeat'

export const dynamic = 'force-dynamic'

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  const header = req.headers.get('authorization') ?? ''
  return secretsEqual(header, `Bearer ${secret}`)
}

async function handle(req: NextRequest) {
  if (!authorized(req)) throw unauthorized('Cron bearer token required')
  const stats = await runPendingDeletes()
  if (stats.scanned > 0) {
    logger.info({ deleted: stats.deleted, retried: stats.retried, unresolved: stats.unresolved, failed: stats.failed }, 'storage-cleanup sweep')
  }
  // Heartbeat only records runs that completed their sweep.
  await recordCronSuccess(STORAGE_CLEANUP_HEARTBEAT_KEY)
  return NextResponse.json({ ok: true, ...stats })
}

export const GET = asHandler(handle)
export const POST = asHandler(handle)
