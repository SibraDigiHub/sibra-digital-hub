// ═══════════════════════════════════════════════════════════
// Kids beat planning (B4) — PURE data, no DOM / no ctx: the
// seeded treasure layout, the pentatonic run and the wipe window
// shared by the visual timeline (kids-timeline.ts) and the score
// plan (kids-sound.ts) so both land on the same instants.
// ═══════════════════════════════════════════════════════════

import { BASE_TOTAL_MS, KIDS_BEATS, WIPE_LEAD_MS } from '../config/constants'
import type { MotionProfile } from '../config/motion-profiles'
import { clampTotal } from '../core/timeline'

/** Deterministic PRNG — the layout never looks mechanical yet is stable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const KIDS_SEED = 20260214

/** Major-pentatonic run C5 D5 E5 G5 A5 C6 D6 E6 G6 A6 (B7: one note per item). */
export const KIDS_PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760]

export type KidsItemKind = 'block' | 'crayon' | 'puzzle' | 'balloon' | 'star' | 'card'

export interface KidsItemSpot {
  kind: KidsItemKind
  /** Viewport-fraction point the item lands on. */
  fx: number
  fy: number
  /** Perspective depth in px (negative = away from the viewer). */
  z: number
  scale: number
  rot: number
  /** Seconds after popEnd the flight starts (authored at BASE_TOTAL_MS). */
  delay: number
  /** Flight duration in seconds (authored at BASE_TOTAL_MS). */
  dur: number
  /** Balloons keep floating — no landing squash. */
  floats: boolean
}

/** Per-kind base counts + size ranges (scaled by the tier/profile budget). */
const GROUPS: Array<{ kind: KidsItemKind; base: number; min: number; sMin: number; sMax: number }> = [
  { kind: 'block', base: 6, min: 2, sMin: 0.8, sMax: 1.15 },
  { kind: 'crayon', base: 4, min: 1, sMin: 0.75, sMax: 1.05 },
  { kind: 'puzzle', base: 3, min: 1, sMin: 0.8, sMax: 1.1 },
  { kind: 'balloon', base: 3, min: 1, sMin: 0.9, sMax: 1.25 },
  { kind: 'star', base: 5, min: 2, sMin: 0.5, sMax: 0.95 },
  { kind: 'card', base: 3, min: 3, sMin: 0.85, sMax: 1.1 },
]

/** Count scale: 1 at T2/full, halved for gentle (profile.particleScale). */
export function kidsCountScale(domBudget: number, particleScale: number): number {
  return (domBudget * particleScale) / 40
}

/**
 * Seeded treasure layout: where every item lands, how deep, when.
 * Authored at BASE_TOTAL_MS — callers scale delay/dur by totalMs/6500.
 */
export function planKidsLayout(domBudget: number, particleScale: number): KidsItemSpot[] {
  const s = Math.min(1, kidsCountScale(domBudget, particleScale))
  const rnd = mulberry32(KIDS_SEED)
  const rainSpan = KIDS_BEATS.treasureEnd - KIDS_BEATS.popEnd
  const spots: KidsItemSpot[] = []
  let order = 0
  for (const g of GROUPS) {
    const n = Math.max(g.min, Math.round(g.base * s))
    for (let i = 0; i < n; i++) {
      const delay = Math.min(rainSpan * 0.66, (order / 26) * rainSpan * 0.6 + rnd() * 0.28)
      const dur = 0.75 + rnd() * 0.55
      spots.push({
        kind: g.kind,
        fx: 0.09 + rnd() * 0.82,
        fy: 0.2 + rnd() * 0.6,
        z: -240 + rnd() * 330,
        scale: g.sMin + rnd() * (g.sMax - g.sMin),
        rot: (rnd() - 0.5) * 56,
        delay,
        dur: Math.min(dur, rainSpan - delay - 0.08),
        floats: g.kind === 'balloon',
      })
      order++
    }
  }
  return spots
}

/** Flying item count at the full T2 budget — the score plans one note per item. */
export const KIDS_FLYING_ITEMS = planKidsLayout(40, 1).length

/** ≤ 0.9 s (B4): long enough to hide the swap, short enough to keep the show. */
export const WIPE_DUR_S = 0.55

/**
 * Wipe window shared by the visual timeline and the score: starts at the
 * scaled wipeStart beat but never later than enterZone − WIPE_DUR_S, so the
 * wipe is FULLY OPAQUE the instant the stage fires onEnterZone (total − 900 ms)
 * at EVERY totalMs in [5000, 8000] — the plain scaled beat would start after
 * enterZone at short totals (e.g. 4.31 s vs 4.1 s at 5000 ms).
 */
export function kidsWipeWindow(totalMs: number): { start: number; end: number } {
  const total = clampTotal(totalMs)
  const k = total / BASE_TOTAL_MS
  const enterAt = (total - WIPE_LEAD_MS) / 1000
  const start = Math.min(KIDS_BEATS.wipeStart * k, enterAt - WIPE_DUR_S)
  return { start, end: start + WIPE_DUR_S }
}

/** Intro tempo: gentle stretches the first beats onto the stage 'playing' anchor. */
export function introStretch(profile: MotionProfile): number {
  return 1 / profile.tempoScale
}
