// GET /api/reviews/product?slug=… — approved reviews + rating summary
// for one published product (public product detail page).
import { NextRequest } from 'next/server'
import { asHandler, json, notFound, parseQuery } from '@/lib/api'
import { publicReviewsForSlug } from '@/services/review-service'
import { publicReviewsQuerySchema } from '@/validators/review'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  const { slug } = parseQuery(req, publicReviewsQuerySchema)
  const data = await publicReviewsForSlug(slug)
  if (!data) throw notFound('Product not found')
  return json(data, { headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' } })
})
