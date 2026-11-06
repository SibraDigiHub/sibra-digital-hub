'use client'

// ═══════════════════════════════════════════════════════════
// Brand glyph for a social platform (T-V Feature A). A plain
// switch (no dynamic component lookup) so the React compiler
// stays happy; keeps the platform → icon mapping in one place.
// Named platforms map to their glyph; anything else (an
// admin-defined "Other" platform) gets the generic globe.
// ═══════════════════════════════════════════════════════════

import { Facebook, Globe, Instagram, MessageCircle, Pin, Send, Twitter, Youtube } from 'lucide-react'

interface GlyphProps {
  platform: string
  className?: string
}

export default function PlatformGlyph({ platform, className }: GlyphProps) {
  switch (platform) {
    case 'youtube':
      return <Youtube className={className} aria-hidden="true" />
    case 'instagram':
      return <Instagram className={className} aria-hidden="true" />
    case 'pinterest':
      return <Pin className={className} aria-hidden="true" />
    case 'facebook':
      return <Facebook className={className} aria-hidden="true" />
    case 'x':
      return <Twitter className={className} aria-hidden="true" />
    case 'whatsapp':
      return <MessageCircle className={className} aria-hidden="true" />
    case 'telegram':
      return <Send className={className} aria-hidden="true" />
    default:
      return <Globe className={className} aria-hidden="true" />
  }
}
