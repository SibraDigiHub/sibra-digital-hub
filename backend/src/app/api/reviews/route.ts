// GET/POST/DELETE /api/reviews — testimonials (public read, admin write)
import { NextRequest } from 'next/server'
import { asHandler, cachedJson, json, parseBody, badRequest } from '@/lib/api'
import { isAdmin } from '@/lib/admin-auth'
import { unauthorized } from '@/lib/api'
import { reviewRepo } from '@/repositories/content-repo'
import { createReview, reviewCreateSchema } from '@/services/content-service'
import { publicWallReviews } from '@/services/review-service'

export const dynamic = 'force-dynamic'

export const GET = asHandler(async (req: NextRequest) => {
  const [productReviews, testimonials] = await Promise.all([
    publicWallReviews(),
    reviewRepo.listAll(),
  ])
  const reviews = [...productReviews, ...testimonials]
  // Public read — same T3.2 cache policy as faqs/categories (60 s edge + SWR);
  // admin edits (POST/DELETE) land within the policy window, shape unchanged.
  return cachedJson(req, { reviews })
})

export const POST = asHandler(async (req: NextRequest) => {
  if (!(await isAdmin())) throw unauthorized()
  const input = await parseBody(req, reviewCreateSchema)
  const review = await createReview(input)
  return json({ review }, { status: 201 })
})

export const DELETE = asHandler(async (req: NextRequest) => {
  if (!(await isAdmin())) throw unauthorized()
  const id = req.nextUrl.searchParams.get('id')
  if (!id) throw badRequest('id required')
  await reviewRepo.remove(id)
  return json({ ok: true })
})
