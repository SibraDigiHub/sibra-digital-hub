// ═══════════════════════════════════════════════════════════
// T4 rate limiting — Postgres-backed (RateLimit table), atomic
// single-statement upsert. Never in process memory, so limits
// survive restarts and hold across serverless instances.
// ═══════════════════════════════════════════════════════════

import { db } from '@/lib/db'
import { hmacHex } from '@/lib/auth/crypto'

export interface RateLimitResult {
  allowed: boolean
  count: number
  /** Seconds until the window resets (only when blocked). */
  retryAfterSec: number
}

/**
 * Consume one unit from the bucket `key`. Atomic upsert:
 * if the row is expired the counter restarts, otherwise it increments —
 * decided inside a single SQL statement (no read-modify-write race).
 */
export async function consumeRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const windowSec = Math.ceil(windowMs / 1000)
  const resetAt = new Date(Date.now() + windowMs)
  const rows = await db.$queryRawUnsafe<{ count: number; reset_at: Date }[]>(
    `INSERT INTO "RateLimit" (key, count, "resetAt")
     VALUES ($1, 1, $2)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN "RateLimit"."resetAt" < NOW() THEN 1 ELSE "RateLimit".count + 1 END,
       "resetAt" = CASE WHEN "RateLimit"."resetAt" < NOW() THEN $2 ELSE "RateLimit"."resetAt" END
     RETURNING count, "resetAt" AS reset_at`,
    key,
    resetAt,
  )
  const row = rows[0]
  if (!row) return { allowed: false, count: limit + 1, retryAfterSec: windowSec }
  const allowed = row.count <= limit
  const retryAfterSec = allowed ? 0 : Math.max(1, Math.ceil((row.reset_at.getTime() - Date.now()) / 1000))
  return { allowed, count: row.count, retryAfterSec }
}

/** Reset a bucket (e.g. after a successful login so good attempts don't accumulate). */
export async function resetRateLimit(key: string): Promise<void> {
  await db.rateLimit.deleteMany({ where: { key } }).catch(() => undefined)
}

/**
 * T7: fail-open wrapper for the public-flow limiters — a limiter outage
 * must never take the shop down (the DB is already required by the very
 * next query). Abuse protection degrades gracefully; admin-auth limiters
 * (T4) keep their strict fail-closed behaviour.
 */
export async function consumeRateLimitSafe(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  try {
    return await consumeRateLimit(key, limit, windowMs)
  } catch {
    return { allowed: true, count: 0, retryAfterSec: 0 }
  }
}

// ── Named limiters (T4 policy) ──────────────────────────────
const MIN = 60_000

export const loginLimitPerIpEmail = (ip: string, email: string) =>
  consumeRateLimit(`login:ie:${hmacHex(ip + '|' + email.toLowerCase())}`, 5, 15 * MIN)
export const loginLimitPerIp = (ip: string) =>
  consumeRateLimit(`login:ip:${hmacHex(ip)}`, 20, 60 * MIN)
export const twoFaLimitPerSession = (sessionId: string) =>
  consumeRateLimit(`2fa:s:${sessionId}`, 5, 5 * MIN)
export const forgotLimitPerIp = (ip: string) =>
  consumeRateLimit(`fp:ip:${hmacHex(ip)}`, 3, 60 * MIN)
export const forgotLimitPerEmail = (email: string) =>
  consumeRateLimit(`fp:em:${hmacHex(email.toLowerCase())}`, 3, 60 * MIN)
export const resetLimitPerIpToken = (ip: string, token: string) =>
  consumeRateLimit(`rp:it:${hmacHex(ip + '|' + token)}`, 5, 15 * MIN)
export const enrollLimitPerSession = (sessionId: string) =>
  consumeRateLimit(`enroll:s:${sessionId}`, 10, 15 * MIN)

// ── Named limiters (T7 policy, §8.2) ────────────────────────
// All keyed on hashed values (IPs never stored in the clear) and
// fail-open on limiter errors (consumeRateLimitSafe) — they guard
// public/customer flows where availability comes first.
const HOUR = 60 * MIN

