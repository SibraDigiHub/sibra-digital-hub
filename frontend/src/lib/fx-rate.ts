// ─────────────────────────────────────────────────────────────
// Live USD→INR rate for the admin Pricing "Auto-convert" hint.
// Key-less, CORS-enabled public FX providers with a fallback;
// result cached in localStorage for a few hours so the button
// stays fast and the providers are not hammered. Callers must
// treat a rejection as "enter the INR price manually" — never
// fall back to a stale hardcoded rate.
// ─────────────────────────────────────────────────────────────

const CACHE_KEY = 'sdh_fx_usdinr_v1'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
/** Sanity bounds — a live INR rate outside this band is garbage. */
const RATE_MIN = 40
const RATE_MAX = 200
const TIMEOUT_MS = 6_000

interface CachedRate {
  rate: number
  at: number
}

function readCache(): number | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as CachedRate).rate !== 'number' ||
      typeof (parsed as CachedRate).at !== 'number'
    ) {
      return null
    }
    const { rate, at } = parsed as CachedRate
    if (rate < RATE_MIN || rate > RATE_MAX || Date.now() - at > CACHE_TTL_MS) return null
    return rate
  } catch {
    return null
  }
}

function writeCache(rate: number): void {
  try {
    const payload: CachedRate = { rate, at: Date.now() }
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload))
  } catch {
    // Cache is an optimisation — a blocked localStorage must not break the send.
  }
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`FX provider ${res.status}`)
  return res.json()
}

/** Rate value out of a provider payload shaped { rates?: { INR?: unknown } }. */
function inrFromRates(payload: unknown): number | null {
  const rates = (payload as { rates?: Record<string, unknown> } | null)?.rates
  const inr = rates?.INR
  if (typeof inr !== 'number' || !Number.isFinite(inr) || inr < RATE_MIN || inr > RATE_MAX) return null
  return inr
}

/** Rate value out of the jsdelivr currency-api shape { usd?: { inr?: unknown } }. */
function inrFromUsdMap(payload: unknown): number | null {
  const inr = (payload as { usd?: Record<string, unknown> } | null)?.usd?.inr
  if (typeof inr !== 'number' || !Number.isFinite(inr) || inr < RATE_MIN || inr > RATE_MAX) return null
  return inr
}

async function fromOpenErApi(): Promise<number> {
  const rate = inrFromRates(await getJson('https://open.er-api.com/v6/latest/USD'))
  if (rate === null) throw new Error('open.er-api: unusable INR rate')
  return rate
}

async function fromJsdelivrCdn(): Promise<number> {
  const rate = inrFromUsdMap(
    await getJson('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json'),
  )
  if (rate === null) throw new Error('jsdelivr currency-api: unusable INR rate')
  return rate
}

/**
 * Current USD→INR rate (cached ≤6 h). Throws when every provider fails —
 * the caller tells the admin to type the INR price instead of guessing.
 */
export async function fetchUsdInrRate(): Promise<number> {
  const cached = readCache()
  if (cached !== null) return cached
  let rate: number
  try {
    rate = await fromOpenErApi()
  } catch {
    rate = await fromJsdelivrCdn()
  }
  writeCache(rate)
  return rate
}
