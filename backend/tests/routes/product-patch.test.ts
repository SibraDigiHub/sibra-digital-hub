// ═══════════════════════════════════════════════════════════
// Instant-delivery field independence (owner rule 1.1):
//   • PATCH {instantDownload:false} alone NEVER nulls the
//     deliverable/link/watch fields — the toggle only flips the flag.
//   • The admin form payload (toggle off, values present) keeps the
//     stored values; mode switches keep the other mode's values.
//   • Present empty/null values still clear (explicit removal via ✕).
//   • URL validators keep rejecting unsafe refs in both directions.
// Run:  bun test tests/routes/product-patch.test.ts
// ═══════════════════════════════════════════════════════════
import { describe, expect, test } from 'bun:test'

import { applyProductPatch } from '@/services/product-service'

describe('instant-delivery fields survive toggles', () => {
  test('PATCH instantDownload:false alone touches only the flag', () => {
    const { data } = applyProductPatch({ instantDownload: false })
    expect(Object.keys(data)).toEqual(['instantDownload'])
    expect(data.instantDownload).toBe(false)
  })

  test('PATCH instantDownload:true alone touches only the flag', () => {
    const { data } = applyProductPatch({ instantDownload: true })
    expect(Object.keys(data)).toEqual(['instantDownload'])
    expect(data.instantDownload).toBe(true)
  })

  test('full form payload with the toggle OFF keeps deliverable + watch values', () => {
    // Exactly what ProductForm sends after the fix: values always present.
    const payload = {
      instantDownload: false,
      deliverableUrl: 'r2:private-deliverables/pack.zip',
      deliverableName: 'pack.zip',
      deliveryMode: 'file',
      fullVideoUrl: 'https://ik.imagekit.io/sibra/full.mp4',
      watchTtlHours: 48,
      watchMaxConcurrent: 3,
    }
    const { data } = applyProductPatch(payload)
    expect(data.instantDownload).toBe(false)
    expect(data.deliverableUrl).toBe('r2:private-deliverables/pack.zip')
    expect(data.deliverableName).toBe('pack.zip')
    expect(data.deliveryMode).toBe('file')
    expect(data.fullVideoUrl).toBe('https://ik.imagekit.io/sibra/full.mp4')
    expect(data.watchTtlHours).toBe(48)
    expect(data.watchMaxConcurrent).toBe(3)
  })

  test('switching deliveryMode away from watch keeps the watch settings', () => {
    const { data } = applyProductPatch({ deliveryMode: 'file' })
    expect(Object.keys(data)).toEqual(['deliveryMode'])
    expect(data.deliveryMode).toBe('file')
  })

  test('explicit ✕ removal still clears (present empty string → null)', () => {
    const { data } = applyProductPatch({ deliverableUrl: '', deliverableName: '' })
    expect(data.deliverableUrl).toBeNull()
    expect(data.deliverableName).toBeNull()
  })

  test('explicit watch-URL removal still clears', () => {
    const { data } = applyProductPatch({ fullVideoUrl: '' })
    expect(data.fullVideoUrl).toBeNull()
  })

  test('unsafe deliverable refs are still rejected while values persist', () => {
    expect(() => applyProductPatch({ deliverableUrl: 'javascript:alert(1)' })).toThrow()
    const ok = applyProductPatch({ deliverableUrl: 'https://cdn.example.com/file.zip' })
    expect(ok.data.deliverableUrl).toBe('https://cdn.example.com/file.zip')
  })

  test('watchMaxConcurrent clamps / falls back outside the saved payload path too', () => {
    const zero = applyProductPatch({ watchMaxConcurrent: 0 }) // falsy → legacy default 2
    const hi = applyProductPatch({ watchMaxConcurrent: 99 })
    const lo = applyProductPatch({ watchMaxConcurrent: -5 })
    expect(zero.data.watchMaxConcurrent).toBe(2)
    expect(hi.data.watchMaxConcurrent).toBe(10)
    expect(lo.data.watchMaxConcurrent).toBe(1)
  })
})
