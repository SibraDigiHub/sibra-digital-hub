import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  const res = await db.product.updateMany({
    where: { instantDownload: true, deliverableUrl: null },
    data: { deliverableUrl: '/files/sample-deliverable.pdf' },
  })
  console.log(`Updated ${res.count} products with sample deliverable`)
}
main().finally(() => db.$disconnect())