/** POST /api/orders (checkout create) — 10 per 15 min per IP. */
export const ordersCreateLimitPerIp = (ip: string) =>
  consumeRateLimitSafe(`orders:ip:${hmacHex(ip)}`, 10, 15 * MIN)

/** GET /api/download/[token] (claim attempts) — 30 per min per IP. */
export const downloadLimitPerIp = (ip: string) =>
  consumeRateLimitSafe(`dl:ip:${hmacHex(ip)}`, 30, MIN)

/** POST /api/orders/[id]/resend (admin delivery-email resend) — 10 per hour per IP. */
export const resendLimitPerIp = (ip: string) =>
  consumeRateLimitSafe(`resend:ip:${hmacHex(ip)}`, 10, HOUR)

// ── Dual payment checkout buckets (§10.4) ───────────────────

/** POST /api/checkout/quote — 60 per 5 min per IP (page re-renders requote). */
export const checkoutQuoteLimitPerIp = (ip: string) =>
  consumeRateLimitSafe(`checkout:quote:ip:${hmacHex(ip)}`, 60, 5 * MIN)

/** POST /api/checkout/create — 10 per 15 min per IP (matches the legacy create bucket). */
export const checkoutCreateLimitPerIp = (ip: string) =>
  consumeRateLimitSafe(`checkout:create:ip:${hmacHex(ip)}`, 10, 15 * MIN)

/** POST /api/orders/[id]/demo-pay (simulated payment) — 20 per 5 min per IP. */
export const demoPayLimitPerIp = (ip: string) =>
  consumeRateLimitSafe(`checkout:demopay:ip:${hmacHex(ip)}`, 20, 5 * MIN)

/** GET /api/orders/[id]/status — 120 per 5 min per IP (3 s polling). */
export const checkoutStatusLimitPerIp = (ip: string) =>
  consumeRateLimitSafe(`checkout:status:ip:${hmacHex(ip)}`, 120, 5 * MIN)

/** POST /api/razorpay/verify — 20 per 5 min per IP (each call triggers a gateway fetch). */
export const razorpayVerifyLimitPerIp = (ip: string) =>
  consumeRateLimitSafe(`razorpay:verify:ip:${hmacHex(ip)}`, 20, 5 * MIN)

/** GET /api/watch/[token]/resolve — 30 per min per IP (token-guessing throttle, T-V). */
export const watchResolveLimitPerIp = (ip: string) =>
  consumeRateLimitSafe(`watch:resolve:ip:${hmacHex(ip)}`, 30, MIN)

/** POST /api/watch/[token]/heartbeat — 120 per min per IP (30s beats × devices, T-V). */
export const watchHeartbeatLimitPerIp = (ip: string) =>
  consumeRateLimitSafe(`watch:hb:ip:${hmacHex(ip)}`, 120, MIN)

/** GET /api/video/preview (click-to-play source fetch) — 60 per min per IP (T-V). */
export const videoPreviewLimitPerIp = (ip: string) =>
  consumeRateLimitSafe(`video:preview:ip:${hmacHex(ip)}`, 60, MIN)

/** GET /api/imagekit/auth (admin upload signing) — 30 per min per IP. */
export const imagekitSignLimitPerIp = (ip: string) =>
  consumeRateLimitSafe(`ik:ip:${hmacHex(ip)}`, 30, MIN)

/** POST /api/events (public analytics beacon) — 60 per min per IP. */
export const eventsLimitPerIp = (ip: string) =>
  consumeRateLimitSafe(`events:ip:${hmacHex(ip)}`, 60, MIN)

/** POST /api/reviews/order (verified review submit) — 10 per hour per IP. */
export const reviewSubmitLimitPerIp = (ip: string) =>
  consumeRateLimitSafe(`review:ip:${hmacHex(ip)}`, 10, HOUR)

/** GET /api/reviews/order (rate-page resolve) — 30 per min per IP (token-guessing throttle). */
export const reviewResolveLimitPerIp = (ip: string) =>
  consumeRateLimitSafe(`review:r:ip:${hmacHex(ip)}`, 30, MIN)
