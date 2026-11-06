'use client'

// ═══════════════════════════════════════════════════════════
// Wipe (B3) — presentational colour wipe that hides the zone
// swap. The stage owns the element; the choreography's GSAP
// timeline animates ONLY its opacity (initial 0 + will-change
// because it is mounted exclusively during the run). The inner
// radial is the payoff peak flash, capped at profile.flashPeak
// (photosensitivity-safe, single soft pulse) and exposed as a
// CSS var for styling. aria-hidden — decorative only.
// ═══════════════════════════════════════════════════════════

import { forwardRef, type CSSProperties } from 'react'
import { WIPE_FLASH_GRADIENT, WIPE_STYLE, type Zone } from '../config/constants'

export interface WipeProps {
  zone: Zone
  /** profile.flashPeak — the documented opacity cap of the inner flash. */
  flashPeak: number
}

const Wipe = forwardRef<HTMLDivElement, WipeProps>(function Wipe({ zone, flashPeak }, ref) {
  const flashStyle = {
    background: WIPE_FLASH_GRADIENT,
    opacity: 0,
    willChange: 'opacity',
    '--wipe-flash-peak': String(flashPeak),
  } as CSSProperties
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-40"
      style={{ background: WIPE_STYLE[zone].background, opacity: 0, willChange: 'opacity' }}
    >
      <div data-wipe-flash className="absolute inset-0" style={flashStyle} />
    </div>
  )
})

export default Wipe
