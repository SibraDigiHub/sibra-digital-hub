// All admin dashboard/analytics Prisma aggregation access.
import { db } from '@/lib/db'

export const analyticsRepo = {
  productCounts() {
    return Promise.all([
      db.product.count({ where: { zone: 'kids' } }),
      db.product.count({ where: { zone: 'creator' } }),
      db.product.count({ where: { status: 'published' } }),
      db.product.count({ where: { status: 'draft' } }),
      db.product.count({ where: { status: 'archived' } }),
      db.product.count({ where: { instantDownload: true } }),
    ])
  },

  orderCounts() {
    return Promise.all([db.order.count(), db.order.count({ where: { status: 'pending' } }), db.order.count({ where: { status: 'paid' } })])
  },

  paidAmounts() {
    // currency/amountMinor join the row so USD revenue is grouped, never mixed into INR sums.
    return db.order.findMany({ where: { status: 'paid' }, select: { amountInr: true, currency: true, amountMinor: true, createdAt: true } })
  },

  recentOrders(take = 10) {
    return db.order.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take,
      include: { product: { select: { title: true, slug: true, zone: true, instantDownload: true, deliverableName: true } } },
    })
  },

  customerCount() {
    return db.order.groupBy({ by: ['customerEmail'] })
  },

  failedEmailCount() {
    return db.order.count({ where: { status: 'paid', emailSent: false } })
  },

  views24h() {
    return db.activityEvent.count({ where: { type: 'product_view', createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } })
  },

  eventTypeCounts(since: Date) {
    return db.activityEvent.groupBy({ by: ['type'], _count: { _all: true }, where: { createdAt: { gte: since } } })
  },

  paidOrdersWindow(since: Date) {
    return db.order.findMany({
      where: { status: 'paid', createdAt: { gte: since } },
      select: { amountInr: true, createdAt: true, productId: true },
    })
  },

  platformClickCounts(since: Date) {
    return db.activityEvent.groupBy({
      by: ['platform'],
      _count: { _all: true },
      where: { type: 'platform_click', createdAt: { gte: since }, platform: { not: null } },
    })
  },

  deviceCounts(since: Date) {
    return db.activityEvent.groupBy({ by: ['device'], _count: { _all: true }, where: { createdAt: { gte: since } } })
  },

  countryCounts(since: Date) {
    return db.activityEvent.groupBy({
      by: ['country'],
      _count: { _all: true },
      where: { createdAt: { gte: since }, country: { not: null } },
    })
  },

  recentEvents(take = 60) {
    return db.activityEvent.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take })
  },

  productBasics() {
    return db.product.findMany({ select: { id: true, title: true, slug: true, zone: true } })
  },

  paidCountsByProduct(since: Date) {
    return db.order.groupBy({ by: ['productId'], _count: { _all: true }, where: { status: 'paid', createdAt: { gte: since } } })
  },

  uniqueVisitors(since: Date) {
    return db.activityEvent.groupBy({
      by: ['visitorId'],
      _count: { _all: true },
      where: { createdAt: { gte: since }, visitorId: { not: null } },
    })
  },

  eventCountsByProduct(type: string | string[], since: Date) {
    return db.activityEvent.groupBy({
      by: ['productId'],
      _count: { _all: true },
      where: { type: { in: Array.isArray(type) ? type : [type] }, createdAt: { gte: since }, productId: { not: null } },
    })
  },
}
