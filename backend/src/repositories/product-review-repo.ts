// All ProductReview Prisma access lives here. Routes/services never touch `db` directly.
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

export type ProductReviewRow = Prisma.ProductReviewGetPayload<Record<string, never>>

/** Approved-review rows are the only ones that ever reach the public site. */
const APPROVED = 'approved'

export const productReviewRepo = {
  byOrderId(orderId: string) {
    return db.productReview.findUnique({ where: { orderId } })
  },

  byId(id: string) {
    return db.productReview.findUnique({ where: { id } })
  },

  create(data: Prisma.ProductReviewCreateInput) {
    return db.productReview.create({ data })
  },

  updateStatus(id: string, status: string) {
    return db.productReview.update({ where: { id }, data: { status } })
  },

  remove(id: string) {
    return db.productReview.delete({ where: { id } })
  },

  /** Approved reviews for a product, newest first (public detail page). */
  listApproved(productId: string, take = 50) {
    return db.productReview.findMany({
      where: { productId, status: APPROVED },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take,
    })
  },

  /** Avg + count of APPROVED reviews per product — batched for cards.
   *  Without ids: every product that has at least one approved review. */
  summaries(productIds?: string[]) {
    return db.productReview.groupBy({
      by: ['productId'],
      where: {
        status: APPROVED,
        ...(productIds ? { productId: { in: productIds } } : {}),
      },
      _avg: { rating: true },
      _count: { _all: true },
    })
  },

  /** Moderation queue — newest first, optionally filtered by status. */
  listAdmin(status: string | null, take = 200) {
    return db.productReview.findMany({
      where: status && status !== 'all' ? { status } : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take,
    })
  },
}

export type { Prisma }
