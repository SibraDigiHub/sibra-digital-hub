// ═══════════════════════════════════════════════════════════
// Contract-fixture data — makes the seeded DB fully DETERMINISTIC
// for the contract runner. Runs on the clean *_contract database
// AFTER `prisma migrate deploy` + `prisma/seed.ts`:
//
//   1. pins Product.spatialCoords (seed randomises them — they are
//      served publicly, so randomness would break golden stability)
//   2. creates the fixture admin (credentials come from env at RUN
//      time — never committed; no 2FA so the runner gets FULL auth)
//   3. creates exactly ONE known order so {firstOrderId} resolves
//      and admin-order-by-id / admin-customers goldens are stable
//
//   DATABASE_URL=… CONTRACT_ADMIN_EMAIL=… CONTRACT_ADMIN_PASSWORD=… \
//     bun tests/contract/fixture-data.ts
// ═══════════════════════════════════════════════════════════
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const FIXTURE_ADMIN_EMAIL = process.env.CONTRACT_ADMIN_EMAIL ?? ''
const FIXTURE_ADMIN_PASSWORD = process.env.CONTRACT_ADMIN_PASSWORD ?? ''
const FIXTURE_ORDER_SLUG = 'viral-video-ingredient-prompts'

if (!FIXTURE_ADMIN_EMAIL || !FIXTURE_ADMIN_PASSWORD) {
  console.error('fixture-data: CONTRACT_ADMIN_EMAIL / CONTRACT_ADMIN_PASSWORD required (runtime-generated, never committed)')
  process.exit(1)
}

// 1. Deterministic coordinates (seed randomises → pin to the origin).
await db.product.updateMany({ data: { spatialCoords: JSON.stringify({ x: 0, y: 0, z: 0 }) } })

// 2. Fixture admin — same hash library as the app's auth (no defaults).
const { hashPassword } = await import('../../src/lib/auth/password')
await db.adminUser.upsert({
  where: { email: FIXTURE_ADMIN_EMAIL },
  update: { passwordHash: await hashPassword(FIXTURE_ADMIN_PASSWORD), name: 'Owner' },
  create: {
    email: FIXTURE_ADMIN_EMAIL,
    name: 'Owner',
    passwordHash: await hashPassword(FIXTURE_ADMIN_PASSWORD),
  },
})

// 3. One known pending order ( Razorpay/INR like the legacy default flow).
const product = await db.product.findUnique({
  where: { slug: FIXTURE_ORDER_SLUG },
  select: { id: true, priceInr: true },
})
if (!product) throw new Error(`fixture-data: product "${FIXTURE_ORDER_SLUG}" missing from seed`)
await db.order.deleteMany({ where: { customerEmail: 'contract-fixture@sibra.local' } })
await db.order.create({
  data: {
    productId: product.id,
    customerName: 'Contract Fixture',
    customerEmail: 'contract-fixture@sibra.local',
    amountInr: product.priceInr,
    amountMinor: product.priceInr * 100,
    status: 'pending',
    gateway: 'razorpay',
    currency: 'INR',
    billingCountry: 'IN',
  },
})

const counts = {
  products: await db.product.count(),
  categories: await db.category.count(),
  reviews: await db.review.count(),
  faqs: await db.faqItem.count(),
  settings: await db.siteSetting.count(),
  admins: await db.adminUser.count(),
  orders: await db.order.count(),
}
console.log(`fixture-data: pinned spatialCoords; admin ready; fixture order on "${FIXTURE_ORDER_SLUG}" @ ₹${product.priceInr}`)
console.log(`fixture-data: ${JSON.stringify(counts)}`)

await db.$disconnect()
