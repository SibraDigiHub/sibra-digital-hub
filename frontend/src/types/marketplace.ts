// ═══════════════════════════════════════════════════════════
// SIBRA DIGITAL HUB — Marketplace Types
// ═══════════════════════════════════════════════════════════

export type Zone = 'kids' | 'creator'
export type MediaType = 'images' | 'video'
export type ProductStatus = 'draft' | 'published' | 'archived'
export type License = 'personal' | 'commercial' | 'extended'
export type ViewName =
  | 'gateway'
  | 'shop'
  | 'product'
  | 'thankyou'
  | 'admin'
  | 'admin-reset'
  | 'legal'
  | 'download'
  | 'watch' // T-V Feature C — protected watch page (/#/watch/<token>)
  | 'rate' // Layer 2 — verified-purchase review page (/#/rate/<order token>)

/** T-V Feature B — safe public video descriptor (raw admin URLs never reach the page).
 *  'file' = direct https .mp4/.webm link (public by nature, like an ImageKit public file). */
export type VideoSource = { provider: 'youtube'; videoId: string } | { provider: 'imagekit'; ref: string } | { provider: 'file'; ref: string }

export type DeliveryMode = 'file' | 'external' | 'watch'

/** Named social networks a channel can point at (each has a dedicated
 *  admin form entry and a server-side URL host whitelist). An "Other"
 *  platform beyond this list is stored as the admin-typed name — see
 *  Channel.platform. */
export type SocialPlatform = 'youtube' | 'instagram' | 'pinterest' | 'facebook' | 'x' | 'whatsapp' | 'telegram'

/** T-V Feature A — admin-managed social media channel (one zone only). */
export interface Channel {
  id: string
  zone: Zone
  /** A known SocialPlatform id, or the admin-defined name of an
   *  "Other" platform (e.g. "Snapchat"). */
  platform: string
  name: string
  url: string
  handle: string | null
  logo: string | null
  description: string | null
  audienceTag: string | null
  buttonText: string
  sortOrder: number
}

/** External marketplace buttons the admin can attach per product */
export type PlatformId =
  | 'amazon-kdp'
  | 'notion-press'
  | 'gumroad'
  | 'etsy'
  | 'payhip'
  | 'pothi'
  | 'flipkart'
  | 'google-play-books'
  | 'custom'

export interface PlatformLink {
  platform: PlatformId
  url: string
}

export interface SpatialCoords {
  x: number
  y: number
  z: number
}

export interface Product {
  id: string
  title: string
  slug: string
  zone: Zone
  category: string
  authorBrand: string
  ageOrLevel: string | null
  priceUsd: number
  priceInr: number
  badge: string
  description: string
  whatsInside: string[] // parsed from JSON
  howToUse: string
  license: License
  mediaType: MediaType
  images: string[] // parsed from JSON
  /** T-V: safe video descriptor (youtube id / imagekit ref) — raw link never leaves the server. */
  videoPreview: VideoSource | null
  /** T-V: delivery mode for instant-download products ('file' default). */
  deliveryMode: DeliveryMode
  internationalLink: string | null
  indiaLink: string | null
  platformLinks: PlatformLink[] // parsed from JSON
  instantDownload: boolean
  deliverableUrl: string | null
  deliverableName: string | null
  featured: boolean
  sortOrder: number
  status: ProductStatus
  tags: string[]
  fileFormats: string[]
  pageCount: number | null
  spatialCoords: SpatialCoords
  createdAt: string
  updatedAt: string
}

/** Raw row as returned by the API (JSON fields still strings) */
export interface ProductRow
  extends Omit<Product, 'whatsInside' | 'images' | 'platformLinks' | 'tags' | 'fileFormats' | 'spatialCoords' | 'videoPreview' | 'deliveryMode'> {
  whatsInside: string
  images: string
  platformLinks: string
  tags: string
  fileFormats: string
  spatialCoords: string
  /** T-V: public rows carry the safe descriptor; admin rows instead carry the raw URL below. */
  videoPreview?: VideoSource | null
  deliveryMode?: DeliveryMode
  /** T-V: raw preview link — ADMIN API responses only (never public). */
  videoPreviewUrl?: string | null
}

export interface AdminProductInput {
  title: string
  slug: string
  zone: Zone
  category: string
  authorBrand: string
  ageOrLevel?: string | null
  priceUsd: number
  priceInr: number
  badge: string
  description: string
  whatsInside: string[]
  howToUse: string
  license: License
  mediaType: MediaType
  images: string[]
  videoPreviewUrl?: string | null
  internationalLink?: string | null
  indiaLink?: string | null
  platformLinks: PlatformLink[]
  instantDownload: boolean
  deliverableUrl?: string | null
  deliverableName?: string | null
  /** T-V: video-delivery additions (existing products keep 'file'). */
  deliveryMode?: DeliveryMode
  fullVideoUrl?: string | null
  watchTtlHours?: number | null
  watchMaxConcurrent?: number
  featured: boolean
  sortOrder: number
  status: ProductStatus
  tags: string[]
  fileFormats: string[]
  pageCount?: number | null
  spatialCoords?: SpatialCoords
}

