'use client'

import type { JSX } from 'react'

// StarMeter — the 3-star level-up meter (B4). Stars pop in one
// by one and each fires a ring burst; the master timeline drives
// them through the data-km-star / data-km-ring handles. Static
// markup: zero per-frame work lives here.

const STAR_PATH = 'M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z'

export default function StarMeter(): JSX.Element {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: '50%',
        top: '9%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: '3vmin',
      }}
    >
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ position: 'relative', width: '7vmin', height: '7vmin' }}>
          <div
            data-km-ring={i}
            style={{
              position: 'absolute',
              inset: '-30%',
              borderRadius: '50%',
              border: '0.5vmin solid #FFD700',
              opacity: 0,
              willChange: 'transform, opacity',
            }}
          />
          <svg
            data-km-star={i}
            viewBox="0 0 24 24"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, willChange: 'transform, opacity' }}
          >
            <path d={STAR_PATH} fill="#FFD700" stroke="#E8A200" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        </div>
      ))}
    </div>
  )
}
