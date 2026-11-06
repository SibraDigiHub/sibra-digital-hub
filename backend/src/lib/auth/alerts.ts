// ═══════════════════════════════════════════════════════════
// T4 security alerts — email via the existing email module.
// Failures NEVER block the action that triggered them, and the
// send happens after the response is committed (`after()` when
// inside a request; fire-and-forget elsewhere, e.g. CLI).
// ═══════════════════════════════════════════════════════════

import { after } from 'next/server'
import { logger } from '@/lib/logger'
import { sendSecurityAlertEmail } from '@/lib/email'

export interface SecurityAlertInput {
  to: string
  subject: string
  lines: string[]
}

/** Queue a security alert — safe inside and outside request scope. */
export function queueSecurityAlert(input: SecurityAlertInput): void {
  const run = async () => {
    try {
      await sendSecurityAlertEmail(input.to, input.subject, input.lines)
    } catch (e) {
      logger.warn({ err: e instanceof Error ? e.message : e }, 'security alert failed (non-blocking)')
    }
  }
  try {
    // after() registers work for after the response is committed; it throws
    // when called outside a request scope (CLI) — fall back to void.
    after(() => {
      void run()
    })
  } catch {
    void run()
  }
}

export const ALERTS = {
  newDevice: (email: string, device: string) => ({
    to: email,
    subject: 'New device signed in to your admin account',
    lines: [`A new device (fingerprint ${device}) just completed sign-in.`, 'If this wasn\'t you, change your password and review active sessions.'],
  }),
  passwordChanged: (email: string) => ({
    to: email,
    subject: 'Your admin password was changed',
    lines: ['Your admin password was just changed.', 'All sessions were signed out. If this wasn\'t you, use the break-glass CLI immediately.'],
  }),
  totpAdded: (email: string) => ({
    to: email,
    subject: 'Authenticator app (TOTP) enabled',
    lines: ['Two-factor authentication via authenticator app is now active on your admin account.'],
  }),
  totpRemoved: (email: string) => ({
    to: email,
    subject: 'Authenticator app (TOTP) disabled',
    lines: ['TOTP two-factor authentication was removed from your admin account.'],
  }),
  passkeyAdded: (email: string, name: string) => ({
    to: email,
    subject: 'New passkey added',
    lines: [`A passkey named "${name}" was added to your admin account.`],
  }),
  passkeyRemoved: (email: string, name: string) => ({
    to: email,
    subject: 'Passkey removed',
    lines: [`The passkey "${name}" was removed from your admin account.`],
  }),
  recoveryRegenerated: (email: string) => ({
    to: email,
    subject: 'Recovery codes regenerated',
    lines: ['Your 10 recovery codes were regenerated. Previous codes no longer work.'],
  }),
  locked: (email: string, minutes: number) => ({
    to: email,
    subject: 'Admin account locked — repeated failed passwords',
    lines: [`Your admin account was locked for ${minutes} minute(s) after repeated failed password attempts.`],
  }),
  failedLogins: (email: string, count: number) => ({
    to: email,
    subject: 'Multiple failed admin sign-ins',
    lines: [`${count} failed admin sign-in attempts occurred within 15 minutes against your account.`],
  }),
  resetRequested: (email: string) => ({
    to: email,
    subject: 'Password reset requested',
    lines: ['A password reset was requested for your admin account.', 'If this wasn\'t you, ignore this email — the link expires unused.'],
  }),
} as const
