'use client'

import type { JSX } from 'react'

// GridFloor — the neon perspective grid floor (B5): a rotateX
// plane inside a preserve-3d chain (root perspective → wrap →
// plane → texture). The MASTER TIMELINE animates the texture's
// translateZ (the rush toward the viewer) — never background
// position. No overflow/filter on any ancestor of the chain.

import { CREATOR_COLORS } from '../../config/constants'

export default function GridFloor(): JSX.Element {
  return (
    <div
      data-c-grid
      aria-hidden="true"
      className="absolute"
      style={{ left: '-40%', right: '-40%', top: '50%', height: '95%', transformStyle: 'preserve-3d', opacity: 0, willChange: 'opacity' }}
    >
      <div className="absolute inset-0" style={{ transform: 'rotateX(72deg)', transformOrigin: '50% 0%', transformStyle: 'preserve-3d' }}>
        <div
          data-c-grid-inner
          className="absolute inset-0"
          style={{
            backgroundImage: `repeating-linear-gradient(90deg, ${CREATOR_COLORS.cyan}2E 0 2px, transparent 2px 7%), repeating-linear-gradient(0deg, ${CREATOR_COLORS.violet}26 0 2px, transparent 2px 9%)`,
            willChange: 'transform',
          }}
        />
      </div>
    </div>
  )
}
