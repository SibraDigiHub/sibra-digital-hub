// GET /api/orders/lookup — thank-you page last-resort order recovery.
//
// Owner request: the paid card (product download + invoice) must render
// even when the SPA loses the `?order=` reference entirely — older router
// builds navigate with a bare #/thank-you and cleared/stale browser
// storage cannot help. The checkout ALWAYS leaves an httpOnly
// `__Host-sdh_claim` cookie in the buyer's browser (set at
// /api/checkout/create, HMAC-signed with SESSION_PEPPER), so the server
// can tell the thank-you page which order THIS browser claimed.
//
// Trust model is identical to GET /api/orders/[id]: the claim cookie is
// unforgeable client-side and only the checkout browser carries it. The
// order id comes FROM the cookie (never from the URL), so there is no
// IDOR surface; the response is the same public DTO the thank-you page
// already consumes. Same IP rate limit as the status/detail routes.
import { NextRequest, NextResponse } from 'next/server'
import { asHandler, notFound, tooMany } from '@/lib/api'
import { publicOrderDTO } from '@/services/order-service'
import { ORDER_PRODUCT_INCLUDE } from '@/repositories/order-repo'
import { db } from '@/lib/db'
import { readClaimedOrderId } from '@/lib/claim-cookie'
import { checkoutStatusLimitPerIp } from '@/lib/auth/rate-limit'
import { clientIp } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  const limit = await checkoutStatusLimitPerIp(clientIp(req))
  if (!limit.allowed) return tooMany(limit.retryAfterSec)
  const claimed = readClaimedOrderId(req)
  if (!claimed) throw notFound('No claimed order in this browser')
  const order = await db.order.findUnique({ where: { id: claimed }, include: ORDER_PRODUCT_INCLUDE })
  if (!order) throw notFound('Order not found')
  return NextResponse.json({ order: publicOrderDTO(order) })
})
