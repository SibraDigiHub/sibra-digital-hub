// POST /api/orders/[id]/demo-pay — simulate UPI payment (ONLY outside production)
// T5: hard 404 in production (the mock route must not exist there),
// fulfillment via the single idempotent fulfillOrder(), and the order
// echoed back through the public DTO (no token hash, no file name).
import { logger } from '@/lib/logger'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { demoRouteBlocked } from '@/config/env'
import { razorpayConfigured } from '@/lib/razorpay'
import { fulfillOrder, publicOrderDTO } from '@/services/order-service'
import { ORDER_PRODUCT_INCLUDE } from '@/repositories/order-repo'
import { readClaimedOrderId } from '@/lib/claim-cookie'
import { tooMany, asHandler } from '@/lib/api'
import { demoPayLimitPerIp } from '@/lib/auth/rate-limit'
import { clientIp } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  // Security: mock payments are 404 in production (route invisible) —
  // EXCEPT on an explicit DEMO_MODE=true staging deployment, whose whole
  // documented purpose is key-less demo payments (config/env.ts §T7).
  // Real-key stores never reach the demo path below (409 when configured).
  if (demoRouteBlocked()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (razorpayConfigured()) {
    return NextResponse.json({ error: 'Demo payments are disabled in production mode' }, { status: 409 })
  }
  // Security-audit fix: this is a fake-payment-success callback — without
  // the claim cookie anyone with an order id could fulfil it. The buyer's
  // own browser always carries __Host-sdh_claim (set at checkout create).
  const limit = await demoPayLimitPerIp(clientIp(req))
  if (!limit.allowed) return tooMany(limit.retryAfterSec)
  const { id } = await params
  const claimed = readClaimedOrderId(req)
  if (!claimed || claimed !== id) {
    return NextResponse.json({ error: 'This order can only be paid by the checkout that created it' }, { status: 403 })
  }
  try {
    const order = await db.order.findUnique({ where: { id } })
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    const result = await fulfillOrder(order.id)

    if (result.outcome === 'rejected') {
      return NextResponse.json({ error: 'Failed to confirm payment' }, { status: 409 })
    }

    const paid = await db.order.findUnique({ where: { id: order.id }, include: ORDER_PRODUCT_INCLUDE })
    // T-V: watch-mode orders hand back the ON-SITE watch link (the SPA
    // fragment form) instead of a file download URL — everything else
    // byte-identical to the pre-existing demo response.
    const isWatch = paid?.product?.deliveryMode === 'watch'
    return NextResponse.json({
      order: paid ? publicOrderDTO(paid) : null,
      token: result.token,
      // SPA download page — the GET only validates; the page's Download
      // click claims the slot via POST (email-scanner safe, §2.7).
      downloadUrl: !isWatch && result.token ? `/#/download/${result.token}` : null,
      watchUrl: isWatch && result.token ? `/#/watch/${result.token}` : null,
      // Layer 2: the buyer's verified-review invite (same token, rate page).
      rateUrl: result.token ? `/#/rate/${result.token}` : null,
      emailDemo: result.emailDemo,
      ...(result.outcome === 'duplicate' ? { alreadyPaid: true } : {}),
    })
  } catch (e) {
    logger.error({ err: e }, 'demo-pay failed')
    return NextResponse.json({ error: 'Failed to confirm payment' }, { status: 500 })
  }
})
