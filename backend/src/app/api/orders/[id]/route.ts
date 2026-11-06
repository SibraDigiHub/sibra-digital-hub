// GET /api/orders/[id] — buyer-facing order status (for thank-you polling)
// T5: public shape — the download-token hash and the paid file name
// never leave the server (§6.5); every field the thank-you page and
// the checkout poller read is unchanged.
// Security-audit fix (was an unauthenticated PII/IDOR surface): the route
// now carries the SAME claim-cookie gate + IP rate limit as
// GET /api/orders/[id]/status. The buyer's own browser (the only caller in
// the app) keeps working — the __Host-sdh_claim cookie is set at checkout
// create. Response shape is unchanged.
import { NextRequest, NextResponse } from 'next/server'
import { asHandler, forbidden, notFound, tooMany } from '@/lib/api'
import { publicOrderDTO } from '@/services/order-service'
import { ORDER_PRODUCT_INCLUDE } from '@/repositories/order-repo'
import { db } from '@/lib/db'
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
  return NextResponse.json({ order: publicOrderDTO(order) })
})
