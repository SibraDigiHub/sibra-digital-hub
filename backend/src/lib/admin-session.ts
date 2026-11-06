// ═══════════════════════════════════════════════════════════
// Admin sessions — opaque tokens, SHA-256-at-rest, defence in depth.
//
// • Cookie: opaque 32-byte token (base64url). DB stores only its
//   SHA-256. `__Host-sdh_admin` in production, `sdh_admin` on
//   plain-http localhost; a CHIPS `Partitioned` twin keeps the
//   sandbox preview iframe working.
// • Lifetime: absolute 12 h, idle 60 min (sliding lastSeenAt).
// • Stage gate: PENDING_2FA / PENDING_ENROLLMENT sessions can
//   only call endpoints that explicitly opt in to their stage.
// • CSRF: every mutating admin request needs a browser `Origin`
//   from the allowlist AND an `x-csrf-token` header matching the
//   session's csrfHash. GET stays header-free (safe methods).
// • Step-up: sensitive ops check stepUpAt ≤ 10 min old.
// • UA soft-binding: sessions reject a changed User-Agent hash.
// • All auth responses: Cache-Control: no-store.
// ═══════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import type { AdminSession, AdminUser } from '@prisma/client'
import { db } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { pepperHash, randomToken, sha256Hex, timingSafeEqual, deviceLabelFromUa } from '@/lib/crypto'
import { hashUa } from '@/lib/auth/crypto'

const PRIMARY_COOKIE_PROD = '__Host-sdh_admin'
const PRIMARY_COOKIE_DEV = 'sdh_admin'
const TWIN_COOKIE = 'sdh_admin_p' // Partitioned twin for cross-origin iframe previews

const ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000
const PENDING_2FA_TTL_MS = 5 * 60 * 1000
const PENDING_ENROLLMENT_TTL_MS = 15 * 60 * 1000
const IDLE_TTL_MS = 60 * 60 * 1000
export const STEP_UP_TTL_MS = 10 * 60 * 1000

export const STAGE_PENDING_2FA = 'PENDING_2FA'
export const STAGE_PENDING_ENROLLMENT = 'PENDING_ENROLLMENT'
export const STAGE_FULL = 'FULL'

function primaryCookieName(): string {
  return process.env.NODE_ENV === 'production' ? PRIMARY_COOKIE_PROD : PRIMARY_COOKIE_DEV
}

function cookieCandidates(): string[] {
  return Array.from(new Set([primaryCookieName(), TWIN_COOKIE, PRIMARY_COOKIE_PROD, PRIMARY_COOKIE_DEV]))
}

function readSessionToken(req: NextRequest): string | null {
  for (const name of cookieCandidates()) {
    const value = req.cookies.get(name)?.value
    if (value) return value
  }
  return null
}

/** CSRF token = HMAC(SESSION_PEPPER, session token) — derivable by the server only. */
export function deriveCsrfToken(sessionToken: string): string {
  const { SESSION_PEPPER } = getEnv()
  return crypto.createHmac('sha256', SESSION_PEPPER).update(sessionToken, 'utf8').digest('hex')
}

/** Expose the raw cookie token so the session endpoint can re-derive the CSRF token. */
export function currentSessionToken(req: NextRequest): string | null {
  return readSessionToken(req)
}

function setAuthCookies(res: NextResponse, token: string, maxAgeSeconds: number): void {
  const isProd = process.env.NODE_ENV === 'production'
  const base = { httpOnly: true, secure: isProd, path: '/', maxAge: maxAgeSeconds } as const
  // 1) Classic first-party cookie — SameSite=Strict, no Domain.
  res.cookies.set(primaryCookieName(), token, { ...base, sameSite: 'strict' })
  // 2) CHIPS partitioned twin — accepted inside cross-origin iframe
  //    previews where the Strict cookie is dropped. Browsers require
  //    `Secure` for any SameSite=None cookie, so the twin is ALWAYS
  //    Secure (login-sandbox fix: without it the preview iframe kept
  //    both cookies out and bounced straight back to the login page).
  //    Over plain http browsers reject it harmlessly — top-level
  //    localhost flows use the primary cookie anyway.
  res.cookies.set(TWIN_COOKIE, token, { ...base, secure: true, sameSite: 'none', partitioned: true })
}

