// POST /api/orders/[id]/refund — admin marks an order refunded
// (PRD §11.5). Revokes download access immediately. This is a
// BOOKKEEPING mark only — the actual gateway refund (Razorpay
// dashboard) is issued by the owner there; matching
// refund webhooks then land on the already-refunded order as no-ops.
//
// Audit hardening: paid orders now go through the shared refundOrder()
// service so REVOKE_ON_REFUND, watch-grant revocation, the admin alert
// and audit parity behave exactly like the webhook-driven refund path
// (the legacy inline update bypassed all of those). Revoked orders keep
// their bookkeeping-only transition (refundOrder only claims `paid`).
import { logger } from '@/lib/logger'
import { NextRequest, NextResponse } from 'next/server'
import { asHandler } from '@/lib/api'
import { db } from '@/lib/db'
import { isAdmin, unauthorized } from '@/lib/admin-auth'
import { writeAudit } from '@/lib/audit'
import { refundOrder, publicOrderDTO } from '@/services/order-service'
import { ORDER_PRODUCT_INCLUDE } from '@/repositories/order-repo'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  if (!(await isAdmin())) return unauthorized()
  const { id } = await params
  try {
    const order = await db.order.findUnique({ where: { id } })
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (order.status === 'refunded') {
      const current = await db.order.findUnique({ where: { id }, include: ORDER_PRODUCT_INCLUDE })
      return NextResponse.json({ ok: true, order: current ? publicOrderDTO(current) : null })
    }
    if (order.status !== 'paid' && order.status !== 'revoked') {
      return NextResponse.json({ error: 'Only paid orders can be refunded' }, { status: 400 })
    }

    if (order.status === 'paid') {
      const result = await refundOrder(id, 'admin manual refund')
      if (!result.ok) return NextResponse.json({ error: 'Failed to refund order' }, { status: 409 })
    } else {
      await db.order.updateMany({ where: { id, status: 'revoked' }, data: { status: 'refunded' } })
      await db.watchGrant.updateMany({ where: { orderId: id }, data: { revokedAt: new Date() } }).catch(() => undefined)
      await writeAudit({ action: 'order.refunded', entity: 'order', entityId: id, label: order.customerEmail, diff: { reason: 'admin manual refund (was revoked)', accessRevoked: true }, req })
    }

    const updated = await db.order.findUnique({ where: { id }, include: ORDER_PRODUCT_INCLUDE })
    return NextResponse.json({ ok: true, order: updated ? publicOrderDTO(updated) : null })
  } catch (e) {
    logger.error({ err: e }, 'refund failed')
    return NextResponse.json({ error: 'Failed to refund order' }, { status: 500 })
  }
})
