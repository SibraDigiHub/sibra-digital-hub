// ═══════════════════════════════════════════════════════════
// T4 sessions — opaque 32-byte tokens (sha256 stored), server-side
// rows in AdminSession, absolute 12 h + idle 60 min lifetime,
// UA soft-binding, stage-based route allowlists and CSRF.
//
// Cookies (dual set, preserving the T1–T3 iframe-preview behaviour):
//   main: `sdh_admin` (dev) / `__Host-sdh_admin` (prod https),
//         HttpOnly + SameSite=Strict + Secure(https) + Path=/ , no Domain
//   twin: `sdh_admin_p` SameSite=None; Secure; Partitioned — CHIPS cookie
//         so the embedded cross-origin preview keeps working.
// ═══════════════════════════════════════════════════════════

import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import type { AdminSession, AdminUser } from '@prisma/client'
import { ApiError, unauthorized } from '@/lib/api'
import { db } from '@/lib/db'
import { hashIp, hashUa, randomToken, sha256Hex, safeEqualHex } from '@/lib/auth/crypto'

export const COOKIE_NAME = 'sdh_admin'
export const COOKIE_NAME_HOST = '__Host-sdh_admin'
/** CHIPS twin of the main cookie for cross-origin iframe previews. */
export const COOKIE_NAME_PARTITIONED = 'sdh_admin_p'

export const STAGE_PENDING_2FA = 'PENDING_2FA'
export const STAGE_ENROLL = 'ENROLL'
export const STAGE_FULL = 'FULL'

// Lifetimes
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60_000 // 12 h
export const SESSION_IDLE_MS = 60 * 60_000 // 60 min sliding
export const PENDING_2FA_MS = 5 * 60_000 // 5 min

/** Paths a non-FULL session may touch (stage allowlist, checked in requireAdmin). */
const PENDING_2FA_ALLOWED = [
  '/api/admin/login/2fa',
  '/api/admin/login/passkey/options',
  '/api/admin/login/passkey/verify',
  '/api/admin/logout',
  '/api/admin/session',
]
const ENROLL_ALLOWED = [
  '/api/admin/2fa/enroll',
  '/api/admin/2fa/confirm',
  '/api/admin/2fa/disable',
  '/api/admin/passkeys',
  '/api/admin/passkeys/register/options',
  '/api/admin/passkeys/register/verify',
  '/api/admin/recovery-codes/regenerate',
  '/api/admin/logout',
  '/api/admin/session',
]

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** true when cookies must be __Host-/Secure (production https). */
function hostPrefixEnabled(): boolean {
  return process.env.NODE_ENV === 'production'
}

export function currentStageAllowlist(stage: string): string[] {
  if (stage === STAGE_PENDING_2FA) return PENDING_2FA_ALLOWED
  if (stage === STAGE_ENROLL) return ENROLL_ALLOWED
  return []
}

// ── Request helpers ─────────────────────────────────────────

/**
 * Client IP for rate limiting / audit hashing — CANNOT be chosen by the
 * browser. `x-client-ip` is set (overwritten) by our own frontend proxy
 * from the LAST x-forwarded-for hop, i.e. the hop our trusted edge
 * appended; the raw first hop is client-forgeable and is never trusted.
 * Direct callers (gateway webhooks) have no proxy header and fall back
 * to the last XFF hop / x-real-ip / 'unknown'.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  const hops = xff
    ? xff
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean)
    : []
  return (
    req.headers.get('x-client-ip') ||
    hops[hops.length - 1] ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
}

/** Session token from either cookie name (Host-prefixed → legacy → CHIPS twin). */
export function readSessionToken(req: Request): string | null {
  const header = req.headers.get('cookie')
  if (!header) return null
  for (const name of [COOKIE_NAME_HOST, COOKIE_NAME, COOKIE_NAME_PARTITIONED]) {
    const m = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
    if (m?.[1]) return decodeURIComponent(m[1])
  }
  return null
}

function allowedOrigins(): string[] {
  const origins = new Set<string>()
  const add = (u?: string | null) => {
    if (!u) return
    try {
      origins.add(new URL(u).origin)
    } catch {
      /* ignore malformed env values */
    }
  }
  add(process.env.PUBLIC_WEB_URL)
  add(process.env.ADMIN_WEBAUTHN_ORIGIN)
  if (process.env.NODE_ENV !== 'production') {
    // Dev conveniences: the frontend origin and the backend's own origin.
    add('http://localhost:3000')
    add('http://127.0.0.1:3000')
    add('http://localhost:3001')
    add('http://127.0.0.1:3001')
  }
  return [...origins]
}

/**
 * CSRF: state-changing admin requests must come from an allowed Origin AND
 * carry X-CSRF-Token matching the session's csrfHash (returned by the session
 * endpoint + login responses). Pre-auth endpoints (login, forgot/reset) never
 * call requireAdmin — they rely on their own rate limits instead.
 */
function assertCsrf(req: NextRequest, session: AdminSession): void {
  if (READ_METHODS.has(req.method)) return
  const origin = req.headers.get('origin')
  const token = req.headers.get('x-csrf-token') ?? ''
  const tokenOk = token !== '' && safeEqualHex(token, session.csrfHash)
  if (origin && allowedOrigins().includes(origin)) {
    if (!tokenOk) throw new ApiError(403, 'Forbidden — missing or invalid CSRF token', 'csrf_token')
    return
  }
  // Non-production (sandbox/preview) convenience: the browsing origin of a
  // hosted preview is not knowable ahead of time, so a request whose
  // session-bound CSRF token verifies is accepted even when its Origin is
  // not in the allowlist — only the real admin's browser can hold that
  // token. Production always keeps the strict origin allowlist.
  if (process.env.NODE_ENV !== 'production' && tokenOk) return
  throw new ApiError(403, 'Forbidden — bad origin', 'csrf_origin')
}

