// PATCH /api/orders/[id]/token — admin revoke or extend (+72h) the download token.
// Audit hardening: the old "extend" resurrected a revoked order straight to
// `paid` with no gateway verification — the only path to PAID without a
// verified gateway result. Extend now only moves the expiry of a genuinely
// paid order (a revoked order has NO token hash left, so there is nothing
// to extend; Resend mints a fresh token instead). Revoke also revokes the
// watch entitlement, mirroring refund/dispute semantics. Responses carry
// the public DTO only — the download-token hash never leaves the server.
import { logger } from '@/lib/logger'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { asHandler } from '@/lib/api'
import { db } from '@/lib/db'
import { isAdmin, unauthorized } from '@/lib/admin-auth'
import { writeAudit } from '@/lib/audit'
import { publicOrderDTO } from '@/services/order-service'
import { ORDER_PRODUCT_INCLUDE } from '@/repositories/order-repo'

export const dynamic = 'force-dynamic'

const tokenPatchSchema = z.object({ action: z.enum(['revoke', 'extend']) }).strict()

export const PATCH = asHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  if (!(await isAdmin())) return unauthorized()
  const { id } = await params
  try {
    const parsed = tokenPatchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'action must be revoke | extend' }, { status: 400 })
    }
    const action = parsed.data.action
    const order = await db.order.findUnique({ where: { id } })
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    if (action === 'revoke') {
      await db.order.update({
        where: { id },
        data: { status: 'revoked', downloadTokenHash: null, tokenExpiresAt: null },
      })
      // Access revocation must cover watch entitlements too — a revoked
      // watch-mode buyer previously kept full watch access.
      await db.watchGrant.updateMany({ where: { orderId: id }, data: { revokedAt: new Date() } }).catch(() => undefined)
      await writeAudit({ action: 'order.revoke', entity: 'order', entityId: id, label: order.customerEmail, req })
    } else {
      if (order.status !== 'paid' || !order.downloadTokenHash) {
        return NextResponse.json(
          { error: 'Only paid orders with an active token can be extended — use Resend instead' },
          { status: 409 },
        )
      }
      const base = order.tokenExpiresAt && order.tokenExpiresAt > new Date() ? order.tokenExpiresAt : new Date()
      await db.order.update({
        where: { id },
        data: { tokenExpiresAt: new Date(base.getTime() + 72 * 3600 * 1000) },
      })
      await writeAudit({ action: 'order.extend', entity: 'order', entityId: id, label: order.customerEmail, diff: { hours: 72 }, req })
    }

    const updated = await db.order.findUnique({ where: { id }, include: ORDER_PRODUCT_INCLUDE })
    return NextResponse.json({ order: updated ? publicOrderDTO(updated) : null })
  } catch (e) {
    logger.error({ err: e }, 'token patch failed')
    return NextResponse.json({ error: 'Failed to update token' }, { status: 500 })
  }
})
