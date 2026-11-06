// ═══════════════════════════════════════════════════════════
// Stage timeline (B3): the 5–8 s clamp, proportional beat
// scaling at 5 s and 8 s (order preserved), the pure-object
// master timeline (onEnterZone once at total − WIPE_LEAD_MS,
// onDone once at total, phase order), and the ≈0.4 s
// fast-forward. Runs headless in bun:test — the tween target is
// a plain { t: 0 } proxy, no DOM needed (proven pattern).
// ═══════════════════════════════════════════════════════════

/// <reference types="bun-types/test" />
import { describe, expect, test } from 'bun:test'
import { buildZoneStageTimeline, clampTotal, scaleBeats, type StageTimeline } from '../core/timeline'
import { MOTION_PROFILES } from '../config/motion-profiles'
import { BASE_TOTAL_MS, KIDS_BEATS, SKIP_FAST_MS, WIPE_LEAD_MS, ZONE_MAX_MS, ZONE_MIN_MS } from '../config/constants'

function build(totalMs: number) {
  const phases: string[] = []
  const enterAt: number[] = []
  let doneCalls = 0
  const stage: StageTimeline = buildZoneStageTimeline({
    totalMs,
    profile: MOTION_PROFILES.full,
    phaseAnchors: { playingAt: 0.45, payoffAt: 5.0, wipingAt: 5.6 },
    hooks: {
      onPhase: (p) => phases.push(p),
      onEnterZone: () => enterAt.push(stage.tl.time()),
      onDone: () => doneCalls++,
    },
  })
  return { stage, phases, enterAt, doneCalls: () => doneCalls }
}

describe('clampTotal', () => {
  test('clamps into the 5–8 s band', () => {
    expect(clampTotal(5000)).toBe(ZONE_MIN_MS)
    expect(clampTotal(6500)).toBe(6500)
    expect(clampTotal(8000)).toBe(ZONE_MAX_MS)
    expect(clampTotal(4000)).toBe(ZONE_MIN_MS)
    expect(clampTotal(9000)).toBe(ZONE_MAX_MS)
  })
})

describe('scaleBeats', () => {
  test('scales proportionally at 5 s (5000/6500)', () => {
    const scaled = scaleBeats(KIDS_BEATS, 5000)
    const k = 5000 / BASE_TOTAL_MS
    expect(scaled.wipeStart).toBeCloseTo(KIDS_BEATS.wipeStart * k, 5)
    expect(scaled.popEnd).toBeCloseTo(KIDS_BEATS.popEnd * k, 5)
    expect(scaled.levelEnd).toBeCloseTo(KIDS_BEATS.levelEnd * k, 5)
  })

  test('scales proportionally at 8 s and preserves beat order', () => {
    const scaled = scaleBeats(KIDS_BEATS, 8000)
    const k = 8000 / BASE_TOTAL_MS
    const keys = Object.keys(KIDS_BEATS) as (keyof typeof KIDS_BEATS)[]
    expect(Object.keys(scaled)).toEqual(keys)
    for (const key of keys) expect(scaled[key]).toBeCloseTo(KIDS_BEATS[key] * k, 5)
    // Order preserved: anticipation < pop < treasure < level < payoff ≤ wipe.
    expect(scaled.anticipateEnd).toBeLessThan(scaled.popEnd)
    expect(scaled.popEnd).toBeLessThan(scaled.treasureEnd)
    expect(scaled.treasureEnd).toBeLessThan(scaled.levelEnd)
    expect(scaled.levelEnd).toBeLessThan(scaled.payoffEnd)
    expect(scaled.payoffEnd).toBeLessThanOrEqual(scaled.wipeStart)
  })
})

describe('buildZoneStageTimeline', () => {
  test('phase order is arming → playing → payoff → wiping → done', () => {
    const { stage, phases } = build(6500)
    stage.tl.progress(1)
    expect(phases).toEqual(['arming', 'playing', 'payoff', 'wiping', 'done'])
  })

  test('duration equals the clamped total', () => {
    expect(build(6500).stage.tl.duration()).toBeCloseTo(6.5, 3)
    expect(build(9000).stage.tl.duration()).toBeCloseTo(8, 3)
  })

  test('onEnterZone fires exactly once at total − WIPE_LEAD_MS, onDone once at total', () => {
    const { stage, enterAt, doneCalls } = build(6500)
    const anchorAt = (6500 - WIPE_LEAD_MS) / 1000 // 5.6 s for the 6.5 s default
    stage.tl.seek(anchorAt - 0.01, false)
    expect(enterAt.length).toBe(0)
    stage.tl.seek(anchorAt + 0.01, false)
    expect(enterAt.length).toBe(1)
    // The anchor sits within ±0.05 s of total − WIPE_LEAD_MS (fp-safe),
    // and strictly after the 5.59 s probe above.
    expect(enterAt[0]).toBeGreaterThan(anchorAt - 0.01)
    expect(enterAt[0]).toBeCloseTo(anchorAt, 1)
    expect(doneCalls()).toBe(0)
    stage.tl.seek(6.5, false)
    expect(doneCalls()).toBe(1)
    stage.tl.progress(1)
    expect(doneCalls()).toBe(1) // never twice
  })

  test('fastForward compresses the remaining timeline to ≤ 0.5 s worth', () => {
    const { stage } = build(6500)
    stage.fastForward()
    expect(stage.tl.timeScale()).toBeCloseTo(6.5 / (SKIP_FAST_MS / 1000), 3)
    const remaining = (stage.tl.duration() - stage.tl.time()) / stage.tl.timeScale()
    expect(remaining).toBeLessThanOrEqual(0.5)
    // The fast-forwarded timeline still completes its story (done fires once).
    stage.tl.progress(1)
    expect(stage.tl.time()).toBeCloseTo(6.5, 3)
  })

  test('onEnterZone anchor sits inside the wiping window, before done', () => {
    const { stage } = build(6500)
    const tl = stage.tl
    tl.seek(5.55, false)
    // Not yet entered at 5.55 s (anchor at 5.6 s for the 6.5 s default).
    const fired: number[] = []
    tl.call(() => fired.push(tl.time()), undefined, 5.59)
    tl.progress(1)
    expect(fired.length).toBe(1)
    expect(tl.time()).toBeCloseTo(6.5, 3)
  })
})
