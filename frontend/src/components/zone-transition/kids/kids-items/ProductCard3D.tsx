'use client'

import type { JSX } from 'react'

// ProductCard3D (kids) — the THREE real kids product covers as
// glossy tilting cards (B4). Art comes from GATEWAY_CONTENT —
// the single source shared with the gateway, already cached by
// the browser; never a second copy, never a new download.

import { GATEWAY_CONTENT } from '@/lib/gateway-content'

export default function ProductCard3D({ index }: { index: number }): JSX.Element {
  const thumb = GATEWAY_CONTENT.kids.thumbs[index % GATEWAY_CONTENT.kids.thumbs.length]
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'relative',
        width: '15vmin',
        height: '15vmin',
        padding: '0.8vmin',
        borderRadius: '1.6vmin',
        background: 'linear-gradient(160deg, #FFF2CC 0%, #FCE5CD 100%)',
        transformStyle: 'preserve-3d',
      }}
    >
      <img
        src={thumb.src}
        alt=""
        width={140}
        height={140}
        loading="eager"
        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '1.1vmin' }}
      />
      {/* static gloss strip — cheap shine without animating any filter */}
      <div
        style={{
          position: 'absolute',
          inset: '0.8vmin',
          borderRadius: '1.1vmin',
          background: 'linear-gradient(115deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 38%)',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
