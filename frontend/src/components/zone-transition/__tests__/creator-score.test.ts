// ═══════════════════════════════════════════════════════════
// Creator score plan (B5/B7) — pure-data checks: boot blips
// after ignite, sub pulses locked to the BPM grid, rising
// risers, milestone chimes at 25/50/75/100, the ship impact on
// the drop, one stab per build snap, proportional scaling at
// 5 s / 8 s, gentle quieter, peak intent ≤ CREATOR_LEVEL, no NaN.
// ═══════════════════════════════════════════════════════════

/// <reference types="bun-types/test" />
import { describe, expect, test } from 'bun:test'
import { planCreatorScore } from '../creator/creator-sound'
import { CREATOR_ARP, CREATOR_SNAP_COUNT, creatorWipeWindow } from '../creator/creator-beats'
import { MOTION_PROFILES } from '../config/motion-profiles'
import { BASE_TOTAL_MS, BPM, CREATOR_BEATS, CREATOR_LEVEL } from '../config/constants'

const FULL = MOTION_PROFILES.full
const GENTLE = MOTION_PROFILES.gentle
const KINDS = ['hum', 'glitch', 'blip', 'tick', 'sub', 'hat', 'arp', 'snap', 'riser', 'chime', 'impact', 'shimmer', 'sweep']

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

describe('planCreatorScore @6500 full', () => {
  const plan = planCreatorScore(6500, FULL)

  test('events sorted by time, all inside [0, total], all finite', () => {
    assertFinite(plan.events, 6.5)
  })

  test('boot blips land after the ignite anchor', () => {
    for (const e of plan.events.filter((e) => e.kind === 'blip')) {
      expect(e.t).toBeGreaterThanOrEqual(CREATOR_BEATS.igniteEnd - 0.01)
    }
  })

  test('sub pulses lock to the BPM grid (60 / BPM seconds apart)', () => {
    const subs = plan.events.filter((e) => e.kind === 'sub').map((e) => e.t)
    expect(subs.length).toBeGreaterThan(3)
    const beat = 60 / BPM // × k = 1 at 6500
    for (let i = 1; i < subs.length; i++) expect(subs[i] - subs[i - 1]).toBeCloseTo(beat, 3)
    expect(subs[0]).toBeGreaterThanOrEqual(CREATOR_BEATS.bootEnd - 0.01)
  })

  test('milestone risers rise; chimes sit at 25/50/75/100 of the compile span', () => {
    const span = CREATOR_BEATS.compileEnd - CREATOR_BEATS.buildEnd
    const risers = plan.events.filter((e) => e.kind === 'riser' && e.t <= CREATOR_BEATS.compileEnd + 0.01)
    expect(risers.length).toBe(4)
    for (let i = 1; i < risers.length; i++) {
      expect(risers[i].params.from as number).toBeGreaterThanOrEqual(risers[i - 1].params.from as number)
    }
    const chimes = plan.events.filter((e) => e.kind === 'chime')
    expect(chimes.length).toBe(4)
    ;[0.25, 0.5, 0.75, 1].forEach((m, i) => {
      expect(chimes[i].t).toBeCloseTo(CREATOR_BEATS.buildEnd + span * m, 3)
    })
  })

  test('one stab per build snap; arpeggio walks the rising pattern', () => {
    const snaps = plan.events.filter((e) => e.kind === 'snap')
    expect(snaps.length).toBe(CREATOR_SNAP_COUNT)
    for (const s of snaps) {
      expect(s.t).toBeGreaterThanOrEqual(CREATOR_BEATS.bootEnd - 0.01)
      expect(s.t).toBeLessThanOrEqual(CREATOR_BEATS.buildEnd + 0.01)
    }
    const arps = plan.events.filter((e) => e.kind === 'arp')
    expect(arps.length).toBe(CREATOR_ARP.length)
    for (let i = 0; i < arps.length; i++) expect(arps[i].params.freq).toBeCloseTo(CREATOR_ARP[i], 2)
  })

  test('impact hits the ship drop; shimmer + sweep close the run', () => {
    const impact = plan.events.find((e) => e.kind === 'impact')
    expect(impact).toBeDefined()
    expect(impact?.t).toBeCloseTo(CREATOR_BEATS.compileEnd, 3)
    const sweep = plan.events.find((e) => e.kind === 'sweep')
    expect(sweep?.t).toBeGreaterThanOrEqual(creatorWipeWindow(6500).start)
  })

  test('peak intent: every voice gain ≤ CREATOR_LEVEL (−3 dBFS through the master)', () => {
    for (const e of plan.events) {
      expect(typeof e.params.gain === 'number' && (e.params.gain as number) <= CREATOR_LEVEL).toBe(true)
    }
  })
})

describe('planCreatorScore scaling + gentle', () => {
  test('at 5000 ms the sheet scales by 5000/6500 and order holds', () => {
    const k = 5000 / BASE_TOTAL_MS
    const plan = planCreatorScore(5000, FULL)
    expect(plan.events.find((e) => e.kind === 'impact')?.t).toBeCloseTo(CREATOR_BEATS.compileEnd * k, 3)
    const subs = plan.events.filter((e) => e.kind === 'sub').map((e) => e.t)
    for (let i = 1; i < subs.length; i++) expect(subs[i] - subs[i - 1]).toBeCloseTo((60 / BPM) * k, 3)
    assertFinite(plan.events, 5)
  })

  test('at 8000 ms the sheet scales by 8000/6500', () => {
    const k = 8000 / BASE_TOTAL_MS
    const plan = planCreatorScore(8000, FULL)
    expect(plan.events.find((e) => e.kind === 'impact')?.t).toBeCloseTo(CREATOR_BEATS.compileEnd * k, 3)
    expect(plan.events.find((e) => e.kind === 'hum')?.t).toBeCloseTo(0.02 * k, 3)
    assertFinite(plan.events, 8)
  })

  test('gentle: same shape, every gain strictly lower, no shake/strobe kinds', () => {
    const full = planCreatorScore(6500, FULL)
    const gentle = planCreatorScore(6500, GENTLE)
    expect(gentle.events.length).toBe(full.events.length)
    // Only the intro stretches, so near-simultaneous grid events may
    // interleave differently — compare per kind (order inside a kind is stable).
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
