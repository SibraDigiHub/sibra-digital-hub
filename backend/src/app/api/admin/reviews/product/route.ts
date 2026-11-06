// GET /api/admin/reviews/product?status=… — review moderation queue
import { NextRequest } from 'next/server'
import { asHandler, json, parseQuery, unauthorized } from '@/lib/api'
import { isAdmin } from '@/lib/admin-auth'
import { adminReviewList } from '@/services/review-service'
import { adminReviewListQuerySchema } from '@/validators/review'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  if (!(await isAdmin())) throw unauthorized()
  const { status } = parseQuery(req, adminReviewListQuerySchema)
  return json({ reviews: await adminReviewList(status) })
})
