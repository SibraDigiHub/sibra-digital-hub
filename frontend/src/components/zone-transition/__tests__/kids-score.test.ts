// ═══════════════════════════════════════════════════════════
// Kids score plan (B4/B7) — pure-data checks: event order per
// the beat sheet, proportional scaling at 5 s / 8 s, one
// marimba note per flying item on the pentatonic run, gentle =
// strictly quieter with no shake/strobe-only kinds, peak intent
// (every voice gain ≤ KIDS_LEVEL), no NaN/Infinity anywhere.
// ═══════════════════════════════════════════════════════════

/// <reference types="bun-types/test" />
import { describe, expect, test } from 'bun:test'
import { planKidsScore } from '../kids/kids-sound'
import { KIDS_FLYING_ITEMS, KIDS_PENTATONIC, kidsWipeWindow } from '../kids/kids-beats'
import { MOTION_PROFILES } from '../config/motion-profiles'
import { BASE_TOTAL_MS, KIDS_BEATS, KIDS_LEVEL } from '../config/constants'

const FULL = MOTION_PROFILES.full
const GENTLE = MOTION_PROFILES.gentle
const KINDS = ['boing', 'pop', 'marimba', 'bubble', 'sparkle', 'pad', 'star', 'tada', 'shimmer']

function assertFinite(events: { t: number; params: Record<string, number | string> }[], totalS: number): void {
  let prev = -1
  for (const e of events) {
    expect(e.t).toBeGreaterThanOrEqual(0)
    expect(e.t).toBeLessThanOrEqual(totalS)
    expect(e.t).toBeGreaterThanOrEqual(prev)
    expect(Number.isFinite(e.t)).toBe(true)
    for (const v of Object.values(e.params)) {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true)
    }
    prev = e.t
  }
}

describe('planKidsScore @6500 full', () => {
  const plan = planKidsScore(6500, FULL)

  test('events sorted by time, all inside [0, total], all finite', () => {
    assertFinite(plan.events, 6.5)
  })

  test('beat order matches the sheet: boing → pop → run → stars → tada → shimmer', () => {
    const at = (kind: string): number[] => plan.events.filter((e) => e.kind === kind).map((e) => e.t)
    expect(at('boing').length).toBe(2)
    expect(at('boing')[0]).toBeLessThan(at('pop')[0])
    expect(at('pop')[0]).toBeCloseTo(KIDS_BEATS.anticipateEnd, 3)
    // the pop fires the run's FIRST note; the per-item run fills the rain window
    const run = at('marimba')
    expect(run[0]).toBeGreaterThan(at('pop')[0])
    expect(run[0]).toBeCloseTo(KIDS_BEATS.anticipateEnd + 0.02, 3)
    const perItem = run.slice(1)
    expect(perItem[0]).toBeGreaterThanOrEqual(KIDS_BEATS.popEnd - 0.01)
    expect(perItem[perItem.length - 1]).toBeLessThanOrEqual(KIDS_BEATS.treasureEnd + 0.01)
    const stars = at('star')
    expect(stars.length).toBe(3)
    expect(stars[0]).toBeGreaterThanOrEqual(KIDS_BEATS.treasureEnd)
    expect(stars[2]).toBeLessThanOrEqual(KIDS_BEATS.levelEnd + 0.01)
    const tada = at('tada')
    expect(tada.length).toBe(1)
    expect(tada[0]).toBeCloseTo(KIDS_BEATS.levelEnd, 3)
    expect(at('shimmer')[0]).toBeGreaterThanOrEqual(kidsWipeWindow(6500).start)
  })

  test('the run is one continuous walk: pop note + one note per item', () => {
    const run = plan.events.filter((e) => e.kind === 'marimba')
    expect(run.length).toBe(KIDS_FLYING_ITEMS + 1)
    run.forEach((e, i) => {
      expect(e.params.freq).toBeCloseTo(KIDS_PENTATONIC[i % KIDS_PENTATONIC.length], 2)
    })
  })

  test('peak intent: every voice gain ≤ KIDS_LEVEL (−6 dBFS through the master)', () => {
    for (const e of plan.events) {
      expect(typeof e.params.gain === 'number' && (e.params.gain as number) <= KIDS_LEVEL).toBe(true)
    }
  })
})

describe('planKidsScore scaling + gentle', () => {
  test('at 5000 ms every time scales by 5000/6500 and order holds', () => {
    const k = 5000 / BASE_TOTAL_MS
    const plan = planKidsScore(5000, FULL)
    expect(plan.events.find((e) => e.kind === 'pop')?.t).toBeCloseTo(KIDS_BEATS.anticipateEnd * k, 3)
    expect(plan.events.find((e) => e.kind === 'tada')?.t).toBeCloseTo(KIDS_BEATS.levelEnd * k, 3)
    assertFinite(plan.events, 5)
  })

  test('at 8000 ms the sheet scales by 8000/6500 and the wipe window holds', () => {
    const k = 8000 / BASE_TOTAL_MS
    const plan = planKidsScore(8000, FULL)
    expect(plan.events.find((e) => e.kind === 'pop')?.t).toBeCloseTo(KIDS_BEATS.anticipateEnd * k, 3)
    const shimmer = plan.events.find((e) => e.kind === 'shimmer')
    expect(shimmer?.t).toBeGreaterThanOrEqual(kidsWipeWindow(8000).start)
    assertFinite(plan.events, 8)
  })

  test('gentle: same shape, every gain strictly lower, no shake/strobe kinds', () => {
    const full = planKidsScore(6500, FULL)
    const gentle = planKidsScore(6500, GENTLE)
    expect(gentle.events.length).toBe(full.events.length)
    // Only the intro stretches, so near-simultaneous events may interleave
    // differently — compare per kind (order inside a kind is stable).
    const kindsFull = new Set(full.events.map((e) => e.kind))
    expect(kindsFull.size).toBe(new Set(gentle.events.map((e) => e.kind)).size)
    for (const kind of kindsFull) {
      const gf = full.events.filter((e) => e.kind === kind)
      const gg = gentle.events.filter((e) => e.kind === kind)
      expect(gg.length).toBe(gf.length)
      expect(KINDS).toContain(kind)
      gf.forEach((e, i) => {
        expect(gg[i].params.gain as number).toBeLessThan(e.params.gain as number)
      })
    }
  })
})
