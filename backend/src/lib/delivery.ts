// ═══════════════════════════════════════════════════════════
// Instant-delivery primitives (PRD §10.3, T5 §6 hardened):
// token minting (32 random bytes, only SHA-256 stored),
// env-driven TTL + download cap, and the ATOMIC download
// claim used by the download route.
//
// Order fulfillment itself (paid → token → email exactly once)
// lives in services/order-service.ts → fulfillOrder().
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto'
import { db } from '@/lib/db'
import { downloadTtlHours, downloadMaxDefault } from '@/config/env'

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * Mint a download token: 32 random bytes, base64url-encoded.
 * Only its SHA-256 hash is ever persisted — the plain token
 * exists solely in the delivery email / thank-you response.
 */
export function generateToken(): { plain: string; hash: string; expiresAt: Date } {
  const plain = crypto.randomBytes(32).toString('base64url')
  return { plain, hash: hashToken(plain), expiresAt: new Date(Date.now() + downloadTtlHours() * 3600 * 1000) }
}

/** Current per-order download cap (DOWNLOAD_MAX_DEFAULT, default 5). */
export function maxDownloads(): number {
  return downloadMaxDefault()
}

/**
 * T5: atomically claim one download slot.
 *
 * Increment `downloadCount` ONLY when the token hash matches, the
 * order is paid, the token is unexpired and the cap is not reached —
 * all in ONE conditional UPDATE, so 10 concurrent claims on a
 * max-3 order yield exactly 3 successes.
 *
 * Returns the number of rows claimed (0 ⇒ cap reached / expired /
 * not claimable — callers must re-read the order for the exact state).
 */
export async function claimDownload(tokenHash: string, max: number): Promise<number> {
  const result = await db.order.updateMany({
    where: {
      downloadTokenHash: tokenHash,
      status: 'paid',
      downloadCount: { lt: max },
      tokenExpiresAt: { gt: new Date() },
    },
    data: { downloadCount: { increment: 1 } },
  })
  return result.count
}
