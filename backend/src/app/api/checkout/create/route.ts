// POST /api/checkout/create — dual-gateway order creation (§5.1).
// Requires an `Idempotency-Key` header (repeat keys replay the stored
// response); gateway/currency/amount are decided ONLY here from the
// confirmed country + DB product. Success sets the httpOnly claim cookie.
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { asHandler, badRequest, parseBody, tooMany } from '@/lib/api'
import { checkoutCreateSchema, createCheckout, replayIdempotent, storeIdempotent } from '@/services/checkout-service'
import { checkoutCreateLimitPerIp } from '@/lib/auth/rate-limit'
import { clientIp } from '@/lib/auth/session'
import { originAllowed, setClaimCookie } from '@/lib/claim-cookie'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (req: NextRequest) => {
  if (!originAllowed(req)) return NextResponse.json({ error: 'Blocked origin' }, { status: 403 })

  const limit = await checkoutCreateLimitPerIp(clientIp(req))
  if (!limit.allowed) return tooMany(limit.retryAfterSec)

  const idempotencyKey = req.headers.get('idempotency-key')?.trim() ?? ''
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw badRequest('Missing Idempotency-Key header')
  }

  const input = await parseBody(req, checkoutCreateSchema)
  const requestHash = createHash('sha256').update(`POST|/api/checkout/create|${JSON.stringify(input)}`).digest('hex')

  const replay = await replayIdempotent(idempotencyKey, requestHash)
  if (replay) return NextResponse.json(replay.body, { status: replay.status })

  const result = await createCheckout(input, {
    ipCountry: req.headers.get('x-vercel-ip-country') || req.headers.get('cf-ipcountry') || null,
    visitorCookie: req.cookies.get('sdh_vid')?.value ?? null,
  })

  const payload = {
    order: result.order,
    gateway: result.gateway,
    currency: result.currency,
    amountMinor: result.amountMinor,
    display: result.display,
    paymentMode: result.paymentMode,
    razorpay: result.razorpay,
    upiId: result.upiId,
    upiPayeeName: result.upiPayeeName,
  }
  const res = NextResponse.json(payload, { status: 201 })
  setClaimCookie(res, result.order.id)
  await storeIdempotent(idempotencyKey, requestHash, 201, payload)
  return res
})
