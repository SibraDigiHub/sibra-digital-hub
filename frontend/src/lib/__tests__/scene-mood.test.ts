import { describe, expect, test } from 'bun:test'
import { resolveSceneMood } from '../scene-mood'

describe('resolveSceneMood', () => {
  test('uses the active Kids route instead of a stale Creator hover preview', () => {
    expect(resolveSceneMood('shop', 'kids', 1)).toBe(0)
  })

  test('uses the active Creator route instead of a stale Kids hover preview', () => {
    expect(resolveSceneMood('shop', 'creator', 0)).toBe(1)
  })

  test('keeps the hover preview on the gateway', () => {
    expect(resolveSceneMood('gateway', null, 1)).toBe(1)
  })

  test('keeps product pages aligned with their active zone', () => {
    expect(resolveSceneMood('product', 'creator', 0.5)).toBe(1)
  })
})
