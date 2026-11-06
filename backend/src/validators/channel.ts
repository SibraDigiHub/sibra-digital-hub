import { z } from 'zod'

export const channelZoneEnum = z.enum(['kids', 'creator'])

/** Named social platforms — each has a strict URL host whitelist in lib/video-source.ts. */
export const channelPlatformEnum = z.enum(['youtube', 'instagram', 'pinterest', 'facebook', 'x', 'whatsapp', 'telegram'])

/**
 * "Other" — any platform beyond the named list. The admin types the
 * platform's display name (e.g. "Snapchat", "Moj") and that name is
 * stored AS the platform value, so a brand-new network needs no code
 * or schema change. URL rule: any valid https page link (generic
 * host check in lib/video-source.ts).
 */
export const customPlatformSchema = z
  .string()
  .trim()
  .min(1, 'Platform name is required for Other')
  .max(40, 'Keep the platform name under 40 characters')
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} .&+'’-]*$/u, 'Use letters, numbers, spaces and . & + - only')

/** A channel platform is either a known id or an admin-defined "Other" name. */
export const channelPlatformSchema = z.union([channelPlatformEnum, customPlatformSchema])

/**
 * T-V Feature A — admin channel payload. Every field the brief asks
 * for: zone, platform (which social network), name, page link
 * (whitelist-validated per platform), optional handle, logo (uploaded
 * via the existing ImageKit flow), short description (≤120 chars),
 * optional audience tag, button text, order number and the on/off switch.
 */
export const channelCreateSchema = z.object({
  zone: channelZoneEnum,
  platform: channelPlatformSchema.default('youtube'),
  name: z.string().trim().min(1, 'Channel name is required').max(80),
  url: z.string().trim().min(1, 'Page link is required').max(500),
  handle: z.string().trim().max(40).optional().nullable(),
  logo: z.string().trim().max(600).optional().nullable(),
  description: z.string().trim().max(120, 'Keep the description to 120 characters').optional().nullable(),
  audienceTag: z.string().trim().max(40).optional().nullable(),
  buttonText: z.string().trim().min(1).max(24).default('Subscribe'),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  enabled: z.coerce.boolean().default(true),
})

export const channelUpdateSchema = channelCreateSchema.partial()

export const channelListQuerySchema = z.object({
  zone: channelZoneEnum.optional(),
})

export type ChannelCreateInput = z.infer<typeof channelCreateSchema>
export type ChannelUpdateInput = z.infer<typeof channelUpdateSchema>
