// POST /api/admin/storage/discard — abandoned-upload cleanup (best effort).
//
// The admin form tracks every upload made during the CURRENT session.
// On Cancel / close / navigation-away it `navigator.sendBeacon`s those
// refs here so half-finished uploads don't become permanent orphans.
// sendBeacon cannot set headers, so the SAME session-bound CSRF token
// may arrive in the JSON body (assertCsrfFlexible — identical strength).
//
// Safety rails (owner master prompt):
//   • full admin session + CSRF + same-origin rules (non-GET),
//   • every ref validated to be a MANAGED file (R2 private-deliverables
//     or ImageKit endpoint under our folders) — seed `/images/...`,
//     YouTube, external hosts are refused outright,
//   • reference-count check per ref (scheduleDelete) — a file another
//     record saved meanwhile is protected,
//   • deletion is queued + run best-effort; failures retry via the
//     storage-cleanup cron; the response never leaks file metadata
//     beyond the refs the admin's own form just sent.
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { asHandler, json, readJsonCapped, tooMany, unauthorized } from '@/lib/api'
import { resolveSession, assertCsrfFlexible, clientIp, STAGE_FULL } from '@/lib/auth/session'
import { consumeRateLimit } from '@/lib/auth/rate-limit'
import { writeAudit } from '@/lib/audit'
import { classifyManagedRef, type ManagedRef } from '@/services/storage-refs'
import { runPendingDeletes, scheduleDelete } from '@/services/storage-cleanup'

export const dynamic = 'force-dynamic'

const discardSchema = z.object({
  // Session-bound CSRF token for sendBeacon (which cannot set headers).
  csrf: z.string().max(128).optional(),
  refs: z.array(z.object({
    ref: z.string().min(1).max(2048),
    fileId: z.string().min(1).max(128).optional(),
  })).min(1).max(50),
}).strict()

export const POST = asHandler(async (req: NextRequest) => {
  const resolved = await resolveSession(req)
  if (!resolved || resolved.session.stage !== STAGE_FULL) throw unauthorized()

  // 10 bursts / min per IP — the form sends at most one beacon per abandon.
  const limit = await consumeRateLimit(`storage-discard:${clientIp(req)}`, 10, 60_000)
  if (!limit.allowed) return tooMany(limit.retryAfterSec)

  const body = (await readJsonCapped(req)) as unknown
  const parsed = discardSchema.safeParse(body)
  if (!parsed.success) return json({ ok: false, error: 'Invalid discard payload' }, { status: 400 })

  assertCsrfFlexible(req, resolved.session, parsed.data.csrf)

  // Managed-only classification — anything else is refused (never deleted).
  const managed: ManagedRef[] = []
  for (const item of parsed.data.refs) {
    const m = classifyManagedRef(item.ref)
    if (m && m.provider === 'ik' && item.fileId) m.fileId = item.fileId
    if (m) managed.push(m)
  }
  if (managed.length === 0) return json({ ok: true, discarded: 0, deferred: 0 })

  // Refcount check happens inside scheduleDelete — a file any product,
  // channel or setting references is never enqueued.
  const enqueued = await scheduleDelete(managed, 'upload_discard', resolved.admin.id)
  // Best-effort immediate run (budgeted); leftovers retry via the cron.
  const stats = await runPendingDeletes()

  await writeAudit({
    action: 'storage.discard',
    entity: 'storage',
    entityId: resolved.admin.id,
    diff: { refs: managed.map((m) => m.ref), enqueued, deleted: stats.deleted },
    req,
  })
  return json({ ok: true, discarded: stats.deleted, deferred: enqueued - stats.deleted })
})
