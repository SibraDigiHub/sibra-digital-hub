'use client'

// ═══════════════════════════════════════════════════════════
// ADMIN — shared API client (T4-b).
//
// One place for every admin fetch so that:
//   • the session cookie is always sent (credentials: 'include'),
//   • every state-changing call carries X-CSRF-Token (the token
//     comes from GET /api/admin/session, refreshed on boot and
//     after every login/2FA/enroll stage change),
//   • any 401 drops the local session and fires a global event
//     that AdminApp listens to → back to the login screen.
// The backend also checks Origin on non-GET admin calls — browsers
// send it automatically, nothing to do here.
// ═══════════════════════════════════════════════════════════

export type AdminStage = 'FULL' | 'PENDING_2FA' | 'ENROLL'

export interface AdminSecurityInfo {
  totpEnabled: boolean
  passkeys: number
  recoveryCodesRemaining: number
  require2fa: boolean
  passkeysEnabled: boolean
  lastLoginAt: string | null
  passwordChangedAt: string | null
}

export interface AdminSessionInfo {
  authenticated: boolean
  stage?: AdminStage
  user?: { id: string; name: string; email: string }
  csrfToken?: string
  security?: AdminSecurityInfo
}

export interface AdminPasskey {
  id: string
  name: string
  deviceType: string
  backedUp: boolean
  transports: string[]
  createdAt: string
  lastUsedAt: string | null
}

export interface AdminSessionRow {
  id: string
  stage: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  current: boolean
  device: string
}

const UNAUTHORIZED_EVENT = 'sdh-admin-unauthorized'

let csrfToken: string | null = null

export function setAdminCsrfToken(token: string | null): void {
  csrfToken = token
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Central fetch for admin calls: cookie + CSRF + 401 → global event. */
export async function adminFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const method = (init.method ?? 'GET').toUpperCase()
  if (!READ_METHODS.has(method)) {
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    if (csrfToken) headers.set('X-CSRF-Token', csrfToken)
  }
  const res = await fetch(url, { ...init, headers, credentials: 'include' })
  if (res.status === 401) {
    // Session expired/revoked — drop the token and tell AdminApp.
    csrfToken = null
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
  }
  return res
}

/** Boot-time session probe — also (re)arms the CSRF token. */
export async function fetchAdminSession(): Promise<AdminSessionInfo> {
  try {
    const res = await fetch('/api/admin/session', { credentials: 'include', cache: 'no-store' })
    const data = (await res.json().catch(() => null)) as AdminSessionInfo | null
    if (res.ok && data?.authenticated) {
      csrfToken = data.csrfToken ?? null
      return data
    }
  } catch {
    /* network hiccup — treat as signed out */
  }
  csrfToken = null
  return { authenticated: false }
}

/** Subscribe to 401 expirations; returns an unsubscribe function. */
export function onAdminUnauthorized(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(UNAUTHORIZED_EVENT, cb)
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, cb)
}

/** JSON helper that throws on non-OK (error body wins over generic text). */
export async function adminJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await adminFetch(url, init)
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok || !data) throw new Error(data?.error ?? 'Request failed')
  return data
}
