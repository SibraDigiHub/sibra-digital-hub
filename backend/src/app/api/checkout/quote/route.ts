// POST /api/checkout/quote — the exact gateway+total before paying (§5.1).
// Creates nothing; unsupported combinations answer 422 with the friendly
// marketplace-hint message (client renders the marketplace buttons).
import { NextRequest, NextResponse } from 'next/server'
import { asHandler, parseBody, tooMany } from '@/lib/api'
import { quoteCheckout, quoteSchema } from '@/services/checkout-service'
import { checkoutQuoteLimitPerIp } from '@/lib/auth/rate-limit'
import { clientIp } from '@/lib/auth/session'
import { originAllowed } from '@/lib/claim-cookie'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (req: NextRequest) => {
  if (!originAllowed(req)) return NextResponse.json({ error: 'Blocked origin' }, { status: 403 })
  const limit = await checkoutQuoteLimitPerIp(clientIp(req))
  if (!limit.allowed) return tooMany(limit.retryAfterSec)
  const body = await parseBody(req, quoteSchema)
  const quote = await quoteCheckout(body.productId, body.country)
  return NextResponse.json(quote)
})
