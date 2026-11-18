'use client'

import { useEffect, useState } from 'react'

// ═══════════════════════════════════════════════════════════
// Visitor currency (Task 3 — no country selector, no FX).
//
// The server renders BOTH the USD and INR price twins everywhere
// (cache-safe: no geo ever enters the cached HTML — crawlers and
// unknown locations get USD per the owner decision). The visitor's
// own variant resolves CLIENT-SIDE, immediately:
//   1. `sdh_geo` cookie (set by /api/geo for a year) — read
//      SYNCHRONOUSLY before first paint by the tiny inline script
//      in the root layout, which sets <html data-currency>; CSS
//      then shows exactly one price span — zero CLS, zero flash,
//      zero extra requests for returning visitors.
//   2. navigator.languages — any Indian region tag (`*-IN`) or
//      Indian primary language (hi, bn, ta, te, mr, gu, kn, ml,
//      pa, or, as, ur) ⇒ INR. This is the FIRST-VISIT signal: an
//      Indian visitor's browser almost always carries one of these,
//      so they see ₹ on the very first paint — no fetch, no cookie,
//      no dependency on /api/geo being reachable.
//   3. /api/geo (one async fetch) — refines via the platform's IP
//      geo header (x-vercel-ip-country / cf-ipcountry) when the
//      browser locale is ambiguous (e.g. an Indian on a US-English
//      browser), and persists the cookie for next visit.
// The SERVER always decides what is CHARGED (quote/create read the
// geo header) — this module only picks which price is DISPLAYED.
// ═══════════════════════════════════════════════════════════

export type VisitorCurrency = 'INR' | 'USD'

/** Server decides: India ⇒ INR, everything else ⇒ USD. */
export function currencyForCountry(country: string | null | undefined): VisitorCurrency {
  return country === 'IN' ? 'INR' : 'USD'
}

/** Synchronous cookie read (mirrors the layout inline script). */
export function visitorCurrencyFromCookie(): VisitorCurrency | null {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(/(?:^|;\s*)sdh_geo=([A-Z]{2})/)
  if (!m) return null
  return currencyForCountry(m[1])
}

/**
 * Indian-language codes (primary subtag) used by `navigator.languages`
 * detection. Mirrors the inline script's regex in layout.tsx and the
 * backend `acceptLanguageHint` set in visitor-geo.ts — keep in sync.
 */
const INDIAN_LANG_RE = /^(hi|bn|ta|te|mr|gu|kn|ml|pa|or|as|ur|sa)$/

/**
 * The device's IANA timezone — the STRONGEST client location signal.
 * The OS clock timezone follows where the user actually lives (an Indian
 * device is set to Asia/Calcutta a.k.a. Asia/Kolkata regardless of the
 * browser UI language or any VPN). Only India is mapped: INR is the only
 * non-USD currency the store prices.
 */
export function visitorTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

/** Timezone → country hint sent to the server (checkout charge parity). */
export function timezoneCountryHint(timezone: string): string | null {
  const tz = timezone.trim().toLowerCase()
  if (tz === 'asia/calcutta' || tz === 'asia/kolkata') return 'IN'
  return null
}

/**
 * Synchronous timezone read — the TOP-priority client signal. Returns
 * 'INR' when the device timezone is Indian IST, else null. This runs
 * BEFORE the cookie check in the resolver: a stale `sdh_geo=US` cookie
 * (set long ago by a weak server fallback on this preview gateway) must
 * never pin an Indian device to dollars — the OS clock is the truth.
 */
export function visitorCurrencyFromTimezone(): VisitorCurrency | null {
  return timezoneCountryHint(visitorTimezone()) === 'IN' ? 'INR' : null
}

/**
 * Synchronous navigator.languages read — a secondary client signal for
 * first visits. Returns 'INR' when the browser carries any Indian region
 * tag (`*-IN`) or Indian primary language, else null. No network request.
 */
export function visitorCurrencyFromNavigator(): VisitorCurrency | null {
  if (typeof navigator === 'undefined') return null
  const langs = navigator.languages ?? (navigator.language ? [navigator.language] : [])
  for (const l of langs) {
    const parts = (l || '').toLowerCase().split('-')
    if (parts[1] === 'in' || INDIAN_LANG_RE.test(parts[0])) return 'INR'
  }
  return null
}

