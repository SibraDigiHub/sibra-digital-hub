// ═══════════════════════════════════════════════════════════
// Razorpay — Orders API client (single-gateway migration).
// Replaces the Payment Links client: checkout now opens the
// Standard Checkout with a server-created Razorpay Order.
//
// Interface (migration plan §2.3):
//   createRazorpayOrder      POST /v1/orders           (never blindly retried —
//                             one retry for network/429/5xx only, the documented
//                             ambiguous-timeout risk is absorbed by the session
//                             claim + GATEWAY_SESSION_UNSTORED reconciliation)
//   fetchRazorpayOrder       GET  /v1/orders/:id       (idempotent GET, ≤2 attempts)
//   fetchRazorpayOrderPayments GET /v1/orders/:id/payments (reconcile)
//   fetchRazorpayPayment     GET  /v1/payments/:id     (verify/webhook/refund match)
//   verifyCheckoutSignature  HMAC_SHA256("order|payment", KEY_SECRET), constant time
//   verifyWebhookSignature   HMAC_SHA256(raw body, WEBHOOK_SECRET), constant time
//
// Hardening carried over from the Payment Links client:
//  • every outbound call has a hard 10 s AbortSignal timeout;
//  • idempotent GETs retry once; the order-creating POST retries ONLY on
//    network errors / 429 / 5xx (never on other 4xx);
//  • signature compares are constant-time (timingSafeEqual), hex-decoded
//    on both sides and length-checked first;
//  • RAZORPAY_MODE/key-prefix disagreements refuse production boot
//    (config/env.ts) and log a dev advisory here;
//  • RAZORPAY_API_BASE is a TEST-ONLY override (local mock server) —
//    production refuses to boot with it set (config/env.ts).
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto'
import { env, razorpayModeWarning } from '@/config/env'

const OUTBOUND_TIMEOUT_MS = 10_000
/** Max attempts for idempotent GETs (1 initial + 1 retry). */
const GET_MAX_ATTEMPTS = 2

/** Official REST API root. Overridable ONLY for the local mock server. */
function apiBase(): string {
  return (process.env.RAZORPAY_API_BASE || 'https://api.razorpay.com').replace(/\/+$/, '')
}

export function razorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
}

export function razorpayWebhookConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_WEBHOOK_SECRET)
}

/** Dev-only advisory: warn once when RAZORPAY_MODE and the key prefix disagree. */
let modeWarned = false
export function warnIfRazorpayModeMismatch(): void {
  if (modeWarned || env.NODE_ENV === 'production') return
  const problem = razorpayModeWarning()
  if (problem) {
    modeWarned = true
    // Lazy import avoids a module-load cycle (logger imports env).
    import('@/lib/logger').then(({ logger }) => logger.warn({ reason: problem }, 'razorpay mode/prefix mismatch'))
  }
}

function basicAuth(): string {
  return Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')
}

// ── Currency exponent table (migration plan §2.5 / master §6) ──
// Amounts are integer MINOR units everywhere; the exponent decides the
// minor-unit factor. Never assume two decimals. Currencies outside this
// table are refused by the router, never guessed. Exponents per ISO-4217
// for the currencies Razorpay documents for international payments.
const CURRENCY_EXPONENTS: Record<string, number> = {
  INR: 2, USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, SGD: 2, AED: 2, NZD: 2,
  CHF: 2, HKD: 2, JPY: 0, KRW: 0, MYR: 2, THB: 2, SAR: 2, QAR: 2, OMR: 3,
  BHD: 3, KWD: 3, BND: 2, ZAR: 2, SEK: 2, NOK: 2, DKK: 2, MXN: 2, BRL: 2,
}

/** 10^exponent for a supported currency, or null when unsupported (never guessed). */
export function currencyExponentFactor(currency: string): number | null {
  const exp = CURRENCY_EXPONENTS[currency.toUpperCase()]
  return exp === undefined ? null : 10 ** exp
}

/** Major units → minor units for a supported currency, or null when unsupported. */
export function toCurrencyMinor(major: number, currency: string): number | null {
  if (typeof major !== 'number' || !Number.isFinite(major) || major <= 0) return null
  const factor = currencyExponentFactor(currency)
  return factor === null ? null : Math.round(major * factor)
}

// ── Error mapping (migration plan §2.5): stable internal codes, ──
// raw gateway errors never reach the buyer.
export type RazorpayFailureCode =
  | 'RAZORPAY_REJECTED' // 4xx: currency/amount/limit/method not allowed for this account
  | 'RAZORPAY_UNAVAILABLE' // network/timeout/429/5xx — transient, retry makes sense
  | 'RAZORPAY_NOT_CONFIGURED'

export function mapRazorpayError(status: number | null, errName?: string): RazorpayFailureCode {
  if (status === null || status === 429 || status >= 500) return 'RAZORPAY_UNAVAILABLE'
  if (status >= 400 && status < 500) return 'RAZORPAY_REJECTED'
  if (errName === 'AbortError' || errName === 'TimeoutError') return 'RAZORPAY_UNAVAILABLE'
  return 'RAZORPAY_UNAVAILABLE'
}

export interface RazorpayOrderResult {
  ok: boolean
  code?: RazorpayFailureCode
  razorpayOrderId?: string
  status?: number
  error?: string
}

