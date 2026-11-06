// GET  /api/orders — admin list (search by email/name)
// POST /api/orders — RETIRED (P1): answers 410 Gone. Every order must be
// created through POST /api/checkout/create (confirmed billing country,
// server-side resolveGateway/currency, Idempotency-Key, consent timestamp,
// repeat-purchase guard). Dev-only escape: LEGACY_ORDERS_ENABLED=true.
import { NextRequest, NextResponse } from 'next/server'
import { ApiError, asHandler, json, parseBody, tooMany, unauthorized } from '@/lib/api'
import { isAdmin } from '@/lib/admin-auth'
import { legacyOrdersEnabled } from '@/config/env'
import { ordersCreateLimitPerIp } from '@/lib/auth/rate-limit'
import { clientIp } from '@/lib/auth/session'
import { ensureVisitorId, eventContext, logEvent } from '@/lib/activity'
import { orderRepo } from '@/repositories/order-repo'
import { createOrder, createOrderSchema, orderDTO, publicOrderDTO } from '@/services/order-service'
import { setClaimCookie } from '@/lib/claim-cookie'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  if (!(await isAdmin())) throw unauthorized()
  const q = req.nextUrl.searchParams.get('q') || ''
  const orders = await orderRepo.adminList(q)
  return json({ orders: orders.map(orderDTO) })
})

export const POST = asHandler(async (req: NextRequest) => {
  // P1: the legacy create path bypasses checkout v2's guarantees (confirmed
  // country, gateway-decided price/currency, Idempotency-Key, consent) —
  // it is retired everywhere, and even in dev only an explicit env opt-in
  // can revive it. No DB access happens on the 410 path.
  if (!legacyOrdersEnabled()) {
    throw new ApiError(410, 'This checkout endpoint has been retired — please start again from the product page.', 'LEGACY_CHECKOUT_RETIRED')
  }

  // T7 (§8.2): checkout create — 10 per 15 min per IP (PG-backed, fail-open).
  const limit = await ordersCreateLimitPerIp(clientIp(req))
  if (!limit.allowed) return tooMany(limit.retryAfterSec)

  const input = await parseBody(req, createOrderSchema)
  const visitorCookie = req.cookies.get('sdh_vid')?.value ?? null
  const result = await createOrder(input, visitorCookie)
  // Public response: token hash + paid file name never leave the server (§6.5).
  const order = publicOrderDTO(result.order)

  // Funnel step: checkout started (links visitor → email timeline)
  try {
    const ctx = eventContext(req)
    const visitorId = result.order.visitorId ?? ensureVisitorId(req, placeholderRes())
    await logEvent({
      type: 'checkout_started',
      productId: result.order.productId,
      zone: result.order.product.zone,
      email: result.order.customerEmail,
      orderId: result.order.id,
      visitorId,
      path: ctx.path,
      referrer: ctx.referrer,
      country: ctx.country,
      device: ctx.device,
    })
  } catch {
    // analytics never blocks checkout
  }

  const res =
    result.mode === 'razorpay'
      ? NextResponse.json(
          { order, paymentMode: 'razorpay', razorpay: result.razorpay, amountInr: result.amountInr },
          { status: 201 },
        )
      : NextResponse.json(
          { order, paymentMode: 'demo', upiId: result.upiId, upiPayeeName: result.upiPayeeName, amountInr: result.amountInr },
          { status: 201 },
        )
  // Persist/mint the visitor cookie so follow-up events join the same timeline
  ensureVisitorId(req, res)
  // Claim cookie parity with checkout v2: demo-pay / status / verify are
  // claim-gated (re-audit B3) — a legacy-created order must be payable by
  // the browser that created it, exactly like a v2 order.
  setClaimCookie(res, result.order.id)
  return res
})

/** Minimal shim so ensureVisitorId can always attach its cookie even before the final response exists. */
function placeholderRes(): NextResponse {
  return new NextResponse(null, { status: 204 })
}
