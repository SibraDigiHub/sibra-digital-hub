// Catalog + product CRUD business rules. Controllers parse, services decide.
import { Prisma } from '@prisma/client'
import { ApiError, conflict, str } from '@/lib/api'
import { isAdmin, hasAdminSessionCookie } from '@/lib/admin-auth'
import { productRepo, ProductRow } from '@/repositories/product-repo'
import { cleanPastedVideoUrl, parseVideoSource, type VideoSource } from '@/lib/video-source'
import { isR2Ref, parseR2Ref } from '@/lib/r2'
import { isImagekitRef, parseImagekitRef } from '@/lib/storage'
import type { ProductInput, ProductListQuery } from '@/validators/product'
import type { NextRequest } from 'next/server'

/**
 * T-V: safe public video descriptor — replaces the raw admin URL in every
 * public response. Falls back to the watch-mode link (fullVideoUrl) so
 * cards/product pages can show the video's own YouTube thumbnail. Only the
 * SAFE shape ever leaves the server ({provider, videoId|ref}) — the raw
 * admin link itself is never included in any public response.
 */
export function toVideoPreviewDTO(p: Pick<ProductRow, 'videoPreviewUrl' | 'fullVideoUrl'>): VideoSource | null {
  return parseVideoSource(p.videoPreviewUrl ?? p.fullVideoUrl)
}

/** T-V: admin watch-video fields must point at a whitelisted source (YouTube / ImageKit / direct file). */
function assertSafeVideoUrl(raw: string | null | undefined, label: string): string | null {
  if (!raw || !raw.trim()) return null
  // Clipboard copies often carry invisible Unicode — validate + store the
  // cleaned link so the DB never keeps characters that break downstream
  // parsing/playback (behaviour for clean input is byte-identical).
  const cleaned = cleanPastedVideoUrl(raw)
  if (!parseVideoSource(cleaned)) {
    throw conflict(
      `${label}: only YouTube links, videos hosted on our ImageKit account, or direct video file links (.mp4/.webm/.mov/.m4v) are allowed`,
    )
  }
  return cleaned
}

/**
 * Validate paid deliverable references without changing existing storage formats.
 * Private references must pass their scheme-specific parser. Legacy HTTP(S)
 * and site-relative file paths remain supported.
 */
function assertSafeDeliverableUrl(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null

  const value = raw.trim()

  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw conflict('Deliverable reference contains invalid control characters')
  }

  if (isR2Ref(value)) {
    if (!parseR2Ref(value)) {
      throw conflict('Invalid private Cloudflare R2 deliverable reference')
    }
    return value
  }

  if (isImagekitRef(value)) {
    if (!parseImagekitRef(value)) {
      throw conflict('Invalid private ImageKit deliverable reference')
    }
    return value
  }

  // Keep existing site-relative deliverable paths working.
  // Reject //host paths because they redirect to another origin.
  if (value.startsWith('/')) {
    if (value.startsWith('//')) {
      throw conflict('Protocol-relative deliverable URLs are not allowed')
    }
    return value
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw conflict('Deliverable must be a valid HTTP(S), relative, R2, or ImageKit reference')
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw conflict('Only HTTP(S) external deliverable URLs are allowed')
  }

  return value
}

/** DTO mapper — explicit output shape, identical to the legacy Prisma row shape. */
export function toProductDTO(p: ProductRow) {
  return {
    id: p.id,
    title: p.title,
    slug: p.slug,
    zone: p.zone,
    category: p.category,
    authorBrand: p.authorBrand,
    ageOrLevel: p.ageOrLevel,
    priceUsd: p.priceUsd,
    priceInr: p.priceInr,
    badge: p.badge,
    description: p.description,
    whatsInside: p.whatsInside,
    howToUse: p.howToUse,
    license: p.license,
    mediaType: p.mediaType,
    images: p.images,
    videoPreviewUrl: p.videoPreviewUrl,
    // T-V: the admin shape ALSO carries the safe public descriptor. The
    // owner browses the storefront with an admin session cookie, and the
    // cards/detail page render from `videoPreview` — without it a
    // logged-in admin saw the default hero photo instead of the video's
    // own thumbnail (the raw link stays admin-only exactly as before).
    videoPreview: toVideoPreviewDTO(p),
    // ── T-V additive fields (admin sees the raw private values) ──
    deliveryMode: p.deliveryMode,
    fullVideoUrl: p.fullVideoUrl,
    watchTtlHours: p.watchTtlHours,
    watchMaxConcurrent: p.watchMaxConcurrent,
    internationalLink: p.internationalLink,
    indiaLink: p.indiaLink,
    platformLinks: p.platformLinks,
    instantDownload: p.instantDownload,
    deliverableUrl: p.deliverableUrl,
    deliverableName: p.deliverableName,
    featured: p.featured,
    sortOrder: p.sortOrder,
    status: p.status,
    tags: p.tags,
    fileFormats: p.fileFormats,
    pageCount: p.pageCount,
    spatialCoords: p.spatialCoords,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }
}

