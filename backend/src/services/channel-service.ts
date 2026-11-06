// ═══════════════════════════════════════════════════════════
// T-V Feature A — social media channel directory (zone-scoped).
// Admin CRUD + the public storefront list. Safety rules live
// here: ONLY official platform links pass (parseChannelUrl
// per-platform whitelist), nothing is hard-coded, and a zone
// never sees the other zone's channels.
// ═══════════════════════════════════════════════════════════

import { ApiError, conflict } from '@/lib/api'
import { db } from '@/lib/db'
import { isKnownChannelPlatform, parseChannelUrl, type ChannelPlatform } from '@/lib/video-source'
import type { ChannelCreateInput, ChannelUpdateInput } from '@/validators/channel'

export type ChannelRow = Awaited<ReturnType<typeof db.channel.findFirstOrThrow>>
export type ChannelDTO = ReturnType<typeof toChannelDTO>

/** Explicit admin DTO shape (mirrors the Prisma row, stable order). */
export function toChannelDTO(c: ChannelRow) {
  return {
    id: c.id,
    zone: c.zone,
    platform: c.platform,
    name: c.name,
    url: c.url,
    handle: c.handle,
    logo: c.logo,
    description: c.description,
    audienceTag: c.audienceTag,
    buttonText: c.buttonText,
    sortOrder: c.sortOrder,
    enabled: c.enabled,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }
}

/** Public card shape — same fields minus bookkeeping timestamps. */
export function toPublicChannelDTO(c: ChannelRow) {
  return {
    id: c.id,
    zone: c.zone,
    platform: c.platform,
    name: c.name,
    url: c.url,
    handle: c.handle,
    logo: c.logo,
    description: c.description,
    audienceTag: c.audienceTag,
    buttonText: c.buttonText,
    sortOrder: c.sortOrder,
  }
}

function assertChannelUrl(platform: string, url: string): string {
  const normalized = parseChannelUrl(url, platform)
  if (!normalized) {
    const label = isKnownChannelPlatform(platform) ? PLATFORM_LABELS[platform] : null
    throw conflict(
      label
        ? `Only official ${label} links are allowed`
        : 'Only a valid https link to the platform page is allowed',
    )
  }
  return normalized
}

const PLATFORM_LABELS: Record<ChannelPlatform, string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  pinterest: 'Pinterest',
  facebook: 'Facebook',
  x: 'X (Twitter)',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
}

// ── Admin CRUD ──────────────────────────────────────────────

export async function adminListChannels(zone?: 'kids' | 'creator'): Promise<ChannelDTO[]> {
  const rows = await db.channel.findMany({
    where: zone ? { zone } : undefined,
    orderBy: [{ zone: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  return rows.map(toChannelDTO)
}

export async function createChannel(input: ChannelCreateInput): Promise<ChannelDTO> {
  const url = assertChannelUrl(input.platform, input.url)
  const channel = await db.channel.create({
    data: {
      zone: input.zone,
      platform: input.platform,
      name: input.name,
      url,
      handle: input.handle?.replace(/^@+/, '') || null, // store handle without the @
      logo: input.logo || null,
      description: input.description || null,
      audienceTag: input.audienceTag || null,
      buttonText: input.buttonText || 'Subscribe',
      sortOrder: input.sortOrder,
      enabled: input.enabled,
    },
  })
  return toChannelDTO(channel)
}

export async function updateChannel(id: string, input: ChannelUpdateInput): Promise<ChannelDTO> {
  const existing = await db.channel.findUnique({ where: { id } })
  if (!existing) throw new ApiError(404, 'Channel not found')
  const data: Record<string, unknown> = {}
  if (input.name !== undefined) data.name = input.name
  const platform: string = input.platform ?? existing.platform
  if (input.platform !== undefined) data.platform = input.platform
  if (input.url !== undefined) data.url = assertChannelUrl(platform, input.url)
  if (input.handle !== undefined) data.handle = input.handle ? input.handle.replace(/^@+/, '') : null
  if (input.logo !== undefined) data.logo = input.logo || null
  if (input.description !== undefined) data.description = input.description || null
  if (input.audienceTag !== undefined) data.audienceTag = input.audienceTag || null
  if (input.buttonText !== undefined) data.buttonText = input.buttonText || 'Subscribe'
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder
  if (input.enabled !== undefined) data.enabled = input.enabled
  if (input.zone !== undefined) data.zone = input.zone
  const channel = await db.channel.update({ where: { id }, data })
  return toChannelDTO(channel)
}

export async function deleteChannel(id: string): Promise<void> {
  const existing = await db.channel.findUnique({ where: { id }, select: { id: true } })
  if (!existing) throw new ApiError(404, 'Channel not found')
  await db.channel.delete({ where: { id } })
}

// ── Public storefront list ──────────────────────────────────

/**
 * Enabled channels for ONE zone, display order. The other zone's
 * channels can never leak in — the zone filter is unconditional.
 * An empty zone shows nothing (callers render no section at all).
 */
export async function listPublicChannels(zone: 'kids' | 'creator') {
  const rows = await db.channel.findMany({
    where: { zone, enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  return rows.map(toPublicChannelDTO)
}