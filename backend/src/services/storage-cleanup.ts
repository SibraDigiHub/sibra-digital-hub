// ═══════════════════════════════════════════════════════════
// Storage-cleanup §3 — DB orchestration: refcount → schedule → run.
//
// INVARIANTS (owner master prompt):
//   • Deletes happen ONLY after the referencing DB transaction has
//     committed — callers invoke scheduleDelete after their write.
//   • EVERY delete is refcount-checked first, again at run time:
//     a file referenced by ANY product / channel logo / site setting
//     (duplicate products copy media verbatim!) is never deleted.
//   • A failed delete never fails the save — rows go to StorageCleanup
//     and the storage-cleanup cron retries (network/429/5xx only),
//     heartbeats, and alerts the admin when retries are exhausted.
//   • Legacy refs without a fileId are deleted only on an unambiguous
//     path match — otherwise `unresolved` and reported, never removed.
// ═══════════════════════════════════════════════════════════
import { db } from '@/lib/db'
import { logger } from '@/lib/logger'
import { writeAudit } from '@/lib/audit'
import { sendPaymentAlert } from '@/lib/admin-alerts'
import { parseR2Ref } from '@/lib/r2'
import { classifyManagedRef, type ManagedRef } from '@/services/storage-refs'
import {
  imagekitApiConfigured,
  imagekitDeleteFile,
  imagekitFindFileIdByPath,
  imagekitPurgeUrls,
  r2DeleteObject,
  type ProviderResult,
} from '@/services/storage-providers'

const MAX_ATTEMPTS = 5
/** Backoff after a retryable failure: 5 min → 30 min → 2 h → 6 h. */
const BACKOFF_MS = [5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000]
/** Lease window claimed by a worker while it deletes (concurrent cron guard). */
const LEASE_MS = 2 * 60_000
/** Stop processing before the serverless budget is exhausted. */
const RUN_BUDGET_MS = 11_000
const BATCH = 25
/** Park interval when a provider is not configured yet (config state, not failure). */
const UNCONFIGURED_PARK_MS = 30 * 60_000

export type ScheduleReason = 'product_update' | 'product_purge' | 'upload_discard' | 'orphan_sweep'

/**
 * Reference scan over the FULL universe a managed file can appear in:
 * Product.images / videoPreviewUrl / fullVideoUrl / deliverableUrl,
 * Channel.logo, SiteSetting.value (free strings may embed URLs).
 * Substring matching on purpose — errs toward NOT deleting.
 */
export async function isReferenced(ref: string): Promise<boolean> {
  const [product, channel, setting] = await Promise.all([
    db.product.findFirst({
      where: {
        OR: [
          { images: { contains: ref } },
          { videoPreviewUrl: { contains: ref } },
          { fullVideoUrl: { contains: ref } },
          { deliverableUrl: { contains: ref } },
        ],
      },
      select: { id: true },
    }),
    db.channel.findFirst({ where: { logo: { contains: ref } }, select: { id: true } }),
    db.siteSetting.findFirst({ where: { value: { contains: ref } }, select: { key: true } }),
  ])
  return Boolean(product || channel || setting)
}

/**
 * Enqueue deletion for managed refs that are no longer referenced.
 * Callers MUST already have committed the DB change that removed the
 * reference. Returns the number of rows enqueued (0 = all still used).
 */
export async function scheduleDelete(refs: ManagedRef[], reason: ScheduleReason, entityId?: string): Promise<number> {
  let enqueued = 0
  for (const m of refs) {
    try {
      if (await isReferenced(m.ref)) continue
      await db.storageCleanup.upsert({
        where: { provider_fileRef: { provider: m.provider === 'ik' ? 'imagekit' : 'r2', fileRef: m.ref } },
        create: {
          provider: m.provider === 'ik' ? 'imagekit' : 'r2',
          fileRef: m.ref,
          fileId: m.fileId ?? null,
          reason,
          entityId: entityId ?? null,
        },
        update: { status: 'pending', nextAttemptAt: new Date(), ...(m.fileId ? { fileId: m.fileId } : {}) },
      })
      enqueued += 1
    } catch (e) {
      // Never fail the save because cleanup bookkeeping hiccuped.
      logger.error({ err: e instanceof Error ? { message: e.message } : e, ref: m.ref }, 'storage-cleanup schedule failed')
    }
  }
  return enqueued
}

