// GET    /api/admin/customers/[email] — profile: orders + activity timeline
// DELETE /api/admin/customers/[email] — DPDP erasure: anonymise PII, keep
//        accounting rows, drop the customer's tracked events (audited).
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { asHandler, json, notFound } from '@/lib/api'
import { db } from '@/lib/db'
import { logger } from '@/lib/logger'
import { requireAdmin } from '@/lib/auth/session'
import { writeAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (_req: NextRequest, { params }: { params: Promise<{ email: string }> }) => {
  await requireAdmin(_req)
  const { email: raw } = await params
  const email = decodeURIComponent(raw).toLowerCase()

  const orders = await db.order.findMany({
    where: { customerEmail: email },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    include: { product: { select: { title: true, slug: true, zone: true, instantDownload: true, deliverableName: true } } },
  })
  if (orders.length === 0) throw notFound('Customer not found')

  // Timeline = events tied to the email OR to any visitor id captured at checkout
  const visitorIds = [...new Set(orders.map((o) => o.visitorId).filter((v): v is string => Boolean(v)))]
  const events = await db.activityEvent.findMany({
    where: { OR: [{ email }, ...(visitorIds.length ? [{ visitorId: { in: visitorIds } }] : [])] },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: 120,
  })

  const paid = orders.filter((o) => o.status === 'paid')
  return json({
    email,
    name: orders[0]?.customerName ?? '',
    orders,
    events,
    stats: {
      totalOrders: orders.length,
      paidOrders: paid.length,
      lifetimeValueInr: paid.reduce((s, o) => s + o.amountInr, 0),
      totalDownloads: orders.reduce((s, o) => s + o.downloadCount, 0),
      firstOrderAt: orders[orders.length - 1]?.createdAt ?? null,
      lastOrderAt: orders[0]?.createdAt ?? null,
    },
  })
})

export const DELETE = asHandler(async (req: NextRequest, { params }: { params: Promise<{ email: string }> }) => {
  await requireAdmin(req)
  const { email: raw } = await params
  const email = decodeURIComponent(raw).toLowerCase()

  try {
    const orders = await db.order.findMany({ where: { customerEmail: email }, select: { id: true, visitorId: true } })
    const visitorIds = [...new Set(orders.map((o) => o.visitorId).filter((v): v is string => Boolean(v)))]

    // 1) Erase the customer's tracked activity
    const events = await db.activityEvent.deleteMany({
      where: { OR: [{ email }, ...(visitorIds.length ? [{ visitorId: { in: visitorIds } }] : [])] },
    })

    // 2) Anonymise the order rows (accounting stays, PII gone)
    const tombstone = `deleted+${crypto.randomBytes(6).toString('hex')}@anonymised.local`
    const updated = await db.order.updateMany({
      where: { customerEmail: email },
      data: { customerEmail: tombstone, customerName: 'Deleted User (DPDP erasure)' },
    })

    await writeAudit({
      action: 'customer.erasure',
      entity: 'customer',
      entityId: email,
      label: email,
      diff: { ordersAnonymised: updated.count, eventsDeleted: events.count },
      req,
    })

    return json({ ok: true, ordersAnonymised: updated.count, eventsDeleted: events.count })
  } catch (e) {
    logger.error({ err: e }, 'customer erasure failed')
    return NextResponse.json({ error: 'Failed to erase customer data' }, { status: 500 })
  }
})
