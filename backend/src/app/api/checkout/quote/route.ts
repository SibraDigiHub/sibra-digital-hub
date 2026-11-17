// POST /api/checkout/quote — the exact gateway+total before paying (§5.1).
// Creates nothing; unsupported combinations answer 422 with the friendly
// marketplace-hint message (client renders the marketplace buttons).
import { NextRequest, NextResponse } from 'next/server'
import { asHandler, parseBody, tooMany } from '@/lib/api'
import { quoteCheckout, quoteSchema } from '@/services/checkout-service'
import { visitorCountry } from '@/services/visitor-geo'
import { checkoutQuoteLimitPerIp } from '@/lib/auth/rate-limit'
import { clientIp } from '@/lib/auth/session'
import { originAllowed } from '@/lib/claim-cookie'

export const dynamic = 'force-dynamic'

export const POST = asHandler(async (req: NextRequest) => {
  if (!originAllowed(req)) return NextResponse.json({ error: 'Blocked origin' }, { status: 403 })
  const limit = await checkoutQuoteLimitPerIp(clientIp(req))
  if (!limit.allowed) return tooMany(limit.retryAfterSec)
  const body = await parseBody(req, quoteSchema)
  // Task 3: the SERVER detects the country (geo header; QA override only in
  // dev/staging or for a verified admin). The body's `country` — if an old
  // cached bundle still sends one — is accepted but IGNORED.
  const country = await visitorCountry(req)
  const quote = await quoteCheckout(body.productId, country)
  return NextResponse.json(quote)
})
