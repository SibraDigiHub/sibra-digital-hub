// ═══════════════════════════════════════════════════════════
// Layer 2 — verified-purchase review logic (pure rules, no DB):
//   • only a PAID order may carry a review
//   • the public review DTO never leaks orderId/emails
//   • summary math (avg rounding, empty → null)
//   • submit payload validation (Zod) + moderation guard
// Run:  bun test tests/routes/review-logic.test.ts
// ═══════════════════════════════════════════════════════════
import { describe, expect, test } from 'bun:test'

import { isReviewLinkActive, isReviewableStatus, publicReviewDTO, summaryDTO } from '@/services/review-service'
import { reviewModerationSchema, reviewSubmitSchema } from '@/validators/review'
import type { ProductReviewRow } from '@/repositories/product-review-repo'

function row(overrides: Partial<ProductReviewRow> = {}): ProductReviewRow {
  const now = new Date('2026-01-15T10:00:00.000Z')
  return {
    id: 'rev_1',
    orderId: 'order_1',
    productId: 'prod_1',
    name: 'Priya Sharma',
    rating: 5,
    text: 'Loved it!',
    status: 'approved',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('review order-status rule', () => {
  test('only a paid order is reviewable', () => {
    expect(isReviewableStatus('paid')).toBe(true)
    expect(isReviewableStatus('pending')).toBe(false)
    expect(isReviewableStatus('refunded')).toBe(false)
    expect(isReviewableStatus('revoked')).toBe(false)
    expect(isReviewableStatus('failed')).toBe(false)
  })
})

describe('review link 90-day window', () => {
  const DAY = 24 * 60 * 60 * 1000
  const now = new Date('2026-11-01T12:00:00.000Z')
  test('live within 90 days of order creation', () => {
    expect(isReviewLinkActive(new Date(now.getTime() - 1 * DAY), now)).toBe(true)
    expect(isReviewLinkActive(new Date(now.getTime() - 89 * DAY), now)).toBe(true)
    expect(isReviewLinkActive(new Date(now.getTime() - 90 * DAY), now)).toBe(true) // boundary inclusive
  })
  test('expired after 90 days / clock skew', () => {
    expect(isReviewLinkActive(new Date(now.getTime() - 90 * DAY - 1), now)).toBe(false)
    expect(isReviewLinkActive(new Date(now.getTime() - 400 * DAY), now)).toBe(false)
    expect(isReviewLinkActive(new Date(now.getTime() + 1000), now)).toBe(false) // future createdAt
  })
})

describe('public review DTO', () => {
  test('exposes only the safe fields (no orderId, no emails, ISO date)', () => {
    const dto = publicReviewDTO(row())
    expect(Object.keys(dto).sort()).toEqual(['createdAt', 'id', 'name', 'rating', 'text'])
    expect(dto.createdAt).toBe('2026-01-15T10:00:00.000Z')
    expect(JSON.stringify(dto)).not.toContain('order_1')
    expect(JSON.stringify(dto)).not.toContain('@')
  })
})

describe('rating summary math', () => {
  test('avg rounds to one decimal', () => {
    expect(summaryDTO({ _avg: { rating: 4.66666 }, _count: { _all: 3 } })).toEqual({ avg: 4.7, count: 3 })
    expect(summaryDTO({ _avg: { rating: 4 }, _count: { _all: 1 } })).toEqual({ avg: 4, count: 1 })
  })
  test('empty product → null avg, zero count', () => {
    expect(summaryDTO({ _avg: { rating: null }, _count: { _all: 0 } })).toEqual({ avg: null, count: 0 })
  })
})

describe('submit payload validation', () => {
  test('accepts a valid review (name optional)', () => {
    const parsed = reviewSubmitSchema.parse({ token: 'a'.repeat(43), rating: '4', text: '  Great pack  ' })
    expect(parsed.rating).toBe(4)
    expect(parsed.text).toBe('Great pack')
    expect(parsed.name).toBeUndefined()
  })
  test('rejects rating outside 1..5', () => {
    expect(() => reviewSubmitSchema.parse({ token: 'a'.repeat(43), rating: 0 })).toThrow()
    expect(() => reviewSubmitSchema.parse({ token: 'a'.repeat(43), rating: 6 })).toThrow()
  })
  test('rejects missing/short token and over-long text', () => {
    expect(() => reviewSubmitSchema.parse({ rating: 5 })).toThrow()
    expect(() => reviewSubmitSchema.parse({ token: 'short', rating: 5 })).toThrow()
    expect(() => reviewSubmitSchema.parse({ token: 'a'.repeat(43), rating: 5, text: 'x'.repeat(1001) })).toThrow()
  })
})

describe('moderation decision validation', () => {
  test('allows approved/rejected only — never pending via the public-ish path', () => {
    expect(reviewModerationSchema.parse({ status: 'approved' }).status).toBe('approved')
    expect(reviewModerationSchema.parse({ status: 'rejected' }).status).toBe('rejected')
    expect(() => reviewModerationSchema.parse({ status: 'pending' })).toThrow()
  })
})