export interface ResolvedSession {
  session: AdminSession
  admin: AdminUser
}

/**
 * Resolve + validate the current session from the request cookie:
 * unexpired (absolute), not revoked, idle window not exceeded, UA soft-bound.
 * Slides lastSeenAt forward on success (throttled to one write / 30 s).
 */
export async function resolveSession(req: NextRequest): Promise<ResolvedSession | null> {
  const token = readSessionToken(req)
  if (!token) return null
  const tokenHash = sha256Hex(token)
  const session = await db.adminSession.findUnique({ where: { tokenHash }, include: { admin: true } })
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null
  if (session.lastSeenAt.getTime() + SESSION_IDLE_MS <= Date.now()) return null

  // Soft UA binding: reject when the client's user-agent hash changed.
  const uaHash = hashUa(req.headers.get('user-agent') ?? '')
  if (session.uaHash && session.uaHash !== uaHash) return null

  // Sliding idle window (throttled).
  if (Date.now() - session.lastSeenAt.getTime() > 30_000) {
    await db.adminSession
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined)
  }
  return { session, admin: session.admin }
}

/**
 * THE gate for every /api/admin/* handler. Throws ApiError 401/403 — route
 * handlers stay thin (asHandler maps it to the uniform JSON error).
 */
export async function requireAdmin(req: NextRequest): Promise<ResolvedSession> {
  const resolved = await resolveSession(req)
  if (!resolved) throw unauthorized()
  const { session } = resolved

  // Stage allowlist: PENDING_2FA / ENROLL sessions may only touch their routes.
  if (session.stage !== STAGE_FULL) {
    const allow = currentStageAllowlist(session.stage)
    if (!allow.includes(req.nextUrl.pathname)) throw unauthorized()
  }

  assertCsrf(req, session)
  return resolved
}

// ── Session lifecycle ───────────────────────────────────────

export interface CreateSessionInput {
  adminId: string
  stage: string
  ip: string
  ua: string
  /** Custom lifetime (PENDING_2FA uses 5 min). Absolute cap stays 12 h. */
  lifetimeMs?: number
}

export interface IssuedSession {
  token: string
  csrfToken: string
  session: AdminSession
}

/** Create a session row + return the opaque token (only sha256 is stored). */
export async function createSession(input: CreateSessionInput): Promise<IssuedSession> {
  const token = randomToken()
  // The CSRF token the client echoes is the STORED csrfHash (sha256 of a fresh
  // random). Cross-origin attackers can never read the JSON body to learn it.
  const csrfToken = sha256Hex(randomToken())
  const lifetimeMs = input.lifetimeMs ?? SESSION_ABSOLUTE_MS
  const session = await db.adminSession.create({
    data: {
      adminId: input.adminId,
      tokenHash: sha256Hex(token),
      csrfHash: csrfToken,
      stage: input.stage,
      ipHash: input.ip === 'unknown' ? null : hashIp(input.ip),
      uaHash: hashUa(input.ua),
      expiresAt: new Date(Date.now() + lifetimeMs),
    },
  })
  return { token, csrfToken, session }
}

/**
 * 2FA success ⇒ brand-new session id (anti-fixation): revoke + delete the old
 * row, issue a fresh FULL session with new token AND new CSRF token.
 */
export async function rotateSession(oldSessionId: string, adminId: string, ip: string, ua: string): Promise<IssuedSession> {
  await db.adminSession.deleteMany({ where: { id: oldSessionId } }).catch(() => undefined)
  return createSession({ adminId, stage: STAGE_FULL, ip, ua })
}

export async function revokeSessionById(id: string): Promise<void> {
  await db.adminSession.updateMany({ where: { id }, data: { revokedAt: new Date() } }).catch(() => undefined)
}

export async function revokeAllSessionsForAdmin(adminId: string, exceptSessionId?: string): Promise<number> {
  const res = await db.adminSession.updateMany({
    where: { adminId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  })
  return res.count
}

// ── Cookies (dual set — main + CHIPS twin) ──────────────────

export async function setSessionCookies(token: string, maxAgeSec: number): Promise<void> {
  const store = await cookies()
  const name = hostPrefixEnabled() ? COOKIE_NAME_HOST : COOKIE_NAME
  // 1) Main first-party cookie — SameSite=Strict per T4 spec.
  store.set(name, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: hostPrefixEnabled(),
    maxAge: maxAgeSec,
    path: '/',
  })
  // 2) CHIPS partitioned twin for embedded cross-origin preview contexts.
  //    Browsers over plain HTTP reject Secure — harmless, the main cookie
  //    covers first-party usage. Read path accepts BOTH names.
  store.set(COOKIE_NAME_PARTITIONED, token, {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    partitioned: true,
    maxAge: maxAgeSec,
    path: '/',
  })
}

export async function clearSessionCookies(): Promise<void> {
  const store = await cookies()
  for (const name of [COOKIE_NAME_HOST, COOKIE_NAME]) {
    store.set(name, '', { httpOnly: true, sameSite: 'strict', secure: hostPrefixEnabled(), maxAge: 0, path: '/' })
  }
  // The partitioned twin must be cleared with its own attributes.
  store.set(COOKIE_NAME_PARTITIONED, '', {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    partitioned: true,
    maxAge: 0,
    path: '/',
  })
}

/** Cookie presence check (no verification) — admin-gated GETs must never be cached. */
export function hasAdminSessionCookie(req: NextRequest): boolean {
  return Boolean(readSessionToken(req))
}
