// GET  /api/reviews/order?token=… — rate-page context (verified purchase check)
// POST /api/reviews/order        — submit ONE verified-purchase review
import { NextRequest } from 'next/server'
import { asHandler, json, parseBody, parseQuery, tooMany } from '@/lib/api'
import { clientIp } from '@/lib/auth/session'
import { reviewResolveLimitPerIp, reviewSubmitLimitPerIp } from '@/lib/auth/rate-limit'
import { reviewContext, submitReview } from '@/services/review-service'
import { reviewSubmitSchema, reviewTokenSchema } from '@/validators/review'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  const limit = await reviewResolveLimitPerIp(clientIp(req))
  if (!limit.allowed) return tooMany(limit.retryAfterSec)
  const { token } = parseQuery(req, reviewTokenSchema)
  return json(await reviewContext(token))
})

export const POST = asHandler(async (req: NextRequest) => {
  const limit = await reviewSubmitLimitPerIp(clientIp(req))
  if (!limit.allowed) return tooMany(limit.retryAfterSec)
  const input = await parseBody(req, reviewSubmitSchema)
  return json(await submitReview(input), { status: 201 })
})
