// ═══════════════════════════════════════════════════════════
// Admin auth — compatibility shim (T4).
//
// The legacy passcode/JWT system is GONE (removed in T4): no shared passcode,
// no SESSION_SECRET, no in-memory rate limiter. Everything real lives in:
//   lib/auth/session.ts   — sessions, cookies, CSRF, requireAdmin
//   lib/auth/crypto.ts    — hashing/encryption primitives
//   services/admin-auth-service.ts — login, 2FA, reset, lockout
//
// This shim keeps the small read-side surface that NON-admin routes
// (products/faqs/reviews/settings/orders internals — T5 scope) still
// import, now backed by real server-side sessions.
// ═══════════════════════════════════════════════════════════

import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import {
  COOKIE_NAME,
  COOKIE_NAME_HOST,
  COOKIE_NAME_PARTITIONED,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  STAGE_FULL,
  readSessionToken,
} from '@/lib/auth/session'
import { sha256Hex } from '@/lib/auth/crypto'

export { hasAdminSessionCookie, clientIp } from '@/lib/auth/session'

/** Standard 401 response for the non-/admin endpoints that still use it. */
export function unauthorized() {
  return Response.json({ error: 'Unauthorized — admin session required' }, { status: 401 })
}

/**
 * True when the request carries a valid, unexpired FULL admin session.
 * Replaces the old JWT check with a real server-side session lookup.
 */
export async function isAdmin(): Promise<boolean> {
  const store = await cookies()
  const token =
    store.get(COOKIE_NAME_HOST)?.value ??
    store.get(COOKIE_NAME)?.value ??
    store.get(COOKIE_NAME_PARTITIONED)?.value
  if (!token) return false
  const session = await db.adminSession.findUnique({ where: { tokenHash: sha256Hex(token) } })
  if (!session) return false
  if (session.revokedAt || session.stage !== STAGE_FULL) return false
  if (session.expiresAt.getTime() <= Date.now()) return false
  if (session.lastSeenAt.getTime() + SESSION_IDLE_MS <= Date.now()) return false
  return true
}

// Session lifetimes are re-exported for scripts/tests.
export { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS }
