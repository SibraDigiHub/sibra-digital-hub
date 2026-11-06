// ═══════════════════════════════════════════════════════════
// #seed-verified-testimonials regression — demo seed reviews
// must NEVER ship as verified:true: the storefront renders a
// "Verified buyer" badge for verified rows, and invented
// placeholder people must not carry an authenticity claim.
// Pure unit test — reads the seed data only, touches no DB.
// ═══════════════════════════════════════════════════════════
import { describe, expect, test } from 'bun:test'
import { SEED_REVIEWS } from '@/lib/seed-data'

describe('seed review hygiene (#seed-verified-testimonials)', () => {
  test('no seeded demo review is marked verified', () => {
    expect(SEED_REVIEWS.length).toBeGreaterThan(0)
    const verifiedOnes = SEED_REVIEWS.filter((r) => r.verified)
    expect(verifiedOnes.map((r) => r.name)).toEqual([])
  })

  test('every seeded review is explicitly unverified (not undefined)', () => {
    for (const r of SEED_REVIEWS) {
      expect(r.verified).toBe(false)
    }
  })
})