/**
 * T5 (§6.5): the PUBLIC catalog shape — paid file references
 * (deliverableUrl / deliverableName) never appear in any public
 * response. Every other field, in the same order, is unchanged.
 * Admin responses keep the full DTO (admin UI edits the fields).
 */
export function toPublicProductDTO(p: ProductRow) {
  return {
    id: p.id,
    title: p.title,
    slug: p.slug,
    zone: p.zone,
    category: p.category,
    authorBrand: p.authorBrand,
    ageOrLevel: p.ageOrLevel,
    priceUsd: p.priceUsd,
    priceInr: p.priceInr,
    badge: p.badge,
    description: p.description,
    whatsInside: p.whatsInside,
    howToUse: p.howToUse,
    license: p.license,
    mediaType: p.mediaType,
    images: p.images,
    // T-V: the RAW video link never appears in any public response —
    // pages get a safe descriptor (youtube video id / imagekit ref)
    // and fetch the play URL from the server only after the visitor
    // presses Play (click-to-play, brief §B).
    videoPreview: toVideoPreviewDTO(p),
    videoPreviewUrl: null,
    // T-V: delivery mode is public (the thank-you page uses it for the
    // Watch now affordance). The full video URL is NOT here.
    deliveryMode: p.deliveryMode,
    internationalLink: p.internationalLink,
    indiaLink: p.indiaLink,
    platformLinks: p.platformLinks,
    instantDownload: p.instantDownload,
    featured: p.featured,
    sortOrder: p.sortOrder,
    status: p.status,
    tags: p.tags,
    fileFormats: p.fileFormats,
    pageCount: p.pageCount,
    spatialCoords: p.spatialCoords,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }
}

export function buildOrderBy(sort: ProductListQuery['sort']): Prisma.ProductOrderByWithRelationInput[] {
  // Postgres needs a unique tiebreaker for deterministic pagination.
  const base: Prisma.ProductOrderByWithRelationInput[] =
    sort === 'newest'
      ? [{ createdAt: 'desc' }]
      : sort === 'price-asc'
        ? [{ priceInr: 'asc' }]
        : sort === 'price-desc'
          ? [{ priceInr: 'desc' }]
          : [{ featured: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }]
  return [...base, { id: 'asc' }]
}

export async function listCatalog(query: ProductListQuery, req: NextRequest) {
  const where: Prisma.ProductWhereInput = {}

  // Non-published listings are admin-only (PRD §13.2 public data contract).
  // T5: the DTO also depends on admin-ness — public responses never carry
  // paid file references (toPublicProductDTO), admin responses do.
  const cookieAdmin = hasAdminSessionCookie(req)
  const admin = cookieAdmin ? await isAdmin() : false
  if (query.status === 'all') {
    if (!admin) where.status = 'published'
  } else if (query.status === 'draft' || query.status === 'archived') {
    if (!admin) throw new ApiError(401, 'Unauthorized — admin session required')
    where.status = query.status
  } else {
    where.status = 'published'
  }

  if (query.zone) where.zone = query.zone
  if (query.category) where.category = query.category
  if (query.featured === 'true') where.featured = true
  if (query.q) {
    where.OR = [
      { title: { contains: query.q, mode: 'insensitive' } },
      { description: { contains: query.q, mode: 'insensitive' } },
      { tags: { contains: query.q, mode: 'insensitive' } },
      { category: { contains: query.q, mode: 'insensitive' } },
    ]
  }

  const products = await productRepo.list({ where, orderBy: buildOrderBy(query.sort), take: query.limit })
  return products.map((p) => (admin ? toProductDTO(p) : toPublicProductDTO(p)))
}

export async function createProduct(input: ProductInput) {
  const slug = input.slug?.trim() ? input.slug : slugify(input.title)
  if (await productRepo.slugExists(slug)) throw conflict(`Slug "${slug}" already in use`)

  const product = await productRepo.create({
    title: input.title,
    slug,
    zone: input.zone,
    category: input.category,
    authorBrand: input.authorBrand,
    ageOrLevel: input.ageOrLevel ?? null,
    priceUsd: input.priceUsd,
    priceInr: input.priceInr,
    badge: input.badge,
    description: input.description,
    whatsInside: asJsonString(input.whatsInside, []),
    howToUse: input.howToUse,
    license: input.license,
    mediaType: input.mediaType,
    images: asJsonString(input.images, []),
    videoPreviewUrl: assertSafeVideoUrl(input.videoPreviewUrl, 'Video preview') ?? null,
    internationalLink: input.internationalLink ?? null,
    indiaLink: input.indiaLink ?? null,
    platformLinks: asJsonString(input.platformLinks, []),
    instantDownload: input.instantDownload,
    deliverableUrl: assertSafeDeliverableUrl(input.deliverableUrl),
    deliverableName: input.deliverableName ?? null,
    // ── T-V additive video-delivery fields ──
    deliveryMode: input.deliveryMode,
    fullVideoUrl: assertSafeVideoUrl(input.fullVideoUrl, 'Full video link') ?? null,
    watchTtlHours: input.watchTtlHours ?? null,
    watchMaxConcurrent: input.watchMaxConcurrent ?? 2,
    featured: input.featured,
    sortOrder: input.sortOrder,
    status: input.status,
    tags: asJsonString(input.tags, []),
    fileFormats: asJsonString(input.fileFormats, []),
    pageCount: input.pageCount ?? null,
    spatialCoords: asJsonString(input.spatialCoords, { x: 0, y: 0, z: 0 }),
  })
  return toProductDTO(product)
}

