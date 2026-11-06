// ═══════════════════════════════════════════════════════════
// Gateway zone card content — the single source of truth for the
// zone titles, CTAs and product art shared by the gateway cards
// and the zone-transition choreographies (which reuse the already
// cached product covers instead of hard-coding a second copy).
// ═══════════════════════════════════════════════════════════

import type { Zone } from '@/types/marketplace'

export interface GatewayZoneContent {
  title: string
  subtitle: string
  emoji: string
  cta: string
  aria: string
  thumbs: { src: string; alt: string }[]
}

export const GATEWAY_CONTENT: Record<Zone, GatewayZoneContent> = {
  kids: {
    title: 'KIDS & LEARNING SPHERE',
    subtitle: 'Curated by Professor Sibra Naaz',
    emoji: '🎨 🧩 📚',
    cta: 'Enter the Kidosphere',
    aria: 'Enter the Kids and Learning Sphere — the Kidosphere',
    thumbs: [
      { src: '/images/products/kids-coloring.png', alt: 'Printable kids coloring book cover' },
      { src: '/images/products/kids-puzzle.png', alt: 'Kids activity and puzzle book cover' },
      { src: '/images/products/kids-story.png', alt: 'Kids story e-book cover' },
    ],
  },
  creator: {
    title: 'CREATOR & DEVELOPER HUB',
    subtitle: 'Premium Tech Assets & Workflows',
    emoji: '🖌️ 🤖 ⚡',
    cta: 'Enter the Hub',
    aria: 'Enter the Creator and Developer Hub',
    thumbs: [
      { src: '/images/products/creator-canva.png', alt: 'Premium Canva template pack' },
      { src: '/images/products/creator-prompts.png', alt: 'High-converting AI prompt pack' },
      { src: '/images/products/creator-scripts.png', alt: 'Scripts and automations bundle' },
    ],
  },
}
