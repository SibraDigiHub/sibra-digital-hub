// ═══════════════════════════════════════════════════════════
// scroll-safety (B3 — the past scroll-lock bug must never
// return): pure snapshot/diff logic. The stage snapshots html+
// body guard props at mount, re-reads at cleanup and restores
// the snapshot on any diff. bun:test has no DOM — fakes stand
// in for computed styles.
// ═══════════════════════════════════════════════════════════

/// <reference types="bun-types/test" />
import { describe, expect, test } from 'bun:test'
import { htmlBodyGuardProps, snapshotStyles, stylesDiffer, type StyleSnapshot } from '../core/scroll-safety'

const fakeEl = (kebabStyles: Record<string, string>) => ({
  getComputedStyle: () =>
    ({
      getPropertyValue: (prop: string) => kebabStyles[prop] ?? '',
    }) as unknown as CSSStyleDeclaration,
})

describe('snapshotStyles', () => {
  test('reads guard props (camelCase → kebab-case) and trims values', () => {
    const el = fakeEl({ overflow: 'auto', 'overflow-x': 'hidden', position: 'static', 'touch-action': 'auto' })
    const snap = snapshotStyles(el, htmlBodyGuardProps)
    expect(snap.overflow).toBe('auto')
    expect(snap.overflowX).toBe('hidden')
    expect(snap.overflowY).toBe('')
    expect(snap.position).toBe('static')
    expect(snap.touchAction).toBe('auto')
  })

  test('null element yields an empty snapshot (never throws)', () => {
    expect(snapshotStyles(null, htmlBodyGuardProps)).toEqual({})
  })
})

describe('stylesDiffer', () => {
  const base: StyleSnapshot = { overflow: 'auto', overflowX: 'visible', overflowY: 'auto', position: 'static', touchAction: 'auto' }

  test('equal snapshots do not differ', () => {
    expect(stylesDiffer(base, { ...base })).toBe(false)
  })

  test('differs on an overflow change (the scroll-lock signature)', () => {
    expect(stylesDiffer(base, { ...base, overflow: 'hidden' })).toBe(true)
    expect(stylesDiffer(base, { ...base, overflowX: 'hidden' })).toBe(true)
    expect(stylesDiffer(base, { ...base, touchAction: 'none' })).toBe(true)
    expect(stylesDiffer(base, { ...base, position: 'fixed' })).toBe(true)
  })

  test('differs when a key disappears or appears', () => {
    const missing: StyleSnapshot = { ...base }
    delete missing.touchAction
    expect(stylesDiffer(base, missing)).toBe(true)
    expect(stylesDiffer(base, { ...base, willChange: 'transform' })).toBe(true)
  })
})
