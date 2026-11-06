// GET /api/admin/customers — customer list aggregated from orders
// + activity events (PRD v6.1 §11.6). One profile per email.
import { NextRequest } from 'next/server'
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

export const GET = asHandler(async (req: NextRequest) => {
  await requireAdmin(req)
  const q = (req.nextUrl.searchParams.get('q') || '').toLowerCase()

  const orders = await db.order.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    select: {
      customerEmail: true,
      customerName: true,
      status: true,
      amountInr: true,
      downloadCount: true,
      createdAt: true,
    },
  })

  const eventCounts = await db.activityEvent.groupBy({
    by: ['email'],
    _count: { _all: true },
    where: { email: { not: null } },
  })
  const eventMap = new Map<string, number>()
  for (const e of eventCounts) if (e.email) eventMap.set(e.email, e._count._all)

  const map = new Map<string, CustomerSummary>()
  for (const o of orders) {
    const key = o.customerEmail.toLowerCase()
    const existing = map.get(key)
    const paid = o.status === 'paid'
    if (existing) {
      existing.totalOrders += 1
      if (paid) {
        existing.paidOrders += 1
        existing.lifetimeValueInr += o.amountInr
      }
      existing.totalDownloads += o.downloadCount
    } else {
      map.set(key, {
        email: key,
        name: o.customerName,
        totalOrders: 1,
        paidOrders: paid ? 1 : 0,
        lifetimeValueInr: paid ? o.amountInr : 0,
        totalDownloads: o.downloadCount,
        firstOrderAt: o.createdAt.toISOString(),
        lastOrderAt: o.createdAt.toISOString(),
        activityEvents: eventMap.get(key) ?? 0,
      })
    }
  }

  let customers = [...map.values()]
  if (q) {
    customers = customers.filter((c) => c.email.includes(q) || c.name.toLowerCase().includes(q))
  }
  customers.sort((a, b) => (b.lastOrderAt ?? '').localeCompare(a.lastOrderAt ?? ''))

  const totalValue = customers.reduce((s, c) => s + c.lifetimeValueInr, 0)
  return json({ customers, count: customers.length, lifetimeValueInr: totalValue })
})
