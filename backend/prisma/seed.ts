// ═══════════════════════════════════════════════════════════
// Seed runner — bun prisma/seed.ts
//
// PRODUCTION-SAFE DEFAULT (no env needed):
//   • the 12 built-in categories — upserted on EVERY run
//     (create-only: admin edits are never overwritten);
//   • default SiteSettings — upserted on EVERY run, also
//     create-only (missing keys get filled, existing keys —
//     including admin-edited values — are left untouched).
//
// DEMO CONTENT ONLY WITH SEED_DEMO=true:
//   SEED_DEMO=true bun prisma/seed.ts
//   additionally seeds the 24 demo products, 8 reviews and
//   8 FAQs — and only into EMPTY tables (a DB that already has
//   products/reviews/FAQs is never touched, so re-runs stay
//   idempotent and admin deletions are not resurrected).
//
// A fresh production `migrate deploy` + `seed` therefore yields
// a store with real categories/settings and a zeroed catalog —
// the owner adds their own products from the Admin Panel.
// ═══════════════════════════════════════════════════════════
import { PrismaClient } from '@prisma/client'
import { SEED_CATEGORIES, SEED_PRODUCTS, SEED_REVIEWS, SEED_FAQS, DEFAULT_SETTINGS } from '../src/lib/seed-data'

const db = new PrismaClient()
const SEED_DEMO = process.env.SEED_DEMO === 'true'

async function randomCoords() {
  const r = () => Math.round((Math.random() * 6 - 3) * 100) / 100
  return { x: r(), y: r(), z: r() }
}

async function main() {
  // Built-in categories — upsert on every run (create-only: admin edits win).
  for (const c of SEED_CATEGORIES) {
    const { zone, slug, label, emoji, blurb, sortOrder } = c
    await db.category.upsert({
      where: { slug },
      update: {}, // admin-edited values win — seeding never overwrites
      create: { zone, slug, label, emoji, blurb, sortOrder },
    })
  }

  // Default settings — upsert on every run (create-only: an existing key,
  // including any admin-edited value, is never overwritten).
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.siteSetting.upsert({ where: { key }, update: {}, create: { key, value } })
  }

  if (!SEED_DEMO) {
    const [products, reviews, faqs] = await Promise.all([db.product.count(), db.review.count(), db.faqItem.count()])
    console.log(
      `✅ Production-safe seed complete: ${SEED_CATEGORIES.length} categories ensured, settings ensured. ` +
        `Demo content skipped (SEED_DEMO not set) — tables: ${products} products, ${reviews} reviews, ${faqs} FAQs.`,
    )
    return
  }

  // ── Demo content (SEED_DEMO=true) — empty tables only. ──
  if ((await db.product.count()) === 0) {
    for (const p of SEED_PRODUCTS) {
      const { whatsInside, images, platformLinks, tags, fileFormats, spatialCoords, ...rest } = p
      await db.product.create({
        data: {
          ...rest,
          whatsInside: JSON.stringify(whatsInside),
          images: JSON.stringify(images),
          platformLinks: JSON.stringify(platformLinks),
          tags: JSON.stringify(tags),
          fileFormats: JSON.stringify(fileFormats),
          spatialCoords: JSON.stringify(spatialCoords ?? (await randomCoords())),
        },
      })
    }
    console.log(`🌱 Seeded ${SEED_PRODUCTS.length} demo products.`)
  }

  if ((await db.review.count()) === 0) {
    for (const r of SEED_REVIEWS) {
      await db.review.create({ data: r })
    }
    console.log(`🌱 Seeded ${SEED_REVIEWS.length} demo reviews.`)
  }

  if ((await db.faqItem.count()) === 0) {
    for (const f of SEED_FAQS) {
      await db.faqItem.create({ data: f })
    }
    console.log(`🌱 Seeded ${SEED_FAQS.length} demo FAQs.`)
  }

  console.log(`✅ SEED_DEMO seed complete: ${SEED_CATEGORIES.length} categories + settings ensured, demo products/reviews/FAQs ensured.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
