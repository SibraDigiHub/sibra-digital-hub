// ═══════════════════════════════════════════════════════════
// SIBRA DIGITAL HUB — Marketplace Types
// ═══════════════════════════════════════════════════════════

export type Zone = 'kids' | 'creator'
export type MediaType = 'images' | 'video'
export type ProductStatus = 'draft' | 'published' | 'archived'
export type License = 'personal' | 'commercial' | 'extended'
export type ViewName = 'gateway' | 'shop' | 'product' | 'thankyou' | 'admin' | 'legal' | 'download'

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
  videoPreviewUrl: string | null
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
export interface ProductRow extends Omit<Product, 'whatsInside' | 'images' | 'platformLinks' | 'tags' | 'fileFormats' | 'spatialCoords'> {
  whatsInside: string
  images: string
  platformLinks: string
  tags: string
  fileFormats: string
  spatialCoords: string
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
  product?: { title: string; slug: string; zone: Zone; instantDownload: boolean; deliverableName: string | null }
  razorpayPaymentId: string | null
  razorpayPaymentLinkId: string | null
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
export const KIDS_CATEGORIES: { slug: string; label: string; emoji: string; blurb: string }[] = [
  { slug: 'coloring-books', label: 'Coloring Books', emoji: '🎨', blurb: '300 DPI printable fun' },
  { slug: 'activity-puzzles', label: 'Activity & Puzzles', emoji: '🧩', blurb: 'Mazes & brain grids' },
  { slug: 'story-ebooks', label: 'Story E-Books', emoji: '📚', blurb: 'Learn English with Sibra & Joy' },
  { slug: 'abcd-number-tracing', label: 'ABCD & Number Tracing', emoji: '🔤', blurb: 'First writing steps' },
  { slug: 'diy-flashcards-crafts', label: 'Flashcards & Crafts', emoji: '🃏', blurb: 'Cut, play & learn' },
  { slug: 'parents-guides', label: "Parents' Guides", emoji: '👩‍👧', blurb: 'Calm & happy routines' },
]

export const CREATOR_CATEGORIES: { slug: string; label: string; emoji: string; blurb: string }[] = [
  { slug: 'canva-templates', label: 'Canva Templates', emoji: '🖌️', blurb: 'Editable pro designs' },
  { slug: 'ai-prompts', label: 'AI Prompts', emoji: '🤖', blurb: 'Flux, Midjourney, video' },
  { slug: 'motion-assets', label: 'Motion Assets', emoji: '🎬', blurb: 'Clips, transitions, overlays' },
  { slug: 'scripts-automations', label: 'Scripts & Automations', emoji: '⚡', blurb: 'Save hours every week' },
  { slug: 'website-ui-kits', label: 'Website UI Kits', emoji: '🧑‍💻', blurb: 'Responsive, conversion-ready' },
  { slug: 'ats-resumes', label: 'ATS Resumes', emoji: '📄', blurb: 'Beat the ATS bots' },
]

export function categoriesForZone(zone: Zone) {
  return zone === 'kids' ? KIDS_CATEGORIES : CREATOR_CATEGORIES
}

export function categoryLabel(zone: Zone, slug: string): string {
  const cat = categoriesForZone(zone).find((c) => c.slug === slug)
  return cat ? cat.label : slug
}

export function formatMoney(usd: number, inr: number) {
  return { usd: `$${usd.toFixed(2)}`, inr: `₹${Math.round(inr)}` }
}
