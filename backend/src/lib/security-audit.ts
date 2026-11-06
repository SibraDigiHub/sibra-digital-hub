// ═══════════════════════════════════════════════════════════
// Security audit + alerts.
// • Every auth event lands in AuditLog (entity 'auth') with the
//   IP stored as a salted hash — never a raw address.
// • Security-alert emails go through the existing Resend module;
//   send failures never block the action (logged instead).
// • Logs never contain passwords, tokens, codes, or clear emails.
// ═══════════════════════════════════════════════════════════

import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { clientIp } from '@/lib/admin-session'
import { pepperHash } from '@/lib/crypto'
import { sendSecurityAlertEmail } from '@/lib/email'

export interface SecurityEventInput {
  adminId: string | null
  action: string // auth.login | auth.login_failed | auth.2fa_enabled | …
  req?: NextRequest
  label?: string
  meta?: Record<string, unknown>
}

export async function logSecurityEvent(input: SecurityEventInput): Promise<void> {
  try {
    const ip = input.req ? clientIp(input.req) : null
    await db.auditLog.create({
      data: {
        adminId: input.adminId,
        action: input.action.slice(0, 80),
        entity: 'auth',
        entityId: input.adminId,
        label: input.label?.slice(0, 200) ?? null,
        ip: ip ? pepperHash(ip).slice(0, 32) : null, // short salted hash for display
        meta: (input.meta ?? {}) as never,
      },
    })
  } catch {
    // audit must never break the auth flow itself
  }
}

/** Kinds of security alert emails. Subject lines live in ALERT_SUBJECTS. */
export type SecurityAlertKind =
  | 'new_device'
  | 'failed_logins'
  | 'account_locked'
  | 'password_changed'
  | 'password_reset'
  | 'totp_added'
  | 'totp_removed'
  | 'passkey_added'
  | 'passkey_removed'
  | 'recovery_regenerated'

const ALERT_SUBJECTS: Record<SecurityAlertKind, string> = {
  new_device: 'New device signed in to your admin account',
  failed_logins: 'Multiple failed admin sign-ins',
  account_locked: 'Admin account locked — repeated failed passwords',
  password_changed: 'Your admin password was changed',
  password_reset: 'Password reset completed',
  totp_added: 'Authenticator app (TOTP) enabled',
  totp_removed: 'Authenticator app (TOTP) disabled',
  passkey_added: 'New passkey added',
  passkey_removed: 'Passkey removed',
  recovery_regenerated: 'Recovery codes regenerated',
}

/** Fire-and-forget security alert email (never throws, never blocks). */
export async function notifySecurityEvent(kind: SecurityAlertKind, to: string, detail?: string): Promise<void> {
  try {
    await sendSecurityAlertEmail(to, ALERT_SUBJECTS[kind], detail ? [detail] : [])
  } catch {
    // email failures must never block auth actions
  }
}
