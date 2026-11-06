import type { MetadataRoute } from 'next'

// T8 (§9.1): minimal web app manifest — served as /manifest.webmanifest and
// auto-linked from the root layout. Theme colours are the shell's
// gold-on-obsidian tokens (globals.css: --bg-dark / --gold-primary).
// Owner brand assets (Neon-Gold Cosmic Knowledge Crest): the SVG favicon
// (/icon.svg) now carries the real crest, and the owner-supplied tile
// ships as 192/512 PNGs (public/icons) with a maskable variant — safe
// zone respected, so Android circle-crop never clips the mark.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sibra Digital Hub — Digital Kidosphere & Creator Hub',
    short_name: 'Sibra Digital Hub',
    description: 'Joyful kids printables & premium creator assets. Instant downloads. Pay by card, UPI, net banking & more via Razorpay.',
    id: '/',
    start_url: '/',
    display: 'standalone',
    background_color: '#050706',
    theme_color: '#050706',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
