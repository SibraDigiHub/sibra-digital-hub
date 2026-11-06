// ═══════════════════════════════════════════════════════════
// Postgres-backed rate limiting (atomic single-statement upsert).
// Replaces the old in-memory limiter — safe across serverless
// instances and restarts. Window is encoded in the key, e.g.
//   rateLimit(`login:em:${emailHash}`, 5, 15 * 60_000)
// ═══════════════════════════════════════════════════════════

import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

export interface RateLimitResult {
  allowed: boolean
  /** ms until the window resets (0 when allowed) */
  retryAfterMs: number
  remaining: number
}

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const resetAt = new Date(Date.now() + windowMs)
  const rows = await db.$queryRaw<{ count: number; resetAt: Date }[]>(Prisma.sql`
    INSERT INTO "RateLimit" ("key", "count", "resetAt")
    VALUES (${key}, 1, ${resetAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count"   = CASE WHEN "RateLimit"."resetAt" <= now() THEN 1 ELSE "RateLimit"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimit"."resetAt" <= now() THEN ${resetAt} ELSE "RateLimit"."resetAt" END
    RETURNING "count", "resetAt"
  `)
  const row = rows[0]
  if (!row) return { allowed: true, retryAfterMs: 0, remaining: limit - 1 }
  const count = Number(row.count)
  if (count > limit) {
    const retryAfterMs = Math.max(0, new Date(row.resetAt).getTime() - Date.now())
    return { allowed: false, retryAfterMs, remaining: 0 }
  }
  return { allowed: true, retryAfterMs: 0, remaining: Math.max(0, limit - count) }
}

/** Housekeeping — call opportunistically (e.g. from cron/system route) to prune expired windows. */
export async function pruneRateLimits(): Promise<void> {
  try {
    await db.$executeRaw(Prisma.sql`DELETE FROM "RateLimit" WHERE "resetAt" <= now() - interval '1 day'`)
  } catch {
    // never break a request for housekeeping
  }
}
