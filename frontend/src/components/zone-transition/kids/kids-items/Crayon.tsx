'use client'

import type { JSX } from 'react'

// Crayon — a glossy wax crayon (B4): body + clipped tip + paper
// band, all static gradients. clip-path is only on this LEAF
// (no 3D children), so it cannot flatten any preserve-3d chain.

export default function Crayon({ tint }: { tint: string }): JSX.Element {
  return (
    <div aria-hidden="true" style={{ position: 'relative', width: '3.4vmin', height: '13vmin' }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '18%',
          bottom: 0,
          borderRadius: '0.9vmin',
          background: `linear-gradient(90deg, rgba(255,255,255,0.65) 0%, rgba(255,255,255,0) 32%), ${tint}`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '18%',
          right: '18%',
          top: 0,
          height: '20%',
          background: tint,
          clipPath: 'polygon(50% 0, 100% 100%, 0 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '32%',
          height: '9%',
          borderRadius: 1,
          background: 'rgba(255,255,255,0.75)',
        }}
      />
    </div>
  )
}