/** Stored as JSON-in-String (consumer contract) — accept array/object or pre-encoded string. */
function asJsonString(value: unknown, fallback: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? fallback)
}

export function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

const PRODUCT_STATUSES = new Set(['draft', 'published', 'archived'])

/** Build a Prisma update payload from a loosely-typed admin PATCH body.
 *  Semantics replicate the legacy route field-for-field (invalid values coerce,
 *  absent fields stay untouched). Returns the data plus the audit action. */
export function applyProductPatch(body: Record<string, unknown>): {
  data: Record<string, unknown>
  action: string
} {
  const data: Record<string, unknown> = {}
  if (body.title !== undefined) data.title = str(body.title)
  if (body.slug !== undefined) data.slug = str(body.slug)
  if (body.zone !== undefined) data.zone = body.zone === 'creator' ? 'creator' : 'kids'
  if (body.category !== undefined) data.category = str(body.category)
  if (body.authorBrand !== undefined) data.authorBrand = str(body.authorBrand)
  if (body.ageOrLevel !== undefined) data.ageOrLevel = body.ageOrLevel ? str(body.ageOrLevel) : null
  if (body.priceUsd !== undefined) data.priceUsd = Number(body.priceUsd) || 0
  if (body.priceInr !== undefined) data.priceInr = Number(body.priceInr) || 0
  if (body.badge !== undefined) data.badge = str(body.badge, 'New')
  if (body.description !== undefined) data.description = str(body.description)
  if (body.whatsInside !== undefined) data.whatsInside = asJsonString(body.whatsInside, [])
  if (body.howToUse !== undefined) data.howToUse = str(body.howToUse)
  if (body.license !== undefined) data.license = str(body.license, 'personal')
  if (body.mediaType !== undefined) data.mediaType = body.mediaType === 'video' ? 'video' : 'images'
  if (body.images !== undefined) data.images = asJsonString(body.images, [])
  if (body.videoPreviewUrl !== undefined) data.videoPreviewUrl = assertSafeVideoUrl(body.videoPreviewUrl ? str(body.videoPreviewUrl) : null, 'Video preview')
  // ── T-V additive video-delivery fields (loose-typed PATCH, same semantics) ──
  if (body.deliveryMode !== undefined) {
    const mode = str(body.deliveryMode, 'file')
    data.deliveryMode = mode === 'watch' || mode === 'external' ? mode : 'file'
  }
  if (body.fullVideoUrl !== undefined) data.fullVideoUrl = assertSafeVideoUrl(body.fullVideoUrl ? str(body.fullVideoUrl) : null, 'Full video link')
  if (body.watchTtlHours !== undefined) data.watchTtlHours = body.watchTtlHours ? Math.min(Math.max(Number(body.watchTtlHours) || 1, 1), 720) : null
  if (body.watchMaxConcurrent !== undefined) data.watchMaxConcurrent = Math.min(Math.max(Number(body.watchMaxConcurrent) || 2, 1), 10)
  if (body.internationalLink !== undefined) data.internationalLink = body.internationalLink ? str(body.internationalLink) : null
  if (body.indiaLink !== undefined) data.indiaLink = body.indiaLink ? str(body.indiaLink) : null
  if (body.platformLinks !== undefined) data.platformLinks = asJsonString(body.platformLinks, [])
  if (body.instantDownload !== undefined) data.instantDownload = Boolean(body.instantDownload)
  if (body.deliverableUrl !== undefined) data.deliverableUrl = assertSafeDeliverableUrl(body.deliverableUrl ? str(body.deliverableUrl) : null)
  if (body.deliverableName !== undefined) data.deliverableName = body.deliverableName ? str(body.deliverableName) : null
  if (body.featured !== undefined) data.featured = Boolean(body.featured)
  if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder) || 0
  if (body.status !== undefined) {
    const status = str(body.status)
    data.status = PRODUCT_STATUSES.has(status) ? status : 'published'
  }
  if (body.tags !== undefined) data.tags = asJsonString(body.tags, [])
  if (body.fileFormats !== undefined) data.fileFormats = asJsonString(body.fileFormats, [])
  if (body.pageCount !== undefined) data.pageCount = body.pageCount ? Number(body.pageCount) : null
  if (body.spatialCoords !== undefined) data.spatialCoords = asJsonString(body.spatialCoords, { x: 0, y: 0, z: 0 })

  const status = data.status as string | undefined
  const action =
    status === 'archived'
      ? 'product.archive'
      : status === 'published'
        ? 'product.update'
        : 'product.update'
  return { data, action }
}

export async function productExists(id: string) {
  return productRepo.byId(id)
}