export interface Order {
  id: string
  productId: string
  product?: {
    title: string
    slug: string
    zone: Zone
    instantDownload: boolean
    deliverableName: string | null
    /** T-V: delivery mode (thank-you page Watch now affordance). */
    deliveryMode?: DeliveryMode
  }
  razorpayPaymentId: string | null
  razorpayPaymentLinkId: string | null
  // Single-gateway migration (additive — server sends these on every order now).
  razorpayOrderId?: string | null
  paymentMethod?: string | null
  paymentInternational?: boolean | null
  // gateway: 'paypal' is LEGACY ONLY (historical rows stay readable).
  gateway?: 'razorpay' | 'paypal'
  billingCountry?: string | null
  ipCountry?: string | null
  currency?: string
  amountMinor?: number | null
  paypalOrderId?: string | null
  paypalCaptureId?: string | null
  riskFlags?: string[]
  customerName: string
  customerEmail: string
  amountInr: number
  status: 'pending' | 'paid' | 'failed' | 'revoked' | 'refunded'
  tokenExpiresAt: string | null
  downloadCount: number
  emailSent: boolean
  createdAt: string
  updatedAt: string
}

// ── Layer 2 — verified-purchase product reviews ──

export type ProductReviewStatus = 'pending' | 'approved' | 'rejected'

/** Public review row — orderId/emails never leave the server. */
export interface PublicProductReview {
  id: string
  name: string
  rating: number
  text: string
  createdAt: string
}

export interface RatingSummary {
  avg: number | null
  count: number
}

/** Rate-page bootstrap (buyer's own token-resolved context). */
export interface ReviewOrderContext {
  product: { title: string; slug: string; zone: Zone }
  customerName: string
  amountInr: number
  review: { rating: number; text: string; status: ProductReviewStatus } | null
}

/** Admin moderation row. */
export interface AdminProductReview extends PublicProductReview {
  orderId: string
  status: ProductReviewStatus
  product: { title: string; slug: string } | null
  updatedAt: string
}

export interface Review {
  id: string
  name: string
  role: string
  avatarEmoji: string
  content: string
  rating: number
  zone: Zone
  verified: boolean
  sortOrder: number
  createdAt: string
}

export interface FaqItem {
  id: string
  question: string
  answer: string
  sortOrder: number
  createdAt: string
}

export interface SiteSettings {
  tickerKidsText: string
  tickerCreatorText: string
  tickerAssetsText: string
  announcementBanner: string
  upiId: string
  upiPayeeName: string
  instantDownloadEnabled: boolean
  soundEnabled: boolean
  promoCode: string
  contactEmail: string
  siteTagline: string
}

// ── Zone categories (PRD §8) ───────────────────────────────
// Built-in defaults. T10: the admin can manage categories from the
// Admin Panel — lib/categories.ts fetches /api/categories on boot and
// installs the live list via setDynamicCategories() below. Until that
// fetch succeeds (or if it fails), these defaults render — so the
// storefront looks identical whether the API is up or not.
export interface CategoryMeta {
  slug: string
  label: string
  emoji: string
  blurb: string
}

export const KIDS_CATEGORIES: CategoryMeta[] = [
  { slug: 'coloring-books', label: 'Coloring Books', emoji: '🎨', blurb: '300 DPI printable fun' },
  { slug: 'activity-puzzles', label: 'Activity & Puzzles', emoji: '🧩', blurb: 'Mazes & brain grids' },
  { slug: 'story-ebooks', label: 'Story E-Books', emoji: '📚', blurb: 'Learn English with Sibra & Joy' },
  { slug: 'abcd-number-tracing', label: 'ABCD & Number Tracing', emoji: '🔤', blurb: 'First writing steps' },
  { slug: 'diy-flashcards-crafts', label: 'Flashcards & Crafts', emoji: '🃏', blurb: 'Cut, play & learn' },
  { slug: 'parents-guides', label: "Parents' Guides", emoji: '👩‍👧', blurb: 'Calm & happy routines' },
]

export const CREATOR_CATEGORIES: CategoryMeta[] = [
  { slug: 'canva-templates', label: 'Canva Templates', emoji: '🖌️', blurb: 'Editable pro designs' },
  { slug: 'ai-prompts', label: 'AI Prompts', emoji: '🤖', blurb: 'Flux, Midjourney, video' },
  { slug: 'motion-assets', label: 'Motion Assets', emoji: '🎬', blurb: 'Clips, transitions, overlays' },
  { slug: 'scripts-automations', label: 'Scripts & Automations', emoji: '⚡', blurb: 'Save hours every week' },
  { slug: 'website-ui-kits', label: 'Website UI Kits', emoji: '🧑‍💻', blurb: 'Responsive, conversion-ready' },
  { slug: 'ats-resumes', label: 'ATS Resumes', emoji: '📄', blurb: 'Beat the ATS bots' },
]

// ── T10: dynamic category registry ─────────────────────────
// Module-level snapshot updated by lib/categories.ts after the
// /api/categories fetch resolves. Per-zone lists fall back to the
// built-in defaults when missing/empty — an empty registry (e.g.
// fresh backend, failed fetch) can never blank out the storefront.
const dynamicCats: { kids: CategoryMeta[] | null; creator: CategoryMeta[] | null } = {
  kids: null,
  creator: null,
}

/** Install the admin-managed category list for one zone (T10). */
export function setDynamicCategories(zone: Zone, cats: CategoryMeta[]): void {
  dynamicCats[zone] = cats
}

/** Live category list for a zone: admin-managed when available, else built-in. */
export function categoriesForZone(zone: Zone): CategoryMeta[] {
  const dynamic = dynamicCats[zone]
  if (dynamic && dynamic.length > 0) return dynamic
  return zone === 'kids' ? KIDS_CATEGORIES : CREATOR_CATEGORIES
}

export function categoryLabel(zone: Zone, slug: string): string {
  const cat = categoriesForZone(zone).find((c) => c.slug === slug)
  return cat ? cat.label : slug
}

export function formatMoney(usd: number, inr: number) {
  return { usd: `$${usd.toFixed(2)}`, inr: `₹${Math.round(inr)}` }
}
