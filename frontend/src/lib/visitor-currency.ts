'use client'

import { useEffect, useState } from 'react'
import { formatMajorCurrency } from '@/lib/order-money'

export type VisitorCurrency = string

export interface VisitorCurrencyInfo {
  country: string
  currency: string
  rate: number
  rateUpdatedAt: number | null
  rateSource: string | null
}

let resolvedInfo: VisitorCurrencyInfo | null = null
let inflight: Promise<VisitorCurrencyInfo> | null = null

/** Legacy country helper retained for callers that only know the India/USD split. */
export function currencyForCountry(country: string | null | undefined): VisitorCurrency {
  return country === 'IN' ? 'INR' : 'USD'
}

/** Synchronous cookie read (fallback only; /api/geo is authoritative). */
export function visitorCurrencyFromCookie(): VisitorCurrency | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/(?:^|;\s*)sdh_geo=([A-Z]{2})/)
  return match ? currencyForCountry(match[1]) : null
}

export function visitorTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

export function timezoneCountryHint(timezone: string): string | null {
  const tz = timezone.trim().toLowerCase()
  return tz === 'asia/calcutta' || tz === 'asia/kolkata' ? 'IN' : null
}

export function visitorCurrencyFromTimezone(): VisitorCurrency | null {
  return timezoneCountryHint(visitorTimezone()) === 'IN' ? 'INR' : null
}

const INDIAN_LANG_RE = /^(hi|bn|ta|te|mr|gu|kn|ml|pa|or|as|ur|sa)$/

export function visitorCurrencyFromNavigator(): VisitorCurrency | null {
  if (typeof navigator === 'undefined') return null
  const languages = navigator.languages ?? (navigator.language ? [navigator.language] : [])
  for (const language of languages) {
    const [primary, region] = (language || '').toLowerCase().split('-')
    if (region === 'in' || INDIAN_LANG_RE.test(primary)) return 'INR'
  }
  return null
}

export function clientTimezoneHeaders(): Record<string, string> {
  const timezone = visitorTimezone()
  return timezone ? { 'x-client-timezone': timezone } : {}
}

/** Store the server-resolved country for the next page's geo bootstrap. */
function persistGeoCookie(country: string): void {
  if (typeof document === 'undefined') return
  document.cookie = `sdh_geo=${country};max-age=${365 * 24 * 3600};path=/;samesite=lax${location.protocol === 'https:' ? ';secure' : ''}`
}

export function applyCurrencyToDom(currency: VisitorCurrency | null): void {
  if (typeof document === 'undefined') return
  if (currency) document.documentElement.dataset.currency = currency
  else delete document.documentElement.dataset.currency
}

/** Fetch the server-authoritative country, merchant-enabled currency and FX rate. */
export function resolveVisitorCurrencyInfo(): Promise<VisitorCurrencyInfo> {
  if (!inflight) {
    inflight = fetch('/api/geo', { cache: 'no-store', headers: clientTimezoneHeaders() })
      .then(async (response) => {
        if (!response.ok) throw new Error('geo_unavailable')
        return (await response.json()) as Partial<VisitorCurrencyInfo>
      })
      .then((data) => {
        const currency = typeof data.currency === 'string' && /^[A-Z]{3}$/.test(data.currency) ? data.currency : 'USD'
        const reportedRate = Number.isFinite(data.rate) && Number(data.rate) > 0 ? Number(data.rate) : 1
        const info: VisitorCurrencyInfo = {
          country: typeof data.country === 'string' ? data.country : 'US',
          currency,
          rate: currency === 'USD' || currency === 'INR' ? 1 : reportedRate,
          rateUpdatedAt: typeof data.rateUpdatedAt === 'number' ? data.rateUpdatedAt : null,
          rateSource: typeof data.rateSource === 'string' ? data.rateSource : null,
        }
        resolvedInfo = info
        persistGeoCookie(info.country)
        applyCurrencyToDom(info.currency)
        return info
      })
      .catch(() => {
        const info: VisitorCurrencyInfo = {
          country: 'US',
          currency: visitorCurrencyFromCookie() ?? 'USD',
          rate: 1,
          rateUpdatedAt: null,
          rateSource: null,
        }
        resolvedInfo = info
        applyCurrencyToDom(info.currency)
        return info
      })
  }
  return inflight
}

export function resolveVisitorCurrency(): Promise<VisitorCurrency> {
  return resolveVisitorCurrencyInfo().then((info) => info.currency)
}

export function useVisitorCurrency(): VisitorCurrency | null {
  const [currency, setCurrency] = useState<VisitorCurrency | null>(null)
  useEffect(() => {
    let live = true
    void resolveVisitorCurrency().then((value) => {
      if (live) setCurrency(value)
    })
    return () => {
      live = false
    }
  }, [])
  return currency
}

export function formatVisitorPrice(currency: VisitorCurrency, priceUsd: number, priceInr: number): string {
  if (currency === 'INR') return formatMajorCurrency(priceInr, 'INR')
  const rate = resolvedInfo?.currency === currency ? resolvedInfo.rate : 1
  return formatMajorCurrency(priceUsd * rate, currency)
}

export function visitorPriceLabel(
  currency: VisitorCurrency | null,
  priceUsd: number,
  priceInr: number,
): string {
  return currency && resolvedInfo ? formatVisitorPrice(currency, priceUsd, priceInr) : ''
}