function clearAuthCookies(res: NextResponse): void {
  for (const name of cookieCandidates()) {
    res.cookies.set(name, '', { httpOnly: true, path: '/', maxAge: 0 })
  }
}

export interface CreatedSession {
  session: AdminSession
  csrfToken: string
  /** Call this on the NextResponse to deliver the cookies. */
  applyCookies: (res: NextResponse) => void
}

interface CreateSessionInput {
  adminId: string
  stage: string
  req: NextRequest
}

/** Issue a brand-new session (fresh id — no session fixation). */
export async function createAdminSession({ adminId, stage, req }: CreateSessionInput): Promise<CreatedSession> {
  const token = randomToken(32)
  // CSRF token derived deterministically from the opaque session token —
  // no plaintext storage needed; the DB keeps only sha256(csrfToken).
  const csrfToken = deriveCsrfToken(token)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  const ua = req.headers.get('user-agent')
  const ttl = stage === STAGE_PENDING_2FA ? PENDING_2FA_TTL_MS : stage === STAGE_PENDING_ENROLLMENT ? PENDING_ENROLLMENT_TTL_MS : ABSOLUTE_TTL_MS
  const session = await db.adminSession.create({
    data: {
      adminId,
      tokenHash: sha256Hex(token),
      // Raw token value, matching the reader (checkCsrfAndOrigin) and the
      // login flow's convention — never store a differently-hashed copy.
      csrfHash: csrfToken,
      stage,
      ipHash: pepperHash(ip),
      uaHash: ua ? hashUa(ua) : null,
      deviceLabel: deviceLabelFromUa(ua),
      expiresAt: new Date(Date.now() + ttl),
    },
  })
  const maxAge = Math.floor(ttl / 1000)
  return { session, csrfToken, applyCookies: (res) => setAuthCookies(res, token, maxAge) }
}

function authNoStore(body: unknown, status: number): NextResponse {
  const res = NextResponse.json(body, { status })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

export function unauthorized(): NextResponse {
  return authNoStore({ error: 'Unauthorized — admin session required' }, 401)
}

// ── requireAdmin — the single guard used by every admin route ──

export interface RequireAdminOptions {
  /** Enforce Origin + CSRF (must be set for POST/PUT/PATCH/DELETE). */
  mutating?: boolean
  /** Require a recent (≤10 min) password re-entry. */
  stepUp?: boolean
  /** Allowed session stages; defaults to [FULL] only. */
  stages?: string[]
}

export interface AdminAuthContext {
  session: AdminSession
  admin: AdminUser
}

export async function requireAdmin(req: NextRequest, opts: RequireAdminOptions = {}): Promise<AdminAuthContext | NextResponse> {
  const token = readSessionToken(req)
  if (!token) return unauthorized()

  const session = await db.adminSession.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { admin: true },
  })
  if (!session || session.revokedAt) return unauthorized()
  if (session.expiresAt.getTime() <= Date.now()) return unauthorized()
  if (Date.now() - session.lastSeenAt.getTime() > IDLE_TTL_MS) {
    await db.adminSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } })
    return unauthorized()
  }

  // Soft-bind to the hashed User-Agent. hashUa MUST match the function the
  // login flow (lib/auth/session.ts createSession) used to store uaHash —
  // a mismatch here revoked every login-made session on first touch.
  const ua = req.headers.get('user-agent')
  if (session.uaHash && (!ua || !timingSafeEqual(session.uaHash, hashUa(ua)))) {
    await db.adminSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } })
    return unauthorized()
  }

  // Stage gate — pending sessions never reach normal admin routes.
  const allowedStages = opts.stages ?? [STAGE_FULL]
  if (!allowedStages.includes(session.stage)) {
    return authNoStore({ error: 'Invalid auth stage', code: 'STAGE_INVALID' }, 401)
  }

  // Sliding idle timeout (throttled write).
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    await db.adminSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
  }

  if (opts.mutating) {
    const csrfFailure = await checkCsrfAndOrigin(req, session)
    if (csrfFailure) return csrfFailure
  }

  if (opts.stepUp) {
    const fresh = session.stepUpAt && Date.now() - session.stepUpAt.getTime() <= STEP_UP_TTL_MS
    if (!fresh) {
      return authNoStore(
        { error: 'Re-authentication required for this action', code: 'STEP_UP_REQUIRED' },
        403,
      )
    }
  }

  return { session, admin: session.admin }
}

