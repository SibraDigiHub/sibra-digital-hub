// USD-based daily reference rates from Frankfurter.
// Frankfurter supports commercial/e-commerce use, permits caching, and blends
// data from central banks and official providers. Rates are reference/mid-market
// rates, not live card-network quotes. Only the selected conversion is returned
// to the visitor; the complete rate table remains server-side.
const FX_ENDPOINT = 'https://api.frankfurter.dev/v2/rates?base=USD'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const MAX_STALE_MS = 5 * 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 5_000

type RateRow = {
  date?: string
  base?: string
  quote?: string
  rate?: number
}

type CachedRates = {
  rates: Record<string, { rate: number; updatedAt: number }>
  cachedAt: number
}

let cachedRates: CachedRates | null = null
let ratesInFlight: Promise<CachedRates | null> | null = null

async function loadRates(): Promise<CachedRates | null> {
  const now = Date.now()
  if (cachedRates && now - cachedRates.cachedAt < CACHE_TTL_MS) return cachedRates
  if (ratesInFlight) return ratesInFlight

  ratesInFlight = (async () => {
    try {
      const response = await fetch(FX_ENDPOINT, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        // Next.js Data Cache limits upstream calls across warm server instances.
        next: { revalidate: 21_600 },
      })
      if (!response.ok) throw new Error(`fx_http_${response.status}`)
      const payload = (await response.json()) as RateRow[]
      if (!Array.isArray(payload) || payload.length === 0) throw new Error('fx_invalid_payload')

      const rates: Record<string, { rate: number; updatedAt: number }> = {
        USD: { rate: 1, updatedAt: now },
      }
      for (const row of payload) {
        const code = row.quote?.trim().toUpperCase()
        if (!code || !/^[A-Z]{3}$/.test(code) || !Number.isFinite(row.rate) || (row.rate ?? 0) <= 0 || !row.date) {
          continue
        }
        // Providers can publish at different times. Validate each currency's
        // own observation date rather than borrowing the newest global date.
        const updatedAt = Date.parse(`${row.date}T00:00:00.000Z`)
        if (!Number.isFinite(updatedAt) || now - updatedAt > MAX_STALE_MS || updatedAt > now + 5 * 60_000) {
          continue
        }
        rates[code] = { rate: row.rate as number, updatedAt }
      }
      if (Object.keys(rates).length === 1) throw new Error('fx_no_fresh_rates')
      cachedRates = { rates, cachedAt: now }
      return cachedRates
    } catch {
      if (cachedRates && now - cachedRates.cachedAt <= MAX_STALE_MS) return cachedRates
      return null
    } finally {
      ratesInFlight = null
    }
  })()
  return ratesInFlight
}

/** Returns units of `currency` per 1 USD, or null if a fresh-enough rate is unavailable. */
export async function usdExchangeRate(currency: string): Promise<{ rate: number; updatedAt: number } | null> {
  const code = currency.trim().toUpperCase()
  if (code === 'USD') return { rate: 1, updatedAt: Date.now() }
  const snapshot = await loadRates()
  const rate = snapshot?.rates[code]
  if (!rate || !Number.isFinite(rate.rate) || rate.rate <= 0 || Date.now() - rate.updatedAt > MAX_STALE_MS) return null
  return rate
}

/** Test-only cache reset; not exposed through application routes. */
export function resetFxRateCacheForTests(): void {
  cachedRates = null
  ratesInFlight = null
}
