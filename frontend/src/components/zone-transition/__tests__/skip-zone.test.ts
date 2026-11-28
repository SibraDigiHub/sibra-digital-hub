import { describe, expect, test } from 'bun:test'
import { resolveGatewaySkipZone } from '../core/skip-zone'

describe('resolveGatewaySkipZone', () => {
  test('defaults to Kids when no gateway card was selected', () => {
    expect(resolveGatewaySkipZone(null)).toBe('kids')
  })

  test('keeps the explicitly selected Kids zone', () => {
    expect(resolveGatewaySkipZone('kids')).toBe('kids')
  })

  test('keeps the explicitly selected Creator zone', () => {
    expect(resolveGatewaySkipZone('creator')).toBe('creator')
  })
})
