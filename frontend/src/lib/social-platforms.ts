// ═══════════════════════════════════════════════════════════
// Social platform metadata for the channels feature (T-V A).
// Single source for labels and URL hints used by the admin
// form and storefront copy. Brand glyphs live in the
// PlatformGlyph component; the server whitelist (backend
// lib/video-source.ts) stays the security boundary — this
// module is display-only. A platform picked as "Other" is
// stored under its own name and falls back to the generic
// metadata below.
// ═══════════════════════════════════════════════════════════

import type { SocialPlatform } from '@/types/marketplace'

interface PlatformMeta {
  label: string
  /** Example link shown as the admin form placeholder. */
  placeholder: string
  /** Accepted-hosts hint shown under the admin form input. */
  hint: string
}

export const SOCIAL_PLATFORMS: Readonly<Record<SocialPlatform, PlatformMeta>> = {
  youtube: {
    label: 'YouTube',
    placeholder: 'https://www.youtube.com/@YourChannel',
    hint: 'youtube.com, m.youtube.com, www.youtube.com or youtu.be only.',
  },
  instagram: {
    label: 'Instagram',
    placeholder: 'https://www.instagram.com/youraccount',
    hint: 'instagram.com (and its subdomains) only.',
  },
  pinterest: {
    label: 'Pinterest',
    placeholder: 'https://in.pinterest.com/yourboards',
    hint: 'pinterest.com, its country subdomains, or pin.it only.',
  },
  facebook: {
    label: 'Facebook',
    placeholder: 'https://www.facebook.com/yourpage',
    hint: 'facebook.com, m/web.facebook.com, fb.com or fb.me only.',
  },
  x: {
    label: 'X (Twitter)',
    placeholder: 'https://x.com/YourHandle',
    hint: 'x.com, www.x.com, twitter.com (and subdomains) only.',
  },
  whatsapp: {
    label: 'WhatsApp',
    placeholder: 'https://wa.me/919999999999',
    hint: 'wa.me or whatsapp.com (and subdomains) only.',
  },
  telegram: {
    label: 'Telegram',
    placeholder: 'https://t.me/YourChannel',
    hint: 't.me or telegram.me only.',
  },
}

/** Platform ids in display order (admin form dropdown). */
export const SOCIAL_PLATFORM_IDS: readonly SocialPlatform[] = ['youtube', 'instagram', 'pinterest', 'facebook', 'x', 'whatsapp', 'telegram']

/** Dropdown value for "any other platform" — the admin names it, and
 *  that name is what gets stored as the channel's platform. */
export const OTHER_PLATFORM_ID = 'other'

const GENERIC_META: PlatformMeta = {
  label: 'Other',
  placeholder: 'https://example.com/yourpage',
  hint: 'Any https link to the platform’s official page.',
}

export function platformMeta(id: string): PlatformMeta {
  if (id === OTHER_PLATFORM_ID) return GENERIC_META
  return SOCIAL_PLATFORMS[id as SocialPlatform] ?? { ...GENERIC_META, label: id }
}

export function platformLabel(id: string): string {
  return platformMeta(id).label
}