/**
 * Headers carrying the client timezone so the SERVER can apply the same
 * hint when it decides the CHARGED currency (quote/create) — the server
 * uses it only as a last-resort hint, after its own platform geo header.
 * Mirrors backend `timezoneHint` in visitor-geo.ts.
 */
export function clientTimezoneHeaders(): Record<string, string> {
  const tz = visitorTimezone()
  return tz ? { 'x-client-timezone': tz } : {}
}

/** Persist the resolved country as the sdh_geo cookie (1-year, lax, same shape as /api/geo sets). */
function persistGeoCookie(country: string): void {
  if (typeof document === 'undefined') return
  document.cookie = `sdh_geo=${country};max-age=${365 * 24 * 3600};path=/;samesite=lax${location.protocol === 'https:' ? ';secure' : ''}`
}

/** Apply the currency to <html data-currency> — CSS shows one price span. */
export function applyCurrencyToDom(currency: VisitorCurrency | null): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.currency = currency ?? 'USD'
}

let inflight: Promise<VisitorCurrency> | null = null

/**
 * Resolve once per page. Resolution order (no wrong-currency exposure):
 *   1. Device timezone (Asia/Calcutta|Asia/Kolkata ⇒ INR) — synchronous.
 *      STRONGEST client signal and checked BEFORE the cookie: a stale
 *      `sdh_geo=US` cookie from an earlier weak-signal visit can never
 *      pin an Indian device to dollars. Persists cookie=IN to heal it.
 *   2. sdh_geo cookie (returning visitor) — synchronous.
 *   3. navigator.languages (first-visit Indian browser) — synchronous,
 *      no fetch. Persists the cookie so the next visit is instant too.
 *   4. /api/geo (one async fetch) — platform IP geo header refines the
 *      ambiguous case (Indian on a foreign-device setup) and persists.
 *   5. USD (fetch failed or non-Indian) — the safe default.
 */
export function resolveVisitorCurrency(): Promise<VisitorCurrency> {
  const tzCurrency = visitorCurrencyFromTimezone()
  if (tzCurrency) {
    applyCurrencyToDom(tzCurrency)
    persistGeoCookie('IN')
    return Promise.resolve(tzCurrency)
  }
  const cookie = visitorCurrencyFromCookie()
  if (cookie) {
    applyCurrencyToDom(cookie)
    return Promise.resolve(cookie)
  }
  const nav = visitorCurrencyFromNavigator()
  if (nav) {
    applyCurrencyToDom(nav)
    persistGeoCookie('IN')
    return Promise.resolve(nav)
  }
  if (!inflight) {
    inflight = fetch('/api/geo', {
      cache: 'no-store',
      headers: clientTimezoneHeaders(),
    })
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { country?: string }) => currencyForCountry(d?.country))
      .catch(() => 'USD' as VisitorCurrency)
      .then((c) => {
        applyCurrencyToDom(c)
        return c
      })
  }
  return inflight
}

// ── React hook (client components only) ─────────────────────

/**
 * The visitor's display currency. ALWAYS starts `null` so the server
 * HTML and the client's first render are byte-identical (no hydration
 * mismatch — the cookie is NOT read during the initial render). The
 * pre-paint inline script + CSS already switch the VISIBLE price
 * before React mounts; this hook only feeds the currency-aware labels
 * and conditional buttons, which resolve once after mount.
 *
 * null until known — callers render price-free labels meanwhile (no
 * wrong-currency exposure, no flash; the visual price itself is
 * CSS-switched elsewhere).
 */
export function useVisitorCurrency(): VisitorCurrency | null {
  const [currency, setCurrency] = useState<VisitorCurrency | null>(null)
  useEffect(() => {
    let live = true
    void resolveVisitorCurrency().then((c) => {
      if (live) setCurrency(c)
    })
    return () => {
      live = false
    }
  }, [])
  return currency
}

/** Formatted single-currency price for one display currency. */
export function formatVisitorPrice(currency: VisitorCurrency, priceUsd: number, priceInr: number): string {
  return currency === 'INR' ? `₹${Math.round(priceInr)}` : `$${priceUsd.toFixed(2)}`
}

/**
 * aria-label price fragment: only the VISITOR-currency price — never the
 * other region's direct-buy price. Empty string while unknown (labels
 * render without a price until the currency resolves).
 */
export function visitorPriceLabel(
  currency: VisitorCurrency | null,
  priceUsd: number,
  priceInr: number,
): string {
  return currency ? formatVisitorPrice(currency, priceUsd, priceInr) : ''
}
