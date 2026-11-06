// ═══════════════════════════════════════════════════════════
// Payment admin alerts (dual payment §6.8) — signature
// failures, amount/merchant mismatches, disputes, stuck
// orders, delivery failures. Fire-and-forget: alerting must
// never break a payment flow. Recipient = PAYMENT_ALERT_EMAIL,
// else the first admin user. Never includes secrets.
// ═══════════════════════════════════════════════════════════

import { db } from '@/lib/db'
import { sendSecurityAlertEmail } from '@/lib/email'

async function recipient(): Promise<string | null> {
  const explicit = process.env.PAYMENT_ALERT_EMAIL?.trim()
  if (explicit) return explicit
  try {
    const admin = await db.adminUser.findFirst({ orderBy: { createdAt: 'asc' }, select: { email: true } })
    return admin?.email ?? null
  } catch {
    return null
  }
}

/** Best-effort payment alert (never throws). */
export async function sendPaymentAlert(subject: string, bodyLines: string[]): Promise<void> {
  try {
    const to = await recipient()
    if (!to) return
    await sendSecurityAlertEmail(to, subject, bodyLines)
  } catch {
    // alerts must never break payment flows
  }
}