/**
 * Create a Razorpay Order. `amountMinor` is already integer minor units in
 * `currency` (server-authoritative — never converted from the client).
 * `receipt` is our order reference within Razorpay's 40-char limit.
 * Retry policy: ONE retry for network/429/5xx only — an ambiguous timeout
 * can leave an unpaid orphan Razorpay order, which the session-claim +
 * reconciliation machinery absorbs (never a second payable session).
 */
export async function createRazorpayOrder(opts: {
  amountMinor: number
  currency: string
  receipt: string
  notes: Record<string, string>
}): Promise<RazorpayOrderResult> {
  if (!razorpayConfigured()) return { ok: false, code: 'RAZORPAY_NOT_CONFIGURED' }
  warnIfRazorpayModeMismatch()
  let lastCode: RazorpayFailureCode = 'RAZORPAY_UNAVAILABLE'
  let lastError = 'unknown'
  let lastStatus: number | null = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${apiBase()}/v1/orders`, {
        method: 'POST',
        headers: { Authorization: `Basic ${basicAuth()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: opts.amountMinor,
          currency: opts.currency,
          receipt: opts.receipt.slice(0, 40),
          notes: opts.notes,
        }),
        signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
      })
      const data = (await res.json().catch(() => null)) as { id?: string; error?: { description?: string } } | null
      if (res.ok && data?.id) return { ok: true, razorpayOrderId: data.id, status: res.status }
      lastStatus = res.status
      lastCode = mapRazorpayError(res.status)
      lastError = data?.error?.description || `Razorpay ${res.status}`
      // 4xx (other than 429) is deterministic — never retry.
      if (res.status < 500 && res.status !== 429) break
    } catch (e) {
      lastCode = 'RAZORPAY_UNAVAILABLE'
      lastError = e instanceof Error ? e.name : String(e)
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 400))
  }
  return { ok: false, code: lastCode, status: lastStatus ?? undefined, error: lastError }
}

interface RazorpayFetchResult<T> {
  ok: boolean
  data?: T
  status?: number
  error?: string
}

/** Idempotent GET helper (≤2 attempts, 10 s timeout each). */
async function razorpayGet<T>(path: string): Promise<RazorpayFetchResult<T>> {
  if (!razorpayConfigured()) return { ok: false, error: 'not_configured' }
  let lastError = 'unknown'
  for (let attempt = 1; attempt <= GET_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${apiBase()}${path}`, {
        headers: { Authorization: `Basic ${basicAuth()}` },
        signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
      })
      if (res.status >= 500 || res.status === 429) {
        lastError = `Razorpay ${res.status}`
        continue // transient — safe to retry an idempotent GET
      }
      const data = (await res.json().catch(() => null)) as T | null
      if (!res.ok) return { ok: false, status: res.status, error: `Razorpay ${res.status}` }
      return { ok: true, data: data as T, status: res.status }
    } catch (e) {
      lastError = e instanceof Error ? e.name : String(e)
    }
  }
  return { ok: false, error: lastError }
}

export interface RazorpayOrderView {
  id?: string
  status?: string
  amount?: number
  currency?: string
  amount_paid?: number
  attempts?: number
}

/** Fetch a Razorpay Order by id (reconcile / audit). */
export async function fetchRazorpayOrder(orderId: string): Promise<RazorpayFetchResult<RazorpayOrderView>> {
  return razorpayGet<RazorpayOrderView>(`/v1/orders/${encodeURIComponent(orderId)}`)
}

export interface RazorpayPaymentView {
  id?: string
  status?: string
  amount?: number
  currency?: string
  order_id?: string
  method?: string
  international?: boolean
  error_description?: string
}

/** Fetch the payments of a Razorpay Order (reconcile: find the captured one). */
export async function fetchRazorpayOrderPayments(orderId: string): Promise<RazorpayFetchResult<{ items?: RazorpayPaymentView[] }>> {
  return razorpayGet<{ items?: RazorpayPaymentView[] }>(`/v1/orders/${encodeURIComponent(orderId)}/payments`)
}

/**
 * Fetch a single payment entity (verify route: confirm captured status +
 * amount + currency against the order's DB amount before fulfilling).
 */
export async function fetchRazorpayPayment(paymentId: string): Promise<{
  ok: boolean
  payment?: RazorpayPaymentView
  error?: string
}> {
  const res = await razorpayGet<RazorpayPaymentView>(`/v1/payments/${encodeURIComponent(paymentId)}`)
  if (!res.ok) return { ok: false, error: res.error }
  return { ok: true, payment: res.data }
}

// ── Signature verification (constant time) ──────────────────

/**
 * Compare two hex digests in constant time: both sides are hex-decoded
 * and length-checked BEFORE the comparison (timingSafeEqual throws on
 * unequal lengths — the length check turns that into a plain false).
 */
function hexEquals(aHex: string, bHex: string): boolean {
  if (typeof aHex !== 'string' || typeof bHex !== 'string') return false
  if (aHex.length !== bHex.length || aHex.length === 0 || aHex.length % 2 !== 0) return false
  const a = Buffer.from(aHex, 'hex')
  const b = Buffer.from(bHex, 'hex')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/** Verify X-Razorpay-Signature: HMAC-SHA256 of the RAW webhook body with the webhook secret. */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret || !signature) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  return hexEquals(expected, signature)
}

/**
 * Verify the Standard Checkout payment signature —
 * HMAC_SHA256(`${razorpay_order_id}|${razorpay_payment_id}`, KEY_SECRET).
 */
export function verifyCheckoutSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string | null | undefined,
): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET
  if (!secret || !signature) return false
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex')
  return hexEquals(expected, signature)
}
