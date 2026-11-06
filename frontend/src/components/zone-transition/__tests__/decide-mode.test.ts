// ═══════════════════════════════════════════════════════════
// decide-mode (B3): reduced motion ⇒ gentle + a WORKING tier
// (never a skip); saveData / deviceMemory ≤ 2 / 1 core ⇒ T1;
// a thrown detection fails UPWARD to T2/full; T0 only on a real
// probe-failure signal; ?tdebug overrides the tier (injected
// search string so bun tests pass strings).
// ═══════════════════════════════════════════════════════════

/// <reference types="bun-types/test" />
import { describe, expect, test } from 'bun:test'
import { debugTierOverride, decideMode, defaultProbe, detectEnvironment } from '../core/decide-mode'
import type { ZoneEnvironment } from '../core/decide-mode'

const env = (over: Partial<ZoneEnvironment>): ZoneEnvironment => ({
  hardwareConcurrency: 8,
  deviceMemoryGB: 8,
  saveData: false,
  reducedMotion: false,
  coarsePointer: false,
  probeFailed: false,
  ...over,
})

describe('decideMode', () => {
  test('capable device ⇒ T2 full', () => {
    const m = decideMode(env({}))
    expect(m.tier).toBe('T2')
    expect(m.profile).toBe('full')
  })

  test('reduced motion ⇒ gentle profile + working tier, NEVER a skip', () => {
    const strong = decideMode(env({ reducedMotion: true }))
    expect(strong.profile).toBe('gentle')
    expect(strong.tier).toBe('T2')
    const weak = decideMode(env({ reducedMotion: true, deviceMemoryGB: 2 }))
    expect(weak.profile).toBe('gentle')
    expect(weak.tier).toBe('T1')
  })

  test('saveData / deviceMemory ≤ 2 / hardwareConcurrency ≤ 1 ⇒ T1', () => {
    expect(decideMode(env({ saveData: true })).tier).toBe('T1')
    expect(decideMode(env({ deviceMemoryGB: 2 })).tier).toBe('T1')
    expect(decideMode(env({ deviceMemoryGB: 0.5 })).tier).toBe('T1')
    expect(decideMode(env({ hardwareConcurrency: 1 })).tier).toBe('T1')
    expect(decideMode(env({ deviceMemoryGB: 4, hardwareConcurrency: 4 })).tier).toBe('T2')
  })

  test('T0 ONLY on a real probe failure signal', () => {
    const m = decideMode(env({ probeFailed: true }))
    expect(m.tier).toBe('T0')
    expect(m.profile).toBe('full')
  })

  test('unknown values fail UPWARD (defaults are capable, never weak)', () => {
    // deviceMemory unknown in Safari ⇒ NOT treated as ≤ 2.
    expect(decideMode(env({ deviceMemoryGB: 8, hardwareConcurrency: 8 })).tier).toBe('T2')
  })
})

describe('detectEnvironment', () => {
  test('a thrown detection fails UPWARD to a working T2/full environment', () => {
    const thrown = detectEnvironment(() => {
      throw new Error('probe blocked')
    })
    expect(thrown.probeFailed).toBe(false)
    const mode = decideMode(thrown)
    expect(mode.tier).toBe('T2')
    expect(mode.profile).toBe('full')
  })

  test('the default probe works without browser globals (bun) and fails upward', () => {
    const e = defaultProbe()
    expect(e.probeFailed).toBe(false)
    expect(e.hardwareConcurrency).toBeGreaterThanOrEqual(1)
    expect(decideMode(e).tier).toBe('T2')
  })
})

describe('debugTierOverride', () => {
  test('?tdebug=0|1|2 maps to T0/T1/T2', () => {
    expect(debugTierOverride('?tdebug=0')).toBe('T0')
    expect(debugTierOverride('?tdebug=1')).toBe('T1')
    expect(debugTierOverride('?tdebug=2')).toBe('T2')
  })

  test('other values and missing param yield null', () => {
    expect(debugTierOverride('?tdebug=9')).toBeNull()
    expect(debugTierOverride('?zone=kids')).toBeNull()
    expect(debugTierOverride('')).toBeNull()
  })
})
