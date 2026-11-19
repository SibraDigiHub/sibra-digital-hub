// GET /api/reviews/product/summary — batched rating summaries
// ({ productId: { avg, count } }) for catalog cards. Only products with
// at least one APPROVED review appear — cards without reviews render
// exactly as before.
import { NextRequest } from 'next/server'
import { asHandler, json } from '@/lib/api'
import { ratingSummaries } from '@/services/review-service'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  return json({ ratings: await ratingSummaries() }, { headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' } })
})
