// ═══════════════════════════════════════════════════════════
// ALL zone-transition tunables live here (master prompt B2/B7):
// durations, beat sheets, palettes, budgets, audio levels.
// Beat times are authored in SECONDS at BASE_TOTAL_MS and scale
// proportionally (core/timeline.scaleBeats) — never hard-code a
// time inside a choreography; read it from the beat sheet.
// ═══════════════════════════════════════════════════════════

import type { RefObject } from 'react'
import type gsap from 'gsap'
import type { ScoreHandle } from '../audio/engine'
import type { ZonePhase } from '../core/machine'
import type { MotionProfileName } from './motion-profiles'
import type { Tier } from './tiers'

export type Zone = 'kids' | 'creator'

// ── Duration & timing (B3) ─────────────────────────────────
export const ZONE_MIN_MS = 5000
export const ZONE_MAX_MS = 8000
export const KIDS_TOTAL_MS = 6500
export const CREATOR_TOTAL_MS = 6500
/** enterZone fires at total − WIPE_LEAD_MS, hidden under the wipe. */
export const WIPE_LEAD_MS = 900
/** watchdog = total + this forces done so the visitor can never get stuck. */
export const WATCHDOG_EXTRA_MS = 4000
/** Skip fast-forwards the timeline in ≈ this many ms. */
export const SKIP_FAST_MS = 400
/** Master gain → 0 within this window on skip/finish (B7). */
export const AUDIO_FADE_MS = 300

// ── Beat sheets (seconds at BASE_TOTAL_MS) ─────────────────
// Kids: anticipation → POP → treasure rain → level-up → payoff → wipe.
export const KIDS_BEATS = { anticipateEnd: 0.45, popEnd: 1.1, treasureEnd: 3.2, levelEnd: 5.0, payoffEnd: 5.6, wipeStart: 5.6 }
// Creator: ignite → boot → build → compile → ship → wipe.
export const CREATOR_BEATS = { igniteEnd: 0.45, bootEnd: 1.2, buildEnd: 3.4, compileEnd: 5.0, shipEnd: 5.7, wipeStart: 5.7 }
export const BASE_TOTAL_MS = 6500

// ── Palettes (B4/B5) ───────────────────────────────────────
export const KIDS_COLORS = { amber: '#FFB347', orange: '#FF8C42', rose: '#F2789F', mint: '#B8F2D0', sky: '#BDE3FF', cream: '#FFF2CC', creamDeep: '#FCE5CD', yellow: '#FFD700' } as const
export const CREATOR_COLORS = { cyan: '#00F0FF', magenta: '#FF007F', gold: '#E5B842', violet: '#C084FC', green: '#00F5A0', obsidian: '#050706' } as const

/** The wipe's final colour matches the home-page background (B3 hand-off). */
export const WIPE_STYLE: Record<Zone, { background: string }> = {
  kids: { background: 'radial-gradient(circle at 50% 55%, #FFF2CC 0%, #FCE5CD 62%, #FCE5CD 100%)' },
  creator: { background: 'radial-gradient(circle at 50% 55%, #0B120F 0%, #050706 62%, #050706 100%)' },
}
/** Inner peak-flash gradient of the wipe (profile.flashPeak caps its opacity). */
export const WIPE_FLASH_GRADIENT = 'radial-gradient(circle at 50% 55%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0) 60%)'
/** Query selector for the wipe's inner flash element (stage-owned Wipe). */
export const WIPE_FLASH_SELECTOR = '[data-wipe-flash]'

export const ZONE_ANNOUNCEMENT: Record<Zone, string> = { kids: 'Entering Kids zone', creator: 'Entering Creator hub' }

/** Real product art already cached by the gateway — never a second copy. */
export const PRODUCT_ART: Record<Zone, string[]> = {
  kids: ['/images/products/kids-coloring.png', '/images/products/kids-puzzle.png', '/images/products/kids-story.png'],
  creator: ['/images/products/creator-canva.png', '/images/products/creator-prompts.png', '/images/products/creator-scripts.png'],
}

// ── Per-tier hard budgets (B6) ─────────────────────────────
export const TIER_BUDGETS = {
  T2: { domItems: 40, particles: 600, codeRainColumns: 14 },
  T1: { domItems: 24, particles: 250, codeRainColumns: 8 },
  T0: { domItems: 0, particles: 0, codeRainColumns: 0 },
} as const

// ── Audio (B7) ─────────────────────────────────────────────
export const KIDS_LEVEL = 0.25 // master gain Kids (peak ≤ −6 dBFS)
export const CREATOR_LEVEL = 0.28 // master gain Creator (peak ≤ −3 dBFS)
export const BPM = 120
export const REVERB_SECONDS = 1.6
export const REVERB_SEND = 0.35
export const MAX_LIVE_NODES = 50

// ── Choreography contract (zone-anim-2 implements it) ──────
// Each choreography component receives ChoreoProps and renders INSIDE the
// stage's content layer. It builds its own GSAP master timeline (registered
// via hooks.registerTimeline) and owns NO timers of its own — the stage
// owns skip, watchdog and done. Animate ONLY transform/opacity.
export interface ChoreoHooks {
  /** Stage-owned wipe element — the choreography's timeline tweens ONLY its
   *  opacity (never transform); the inner flash (WIPE_FLASH_SELECTOR) is
   *  capped at profile.flashPeak. */
  wipeRef: RefObject<HTMLDivElement | null>
  /** Register the zone score so the stage's skip/watchdog can fade it out
   *  within AUDIO_FADE_MS. Pass null to unregister. */
  registerScore: (handle: ScoreHandle | null) => void
  /** Register the choreography's master GSAP timeline so the stage's
   *  skip/watchdog fast path can rush + kill it (single-clock contract).
   *  Registering ALSO starts the stage clock so both clocks stay in sync
   *  even when the lazy chunk loads late. */
  registerTimeline: (tl: gsap.core.Timeline | null) => void
  /** Start the stage's authoritative clock (once, at t=0). Choreographies
   *  without a GSAP timeline (the T0 CSS fallback) call this on mount. */
  startClock: () => void
}

export interface ChoreoProps {
  zone: Zone
  tier: Tier
  profile: MotionProfileName
  totalMs: number
  heroRect: { x: number; y: number; width: number; height: number } | null
  /** Report machine phases — best-effort early signal; the stage timeline
   *  anchors are authoritative and double reports are safely ignored. */
  onPhase: (p: ZonePhase) => void
  /** Stage-wrapped: fires at most once per run. Call at your wipeStart beat,
   *  or rely on the stage anchor at total − WIPE_LEAD_MS. */
  onEnterZone: (zone: Zone) => void
  hooks: ChoreoHooks
}