async function processRow(row: { id: string; provider: string; fileRef: string; fileId: string | null; attempts: number; entityId: string | null }): Promise<'done' | 'retry' | 'unresolved' | 'failed'> {
  // Refcount AGAIN at run time — rows can wait in the queue while a
  // duplicate product or a site setting starts using the same file.
  if (await isReferenced(row.fileRef)) {
    await db.storageCleanup.update({ where: { id: row.id }, data: { status: 'done', lastError: 'skipped_still_referenced' } })
    await writeAudit({ action: 'storage.skip_referenced', entity: 'storage', entityId: row.id, diff: { ref: row.fileRef, provider: row.provider } })
    return 'done'
  }

  const managed = classifyManagedRef(row.fileRef)
  if (!managed) {
    // Ref no longer classifies as managed (env/endpoint changed) — park it.
    await db.storageCleanup.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(Date.now() + UNCONFIGURED_PARK_MS), lastError: 'unmanaged_ref' } })
    return 'retry'
  }

  let result: ProviderResult = { kind: 'unresolved', reason: 'unknown_provider' }
  let purgeUrls: string[] = []

  if (row.provider === 'r2') {
    const key = parseR2Ref(row.fileRef)
    if (!key) {
      result = { kind: 'unresolved', reason: 'invalid_r2_ref' }
    } else {
      const { r2Configured } = await import('@/lib/r2')
      if (!r2Configured()) {
        // Config state, not a failure — park and retry when credentials land.
        await db.storageCleanup.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(Date.now() + UNCONFIGURED_PARK_MS), lastError: 'r2_unconfigured' } })
        return 'retry'
      }
      result = await r2DeleteObject(key)
    }
  } else if (row.provider === 'imagekit') {
    if (!imagekitApiConfigured()) {
      await db.storageCleanup.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(Date.now() + UNCONFIGURED_PARK_MS), lastError: 'imagekit_unconfigured' } })
      return 'retry'
    }
    let fileId = row.fileId
    if (!fileId && managed.path) {
      const lookup = await imagekitFindFileIdByPath(managed.path)
      if (lookup.kind === 'ok' && lookup.fileId) fileId = lookup.fileId
      else if (lookup.kind === 'ok') result = { kind: 'unresolved', reason: 'lookup_no_file_id' }
      else result = lookup
    }
    if (fileId) {
      result = await imagekitDeleteFile(fileId)
      if (managed.ref.startsWith('http')) purgeUrls = [managed.ref]
    }
  }

  switch (result.kind) {
    case 'ok':
    case 'not_found': {
      await db.storageCleanup.update({ where: { id: row.id }, data: { status: 'done', lastError: null, fileId: row.fileId } })
      if (purgeUrls.length) await imagekitPurgeUrls(purgeUrls)
      await writeAudit({ action: 'storage.deleted', entity: 'storage', entityId: row.entityId ?? row.id, diff: { ref: row.fileRef, provider: row.provider } })
      return 'done'
    }
    case 'unresolved': {
      await db.storageCleanup.update({ where: { id: row.id }, data: { status: 'unresolved', lastError: result.reason, fileId: row.fileId } })
      return 'unresolved'
    }
    case 'retryable': {
      const attempts = row.attempts + 1
      const exhausted = attempts >= MAX_ATTEMPTS
      await db.storageCleanup.update({
        where: { id: row.id },
        data: {
          attempts: { increment: 1 },
          lastError: result.message.slice(0, 300),
          ...(exhausted ? { status: 'failed' } : { nextAttemptAt: new Date(Date.now() + (BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] ?? BACKOFF_MS[3])) }),
        },
      })
      if (exhausted) {
        await sendPaymentAlert('Storage cleanup retries exhausted', [`Ref ${row.fileRef}`, `Provider ${row.provider} kept failing — remove manually or check credentials.`])
      }
      return exhausted ? 'failed' : 'retry'
    }
    case 'failed': {
      await db.storageCleanup.update({ where: { id: row.id }, data: { status: 'failed', lastError: result.message.slice(0, 300) } })
      return 'failed'
    }
  }
}

export interface CleanupRunStats {
  deleted: number
  retried: number
  unresolved: number
  failed: number
  scanned: number
}

/** Lease + process due rows. Budget-limited; the cron calls this repeatedly. */
export async function runPendingDeletes(): Promise<CleanupRunStats> {
  const stats: CleanupRunStats = { deleted: 0, retried: 0, unresolved: 0, failed: 0, scanned: 0 }
  const due = await db.storageCleanup.findMany({
    where: { status: 'pending', nextAttemptAt: { lte: new Date() } },
    select: { id: true, provider: true, fileRef: true, fileId: true, attempts: true, entityId: true },
    orderBy: { createdAt: 'asc' },
    take: BATCH,
  })
  const startedAt = Date.now()
  for (const row of due) {
    if (Date.now() - startedAt > RUN_BUDGET_MS) break
    // Atomic lease so overlapping cron runs never double-delete.
    const leased = await db.storageCleanup.updateMany({
      where: { id: row.id, status: 'pending', nextAttemptAt: { lte: new Date() } },
      data: { nextAttemptAt: new Date(Date.now() + LEASE_MS) },
    })
    if (leased.count === 0) continue
    stats.scanned += 1
    try {
      const outcome = await processRow(row)
      if (outcome === 'done') stats.deleted += 1
      else if (outcome === 'retry') stats.retried += 1
      else if (outcome === 'unresolved') stats.unresolved += 1
      else stats.failed += 1
    } catch (e) {
      logger.error({ err: e instanceof Error ? { message: e.message } : e, ref: row.fileRef }, 'storage-cleanup row failed')
      await db.storageCleanup.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(Date.now() + (BACKOFF_MS[0] ?? 300_000)) } }).catch(() => undefined)
      stats.retried += 1
    }
  }
  return stats
}

/**
 * Ask the frontend to revalidate the cached catalog/sitemap after a
 * media-changing save (shared ISR tag `real-routes`). Best-effort and
 * silent when no frontend URL is configured — never fails the save.
 */
export async function notifyFrontendRevalidate(): Promise<boolean> {
  const base = process.env.PUBLIC_WEB_URL
  const key = process.env.INTERNAL_API_KEY
  if (!base || !key) return false
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/revalidate`, {
      method: 'POST',
      // The frontend proxy middleware re-stamps `x-internal-key` on every
      // /api/* request, so the revalidate route authenticates via
      // `x-revalidate-key` (same shared secret, unstamped header).
      headers: { 'x-internal-key': key, 'x-revalidate-key': key },
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  } catch {
    return false
  }
}
