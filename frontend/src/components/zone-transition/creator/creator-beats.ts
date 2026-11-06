// ═══════════════════════════════════════════════════════════
// Creator beat planning (B5) — PURE data, no DOM / no ctx: the
// seeded build layout (holo windows, UI-kit cubes, product
// cards), code-rain shape and the wipe window shared by the
// visual timeline (creator-timeline.ts) and the score plan
// (creator-sound.ts) so snaps/stabs land on the same instants.
// ═══════════════════════════════════════════════════════════

import { BASE_TOTAL_MS, BPM, CREATOR_BEATS, WIPE_LEAD_MS } from '../config/constants'
import type { MotionProfile } from '../config/motion-profiles'
import { clampTotal } from '../core/timeline'

/** Deterministic PRNG — seeded variation in positions/timing (B5). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CREATOR_SEED = 20260215

/** Rising build arpeggio (A-minor-pentatonic shaped, original + generic). */
export const CREATOR_ARP = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33]

export type CreatorItemKind = 'window' | 'cube' | 'card'

export interface CreatorItemSpot {
  kind: CreatorItemKind
  /** Window variant / cube index / product index. */
  index: number
  /** Viewport-fraction resting point. */
  fx: number
  fy: number
  /** Perspective depth in px. */
  z: number
  scale: number
  rot: number
  /** Seconds after bootEnd the snap happens (authored at BASE_TOTAL_MS). */
  snap: number
}

export interface CreatorLayout {
  items: CreatorItemSpot[]
  /** Segmented progress-bar ticks. */
  segments: number
  /** Code-rain column count (≤ budgetFor(tier).codeRainColumns). */
  rainColumns: number
  /** Seconds between rain emits (authored at BASE_TOTAL_MS). */
  rainStep: number
}

/** Floating window slots — spread around the centre the ring will occupy. */
const WINDOW_SLOTS = [
  { fx: 0.19, fy: 0.28 },
  { fx: 0.43, fy: 0.2 },
  { fx: 0.66, fy: 0.28 },
  { fx: 0.27, fy: 0.52 },
] as const

/**
 * Seeded build layout. domBudget/particleScale scale the group counts the
 * same way the kids kit does (gentle halves them); the three product cards
 * always stay — the business sells them.
 */
export function planCreatorLayout(domBudget: number, particleScale: number, rainBudget: number): CreatorLayout {
  const s = Math.min(1, (domBudget * particleScale) / 40)
  const rnd = mulberry32(CREATOR_SEED)
  const windowCount = Math.max(2, Math.round(4 * s))
  const cubeCount = Math.max(1, Math.round(3 * s))
  const buildSpan = CREATOR_BEATS.buildEnd - CREATOR_BEATS.bootEnd
  const items: CreatorItemSpot[] = []
  for (let i = 0; i < windowCount; i++) {
    const slot = WINDOW_SLOTS[i % WINDOW_SLOTS.length]
    items.push({
      kind: 'window',
      index: i,
      fx: slot.fx + (rnd() - 0.5) * 0.05,
      fy: slot.fy + (rnd() - 0.5) * 0.05,
      z: -150 + rnd() * 210,
      scale: 0.9 + rnd() * 0.25,
      rot: (rnd() - 0.5) * 10,
      snap: buildSpan * (0.12 + (i / Math.max(1, windowCount)) * 0.5) + rnd() * 0.1,
    })
  }
  for (let i = 0; i < cubeCount; i++) {
    items.push({
      kind: 'cube',
      index: i,
      fx: 0.72 + rnd() * 0.14,
      fy: 0.52 + rnd() * 0.22,
      z: -40 + rnd() * 160,
      scale: 0.5 + rnd() * 0.3,
      rot: (rnd() - 0.5) * 30,
      snap: buildSpan * (0.5 + i * 0.14) + rnd() * 0.08,
    })
  }
  for (let i = 0; i < 3; i++) {
    items.push({
      kind: 'card',
      index: i,
      fx: 0.16 + i * 0.3 + (rnd() - 0.5) * 0.05,
      fy: 0.7 + (i % 2) * 0.08,
      z: 30 + i * 45,
      scale: 0.95 + rnd() * 0.15,
      rot: (rnd() - 0.5) * 8,
      snap: buildSpan * (0.58 + i * 0.14) + rnd() * 0.06,
    })
  }
  items.sort((a, b) => a.snap - b.snap)
  return {
    items,
    segments: Math.max(8, Math.round(12 * s)),
    rainColumns: rainBudget,
    rainStep: 0.16,
  }
}

/** Snappable items at the full T2 budget — the score plans one stab per snap. */
export const CREATOR_SNAP_COUNT = planCreatorLayout(40, 1, 14).items.length

/** ≤ 0.9 s (B5) — must end exactly at the stage's onEnterZone anchor. */
export const WIPE_DUR_S = 0.55

/**
 * Wipe window shared by the visual timeline and the score: starts at the
 * scaled wipeStart beat but never later than enterZone − WIPE_DUR_S, so the
 * obsidian wipe is FULLY OPAQUE the instant the stage fires onEnterZone
 * (total − 900 ms) at EVERY totalMs in [5000, 8000].
 */
export function creatorWipeWindow(totalMs: number): { start: number; end: number } {
  const total = clampTotal(totalMs)
  const k = total / BASE_TOTAL_MS
  const enterAt = (total - WIPE_LEAD_MS) / 1000
  const start = Math.min(CREATOR_BEATS.wipeStart * k, enterAt - WIPE_DUR_S)
  return { start, end: start + WIPE_DUR_S }
}

/** One tempo-locked sub pulse per beat (60 / BPM seconds). */
export function beatSeconds(): number {
  return 60 / BPM
}

/** Intro tempo: gentle stretches the first beats onto the stage 'playing' anchor. */
export function introStretch(profile: MotionProfile): number {
  return 1 / profile.tempoScale
}