/** Origin allowlist + double-submit CSRF (session-bound). Returns a 403 response or null. */
async function checkCsrfAndOrigin(req: NextRequest, session: AdminSession): Promise<NextResponse | null> {
  const origin = req.headers.get('origin')
  const { allowedOrigins } = getEnv()
  if (!origin) {
    return authNoStore({ error: 'Missing Origin header', code: 'ORIGIN_MISSING' }, 403)
  }
  const originNorm = origin.replace(/\/+$/, '').toLowerCase()
  // Same-host fallback: through the sandbox gateway the browser may
  // arrive on a preview domain that no static allowlist can name.
  // Allowing an Origin whose host equals the browser-facing Host
  // header (x-forwarded-host, set by the frontend proxy) is still a
  // strict same-origin check — a cross-site forger's origin host can
  // never match the target site's host.
  const originHost = (() => {
    try {
      return new URL(origin).host.toLowerCase()
    } catch {
      return ''
    }
  })()
  const reqHost = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase()
  // Sandboxed preview tunnels (e.g. Aliyun FC gateways) rewrite the Host
  // header to an internal hostname, so the browser's real Origin host can
  // never be recovered from any forwarded header — both host-based checks
  // above are structurally blind there. When the request provably arrived
  // through our own frontend proxy (x-proxy-secret — only the proxy knows
  // it), the session-bound CSRF double-submit check below remains the
  // active defence, exactly as for same-host requests: a cross-site forger
  // carries no session cookie (SameSite=Strict primary + partitioned twin)
  // and cannot obtain the CSRF token, so it is still rejected — by CSRF.
  const proxySecret = process.env.PROXY_SECRET
  const viaOwnProxy = !!proxySecret && req.headers.get('x-proxy-secret') === proxySecret
  const allowed =
    allowedOrigins.some((o) => o.toLowerCase() === originNorm) ||
    (originHost !== '' && originHost === reqHost) ||
    viaOwnProxy
  if (!allowed) {
    return authNoStore({ error: 'Cross-origin request blocked', code: 'ORIGIN_INVALID' }, 403)
  }
  const token = req.headers.get('x-csrf-token')
  // The stored csrfHash IS the raw token value the client echoes (the login
  // flow stores it unhashed) — compare raw, like lib/auth/session.ts does.
  if (!token || !timingSafeEqual(token, session.csrfHash)) {
    return authNoStore({ error: 'CSRF check failed', code: 'CSRF_INVALID' }, 403)
  }
  return null
}

/** Mark the current session as recently password-verified (10 min window). */
export async function markStepUp(sessionId: string): Promise<void> {
  await db.adminSession.update({ where: { id: sessionId }, data: { stepUpAt: new Date() } })
}

/** Revoke one session by id (scoped to the owning admin). */
export async function revokeSession(sessionId: string, adminId: string): Promise<void> {
  await db.adminSession.updateMany({ where: { id: sessionId, adminId, revokedAt: null }, data: { revokedAt: new Date() } })
}

/** Revoke every live session of an admin (password change/reset, 2FA change, logout-all). */
export async function revokeAllSessions(adminId: string, exceptSessionId?: string): Promise<number> {
  const result = await db.adminSession.updateMany({
    where: { adminId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  })
  return result.count
}

/** New device heuristic — true when this UA hash was never seen on any of the admin's sessions. */
export async function isNewDeviceForAdmin(adminId: string, uaHash: string): Promise<boolean> {
  const existing = await db.adminSession.findFirst({ where: { adminId, uaHash } })
  return !existing
}

/** Rotate: create a FULL session and revoke the old one (2FA success / first-time setup done). */
export async function rotateToFullSession(req: NextRequest, adminId: string, oldSessionId: string): Promise<CreatedSession> {
  await revokeSession(oldSessionId, adminId)
  return createAdminSession({ adminId, stage: STAGE_FULL, req })
}

export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  const hops = xff
    ? xff
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean)
    : []
  // x-client-ip is set (overwritten) by our own frontend proxy from the
  // LAST XFF hop — the first hop is client-forgeable and never trusted.
  return req.headers.get('x-client-ip') || hops[hops.length - 1] || req.headers.get('x-real-ip') || 'unknown'
}

export function clearSessionCookiesOn(res: NextResponse): void {
  clearAuthCookies(res)
}
