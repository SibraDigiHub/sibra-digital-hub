// ═══════════════════════════════════════════════════════════
// Claim cookie (dual payment §5.1/§10.5) — after a successful
// /api/checkout/create the browser receives an httpOnly
// `__Host-sdh_claim` cookie bound to its order. The status and
// capture endpoints read it; nobody else can poll or capture
// someone else's order. Value = `<orderId>.<hmac>` — the HMAC
// (SESSION_PEPPER) makes order ids unforgeable client-side.
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto'
import type { NextRequest, NextResponse } from 'next/server'

export const CLAIM_COOKIE = '__Host-sdh_claim'
const CLAIM_TTL_SEC = 60 * 60 * 2 // long enough for any checkout + polling

function claimPepper(): string {
  // Dev fallback keeps local flows working without secrets; production
  // refuses to boot without SESSION_PEPPER (config/env.ts).
  return process.env.SESSION_PEPPER || process.env.INTERNAL_API_KEY || 'sdh-dev-claim-pepper'
}

function sign(orderId: string): string {
  return crypto.createHmac('sha256', claimPepper()).update(`claim:${orderId}`).digest('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb)
}

/** Attach the claim cookie to a response (Secure is honored by browsers on localhost). */
export function setClaimCookie(res: NextResponse, orderId: string): void {
  res.cookies.set({
    name: CLAIM_COOKIE,
    value: `${orderId}.${sign(orderId)}`,
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: CLAIM_TTL_SEC,
  })
}

/** Clear the claim cookie (checkout abandoned / consumed). */
export function clearClaimCookie(res: NextResponse): void {
  res.cookies.set({ name: CLAIM_COOKIE, value: '', httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 0 })
}

/** Return the order id when the request carries a VALID claim for it, else null. */
export function readClaimedOrderId(req: NextRequest): string | null {
  const raw = req.cookies.get(CLAIM_COOKIE)?.value
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot <= 0) return null
  const orderId = raw.slice(0, dot)
  const mac = raw.slice(dot + 1)
  if (!orderId || !mac) return null
  return safeEqual(mac, sign(orderId)) ? orderId : null
}

/** Origin guard for checkout POSTs (§10.5): same-host check. Rejects only when a
 *  mismatched Origin is PRESENT — same-origin browsers always send it; server-to-server
 *  callers (webhooks, tests) omit it. The frontend proxy forwards the browser-facing
 *  host as `x-forwarded-host` (hop-by-hop `host` would carry the internal backend host).
 *  Sandboxed preview tunnels (e.g. Aliyun FC gateways) rewrite the Host header to an
 *  internal hostname, making every host-based check structurally blind there — in that
 *  shape the browser-asserted Fetch Metadata (`sec-fetch-site: same-origin`, a forbidden
 *  header page JS can neither set nor remove) is the surviving proof the POST was
 *  initiated by our own page. */
export function originAllowed(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true
  let originHost: string | null = null
  try {
    originHost = new URL(origin).host
  } catch {
    return false
  }
  const forwarded = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (forwarded && forwarded.split(',')[0].trim() === originHost) return true
  // Canonical deployments: match the configured site origin as a fallback.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.PUBLIC_WEB_URL || ''
  if (siteUrl) {
    try {
      if (new URL(siteUrl).host === originHost) return true
    } catch {
      // malformed site URL — fall through to the rejection below
    }
  }
  if (req.headers.get('sec-fetch-site') === 'same-origin') return true
  return false
}
