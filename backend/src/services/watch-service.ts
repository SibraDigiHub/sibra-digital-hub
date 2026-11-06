// ═══════════════════════════════════════════════════════════
// T-V Feature C — protected watch page backend.
//
// Grant lifecycle:  paid order (watch mode) → WatchGrant minted
// at fulfillment (token hash only) → buyer opens /#/watch/<token>
// → resolve() checks state and ONLY THEN returns the embed URL →
// heartbeat() maintains the viewing session (concurrency cap,
// share detection) every 30s while the player is open.
//
// Protection layers (honest scope — see docs/VIDEO_PROTECTION.md):
//  • token: 32 random bytes, only SHA-256 stored (lib/delivery)
//  • checks: paid · not expired · not revoked · not locked
//  • concurrency: active sessions (heartbeat < 90s) < maxConcurrent
//  • share detection: > SHARE_NETWORK_LIMIT distinct networks / 24h
//    → grant auto-locked + admin alerted (contactEmail SiteSetting)
//  • privacy: network prefixes + user agents stored ONLY as
//    SESSION_PEPPER hashes — never raw IPs
//  • rate limiting lives in the routes (PG-backed, fail-open)
// ═══════════════════════════════════════════════════════════

import { db } from '@/lib/db'
import { ApiError } from '@/lib/api'
import { hashToken, generateToken } from '@/lib/delivery'
import { pepperHash } from '@/lib/crypto'
import { parseVideoSource, youTubePrivacyEmbedUrl } from '@/lib/video-source'
import { imagekitSignedUrlFromRef } from '@/lib/storage'
import { writeAudit, maskEmail } from '@/lib/audit'
import { sendSecurityAlertEmail } from '@/lib/email'

/** Active = heartbeat within this window (client beats every 30s). */
const ACTIVE_WINDOW_MS = 90_000
/** Distinct networks in 24h above which the grant auto-locks (brief §C). */
export const SHARE_NETWORK_LIMIT = 4
/** Admin "Preview as buyer" grant lifetime. */
const PREVIEW_TTL_MS = 30 * 60 * 1000
/** ImageKit watch-file signed URL lifetime (~1 hour, brief §B.6). */
const WATCH_FILE_TTL_SECONDS = 3600

export type WatchTokenState =
  | { ok: true; grant: WatchGrantFull }
  | { ok: false; status: 400 | 403 | 404 | 410; error: string }

type WatchGrantFull = NonNullable<Awaited<ReturnType<typeof findGrant>>>

function findGrant(token: string) {
  return db.watchGrant.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { order: { include: { product: true } } },
  })
}

/** Map a grant row to the exact failure state (friendly, stable shapes). */
async function stateFor(grant: WatchGrantFull | null): Promise<WatchTokenState> {
  if (!grant || grant.order.status !== 'paid') {
    return { ok: false, status: 403, error: 'This watch link is not valid' }
  }
  if (grant.revokedAt) {
    return { ok: false, status: 403, error: 'This watch link was revoked — contact us to renew your access' }
  }
  if (grant.lockedAt) {
    return {
      ok: false,
      status: 403,
      error: 'This watch link was locked because it was used from too many places. Contact us to unlock it.',
    }
  }
  if (grant.expiresAt < new Date()) {
    return { ok: false, status: 410, error: 'This watch link has expired — contact us for a fresh link' }
  }
  if (!grant.order.product?.fullVideoUrl) {
    return { ok: false, status: 404, error: 'Video missing — contact support' }
  }
  return { ok: true, grant }
}

