// ═══════════════════════════════════════════════════════════
// Activity events (PRD v6.1 §11.6/§11.7) — anonymous visitor
// cookie + server-side event log powering the admin funnel,
// product analytics and customer timelines.
//
// Rule #1: analytics must NEVER break a request — every write
// is wrapped and silently ignored on failure.
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto'
import type { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const VISITOR_COOKIE = 'sdh_vid'

export type EventType =
  | 'product_view'
  | 'buy_click'
  | 'platform_click'
  | 'checkout_started'
  | 'order_paid'
  | 'download'
  | 'email_sent'
  | 'email_resent'
  | 'search'

const EVENT_TYPES: ReadonlySet<string> = new Set<EventType>([
  'product_view',
  'buy_click',
  'platform_click',
  'checkout_started',
  'order_paid',
  'download',
  'email_sent',
  'email_resent',
  'search',
])

export function isKnownEventType(t: unknown): t is EventType {
  return typeof t === 'string' && EVENT_TYPES.has(t)
}

/** Rough device class from the User-Agent (no third-party dep). */
export function detectDevice(ua: string | null): string {
  if (!ua) return 'unknown'
  if (/bot|crawler|spider|slurp|preview/i.test(ua)) return 'bot'
  if (/ipad|tablet|playbook|silk/i.test(ua)) return 'tablet'
  if (/mobi|iphone|android|phone/i.test(ua)) return 'mobile'
  return 'desktop'
}

/** Best-effort country from edge/CDN headers (empty when absent). */
export function detectCountry(req: NextRequest): string | null {
  return (
    req.headers.get('x-vercel-ip-country') ||
    req.headers.get('cf-ipcountry') ||
    req.headers.get('x-country') ||
    null
  )
}

export interface EventContext {
  visitorId: string | null
  path: string | null
  referrer: string | null
  country: string | null
  device: string
}

/** Extract the shared context pieces from an incoming request. */
export function eventContext(req: NextRequest): EventContext {
  const ref = req.headers.get('referer')
  let path: string | null = null
  if (ref) {
    try {
      const u = new URL(ref)
      path = `${u.pathname}${u.hash || ''}`.slice(0, 200)
    } catch {
      path = null
    }
  }
  return {
    visitorId: req.cookies.get(VISITOR_COOKIE)?.value ?? null,
    path,
    referrer: ref ? ref.slice(0, 300) : null,
    country: detectCountry(req),
    device: detectDevice(req.headers.get('user-agent')),
  }
}

/** Read the existing visitor id or mint + set a fresh one on the outgoing response. */
export function ensureVisitorId(req: NextRequest, res: NextResponse): string {
  const existing = req.cookies.get(VISITOR_COOKIE)?.value
  if (existing && existing.length >= 8 && existing.length <= 64) return existing
  const fresh = crypto.randomUUID()
  res.cookies.set(VISITOR_COOKIE, fresh, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  })
  return fresh
}

export interface LogEventInput {
  type: EventType
  productId?: string | null
  zone?: string | null
  platform?: string | null
  email?: string | null
  orderId?: string | null
  visitorId?: string | null
  path?: string | null
  referrer?: string | null
  country?: string | null
  device?: string | null
  meta?: Record<string, unknown>
}

/**
 * Fire-and-forget event write. Never throws — a failing analytics
 * insert must not break checkout, downloads or page loads.
 */
export async function logEvent(input: LogEventInput): Promise<void> {
  try {
    await db.activityEvent.create({
      data: {
        type: input.type,
        productId: input.productId ?? null,
        zone: input.zone ?? null,
        platform: input.platform ?? null,
        email: input.email ? input.email.toLowerCase().slice(0, 160) : null,
        orderId: input.orderId ?? null,
        visitorId: input.visitorId ?? null,
        path: input.path ?? null,
        referrer: input.referrer ?? null,
        country: input.country ?? null,
        device: input.device ?? null,
        meta: JSON.stringify(input.meta ?? {}),
      },
    })
  } catch {
    // intentionally swallowed — analytics is best-effort
  }
}
