// All Product Prisma access lives here. Routes/services never touch `db` directly.
import { Prisma, PrismaClient } from '@prisma/client'
import { db } from '@/lib/db'

export type ProductRow = Prisma.ProductGetPayload<Record<string, never>>

export type ProductListArgs = {
  where: Prisma.ProductWhereInput
  orderBy: Prisma.ProductOrderByWithRelationInput[]
  take: number
}

export const productRepo = {
  findBySlug(slug: string, status?: 'published') {
    return db.product.findFirst({ where: status ? { slug, status } : { slug } })
  },

  list({ where, orderBy, take }: ProductListArgs) {
    return db.product.findMany({ where, orderBy, take })
  },

  async slugExists(slug: string) {
    const found = await db.product.findUnique({ where: { slug }, select: { id: true } })
    return found !== null
  },

  create(data: Prisma.ProductCreateInput) {
    return db.product.create({ data })
  },

  byId(id: string) {
    return db.product.findUnique({ where: { id } })
  },

  update(id: string, data: Prisma.ProductUpdateInput) {
    return db.product.update({ where: { id }, data })
  },

  remove(id: string) {
    return db.product.delete({ where: { id } })
  },

  countByStatus() {
    return db.product.groupBy({ by: ['status', 'zone'], _count: { _all: true } })
  },

  countInstant() {
    return db.product.count({ where: { instantDownload: true } })
  },
}

export type { PrismaClient }