/** Salted network prefix: IPv4 → /24, IPv6 → first 4 hextets, else raw. */
export function networkPrefix(ip: string): string {
  if (ip.includes('.') && !ip.includes(':')) {
    const parts = ip.split('.')
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`
    return ip
  }
  if (ip.includes(':')) {
    const hextets = ip.split(':').filter(Boolean).slice(0, 4)
    return `${hextets.join(':')}::/64`
  }
  return ip || 'unknown'
}

/** Buyer-facing watermark label (owner request): the shop brand floats over
 *  the video, with the short order ref so a leaked copy stays traceable. */
function watermarkLabel(order: WatchGrantFull['order']): string {
  return `Sibra Digital Hub · #${order.id.slice(-6).toUpperCase()}`
}

export interface WatchResolveResult {
  provider: 'youtube' | 'imagekit' | 'file'
  /** youtube-nocookie embed URL (fs=0), short-lived ImageKit URL (~1h), or the direct https file link. */
  src: string
  watermark: string
  expiresAt: string
  maxConcurrent: number
  productTitle: string
}

/**
 * Validate a watch token and — ONLY after every check passes — build
 * the player source server-side. The raw admin link never leaves the
 * server; YouTube ids become youtube-nocookie embed URLs and ImageKit
 * refs become short-lived signed URLs. This is the only place the
 * video identity crosses the boundary, and it requires a valid grant.
 */
export async function resolveWatch(token: string): Promise<WatchResolveResult> {
  if (!token || token.length < 16) throw new ApiError(400, 'Invalid watch link')
  const state = await stateFor(await findGrant(token))
  if (!state.ok) throw new ApiError(state.status, state.error)

  const { grant } = state
  const source = parseVideoSource(grant.order.product.fullVideoUrl)
  if (!source) throw new ApiError(404, 'Video missing — contact support')

  const src =
    source.provider === 'youtube'
      ? youTubePrivacyEmbedUrl(source.videoId)
      : imagekitSignedUrlFromRef(source.ref, { ttlSeconds: WATCH_FILE_TTL_SECONDS }) ??
        // ImageKit unconfigured → the private URL cannot be minted; the
        // stored value might still be a plain public https URL on our endpoint.
        (source.ref.startsWith('https://') ? source.ref : null)
  if (!src) throw new ApiError(404, 'Video missing — contact support')

  return {
    provider: source.provider,
    src,
    watermark: watermarkLabel(grant.order),
    expiresAt: grant.expiresAt.toISOString(),
    maxConcurrent: grant.maxConcurrent,
    productTitle: grant.order.product.title,
  }
}

export interface HeartbeatOk {
  ok: true
  activeCount: number
  maxConcurrent: number
  expiresAt: string
}
export interface HeartbeatFail {
  ok: false
  reason: 'concurrent' | 'locked' | 'expired' | 'revoked' | 'invalid'
  message: string
  activeCount?: number
  maxConcurrent?: number
}

/**
 * One viewing session heartbeat (client fires it every 30s while the
 * player page is open). Registers/refreshes the session, enforces the
 * concurrent-viewer cap and runs the 24h distinct-network share check.
 */
export async function watchHeartbeat(
  token: string,
  opts: { sessionId: string; ip: string; ua: string },
): Promise<HeartbeatOk | HeartbeatFail> {
  if (!token || token.length < 16) return { ok: false, reason: 'invalid', message: 'Invalid watch link' }
  if (!opts.sessionId || opts.sessionId.length < 8 || opts.sessionId.length > 64) {
    return { ok: false, reason: 'invalid', message: 'Invalid session' }
  }
  const state = await stateFor(await findGrant(token))
  if (!state.ok) {
    return {
      ok: false,
      reason: state.status === 410 ? 'expired' : state.error.includes('revoked') ? 'revoked' : state.error.includes('locked') ? 'locked' : 'invalid',
      message: state.error,
    }
  }
  const grant = state.grant
  const now = new Date()
  const sessionId = opts.sessionId

  const activeThreshold = new Date(now.getTime() - ACTIVE_WINDOW_MS)
  const activeOthers = await db.watchSession.count({
    where: { grantId: grant.id, sessionId: { not: sessionId }, lastSeenAt: { gte: activeThreshold } },
  })

  // Concurrency cap: a NEW session may not start while the max is full.
  const existing = await db.watchSession.findUnique({ where: { sessionId } })
  if (!existing && activeOthers >= grant.maxConcurrent) {
    return {
      ok: false,
      reason: 'concurrent',
      message: `This link is already being watched on ${activeOthers} device${activeOthers === 1 ? '' : 's'} (limit ${grant.maxConcurrent}). Close one and try again.`,
      activeCount: activeOthers,
      maxConcurrent: grant.maxConcurrent,
    }
  }

  const networkHash = pepperHash(networkPrefix(opts.ip))
  const uaHash = pepperHash(opts.ua)

  if (existing) {
    await db.watchSession.update({ where: { sessionId }, data: { lastSeenAt: now, networkHash, uaHash } })
  } else {
    await db.watchSession.create({ data: { grantId: grant.id, sessionId, networkHash, uaHash, lastSeenAt: now, createdAt: now } })

    // Share detection — count DISTINCT networks seen on this grant in 24h.
    const window = new Date(now.getTime() - 24 * 3600 * 1000)
    const networks = await db.watchSession.findMany({
      where: { grantId: grant.id, createdAt: { gte: window } },
      select: { networkHash: true },
      distinct: ['networkHash'],
    })
    if (networks.length > SHARE_NETWORK_LIMIT) {
      await db.watchGrant.update({
        where: { id: grant.id },
        data: { lockedAt: now, lockReason: `shared_networks:${networks.length}/24h` },
      })
      await writeAudit({
        action: 'watch.auto_locked',
        entity: 'order',
        entityId: grant.orderId,
        label: maskEmail(grant.order.customerEmail),
        diff: { distinctNetworks24h: networks.length, limit: SHARE_NETWORK_LIMIT },
      })
      void alertAdminWatchLock(grant, networks.length)
      return {
        ok: false,
        reason: 'locked',
        message: 'This watch link was used from too many places and has been locked. Contact us to unlock it.',
      }
    }
  }

  return {
    ok: true,
    activeCount: existing ? activeOthers + 1 : activeOthers + 1,
    maxConcurrent: grant.maxConcurrent,
    expiresAt: grant.expiresAt.toISOString(),
  }
}

/** Best-effort admin alert when a link auto-locks (console mode OK). */
async function alertAdminWatchLock(grant: WatchGrantFull, networks: number): Promise<void> {
  try {
    const setting = await db.siteSetting.findUnique({ where: { key: 'contactEmail' } })
    const to = setting?.value
    if (!to || !to.includes('@')) return
    await sendSecurityAlertEmail(
      to,
      'Watch link auto-locked (possible sharing)',
      [
        `A protected watch link was locked automatically.`,
        `Order: ${grant.orderId} — product "${grant.order.product.title}"`,
        `Distinct networks in 24h: ${networks} (limit ${SHARE_NETWORK_LIMIT})`,
        `Buyer: ${maskEmail(grant.order.customerEmail)}`,
        `Open the Admin → Orders to review, unlock or revoke this link.`,
      ],
    )
  } catch {
    // alerting must never break the lock response
  }
}

// ── Admin actions (revoke / unlock / extend / renew / preview) ──

export type WatchAdminAction = 'revoke' | 'unlock' | 'extend' | 'renew'

export async function adminWatchAction(
  orderId: string,
  action: WatchAdminAction,
  opts: { hours?: number } = {},
): Promise<{ ok: true; grant: { expiresAt: string; revokedAt: string | null; lockedAt: string | null } }> {
  const grant = await db.watchGrant.findUnique({ where: { orderId }, include: { order: { select: { customerEmail: true } } } })
  if (!grant) throw new ApiError(404, 'This order has no watch link')
  const now = new Date()
  let data: Record<string, unknown> = {}
  switch (action) {
    case 'revoke':
      data = { revokedAt: now }
      break
    case 'unlock':
      data = { lockedAt: null, lockReason: null, revokedAt: null }
      break
    case 'extend': {
      const hours = opts.hours && opts.hours > 0 ? Math.min(opts.hours, 24 * 30) : 24
      const base = grant.expiresAt > now ? grant.expiresAt : now
      data = { expiresAt: new Date(base.getTime() + hours * 3600 * 1000), revokedAt: null }
      break
    }
    case 'renew': {
      const hours = opts.hours && opts.hours > 0 ? Math.min(opts.hours, 24 * 30) : 48
      // "Renew" re-issues the BUYER'S link: it restores the credential that
      // was emailed at fulfillment (order.downloadTokenHash) and clears any
      // preview/lock/revocation state. Preview mints reuse this same 1:1
      // slot with a temporary token, so without this step a preview would
      // leave the buyer's emailed link pointing at a dead hash. For orders
      // that were never previewed this is a no-op (same hash).
      const order = await db.order.findUnique({ where: { id: orderId }, select: { downloadTokenHash: true } })
      data = {
        expiresAt: new Date(now.getTime() + hours * 3600 * 1000),
        revokedAt: null,
        lockedAt: null,
        lockReason: null,
        preview: false,
        ...(order?.downloadTokenHash ? { tokenHash: order.downloadTokenHash } : {}),
      }
      break
    }
  }
  const updated = await db.watchGrant.update({ where: { id: grant.id }, data })
  await writeAudit({
    action: `watch.${action}`,
    entity: 'order',
    entityId: orderId,
    label: maskEmail(grant.order.customerEmail),
    diff: { ...data, expiresAt: updated.expiresAt?.toISOString?.() },
  })
  return {
    ok: true,
    grant: {
      expiresAt: updated.expiresAt.toISOString(),
      revokedAt: updated.revokedAt?.toISOString() ?? null,
      lockedAt: updated.lockedAt?.toISOString() ?? null,
    },
  }
}

export interface WatchGrantStatus {
  exists: boolean
  expiresAt: string | null
  revokedAt: string | null
  lockedAt: string | null
  lockReason: string | null
  maxConcurrent: number | null
  activeSessions: number
  networks24h: number
  preview: boolean
}

export async function adminWatchStatus(orderId: string): Promise<WatchGrantStatus> {
  const grant = await db.watchGrant.findUnique({ where: { orderId } })
  if (!grant) {
    return { exists: false, expiresAt: null, revokedAt: null, lockedAt: null, lockReason: null, maxConcurrent: null, activeSessions: 0, networks24h: 0, preview: false }
  }
  const now = new Date()
  const [activeSessions, sessions] = await Promise.all([
    db.watchSession.count({ where: { grantId: grant.id, lastSeenAt: { gte: new Date(now.getTime() - ACTIVE_WINDOW_MS) } } }),
    db.watchSession.findMany({ where: { grantId: grant.id, createdAt: { gte: new Date(now.getTime() - 24 * 3600 * 1000) } }, select: { networkHash: true }, distinct: ['networkHash'] }),
  ])
  return {
    exists: true,
    expiresAt: grant.expiresAt.toISOString(),
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    lockedAt: grant.lockedAt?.toISOString() ?? null,
    lockReason: grant.lockReason,
    maxConcurrent: grant.maxConcurrent,
    activeSessions,
    networks24h: sessions.length,
    preview: grant.preview,
  }
}

/**
 * Admin "Preview as buyer" — mints a SHORT-LIVED preview grant for the
 * order (30 minutes, marked preview) and returns the plain token exactly
 * once. The real buyer token is never re-revealed; previews let the owner
 * experience the exact buyer page. Audit-logged.
 */
export async function mintPreviewGrant(orderId: string): Promise<{ token: string; expiresAt: string }> {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { product: true } })
  if (!order || order.status !== 'paid') throw new ApiError(404, 'Paid order not found')
  if (order.product?.deliveryMode !== 'watch' || !order.product.fullVideoUrl) {
    throw new ApiError(409, 'This order has no protected video')
  }
  const { plain } = generateToken()
  const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS)
  // Preview grants reuse the same 1:1 slot — an order keeps ONE grant; a new
  // preview replaces the previous one (upsert) so state stays single-source.
  await db.watchGrant.upsert({
    where: { orderId },
    create: { orderId, tokenHash: hashToken(plain), expiresAt, maxConcurrent: order.product.watchMaxConcurrent ?? 2, preview: true },
    update: { tokenHash: hashToken(plain), expiresAt, preview: true, revokedAt: null, lockedAt: null, lockReason: null },
  })
  await writeAudit({
    action: 'watch.preview_minted',
    entity: 'order',
    entityId: orderId,
    label: maskEmail(order.customerEmail),
    diff: { ttlMinutes: 30 },
  })
  return { token: plain, expiresAt: expiresAt.toISOString() }
}

/**
 * Fulfillment-time grant mint (watch mode). Reuses the SAME plain token
 * that was minted for the order download hash so the buyer holds ONE
 * credential; the grant adds its own expiry derived from the product.
 */
export async function mintGrantForOrder(orderId: string, token: string, ttlHours: number, maxConcurrent: number): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000)
  await db.watchGrant.upsert({
    where: { orderId },
    create: { orderId, tokenHash: hashToken(token), expiresAt, maxConcurrent },
    update: { tokenHash: hashToken(token), expiresAt, maxConcurrent, revokedAt: null, lockedAt: null, lockReason: null, preview: false },
  })
}
