// ═══════════════════════════════════════════════════════════
// Stage timeline (B3) — the ONE authoritative clock: clamped
// total, proportional beat scaling, and a pure-object master
// timeline whose call() anchors fire the phase machine,
// onEnterZone (at total − WIPE_LEAD_MS, hidden under the wipe)
// and onDone (at total). The tween target is a plain { t: 0 }
// proxy so bun:test can progress(1) headless — the stage
// timeline never touches DOM (choreographies tween their own).
// ═══════════════════════════════════════════════════════════

import gsap from 'gsap'
import { BASE_TOTAL_MS, SKIP_FAST_MS, WIPE_LEAD_MS, ZONE_MAX_MS, ZONE_MIN_MS } from '../config/constants'
import type { MotionProfile } from '../config/motion-profiles'
import type { ZonePhase } from './machine'

/** Clamp the configured duration into the 5–8 s band (B3). */
export function clampTotal(totalMs: number): number {
  return Math.min(ZONE_MAX_MS, Math.max(ZONE_MIN_MS, totalMs))
}

/**
 * Beat sheets are authored in seconds at BASE_TOTAL_MS — scale them
 * proportionally so a 5 s or 8 s run keeps the exact storyline shape.
 */
export function scaleBeats(beats: Record<string, number>, totalMs: number): Record<string, number> {
  const k = clampTotal(totalMs) / BASE_TOTAL_MS
  const out: Record<string, number> = {}
  for (const key of Object.keys(beats)) out[key] = beats[key] * k
  return out
}

/** Phase-boundary seconds (already scaled) the stage derives from the zone's beats. */
export interface StagePhaseAnchors {
  playingAt: number
  payoffAt: number
  wipingAt: number
}

export interface ZoneTimelineHooks {
  onPhase: (p: ZonePhase) => void
  onEnterZone: () => void
  onDone: () => void
}

export interface StageTimeline {
  tl: gsap.core.Timeline
  /** Skip fast path: timeScale so the remaining timeline completes in ≈ SKIP_FAST_MS. */
  fastForward(): void
}

/**
 * Build the stage master timeline. `profile.tempoScale` stretches only the
 * intro boundary (gentle = slightly later 'playing'); the payoff/wipe/done
 * anchors stay pinned so enterZone (total − WIPE_LEAD_MS) and the total
 * duration never drift with the profile.
 */
export function buildZoneStageTimeline(opts: {
  totalMs: number
  profile: MotionProfile
  phaseAnchors: StagePhaseAnchors
  hooks: ZoneTimelineHooks
}): StageTimeline {
  const totalMs = clampTotal(opts.totalMs)
  const totalS = totalMs / 1000
  const enterAt = (totalMs - WIPE_LEAD_MS) / 1000
  const proxy = { t: 0 }
  const tl = gsap.timeline({ paused: true })
  const set = (p: ZonePhase, at: number) => tl.call(() => opts.hooks.onPhase(p), undefined, at)

  // Pure-object proxy tween gives the timeline its full duration without DOM.
  tl.to(proxy, { t: 1, duration: totalS, ease: 'none' }, 0)
  set('arming', 0)
  set('playing', opts.phaseAnchors.playingAt / opts.profile.tempoScale)
  set('payoff', opts.phaseAnchors.payoffAt)
  set('wiping', opts.phaseAnchors.wipingAt)
  // Zone hand-off hides under the wipe (B3): pinned to total − WIPE_LEAD_MS.
  tl.call(() => opts.hooks.onEnterZone(), undefined, enterAt)
  set('done', totalS)
  tl.call(() => opts.hooks.onDone(), undefined, totalS)

  const fastForward = () => {
    // Full duration compressed into SKIP_FAST_MS ⇒ the REMAINING part from
    // any position completes in ≤ SKIP_FAST_MS (the onDone anchor still fires).
    tl.timeScale(totalS / (SKIP_FAST_MS / 1000))
  }
  return { tl, fastForward }
}
