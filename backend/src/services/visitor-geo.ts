// ═══════════════════════════════════════════════════════════
// Visitor country — SERVER-AUTHORITATIVE (owner decision, Task 3).
//
// The country selector is gone: the platform's geo header
// (x-vercel-ip-country / cf-ipcountry — set by our edge/proxy,
// never forgeable by the browser) decides the currency:
//   India   → INR (product.priceInr)
//   other / unknown → international USD (product.priceUsd)
// No live FX conversion ever. The client-sent `country` field is
// still ACCEPTED (old cached bundles stay valid) but IGNORED.
// Raw IPs are never stored — the existing salted-hash handling is
// untouched; orders keep billingCountry + ipCountry as before.
// ═══════════════════════════════════════════════════════════
import type { NextRequest } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import { normalizeCountry } from '@/services/gateway-routing'

/** The platform geo header our edge/proxy injects (browser cannot set it). */
export function platformGeoHeader(req: NextRequest): string | null {
  const raw = req.headers.get('x-vercel-ip-country') || req.headers.get('cf-ipcountry')
  return normalizeCountry(raw)
}

/**
 * Accept-Language hint for India — a LAST-RESORT signal used only when no
 * platform geo header is present (e.g. a deployment not behind Vercel/
 * Cloudflare, or a preview/sandbox). Returns 'IN' when the header carries
 * any Indian region tag (`en-IN`, `hi-IN`, `bn-IN`, …) or an Indian
 * primary language (`hi`, `bn`, `ta`, `te`, `mr`, `gu`, `kn`, `ml`, `pa`,
 * `or`, `as`, `ur`) — otherwise null (caller falls back to 'US').
 *
 * This is intentionally permissive on the India side (an Indian visitor
 * with a US-English browser still often sends `en-IN` as a secondary tag)
 * and never promotes a non-IN locale to IN. It is a HINT, never
 * authoritative: the platform geo header always wins when present.
 */
const INDIAN_LANGS = new Set(['hi', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'pa', 'or', 'as', 'ur', 'sa'])

export function acceptLanguageHint(req: NextRequest): string | null {
  const al = req.headers.get('accept-language')
  if (!al) return null
  // Comma-separated ranges, e.g. "en-IN,en;q=0.9,hi;q=0.8". Inspect each
  // tag's region subtag AND primary language.
  for (const part of al.split(',')) {
    const tag = part.trim().split(';')[0].trim().toLowerCase()
    if (!tag) continue
    const [lang, region] = tag.split('-')
    if (region === 'in') return 'IN'
    if (INDIAN_LANGS.has(lang)) return 'IN'
  }
  return null
}

/**
 * Timezone hint from the client — `x-client-timezone: Asia/Calcutta` sent
 * by our own frontend fetches (lib/visitor-currency clientTimezoneHeaders).
 * The OS clock timezone is the strongest CLIENT signal for where the user
 * actually lives (an Indian device is on Asia/Calcutta|Asia/Kolkata no
 * matter its browser language), so it outranks Accept-Language.
 *
 * Trust level: a HINT, same class as Accept-Language — any client can
 * send any header, and this only applies when the authoritative platform
 * geo header is absent (e.g. preview gateways / custom deployments that
 * strip it). Only India is mapped: INR is the store's only non-USD price.
 */
const TZ_COUNTRY: Record<string, string> = {
  'asia/calcutta': 'IN',
  'asia/kolkata': 'IN',
}

export function timezoneHint(req: NextRequest): string | null {
  const tz = (req.headers.get('x-client-timezone') ?? '').trim().toLowerCase()
  return TZ_COUNTRY[tz] ?? null
}

/**
 * The server-authoritative visitor country for pricing.
 * QA override `?geo=IN|US` is honoured ONLY in dev/staging or for a
 * VERIFIED admin session — public production ignores it (tested).
 * Unknown location ⇒ 'US' → the international (USD) variant.
 */
export async function visitorCountry(req: NextRequest): Promise<string> {
  const override = req.nextUrl.searchParams.get('geo')
  if (override) {
    const o = normalizeCountry(override)
    if (o && (process.env.NODE_ENV !== 'production' || (await isAdmin()))) return o
  }
  return platformGeoHeader(req) ?? timezoneHint(req) ?? acceptLanguageHint(req) ?? 'US'
}

/**
 * Synchronous (no admin lookup) variant for the cookie-setting /api/geo
 * endpoint. Same precedence: platform geo header → timezone hint →
 * accept-language hint → 'US'. The QA `?geo=` override is honoured in
 * non-production only (production /api/geo never trusts a query param —
 * the cookie it sets would let a visitor force a currency).
 */
export function visitorCountrySync(req: NextRequest): string {
  const override = req.nextUrl.searchParams.get('geo')
  if (override && process.env.NODE_ENV !== 'production') {
    const o = normalizeCountry(override)
    if (o) return o
  }
  return platformGeoHeader(req) ?? timezoneHint(req) ?? acceptLanguageHint(req) ?? 'US'
}
