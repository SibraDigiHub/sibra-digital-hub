// GET /api/admin/customers — customer list aggregated from orders
// + activity events (PRD v6.1 §11.6). One profile per email.
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { asHandler, json } from '@/lib/api'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export interface CustomerSummary {
  email: string
  name: string
  totalOrders: number
  paidOrders: number
  lifetimeValueInr: number
  totalDownloads: number
  firstOrderAt: string | null
  lastOrderAt: string | null
  activityEvents: number
}

interface CustomerOrderAggregateRow {
  email: string
  name: string
  totalOrders: number
  paidOrders: number
  lifetimeValueInr: number
  totalDownloads: number
  firstOrderAt: Date | null
  lastOrderAt: Date | null
}

export const GET = asHandler(async (req: NextRequest) => {
  await requireAdmin(req)
  const q = (req.nextUrl.searchParams.get('q') || '').toLowerCase()

  // Aggregate all order metrics in PostgreSQL. DISTINCT ON preserves the
  // original latest-name rule exactly: createdAt DESC, then id ASC.
  // LOWER(email) merges casing variants before totals are calculated.
  const orderGroups = await db.$queryRaw<CustomerOrderAggregateRow[]>(Prisma.sql`
    WITH customer_totals AS (
      SELECT
        LOWER("customerEmail") AS email,
        COUNT(*)::double precision AS "totalOrders",
        (COUNT(*) FILTER (WHERE "status" = 'paid'))::double precision AS "paidOrders",
        COALESCE(SUM("amountInr") FILTER (WHERE "status" = 'paid'), 0::double precision) AS "lifetimeValueInr",
        COALESCE(SUM("downloadCount"), 0)::double precision AS "totalDownloads",
        MAX("createdAt") AS "firstOrderAt",
        MAX("createdAt") AS "lastOrderAt"
      FROM "Order"
      GROUP BY LOWER("customerEmail")
    ), latest_customer AS (
      SELECT DISTINCT ON (LOWER("customerEmail"))
        LOWER("customerEmail") AS email,
        "customerName" AS name
      FROM "Order"
      ORDER BY LOWER("customerEmail"), "createdAt" DESC, "id" ASC
    )
    SELECT
      totals.email,
      latest.name,
      totals."totalOrders",
      totals."paidOrders",
      totals."lifetimeValueInr",
      totals."totalDownloads",
      totals."firstOrderAt",
      totals."lastOrderAt"
    FROM customer_totals AS totals
    INNER JOIN latest_customer AS latest USING (email)
  `)

  const map = new Map<string, CustomerSummary>()
  for (const row of orderGroups) {
    const key = row.email
    map.set(key, {
      email: key,
      name: row.name,
      totalOrders: row.totalOrders,
      paidOrders: row.paidOrders,
      lifetimeValueInr: row.lifetimeValueInr,
      totalDownloads: row.totalDownloads,
      firstOrderAt: row.firstOrderAt?.toISOString() ?? null,
      lastOrderAt: row.lastOrderAt?.toISOString() ?? null,
      activityEvents: 0,
    })
  }

  // Preserve the original activity lookup semantics: only events whose email
  // exactly matches a lowercased customer email are counted.
  const customerEmails = [...map.keys()]
  const eventCounts = customerEmails.length
    ? await db.activityEvent.groupBy({
        by: ['email'],
        _count: { _all: true },
        where: { email: { in: customerEmails } },
      })
    : []

  for (const event of eventCounts) {
    if (!event.email) continue
    const customer = map.get(event.email.toLowerCase())
    if (customer) customer.activityEvents = event._count._all
  }

  let customers = [...map.values()]
  if (q) {
    customers = customers.filter((c) => c.email.includes(q) || c.name.toLowerCase().includes(q))
  }
  customers.sort((a, b) => (b.lastOrderAt ?? '').localeCompare(a.lastOrderAt ?? ''))

  const totalValue = customers.reduce((s, c) => s + c.lifetimeValueInr, 0)
  return json({ customers, count: customers.length, lifetimeValueInr: totalValue })
})
