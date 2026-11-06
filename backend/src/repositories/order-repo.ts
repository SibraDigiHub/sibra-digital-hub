// All Order Prisma access lives here.
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

export const ORDER_PRODUCT_INCLUDE = {
  product: {
    select: {
      title: true,
      slug: true,
      zone: true,
      instantDownload: true,
      deliverableName: true,
      // T-V: watch-mode delivery needs the product's video-delivery fields
      // at fulfillment time. Never exposed publicly — DTOs decide the shape.
      deliveryMode: true,
      fullVideoUrl: true,
      watchTtlHours: true,
      watchMaxConcurrent: true,
    },
  },
} satisfies Prisma.OrderInclude

export type OrderWithProduct = Prisma.OrderGetPayload<{ include: typeof ORDER_PRODUCT_INCLUDE }>

export const orderRepo = {
  adminList(q: string) {
    return db.order.findMany({
      where: q
        ? {
            OR: [
              { customerEmail: { contains: q, mode: 'insensitive' } },
              { customerName: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 200,
      include: ORDER_PRODUCT_INCLUDE,
    })
  },

  countPendingByEmail(email: string) {
    return db.order.count({ where: { customerEmail: email, status: 'pending' } })
  },

  create(data: Prisma.OrderUncheckedCreateInput) {
    return db.order.create({ data, include: ORDER_PRODUCT_INCLUDE })
  },

  byId(id: string) {
    return db.order.findUnique({ where: { id }, include: ORDER_PRODUCT_INCLUDE })
  },

  attachPaymentLink(id: string, paymentLinkId: string) {
    return db.order.update({ where: { id }, data: { razorpayPaymentLinkId: paymentLinkId } })
  },

  countByProduct(productId: string) {
    return db.order.count({ where: { productId } })
  },
}
