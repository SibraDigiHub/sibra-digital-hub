'use client'

import type { JSX } from 'react'

// ProductCard3D (creator) — the THREE real creator product
// covers as neon-framed holo cards (B5). Art comes from
// GATEWAY_CONTENT — the single source shared with the gateway,
// already cached; never a second copy, never a new download.

import { GATEWAY_CONTENT } from '@/lib/gateway-content'
import { CREATOR_COLORS } from '../../config/constants'

const FRAMES = [CREATOR_COLORS.cyan, CREATOR_COLORS.gold, CREATOR_COLORS.magenta] as const

export default function ProductCard3D({ index }: { index: number }): JSX.Element {
  const thumb = GATEWAY_CONTENT.creator.thumbs[index % GATEWAY_CONTENT.creator.thumbs.length]
  const frame = FRAMES[index % FRAMES.length]
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'relative',
        width: '14vmin',
        height: '14vmin',
        padding: '0.7vmin',
        borderRadius: '1.2vmin',
        background: 'rgba(8,12,10,0.9)',
        border: `2px solid ${frame}`,
        transformStyle: 'preserve-3d',
      }}
    >
      <img
        src={thumb.src}
        alt=""
        width={140}
        height={140}
        loading="eager"
        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '0.8vmin' }}
      />
      {/* static holo scanlines — prebuilt gradient, never animated */}
      <div
        style={{
          position: 'absolute',
          inset: '0.7vmin',
          borderRadius: '0.8vmin',
          background: `repeating-linear-gradient(180deg, ${frame}14 0 1px, transparent 1px 4px)`,
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
