'use client'

// ═══════════════════════════════════════════════════════════
// Single-gateway client helpers (§5.1/§5.2):
//   • /api/payments/config  — public gateway booleans;
//   • /api/geo              — country pre-select hint only;
//   • /api/checkout/quote   — the exact total per country;
//   • /api/checkout/create  — order creation (Idempotency-Key);
//   • Razorpay Standard Checkout loader — on demand, checkout step only.
// The client never chooses gateway/currency/amount — every value
// here is echoed from the server.
// ═══════════════════════════════════════════════════════════

export interface PaymentsConfig {
  razorpayConfigured: boolean
  internationalEnabled: boolean
  foreignCurrencies: string[]
  enabledGateways: { razorpay: boolean }
}

export interface Quote {
  gateway: 'razorpay'
  currency: string
  amountMinor: number
  display: string
}

/** Public Standard Checkout options echoed by the server (never a secret). */
export interface RazorpayCheckoutOptions {
  keyId: string
  orderId: string
  amount: number
  currency: string
  name: string
  description: string
  prefillName: string
  prefillEmail: string
  orderRef: string
}

export interface CheckoutCreateResponse {
  order?: {
    id: string
    status: string
    customerEmail: string
    gateway: string
    currency: string
    amountMinor: number | null
  }
  gateway?: 'razorpay'
  currency?: string
  amountMinor?: number
  display?: string
  paymentMode?: 'razorpay' | 'demo'
  razorpay?: RazorpayCheckoutOptions
  upiId?: string
  upiPayeeName?: string
  error?: string
  code?: string
}

/** Module cache — one config + one geo lookup per browser session. */
let configCache: PaymentsConfig | null = null
let geoCountryCache: string | null = null

export async function fetchPaymentsConfig(): Promise<PaymentsConfig> {
  if (configCache) return configCache
  const res = await fetch('/api/payments/config')
  const data = (await res.json().catch(() => null)) as PaymentsConfig | null
  if (!res.ok || !data) throw new Error('payments_config_unavailable')
  configCache = data
  return data
}

/** Geo-IP hint ONLY — the customer still confirms the country (§2.2). */
export async function fetchGeoCountry(): Promise<string | null> {
  if (geoCountryCache) return geoCountryCache
  try {
    const res = await fetch('/api/geo')
    const data = (await res.json().catch(() => null)) as { country?: string } | null
    geoCountryCache = data?.country && /^[A-Z]{2}$/.test(data.country) ? data.country : null
    return geoCountryCache
  } catch {
    return null
  }
}

export async function fetchQuote(productId: string, country: string): Promise<{ ok: true; quote: Quote } | { ok: false; error: string; code?: string }> {
  const res = await fetch('/api/checkout/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, country }),
  })
  const data = (await res.json().catch(() => null)) as (Quote & { error?: string }) | { error?: string; code?: string } | null
  if (!res.ok || !data || !('gateway' in (data as Quote))) {
    const err = data as { error?: string; code?: string } | null
    return { ok: false, error: err?.error ?? 'Could not fetch the price for this country.', code: err?.code }
  }
  return { ok: true, quote: data as Quote }
}

export async function createCheckout(
  body: { productId: string; customerName: string; customerEmail: string; country: string; consent: true },
  idempotencyKey: string,
): Promise<{ res: Response; data: CheckoutCreateResponse }> {
  const res = await fetch('/api/checkout/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as CheckoutCreateResponse
  return { res, data }
}

// ── Razorpay Standard Checkout (loaded ONLY when the checkout step renders) ──

/** Success-handler payload per Razorpay's Standard Checkout docs. */
export interface RazorpayHandlerResponse {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

/**
 * Options accepted by `new window.Razorpay(...)` (checkout.js). NOTE:
 * checkout.js uses its OWN option names — `key`, `order_id` and
 * `prefill.{name,email}` — which DIFFER from the server echo
 * (`RazorpayCheckoutOptions`: keyId/orderId/prefillName/prefillEmail).
 * The checkout dialog maps the echo to this shape at the construction
 * site; passing the echo shape as-is throws "No key passed".
 */
export interface RazorpayOpenOptions {
  key: string
  order_id: string
  amount: number
  currency: string
  name: string
  description: string
  prefill: { name: string; email: string }
  notes?: Record<string, string>
  theme?: { color?: string }
  modal?: { ondismiss?: () => void }
  handler?: (response: RazorpayHandlerResponse) => void
}

export interface RazorpayCheckoutInstance {
  open: () => void
  close: () => void
  on?: (event: string, cb: (resp: { error?: { description?: string } }) => void) => void
}

interface RazorpayConstructor {
  new (options: RazorpayOpenOptions): RazorpayCheckoutInstance
}

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor
  }
}

const CHECKOUT_JS_ID = 'razorpay-checkout-js'
const CHECKOUT_JS_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

/**
 * Inject checkout.js once per page and resolve when window.Razorpay is
 * ready. Resolves false on failure OR timeout (ad-blockers and blackholed
 * networks can stall the request without ever firing onerror) so the
 * dialog can fall back to a friendly retry state instead of spinning
 * forever. Never loaded on any other view.
 */
export function loadRazorpayCheckout(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(false)
    if (window.Razorpay) return resolve(true)
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    const existing = document.getElementById(CHECKOUT_JS_ID) as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', () => done(Boolean(window.Razorpay)), { once: true })
      existing.addEventListener('error', () => done(false), { once: true })
    } else {
      const script = document.createElement('script')
      script.id = CHECKOUT_JS_ID
      script.src = CHECKOUT_JS_SRC
      script.async = true
      script.onload = () => done(Boolean(window.Razorpay))
      script.onerror = () => done(false)
      document.head.appendChild(script)
    }
    // The SDK normally arrives in well under 10 s — anything longer is a
    // stall (ad-blocker, offline) and the dialog must say so.
    window.setTimeout(() => done(Boolean(window.Razorpay)), 15_000)
  })
}
