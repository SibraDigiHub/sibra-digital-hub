// GET /api/geo — geo-smart checkout ordering (PRD §10.1)
// IP/derived per-request data → always `no-store` (asHandler default).
// Task 3 (additive): the response ALSO sets a persistent `sdh_geo` cookie
// (readable by the pre-paint inline script) so RETURNING visitors get the
// correct currency at first paint with zero extra requests. Page HTML
// stays geo-neutral — this cookie is set on a no-store API response only,
// so cached pages are unaffected.
//
// Country resolution (server-authoritative, shared with checkout):
//   1. Platform geo header (x-vercel-ip-country / cf-ipcountry) — set by
//      our edge/proxy, never forgeable by the browser. Always wins.
//   2. Accept-Language hint — any Indian region tag (`*-IN`) or Indian
//      primary language (`hi`, `bn`, `ta`, …) ⇒ 'IN'. Last-resort signal
//      for deployments not behind Vercel/Cloudflare.
//   3. 'US' — the international (USD) default.
// QA override `?geo=IN|US` is honoured in dev/staging ONLY (production
// never trusts a query param here — the cookie it sets would let a
// visitor force a currency on every subsequent page).
import { NextRequest, NextResponse } from 'next/server'
import { asHandler } from '@/lib/api'
import { visitorCountrySync } from '@/services/visitor-geo'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  const country = visitorCountrySync(req)
  const res = NextResponse.json({ country, isIndia: country === 'IN' })
  res.cookies.set('sdh_geo', country, {
    maxAge: 365 * 24 * 3600,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })
  return res
})
