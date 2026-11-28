// All admin dashboard/analytics Prisma aggregation access.
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

export interface PaidRevenueSummaryRow {
  currency: string
  orderCount: number
  amountMinor: number
  legacyAmountMinor: number
  todayAmountMinor: number
  todayLegacyAmountMinor: number
  last7dAmountMinor: number
  last7dLegacyAmountMinor: number
  last30dAmountMinor: number
  last30dLegacyAmountMinor: number
}

export interface PaidDailyTotalRow {
  date: string
  currency: string
  orders: number
  amountMinor: number
  legacyAmountMinor: number
}

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

  // Keep the dashboard's recent-orders preview bounded; this is not part of
  // the all-time revenue aggregation and preserves the existing response data.
  recentOrders(take = 10) {
    return db.order.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take,
      include: { product: { select: { title: true, slug: true, zone: true, instantDownload: true, deliverableName: true } } },
    })
  },

  /**
   * Aggregate all-time and rolling-window paid revenue in PostgreSQL.
   * The former implementation loaded every paid Order row into the
   * serverless function and summed it in JavaScript on every dashboard
   * request. Keep legacy rows (amountMinor IS NULL) mathematically
   * equivalent to the previous per-row Math.round(amountInr * 100).
   */
  paidRevenueSummary(today: Date, last7d: Date, last30d: Date) {
    return db.$queryRaw<PaidRevenueSummaryRow[]>(Prisma.sql`
      SELECT
        "currency",
        COUNT(*)::int AS "orderCount",
        COALESCE(SUM(CASE WHEN "amountMinor" IS NOT NULL THEN "amountMinor"::double precision ELSE 0::double precision END), 0::double precision) AS "amountMinor",
        COALESCE(SUM(CASE WHEN "amountMinor" IS NULL THEN ROUND("amountInr" * 100)::double precision ELSE 0::double precision END), 0::double precision) AS "legacyAmountMinor",
        COALESCE(SUM(CASE WHEN "createdAt" >= ${today} AND "amountMinor" IS NOT NULL THEN "amountMinor"::double precision ELSE 0::double precision END), 0::double precision) AS "todayAmountMinor",
        COALESCE(SUM(CASE WHEN "createdAt" >= ${today} AND "amountMinor" IS NULL THEN ROUND("amountInr" * 100)::double precision ELSE 0::double precision END), 0::double precision) AS "todayLegacyAmountMinor",
        COALESCE(SUM(CASE WHEN "createdAt" >= ${last7d} AND "amountMinor" IS NOT NULL THEN "amountMinor"::double precision ELSE 0::double precision END), 0::double precision) AS "last7dAmountMinor",
        COALESCE(SUM(CASE WHEN "createdAt" >= ${last7d} AND "amountMinor" IS NULL THEN ROUND("amountInr" * 100)::double precision ELSE 0::double precision END), 0::double precision) AS "last7dLegacyAmountMinor",
        COALESCE(SUM(CASE WHEN "createdAt" >= ${last30d} AND "amountMinor" IS NOT NULL THEN "amountMinor"::double precision ELSE 0::double precision END), 0::double precision) AS "last30dAmountMinor",
        COALESCE(SUM(CASE WHEN "createdAt" >= ${last30d} AND "amountMinor" IS NULL THEN ROUND("amountInr" * 100)::double precision ELSE 0::double precision END), 0::double precision) AS "last30dLegacyAmountMinor"
      FROM "Order"
      WHERE "status" = 'paid'
      GROUP BY "currency"
    `)
  },

  /** Daily, currency-aware paid-order aggregates for the analytics chart. */
  paidDailyTotals(since: Date) {
    return db.$queryRaw<PaidDailyTotalRow[]>(Prisma.sql`
      SELECT
        TO_CHAR("createdAt"::date, 'YYYY-MM-DD') AS "date",
        "currency",
        COUNT(*)::int AS "orders",
        COALESCE(SUM(CASE WHEN "amountMinor" IS NOT NULL THEN "amountMinor"::double precision ELSE 0::double precision END), 0::double precision) AS "amountMinor",
        COALESCE(SUM(CASE WHEN "amountMinor" IS NULL THEN ROUND("amountInr" * 100)::double precision ELSE 0::double precision END), 0::double precision) AS "legacyAmountMinor"
      FROM "Order"
      WHERE "status" = 'paid' AND "createdAt" >= ${since}
      GROUP BY "createdAt"::date, "currency"
      ORDER BY "createdAt"::date ASC, "currency" ASC
    `)
  },

  customerCount() {
    return db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(DISTINCT LOWER("customerEmail"))::int AS "count"
      FROM "Order"
    `).then((rows) => rows[0]?.count ?? 0)
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

  uniqueVisitorCount(since: Date) {
    return db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(DISTINCT "visitorId")::int AS "count"
      FROM "ActivityEvent"
      WHERE "createdAt" >= ${since} AND "visitorId" IS NOT NULL
    `).then((rows) => rows[0]?.count ?? 0)
  },

  eventCountsByProduct(type: string | string[], since: Date) {
    return db.activityEvent.groupBy({
      by: ['productId'],
      _count: { _all: true },
      where: { type: { in: Array.isArray(type) ? type : [type] }, createdAt: { gte: since }, productId: { not: null } },
    })
  },
}
