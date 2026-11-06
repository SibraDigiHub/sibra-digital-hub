// ═══════════════════════════════════════════════════════════
// External marketplace platform button configs (PRD §10.1).
// Admin picks per-product which of these appear.
// ═══════════════════════════════════════════════════════════

import type { PlatformId } from '@/types/marketplace'

export interface PlatformMeta {
  id: PlatformId
  label: string // button label
  short: string // admin picker label
  emoji: string
  color: string // tailwind classes
  subtext: string
}

export const PLATFORMS: PlatformMeta[] = [
  {
    id: 'gumroad',
    label: 'Buy on Gumroad',
    short: 'Gumroad',
    emoji: '🌍',
    color: 'border-pink-500/50 hover:bg-pink-500/15 text-pink-200',
    subtext: 'Card / Razorpay · Instant USD checkout',
  },
  {
    id: 'amazon-kdp',
    label: 'Buy on Amazon KDP',
    short: 'Amazon KDP',
    emoji: '📦',
    color: 'border-amber-500/50 hover:bg-amber-500/15 text-amber-200',
    subtext: 'Kindle & print editions',
  },
  {
    id: 'notion-press',
    label: 'Buy on Notion Press',
    short: 'Notion Press',
    emoji: '📕',
    color: 'border-orange-500/50 hover:bg-orange-500/15 text-orange-200',
    subtext: 'Paperback & eBook · India',
  },
  {
    id: 'etsy',
    label: 'Buy on Etsy',
    short: 'Etsy',
    emoji: '🛍️',
    color: 'border-rose-400/50 hover:bg-rose-400/15 text-rose-200',
    subtext: 'Global creative marketplace',
  },
  {
    id: 'payhip',
    label: 'Buy on Payhip',
    short: 'Payhip',
    emoji: '💜',
    color: 'border-violet-400/50 hover:bg-violet-400/15 text-violet-200',
    subtext: 'Card · Instant digital delivery',
  },
  {
    id: 'pothi',
    label: 'Buy on Pothi',
    short: 'Pothi',
    emoji: '📖',
    color: 'border-lime-500/50 hover:bg-lime-500/15 text-lime-200',
    subtext: 'Indian print-on-demand',
  },
  {
    id: 'flipkart',
    label: 'Buy on Flipkart',
    short: 'Flipkart',
    emoji: '🛒',
    color: 'border-yellow-400/50 hover:bg-yellow-400/15 text-yellow-200',
    subtext: 'India e-commerce',
  },
  {
    id: 'google-play-books',
    label: 'Buy on Google Play Books',
    short: 'Google Play Books',
    emoji: '📚',
    color: 'border-emerald-400/50 hover:bg-emerald-400/15 text-emerald-200',
    subtext: 'eBooks on Android, iOS & web',
  },
  {
    id: 'custom',
    label: 'Open Product Link',
    short: 'Custom Link',
    emoji: '🔗',
    color: 'border-teal-400/50 hover:bg-teal-400/15 text-teal-200',
    subtext: 'Direct product page',
  },
]

export function platformMeta(id: string): PlatformMeta {
  return PLATFORMS.find((p) => p.id === id) ?? PLATFORMS[PLATFORMS.length - 1]
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}
