// Dashboard KPIs + analytics aggregates. Pure rules over analyticsRepo data.
import { analyticsRepo, type PaidDailyTotalRow, type PaidRevenueSummaryRow } from '@/repositories/analytics-repo'
import { logger } from '@/lib/logger'
import { currencyExponentFactor } from '@/lib/money'

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000)

function amountFromMinorParts(
  amountMinor: number | null | undefined,
  legacyAmountMinor: number | null | undefined,
  currency: string,
): number {
  const factor = currencyExponentFactor(currency) ?? 100
  return ((amountMinor ?? 0) + (legacyAmountMinor ?? 0)) / factor
}

function currencySummary(rows: PaidRevenueSummaryRow[]) {
  return new Map(rows.map((row) => [row.currency || 'INR', row]))
}

function dailyPaidOrderCount(rows: PaidDailyTotalRow[]): number {
  return rows.reduce((sum, row) => sum + row.orders, 0)
}

export async function dashboardStats() {
  const today = startOfToday()
  const sevenDays = daysAgo(7)
  const thirtyDays = daysAgo(30)

  // Run independent query groups concurrently. Previously product counts,
  // order counts and revenue reads were awaited in separate stages.
  const [productCounts, orderCounts, revenueRows, recentOrders, customers, failedEmailCount, views24h] =
    await Promise.all([
      analyticsRepo.productCounts(),
      analyticsRepo.orderCounts(),
      analyticsRepo.paidRevenueSummary(today, sevenDays, thirtyDays),
      analyticsRepo.recentOrders(),
      analyticsRepo.customerCount(),
      analyticsRepo.failedEmailCount(),
      analyticsRepo.views24h(),
    ])

  const [kidsCount, creatorCount, publishedCount, draftCount, archivedCount, instantCount] = productCounts
  const [orderCount, pendingCount, paidOrdersAll] = orderCounts
  const revenue = currencySummary(revenueRows)
  const inr = revenue.get('INR')
  const usd = revenue.get('USD')

  const paidRevenueInr = amountFromMinorParts(inr?.amountMinor, inr?.legacyAmountMinor, 'INR')
  const revenueByCurrency = revenueRows.map((row) => ({
    currency: row.currency || 'INR',
    amount: amountFromMinorParts(row.amountMinor, row.legacyAmountMinor, row.currency || 'INR'),
  }))

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
    customerCount: customers,
    paidRevenueInr,
    revenueToday: amountFromMinorParts(inr?.todayAmountMinor, inr?.todayLegacyAmountMinor, 'INR'),
    revenue7d: amountFromMinorParts(inr?.last7dAmountMinor, inr?.last7dLegacyAmountMinor, 'INR'),
    revenue30d: amountFromMinorParts(inr?.last30dAmountMinor, inr?.last30dLegacyAmountMinor, 'INR'),
    // USD KPIs remain in minor units, as before. Legacy rows without
    // amountMinor continue to count as orders but do not enter this KPI.
    revenueUsdMinor: usd?.amountMinor ?? 0,
    revenueUsdTodayMinor: usd?.todayAmountMinor ?? 0,
    revenueUsd30dMinor: usd?.last30dAmountMinor ?? 0,
    usdPaidOrderCount: usd?.orderCount ?? 0,
    averageOrderValueInr: inr?.orderCount
      ? Math.round((paidRevenueInr / inr.orderCount) * 100) / 100
      : 0,
    failedEmailCount,
    views24h,
    alerts,
    recentOrders,
  }
}

export async function analyticsWindow(days: number) {
  const since = daysAgo(days)
  const [typeCounts, paidDaily, paidRevenueRows, platformCounts, deviceCounts, countryCounts, recentEvents, products, orderProductCounts, uniqueVisitors] =
    await Promise.all([
      analyticsRepo.eventTypeCounts(since),
      analyticsRepo.paidDailyTotals(since),
      analyticsRepo.paidRevenueSummary(startOfToday(), daysAgo(7), daysAgo(30)),
      analyticsRepo.platformClickCounts(since),
      analyticsRepo.deviceCounts(since),
      analyticsRepo.countryCounts(since),
      analyticsRepo.recentEvents(),
      analyticsRepo.productBasics(),
      analyticsRepo.paidCountsByProduct(since),
      analyticsRepo.uniqueVisitorCount(since),
    ])

  const byType = (t: string) => typeCounts.find((c) => c.type === t)?._count._all ?? 0
  const productViews = byType('product_view')
  const buyClicks = byType('buy_click') + byType('platform_click')
  const checkoutStarts = byType('checkout_started')
  const paidCount = dailyPaidOrderCount(paidDaily)
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

  // Revenue series is aggregated in SQL by UTC day and currency, rather
  // than transferring every paid order in the selected window.
  const series: { date: string; revenue: number; orders: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    series.push({ date: daysAgo(i).toISOString().slice(0, 10), revenue: 0, orders: 0 })
  }
  const seriesIndex = new Map(series.map((s) => [s.date, s]))
  for (const paid of paidDaily) {
    const row = seriesIndex.get(paid.date)
    if (!row) continue
    row.orders += paid.orders
    if (paid.currency === 'INR') {
      row.revenue += (paid.amountMinor + paid.legacyAmountMinor) / 100
    }
  }

  const revenue = currencySummary(paidRevenueRows)
  const inr = revenue.get('INR')
  const revenueByCurrency = paidRevenueRows.map((row) => ({
    currency: row.currency || 'INR',
    amount: amountFromMinorParts(row.amountMinor, row.legacyAmountMinor, row.currency || 'INR'),
  }))

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
      today: amountFromMinorParts(inr?.todayAmountMinor, inr?.todayLegacyAmountMinor, 'INR'),
      last7d: amountFromMinorParts(inr?.last7dAmountMinor, inr?.last7dLegacyAmountMinor, 'INR'),
      last30d: amountFromMinorParts(inr?.last30dAmountMinor, inr?.last30dLegacyAmountMinor, 'INR'),
      total: amountFromMinorParts(inr?.amountMinor, inr?.legacyAmountMinor, 'INR'),
      byCurrency: revenueByCurrency,
      series,
    },
    uniqueVisitors,
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
