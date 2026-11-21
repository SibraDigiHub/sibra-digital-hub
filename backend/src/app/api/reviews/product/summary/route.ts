// GET /api/reviews/product/summary — batched rating summaries
// ({ productId: { avg, count } }) for catalog cards. Only products with
// at least one APPROVED review appear — cards without reviews render
// exactly as before.
import { NextRequest } from 'next/server'
import { asHandler, cachedJson } from '@/lib/api'
import { ratingSummaries } from '@/services/review-service'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  // Batched summaries are public catalog data — same T3.2 policy as the other
  // public GETs (60 s edge + SWR). Response shape unchanged.
  return cachedJson(req, { ratings: await ratingSummaries() })
})
