// ═══════════════════════════════════════════════════════════
// Cron heartbeats (P4) — last successful run of the payments
// crons, surfaced in Admin → System with a 30-min staleness
// warning, plus a suppressed admin alert when reconciliation
// has not run for 2 hours (webhook-lost payments would then
// silently never fulfil).
//
// The staleness check runs in BOTH cron handlers: retry-emails
// acts as the buddy that notices a dead reconcile schedule,
// and reconcile notices its own post-outage resume.
// ═══════════════════════════════════════════════════════════

import { db } from '@/lib/db'
import { sendPaymentAlert } from '@/lib/admin-alerts'

export const RECONCILE_HEARTBEAT_KEY = 'reconcile-payments'
export const RETRY_EMAILS_HEARTBEAT_KEY = 'retry-emails'

/** Admin → System warning threshold for a silent cron. */
export const HEARTBEAT_WARN_MS = 30 * 60 * 1000
/** Alert threshold: reconciliation silent for 2 h must page the owner. */
export const RECONCILE_STALE_ALERT_MS = 2 * 3600 * 1000

/** Record a successful run (and clear any stale-gap alert suppression). */
export async function recordCronSuccess(key: string): Promise<void> {
  try {
    await db.cronHeartbeat.upsert({
      where: { key },
      create: { key, lastSuccessAt: new Date() },
      update: { lastSuccessAt: new Date(), staleAlertedAt: null },
    })
  } catch {
    // a heartbeat write must never fail the cron run it measures
  }
}

/** Pure + unit-testable: is the last successful run older than `maxAgeMs`? */
export function heartbeatStale(lastSuccessAt: Date | null | undefined, now: Date, maxAgeMs: number): boolean {
  if (!lastSuccessAt) return false // never ran — a fresh deployment, not a dead one
  return now.getTime() - lastSuccessAt.getTime() > maxAgeMs
}

/**
 * Fire ONE admin alert when reconciliation has not succeeded for 2 h.
 * Suppression lives on the heartbeat row (staleAlertedAt): the alert
 * repeats at most every 2 h while the outage persists, and a successful
 * reconcile run clears it (see recordCronSuccess). Never throws.
 */
export async function maybeAlertStaleReconcile(now: Date = new Date()): Promise<boolean> {
  try {
    const row = await db.cronHeartbeat.findUnique({ where: { key: RECONCILE_HEARTBEAT_KEY } })
    if (!row) return false
    if (!heartbeatStale(row.lastSuccessAt, now, RECONCILE_STALE_ALERT_MS)) return false
    if (row.staleAlertedAt && now.getTime() - row.staleAlertedAt.getTime() < RECONCILE_STALE_ALERT_MS) return false
    const ageHours = Math.floor((now.getTime() - row.lastSuccessAt.getTime()) / 3600_000)
    await sendPaymentAlert('Payment reconciliation has not run', [
      `Last successful reconcile: ${ageHours}h ago (${row.lastSuccessAt.toISOString()}).`,
      'Orders whose webhook was lost are only fulfilled by this cron — right now they stay pending and paid customers wait.',
      'Check the scheduler: vercel.json crons (Vercel Pro) or the external 10-minute curl with Bearer CRON_SECRET (docs/DEPLOYMENT.md).',
    ])
    await db.cronHeartbeat.update({ where: { key: RECONCILE_HEARTBEAT_KEY }, data: { staleAlertedAt: now } })
    return true
  } catch {
    return false
  }
}
