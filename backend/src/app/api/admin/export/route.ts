// GET /api/admin/export?type=products|orders|customers|audit|all
// One-click JSON backup (PRD v6.1 §11.10). Secrets never exported:
// download-token hashes and internal ids are stripped from orders.
import { NextRequest, NextResponse } from 'next/server'
import { asHandler } from '@/lib/api'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  await requireAdmin(req)
  const type = req.nextUrl.searchParams.get('type') || 'all'

  const wants = (t: string) => type === 'all' || type === t
  const payload: Record<string, unknown> = { exportedAt: new Date().toISOString(), type }

  if (wants('products')) {
    payload.products = await db.product.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] })
  }
  if (wants('orders')) {
    const orders = await db.order.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] })
    // Security: strip private token material from any export
    payload.orders = orders.map(({ downloadTokenHash: _drop, ...o }) => {
      void _drop
      return o
    })
  }
  if (wants('customers')) {
    const orders = await db.order.findMany({
      select: { customerEmail: true, customerName: true, status: true, amountInr: true, downloadCount: true, createdAt: true },
    })
    const map = new Map<string, { email: string; name: string; orders: number; paid: number; lifetimeValueInr: number; downloads: number; firstOrderAt: Date; lastOrderAt: Date }>()
    for (const o of orders) {
      const key = o.customerEmail.toLowerCase()
      const ex = map.get(key)
      if (ex) {
        ex.orders += 1
        if (o.status === 'paid') {
          ex.paid += 1
          ex.lifetimeValueInr += o.amountInr
        }
        ex.downloads += o.downloadCount
        if (o.createdAt > ex.lastOrderAt) ex.lastOrderAt = o.createdAt
      } else {
        map.set(key, {
          email: key,
          name: o.customerName,
          orders: 1,
          paid: o.status === 'paid' ? 1 : 0,
          lifetimeValueInr: o.status === 'paid' ? o.amountInr : 0,
          downloads: o.downloadCount,
          firstOrderAt: o.createdAt,
          lastOrderAt: o.createdAt,
        })
      }
    }
    payload.customers = [...map.values()].sort((a, b) => b.lastOrderAt.getTime() - a.lastOrderAt.getTime())
  }
  if (wants('audit')) {
    payload.audit = await db.auditLog.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 1000 })
  }
  if (wants('settings')) {
    payload.settings = await db.siteSetting.findMany()
  }

  const stamp = new Date().toISOString().slice(0, 10)
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="sdh-export-${type}-${stamp}.json"`,
    },
  })
})
