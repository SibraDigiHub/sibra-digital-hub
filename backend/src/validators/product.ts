import { z } from 'zod'

export const zoneEnum = z.enum(['kids', 'creator'])
export const productStatusEnum = z.enum(['draft', 'published', 'archived'])

const jsonArrayOfStrings = z.union([z.string(), z.array(z.string()).default([])])
const jsonPlatformLinks = z.union([z.string(), z.array(z.object({ platform: z.string(), url: z.string() })).default([])])

/** Product create/update payload — mirrors what the admin UI sends today. */
export const productInputSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().max(200).optional(),
  zone: zoneEnum,
  category: z.string().min(1).default('coloring-books'),
  authorBrand: z.string().default('Sibra Digital Hub'),
  ageOrLevel: z.string().optional().nullable(),
  priceUsd: z.coerce.number().min(0).default(0),
  priceInr: z.coerce.number().min(0).default(0),
  badge: z.string().default('New'),
  description: z.string().default(''),
  whatsInside: jsonArrayOfStrings.optional(),
  howToUse: z.string().default(''),
  license: z.string().default('personal'),
  mediaType: z.enum(['images', 'video']).default('images'),
  images: jsonArrayOfStrings.optional(),
  videoPreviewUrl: z.string().optional().nullable(),
  internationalLink: z.string().optional().nullable(),
  indiaLink: z.string().optional().nullable(),
  platformLinks: jsonPlatformLinks.optional(),
  instantDownload: z.coerce.boolean().default(false),
  deliverableUrl: z.string().optional().nullable(),
  deliverableName: z.string().optional().nullable(),
  // ── T-V additive video-delivery fields (existing products default 'file') ──
  deliveryMode: z.enum(['file', 'external', 'watch']).default('file'),
  // Full video for watch mode — server-side whitelist (YouTube unlisted or
  // ImageKit). Raw value stays server-private; see lib/video-source.
  fullVideoUrl: z.string().optional().nullable(),
  watchTtlHours: z.coerce.number().int().min(1).max(24 * 30).optional().nullable(),
  watchMaxConcurrent: z.coerce.number().int().min(1).max(10).default(2),
  featured: z.coerce.boolean().default(false),
  sortOrder: z.coerce.number().int().default(0),
  status: z.enum(['draft', 'published']).default('published'),
  tags: jsonArrayOfStrings.optional(),
  fileFormats: jsonArrayOfStrings.optional(),
  pageCount: z.coerce.number().int().positive().optional().nullable(),
  spatialCoords: z.union([z.string(), z.object({ x: z.number(), y: z.number(), z: z.number() })]).optional(),
})

export type ProductInput = z.infer<typeof productInputSchema>

export const productListQuerySchema = z.object({
  zone: z.enum(['kids', 'creator']).optional(),
  category: z.string().optional(),
  q: z.string().max(200).optional(),
  sort: z.enum(['featured', 'newest', 'price-asc', 'price-desc']).default('featured'),
  status: z.string().optional(),
  featured: z.string().optional(),
  slug: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

export type ProductListQuery = z.infer<typeof productListQuerySchema>
