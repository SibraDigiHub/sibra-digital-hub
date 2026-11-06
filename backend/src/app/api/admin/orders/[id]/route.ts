// GET /api/admin/orders/[id] — order detail + its activity timeline
// (PRD v6.1 §11.5: created → paid → emailed → each download).
import { NextRequest } from 'next/server'
import { asHandler, json, notFound } from '@/lib/api'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  await requireAdmin(_req)
  const { id } = await params

  const order = await db.order.findUnique({
    where: { id },
    include: { product: { select: { title: true, slug: true, zone: true, instantDownload: true, deliverableName: true, deliveryMode: true } } },
  })
  if (!order) throw notFound('Order not found')

  const events = await db.activityEvent.findMany({
    where: { OR: [{ orderId: id }, ...(order.visitorId ? [{ visitorId: order.visitorId }] : [])] },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: 80,
  })

  return json({ order, events })
})
