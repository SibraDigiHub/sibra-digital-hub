'use client'

import type { JSX } from 'react'

// Rainbow — five SVG arcs drawn across the stage (B4). The draw
// is stroke-dashoffset animated BY THE MASTER TIMELINE (the
// sanctioned SVG exception to transform/opacity-only); with
// pathLength={1} every band normalises to the same 1 → 0 sweep.

const BANDS = ['#F2789F', '#FF8C42', '#FFD700', '#B8F2D0', '#BDE3FF'] as const

export default function Rainbow(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 100 52" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
      {BANDS.map((color, i) => {
        const r = 44 - i * 4.4
        return (
          <path
            key={color}
            data-k-rainbow={i}
            d={`M ${50 - r} 50 A ${r} ${r} 0 0 1 ${50 + r} 50`}
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeLinecap="round"
            pathLength={1}
            style={{ strokeDasharray: 1, strokeDashoffset: 1 }}
          />
        )
      })}
    </svg>
  )
}
