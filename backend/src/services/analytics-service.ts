// Dashboard KPIs + analytics aggregates. Pure rules over analyticsRepo data.
import { analyticsRepo } from '@/repositories/analytics-repo'
import { logger } from '@/lib/logger'

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000)

export async function dashboardStats() {
  const [kidsCount, creatorCount, publishedCount, draftCount, archivedCount, instantCount] =
    await analyticsRepo.productCounts()
  const [orderCount, pendingCount, paidOrdersAll] = await analyticsRepo.orderCounts()
  const [paidAll, recentOrders, customers, failedEmailCount, views24h] = await Promise.all([
    analyticsRepo.paidAmounts(),
    analyticsRepo.recentOrders(),
    analyticsRepo.customerCount(),
    analyticsRepo.failedEmailCount(),
    analyticsRepo.views24h(),
  ])

  const paidRevenueInr = paidAll.reduce((s, o) => s + o.amountInr, 0)
  const sumSince = (since: Date) => paidAll.filter((o) => o.createdAt >= since).reduce((s, o) => s + o.amountInr, 0)
  // §9: money is summed PER CURRENCY — USD sums use amountMinor only.
  const usdPaid = paidAll.filter((o) => o.currency === 'USD')
  const usdSumSince = (since: Date) =>
    usdPaid.filter((o) => o.createdAt >= since).reduce((s, o) => s + (o.amountMinor ?? 0), 0)

  const alerts: string[] = []
  if (failedEmailCount > 0) alerts.push(`${failedEmailCount} paid order(s) missing delivery email — check Orders → resend.`)
  if (pendingCount > 0) alerts.push(`${pendingCount} pending checkout(s) awaiting payment.`)
  if (archivedCount > 0) alerts.push(`${archivedCount} product(s) in Trash.`)

  return {
    kidsCount,
    creatorCount,
    publishedCount,
    draftCount,
    archivedCount,
    instantCount,
    orderCount,
    paidOrderCount: paidOrdersAll,
    pendingCount,
    customerCount: customers.length,
    paidRevenueInr,
    revenueToday: sumSince(startOfToday()),
    revenue7d: sumSince(daysAgo(7)),
    revenue30d: sumSince(daysAgo(30)),
    // Dual payment: USD KPIs (grouped by currency — never added to INR).
    revenueUsdMinor: usdPaid.reduce((s, o) => s + (o.amountMinor ?? 0), 0),
    revenueUsdTodayMinor: usdSumSince(startOfToday()),
    revenueUsd30dMinor: usdSumSince(daysAgo(30)),
    usdPaidOrderCount: usdPaid.length,
    averageOrderValueInr: paidOrdersAll > 0 ? Math.round((paidRevenueInr / paidOrdersAll) * 100) / 100 : 0,
    failedEmailCount,
    views24h,
    alerts,
    recentOrders,
  }
}

export async function analyticsWindow(days: number) {
  const since = daysAgo(days)
  const [typeCounts, paidOrdersWindow, paidOrdersAll, platformCounts, deviceCounts, countryCounts, recentEvents, products, orderProductCounts, uniqueVisitors] =
    await Promise.all([
      analyticsRepo.eventTypeCounts(since),
      analyticsRepo.paidOrdersWindow(since),
      analyticsRepo.paidAmounts(),
      analyticsRepo.platformClickCounts(since),
      analyticsRepo.deviceCounts(since),
      analyticsRepo.countryCounts(since),
      analyticsRepo.recentEvents(),
      analyticsRepo.productBasics(),
      analyticsRepo.paidCountsByProduct(since),
      analyticsRepo.uniqueVisitors(since),
    ])

  const byType = (t: string) => typeCounts.find((c) => c.type === t)?._count._all ?? 0
  const productViews = byType('product_view')
  const buyClicks = byType('buy_click') + byType('platform_click')
  const checkoutStarts = byType('checkout_started')
  const paidCount = paidOrdersWindow.length
  const downloads = byType('download')

  const [viewCounts, clickCounts] = await Promise.all([
    analyticsRepo.eventCountsByProduct('product_view', since),
    analyticsRepo.eventCountsByProduct(['buy_click', 'platform_click'], since),
  ])

  const titleOf = new Map(products.map((p) => [p.id, p]))
  const productIds = new Set<string>([
    ...viewCounts.map((v) => v.productId!).filter(Boolean),
    ...clickCounts.map((v) => v.productId!).filter(Boolean),
    ...orderProductCounts.map((o) => o.productId),
  ])
  const topProducts = [...productIds]
    .map((id) => {
      const meta = titleOf.get(id)
      return {
        id,
        title: meta?.title ?? 'Unknown product',
        slug: meta?.slug ?? '',
        zone: meta?.zone ?? '',
        views: viewCounts.find((v) => v.productId === id)?._count._all ?? 0,
        clicks: clickCounts.find((c) => c.productId === id)?._count._all ?? 0,
        paidOrders: orderProductCounts.find((o) => o.productId === id)?._count._all ?? 0,
      }
    })
    .sort((a, b) => b.views + b.clicks * 3 + b.paidOrders * 10 - (a.views + a.clicks * 3 + a.paidOrders * 10))
    .slice(0, 8)

  // Revenue series (per day, window)
  const series: { date: string; revenue: number; orders: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    series.push({ date: daysAgo(i).toISOString().slice(0, 10), revenue: 0, orders: 0 })
  }
  const seriesIndex = new Map(series.map((s) => [s.date, s]))
  for (const o of paidOrdersWindow) {
    const row = seriesIndex.get(o.createdAt.toISOString().slice(0, 10))
    if (row) {
      row.revenue += o.amountInr
      row.orders += 1
    }
  }

  const sumSince = (sinceDate: Date) => paidOrdersAll.filter((o) => o.createdAt >= sinceDate).reduce((s, o) => s + o.amountInr, 0)

  logger.debug({ days, funnelViews: productViews }, 'analytics computed')

  return {
    windowDays: days,
    funnel: {
      productViews,
      buyClicks,
      checkoutStarts,
      paidOrders: paidCount,
      downloads,
      conversionPct: productViews > 0 ? Math.round((paidCount / productViews) * 1000) / 10 : 0,
    },
    revenue: {
      today: sumSince(startOfToday()),
      last7d: sumSince(daysAgo(7)),
      last30d: sumSince(daysAgo(30)),
      total: paidOrdersAll.reduce((s, o) => s + o.amountInr, 0),
      series,
    },
    uniqueVisitors: uniqueVisitors.length,
    topProducts,
    platformShare: platformCounts
      .map((p) => ({ platform: p.platform ?? 'unknown', clicks: p._count._all }))
      .sort((a, b) => b.clicks - a.clicks),
    deviceSplit: deviceCounts
      .map((d) => ({ device: d.device ?? 'unknown', count: d._count._all }))
      .sort((a, b) => b.count - a.count),
    countries: countryCounts
      .map((c) => ({ country: c.country ?? 'unknown', count: c._count._all }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    recentEvents,
  }
}
