// GET /api/orders/[id]/status — claim-cookie-gated order status (§5.1).
// Unlike the legacy public GET /api/orders/[id] (kept byte-identical for
// the existing flow), this route answers ONLY to the browser that created
// the order — the `__Host-sdh_claim` cookie is HMAC-verified per order.
import { NextRequest, NextResponse } from 'next/server'
import { asHandler, forbidden, notFound, tooMany } from '@/lib/api'
import { db } from '@/lib/db'
import { ORDER_PRODUCT_INCLUDE } from '@/repositories/order-repo'
import { publicOrderDTO } from '@/services/order-service'
import { readClaimedOrderId } from '@/lib/claim-cookie'
import { checkoutStatusLimitPerIp } from '@/lib/auth/rate-limit'
import { clientIp } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const limit = await checkoutStatusLimitPerIp(clientIp(req))
  if (!limit.allowed) return tooMany(limit.retryAfterSec)
  const { id } = await params
  const claimed = readClaimedOrderId(req)
  if (!claimed || claimed !== id) throw forbidden('This order status is only visible to the checkout that created it')

  const order = await db.order.findUnique({ where: { id }, include: ORDER_PRODUCT_INCLUDE })
  if (!order) throw notFound('Order not found')
  return NextResponse.json({
    order: {
      ...publicOrderDTO(order),
      gateway: order.gateway,
      currency: order.currency,
      amountMinor: order.amountMinor,
      billingCountry: order.billingCountry,
      // P6 (additive, claim-gated): true ONLY when the customer's card
      // payment was refused by RAZORPAY_BLOCK_INTERNATIONAL_CARDS — the
      // checkout dialog turns this into a friendly retry/marketplace hint.
      paymentBlocked: order.riskFlags.includes('INTERNATIONAL_CARD_BLOCKED'),
    },
  })
})
