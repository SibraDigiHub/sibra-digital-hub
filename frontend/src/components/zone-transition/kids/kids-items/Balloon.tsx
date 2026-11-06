'use client'

import type { JSX } from 'react'

// Balloon — glossy rising balloon (B4): pre-built gradients give
// the specular highlight (no blur filters), the string is one
// static div. The parent timeline drives rise/sway transforms.

export default function Balloon({ tint, size = '11vmin' }: { tint: string; size?: string }): JSX.Element {
  return (
    <div aria-hidden="true" style={{ position: 'relative', width: size, height: `calc(${size} * 1.24)` }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50% 50% 48% 52% / 56% 56% 44% 44%',
          background: `radial-gradient(circle at 34% 28%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0) 34%), ${tint}`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '99%',
          width: 2,
          height: '6vmin',
          marginLeft: -1,
          borderRadius: 2,
          background: 'rgba(91,74,33,0.55)',
        }}
      />
    </div>
  )
}
