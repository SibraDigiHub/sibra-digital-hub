// ═══════════════════════════════════════════════════════════
// Webhook idempotency (P3) — the shared duplicate rule for
// both gateway receivers.
//
// An event is only a DUPLICATE when its stored result is
// terminal/handled (fulfilled, ignored, rejected, …). A row
// whose result is null (processing never finished — crash,
// deploy, 500) or 'failed' must be RE-PROCESSED on redelivery:
// fulfilOrder is atomic (pending→paid exactly once), the email
// outbox is unique per (order, template), and refund/dispute
// handlers are idempotent — so redelivery is safe and lets a
// gateway retry after a 500 recover without waiting for cron.
// ═══════════════════════════════════════════════════════════

import { db } from '@/lib/db'

/** Results that mean "this event reached a decision — never redo it". */
const TERMINAL_RESULTS: ReadonlySet<string> = new Set([
  'fulfilled',
  'duplicate',
  'ignored',
  'unmatched',
  'amount_mismatch',
  'order_not_fulfillable',
  'mismatch',
  'rejected',
])

/** Pure + exported for unit tests: null/''/'failed'/unknown ⇒ re-process. */
export function isTerminalWebhookResult(result: string | null | undefined): boolean {
  return result !== null && result !== undefined && result !== '' && TERMINAL_RESULTS.has(result)
}

/**
 * On a duplicate delivery: 200-no-op when the stored result is terminal,
 * otherwise reset the row so this run re-processes the event and can stamp
 * a fresh result. Returns true when the caller may proceed with processing.
 */
export async function claimEventForReprocessing(eventId: string): Promise<boolean> {
  const stored = await db.webhookEvent.findUnique({ where: { eventId }, select: { result: true } })
  if (stored && isTerminalWebhookResult(stored.result)) return false
  await db.webhookEvent
    .update({ where: { eventId }, data: { result: null, processedAt: new Date() } })
    .catch(() => undefined)
  return true
}
