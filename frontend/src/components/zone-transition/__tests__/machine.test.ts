// ═══════════════════════════════════════════════════════════
// ZoneMachine (B3): forward-only phases, illegal transitions
// ignored, forceDone from ANY state, a second start (arming
// while not idle) rejected via can().
// ═══════════════════════════════════════════════════════════

/// <reference types="bun-types/test" />
import { describe, expect, test } from 'bun:test'
import { createZoneMachine } from '../core/machine'

const PATH = ['idle', 'arming', 'playing', 'payoff', 'wiping', 'done'] as const
const STEPS = PATH.slice(1) as unknown as Array<'arming' | 'playing' | 'payoff' | 'wiping' | 'done'>

describe('createZoneMachine', () => {
  test('walks the legal chain idle→arming→playing→payoff→wiping→done', () => {
    const m = createZoneMachine()
    expect(m.current).toBe('idle')
    for (const p of STEPS) expect(m.go(p)).toBe(true)
    expect(m.current).toBe('done')
  })

  test('ignores illegal transitions (jumps ahead, repeats, backwards)', () => {
    const m = createZoneMachine()
    expect(m.go('payoff')).toBe(false) // cannot jump ahead
    expect(m.go('done')).toBe(false)
    m.go('arming')
    expect(m.go('arming')).toBe(false) // no repeats
    expect(m.go('wiping')).toBe(false) // no skipping ahead
    m.go('playing')
    expect(m.go('arming')).toBe(false) // never backwards
    expect(m.current).toBe('playing')
  })

  test('double-arming is ignored — can() gates a second start from idle only', () => {
    const m = createZoneMachine()
    expect(m.can('arming')).toBe(true)
    m.go('arming')
    expect(m.can('arming')).toBe(false)
    expect(m.go('arming')).toBe(false)
    expect(m.current).toBe('arming')
  })

  test('forceDone reaches done from EVERY state exactly once', () => {
    for (const start of ['idle', 'arming', 'playing', 'payoff', 'wiping'] as const) {
      const m = createZoneMachine()
      const upto = PATH.indexOf(start) // -1 for idle → no steps walked
      for (let i = 1; i <= upto; i++) m.go(PATH[i])
      expect(m.current).toBe(start)
      expect(m.forceDone()).toBe(true)
      expect(m.current).toBe('done')
      expect(m.forceDone()).toBe(false) // idempotent
    }
  })

  test('onChange fires only for accepted transitions', () => {
    const seen: string[] = []
    const m = createZoneMachine((s) => seen.push(s))
    m.go('payoff') // ignored — no event
    m.go('arming')
    m.forceDone()
    expect(seen).toEqual(['arming', 'done'])
  })
})
