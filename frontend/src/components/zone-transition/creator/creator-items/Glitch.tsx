'use client'

import type { JSX } from 'react'

// Glitch — two LOW-CONTRAST slices for the ignite flicker (B5).
// The master timeline steps their transform/opacity in one brief
// ≤ 0.3 s burst (photosensitivity-safe: 2 soft blinks, no rapid
// alternation), then both slices rest invisible.

import { CREATOR_COLORS } from '../../config/constants'

export default function Glitch(): JSX.Element {
  return (
    <>
      <div
        data-c-glitch="1"
        aria-hidden="true"
        className="absolute"
        style={{
          left: '6%',
          right: '42%',
          top: '20%',
          height: '14%',
          background: `linear-gradient(90deg, ${CREATOR_COLORS.cyan}3D, transparent)`,
          opacity: 0,
          willChange: 'transform, opacity',
        }}
      />
      <div
        data-c-glitch="2"
        aria-hidden="true"
        className="absolute"
        style={{
          left: '44%',
          right: '6%',
          top: '62%',
          height: '14%',
          background: `linear-gradient(90deg, transparent, ${CREATOR_COLORS.magenta}33)`,
          opacity: 0,
          willChange: 'transform, opacity',
        }}
      />
    </>
  )
}
