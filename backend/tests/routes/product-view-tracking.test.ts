import { describe, expect, test } from 'bun:test'
import { shouldTrackProductView } from '@/lib/product-view-tracking'

describe('product-view analytics request origin', () => {
  test('tracks ordinary browser/API requests', () => {
    expect(shouldTrackProductView(new Headers())).toBe(true)
    expect(shouldTrackProductView(new Headers({ 'x-sdh-server-render': '0' }))).toBe(true)
  })

  test('does not count the internal server-render data fetch', () => {
    expect(shouldTrackProductView(new Headers({ 'x-sdh-server-render': '1' }))).toBe(false)
  })
})
