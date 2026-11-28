import { describe, expect, test } from 'bun:test'
import { catalogSeedRouteState } from '../catalog-seed-state'

describe('catalogSeedRouteState', () => {
  test('reads a Creator shop seed before the client store hydrates', () => {
    expect(catalogSeedRouteState('creator|||featured|0')).toEqual({
      zone: 'creator',
      category: null,
      search: '',
      sort: 'featured',
    })
  })

  test('preserves category, search and sort state from a real route', () => {
    expect(catalogSeedRouteState('kids|coloring-books|rainbow pages|price-asc|0')).toEqual({
      zone: 'kids',
      category: 'coloring-books',
      search: 'rainbow pages',
      sort: 'price-asc',
    })
  })

  test('preserves pipe characters inside the search string', () => {
    expect(catalogSeedRouteState('creator||one|two|newest|0')?.search).toBe('one|two')
  })

  test('rejects malformed or unsupported seed keys', () => {
    expect(catalogSeedRouteState(undefined)).toBeNull()
    expect(catalogSeedRouteState('kids|only-two')).toBeNull()
    expect(catalogSeedRouteState('admin|||featured|0')).toBeNull()
    expect(catalogSeedRouteState('kids|||unknown|0')).toBeNull()
    expect(catalogSeedRouteState('kids|||featured|1')).toBeNull()
  })
})
