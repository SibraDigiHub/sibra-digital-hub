// ═══════════════════════════════════════════════════════════
// API Gateway — catch-all proxy to the backend server.
//
//   Browser ──► Frontend /api/* (this file) ──► Backend /api/*
//
// The backend URL and the proxy secret NEVER reach the browser:
// this file runs server-side only. Every forwarded request carries
// the `x-proxy-secret` header; the backend rejects callers that
// don't know the secret (see backend/src/proxy.ts).
// ═══════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Dev fallback only — matches next.config's dev default (:3001, the current
// backend dev port). Production always sets BACKEND_URL: the next.config
// guard fails the build otherwise, so this fallback is unreachable there.
// (Historical note: this default used to say :4000 — the old dev-all.sh
// topology — which is where any "localhost:4000" confusion came from.)
const BACKEND_URL = (process.env.BACKEND_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '')
const PROXY_SECRET = process.env.PROXY_SECRET || ''

/** Headers that must not be relayed hop-by-hop. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'host',
  'content-length',
  'accept-encoding',
  'content-encoding',
])

async function forward(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params
  const sub = (path ?? []).join('/')
  const incoming = new URL(req.url)
  const target = `${BACKEND_URL}/api${sub ? `/${sub}` : ''}${incoming.search}`

  // Relay request headers (incl. cookie), drop hop-by-hop ones
  const headers = new Headers()
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value)
  })
  if (PROXY_SECRET) headers.set('x-proxy-secret', PROXY_SECRET)
  // Preserve the browser-facing host for the backend's Origin/CSRF
  // same-host validation (the `host` header itself is hop-by-hop and
  // would otherwise be replaced by the internal backend host).
  const browserHost = req.headers.get('host')
  if (browserHost) headers.set('x-forwarded-host', browserHost)

  const method = req.method.toUpperCase()
  const hasBody = method !== 'GET' && method !== 'HEAD'
  // Raw bytes → backend webhook HMAC verification stays byte-accurate
  const body = hasBody ? Buffer.from(await req.arrayBuffer()) : undefined

  try {
    const backendRes = await fetch(target, {
      method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'manual',
    })

    const resHeaders = new Headers()
    backendRes.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) resHeaders.append(key, value)
    })
    // Multiple Set-Cookie headers must each survive the trip (admin session)
    for (const cookie of backendRes.headers.getSetCookie()) {
      resHeaders.append('set-cookie', cookie)
    }
    return new NextResponse(backendRes.body, {
      status: backendRes.status,
      headers: resHeaders,
    })
  } catch (e) {
    console.error(`[api-proxy] ${method} /api/${sub} → backend unreachable:`, e)
    return NextResponse.json({ error: 'Backend service unavailable' }, { status: 502 })
  }
}

export const GET = forward
export const POST = forward
export const PUT = forward
export const PATCH = forward
export const DELETE = forward
export const OPTIONS = forward
export const HEAD = forward
